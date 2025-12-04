/* BBMM — Changelog on Login ==================================================
	- Shows module changelogs to the GM on login for any modules that have
	- been updated and have a changelog file or URL.
============================================================================ */

import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_esc } from "./helpers.js";

/* ============================================================================
        {GLOBALS}
============================================================================ */
const _BBMM_DIR_CACHE = new Map(); // Cache directory listings 
const CHANGELOG_CANDIDATES = [
	"CHANGELOG.md","CHANGELOG.txt","CHANGELOG",
	"Changelog.md","Changelog.txt","Changelog",
	"changelog.md","changelog.txt","changelog",
	"docs/CHANGELOG.md","docs/Changelog.md","docs/changelog.md","docs/CHANGELOG.txt"
];

/* ============================================================================
		{ HOOK: init } 
============================================================================ */
Hooks.once("init", () => {
	try {

		// Make the window class available to macros (and other modules)
		globalThis.BBMMChangelogJournal = BBMMChangelogJournal;

		const mod = game.modules.get(BBMM_ID);
		if (!mod) return;
		mod.api ??= {};

		mod.api.openChangelogReport = async function openChangelogReport() {
			try {
				DL("changelog.js | api.openChangelogReport(): start");

				// Must be GM
				if (!game.user.isGM) {
					ui.notifications?.warn(LT?.changelog?.gm_only?.() ?? "GM only.");
					return;
				}

				// Collect updated modules with changelogs
				const entries = await _bbmmCollectUpdatedModulesWithChangelogs();
				if (!entries.length) {
					ui.notifications?.info(LT.changelog.noneFound());
					return;
				}

				// Preload text + HTML (same as ready)
				for (const e of entries) {
					e.text = await _bbmmFetchChangelogText(e.url);
					e.html = await _bbmmRenderMarkdownOnly(e.text);
				}
				// Filter out empty texts
				const nonEmpty = entries.filter(e => (e.text && e.text.trim().length));
				if (!nonEmpty.length) {
					ui.notifications?.info(LT.changelog.noneFound());
					return;
				}

				DL(`changelog.js | api.openChangelogReport(): opening with ${nonEmpty.length} module(s)`);
				new BBMMChangelogJournal(nonEmpty).render(true); 
			} catch (err) {
				DL(3, `changelog.js | api.openChangelogReport(): ${err?.message || err}`, err);
				ui.notifications?.error("Failed to open BBMM Changelog Report. See console for details.");
			}
		};

		// Hook to open from menu
		Hooks.on("bbmm:openChangelogReport", () => {
			try { mod.api?.openChangelogReport?.(); }
			catch (err) { DL(3, `changelog.js | openChangelogReport hook error: ${err?.message || err}`, err); }
		});

		DL("changelog.js | API exposed: api.openChangelogReport()");
	} catch (err) {
		DL(2, `changelog.js | expose API failed: ${err?.message || err}`, err);
	}
});

/* ============================================================================
		{ HOOK: ready } 
============================================================================ */
Hooks.once("ready", async () => {

	try {

		
		const meta = game.settings.settings.get(`${BBMM_ID}.seenChangelogs`); 
		DL(`changelog.js | seenChangelogs schema: type=${meta?.type?.name}, default=${JSON.stringify(meta?.default)}`);

		try {

			const start = performance.now();
			DL("changelog.js |  changelog ready: starting");

			// Must be GM + setting enabled
			if (!game.user.isGM) return;
			const showOnLogin = game.settings.get(BBMM_ID, "showChangelogsOnLogin"); 
			if (!showOnLogin) return;

			const entries = await _bbmmCollectUpdatedModulesWithChangelogs();
			if (!entries.length) return; // none found

			// Preload all texts so paging is instant
			for (const e of entries) {
				e.text = await _bbmmFetchChangelogText(e.url);	// raw markdown
				e.html = await _bbmmRenderMarkdownOnly(e.text);	// Markdown -> HTML (no enrich)
			}

			const nonEmpty = entries.filter(e => (e.text && e.text.trim().length));
			if (!nonEmpty.length) return;
			DL(`changelog.js | Changelog: opening journal with ${nonEmpty.length} module(s).`);
			new BBMMChangelogJournal(nonEmpty).render(true);

			const end = performance.now();
			const ms = (end - start).toFixed(1);
			DL(`changelog.js | changelog ready: finished in ${ms}ms`);

		} catch (err) {
			DL(3, `changelog.js | Changelog ready hook error: ${err?.message || err}`, err);
		}
		
	} catch (err) {
		DL(2, "changelog.js | BBMM init version gate failed", err);
	}
	
});

