
/* BBMM Exclusions ============================================================
	- Lists all modules not already excluded
	- Shows Enabled/Disabled state
	- "Exclude" updates setting, closes, then re-opens manager
============================================================================ */

import { DL, BBMM_README_UUID } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";
import { copyPlainText } from "./macros.js";
import { hlp_injectHeaderHelpButton, invalidateSkipMap } from "./helpers.js";

// CONSTANTS
const EXC_STORAGE_FILE = "user-exclusions.json";
let _excCache = null;

//	Ensure namespace once
globalThis.bbmm ??= {};

//	Register on bbmm namespace
Object.assign(globalThis.bbmm, {
	openExclusionsManagerApp,
	openAddModuleExclusionApp,
	openAddSettingExclusionApp
});

/* ============================================================================
	{HELPERS}
============================================================================ */

// returns a Promise resolving to {settings: Array, modules: Array}
function _excStorageUrl() {
	return foundry.utils.getRoute(`bbmm-data/${EXC_STORAGE_FILE}`);
}

// Read exclusions from persistent storage (FilePicker)
export async function hlp_readUserExclusions({ force = false } = {}) {
	if (!force && _excCache) return _excCache;

	try {
		const res = await fetch(_excStorageUrl(), { cache: "no-store" });
		if (!res.ok) {
			DL(2, `exclusions.js | hlp_readUserExclusions(): fetch not ok (${res.status})`);
			_excCache = { settings: [], modules: [] };
			globalThis.bbmm._userExclusions = _excCache;
			invalidateSkipMap();
			return _excCache;
		}

		const data = await res.json();
		const out = {
			settings: Array.isArray(data?.settings) ? data.settings : [],
			modules: Array.isArray(data?.modules) ? data.modules : []
		};

		_excCache = out;
		globalThis.bbmm._userExclusions = _excCache;
		invalidateSkipMap();
		return out;
	} catch (err) {
		DL(3, "exclusions.js | hlp_readUserExclusions(): failed", err);
		_excCache = { settings: [], modules: [] };
		globalThis.bbmm._userExclusions = _excCache;
		invalidateSkipMap();
		return _excCache;
	}
}

// Write exclusions to persistent storage (FilePicker)
export async function hlp_writeUserExclusions(obj) {
	const payload = JSON.stringify(obj ?? { settings: [], modules: [] }, null, 2);
	const file = new File([payload], EXC_STORAGE_FILE, { type: "application/json" });

	try {
		const res = await FilePicker.upload("data", "bbmm-data", file, { notify: false });
		if (!res || (!res.path && !res.url)) {
			DL(3, "exclusions.js | hlp_writeUserExclusions(): upload returned no path/url", res);
			return false;
		}

		_excCache = obj ?? { settings: [], modules: [] };
		globalThis.bbmm._userExclusions = _excCache;
		invalidateSkipMap();
		DL("exclusions.js | hlp_writeUserExclusions(): wrote exclusions to persistent storage", res);
		return true;
	} catch (err) {
		DL(3, "exclusions.js | hlp_writeUserExclusions(): uploadPersistent failed", err);
		return false;
	}
}

class BBMMAddModuleExclusionAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-exclusions-add-module",
			window: { title: LT.titleAddModuleExclusion() },
			width: 720,
			height: 500,
			resizable: true,
			classes: ["bbmm-exclusions-app"]
		});
		this._minW = 420;
		this._maxW = 900;
		this._minH = 320;
		this._maxH = 720;
	}

	// Get Set of excluded module IDs
	_getExcludedIds() {
		const ex = this._excData || { modules: [] };
		return new Set(Array.isArray(ex.modules) ? ex.modules : []);
	}

	// Build list of modules not already excluded
	_collectCandidates() {
		const excluded = this._getExcludedIds();
		const out = [];
		for (const m of game.modules.values()) {
			if (m.id === "bbmm") continue; //  self-skip
			if (excluded.has(m.id)) continue; // skip already excluded
			out.push({ id: m.id, title: String(m.title ?? m.id), active: !!m.active });
		}
		out.sort((a,b)=>a.title.localeCompare(b.title, game.i18n.lang || undefined, {sensitivity:"base"}));
		this._mods = out;
	}

	// Add module ID to userExclusions.modules
	async _exclude(id) {
		const data = foundry.utils.duplicate(await hlp_readUserExclusions({ force: true }));
		if (!Array.isArray(data.modules)) data.modules = [];

		if (!data.modules.includes(id)) {
			data.modules.push(id);

			const ok = await hlp_writeUserExclusions(data);
			if (!ok) {
				DL(3, `exclusions.js | BBMMAddModuleExclusionAppV2._exclude(): FAILED writing exclusions for ${id}`);
				return;
			}

			try { this._excData = data; } catch {}
			try { Hooks.callAll("bbmmExclusionsChanged", { type: "module", id }); } catch {}
			DL(`exclusions.js | BBMMAddModuleExclusionAppV2._exclude(): stored ${id}`);
		}
	}

	async _renderHTML(_context, _options) {

		this._excData = await hlp_readUserExclusions();
		this._collectCandidates();

		const rows = this._mods.map(m => `
			<tr>
				<td class="c-title">${foundry.utils.escapeHTML(m.title)}</td>
				<td class="c-state">${m.active ? LT.enabled() : LT.disabled()}</td>
				<td class="c-act"><button type="button" class="bbmm-exc-act" data-id="${m.id}">${LT.buttons.exclude()}</button></td>
			</tr>
		`).join("");

		const html = `
			<style>
				/* Layout */
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-am-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-am-toolbar{display:flex;align-items:center;gap:8px}
				.bbmm-am-count{opacity:.85;font-weight:600}

				/* Table */
				.bbmm-am-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-am-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}

				/* Header */
				.bbmm-am-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-am-table thead th:nth-child(2){width:110px}                  /* State */
				.bbmm-am-table thead th:last-child{width:96px;text-align:right}    /* Action */

				/* Body */
				.bbmm-am-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-am-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}

				/* Columns */
				.bbmm-am-table .c-title{width:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.bbmm-am-table .c-state{width:110px;white-space:nowrap;opacity:.85}
				.bbmm-am-table .c-act{
					width:96px;                                 /* match header */
					display:flex;justify-content:flex-end;align-items:center;
					text-align:right;padding-right:8px
				}

				/* Exclude button — roomy */
				.bbmm-am-table .bbmm-exc-act{
					display:inline-flex;align-items:center;justify-content:center;
					min-width:80px;height:32px;padding:0 12px;
					font-size:.95rem;line-height:1
				}
				.bbmm-am-table .bbmm-exc-act:focus-visible{
					outline:2px solid var(--color-border-highlight,#79c);outline-offset:2px
				}
				.bbmm-am-table .bbmm-exc-act.bbmm-exc-done{
					pointer-events:none;
					opacity:.75;
					font-weight:700;
				}
			</style>

			<section class="bbmm-am-root">
				<div class="bbmm-am-toolbar">
					<h3 style="margin:0;flex:1;">${LT.addModuleExclusion()}</h3>
					<div class="bbmm-am-count">${LT.available()}: ${this._mods.length}</div>
				</div>

				<div class="bbmm-am-scroller">
					<table class="bbmm-am-table">
						<thead><tr><th>${LT.module()}</th><th>${LT.state()}</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="3" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">${LT.allModulesAlreadyExcluded()}.</td></tr>`}</tbody>
					</table>
				</div>
			</section>
		`;

		return html;
	}

	async _replaceHTML(result, _options) {
		
		// clamp + layout 
		const winEl = this.element;
		try {
			winEl.style.minWidth  = this._minW + "px";
			winEl.style.maxWidth  = this._maxW + "px";
			winEl.style.minHeight = this._minH + "px";
			winEl.style.maxHeight = this._maxH + "px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "BBMMAddModuleExclusionAppV2: size clamp failed", e); }

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
			DL(2, "exclusions.js | _onRender(): help inject failed", e);
		}

		// add footer with cancel button
		const footer = document.createElement("footer");
		footer.classList.add("form-footer");
		footer.style.display = "flex";
		footer.style.justifyContent = "flex-end";
		footer.style.marginTop = "0.75rem";

		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.innerText = LT.buttons.close();
		closeBtn.addEventListener("click", () => {
			DL("AddModule.cancel(): reopen manager");
			try { this.close({ force: true }); } catch {}
			setTimeout(() => {
				try {
					(globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.();
				} catch (e) { DL(3, "AddModule.close(): reopen failed", e); }
			}, 0);
		});

		footer.appendChild(closeBtn);
		content.appendChild(footer);

		content.addEventListener("click", async (ev) => {

			// Close button in the footer (closes this UI + reopens exclusions manager)
			const closeBtn = ev.target.closest?.("#bbmm-as-close");
			if (closeBtn) {
				ev.preventDefault();
				ev.stopPropagation();

				DL("exclusions.js | AddSetting: close clicked, reopening manager");
				try { this.close({ force: true }); } catch {}

				setTimeout(() => {
					try {
						(globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.();
					} catch (e) {
						DL(3, "exclusions.js | AddSetting: reopen manager failed", e);
					}
				}, 0);

				return;
			}

			// Exclude button
			const btn = ev.target.closest?.(".bbmm-exc-act");
			if (btn instanceof HTMLButtonElement) {
				const id = btn.dataset.id || "";
				if (!id) return;

				try {
					btn.disabled = true;
					await this._exclude(id);

					// Keep dialog open; mark on success
					btn.classList.add("bbmm-exc-done");
					btn.setAttribute("aria-label", "Excluded");
					btn.innerHTML = "✓";
					btn.disabled = true;
					DL(`exclusions.js | AddModule: module ${id} marked as excluded`);
				} catch (e) {
					btn.disabled = false;
					DL(3, "exclude failed", e);
					ui.notifications?.error(`${LT.errors.failedToAddExclusion()}.`);
				}
				return;
			}

			// Other cancel/close buttons should just close (no reopen)
			const cancel = ev.target.closest?.('button[data-action="cancel"], [data-action="close"], .bbmm-close');
			if (cancel) {
				try { this.close({ force: true }); } catch {}
				return;
			}
		});

	}

}

/* BBMMAddSettingExclusionAppV2 ===============================================
	- Lists all CONFIG settings not already excluded
	- Columns: Module (title or namespace), Setting (friendly name or key), Action
	- Exclude adds {namespace,key} to userExclusions.settings, then reopens manager
   ========================================================================== */
class BBMMAddSettingExclusionAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-exclusions-add-setting",
			window: { title: LT.titleAddSettingExclusion() },
			width: 980,
			height: 600,
			resizable: true,
			classes: ["bbmm-exclusions-app"]
		});

		this._minW = 520;
		this._maxW = 1200;
		this._minH = 420;
		this._maxH = 720;

		this._rows = [];

		// UI state
		this._filterText = "";
		this._moduleFilter = ""; // "" = none selected
		this._matchRows = [];
		this._delegated = false;

		// If true, hide everything until module chosen
		this._requireModuleSelection = true;

		this._debounceMs = 250;
		this._debounceT = null;

		// Preview warming
		this._warmTimer = null;
		this._warmRunning = false;
	}

	/* ============================================================================
		{DATA HELPERS}
	============================================================================ */
	
	// Check if row matches current filter
	_matchesFilter(r) {
		const mod = String(this._moduleFilter ?? "").trim();

		// Require module selection: show nothing until user picks one
		if (this._requireModuleSelection && !mod) return false;

		if (mod && r.namespace !== mod) return false;

		const q = String(this._filterText ?? "").trim().toLowerCase();
		if (!q) return true;

		return (
			String(r.modTitle ?? "").toLowerCase().includes(q) ||
			String(r.namespace ?? "").toLowerCase().includes(q) ||
			String(r.setTitle ?? "").toLowerCase().includes(q) ||
			String(r.key ?? "").toLowerCase().includes(q) ||
			String(r.scope ?? "").toLowerCase().includes(q) ||
			String(r.__preview ?? "").toLowerCase().includes(q)
		);
	}

	// Apply current filter to DOM rows
	_applyFilterToDOM() {
		const body = this.element?.querySelector?.("#bbmm-as-body");
		if (!body) return;

		const countEl = this.element.querySelector("#bbmm-as-count");
		const totalEl = this.element.querySelector("#bbmm-as-total");

		const mod = String(this._moduleFilter ?? "").trim();
		const requireMod = !!this._requireModuleSelection;

		let shown = 0;
		let total = 0;

		// Optional empty-state node (create once)
		let emptyEl = body.querySelector(".bbmm-empty");
		if (!emptyEl) {
			emptyEl = document.createElement("div");
			emptyEl.className = "bbmm-empty";
			emptyEl.style.padding = "14px";
			emptyEl.style.opacity = "0.8";
			emptyEl.style.textAlign = "center";
			emptyEl.style.display = "none";
			emptyEl.textContent = LT.macro.selectModuleToViewSettings?.() ?? "Select a module to view settings.";
			body.prepend(emptyEl);
		}

		// If module required and none selected, hide all rows and show empty message
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

			const sel = `.row[data-ns="${CSS.escape(r.namespace)}"][data-key="${CSS.escape(r.key)}"]`;
			const rowEl = body.querySelector(sel);
			if (!rowEl) continue;

			const ok = this._matchesFilter(r);
			rowEl.style.display = ok ? "" : "none";
			if (ok) shown++;
		}

		if (countEl) countEl.textContent = String(shown);
		if (totalEl) totalEl.textContent = String(total);
	}

	// Compact value preview for table
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

	// Pretty-printed value for expanded view
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

	// Warm visible previews by lazy-loading values
	_warmVisiblePreviews(limitPerTick = 50) {
		if (this._warmRunning) return;
		const body = this.element?.querySelector?.("#bbmm-as-body");
		if (!body) return;

		const mod = String(this._moduleFilter ?? "").trim();
		if (this._requireModuleSelection && !mod) return;

		this._warmRunning = true;

		// Gather visible rows that still need loading
		const toLoad = [];
		for (const r of this._rows || []) {
			if (r.__isMenu) continue;
			if (r.__valLoaded) continue;
			if (!this._matchesFilter(r)) continue;

			// Must be in selected module anyway
			if (mod && r.namespace !== mod) continue;

			toLoad.push(r);
		}

		if (!toLoad.length) {
			this._warmRunning = false;
			return;
		}

		DL(`exclusions.js | AddSetting._warmVisiblePreviews(): warming ${toLoad.length} previews`);

		let idx = 0;

		const tick = () => {
			const end = Math.min(idx + limitPerTick, toLoad.length);

			for (; idx < end; idx++) {
				const r = toLoad[idx];

				try {
					const v = game.settings.get(r.namespace, r.key);
					r.__value = v;
					r.__preview = this._toPreview(v);
					r.__pretty = this._toPretty(v);
					r.__valLoaded = true;

					// Update DOM preview if row exists
					const sel = `.row[data-ns="${CSS.escape(r.namespace)}"][data-key="${CSS.escape(r.key)}"] .val-preview code`;
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
					DL(2, "exclusions.js | AddSetting._warmVisiblePreviews(): value read failed", { ns: r.namespace, key: r.key, err: e });
				}
			}

			if (idx < toLoad.length) {
				this._warmTimer = setTimeout(tick, 0);
				return;
			}

			this._warmRunning = false;
			this._warmTimer = null;
			DL("exclusions.js | AddSetting._warmVisiblePreviews(): done");
		};

		tick();
	}

	// Build list of modules present in _rows
	_buildModuleList() {
		const map = new Map();
		for (const r of this._rows) {
			if (!r?.namespace) continue;
			if (!map.has(r.namespace)) map.set(r.namespace, r.modTitle || r.namespace);
		}
		return Array.from(map.entries())
			.map(([ns, title]) => ({ ns, title }))
			.sort((a, b) => a.title.localeCompare(b.title, game.i18n.lang || undefined, { sensitivity: "base" }));
	}

	// Apply current filter to _rows, store in _matchRows
	_runFilter() {
		const q = String(this._filterText ?? "").trim().toLowerCase();
		const mod = String(this._moduleFilter ?? "").trim();

		let list = this._rows;

		if (mod) {
			list = list.filter(r => r.namespace === mod);
		}

		if (q) {
			list = list.filter(r =>
				String(r.modTitle ?? "").toLowerCase().includes(q) ||
				String(r.namespace ?? "").toLowerCase().includes(q) ||
				String(r.setTitle ?? "").toLowerCase().includes(q) ||
				String(r.key ?? "").toLowerCase().includes(q) ||
				String(r.scope ?? "").toLowerCase().includes(q) ||
				String(r.__preview ?? "").toLowerCase().includes(q)
			);
		}

		this._matchRows = list;
	}

	// Render header row
	_renderHeader() {
		return (
			`<div class="h c-mod">${LT.module()}</div>` +
			`<div class="h c-key">${LT.setting()}</div>` +
			`<div class="h c-scope">${LT.scope()}</div>` +
			`<div class="h c-val">${LT.macro.value()}</div>` +
			`<div class="h c-act"></div>`
		);
	}

	// Render a single row
	_rowHTML(r) {
		const ns = String(r.namespace ?? "");
		const key = String(r.key ?? "");
		const pairTitle = `${ns}.${key}`;
		const preview = foundry.utils.escapeHTML(String(r.__preview ?? ""));

		return `
			<div class="row" data-ns="${foundry.utils.escapeHTML(ns)}" data-key="${foundry.utils.escapeHTML(key)}">
				<div class="c-mod" title="${foundry.utils.escapeHTML(ns)}">${foundry.utils.escapeHTML(String(r.modTitle ?? ns))}</div>
				<div class="c-key" title="${foundry.utils.escapeHTML(pairTitle)}">${foundry.utils.escapeHTML(String(r.setTitle ?? key))}</div>
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
					<button type="button" class="bbmm-exc-act" data-ns="${foundry.utils.escapeHTML(ns)}" data-key="${foundry.utils.escapeHTML(key)}">${LT.buttons.exclude()}</button>
				</div>
			</div>
		`;
	}

	// Get Set of excluded {namespace,key} pairs
	_getExcludedPairsSet() {
		const ex = this._excData || {};
		const arr = Array.isArray(ex.settings) ? ex.settings : [];
		return new Set(arr.map(s => `${s?.namespace ?? ""}::${s?.key ?? ""}`));
	}

	// Build list of settings not already excluded
	_collectSettings() {
		// Build the table model for Add Setting Exclusion
		try {
			// Already-excluded pairs as a Set of "ns::key"
			const excluded = this._getExcludedPairsSet();
			const rows = [];

			for (const s of game.settings.settings.values()) {
				try {
					const ns = String(s?.namespace ?? "");
					const key = String(s?.key ?? "");
					const scope = String(s?.scope ?? "client");
					if (!ns || !key) continue;

					// Skip registerMenu placeholders (we do NOT show menus in Add Setting UI)
					if (s?.__isMenu) continue;

					const pairKey = `${ns}::${key}`;
					if (excluded.has(pairKey)) continue; // skip already excluded

					// Module title (fallback to namespace)
					const mod = game.modules.get(ns);
					const modTitle = String(mod?.title ?? ns);

					// Setting label: prefer name (localized if possible), fallback to key
					let setTitle = "";
					const nm = s?.name;
					if (typeof nm === "string" && nm.trim().length) {
						try { setTitle = game.i18n?.localize?.(nm) || nm; }
						catch { setTitle = nm; }
					} else {
						setTitle = key;
					}

					// NOTE: Do NOT read values here. Values are lazy-loaded only for visible rows.
					rows.push({
						namespace: ns,
						key,
						modTitle,
						setTitle,
						scope,

						// Lazy-load value later (selected module only)
						__value: undefined,
						__preview: "",
						__pretty: "",
						__valLoaded: false
					});
				} catch (e1) {
					DL(2, "exclusions.js | AddSetting._collectSettings() item failed", e1);
				}
			}

			// Intentionally DO NOT append game.settings.menus entries.
			// Menus show up as "[menu]" and are not real setting values, so they are excluded from the Add Setting UI.

			// Sort by module title, then setting title
			rows.sort((a, b) =>
				a.modTitle.localeCompare(b.modTitle, game.i18n.lang || undefined, { sensitivity: "base" }) ||
				a.setTitle.localeCompare(b.setTitle, game.i18n.lang || undefined, { sensitivity: "base" })
			);

			this._rows = rows;
			DL("exclusions.js | AddSetting._collectSettings(): built", { count: rows.length });
		} catch (e) {
			DL(3, "exclusions.js | AddSetting._collectSettings(): failed to enumerate settings", e);
			this._rows = [];
		}
	}

	// Add {namespace,key} to userExclusions.settings
	async _exclude(namespace, key) {
		const data = foundry.utils.duplicate(await hlp_readUserExclusions({ force: true }));
		if (!Array.isArray(data.settings)) data.settings = [];

		const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
		if (!exists) data.settings.push({ namespace, key });

		const ok = await hlp_writeUserExclusions(data);
		if (!ok) {
			DL(3, `exclusions.js | AddSetting._exclude(): FAILED writing exclusions for ${namespace}.${key}`);
			throw new Error("Failed to write exclusions");
		}

		try { this._excData = data; } catch {}
		try { Hooks.callAll("bbmmExclusionsChanged", { type: "setting", namespace, key }); } catch {}
		DL(`exclusions.js | AddSetting._exclude(): stored ${namespace}.${key}`);
	}

	// Special case: exclude a menu placeholder
	async _excludeMenu(namespace, key) {
		try {
			const data = foundry.utils.duplicate(await hlp_readUserExclusions({ force: true }));
			if (!Array.isArray(data.settings)) data.settings = [];

			const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
			if (!exists) data.settings.push({ namespace, key });

			const ok = await hlp_writeUserExclusions(data);
			if (!ok) {
				DL(3, `exclusions.js | _excludeMenu(): FAILED writing exclusions for ${namespace}.${key}`);
				throw new Error("Failed to write exclusions");
			}

			try { this._excData = data; } catch {}
			try { Hooks.callAll("bbmmExclusionsChanged", { type: "menu", namespace, key }); } catch {}
			DL(`exclusions.js | _excludeMenu(): stored placeholder for ${namespace}.${key}`);
		} catch (e) {
			DL(3, "exclusions.js | _excludeMenu() failed", e);
			throw e;
		}
	}

	// Render main HTML
	async _renderHTML(_context, _options) {
		this._excData = await hlp_readUserExclusions();
		this._collectSettings();

		const cols = "grid-template-columns: minmax(220px,1.2fr) minmax(240px,1.6fr) 90px minmax(320px,2fr) 96px;";
		const css =
			`#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important;overflow:hidden}
			.bbmm-as-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}
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
			.bbmm-grid-body .bbmm-exc-act{display:inline-flex;align-items:center;justify-content:center;min-width:80px;height:32px;padding:0 12px;font-size:.95rem;line-height:1}
			.bbmm-grid-body .bbmm-exc-act.bbmm-exc-done{pointer-events:none;opacity:.75;font-weight:700}
			.bbmm-as-footer{
				display:flex;
				justify-content:center;
				align-items:center;
				width:100%;
				padding:.5rem 0;
				margin-top:.25rem;
				border-top:1px solid var(--color-border,#444);
			}
			.bbmm-as-footer button{min-width:160px}`;

		const moduleList = this._buildModuleList();
		const moduleOpts = ['<option value=""></option>']
			.concat(moduleList.map(m => `<option value="${foundry.utils.escapeHTML(m.ns)}"${this._moduleFilter===m.ns?" selected":""}>${foundry.utils.escapeHTML(m.title)}</option>`))
			.join("");

		const head = `<div class="bbmm-grid-head" id="bbmm-as-head">${this._renderHeader()}</div>`;
		const rowsHtml = (Array.isArray(this._rows) ? this._rows : []).map(r => this._rowHTML(r)).join("");
		const body = `<div class="bbmm-grid-body" id="bbmm-as-body">${rowsHtml}</div>`;

		return (
			`<style>${css}</style>
			<section class="bbmm-as-root">
				<div class="bbmm-toolbar">
					<select id="bbmm-as-module" title="${foundry.utils.escapeHTML(LT.module())}">${moduleOpts}</select>
					<input id="bbmm-as-filter" type="text" placeholder="${foundry.utils.escapeHTML(LT.macro.search())}" value="${foundry.utils.escapeHTML(this._filterText ?? "")}" />
					<span class="count" style="opacity:.85;font-weight:600">${LT.macro.showing()} <span id="bbmm-as-count">0</span> ${LT.macro.of()} <span id="bbmm-as-total">${(this._rows || []).length}</span></span>
				</div>
				${head}
				${body}
				<div class="bbmm-as-footer">
					<button type="button" id="bbmm-as-close">${foundry.utils.escapeHTML(LT.buttons.close())}</button>
				</div>
			</section>`
		);
	}

	// Replace HTML and bind listeners
	async _replaceHTML(result, _options) {
		const winEl = this.element;
		try {
			winEl.style.minWidth = this._minW + "px";
			winEl.style.maxWidth = this._maxW + "px";
			winEl.style.minHeight = this._minH + "px";
			winEl.style.maxHeight = this._maxH + "px";
			winEl.style.overflow = "hidden";
		} catch (e) { DL(2, "exclusions.js | AddSetting: size clamp failed", e); }

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
			DL(2, "exclusions.js | _onRender(): help inject failed", e);
		}	

		// Apply visibility immediately (blank until module selected)
		this._applyFilterToDOM();

		// Warm previews on initial render only if module already selected
		if (String(this._moduleFilter ?? "").trim()) {
			this._warmVisiblePreviews(50);
		}

		// Bind delegated listeners ONCE
		if (this._delegated) return;
		this._delegated = true;

		// Debounced text filter
		this.element.addEventListener("input", (ev) => {
			const t = ev.target;
			if (!(t instanceof HTMLElement)) return;
			if (t.id !== "bbmm-as-filter") return;

			this._filterText = String(t.value ?? "");
			if (this._debounceT) clearTimeout(this._debounceT);

			this._debounceT = setTimeout(() => {
				DL("exclusions.js | AddSetting: applying text filter");
				this._applyFilterToDOM();
			}, this._debounceMs);
		});

		// Module dropdown change
		this.element.addEventListener("change", (ev) => {
			const t = ev.target;
			if (!(t instanceof HTMLElement)) return;
			if (t.id !== "bbmm-as-module") return;

			this._moduleFilter = String(t.value ?? "");
			DL(`exclusions.js | AddSetting: module filter changed to '${this._moduleFilter || "(none)"}'`);

			this._applyFilterToDOM();
			this._warmVisiblePreviews(50);
		});

		// Click handling: close + exclude + expand/collapse + copy
		this.element.addEventListener("click", async (ev) => {
			try {
				const target = ev.target;
				if (!(target instanceof HTMLElement)) return;

				// Footer Close button (from _renderHTML): close + reopen manager
				const footerClose = target.closest?.("#bbmm-as-close");
				if (footerClose) {
					ev.preventDefault();
					ev.stopPropagation();

					DL("exclusions.js | AddSetting: footer close clicked, reopening manager");
					try { this.close({ force: true }); } catch {}

					setTimeout(() => {
						try {
							(globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.();
						} catch (e) {
							DL(3, "exclusions.js | AddSetting: reopen manager failed", e);
						}
					}, 0);

					return;
				}

				const rowEl = target.closest(".row");

				// Exclude button
				const btn = target.closest?.(".bbmm-exc-act");
				if (btn instanceof HTMLButtonElement) {
					ev.preventDefault();
					ev.stopPropagation();

					const ns = btn.dataset.ns || "";
					const key = btn.dataset.key || "";
					if (!ns || !key) return;

					try {
						btn.disabled = true;

						const row = this._rows?.find?.(r => r.namespace === ns && r.key === key);
						if (row?.__isMenu) await this._excludeMenu(ns, key);
						else await this._exclude(ns, key);

						// Remove row from data + DOM immediately
						this._rows = (this._rows || []).filter(r => !(r.namespace === ns && r.key === key));
						rowEl?.remove?.();

						DL(`exclusions.js | AddSetting: excluded ${ns}.${key} (removed from list)`);
						this._applyFilterToDOM();
					} catch (e) {
						btn.disabled = false;
						DL(3, "exclusions.js | AddSetting: exclude failed", e);
						ui.notifications?.error(`${LT.errors.failedToAddExclusion()}.`);
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
									DL(2, "exclusions.js | AddSetting: copy read value failed", { ns, key, err: eRead });
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
								DL(`exclusions.js | AddSetting: copied ${ns}.${key} to clipboard`);
								ui.notifications?.info(LT.copiedToClipboard());
							} else {
								DL(2, "exclusions.js | AddSetting: copyPlainText failed", { ns, key });
								ui.notifications?.warn(LT.failedCopyToClipboard());
							}
						} catch (e) {
							DL(2, "exclusions.js | AddSetting: copy handler failed", e);
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

				// Expand/collapse value cell
				if (rowEl && target.closest(".c-val")) {
					// If the click was on an interactive element, do not toggle the row
					if (target.closest("button, a, input, select, textarea, label")) return;

					const wasExpanded = rowEl.classList.contains("expanded");
					rowEl.classList.toggle("expanded");

					if (!wasExpanded) {
						const pre = rowEl.querySelector(".val-pre");
						if (pre && pre.dataset.loaded !== "1") {
							const ns = String(rowEl.dataset.ns || "");
							const key = String(rowEl.dataset.key || "");
							if (!ns || !key) return;

							// Find row model (if present) but DO NOT depend on cached __pretty
							const r = this._rows?.find?.(x => x.namespace === ns && x.key === key);

							// Menu rows should never be shown (you also wanted to filter these out anyway)
							if (r?.__isMenu) {
								pre.textContent = "";
								pre.dataset.loaded = "1";
								return;
							}

							try {
								const v = game.settings.get(ns, key);
								const preview = this._toPreview(v);
								const pretty = this._toPretty(v);

								// Update the visible preview code cell (if it exists)
								const codeEl = rowEl.querySelector(".val-preview code");
								if (codeEl) {
									codeEl.textContent = preview;
									codeEl.title = preview;
								}

								// Show expanded pretty value
								pre.textContent = pretty;

								// Optional cache if your other logic wants it later
								if (r) {
									r.__value = v;
									r.__preview = preview;
									r.__pretty = pretty;
									r.__valLoaded = true;
								}
							} catch (e) {
								DL(2, "exclusions.js | AddSetting: expand value read failed", { ns, key, err: e });
								pre.textContent = "";
							}

							pre.dataset.loaded = "1";
						}
					}
					return;
				}

				// Generic close buttons (just close)
				const closeBtn = target.closest?.('button[data-action="cancel"], [data-action="close"], .bbmm-close');
				if (closeBtn) {
					try { this.close({ force: true }); } catch {}
					return;
				}
			} catch (e) {
				DL(2, "exclusions.js | AddSetting: click handler error", e);
			}
		});
	}
}

/* BBMMExclusionsAppV2 ========================================================
    - Lists current exclusions from persistent settings
   ========================================================================= */
class BBMMExclusionsAppV2 extends foundry.applications.api.ApplicationV2 {
	
	constructor() {
		super({
			id: "bbmm-exclusions-manager",
			window: { title: LT.titleExclusions() },	
			width: 640,
			height: 500,
			resizable: true,
			classes: ["bbmm-exclusions-app"]
		});
		this._minW = 400;
		this._maxW = 800;
		this._minH = 300;
		this._maxH = 700;
	}
	
	/* ============================================================================
		{LABEL HELPERS}
	============================================================================ */
	
	//	Resolve a module title from a namespace; fallback to the namespace itself.
	_getModuleTitle(ns) {
		// most modules use their id as namespace; fall back gracefully
		const mod = game.modules.get(ns);
		return String(mod?.title ?? ns ?? "");
	}

	//	Resolve a setting display name; fallback to the raw key if unnamed.
	_getSettingLabel(ns, key) {
		// Try a real setting entry first
		const entry = game.settings.settings.get(`${ns}.${key}`);
		if (entry) {
			const raw = entry?.name ?? "";
			const label = raw ? game.i18n.localize(String(raw)) : "";
			if (label) return label;
		}

		// If not a setting (placeholder), fall back to the menu label
		try {
			const menu = game.settings.menus.get(`${ns}.${key}`);
			if (menu?.name) {
				return game.i18n.localize(String(menu.name));
			}
		} catch { /* ignore */ }

		// Final fallback
		return String(key);
	}

	// Remove a module from exclusions.modules
	async _removeExcludedModule(moduleId) {
		try {
			const data = foundry.utils.duplicate(await hlp_readUserExclusions({ force: true }));
			const list = Array.isArray(data.modules) ? data.modules : [];
			const next = list.filter(id => id !== moduleId);
			data.modules = next;

			const removed = (next.length !== list.length);
			if (!removed) {
				DL(`exclusions.js | _removeExcludedModule(): nothing to remove for ${moduleId}`);
				return;
			}

			const ok = await hlp_writeUserExclusions(data);
			if (!ok) {
				DL(3, `exclusions.js | _removeExcludedModule(): FAILED writing persistent storage for ${moduleId}`);
				throw new Error("Failed to write exclusions");
			}

			try { this._excData = data; } catch {}
			DL(`exclusions.js | _removeExcludedModule(): removed ${moduleId}`);
		} catch (e) {
			DL(3, "exclusions.js | _removeExcludedModule(): failed", e);
			throw e;
		}
	}

	// Remove a {namespace,key} from exclusions.settings
	async _removeExcludedSetting(namespace, key) {
		try {
			const data = foundry.utils.duplicate(await hlp_readUserExclusions({ force: true }));
			const list = Array.isArray(data.settings) ? data.settings : [];
			const next = list.filter(s => !(s?.namespace === namespace && s?.key === key));
			data.settings = next;

			const removed = (next.length !== list.length);
			if (!removed) {
				DL(`exclusions.js | _removeExcludedSetting(): nothing to remove for ${namespace}.${key}`);
				return;
			}

			const ok = await hlp_writeUserExclusions(data);
			if (!ok) {
				DL(3, `exclusions.js | _removeExcludedSetting(): FAILED writing persistent storage for ${namespace}.${key}`);
				throw new Error("Failed to write exclusions");
			}

			try { this._excData = data; } catch {}
			DL(`exclusions.js | _removeExcludedSetting(): removed ${namespace}.${key}`);
		} catch (e) {
			DL(3, "exclusions.js | _removeExcludedSetting(): failed", e);
			throw e;
		}
	}

	// Simple Yes/Cancel confirm using DialogV2 
	async _confirmDelete(message) {
		return new Promise((resolve) => {
			try {
				const host = document.createElement("div");	
				const p = document.createElement("p");
				p.textContent = message;
				host.appendChild(p);

				const dlg = new foundry.applications.api.DialogV2({
					window: { title: LT.confirmRemoval() },
					content: host,
					buttons: [
						{
							action: "yes",
							label: LT.buttons.yes(),
							default: true,
							callback: () => { try { dlg.close(); } catch {} resolve(true); }
						},
						{
							action: "cancel",
							label: LT.buttons.cancel(),
							callback: () => { try { dlg.close(); } catch {} resolve(false); }
						}
					],
					// Fallbacks (e.g., Esc / X / backdrop)
					submit: (_ctx) => { try { dlg.close(); } catch {} resolve(false); },
					rejectClose: () => resolve(false)
				});
				// Bring to front 
				const onRender = (app) => {
					if (app !== dlg) return;
					Hooks.off("renderDialogV2", onRender);
					try { dlg.bringToFront?.(); } catch {}
					try { app.element.style.zIndex = "99999"; } catch {}
				};
				Hooks.on("renderDialogV2", onRender);
				dlg.render(true);
			} catch (e) {
				DL(3, "exclusions.js | _confirmDelete(): failed", e);
				resolve(false);
			}
		});
	}

	// Get current exclusions data
	_getExclusions() {
		const ex = this._excData || {};
		const modules = Array.isArray(ex.modules) ? ex.modules : [];
		const settings = Array.isArray(ex.settings) ? ex.settings : [];
		return { modules, settings };
	}

	// Build _rows from current exclusions
	_buildRows() {
		const ex = this._getExclusions();
		const rows = [];

		// Modules
		for (const id of (ex.modules ?? [])) {
			const mod   = game.modules.get(id);
			const title = String(mod?.title ?? id);
			rows.push({ type: "Module", identifier: title, _id: id });
		}

		// Settings (single push per pair)
		const seen = new Set(); // guard against duplicates
		for (const s of (ex.settings ?? [])) {
			const ns  = String(s?.namespace ?? "");
			const key = String(s?.key ?? "");
			if (!ns || !key) continue;

			const sig = `${ns}::${key}`;
			if (seen.has(sig)) continue;
			seen.add(sig);

			const modTitle = String(game.modules.get(ns)?.title ?? ns);

			let label = "";
			const entry = game.settings.settings.get(`${ns}.${key}`);
			const nm = entry?.name;
			if (typeof nm === "string" && nm.trim()) {
				try { label = game.i18n?.localize?.(nm) || nm; }
				catch { label = nm; }
			} else {
				label = key;
			}

			rows.push({
				type: "Setting",
				identifier: `${modTitle}, ${label}`,
				_id: sig,
				_ns: ns,
				_key: key
			});
		}

		this._rows = rows;
	}

	// Render main HTML
	async _renderHTML() {
		// Build rows (modules + settings)
		const exc = this._excData ?? await hlp_readUserExclusions({ force: true });
		this._excData = exc;

		const mods = Array.isArray(exc.modules)  ? exc.modules  : [];
		const sets = Array.isArray(exc.settings) ? exc.settings : [];

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
						aria-label="${LT.inclusions.remove?.() ?? "Remove"}">
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
						<tbody>${rows || `<tr><td colspan="3" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">${LT.debugLevelNone()}.</td></tr>`}</tbody>
					</table>
				</div>

				<div class="bbmm-footer">
					<button type="button" class="bbmm-footer-close" data-action="close">${LT.buttons.close()}</button>
				</div>
			</section>
		`;

		return html;
	}

	// Replace HTML and bind listeners
	async _replaceHTML(result, _options) {
		// Clamp window
		const winEl = this.element;
		try {
			winEl.style.minWidth  = "560px";
			winEl.style.maxWidth  = "920px";
			winEl.style.minHeight = "360px";
			winEl.style.maxHeight = "800px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "exclusions.js | Manager: size clamp failed", e); }

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
			DL(2, "exclusions.js | _onRender(): help inject failed", e);
		}

		// avoid double-binding across re-renders
		if (!this._delegated) {
			this._delegated = true;

			content.addEventListener("click", async (ev) => {
				// find the nearest button with either a data-action or the delete class
				const btn = ev.target?.closest?.('button[data-action], button.bbmm-x-del');
				if (!btn) return;

				ev.preventDefault();
				ev.stopPropagation();

				const action = btn.dataset.action || "";
				DL(`exclusions.js | Manager.click(): ${action || btn.className}`);

				// Close (bottom button) or header X
				if (action === "close" || action === "cancel" || btn.classList.contains("bbmm-close")) {
					try { this.close({ force: true }); } catch {}
					return;
				}

				// Open Add Setting Exclusion
				if (action === "add-setting") {
					try { this.close({ force: true }); } catch {}
					setTimeout(() => {
						try { (globalThis.bbmm?.openAddSettingExclusionApp || globalThis.openAddSettingExclusionApp)?.(); }
						catch (e) { DL(3, "exclusions.js | openAddSettingExclusionApp(): failed", e); }
					}, 0);
					return;
				}

				// Open Add Module Exclusion
				if (action === "add-module") {
					try { this.close({ force: true }); } catch {}
					setTimeout(() => {
						try { (globalThis.bbmm?.openAddModuleExclusionApp || globalThis.openAddModuleExclusionApp)?.(); }
						catch (e) { DL(3, "exclusions.js | openAddModuleExclusionApp(): failed", e); }
					}, 0);
					return;
				}

				// Immediate delete — NO PROMPT
				if (btn.classList.contains("bbmm-x-del")) {
					const type = btn.dataset.type || "";
					const ns   = btn.dataset.ns   || "";
					const key  = btn.dataset.key  || "";

					try {
						btn.disabled = true;

						const data = foundry.utils.duplicate(await hlp_readUserExclusions({ force: true }));

						if (type === "module" && ns) {
							const list = Array.isArray(data.modules) ? data.modules : [];
							const before = list.length;
							data.modules = list.filter(x => x !== ns);
							const removed = (data.modules.length !== before);

							if (!removed) {
								btn.disabled = false;
								DL(`exclusions.js | delete(module): nothing to remove for ${ns}`);
								return;
							}

							const ok = await hlp_writeUserExclusions(data);
							if (!ok) {
								btn.disabled = false;
								DL(3, `exclusions.js | delete(module): FAILED writing exclusions for ${ns}`);
								ui.notifications?.error("Failed to remove exclusion. See console.");
								return;
							}

							try { this._excData = data; } catch {}
							try { Hooks.callAll("bbmmExclusionsChanged", { type: "module", namespace: ns, removed: true }); } catch {}
							DL(`exclusions.js | delete(module): ${ns}`);
							await this.render(true);
							return;
						}

						if (type === "setting" && ns && key) {
							const list = Array.isArray(data.settings) ? data.settings : [];
							const before = list.length;
							data.settings = list.filter(s => !(s?.namespace === ns && s?.key === key));
							const removed = (data.settings.length !== before);

							if (!removed) {
								btn.disabled = false;
								DL(`exclusions.js | delete(setting): nothing to remove for ${ns}.${key}`);
								return;
							}

							const ok = await hlp_writeUserExclusions(data);
							if (!ok) {
								btn.disabled = false;
								DL(3, `exclusions.js | delete(setting): FAILED writing exclusions for ${ns}.${key}`);
								ui.notifications?.error("Failed to remove exclusion. See console.");
								return;
							}

							try { this._excData = data; } catch {}
							try { Hooks.callAll("bbmmExclusionsChanged", { type: "setting", namespace: ns, key, removed: true }); } catch {}
							DL(`exclusions.js | delete(setting): ${ns}.${key}`);
							await this.render(true);
							return;
						}

						// Fallback (missing ids)
						btn.disabled = false;
						DL(2, "exclusions.js | delete: unknown type or missing ids", { type, ns, key });
					} catch (e) {
						btn.disabled = false;
						DL(3, "exclusions.js | delete: failed", e);
						ui.notifications?.error("Failed to remove exclusion. See console.");
					}
					return;
				}
			});
		}
	}

}

// PUBLIC LAUNCHERS
export function openExclusionsManagerApp() {
	// DL('openExclusionsManagerApp(): fired'); 
	new BBMMExclusionsAppV2().render(true);
}

export function openAddModuleExclusionApp() {
	// DL('openAddModuleExclusionApp(): fired');
	new BBMMAddModuleExclusionAppV2().render(true);
}

export function openAddSettingExclusionApp() {
	// DL('openAddSettingExclusionApp(): fired');
	new BBMMAddSettingExclusionAppV2().render(true);
}



