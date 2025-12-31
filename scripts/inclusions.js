/* BBMM Inclusions (Hidden Settings) =========================================
	- Lets GM include specific *hidden* settings (config:false) in preset saves
	- Mirrors the UX of exclusions manager but scoped to settings-only
	- Persistent storage: modules/bbmm/storage/lists/user-inclusions.json
============================================================================ */

import { DL, BBMM_README_UUID  } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";
import { getSkipMap, isExcludedWith, hlp_injectHeaderHelpButton } from './helpers.js';
import { copyPlainText } from "./macros.js";


// CONSTANTS / PLACEHOLDERS ===================================================
/* Menu -> Setting expansion (so presets include real settings) */
const MENU_TO_SETTINGS = {
	"core.fonts": () => ["core.fonts"],
	"core.webrtc": () => ["core.rtcClientSettings", "core.rtcWorldSettings"],
	"core.prototypeTokenOverrides": () => ["core.prototypeTokenOverrides"]
};

// Persistent storage (lists)
const LISTS_SUBDIR = "lists";
const FILE_USER_INCLUSIONS = "user-inclusions.json";

let _incCache = null;
let _incCacheLoaded = false;


/* ============================================================================
	{HELPERS}
============================================================================ */

// Sanitize inclusion object
function _sanitizeInclusions(raw) {
	const out = { settings: [], modules: [] };
	if (!raw || typeof raw !== "object") return out;

	if (Array.isArray(raw.settings)) {
		out.settings = raw.settings
			.filter(s => s && typeof s === "object")
			.map(s => ({
				namespace: String(s.namespace ?? "").trim(),
				key: String(s.key ?? "").trim()
			}))
			.filter(s => s.namespace && s.key);
	}

	if (Array.isArray(raw.modules)) {
		out.modules = raw.modules
			.filter(x => typeof x === "string")
			.map(x => x.trim())
			.filter(Boolean);
	}

	return out;
}

// Get storage URL for user inclusions file
function _inclusionsStorageUrl() {
	return `modules/${BBMM_ID}/storage/${LISTS_SUBDIR}/${FILE_USER_INCLUSIONS}`;
}

// Read user inclusions from storage (with caching)
async function hlp_readUserInclusions({ force = false } = {}) {
	if (!force && _incCacheLoaded && _incCache) return _incCache;

	const url = _inclusionsStorageUrl();

	try {
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) {
			DL(2, `inclusions.js | hlp_readUserInclusions(): fetch not ok (${res.status})`, { url });
			_incCache = _sanitizeInclusions(null);
			_incCacheLoaded = true;
			return _incCache;
		}

		const data = await res.json();
		_incCache = _sanitizeInclusions(data);
		_incCacheLoaded = true;

		DL("inclusions.js | hlp_readUserInclusions(): loaded", {
			settings: _incCache.settings.length,
			modules: _incCache.modules.length
		});

		return _incCache;
	} catch (err) {
		DL(2, "inclusions.js | hlp_readUserInclusions(): failed, using empty", err);
		_incCache = _sanitizeInclusions(null);
		_incCacheLoaded = true;
		return _incCache;
	}
}

// Write user inclusions to storage
async function hlp_writeUserInclusions(obj) {
	const clean = _sanitizeInclusions(obj);
	const payload = JSON.stringify(clean ?? { settings: [], modules: [] }, null, 2);
	const file = new File([payload], FILE_USER_INCLUSIONS, { type: "application/json" });

	try {
		const res = await FilePicker.uploadPersistent(BBMM_ID, LISTS_SUBDIR, file, {}, { notify: false });
		if (!res || (!res.path && !res.url)) {
			DL(3, `inclusions.js | hlp_writeUserInclusions(): upload returned no path/url`, res);
			return false;
		}

		_incCache = clean;
		_incCacheLoaded = true;

		DL("inclusions.js | hlp_writeUserInclusions(): wrote", {
			settings: clean.settings.length,
			modules: clean.modules.length
		});

		return true;
	} catch (err) {
		DL(3, "inclusions.js | hlp_writeUserInclusions(): uploadPersistent failed", err);
		return false;
	}
}

// Given a menu namespace+key, return an array of {namespace,key} pairs for real settings
async function _resolveMenuIdsToPairs(menuNs, menuKey) {
	const id = `${menuNs}.${menuKey}`;
	const fn = MENU_TO_SETTINGS[id];
	if (typeof fn !== "function") return [];
	const ids = (fn() || []).filter((sid) => game.settings.settings.has(sid));
	return ids.map((sid) => {
		const d = sid.indexOf(".");
		return { namespace: sid.slice(0, d), key: sid.slice(d + 1) };
	});
}