/* ============================================================================
	List files in /modules/<id>/ and optionally /modules/<id>/docs/ 
============================================================================ */
async function _bbmmListModuleFilesCached(modId) {
	// Use cached if present
	if (_BBMM_DIR_CACHE.has(modId)) return _BBMM_DIR_CACHE.get(modId);

	const found = new Set();

	try {
		const FP = foundry?.applications?.apps?.FilePicker?.implementation;
		if (!FP) {
			DL(3, "changelog.js | _bbmmListModuleFilesCached: FilePicker implementation not found");
			return;
		}

		// Root listing
		const rootPath = `modules/${modId}/`;
		const root = await FP.browse("data", rootPath);
		for (const f of root.files) {
			const name = f.split("/").pop();
			if (name) found.add(name);
		}

		// If a docs/ folder exists, browse it once
		const hasDocsDir = root.dirs?.some(d => d.endsWith(`/modules/${modId}/docs`)) ?? false;
		if (hasDocsDir) {
			const docs = await FP.browse("data", `${rootPath}docs/`);
			for (const f of docs.files) {
				const name = f.split("/").pop();
				if (name) found.add(`docs/${name}`);
			}
		}
	} catch (err) {
		DL(2, `changelog.js | _bbmmListModuleFilesCached: browse failed for ${modId}: ${err?.message || err}`);
	}

	_BBMM_DIR_CACHE.set(modId, found);
	return found;
}

/* ============================================================================
	Resize changelog based on canvas resolution 
============================================================================ */
function _bbmmSizeFrameOnce(frame, app) {
	try {
		// Viewport (prefer visual viewport if present)
		const vw = window?.visualViewport?.width ?? window?.innerWidth ?? 1280;
		const vh = window?.visualViewport?.height ?? window?.innerHeight ?? 900;

		// Margins
		const marginW = 40;
		const marginH = 60;

		// Caps (from constructor or defaults)
		const MIN_W = Number(app?._MIN_W ?? 480);
		const MAX_W = Number(app?._MAX_W ?? 1200);

		// Base sizes
		const baseW = Math.max(MIN_W, Math.min(MAX_W, Number(app?._baseW ?? 900)));
		const baseH = Math.max(400, Number(app?._baseH ?? 640));

		// Width: clamp to viewport and max cap
		const usableW = Math.max(MIN_W, vw - marginW);
		const w = Math.max(MIN_W, Math.min(MAX_W, Math.min(baseW, usableW)));

		// Height: clamp to 75% of viewport (minus margins)
		const capH = Math.max(400, Math.floor(vh * 0.75) - marginH);
		const h = Math.min(Math.max(baseH, 400), capH);

		// Apply to inner frame
		frame.style.width = `${w}px`;
		frame.style.height = `${h}px`;
		frame.style.maxWidth = `${MAX_W}px`;
		frame.style.maxHeight = `calc(75vh - ${marginH}px)`;
		frame.style.overflow = "hidden";

		// Also clamp the outer window (in case a saved size restores)
		const win = frame.closest?.(".window-app#bbmm-changelog-journal");
		if (win) {
			win.style.maxHeight = "75vh";
		}

		DL(`_bbmmSizeFrameOnce(): final=${w}x${h}, capH=${capH}, vw=${vw}, vh=${vh}`);
	} catch (err) {
		DL(3, `changelog.js | _bbmmSizeFrameOnce error: ${err?.message || err}`, err);
	}
}


