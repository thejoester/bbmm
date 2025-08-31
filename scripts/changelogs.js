/*
***************************************************************************
	BBMM — Changelog on Login (Foundry v13)
	Shows module changelogs to the GM on login for any modules that have
	been updated and have a changelog file or URL.
***************************************************************************
*/
import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";


// Cache directory listings so we only hit the server once per module.
const _BBMM_DIR_CACHE = new Map();

const CHANGELOG_CANDIDATES = [
	"CHANGELOG.md","CHANGELOG.txt","CHANGELOG",
	"Changelog.md","Changelog.txt","Changelog",
	"changelog.md","changelog.txt","changelog",
	"docs/CHANGELOG.md","docs/Changelog.md","docs/changelog.md","docs/CHANGELOG.txt"
];

// ===== Entry Points =====
Hooks.once("ready", async () => {
	try {
		if (!game.user.isGM) return;
		const showOnLogin = game.settings.get(BBMM_ID, "showChangelogsOnLogin");
		if (!showOnLogin) return;

		const entries = await _bbmmCollectUpdatedModulesWithChangelogs();
		if (!entries.length) return;

		// Preload all texts so paging is instant
		for (const e of entries) {
            e.text = await _bbmmFetchChangelogText(e.url); // local-only
        }
        const nonEmpty = entries.filter(e => (e.text && e.text.trim().length));
        if (!nonEmpty.length) return;
        DL(`Changelog: opening journal with ${nonEmpty.length} module(s).`);
        new BBMMChangelogJournal(nonEmpty).render(true);
	} catch (err) {
		DL(3, `Changelog ready hook error: ${err?.message || err}`, err);
	}
});

/*
	List files in /modules/<id>/ and optionally /modules/<id>/docs/ 
	Returns a Set of filenames present at the root and docs/ (e.g., "CHANGELOG.md", "docs/CHANGELOG.md").
*/
async function _bbmmListModuleFilesCached(modId) {
	// Use cached if present
	if (_BBMM_DIR_CACHE.has(modId)) return _BBMM_DIR_CACHE.get(modId);

	const found = new Set();

	try {
		// Root listing
		const rootPath = `modules/${modId}/`;
		const root = await FilePicker.browse("data", rootPath);
		for (const f of root.files) {
			const name = f.split("/").pop();
			if (name) found.add(name);
		}
		// If a docs/ folder exists, browse it once
		const hasDocsDir = root.dirs?.some(d => d.endsWith(`/modules/${modId}/docs`)) ?? false;
		if (hasDocsDir) {
			const docs = await FilePicker.browse("data", `${rootPath}docs/`);
			for (const f of docs.files) {
				const name = f.split("/").pop();
				if (name) found.add(`docs/${name}`);
			}
		}
	} catch (err) {
		// Ignore; some storage backends might block browse, we'll fall back to manifest URL
		DL(2, `_bbmmListModuleFilesCached: browse failed for ${modId}: ${err?.message || err}`);
	}

	_BBMM_DIR_CACHE.set(modId, found);
	return found;
}

function _bbmmSizeFrameOnce(frame) {
	try {
		// Target = 50% wider, 30% shorter than your original 900x640
		const targetW = 1350; // 900 * 1.5
		const targetH = 448;  // 640 * 0.7

		// Keep it inside the viewport and reasonable bounds
		const maxW = Math.min(window.innerWidth - 40, 1500);
		const maxH = Math.min(window.innerHeight - 60, 900);
		const minW = 720;
		const minH = 900;

		const w = Math.max(minW, Math.min(targetW, maxW));
		const h = Math.max(minH, Math.min(targetH, maxH));

		// Apply pixel sizes only; avoid vw/vh to prevent body scrollbars
		frame.style.width = `${w}px`;
		frame.style.height = `${h}px`;

		// Optional mins for resize handles
		frame.style.minWidth = `${minW}px`;
		frame.style.minHeight = `${minH}px`;
		frame.style.maxWidth = `${Math.max(w, minW)}px`;
		frame.style.maxHeight = `${Math.max(h, minH)}px`;
	} catch (err) {
		DL(2, `_bbmmSizeFrameOnce error: ${err?.message || err}`, err);
	}
}

// ===== Main Workflow =====