/* BBMMAddSettingInclusionAppV2 ===============================================
	Add Setting Inclusion (hidden settings only)
============================================================================ */
class BBMMAddSettingInclusionAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-inclusions-add-setting",
			window: { title: LT.inclusions.title() },
			width: 980,
			height: 600,
			resizable: true,
			classes: ["bbmm-inclusions-app"]
		});

		this._rows = [];

		// UI state
		this._filterText = "";
		this._moduleFilter = ""; // "" = none selected
		this._delegated = false;

		// Require selecting a module before showing any settings
		this._requireModuleSelection = true;

		// Debounce
		this._debounceMs = 250;
		this._debounceT = null;

		// Preview warming
		this._warmTimer = null;
		this._warmRunning = false;
	}


	/* ============================================================================
		{DATA HELPERS}
	============================================================================ */

	// Convert value to single-line preview
	_toPreview(v) {
		try {
			if (v === undefined) return "undefined";
			if (v === null) return "null";
			if (typeof v === "string") return v;
			if (typeof v === "number" || typeof v === "boolean") return String(v);
			return JSON.stringify(v);
		} catch {
			return String(v);
		}
	}

	// Pretty-print value
	_toPretty(v) {
		try {
			if (typeof v === "string") {
				try { return JSON.stringify(JSON.parse(v), null, 2); }
				catch { return v; }
			}
			return JSON.stringify(v, null, 2);
		} catch {
			return String(v);
		}
	}

	// Build list of modules present in current rows
	_buildModuleList() {
		const map = new Map();
		for (const r of this._rows || []) {
			if (!r?.ns) continue;
			if (!map.has(r.ns)) map.set(r.ns, r.nsLabel || r.ns);
		}
		return Array.from(map.entries())
			.map(([ns, title]) => ({ ns, title }))
			.sort((a, b) => a.title.localeCompare(b.title, game.i18n.lang || undefined, { sensitivity: "base" }));
	}

	// Check if a row matches current filter state
	_matchesFilter(r) {
		const mod = String(this._moduleFilter ?? "").trim();

		if (this._requireModuleSelection && !mod) return false;
		if (mod && r.ns !== mod) return false;

		const q = String(this._filterText ?? "").trim().toLowerCase();
		if (!q) return true;

		return (
			String(r.nsLabel ?? "").toLowerCase().includes(q) ||
			String(r.ns ?? "").toLowerCase().includes(q) ||
			String(r.label ?? "").toLowerCase().includes(q) ||
			String(r.key ?? "").toLowerCase().includes(q) ||
			String(r.scope ?? "").toLowerCase().includes(q) ||
			String(r.__preview ?? "").toLowerCase().includes(q)
		);
	}

	// Apply current filter state to DOM
	_applyFilterToDOM() {
		const body = this.element?.querySelector?.("#bbmm-ai-body");
		if (!body) return;

		const countEl = this.element.querySelector("#bbmm-ai-count");
		const totalEl = this.element.querySelector("#bbmm-ai-total");

		const mod = String(this._moduleFilter ?? "").trim();
		const requireMod = !!this._requireModuleSelection;

		let shown = 0;
		let total = 0;

		let emptyEl = body.querySelector(".bbmm-empty");
		if (!emptyEl) {
			emptyEl = document.createElement("div");
			emptyEl.className = "bbmm-empty";
			emptyEl.style.padding = "14px";
			emptyEl.style.opacity = "0.8";
			emptyEl.style.textAlign = "center";
			emptyEl.style.display = "none";
			emptyEl.textContent = LT.macro.selectModuleToViewSettings();
			body.prepend(emptyEl);
		}

		if (requireMod && !mod) {
			for (const rowEl of body.querySelectorAll(".row")) {
				rowEl.style.display = "none";
			}
			emptyEl.style.display = "";
			if (countEl) countEl.textContent = "0";
			if (totalEl) totalEl.textContent = String((this._rows || []).length);
			return;
		}

		emptyEl.style.display = "none";

		for (const r of this._rows || []) {
			total++;

			const sel = `.row[data-ns="${CSS.escape(r.ns)}"][data-key="${CSS.escape(r.key)}"]`;
			const rowEl = body.querySelector(sel);
			if (!rowEl) continue;

			const ok = this._matchesFilter(r);
			rowEl.style.display = ok ? "" : "none";
			if (ok) shown++;
		}

		if (countEl) countEl.textContent = String(shown);
		if (totalEl) totalEl.textContent = String(total);
	}

	// Warm visible previews (CALL #2)
	_warmVisiblePreviews(limitPerTick = 50) {
		if (this._warmRunning) return;

		const body = this.element?.querySelector?.("#bbmm-ai-body");
		if (!body) return;

		const mod = String(this._moduleFilter ?? "").trim();
		if (this._requireModuleSelection && !mod) return;

		this._warmRunning = true;

		const toLoad = [];
		for (const r of this._rows || []) {
			if (r.__isMenu) continue;
			if (r.__valLoaded) continue;
			if (!this._matchesFilter(r)) continue;
			if (mod && r.ns !== mod) continue;
			toLoad.push(r);
		}

		if (!toLoad.length) {
			this._warmRunning = false;
			return;
		}

		DL(`inclusions.js | BBMMAddSettingInclusionAppV2._warmVisiblePreviews(): warming ${toLoad.length} previews`);

		let idx = 0;

		const tick = () => {
			const end = Math.min(idx + limitPerTick, toLoad.length);

			for (; idx < end; idx++) {
				const r = toLoad[idx];

				try {
					const v = game.settings.get(r.ns, r.key);
					r.__value = v;
					r.__preview = this._toPreview(v);
					r.__pretty = this._toPretty(v);
					r.__valLoaded = true;

					const sel = `.row[data-ns="${CSS.escape(r.ns)}"][data-key="${CSS.escape(r.key)}"] .val-preview code`;
					const codeEl = body.querySelector(sel);
					if (codeEl) {
						codeEl.textContent = r.__preview;
						codeEl.title = r.__preview;
					}
				} catch (e) {
					r.__value = undefined;
					r.__preview = "error";
					r.__pretty = "error";
					r.__valLoaded = true;
					DL(2, "inclusions.js | BBMMAddSettingInclusionAppV2._warmVisiblePreviews(): value read failed", { ns: r.ns, key: r.key, err: e });
				}
			}

			if (idx < toLoad.length) {
				this._warmTimer = setTimeout(tick, 0);
				return;
			}

			this._warmRunning = false;
			this._warmTimer = null;
			DL("inclusions.js | BBMMAddSettingInclusionAppV2._warmVisiblePreviews(): done");
		};

		tick();
	}

	// Render header row
	_renderHeader() {
		return (
			`<div class="h c-mod">${LT.module()}</div>
			<div class="h c-key">${LT.setting()}</div>
			<div class="h c-scope">${LT.scope()}</div>
			<div class="h c-val">${LT.macro.value()}</div>
			<div class="h c-act"></div>`
		);
	}

	// Render a single row
	_rowHTML(r) {
		const ns = String(r.ns ?? "");
		const key = String(r.key ?? "");
		const pairTitle = `${ns}.${key}`;
		const preview = foundry.utils.escapeHTML(String(r.__preview ?? ""));

		return `
			<div class="row" data-ns="${foundry.utils.escapeHTML(ns)}" data-key="${foundry.utils.escapeHTML(key)}">
				<div class="c-mod" title="${foundry.utils.escapeHTML(ns)}">${foundry.utils.escapeHTML(String(r.nsLabel ?? ns))}</div>
				<div class="c-key" title="${foundry.utils.escapeHTML(pairTitle)}">${foundry.utils.escapeHTML(String(r.label ?? key))}</div>
				<div class="c-scope" title="${foundry.utils.escapeHTML(String(r.scope ?? ""))}">${foundry.utils.escapeHTML(String(r.scope ?? ""))}</div>

				<div class="c-val">
					<div class="val-preview" title="${preview}"><code>${preview}</code></div>
					<div class="val-expand">
						<div class="val-toolbar">
							<button type="button" class="btn-copy">${LT.macro.copy()}</button>
							<button type="button" class="btn-collapse">${LT.macro.collapse()}</button>
						</div>
						<pre class="val-pre" data-loaded="0"></pre>
					</div>
				</div>

				<div class="c-act">
					<button type="button" class="bbmm-inc-act" data-ns="${foundry.utils.escapeHTML(ns)}" data-key="${foundry.utils.escapeHTML(key)}">${LT.inclusions.include()}</button>
				</div>
			</div>
		`;
	}

	// Get currently included setting pairs as a Set of "namespace::key" strings
	_getIncludedPairsSet() {
		const inc = this._incData || { settings: [] };
		const arr = Array.isArray(inc.settings) ? inc.settings : [];
		return new Set(arr.map(s => `${s?.namespace ?? ""}::${s?.key ?? ""}`));
	}

	// Collect all hidden settings that are includable
	_collectSettings() {
		try {
			const skipMap = getSkipMap();
			const included = this._getIncludedPairsSet();
			const rows = [];

			// Diagnostics: tally reasons per namespace
			const stats = new Map(); // ns -> { hiddenTotal, skippedSkipNs, skippedSkipKey, skippedIncluded, added }
			const bump = (ns, k) => {
				let s = stats.get(ns);
				if (!s) {
					s = { hiddenTotal: 0, skippedSkipNs: 0, skippedSkipKey: 0, skippedIncluded: 0, added: 0 };
					stats.set(ns, s);
				}
				s[k] = (s[k] || 0) + 1;
			};

			// Optional: dump skipMap keys once (useful when you swear it isn't in the list)
			try {
				const keys = Array.from(skipMap?.keys?.() ?? []);
				DL("inclusions.js | AddSetting._collectSettings(): skipMap namespaces", { count: keys.length, keys });
			} catch (eDump) {
				DL(2, "inclusions.js | AddSetting._collectSettings(): skipMap dump failed", eDump);
			}

			for (const [, entry] of game.settings.settings.entries()) {
				try {
					const ns = String(entry?.namespace ?? "").trim();
					const key = String(entry?.key ?? "").trim();
					if (!ns || !key) continue;

					// Skip menu placeholders 
					// Menus show up as "[menu]" and are not real setting values, 
					// so they are excluded from the Add Setting UI.
					if (entry?.__isMenu) continue;

					// Only HIDDEN settings (config:false)
					if (entry?.config !== false) continue;

					bump(ns, "hiddenTotal");

					// Skip map checks
					const skipNs = isExcludedWith(skipMap, ns);
					if (skipNs) {
						bump(ns, "skippedSkipNs");
						continue;
					}

					const skipKey = isExcludedWith(skipMap, ns, key);
					if (skipKey) {
						bump(ns, "skippedSkipKey");
						continue;
					}

					// Skip already included
					if (included.has(`${ns}::${key}`)) {
						bump(ns, "skippedIncluded");
						continue;
					}

					// Labels
					const mod = game.modules.get(ns);
					const nsLabel = String(mod?.title ?? ns);
					const rawName = entry?.name ?? "";
					const label = rawName ? game.i18n.localize(String(rawName)) : key;
					const scope = String(entry?.scope ?? "");

					rows.push({
						ns,
						key,
						nsLabel,
						label,
						scope,

						// Lazy value (loaded only when visible)
						__value: undefined,
						__preview: "",
						__pretty: "",
						__valLoaded: false
					});

					bump(ns, "added");
				} catch (e1) {
					DL(2, "inclusions.js | AddSetting._collectSettings(): item failed", e1);
				}
			}

			// Sort by module label then setting label
			rows.sort((a, b) =>
				a.nsLabel.localeCompare(b.nsLabel, game.i18n.lang || undefined, { sensitivity: "base" }) ||
				a.label.localeCompare(b.label, game.i18n.lang || undefined, { sensitivity: "base" })
			);

			this._rows = rows;
			DL("inclusions.js | AddSetting._collectSettings(): built", { count: rows.length });

			// Diagnostics: specifically report namespaces with hidden settings but zero added rows
			try {
				const interesting = [];
				for (const [ns, s] of stats.entries()) {
					if ((s.hiddenTotal || 0) > 0 && (s.added || 0) === 0) {
						interesting.push({ ns, ...s });
					}
				}

				// Log only problem namespaces 
				if (interesting.length) {
					DL("inclusions.js | AddSetting._collectSettings(): namespaces with hidden settings but nothing addable", interesting);
				}
			} catch (eStat) {
				DL(2, "inclusions.js | AddSetting._collectSettings(): stats summary failed", eStat);
			}
		} catch (e) {
			DL(3, "inclusions.js | AddSetting._collectSettings(): failed to enumerate settings", e);
			this._rows = [];
		}
	}

	/* attach menu include helper AFTER class */
	async _includeMenu(menuNs, menuKey) {
		try {
			// Try explicit mapping first (if present)
			const pairs = await _resolveMenuIdsToPairs(menuNs, menuKey);

			if (!pairs || !pairs.length) {
				DL(2, `inclusions.js | _includeMenu(): no resolvable settings for ${menuNs}.${menuKey}`);
				// Keep current behavior: warn + stop. (No dialog fallback here.)
				return;
			}

			const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
			if (!Array.isArray(data.settings)) data.settings = [];

			let added = 0;

			for (const { namespace, key } of pairs) {
				const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
				if (!exists) {
					data.settings.push({ namespace, key });
					added++;
					DL(`inclusions.js | _includeMenu(): added ${namespace}.${key} from ${menuNs}.${menuKey}`);
				}
			}

			if (added > 0) {
				const ok = await hlp_writeUserInclusions(data);

				if (ok) {
					try { this._incData = data; } catch {}
					try { Hooks.callAll("bbmmInclusionsChanged", { type: "menu", id: `${menuNs}.${menuKey}`, added }); } catch {}
					DL(`inclusions.js | _includeMenu(): committed ${added} setting(s) from ${menuNs}.${menuKey}`);
				} else {
					DL(3, `inclusions.js | _includeMenu(): FAILED writing to persistent storage for ${menuNs}.${menuKey}`, { added });
				}
			} else {
				DL(`inclusions.js | _includeMenu(): nothing to add from ${menuNs}.${menuKey}`);
			}
		} catch (e) {
			DL(3, "inclusions.js | _includeMenu(): failed", e);
		}
	}

	// Include single setting pair
	async _include(namespace, key) {
		const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
		if (!Array.isArray(data.settings)) data.settings = [];
		const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
		if (!exists) data.settings.push({ namespace, key });

		const ok = await hlp_writeUserInclusions(data);
		if (ok) {
			this._incData = data;
			try { Hooks.callAll("bbmmInclusionsChanged", { type: "setting", namespace, key }); } catch {}
		}
	}

	async _renderHTML() {
		try {
			this._incData = await hlp_readUserInclusions();
		} catch (e) {
			DL(2, "inclusions.js | AddSetting._renderHTML(): failed to load inclusions cache", e);
			this._incData = { settings: [], modules: [] };
		}

		try {
			this._collectSettings();
		} catch (e) {
			DL(2, "inclusions.js | AddSetting._renderHTML(): _collectSettings failed", e);
			this._rows = this._rows || [];
		}

		const cols = "grid-template-columns: minmax(220px,1.2fr) minmax(240px,1.6fr) 90px minmax(320px,2fr) 96px;";
		const css =
			`#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important;overflow:hidden}
			.bbmm-ai-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}
			.bbmm-toolbar{display:flex;gap:.5rem;align-items:center;flex-wrap:nowrap}
			.bbmm-toolbar select{width:260px;min-width:260px;max-width:260px}
			.bbmm-toolbar input[type="text"]{flex:1;min-width:260px}

			.bbmm-grid-head{display:grid;${cols}gap:0;border:1px solid var(--color-border,#444);border-radius:.5rem .5rem 0 0;background:var(--color-bg-header,#1e1e1e)}
			.bbmm-grid-head .h{padding:.35rem .5rem;border-bottom:1px solid #444;font-weight:600}

			.bbmm-grid-body{display:block;flex:1 1 auto;min-height:0;max-height:100%;overflow:auto;border:1px solid var(--color-border,#444);border-top:0;border-radius:0 0 .5rem .5rem}
			.bbmm-grid-body .row{display:grid;${cols}gap:0;border-bottom:1px solid #333}
			.bbmm-grid-body .row>div{padding:.3rem .5rem;min-width:0}

			.bbmm-grid-body .c-mod,.bbmm-grid-body .c-key{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.bbmm-grid-body .c-scope{text-transform:capitalize;opacity:.85;white-space:nowrap}

			.bbmm-grid-body .c-val{cursor:pointer}
			.bbmm-grid-body .c-val .val-preview{max-height:2.4em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}
			.bbmm-grid-body .c-val .val-preview code{white-space:pre-wrap;word-break:break-word}

			.bbmm-grid-body .row .val-expand{display:none;margin-top:.25rem;border-top:1px dotted #444;padding-top:.25rem}
			.bbmm-grid-body .row.expanded .val-expand{display:block}
			.bbmm-grid-body .val-toolbar{display:flex;gap:.5rem;margin-bottom:.25rem}
			.bbmm-grid-body .val-pre{max-height:40vh;overflow:auto;margin:0;background:rgba(255,255,255,.03);padding:.4rem;border-radius:.35rem}

			.bbmm-grid-body .c-act{display:flex;justify-content:flex-end;align-items:center;padding-right:8px}
			.bbmm-grid-body .bbmm-inc-act{display:inline-flex;align-items:center;justify-content:center;min-width:80px;height:32px;padding:0 12px;font-size:.95rem;line-height:1}
			.bbmm-grid-body .bbmm-inc-act.bbmm-inc-done{pointer-events:none;opacity:.75;font-weight:700}

			/* FOOTER */
			.bbmm-add-footer{
				display:flex;
				justify-content:center;
				align-items:center;
				width:100%;
				padding:.5rem 0;
				margin-top:.25rem;
				border-top:1px solid var(--color-border,#444);
			}
			.bbmm-add-footer button{min-width:160px}`;

		const moduleList = this._buildModuleList();
		const moduleOpts = ['<option value=""></option>']
			.concat(moduleList.map(m =>
				`<option value="${foundry.utils.escapeHTML(m.ns)}"${this._moduleFilter===m.ns?" selected":""}>${foundry.utils.escapeHTML(m.title)}</option>`
			))
			.join("");

		const head = `<div class="bbmm-grid-head">${this._renderHeader()}</div>`;
		const rowsHtml = (this._rows || []).map(r => this._rowHTML(r)).join("");
		const body = `<div class="bbmm-grid-body" id="bbmm-ai-body">${rowsHtml}</div>`;
		const form = `<style>${css}</style>
			<section class="bbmm-ai-root">
				<div class="bbmm-toolbar">
					<select id="bbmm-ai-module">${moduleOpts}</select>
					<input id="bbmm-ai-filter" type="text" placeholder="${LT.macro.search()}" />
					<span class="count" style="opacity:.85;font-weight:600">${LT.macro.showing()} <span id="bbmm-ai-count">0</span> ${LT.macro.of()} <span id="bbmm-ai-total">${this._rows.length}</span></span>
				</div>
				${head} 
				${body}
				<div class="bbmm-add-footer">
					<button type="button" id="bbmm-ai-close">${LT.buttons.close()}</button>
				</div>
			</section>`;

		return(form);
	}

	async _replaceHTML(result, _options) {
		try {
			const winEl = this.element;
			winEl.style.minWidth  = "520px";
			winEl.style.maxWidth  = "1200px";
			winEl.style.minHeight = "420px";
			winEl.style.maxHeight = "800px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "inclusions.js | AddSetting: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		// Inject help button into title bar
		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass:  "fas fa-circle-question",
				title: LT.buttons.help?.() ?? "Help"
			});
		} catch (e) {
			DL(2, "inclusions.js | _onRender(): help inject failed", e);
		}

		// Apply visibility immediately (initial state shows nothing until module selected)
		this._applyFilterToDOM();

		// Warm previews on initial render only if module already selected
		if (String(this._moduleFilter ?? "").trim()) {
			this._warmVisiblePreviews(50);
		}

		if (this._delegated) return;
		this._delegated = true;

		// Delegated input (search)
		this.element.addEventListener("input", (ev) => {
			const t = ev.target;
			if (!(t instanceof HTMLElement)) return;
			if (t.id !== "bbmm-ai-filter") return;

			this._filterText = String(t.value ?? "");
			if (this._debounceT) clearTimeout(this._debounceT);

			this._debounceT = setTimeout(() => {
				DL("inclusions.js | AddSetting: applying text filter");
				this._applyFilterToDOM();
			}, this._debounceMs);
		});

		// Delegated change (module dropdown) + warm previews (CALL #1)
		this.element.addEventListener("change", (ev) => {
			const t = ev.target;
			if (!(t instanceof HTMLElement)) return;
			if (t.id !== "bbmm-ai-module") return;

			this._moduleFilter = String(t.value ?? "");
			DL(`inclusions.js | AddSetting: module filter changed to '${this._moduleFilter || "(none)"}'`);

			this._applyFilterToDOM();
			this._warmVisiblePreviews(50);
		});

		// Delegated click handling: close + include + expand/collapse + copy
		this.element.addEventListener("click", async (ev) => {
			try {
				const target = ev.target;
				if (!(target instanceof HTMLElement)) return;

				// Footer Close button (closes this UI and reopens Inclusions Manager)
				const footerClose = target.closest?.("#bbmm-ai-close");
				if (footerClose) {
					ev.preventDefault();
					ev.stopPropagation();

					DL("inclusions.js | AddSetting: footer close clicked, reopening manager");
					try { this.close({ force: true }); } catch {}

					setTimeout(() => {
						try {
							(globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.();
						} catch (e) {
							DL(3, "inclusions.js | AddSetting: reopen manager failed", e);
						}
					}, 0);

					return;
				}

				const rowEl = target.closest(".row");

				// Include button
				const incBtn = target.closest(".bbmm-inc-act");
				if (incBtn instanceof HTMLButtonElement) {
					ev.preventDefault();
					ev.stopPropagation();

					const ns = incBtn.dataset.ns || "";
					const key = incBtn.dataset.key || "";
					if (!ns || !key) return;

					incBtn.disabled = true;

					try {
						let added = 0;

						const r = this._rows?.find?.(x => x.ns === ns && x.key === key);

						if (r?.__isMenu) {
							added = await this._includeMenu(ns, key);
						} else {
							const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
							if (!Array.isArray(data.settings)) data.settings = [];

							const before = data.settings.length;
							const exists = data.settings.some(s => s?.namespace === ns && s?.key === key);
							if (!exists) data.settings.push({ namespace: ns, key });

							await hlp_writeUserInclusions(data);

							const after = data.settings.length;
							added = after > before ? 1 : 0;
						}

						if (added > 0) {
							incBtn.classList.add("bbmm-inc-done");
							incBtn.setAttribute("aria-label", "Included");
							incBtn.innerHTML = "✓";
							incBtn.disabled = true;
							DL("inclusions.js | AddSetting: row marked as included");
						} else {
							incBtn.disabled = false;
						}
					} catch (e) {
						incBtn.disabled = false;
						DL(3, "inclusions.js | AddSetting: include failed", e);
						ui.notifications?.error(LT.inclusions.failedAddInclusion());
					}
					return;
				}

				// Copy / collapse (MUST run BEFORE the .c-val click toggler)
				if (rowEl) {
					const copyBtn = target.closest(".btn-copy");
					if (copyBtn) {
						ev.preventDefault();
						ev.stopPropagation();

						try {
							const ns = String(rowEl?.dataset?.ns ?? "");
							const key = String(rowEl?.dataset?.key ?? "");
							if (!ns || !key) return;

							const r = this._rows?.find?.(x => x.ns === ns && x.key === key);

							// Ensure we have something meaningful even if the row was never expanded
							if (r && !r.__isMenu && !r.__valLoaded) {
								try {
									const v = game.settings.get(r.ns, r.key);
									r.__value = v;
									r.__preview = this._toPreview(v);
									r.__pretty = this._toPretty(v);
									r.__valLoaded = true;

									const codeEl = rowEl.querySelector(".val-preview code");
									if (codeEl) {
										codeEl.textContent = r.__preview;
										codeEl.title = r.__preview;
									}
								} catch (eRead) {
									DL(2, "inclusions.js | AddSetting: copy read value failed", { ns, key, err: eRead });
								}
							}

							// Prefer expanded pretty view if present; else cached pretty; else preview
							const pre = rowEl.querySelector(".val-pre");
							const txt =
								String(pre?.textContent ?? "").trim() ||
								String(r?.__pretty ?? "").trim() ||
								String(r?.__preview ?? "").trim() ||
								"";

							const ok = await copyPlainText(txt);
							if (ok) {
								DL(`inclusions.js | AddSetting: copied ${ns}.${key} to clipboard`);
								ui.notifications?.info(LT.copiedToClipboard());
							} else {
								DL(2, "inclusions.js | AddSetting: copyPlainText failed", { ns, key });
								ui.notifications?.warn(LT.failedCopyToClipboard());
							}
						} catch (e) {
							DL(2, "inclusions.js | AddSetting: copy handler failed", e);
							ui.notifications?.warn(LT.failedCopyToClipboard());
						}
						return;
					}

					const collapseBtn = target.closest(".btn-collapse");
					if (collapseBtn) {
						ev.preventDefault();
						ev.stopPropagation();

						rowEl.classList.remove("expanded");
						return;
					}
				}

				// Expand/collapse value cell (ignore clicks on buttons/controls inside)
				if (rowEl && target.closest(".c-val")) {
					// If the click was on an interactive element, do not toggle the row
					if (target.closest("button, a, input, select, textarea, label")) return;

					const wasExpanded = rowEl.classList.contains("expanded");
					rowEl.classList.toggle("expanded");

					if (!wasExpanded) {
						const pre = rowEl.querySelector(".val-pre");
						if (pre && pre.dataset.loaded !== "1") {
							const ns = rowEl.dataset.ns || "";
							const key = rowEl.dataset.key || "";
							const r = this._rows?.find?.(x => x.ns === ns && x.key === key);

							// Lazy load value on expand if needed
							if (r && !r.__valLoaded && !r.__isMenu) {
								try {
									const v = game.settings.get(r.ns, r.key);
									r.__value = v;
									r.__preview = this._toPreview(v);
									r.__pretty = this._toPretty(v);
									r.__valLoaded = true;

									const codeEl = rowEl.querySelector(".val-preview code");
									if (codeEl) {
										codeEl.textContent = r.__preview;
										codeEl.title = r.__preview;
									}
								} catch (e) {
									DL(2, "inclusions.js | AddSetting: expand value read failed", e);
								}
							}

							pre.textContent = String(r?.__pretty ?? "");
							pre.dataset.loaded = "1";
						}
					}
					return;
				}

				// Generic close buttons (just close, no reopen)
				const closeBtn = target.closest?.('[data-action="close"], [data-action="cancel"], .bbmm-close');
				if (closeBtn) {
					DL("inclusions.js | AddSetting: close button clicked");
					try { this.close({ force: true }); } catch {}
					return;
				}
			} catch (e) {
				DL(2, "inclusions.js | AddSetting: click handler error", e);
			}
		});
	}
}