/* ============================================================================
	Convert basic subset of Markdown to HTML
	- Headers (#, ##, ###, etc)
	- Bullet lists (-, *, + with indents)
	- Bold (**text** or __text__)
	- Italics (*text* or _text_)
	- Inline code (`code`)
	- Links ([label](https://url) and <https://url>)
============================================================================ */
function _bbmmMarkdownToHtml(md) {
	try {
		
		function inlineToHtml(text) {
				/* ==========================================================================
				Order matters:
				1) Protect code spans
				2) Apply emphasis (** / *)
				3) Convert markdown links & autolinks
				4) Escape remaining non-tag text
 				============================================================================*/
			const escHTML = hlp_esc;
			const escAttr = hlp_esc;

			// 1) Split by backticks -> protect code segments
			const parts = String(text ?? "").split(/`/);

			for (let i = 0; i < parts.length; i++) {
				// odd indexes are code; even are normal text
				if (i % 2 === 1) {
					parts[i] = `<code>${escHTML(parts[i])}</code>`;
					continue;
				}

				let seg = parts[i];

				// 2) Emphasis — do bold first, then italics (avoid overlapping)
				seg = seg.replace(/\*\*([^*]+?)\*\*/g, (_m, t) => `<strong>${escHTML(t)}</strong>`);
				seg = seg.replace(/\*([^*]+?)\*/g,       (_m, t) => `<em>${escHTML(t)}</em>`);
				seg = seg.replace(/__([^_]+?)__/g,       (_m, t) => `<strong>${escHTML(t)}</strong>`);
				seg = seg.replace(/_([^_]+?)_/g,         (_m, t) => `<em>${escHTML(t)}</em>`);

				// 3) Markdown links: [label](https://url) — format label with emphasis already applied
				seg = seg.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => {
					// label may already contain <strong>/<em>; do NOT escape tags, only attributes
					return `<a href="${escAttr(url)}">${label}</a>`;
				});

				// Autolink: <https://url>
				seg = seg.replace(/<\s*(https?:\/\/[^>\s]+)\s*>/g, (_m, url) => {
					return `<a href="${escAttr(url)}">${escHTML(url)}</a>`;
				});

				// 4) Escape any remaining text that isn't a tag
				const chunks = seg.split(/(<\/?[^>]+>)/g);
				for (let j = 0; j < chunks.length; j++) {
					if (!chunks[j]) continue;
					if (chunks[j].startsWith("<")) continue; // keep tags we just added
					chunks[j] = escHTML(chunks[j]);
				}
				parts[i] = chunks.join("");
			}

			return parts.join("");
		}

		const lines = String(md ?? "").split(/\r?\n/);
		let html = "";
		let listStack = [];	
		const openList  = () => { html += "<ul>\n"; listStack.push(true); };
		const closeList = () => { html += "</ul>\n"; listStack.pop(); };

		for (let raw of lines) {
			const line = String(raw ?? "");

			// Headers
			const hm = line.match(/^(#{1,6})\s+(.*)$/);
			if (hm) {
				while (listStack.length) closeList();
				const lvl = Math.min(6, hm[1].length);
				html += `<h${lvl}>${inlineToHtml(hm[2])}</h${lvl}>\n`;
				continue;
			}

			// Bullet list item with indent (4 spaces per level)
			const lm = line.match(/^(\s*)[-*+]\s+(.*)$/);
			if (lm) {
				const indentSpaces = lm[1].replace(/\t/g, "    ").length;
				// Support common styles:
				// - 0 spaces  -> level 1
				// - 2–5 spaces -> level 2
				// - 6–9 spaces -> level 3
				// …then every +4 spaces
				let level = 1;
				if (indentSpaces >= 2) level = 2 + Math.floor((indentSpaces - 2) / 4);

				while (listStack.length < level) openList();
				while (listStack.length > level) closeList();

				html += `\t<li>${inlineToHtml(lm[2])}</li>\n`;
				continue;
			}

			// Blank line = separator
			if (!line.trim().length) continue;

			// Paragraph line
			while (listStack.length) closeList();
			html += `<p>${inlineToHtml(line)}</p>\n`;
		}

		while (listStack.length) closeList();
		return html;
	} catch (err) {
		DL(2, `changelog.js | _bbmmMarkdownToHtml(): ${err?.message || err}`, err);
		return foundry?.utils?.escapeHTML ? foundry.utils.escapeHTML(String(md ?? "")) : String(md ?? "");
	}
}

// Helper: Render Markdown
async function _bbmmRenderMarkdownOnly(md) {
	try {

		// If TextEditor.enrichHTML exists, use it
		const htmlFromMd = _bbmmMarkdownToHtml(String(md ?? ""));
		const TE = foundry?.applications?.ux?.TextEditor?.implementation;
		if (TE?.enrichHTML) {
			const enriched = await TE.enrichHTML(htmlFromMd, {
				secrets: false,
				documents: false,
				links: true,
				rolls: false,
				smallSecrets: false,
				async: true
			});
			return enriched;
		}
		return htmlFromMd;
	} catch (err) {
		DL(2, `changelog.js | _bbmmRenderMarkdownOnly(): error ${err?.message || err}`, err);
		// Last resort: plain local conversion
		return _bbmmMarkdownToHtml(md);
	}
}

/* Main Workflow ============================================================ */
class BBMMChangelogJournal extends foundry.applications.api.ApplicationV2 {
	constructor(entries) {
		const MIN_W = 480;
		const MAX_W = 1200;
		const MARGIN = 80;

		const vvW = (window?.visualViewport?.width ?? window?.innerWidth ?? MAX_W) - MARGIN;
		const startW = Math.max(MIN_W, Math.min(MAX_W, vvW));

		const _vh = (window?.visualViewport?.height ?? window?.innerHeight ?? 900);
		const _height = _vh < 800 ? 500 : 640;

		super({
			id: "bbmm-changelog-journal",
			window: { title: LT.changelog.window_title(), modal: true },
			width: startW,
			minWidth: MIN_W,
			height: _height,
			resizable: false,
			classes: ["bbmm-changelog-journal"]
		});

		this._MIN_W = MIN_W;
		this._MAX_W = MAX_W;

		// Keep base modest so sizer won't re-widen above the cap
		this._baseW = Math.max(MIN_W, Math.min(MAX_W, 900));
		this._baseH = _height;

		this.entries = Array.isArray(entries) ? entries : [];
		this.index = 0;

		this._markedSeen = new Set();
		this._pendingOnClose = new Set();

		this._sizedOnce = false;
		this._centeredOnce = false;

		DL("BBMMChangelogJournal(): init", { startW, MIN_W, MAX_W });
	}

	/* ============================================================================
			{HELPERS}
	============================================================================ */
	_cleanHref(html) {
		try {
			const wrap = document.createElement("div");
			wrap.innerHTML = String(html ?? "");

			for (const a of wrap.querySelectorAll("a[href]")) {
				let href = a.getAttribute("href") || "";

				// trim whitespace & stray quotes at the end
				href = href.replace(/[\s"'”’]+$/g, "");

				// drop trailing punctuation that should not be in a URL
				// (commas/closing parens/periods/semicolons/colons)
				href = href.replace(/[),.;:]+$/g, "");

				// write back + ensure safe link attrs
				a.setAttribute("href", href);
				a.setAttribute("target", "_blank");
				a.setAttribute("rel", "nofollow noopener");
			}
			return wrap.innerHTML;
		} catch (err) {
			DL(2, `changelog.js | _cleanHrefGarbage(): ${err?.message || err}`, err);
			return String(html ?? "");
		}
	}

	/* ============================================================================
		Replaces the leading "[label](" 
		with "(" and injects {label} between > and </a>
	============================================================================ */
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

			// "(<a ...>Label</a> )" -> "(<a ...>Label</a>)"
			s = s.replace(/\(<a\b([^>]*)>([\s\S]*?)<\/a>\s+\)/gi, "(<a $1>$2</a>)");

			DL(`changelog.js | _fixMdWrappedEmptyAnchors(): applied`);
			return s;
		} catch (err) {
			DL(2, `changelog.js | _fixMdWrappedEmptyAnchors(): ${err?.message || err}`, err);
			return String(html ?? "");
		}
	}

	// Preserve left-nav scroll across re-renders
	_captureNavScroll(root) {
		try {
			const sc = root?.querySelector?.(".bbmm-nav-scroll");
			this._navScrollTop = sc ? sc.scrollTop : 0;
			DL(`changelog.js | captured nav scrollTop=${this._navScrollTop}`);
		} catch (err) {
			DL(2, `changelog.js | _captureNavScroll(): ${err?.message || err}`, err);
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
		} catch (err) {
			DL(2, `changelog.js | _restoreNavScroll(): ${err?.message || err}`, err);
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

		// Prefer the prebuilt HTML (from ready hook); else fall back to raw text
		let enrichedBody = "";
		try {
			let out = current.html ?? (current.text ?? current.body ?? current.markdown ?? "");
			// Final link tidy
			out = this._cleanHref(out);
			out = this._fixMdWrappedEmptyAnchors(out);
			enrichedBody = out;
		} catch (err) {
			DL(2, `changelog.js | _renderHTML(): build body failed: ${err?.message || err}`, err);
			enrichedBody = current.html ?? current.text ?? "";
		}

		// compose the full view
		const content = `
			<section class="bbmm-shell bbmm-changelog bbmm-changelog-journal"
				style="display:flex;gap:.75rem;min-height:0;height:100%;width:100%;min-width:0;">

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
				DL(2, "changelog.js | _replaceHTML: no root element available");
				return;
			}

			if (typeof html === "string") {
				root.innerHTML = html;
			} else if (html instanceof HTMLElement || html instanceof DocumentFragment) {
				root.replaceChildren(html);
			} else {
				DL(2, "changelog.js | _replaceHTML: unexpected html payload type");
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
			DL(2, `changelog.js | _replaceHTML error: ${err?.message || err}`, err);
		}
	}

	_onRender(html) {
		try {
			const root = (html instanceof HTMLElement) ? html : this.element;
			if (!root) {
				DL(2, "changelog.js | _onRender: missing root element");
				return;
			}

			const frame = (root.closest?.(".app, .window-app")) || root.parentElement;
			if (frame) {
				// lock a minimum width
				frame.style.minWidth = "900px";
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

			this._boundRoot = root; 
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
							DL(`changelog.js | switched to index ${idx} (${this.entries[idx]?.id})`);
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
								// currently marked -> unmark
								await _bbmmUnmarkChangelogSeen(entry.id);
								this._markedSeen.delete(entry.id);
								ui.notifications?.info(`Unmarked ${entry.title || entry.id} v${entry.version}`);
							} else {
								// not marked -> mark
								await _bbmmMarkChangelogSeen(entry.id, entry.version);
								this._markedSeen.add(entry.id);
								this._pendingOnClose.delete(entry.id);
								ui.notifications?.info(
									LT.changelog.marked_seen_single({
										title: entry.title || entry.id,
										version: entry.version
									})
								);

								// After marking current as read, move to the next unread entry (if any).
								let nextIndex = -1;

								// First, look forward from the current index
								for (let i = this.index + 1; i < this.entries.length; i++) {
									const e = this.entries[i];
									if (e && !this._markedSeen.has(e.id)) {
										nextIndex = i;
										break;
									}
								}

								// If none ahead, wrap around and look from the start up to the current index
								if (nextIndex === -1) {
									for (let i = 0; i < this.index; i++) {
										const e = this.entries[i];
										if (e && !this._markedSeen.has(e.id)) {
											nextIndex = i;
											break;
										}
									}
								}

								// Only move if there is at least one unread entry
								if (nextIndex !== -1) {
									this.index = nextIndex;
								}
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
								// every entry is already marked -> unmark all
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
					DL(2, `changelog.js | _onClick delegated handler error: ${err?.message || err}`, err);
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
					DL(2, `changelog.js | _onChange delegated handler error: ${err?.message || err}`, err);
				}
			};
			root.addEventListener("change", this._onChange);

		} catch (err) {
			DL(2, `changelog.js | _onRender (BBMMChangelogJournal) error: ${err?.message || err}`, err);
		}
	}

	// When closing, honor "don’t show again" for the CURRENT page
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
			DL(2, `changelog.js | close() auto-mark error: ${err?.message || err}`, err);
		}
		return super.close(options);
	}
}

