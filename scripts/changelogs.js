/*
***************************************************************************
	BBMM — Changelog on Login (Foundry v13)
	Shows module changelogs to the GM on login for any modules that have
	been updated and have a changelog file or URL.
***************************************************************************
*/
import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";

let __bbmm_isV12 = null;	// cache after init

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

	/*	
		Detect Foundry version 
		only show for V13 
	*/
	try {
		const gen = Number(game?.release?.generation);
		const ver = String(game?.version ?? game?.data?.version ?? CONFIG?.version ?? "");
		const major = Number.isFinite(gen) ? gen : parseInt((ver.split(".")[0] || "0"), 10);
		__bbmm_isV12 = (major === 12);
		DL(`BBMM init: major=${major} (gen=${gen}, ver="${ver}") → isV12=${__bbmm_isV12}`);

		// now safely gate your injections
		if (__bbmm_isV12) {
			DL(`BBMM skipping changelog report for v12`); 
		} else {
			try {
				/*
					on v13+ show changelog
				*/
				const start = performance.now();
				DL("changelog ready: starting");

				if (!game.user.isGM) return;
				const showOnLogin = game.settings.get(BBMM_ID, "showChangelogsOnLogin");
				if (!showOnLogin) return;

				const entries = await _bbmmCollectUpdatedModulesWithChangelogs();
				if (!entries.length) return;

				// Preload all texts so paging is instant
				for (const e of entries) {
					e.text = await _bbmmFetchChangelogText(e.url); // local-only
					
					e.html = await _bbmmToHTML(e.text); // Convert text into safe enriched HTML
				}
				const nonEmpty = entries.filter(e => (e.text && e.text.trim().length));
				if (!nonEmpty.length) return;
				DL(`Changelog: opening journal with ${nonEmpty.length} module(s).`);
				new BBMMChangelogJournal(nonEmpty).render(true);

				const end = performance.now();
				const ms = (end - start).toFixed(1);
				DL(`changelog ready: finished in ${ms}ms`);

			} catch (err) {
				DL(3, `Changelog ready hook error: ${err?.message || err}`, err);
			}
		}
	} catch (err) {
		DL(2, "BBMM init version gate failed", err);
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

function _bbmmSizeFrameOnce(frame, app) {
	try {
		// Viewport
		const vw = window?.innerWidth ?? 1280;
		const vh = window?.innerHeight ?? 900;

		// Margins  
		const marginW = 40;
		const marginH = 60;

		// Hard ceiling for very tall displays 
		const HARD_MAX_H = 900;

		// Respect constructor base size
		const baseW = Math.max(720, Number(app?._baseW ?? 900));
		const baseH = Math.max(400, Number(app?._baseH ?? 640));

		// Width: base -> capped to viewport
		const maxW = Math.max(600, Math.min(vw - marginW, 1600));
		const w = Math.min(Math.max(baseW, 720), maxW);

		// Height: start at base, clamp to viewport 
		const h = Math.min(Math.max(baseH, 400), vh - marginH);

		// Apply initial size 
		frame.style.width = `${w}px`;
		frame.style.height = `${h}px`;
		frame.style.minWidth = "720px";
		frame.style.maxWidth = `${maxW}px`;
		frame.style.maxHeight = `min(${HARD_MAX_H}px, calc(100vh - ${marginH}px))`;

		// Keep content scrolling inside, not the window
		frame.style.overflow = "hidden";

		DL(`_bbmmSizeFrameOnce(): viewport=${vw}x${vh}, base=${baseW}x${baseH}, final=${w}x${h}`);
	} catch (err) {
		DL(2, `_bbmmSizeFrameOnce error: ${err?.message || err}`, err);
	}
}



// ===== Main Workflow =====

class BBMMChangelogJournal extends foundry.applications.api.ApplicationV2 {
	constructor(entries) {
		// Detect viewport height and pick a safe base height
		const _vh = (window?.visualViewport?.height ?? window?.innerHeight ?? 900);
		const _height = _vh < 800 ? 500 : 640;

		super({
			id: "bbmm-changelog-journal",
			window: { title: LT.changelog.window_title(), modal: true },
			width: 900,
			minWidth: 900,
			height: _height,
			resizable: false,
			classes: ["bbmm-changelog-journal"]
		});

		// Remember base size so the sizer doesn't undershoot it
		this._baseW = 900;
		this._baseH = _height;

		this.entries = Array.isArray(entries) ? entries : [];
		this.index = 0;

		// track per-session states
		this._markedSeen = new Set();
		this._pendingOnClose = new Set();

		this._sizedOnce = false;
		this._centeredOnce = false;
	}

	/*
		===== Helpers =====
	*/

	_cleanHref(html) {
		try {
			const wrap = document.createElement("div");
			wrap.innerHTML = String(html ?? "");

			for (const a of wrap.querySelectorAll("a[href]")) {
				let href = a.getAttribute("href") || "";

				// 1) trim whitespace & stray quotes at the end
				href = href.replace(/[\s"'”’]+$/g, "");

				// 2) drop trailing punctuation that should not be in a URL
				//    (commas/closing parens/periods/semicolons/colons)
				href = href.replace(/[),.;:]+$/g, "");

				// write back + ensure safe link attrs
				a.setAttribute("href", href);
				a.setAttribute("target", "_blank");
				a.setAttribute("rel", "nofollow noopener");
			}
			return wrap.innerHTML;
		} catch (err) {
			DL(2, `_cleanHrefGarbage(): ${err?.message || err}`, err);
			return String(html ?? "");
		}
	}

	/*
		Replaces the leading "[label](" with "(" and injects {label} between > and </a>
	*/
	_fixMdWrappedEmptyAnchors(html) {
		try {
		let s = String(html ?? "");

		// Case 1: Double-<a> with an OUTER closing paren present.
		s = s.replace(
			/\[([^\]]+)\]\(\s*(<a\b[^>]*>)\s*<\/a>\s*<a\b[^>]*>https?:\/\/[^<]+?([),.;:])?<\/a>\s*\)/gi,
			(_m, label, aOpen, trail = "") => `(${aOpen}${label}</a>${trail})`
		);

		// Case 2: Double-<a> but NO outer ')'.
		s = s.replace(
			/\[([^\]]+)\]\(\s*(<a\b[^>]*>)\s*<\/a>\s*<a\b[^>]*>https?:\/\/[^<]+?([),.;:])?<\/a>/gi,
			(_m, label, aOpen, trail = "") => `${aOpen}${label}</a>${trail}`
		);

		// Case 3: Simple wrapped empty anchor WITH outer ')':
		s = s.replace(
			/\[([^\]]+)\]\(\s*(<a\b[^>]*>)\s*<\/a>\s*\)/gi,
			(_m, label, aOpen) => `(${aOpen}${label}</a>)`
		);

		// Case 4: Simple wrapped empty anchor WITHOUT outer ')':
		s = s.replace(
			/\[([^\]]+)\]\(\s*(<a\b[^>]*>)\s*<\/a>/gi,
			(_m, label, aOpen) => `${aOpen}${label}</a>`
		);

		// Optional tidy: "(<a ...>Label</a> )" → "(<a ...>Label</a>)"
		s = s.replace(/\(<a\b([^>]*)>([\s\S]*?)<\/a>\s+\)/gi, "(<a $1>$2</a>)");

		DL(`_fixMdWrappedEmptyAnchors(): applied`);
		return s;
	} catch (err) {
		DL(2, `_fixMdWrappedEmptyAnchors(): ${err?.message || err}`, err);
		return String(html ?? "");
	}
	}

	/* Preserve left-nav scroll across re-renders */
	_captureNavScroll(root) {
		try {
			const sc = root?.querySelector?.(".bbmm-nav-scroll");
			this._navScrollTop = sc ? sc.scrollTop : 0;
			DL(`Changelog: captured nav scrollTop=${this._navScrollTop}`);
		} catch (err) {
			DL(2, `_captureNavScroll(): ${err?.message || err}`, err);
		}
	}
	_restoreNavScroll(root) {
		try {
			if (typeof this._navScrollTop !== "number") return;
			const sc = root?.querySelector?.(".bbmm-nav-scroll");
			if (!sc) return;

			// restore immediately, then once more on next frame to survive late layout
			sc.scrollTop = this._navScrollTop;
			requestAnimationFrame(() => { sc.scrollTop = this._navScrollTop; });
			DL(`Changelog: restored nav scrollTop=${this._navScrollTop}`);
		} catch (err) {
			DL(2, `_restoreNavScroll(): ${err?.message || err}`, err);
		}
	}
	async _renderHTML() {
		// escape helper for titles/urls etc.
		const esc = (s) => String(s ?? "")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;");


		
		// pick current entry
		const current = this.entries[this.index] || {};
		// toolbar/footer labels
		const currentMarked = this._markedSeen.has(current.id);
		const allMarked = (this.entries.length && this.entries.every(e => this._markedSeen.has(e.id)));

		const btnCurrentLabel = currentMarked
			? LT.changelog.mark_current_unseen()
			: LT.changelog.mark_current();

		const btnAllLabel = allMarked
			? LT.changelog.mark_all_unseen()
			: LT.changelog.mark_all();
		// build left-side nav list 
		const list = this.entries.map((e, i) => {
			const activeAttr = i === this.index ? `data-active="1"` : "";
			const vv = esc(e.version || "0.0.0");
			const tt = esc(e.title || e.id || "Unknown");

			// add a tiny check icon if marked seen this session
			const seenNow = this._markedSeen.has(e.id)
				? "<span class='bbmm-seen-badge' title='Marked seen'>✓</span>"
				: "";

			return `
				<button class="bbmm-nav-item" data-index="${i}" ${activeAttr} style="position:relative;">
					<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
						${tt} ${seenNow}
					</div>
					<div style="opacity:.75;font-size:.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">v${vv}</div>
				</button>
			`;
		}).join("");

		// Prefer HTML if provided; else fall back to text/markdown
		const bodyText = current.html ?? current.text ?? current.body ?? current.markdown ?? "";

		let enrichedBody = "";
		try {
			// keep your current path (html vs text) + optional enrichHTML
			const bodyText = current.html ?? current.text ?? current.body ?? current.markdown ?? "";
			let out = bodyText;

			// if you enrich, remember to await in v13
			out = await TextEditor.enrichHTML(String(out), {
				secrets: false,
				relativeTo: null,
				links: true,
				rolls: false
			});

			// link sanitation pass 1: remove trailing '),', ')),' etc. from href
			enrichedBody = this._cleanHref(out);
			// link sanitation pass 2
			enrichedBody = this._fixMdWrappedEmptyAnchors(enrichedBody);	
		} catch (err) {
			DL(2, `_renderHTML(): enrich failed: ${err?.message || err}`, err);
			enrichedBody = current.html ?? current.text ?? current.body ?? current.markdown ?? "";
		}

		// compose the full view
		const content = `
			<section class="bbmm-shell bbmm-changelog bbmm-changelog-journal" style="display:flex;gap:.75rem;min-height:0;height:100%; width: 1200px; min-width:1200px;">
				<!-- Sidebar -->
				<aside class="bbmm-theme-reset" style="width:300px;min-width:220px;flex:0 0 auto;display:flex;flex-direction:column;min-height:0;padding:.5rem;border-right:1px solid var(--color-border-light, #888);">
					<div class="bbmm-nav-scroll" style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:.5rem;">
						${list}
					</div>
				</aside>

				<!-- Page -->
				<main style="flex:1;display:flex;flex-direction:column;gap:.5rem;min-height:0;">
					<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
						<div class="bbmm-heading-block">
							<h2 class="bbmm-heading">
								${esc(current.title || current.id || "")}
								<span class="bbmm-version">(v${esc(current.version || "0.0.0")})</span>
							</h2>
							<div class="bbmm-source">
								${LT.changelog.source()}: <a href="${current.url || "#"}" target="_blank" rel="noopener">${esc(current.url || "")}</a>
							</div>
						</div>
						<!-- Toolbar: duplicates footer actions for convenience -->
						<div class="bbmm-toolbar" style="display:flex;gap:.5rem;align-items:center;flex:0 0 auto;">
							<button type="button" data-action="mark-current">
								${this._markedSeen.has(current.id)
									? LT.changelog.mark_current_unseen()
									: LT.changelog.mark_current()}
							</button>
							<button type="button" data-action="mark-all">
								${this.entries.length && this.entries.every(e => this._markedSeen.has(e.id))
									? LT.changelog.mark_all_unseen()
									: LT.changelog.mark_all()}
							</button>
						</div>
					</div>

					<!-- Theme-reset wrapper so text/bg follow Foundry's light/dark theme -->
					<div class="right bbmm-theme-reset" style="flex:1;min-height:0;overflow:auto;padding:.75rem;border:1px solid var(--color-border-light, #888);border-radius:.5rem;background:transparent;">
						<div class="bbmm-changelog-body">
							${enrichedBody}
						</div>
					</div>

					<label style="display:flex;align-items:center;gap:.5rem;">
						<input type="checkbox" name="dontShowAgain"
							${this._pendingOnClose.has((current.id || "")) || this._markedSeen.has((current.id || "")) ? "checked" : ""}
							${this._markedSeen.has((current.id || "")) ? "disabled" : ""} />
						<span>${LT.changelog.dont_show_again()}</span>
					</label>

					<div style="display:flex;gap:.5rem;justify-content:flex-end;">
						
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
			if (frame) {
				// lock a minimum width
				frame.style.minWidth = "900px";

				// optional: also enforce a fixed width
				// frame.style.width = "900px";
				// frame.style.maxWidth = "900px";
			} else {
				if (!frame) return;
			}

			// Restore left-pane scroll position after re-render
			this._restoreNavScroll(root);

			// checkbox: toggle per-page pending state
			const cb = root.querySelector('input[name="dontShowAgain"]');
			if (cb) {
				cb.addEventListener("change", () => {
					const entry = this.entries[this.index];
					if (!entry) return;
					if (cb.checked) this._pendingOnClose.add(entry.id);
					else this._pendingOnClose.delete(entry.id);
				});
			}

			// Size once, then center once, using rAF to let Foundry finish layout
			if (!this._sizedOnce) {
				this._sizedOnce = true;
				requestAnimationFrame(() => {
					_bbmmSizeFrameOnce(frame, this);
					// Center on the next frame after sizing so we have final width/height
					requestAnimationFrame(() => _bbmmCenterFrame(frame, this));
				});
			} else if (!this._centeredOnce) {
				this._centeredOnce = true;
				requestAnimationFrame(() => _bbmmCenterFrame(frame, this));
			}

			// onClick handler
			if (this._boundRoot && this._boundRoot !== root) {
				this._boundRoot.removeEventListener("click", this._onClick);
				this._boundRoot.removeEventListener("change", this._onChange);
			}
			if (this._onClick) root.removeEventListener("click", this._onClick);
			if (this._onChange) root.removeEventListener("change", this._onChange);

			this._boundRoot = root; // remember where we wired
			this._onClick = async (ev) => {
				try {
					// Sidebar nav item
					const nav = ev.target.closest(".bbmm-nav-item");
					if (nav && root.contains(nav)) {
						const idx = Number(nav.dataset.index ?? 0);
						if (!Number.isNaN(idx) && idx >= 0 && idx < this.entries.length) {
							this._captureNavScroll(root); // preserve scroll
							this.index = idx;
							this.render(); // re-render page area
							DL(`Changelog: switched to index ${idx} (${this.entries[idx]?.id})`);
						}
						return; // handled
					}

					// Footer buttons with data-action
					const btn = ev.target.closest("[data-action]");
					if (btn && root.contains(btn)) {
						const action = btn.dataset.action;

						if (action === "mark-current") {
							const entry = this.entries[this.index];
							if (!entry) return;

							if (this._markedSeen.has(entry.id)) {
								// currently marked → unmark
								await _bbmmUnmarkChangelogSeen(entry.id);
								this._markedSeen.delete(entry.id);
								ui.notifications?.info(`Unmarked ${entry.title || entry.id} v${entry.version}`);
							} else {
								// not marked → mark
								await _bbmmMarkChangelogSeen(entry.id, entry.version);
								this._markedSeen.add(entry.id);
								this._pendingOnClose.delete(entry.id);
								ui.notifications?.info(LT.changelog.marked_seen_single({ title: entry.title || entry.id, version: entry.version }));
							}
							this._captureNavScroll(root);
							this.render();
							return;
						}

						if (action === "mark-all") {
							let allMarked = true;
							for (const e of this.entries) {
								if (!this._markedSeen.has(e.id)) { allMarked = false; break; }
							}

							if (allMarked) {
								// every entry is already marked → unmark all
								for (const e of this.entries) {
									await _bbmmUnmarkChangelogSeen(e.id);
									this._markedSeen.delete(e.id);
								}
								ui.notifications?.info(`Unmarked ${this.entries.length} changelog(s).`);
							} else {
								// mark all
								for (const e of this.entries) {
									await _bbmmMarkChangelogSeen(e.id, e.version);
									this._markedSeen.add(e.id);
									this._pendingOnClose.delete(e.id);
								}
								ui.notifications?.info(LT.changelog.marked_seen_all({ count: this.entries.length }));
							}
							this._captureNavScroll(root);
							this.render();
							return;
						}
					}
				} catch (err) {
					DL(2, `_onClick delegated handler error: ${err?.message || err}`, err);
				}
			};
			root.addEventListener("click", this._onClick);

			// change handler for the per-page checkbox
			this._onChange = (ev) => {
				try {
					if (ev.target?.name === "dontShowAgain") {
						const entry = this.entries[this.index];
						if (!entry) return;
						if (ev.target.checked) this._pendingOnClose.add(entry.id);
						else this._pendingOnClose.delete(entry.id);
					}
				} catch (err) {
					DL(2, `_onChange delegated handler error: ${err?.message || err}`, err);
				}
			};
			root.addEventListener("change", this._onChange);

		} catch (err) {
			DL(2, `_onRender (BBMMChangelogJournal) error: ${err?.message || err}`, err);
		}
	}

	/* When closing, honor "don’t show again" for the CURRENT page (optional UX). */
	async close(options) {
		try {
			// apply all pending-on-close marks
			for (const id of this._pendingOnClose) {
				const e = this.entries.find(x => x.id === id);
				if (!e) continue;
				await _bbmmMarkChangelogSeen(e.id, e.version);
				this._markedSeen.add(e.id);
			}
			this._pendingOnClose.clear();
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
	const start = performance.now();
	DL("changelog collector: starting scan");

	const seen = game.settings.get("bbmm", "seenChangelogs") || {};
	const includeDisabled = game.settings.get("bbmm", "checkDisabledModules");
	const results = [];

	try {
		for (const mod of game.modules) {
			try {
				if (!includeDisabled && !mod?.active) continue;

				const id = mod?.id ?? null;
				if (!id) continue;

				const title = mod?.title || id;
				const version = mod?.version || "0.0.0";
				const prevSeen = seen?.[id] || null;
				if (prevSeen && !foundry.utils.isNewerVersion(version, prevSeen)) continue;

				const url = await _bbmmFindChangelogURL(mod);
				if (!url) continue;

				results.push({ id, title, version, url, mod });
			} catch (errInner) {
				DL(2, `Changelog collect: skipping a module due to error: ${errInner?.message || errInner}`, errInner);
			}
		}
	} catch (err) {
		DL(2, `Changelog collect: top-level error: ${err?.message || err}`, err);
	}

	const end = performance.now();
	const ms = (end - start).toFixed(1);
	DL(`changelog collector: finished scan in ${ms}ms (found ${results.length} modules)`);

	return results;
}

/*
	Convert changelog markdown/plaintext into enriched HTML.
*/
async function _bbmmToHTML(text) {
	try {
		if (!text) return "";

		let htmlSrc = text;

		// 1) Foundry v12/v13 helper (async)
		if (TextEditor?.convertMarkdown) {
			try {
				htmlSrc = await TextEditor.convertMarkdown(text);
			} catch (_e) { /* continue */ }
		}

		// 2) Foundry’s markdown wrapper (sync)
		if (htmlSrc === text && TextEditor?.markdown?.render) {
			try {
				htmlSrc = TextEditor.markdown.render(text);
			} catch (_e) { /* continue */ }
		}

		// 3) Global marked (bundled by many FVTT versions)
		if (htmlSrc === text && window.marked?.parse) {
			try {
				htmlSrc = window.marked.parse(text);
			} catch (_e) { /* continue */ }
		}

		// 4) Minimal fallback (headings + lists + paragraphs)
		if (htmlSrc === text) {
			const esc = (s) => String(s)
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;");
			let t = esc(text);

			// headings
			t = t.replace(/^\s*######\s+(.+)$/gm, "<h6>$1</h6>")
			     .replace(/^\s*#####\s+(.+)$/gm, "<h5>$1</h5>")
			     .replace(/^\s*####\s+(.+)$/gm, "<h4>$1</h4>")
			     .replace(/^\s*###\s+(.+)$/gm, "<h3>$1</h3>")
			     .replace(/^\s*##\s+(.+)$/gm, "<h2>$1</h2>")
			     .replace(/^\s*#\s+(.+)$/gm, "<h1>$1</h1>");

			// unordered lists (simple)
			t = t.replace(/^(?:\s*[-*]\s+.+\n?)+/gmi, (block) => {
				const items = block.trim().split(/\n+/).map(l => l.replace(/^\s*[-*]\s+/, "").trim());
				return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
			});

			// paragraphs
			t = t
				.replace(/\r\n/g, "\n")
				.split(/\n{2,}/)
				.map(p => (/^<h\d|^<ul/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
				.join("");

			htmlSrc = t;
		}

		// Enrich/sanitize in Foundry
		const enriched = await TextEditor.enrichHTML(htmlSrc, {
			async: true,
			secrets: false
		});
		return String(enriched || "");
	} catch (err) {
		DL(2, "_bbmmToHTML(): error", err);
		return "";
	}
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

async function _bbmmUnmarkChangelogSeen(moduleId) {
	try {
		const seen = game.settings.get(BBMM_ID, "seenChangelogs") || {};
		if (seen[moduleId]) {
			delete seen[moduleId];
			await game.settings.set(BBMM_ID, "seenChangelogs", seen);
		}
	} catch (err) {
		DL(3, `Failed to unset seenChangelogs for ${moduleId}: ${err?.message || err}`, err);
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