BBMMAddSettingInclusionAppV2.prototype._includeMenu = async function(menuNs, menuKey) {
	try {
		let added = 0;

		// Try explicit mapping first (if present)
		let pairs = [];
		try { pairs = await _resolveMenuIdsToPairs(menuNs, menuKey); } catch {}

		const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
		if (!Array.isArray(data.settings)) data.settings = [];

		if (Array.isArray(pairs) && pairs.length) {
			for (const { namespace, key } of pairs) {
				const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
				if (!exists) {
					data.settings.push({ namespace, key });
					added++;
					DL(`inclusions.js | _includeMenu(): added ${namespace}.${key} from ${menuNs}.${menuKey}`);
				}
			}
		} else {
			// No mapping: store a single placeholder entry for the menu itself
			const exists = data.settings.some(s => s?.namespace === menuNs && s?.key === menuKey);
			if (!exists) {
				data.settings.push({ namespace: menuNs, key: menuKey });
				added++;
				DL(`inclusions.js | _includeMenu(): stored placeholder for menu ${menuNs}.${menuKey}`);
			} else {
				DL(`inclusions.js | _includeMenu(): placeholder already present for ${menuNs}.${menuKey}`);
			}
		}

		if (added > 0) {
			await hlp_writeUserInclusions(data);
			try { Hooks.callAll("bbmmInclusionsChanged", { type: "menu", id: `${menuNs}.${menuKey}`, added }); } catch {}
		}
		return added;
	} catch (e) {
		DL(2, "inclusions.js | _includeMenu() failed", e);
		return 0;
	}
};