/* ============================================================================
	{HELPER}
	Center the app window without changing its size.
============================================================================ */
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
		DL(2, `changelog.js |  _bbmmCenterFrame error: ${err?.message || err}`, err);
	}
}

/* ============================================================================
	{HELPER}
	Scan all modules for new/updated changelogs since last seen
============================================================================ */
async function _bbmmCollectUpdatedModulesWithChangelogs() {
	const start = performance.now();
	DL("changelog.js |  changelog collector: starting scan");

	const seen = game.settings.get(BBMM_ID, "seenChangelogs") || {}; 
	const includeDisabled = game.settings.get(BBMM_ID, "checkDisabledModules");
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
				DL(2, `changelog.js |  Changelog collect: skipping a module due to error: ${errInner?.message || errInner}`, errInner);
			}
		}
	} catch (err) {
		DL(2, `changelog.js |  Changelog collect: top-level error: ${err?.message || err}`, err);
	}

	const end = performance.now();
	const ms = (end - start).toFixed(1);
	DL(`changelog.js |  changelog collector: finished scan in ${ms}ms (found ${results.length} modules)`);

	return results;
}

/* ============================================================================
	{HELPER}
	Fetch Changelogs URL
============================================================================ */
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
		DL(2, `changelog.js |  _bbmmFindChangelogURL (local-only) failed for ${mod.id}: ${err?.message || err}`);
	}
	return null; // never fall back to remote
}