class BBMMChangelogJournal extends foundry.applications.api.ApplicationV2 {
	constructor(entries) {
		super({
			id: "bbmm-changelog-journal",
			window: { title: LT.changelog.window_title(), modal: true },
			width: 900,
			height: 640,
			resizable: true,
			classes: ["bbmm-changelog-journal"]
		});
		this.entries = Array.isArray(entries) ? entries : [];
		this.index = 0;
	}

    async _replaceHTML(html, element) {
	try {
		// v13 passes (html, element). Use element as the container.
		const root = element || this.element;
		if (!root) {
			DL(2, "_replaceHTML: no root element available");
			return;
		}

		// Accept either a string or a Node/Fragment
		if (typeof html === "string") {
			root.innerHTML = html;
		} else if (html instanceof HTMLElement || html instanceof DocumentFragment) {
			// Safer replacement when we get nodes
			root.replaceChildren(html);
		} else {
			DL(2, "_replaceHTML: unexpected html payload type");
			return;
		}

		// Re-bind listeners on the fresh DOM
		this._onRender(root);
	} catch (err) {
		DL(2, `_replaceHTML error: ${err?.message || err}`, err);
	}
}

	/* AppV2: build HTML string */
	async _renderHTML() {
        const esc = (s) => String(s ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");

        const current = this.entries[this.index] || {};
        const list = this.entries.map((e, i) => {
            const active = i === this.index ? "style='background:#222;'" : "";
            const vv = esc(e.version || "0.0.0");
            const tt = esc(e.title || e.id || "Unknown");
            return `
                <button class="bbmm-nav-item" data-index="${i}" ${active}>
                    <div style="font-weight:600;">${tt}</div>
                    <div style="opacity:.75;font-size:.85em;">v${vv}</div>
                </button>
            `;
        }).join("");

        const content = `
            <section class="bbmm-shell" style="display:flex;gap:.75rem;min-height:0;height:100%;">
                <!-- Sidebar -->
                <aside style="width:260px;min-width:220px;flex:0 0 auto;display:flex;flex-direction:column;min-height:0;padding:.5rem;border-right:1px solid #444;">
                    <div class="bbmm-nav-scroll" style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:.5rem;">
                        ${list}
                    </div>
                </aside>

                <!-- Page -->
                <main style="flex:1;display:flex;flex-direction:column;gap:.5rem;min-width:0;min-height:0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
                        <div style="font-weight:700;">
                            ${esc(current.title || current.id || "")} — v${esc(current.version || "0.0.0")}
                        </div>
                        <div style="opacity:.8;">
                            ${LT.changelog.source()}: <a href="${current.url || "#"}" target="_blank" rel="noopener">${esc(current.url || "")}</a>
                        </div>
                    </div>

                    <pre class="bbmm-changelog-pre" style="flex:1;min-height:0;overflow:auto;padding:.75rem;border:1px solid #555;border-radius:.5rem;background:#111;white-space:pre-wrap;">${esc(current.text || "")}</pre>

                    <label style="display:flex;align-items:center;gap:.5rem;">
                        <input type="checkbox" name="dontShowAgain" />
                        <span>${LT.changelog.dont_show_again()}</span>
                    </label>

                    <div style="display:flex;gap:.5rem;justify-content:flex-end;">
                        <button type="button" data-action="mark-current">${LT.changelog.mark_current()}</button>
                        <button type="button" data-action="mark-all">${LT.changelog.mark_all()}</button>
                    </div>
                </main>
            </section>
        `;
        return content;
    }

	/* Wire events */
async _replaceHTML(html, element) {
	try {
		const root = element || this.element;
		if (!root) {
			DL(2, "_replaceHTML: no root element available");
			return;
		}

		if (typeof html === "string") {
			root.innerHTML = html;
		} else if (html instanceof HTMLElement || html instanceof DocumentFragment) {
			root.replaceChildren(html);
		} else {
			DL(2, "_replaceHTML: unexpected html payload type");
			return;
		}

		// Make the app content fill the frame so inner flex children can scroll
		root.style.display = "flex";
		root.style.flexDirection = "column";
		root.style.height = "100%";
		root.style.minHeight = "0";

		// Also ensure our shell stretches full height
		const shell = root.querySelector(".bbmm-shell");
		if (shell) {
			shell.style.height = "100%";
			shell.style.minHeight = "0";
		}

		this._onRender(root);
	} catch (err) {
		DL(2, `_replaceHTML error: ${err?.message || err}`, err);
	}
}

_onRender(html) {
	try {
		const root = (html instanceof HTMLElement) ? html : this.element;
		if (!root) {
			DL(2, "_onRender: missing root element");
			return;
		}

		const frame = (root.closest?.(".app, .window-app")) || root.parentElement;
		if (!frame) return;

		// Size once, then center once, using rAF to let Foundry finish layout
		if (!this._sizedOnce) {
			this._sizedOnce = true;
			requestAnimationFrame(() => {
				_bbmmSizeFrameOnce(frame);
				// Center on the next frame after sizing so we have final width/height
				requestAnimationFrame(() => _bbmmCenterFrame(frame, this));
			});
		} else if (!this._centeredOnce) {
			this._centeredOnce = true;
			requestAnimationFrame(() => _bbmmCenterFrame(frame, this));
		}

		// Sidebar navigation
		root.querySelectorAll(".bbmm-nav-item").forEach(btn => {
			btn.addEventListener("click", ev => {
				const idx = Number(ev.currentTarget?.dataset?.index ?? 0);
				if (!Number.isNaN(idx) && idx >= 0 && idx < this.entries.length) {
					this.index = idx;
					this.render();
					DL(`Changelog: switched to index ${idx} (${this.entries[idx]?.id})`);
				}
			});
		});

		// Footer actions
		root.querySelector('[data-action="mark-current"]')?.addEventListener("click", async () => {
			const entry = this.entries[this.index];
			if (!entry) return;
			await _bbmmMarkChangelogSeen(entry.id, entry.version);
			ui.notifications?.info(LT.changelog.markedSeenSingle(entry.title || entry.id, entry.version));
			DL(`Changelog marked seen for ${entry.id} -> ${entry.version}`);
		});

		root.querySelector('[data-action="mark-all"]')?.addEventListener("click", async () => {
			for (const e of this.entries) {
				await _bbmmMarkChangelogSeen(e.id, e.version);
			}
			ui.notifications?.info(LT.changelog.markedSeenAll(this.entries.length));
			DL(`Changelog marked all seen (${this.entries.length}).`);
		});
	} catch (err) {
		DL(2, `_onRender (BBMMChangelogJournal) error: ${err?.message || err}`, err);
	}
}

	/* When closing, honor "don’t show again" for the CURRENT page (optional UX). */
	async close(options) {
		try {
			const root = this.element;
			const dont = root?.querySelector('input[name="dontShowAgain"]')?.checked;
			if (dont) {
				const e = this.entries[this.index];
				if (e) {
					await _bbmmMarkChangelogSeen(e.id, e.version);
					DL(`Changelog: auto-marked seen on close for ${e.id} -> ${e.version}`);
				}
			}
		} catch (err) {
			DL(2, `close() auto-mark error: ${err?.message || err}`, err);
		}
		return super.close(options);
	}
}

/*
	Center the app window without changing its size.
*/
function _bbmmCenterFrame(frame, app) {
	try {
		const rect = frame.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// Compute centered top/left, clamped to viewport
		const left = Math.max((vw - rect.width) / 2, 0);
		const top  = Math.max((vh - rect.height) / 2, 0);

		// Prefer AppV2 API; falls back to style if unavailable
		if (app?.setPosition) {
			app.setPosition({ left, top });
		} else {
			frame.style.left = `${left}px`;
			frame.style.top  = `${top}px`;
		}
	} catch (err) {
		DL(2, `_bbmmCenterFrame error: ${err?.message || err}`, err);
	}
}

async function _bbmmCollectUpdatedModulesWithChangelogs() {
	const seen = game.settings.get(BBMM_ID, "seenChangelogs") || {};
	const results = [];

	try {
		for (const mod of game.modules) {
			try {
				if (!mod?.active) continue;
				const id = mod?.id ?? null;
				if (!id) continue;

				const title = mod?.title || id;
				const version = mod?.version || "0.0.0";
				const prevSeen = seen?.[id] || null;
				if (prevSeen && !foundry.utils.isNewerVersion(version, prevSeen)) continue;

				const url = await _bbmmFindChangelogURL(mod); // local-only
				if (!url) continue;

				results.push({ id, title, version, url, mod });
			} catch (errInner) {
				DL(2, `Changelog collect: skipping a module due to error: ${errInner?.message || errInner}`, errInner);
			}
		}
	} catch (err) {
		DL(2, `Changelog collect: top-level error: ${err?.message || err}`, err);
	}

	return results;
}

// ===== Fetch Changelogs =====
async function _bbmmFindChangelogURL(mod) {
	try {
		const files = await _bbmmListModuleFilesCached(mod.id);
		if (files && files.size) {
			for (const name of CHANGELOG_CANDIDATES) {
				if (files.has(name)) {
					return `./modules/${mod.id}/${name}`;
				}
			}
		}
	} catch (err) {
		DL(2, `_bbmmFindChangelogURL (local-only) failed for ${mod.id}: ${err?.message || err}`);
	}
	return null; // never fall back to remote
}

async function _bbmmFetchChangelogText(url) {
	try {
		if (!url) return "";
		// Same-origin local file; will not trigger CORS or 404 spam (we checked existence via browse).
		const res = await fetch(url, { method: "GET", cache: "no-cache" });
		if (!res.ok) return "";
		return await res.text();
	} catch {
		return "";
	}
}

// ===== UI =====

async function _bbmmShowSingleChangelogDialog(entry) {
	const { id, title, version, url } = entry;

	// Load the text now so the dialog shows immediately
	const raw = await _bbmmFetchChangelogText(url);

	// render raw inside a <pre>. 
	const esc = (s) => s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

	const content = `
		<div class="bbmm-changelog-wrap" style="display:flex;flex-direction:column;gap:.5rem;max-height:60vh;">
			<div style="font-weight:600;">${esc(title)} — v${esc(version)}</div>
			<div style="opacity:.8;">Source: <a href="${url}" target="_blank" rel="noopener">${esc(url)}</a></div>
			<pre style="flex:1;overflow:auto;padding:.5rem;border:1px solid #555;border-radius:.5rem;background:#111;white-space:pre-wrap;">${esc(raw)}</pre>
			<label style="display:flex;align-items:center;gap:.5rem;">
				<input type="checkbox" name="dontShowAgain" />
				<span>Don’t show again for this version</span>
			</label>
		</div>
	`;

	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: `Changelog — ${title}`, modal: true },
			content,
			buttons: [
				{
					label: "Mark Seen",
					icon: "fa-solid fa-check",
					callback: async (html) => {
						try {
							const checkbox = html.querySelector('input[name="dontShowAgain"]');
							if (!checkbox?.checked) {
								// Still mark seen if they click explicit "Mark Seen"
							}
							await _bbmmMarkChangelogSeen(id, version);
							ui.notifications?.info(`Marked ${title} v${version} as seen.`);
							DL(`Changelog marked seen for ${id} -> ${version}`);
						} catch (err) {
							DL(3, `Mark seen failed for ${id}: ${err?.message || err}`, err);
						}
					}
				},
				{
					label: LT.changelog.remind_later(),
					icon: "fa-regular fa-clock",
					callback: (html) => {
						// If they ticked "Don’t show again", treat as Mark Seen
						const checkbox = html.querySelector('input[name="dontShowAgain"]');
						if (checkbox?.checked) {
							_bbmmMarkChangelogSeen(id, version).catch(err => {
								DL(3, `Mark seen (from 'Don't show again') failed for ${id}: ${err?.message || err}`, err);
							});
						}
					}
				}
			]
		}).render(true);
		resolve();
	});
}

// ===== Persistence =====

async function _bbmmMarkChangelogSeen(moduleId, version) {
	try {
		const seen = game.settings.get(BBMM_ID, "seenChangelogs") || {};
		seen[moduleId] = version;
		await game.settings.set(BBMM_ID, "seenChangelogs", seen);
	} catch (err) {
		DL(3, `Failed to update seenChangelogs for ${moduleId}: ${err?.message || err}`, err);
		throw err;
	}
}

// helper to manually open a specific module's changelog
export async function BBMM_openChangelogFor(moduleId) {
	try {
		const mod = game.modules.get(moduleId);
		if (!mod) {
			ui.notifications?.warn(`Module not found: ${moduleId}`);
			return;
		}
		const url = await _bbmmFindChangelogURL(mod);
		if (!url) {
			ui.notifications?.warn(`No changelog found for: ${mod.title || moduleId}`);
			return;
		}
		await _bbmmShowSingleChangelogDialog({
			id: moduleId,
			title: mod.title || moduleId,
			version: mod.version || "0.0.0",
			url,
			mod
		});
	} catch (err) {
		DL(3, `BBMM_openChangelogFor error: ${err?.message || err}`, err);
	}
}