/* BBMMAddModuleInclusionAppV2 ================================================
	Add whole-module inclusion (hidden settings for that namespace)
============================================================================= */
class BBMMAddModuleInclusionAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-inclusions-add-module",
			window: { title: LT.inclusions.addModuleTitle() },
			width: 640,
			height: 540,
			resizable: true,
			classes: ["bbmm-inclusions-app"]
		});
		this._rows = [];
	}

	async _collectModules() {
	try {
		const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
		const incModules = new Set(Array.isArray(data.modules) ? data.modules : []);

		// Use helpers to mirror exclusions filtering (and hide EXPORT_SKIP)
		const skipMap = getSkipMap?.() ?? {};
		const rows = [];

		for (const mod of game.modules.values()) {
			const ns = String(mod?.id ?? "").trim();			// <-- declare *before* use
			if (!ns) continue;

			// Already included?
			if (incModules.has(ns)) continue;

			// Respect EXPORT_SKIP just like elsewhere
			if (isExcludedWith?.(skipMap, ns)) continue;

			const title = String(mod?.title ?? ns);
			const active = !!mod?.active;

			// push only after all checks (no usage before declaration)
			rows.push({ ns, title, active });
		}

		// sort by title, case-insensitive
		rows.sort((a, b) => a.title.localeCompare(b.title, game.i18n.lang || undefined, { sensitivity: "base" }));

		this._rows = rows;
		DL(`inclusions.js | AddModule._collectModules(): built`, { count: rows.length });
	} catch (e) {
		DL(3, "inclusions.js | AddModule._collectModules(): FAILED", e);
		this._rows = [];
	}
}

	async _includeModule(ns) {
		const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
		if (!Array.isArray(data.modules)) data.modules = [];
		if (!data.modules.includes(ns)) data.modules.push(ns);
		await await hlp_writeUserInclusions(data);
		try { Hooks.callAll("bbmmInclusionsChanged", { type: "module", namespace: ns }); } catch {}
	}

	async _renderHTML() {
		// Populate rows if needed
		try {
			if (typeof this._collectModules === "function") {
				await this._collectModules();
			} else {
				// Fallback collector (safe): all modules by title
				const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
				const included = new Set(Array.isArray(data.modules) ? data.modules : []);
				this._rows = Array.from(game.modules.values()).map(m => ({
					ns: m.id,
					title: String(m?.title ?? m.id),
					active: !!m.active,
					included: included.has(m.id)
				}));
				this._rows.sort((a,b) => a.title.localeCompare(b.title, game.i18n.lang || undefined, { sensitivity: "base" }));
			}
		} catch (e) {
			DL(2, "inclusions.js | AddModule._renderHTML(): collect failed", e);
			this._rows = this._rows || [];
		}

		const rowsHtml = (Array.isArray(this._rows) ? this._rows : []).map(r => `
			<tr>
				<td class="c-title" title="${foundry.utils.escapeHTML(r.title)}">${foundry.utils.escapeHTML(r.title)}</td>
				<td class="c-state">${r.active ? "✓" : ""}</td>
				<td class="c-act">
					<button type="button" class="bbmm-inc-mod-act" data-ns="${foundry.utils.escapeHTML(r.ns)}">
						${LT.inclusions.include()}
					</button>
				</td>
			</tr>
		`).join("");

		return `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-am-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-am-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-am-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
				.bbmm-am-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-am-table thead th:nth-child(2){width:110px}
				.bbmm-am-table thead th:last-child{width:96px;text-align:right}
				.bbmm-am-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-am-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}
				.bbmm-am-table .c-act{display:flex;justify-content:flex-end}
				.bbmm-am-table .bbmm-inc-mod-act.bbmm-inc-done{pointer-events:none;opacity:.75;font-weight:700}

				#${this.id} .bbmm-footer{margin-top:10px}
				#${this.id} .bbmm-footer-close{
					display:flex;justify-content:center;align-items:center;
					width:100% !important;height:36px;padding:0 14px;border-radius:8px;font-weight:600
				}
			</style>

			<div class="bbmm-am-root">
				<div class="bbmm-am-scroller">
					<table class="bbmm-am-table">
						<thead><tr><th>${LT.module()}</th><th>${LT.inclusions.active()}</th><th></th></tr></thead>
						<tbody>${rowsHtml || `<tr><td colspan="3" style="text-align:center;opacity:.8;padding:18px 0">${LT.inclusions.none()}.</td></tr>`}</tbody>
					</table>
				</div>

				<div class="bbmm-footer">
					<button type="button" class="bbmm-footer-close" data-action="close">${LT.buttons.close()}</button>
				</div>
			</div>
		`;
	}

	async _replaceHTML(result, _options) {
		try {
			const winEl = this.element;
			winEl.style.minWidth  = "520px";
			winEl.style.maxWidth  = "760px";
			winEl.style.minHeight = "360px";
			winEl.style.maxHeight = "800px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "inclusions.js | AddModule: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		// Inject help button into title bar
		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass:  "fas fa-circle-question",
				title: LT.buttons.help?.() ?? "Help"
			});
		} catch (e) {
			DL(2, "inclusions.js | _onRender(): help inject failed", e);
		}

		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			try {
				// Include module
				const incBtn = ev.target.closest?.(".bbmm-inc-mod-act");
				if (incBtn instanceof HTMLButtonElement) {
					const ns = incBtn.dataset.ns || "";
					if (!ns) return;

					try {
						incBtn.disabled = true;

						const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
						if (!Array.isArray(data.modules)) data.modules = [];
						if (!data.modules.includes(ns)) data.modules.push(ns);
						await hlp_writeUserInclusions(data); 
						try { Hooks.callAll("bbmmInclusionsChanged", { type: "module", namespace: ns }); } catch {}

						incBtn.classList.add("bbmm-inc-done");
						incBtn.setAttribute("aria-label", "Included");
						incBtn.innerHTML = "✓";
						incBtn.disabled = true;
						DL(`inclusions.js | AddModule: included ${ns} and marked as done`);
					} catch (e) {
						incBtn.disabled = false;
						DL(3, "inclusions.js | AddModule.include failed", e);
						ui.notifications?.error(LT.inclusions.failedAddInclusion());
					}
					return;
				}

				// Close -> return to Inclusions Manager
				const closeBtn = ev.target.closest?.('[data-action="close"], [data-action="cancel"], .bbmm-close');
				if (closeBtn) {
					DL("inclusions.js | AddModule: close button clicked");
					try { this.close({ force: true }); } catch {}
					try { (globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.(); } catch {}
					return;
				}
			} catch (e) {
				DL(2, "inclusions.js | AddModule: click handler error", e);
			}
		});
	}
}