/* ============================================================================
	{HELPER}
	Fetch Changelogs Text
============================================================================ */
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

/* ============================================================================
	{UI}
	Dialog 
============================================================================ */
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
				<span>${LT.changelog.dontShowAgain()}</span>
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
							DL(`changelog.js | marked seen for ${id} -> ${version}`);
						} catch (err) {
							DL(3, `changelog.js | Mark seen failed for ${id}: ${err?.message || err}`, err);
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
								DL(3, `changelog.js | Mark seen (from 'Don't show again') failed for ${id}: ${err?.message || err}`, err);
							});
						}
					}
				}
			]
		}).render(true);
		resolve();
	});
}

/* ============================================================================
	{HELPER}
	Mark Changelog seen
============================================================================ */	
async function _bbmmMarkChangelogSeen(moduleId, version) {
	try {
		const seen = game.settings.get(BBMM_ID, "seenChangelogs") || {};
		seen[moduleId] = version;
		await game.settings.set(BBMM_ID, "seenChangelogs", seen);
		const verify = game.settings.get(BBMM_ID, "seenChangelogs") || {};
		DL(`changelog.js | seenChangelogs updated: ${moduleId} -> ${version}`, verify);
	} catch (err) {
		DL(3, `changelog.js | Failed to update seenChangelogs for ${moduleId}: ${err?.message || err}`, err);
		throw err;
	}
}

/* ============================================================================
	{HELPER}
	Unmark Changelog seen
============================================================================ */
async function _bbmmUnmarkChangelogSeen(moduleId) {
	try {
		const seen = game.settings.get(BBMM_ID, "seenChangelogs") || {};
		if (Object.prototype.hasOwnProperty.call(seen, moduleId)) {
			delete seen[moduleId];
			await game.settings.set(BBMM_ID, "seenChangelogs", seen);
		}
		const verify = game.settings.get(BBMM_ID, "seenChangelogs") || {};
		DL(`changelog.js | seenChangelogs updated (removed): ${moduleId}`, verify);
		return true;
	} catch (err) {
		DL(3, `changelog.js | Failed to unset seenChangelogs for ${moduleId}: ${err?.message || err}`, err);
		return false;
	}
}

/* ============================================================================
	{HELPER}
	manually open a specific module's changelog
============================================================================ */
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
		DL(3, `changelog.js | BBMM_openChangelogFor() error: ${err?.message || err}`, err);
	}
}