/* ============================================================================
	Inclusions Manager (list + remove + open “Add”)
============================================================================ */
class BBMMInclusionsAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-inclusions-manager",
			window: { title: LT.inclusions.title() },
			width: 640,
			height: 500,
			resizable: true,
			classes: ["bbmm-inclusions-app"]
		});
	}

	/* ============================================================================
		{DATA HELPERS}
	============================================================================ */

	// Get all inclusion entries (validated)
	async _getInclusions() {
		const inc = await hlp_readUserInclusions();
		const arr = Array.isArray(inc.settings) ? inc.settings : [];
		return arr.filter(s => !!s?.namespace && !!s?.key);
	}

	// Get module label (with i18n if possible)
	_getNsLabel(ns) {
		const mod = game.modules.get(ns);
		return String(mod?.title ?? ns ?? "");
	}

	// Get setting label (with i18n if possible)
	_getSettingLabel(ns, key) {
		const id = `${ns}.${key}`;

		// Normal setting label
		const setting = game.settings.settings.get(id);
		if (setting?.name) {
			try {
				return game.i18n.localize(String(setting.name));
			} catch {
				// fall through
			}
		}

		// Menu placeholder label
		const menu = game.settings.menus.get(id);
		if (menu?.name) {
			try {
				return game.i18n.localize(String(menu.name));
			} catch {
				// fall through
			}
		}

		// Fallback to raw key
		return String(key);
	}

	// Remove single setting pair
	async _remove(namespace, key) {
		const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
		if (!Array.isArray(data.settings)) data.settings = [];

		const before = data.settings.length;
		data.settings = data.settings.filter(s => !(s?.namespace === namespace && s?.key === key));
		const removed = (data.settings.length !== before);

		if (!removed) {
			DL(`inclusions.js | _remove(): nothing to remove for ${namespace}.${key}`);
			return;
		}

		const ok = await hlp_writeUserInclusions(data);
		if (!ok) {
			DL(3, `inclusions.js | _remove(): FAILED writing persistent storage for ${namespace}.${key}`);
			return;
		}

		try { this._incData = data; } catch {}
		try { Hooks.callAll("bbmmInclusionsChanged", { type: "setting", namespace, key, removed: true }); } catch {}
		DL(`inclusions.js | _remove(): removed ${namespace}.${key}`);
	}

	async _renderHTML() {
		// Build rows (modules + settings) 
		const inc = await hlp_readUserInclusions();
		const mods = Array.isArray(inc.modules)  ? inc.modules  : [];
		const sets = Array.isArray(inc.settings) ? inc.settings : [];
		DL("inclusions.js | _renderHTML(): building rows", { modules: mods.length, settings: sets.length });

		// Module rows
		const modRows = mods.map(ns => {
			const mod = game.modules.get(ns);
			const title = String(mod?.title ?? ns);
			return {
				type: "Module",
				identifier: title,
				_ns: ns,
				_key: "",
				_id: ns
			};
		});

		// Setting rows
		const setRows = sets.map(s => {
			const ns = String(s?.namespace ?? "");
			const key = String(s?.key ?? "");
			const mod = game.modules.get(ns);
			const nsLabel = String(mod?.title ?? ns);
			const settingLabel = this._getSettingLabel(ns, key);
			return {
				type: "Setting",
				identifier: `${nsLabel}, ${settingLabel}`,
				_ns: ns,
				_key: key,
				_id: `${ns}.${key}`
			};
		});

		this._rows = [...modRows, ...setRows];

		const rows = this._rows.map(r => `
			<tr>
				<td class="c-type">${r.type}</td>
				<td class="c-id" title="${foundry.utils.escapeHTML(r._id ?? "")}">
					${foundry.utils.escapeHTML(r.identifier)}
				</td>
				<td class="c-del">
					<button type="button"
						class="bbmm-x-del"
						data-type="${r.type === "Module" ? "module" : "setting"}"
						data-id="${r.type === "Module" ? (r._id ?? "") : ""}"
						data-ns="${r._ns ?? ""}"
						data-key="${r._key ?? ""}"
						aria-label="${LT.inclusions.remove()}">
						<i class="fas fa-trash"></i>
					</button>
				</td>
			</tr>
		`).join("");

		const html = `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-x-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}

				.bbmm-x-toolbar{display:grid;grid-template-columns:auto auto 1fr max-content;align-items:center;column-gap:8px}
				.bbmm-x-toolbar .bbmm-btn{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}

				.bbmm-x-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-x-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}

				.bbmm-x-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-x-table thead th:first-child{width:72px}
				.bbmm-x-table thead th:last-child{width:44px;text-align:right}

				.bbmm-x-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-x-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}

				.bbmm-x-table .c-type{
					width:72px;
					white-space:nowrap;
					overflow:hidden;
					text-overflow:ellipsis;
					color:#9bd;
				}
				.bbmm-x-table .c-id{
					width:auto;
					font-family:ui-monospace,Menlo,Consolas,monospace;
					word-break:break-word
				}
				.bbmm-x-table .c-del{text-align:right}
				.bbmm-x-table .bbmm-x-del{
					display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px
				}
				.bbmm-x-count{opacity:.85;font-weight:600}

				/* Footer: full-width Close (match exclusions) */
				.bbmm-footer{display:block;margin-top:10px}
				.bbmm-footer-close{
					display:flex;justify-content:center;align-items:center;
					width:100%;height:36px;padding:0 14px;border-radius:8px;font-weight:600;
				}
			</style>

			<section class="bbmm-x-root">
				<div class="bbmm-x-toolbar">
					<button type="button" class="bbmm-btn bbmm-x-add-setting" data-action="add-setting">${LT.buttons.addSetting()}</button>
					<button type="button" class="bbmm-btn bbmm-x-add-module" data-action="add-module">${LT.buttons.addModule()}</button>
					<div></div>
					<div class="bbmm-x-count">${LT.total()}: ${this._rows.length}</div>
				</div>

				<div class="bbmm-x-scroller">
					<table class="bbmm-x-table">
						<thead><tr><th>${LT.type()}</th><th>${LT.identifier()}</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="3" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">${LT.inclusions.none()}.</td></tr>`}</tbody>
					</table>
				</div>

				<div class="bbmm-footer">
					<button type="button" class="bbmm-footer-close" data-action="close">${LT.buttons.close()}</button>
				</div>
			</section>
		`;

		return html;
	}

	async _replaceHTML(result, _options) {
		// Clamp + layout 
		const winEl = this.element;
		try {
			winEl.style.minWidth  = "560px";
			winEl.style.maxWidth  = "920px";
			winEl.style.minHeight = "360px";
			winEl.style.maxHeight = "800px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "inclusions.js | BBMMInclusionsAppV2: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		// Inject help button into title bar
		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass:  "fas fa-circle-question",
				title: LT.buttons.help?.() ?? "Help"
			});
		} catch (e) {
			DL(2, "inclusions.js | _onRender(): help inject failed", e);
		}

		// avoid double-binding across re-renders
		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			const btn = ev.target.closest?.("button[data-action], .bbmm-x-del");
			if (!(btn instanceof HTMLButtonElement)) return;

			ev.preventDefault();
			ev.stopPropagation();

			const action = btn.dataset.action || "";
			DL(`inclusions.js | BBMMInclusionsAppV2.click(): ${action}`);

			// Footer Close or header X
			if (action === "close" || action === "cancel" || btn.classList.contains("bbmm-close")) {
				try { this.close({ force: true }); } catch {}
				return;
			}

			if (action === "add-setting") {
				try { this.close({ force: true }); } catch {}
				setTimeout(() => {
					try { (globalThis.bbmm?.openAddSettingInclusionApp || globalThis.openAddSettingInclusionApp)?.(); }
					catch (e) { DL(3, "inclusions.js | openAddSettingInclusionApp(): failed", e); }
				}, 0);
				return;
			}

			if (action === "add-module") {
				// Optional confirm flow to avoid accidental clicks
				const addModuleBtn = ev.target.closest?.('button[data-action="add-module"]');
				if (addModuleBtn instanceof HTMLButtonElement) {
					try { this.close({ force: true }); } catch {}
					(globalThis.bbmm?.openAddModuleInclusionApp || globalThis.openAddModuleInclusionApp)?.();
					return;
				}
			}

			// Row delete (module or setting)
			if (btn.classList.contains("bbmm-x-del")) {
				const type = btn.dataset.type || "";
				const ns   = btn.dataset.ns   || "";
				const key  = btn.dataset.key  || "";
				const id   = btn.dataset.id   || "";

				if (type === "module" && ns) {
					// Remove module inclusion
					try {
						btn.disabled = true;

						const data = foundry.utils.duplicate(await hlp_readUserInclusions({ force: true }));
						const mods = Array.isArray(data.modules) ? data.modules : [];

						const before = mods.length;
						data.modules = mods.filter(x => x !== ns);
						const removed = (data.modules.length !== before);

						if (!removed) {
							DL(`inclusions.js | delete(module): nothing to remove for ${ns}`);
							btn.disabled = false;
							return;
						}

						const ok = await hlp_writeUserInclusions(data);
						if (!ok) {
							btn.disabled = false;
							DL(3, `inclusions.js | delete(module): FAILED writing persistent storage for ${ns}`);
							ui.notifications?.error(LT.inclusions.failedRemoveInclusion());
							return;
						}

						try { this._incData = data; } catch {}
						try { Hooks.callAll("bbmmInclusionsChanged", { type: "module", namespace: ns, removed: true }); } catch {}
						DL(`inclusions.js | delete(module): removed ${ns}`);

						await this.render(true);
					} catch (e) {
						btn.disabled = false;
						DL(3, "inclusions.js | delete(module): failed", e);
						ui.notifications?.error(LT.inclusions.failedRemoveInclusion());
					}
					return;
				}

				if (type === "setting" && ns && key) {
					// Remove setting inclusion
					try {
						btn.disabled = true;
						await this._remove(ns, key);
						await this.render(true);
					} catch (e) {
						btn.disabled = false;
						DL(3, "inclusions.js | delete(setting): failed", e);
						ui.notifications?.error(LT.inclusions.failedRemoveInclusion());
					}
					return;
				}
			}
		});
	}
}

/* ============================================================================
	Exports / Globals
============================================================================ */

export function openInclusionsManagerApp() {
	new BBMMInclusionsAppV2().render(true);
}

export function openAddModuleInclusionApp() {
	DL("inclusions.js | openAddModuleInclusionApp()");
	new BBMMAddModuleInclusionAppV2().render(true);
}
globalThis.bbmm ??= {};
Object.assign(globalThis.bbmm, { openAddModuleInclusionApp });

export function openAddSettingInclusionApp() {
	new BBMMAddSettingInclusionAppV2().render(true);
}

// Ensure namespace once
globalThis.bbmm ??= {};
Object.assign(globalThis.bbmm, {
	openInclusionsManagerApp,
	openAddSettingInclusionApp
});