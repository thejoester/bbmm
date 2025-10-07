/* BBMM Inclusions (Hidden Settings) =========================================
	- Lets GM include specific *hidden* settings (config:false) in preset saves
	- Mirrors the UX of exclusions manager but scoped to settings-only
	- Storage key: game.settings.get("bbmm", "userInclusions") -> { settings: [{namespace,key}] }
============================================================================ */

import { DL } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";
import { getSkipMap, isExcludedWith } from './helpers.js';

/* Menu -> Setting expansion (so presets include real settings) */
const MENU_TO_SETTINGS = {
	"core.fonts": () => ["core.fonts"],
	"core.webrtc": () => ["core.rtcClientSettings", "core.rtcWorldSettings"],
	"core.prototypeTokenOverrides": () => ["core.prototypeTokenOverrides"]
};

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
			width: 760,
			height: 560,
			resizable: true,
			classes: ["bbmm-inclusions-app"]
		});
		this._rows = [];
	}

	/* ============================================================================
		{DATA HELPERS}
	============================================================================ */

	_getIncludedPairsSet() {
		const inc = game.settings.get(BBMM_ID, "userInclusions") || {};
		const arr = Array.isArray(inc.settings) ? inc.settings : [];
		const set = new Set(arr.map(s => `${s?.namespace ?? ""}::${s?.key ?? ""}`));
		return set;
	}

	_collectSettings() {
		try {
            const skipMap = getSkipMap();
			const included = this._getIncludedPairsSet();
			const rows = [];

			for (const [, entry] of game.settings.settings.entries()) {
				try {
					const ns = String(entry?.namespace ?? "").trim();
					const key = String(entry?.key ?? "").trim();
					if (!ns || !key) continue;

					// Only HIDDEN settings (config:false)
					if (entry?.config !== false) continue;

					if (isExcludedWith(skipMap, ns) || isExcludedWith(skipMap, ns, key)) {
						DL(`inclusions.js | _collectSettings(): skipped by EXPORT_SKIP -> ${ns}.${key}`);
						continue;
					}

					// Skip already included
					if (included.has(`${ns}::${key}`)) continue;

					// Labels
					const mod = game.modules.get(ns);
					const nsLabel = String(mod?.title ?? ns);
					const rawName = entry?.name ?? "";
					const label = rawName ? game.i18n.localize(String(rawName)) : key;
					const scope = String(entry?.scope ?? "");

					rows.push({ ns, key, nsLabel, label, scope });
				} catch (e1) {
					DL(2, "inclusions.js | AddSetting._collectSettings(): item failed", e1);
				}
			}

			/* Also list registerMenu entries so users can include them =================== */
			try {
				for (const [menuId, menu] of game.settings.menus.entries()) {
					const dot = menuId.indexOf(".");
					if (dot <= 0) continue;
					const ns = menuId.slice(0, dot);
					const key = menuId.slice(dot + 1);

					// Display-only row; expand to real settings on Include
					const mod = game.modules.get(ns);
					const nsLabel = String(mod?.title ?? ns);
					const label = menu?.name ? game.i18n.localize(String(menu.name)) : key;
					const scope = menu?.restricted ? "world" : "client";

					rows.push({ ns, key, nsLabel, label, scope, __isMenu: true });
				}
				DL("inclusions.js | _collectSettings(): menus appended to rows");
			} catch (e) {
				DL(2, "inclusions.js | _collectSettings(): menu enumeration failed", e);
			}

			// Sort by module label then setting label
			rows.sort((a, b) =>
				a.nsLabel.localeCompare(b.nsLabel, game.i18n.lang || undefined, { sensitivity: "base" }) ||
				a.label.localeCompare(b.label, game.i18n.lang || undefined, { sensitivity: "base" })
			);

			this._rows = rows;
			DL("inclusions.js | AddSetting._collectSettings(): built", { count: rows.length });
		} catch (e) {
			DL(3, "inclusions.js | AddSetting._collectSettings(): failed to enumerate settings", e);
			this._rows = [];
		}
	}

	async _include(namespace, key) {
		const data = game.settings.get(BBMM_ID, "userInclusions") || {};
		if (!Array.isArray(data.settings)) data.settings = [];
		const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
		if (!exists) data.settings.push({ namespace, key });
		await game.settings.set(BBMM_ID, "userInclusions", data);
		try { Hooks.callAll("bbmmInclusionsChanged", { type: "setting", namespace, key }); } catch {}
	}

	/* ============================================================================
		{RENDER}
	============================================================================ */

	async _renderHTML() {
		this._collectSettings();

		const rows = this._rows.map(r => `
			<tr>
				<td class="c-ns" title="${foundry.utils.escapeHTML(r.ns)}">${foundry.utils.escapeHTML(r.nsLabel)}</td>
				<td class="c-setting" title="${foundry.utils.escapeHTML(r.key)}">${foundry.utils.escapeHTML(r.label)}</td>
				<td class="c-scope">${foundry.utils.escapeHTML(r.scope)}</td>
				<td class="c-act">
					<button type="button" class="bbmm-inc-act" data-ns="${foundry.utils.escapeHTML(r.ns)}" data-key="${foundry.utils.escapeHTML(r.key)}">
						${LT.inclusions.include()}
					</button>
				</td>
			</tr>
		`).join("");

		return `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-ai-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-ai-toolbar{display:flex;align-items:center;gap:8px}
				.bbmm-ai-count{opacity:.85;font-weight:600}
				.bbmm-ai-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-ai-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}
				.bbmm-ai-table thead th{
					position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);
					border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left
				}
				.bbmm-ai-table thead th:first-child{width:30%}
				.bbmm-ai-table thead th:nth-child(3){width:90px}
				.bbmm-ai-table thead th:last-child{width:96px;text-align:right}
				.bbmm-ai-table tbody td{border-bottom:1px solid var(--color-border-light-2);padding:6px 10px;vertical-align:top}
				.bbmm-ai-table .c-ns{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.bbmm-ai-table .c-setting{overflow:hidden;text-overflow:ellipsis}
				.bbmm-ai-table .c-scope{text-transform:capitalize;opacity:.85}
				.bbmm-ai-table .c-act{display:flex;justify-content:flex-end}
				.bbmm-ai-table .bbmm-inc-act{min-width:88px;height:32px;padding:0 12px}
				.bbmm-ai-table .c-empty{text-align:center;padding:18px 0}
				.bbmm-ai-footer{display:flex;gap:.5rem;justify-content:flex-end;padding:8px}
			</style>

			<section class="bbmm-ai-root">
				<div class="bbmm-ai-toolbar">
					<h3 style="margin:0;flex:1;">${LT.inclusions.addSettingTitle()}</h3>
					<div class="bbmm-ai-count">${LT.available()}: ${this._rows.length}</div>
				</div>

				<div class="bbmm-ai-scroller">
					<table class="bbmm-ai-table">
						<thead><tr><th>${LT.module()}</th><th>${LT.setting()}</th><th>${LT.scope()}</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="4" class="c-empty">${LT.inclusions.noHidden()}.</td></tr>`}</tbody>
					</table>
				</div>

				<footer class="bbmm-ai-footer">
					<button type="button" data-action="cancel">${LT.buttons.close()}</button>
				</footer>
			</section>
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
        } catch (e) { DL(2, "inclusions.js | Add: size clamp failed", e); }

        const content = this.element.querySelector(".window-content") || this.element;
        content.innerHTML = result;

        if (this._delegated) return;
        this._delegated = true;

        /* ============================================================================
		    {LISTENERS — event delegation}
	    ============================================================================ */
        content.addEventListener("click", async (ev) => {
            const incBtn = ev.target.closest?.(".bbmm-inc-act");
			if (incBtn instanceof HTMLButtonElement) {
				const ns = incBtn.dataset.ns || "";
				const key = incBtn.dataset.key || "";
				if (!ns || !key) return;

				try {
					DL(`inclusions.js | Add: include ${ns}.${key}`);
					incBtn.disabled = true;

					const row = this._rows.find(r => r.ns === ns && r.key === key);
					if (row?.__isMenu) {
						await this._includeMenu(ns, key);
					} else {
						await this._include(ns, key);
					}

					try { this.close({ force: true }); } catch {}
					(globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.();
				} catch (e) {
					incBtn.disabled = false;
					DL(3, "inclusions.js | Add: include failed", e);
					ui.notifications?.error(LT.inclusions.failedAddInclusion());
				}
				return;
			}

            const cancel = ev.target.closest?.('button[data-action="cancel"]');
            if (cancel instanceof HTMLButtonElement) {
                try { this.close({ force: true }); } catch {}
                (globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.();
                return;
            }
        });
    }

}

/* attach menu include helper AFTER class */
BBMMAddSettingInclusionAppV2.prototype._includeMenu = async function(menuNs, menuKey) {
	try {
		const pairs = await _resolveMenuIdsToPairs(menuNs, menuKey);
		if (!pairs.length) {
			DL(2, `inclusions.js | _includeMenu(): no resolvable settings for ${menuNs}.${menuKey}`);
			return;
		}

		const data = foundry.utils.duplicate(game.settings.get(BBMM_ID, "userInclusions") || {});
		if (!Array.isArray(data.settings)) data.settings = [];

		let added = 0;
		for (const { namespace, key } of pairs) {
			const exists = data.settings.some((s) => s?.namespace === namespace && s?.key === key);
			if (!exists) {
				data.settings.push({ namespace, key });
				added++;
				DL(`inclusions.js | _includeMenu(): added ${namespace}.${key} from ${menuNs}.${menuKey}`);
			}
		}

		if (added > 0) {
			await game.settings.set(BBMM_ID, "userInclusions", data);
			try { Hooks.callAll("bbmmInclusionsChanged", { type: "menu", id: `${menuNs}.${menuKey}`, added }); } catch {}
		}
	} catch (e) {
		DL(2, "inclusions.js | _includeMenu() failed", e);
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

	_collectModules() {
	try {
		const data = game.settings.get(BBMM_ID, "userInclusions") || {};
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
		const data = game.settings.get(BBMM_ID, "userInclusions") || {};
		if (!Array.isArray(data.modules)) data.modules = [];
		if (!data.modules.includes(ns)) data.modules.push(ns);
		await game.settings.set(BBMM_ID, "userInclusions", data);
		try { Hooks.callAll("bbmmInclusionsChanged", { type: "module", namespace: ns }); } catch {}
	}

	async _renderHTML() {
		this._collectModules();

		const rows = this._rows.map(r => `
			<tr>
				<td class="c-ns" title="${foundry.utils.escapeHTML(r.ns)}">${foundry.utils.escapeHTML(r.title)}</td>
				<td class="c-active">${r.active ? "✓" : ""}</td>
				<td class="c-act">
					<button type="button" class="bbmm-inc-mod-act" data-ns="${foundry.utils.escapeHTML(r.ns)}">${LT.inclusions.include()}</button>
				</td>
			</tr>
		`).join("");

		return `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-am-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-am-toolbar{display:flex;align-items:center;gap:8px}
				.bbmm-am-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-am-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}
				.bbmm-am-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-am-table thead th:first-child{width:70%}
				.bbmm-am-table thead th:nth-child(2){width:80px}
				.bbmm-am-table thead th:last-child{width:120px;text-align:right}
				.bbmm-am-table tbody td{border-bottom:1px solid var(--color-border-light-2);padding:6px 10px;vertical-align:middle}
				.bbmm-am-table .c-ns{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.bbmm-am-table .c-act{display:flex;justify-content:flex-end}
				.bbmm-am-table .bbmm-inc-mod-act{min-width:96px;height:32px;padding:0 12px}
				.bbmm-am-table .c-empty{text-align:center;padding:18px 0}
			</style>

			<section class="bbmm-am-root">
				<div class="bbmm-am-toolbar">
					<h3 style="margin:0;">${LT.inclusions.addModuleTitle()}</h3>
					<div class="spacer" style="flex:1;"></div>
					<button type="button" data-action="cancel">${LT.buttons.close()}</button>
				</div>
				<div class="bbmm-am-scroller">
					<table class="bbmm-am-table">
						<thead><tr><th>${LT.module()}</th><th>${LT.inclusions.active()}</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="3" class="c-empty">${LT.inclusions.none()}.</td></tr>`}</tbody>
					</table>
				</div>
			</section>
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

		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			// Include Module
			const incBtn = ev.target.closest?.(".bbmm-inc-mod-act");
			if (incBtn instanceof HTMLButtonElement) {
				const ns = incBtn.dataset.ns || "";
				if (!ns) return;
				try {
					incBtn.disabled = true;
					const data = game.settings.get(BBMM_ID, "userInclusions") || {};
					if (!Array.isArray(data.modules)) data.modules = [];
					if (!data.modules.includes(ns)) data.modules.push(ns);
					await game.settings.set(BBMM_ID, "userInclusions", data);
					try { Hooks.callAll("bbmmInclusionsChanged", { type: "module", namespace: ns }); } catch {}
					try { this.close({ force: true }); } catch {}
					(globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.();
				} catch (e) {
					incBtn.disabled = false;
					DL(3, "inclusions.js | AddModule.include failed", e);
					ui.notifications?.error(LT.inclusions.failedAddInclusion());
				}
				return;
			}

			// Close
			const cancel = ev.target.closest?.('button[data-action="cancel"]');
			if (cancel instanceof HTMLButtonElement) {
				try { this.close({ force: true }); } catch {}
				(globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.();
				return;
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

	_getInclusions() {
		const inc = game.settings.get(BBMM_ID, "userInclusions") || {};
		const arr = Array.isArray(inc.settings) ? inc.settings : [];
		return arr.filter(s => !!s?.namespace && !!s?.key);
	}

	_getNsLabel(ns) {
		const mod = game.modules.get(ns);
		return String(mod?.title ?? ns ?? "");
	}

	_getSettingLabel(ns, key) {
		const entry = game.settings.settings.get(`${ns}.${key}`);
		const nm = entry?.name ?? "";
		if (nm) {
			try { return game.i18n.localize(String(nm)); }
			catch { /* fall through */ }
		}
		return String(key);
	}

	async _remove(namespace, key) {
		const data = game.settings.get(BBMM_ID, "userInclusions") || {};
		if (!Array.isArray(data.settings)) data.settings = [];
		data.settings = data.settings.filter(s => !(s?.namespace === namespace && s?.key === key));
		await game.settings.set(BBMM_ID, "userInclusions", data);
		try { Hooks.callAll("bbmmInclusionsChanged", { type: "setting", namespace, key, removed: true }); } catch {}
	}

	/* ============================================================================
		{RENDER}
	============================================================================ */

	async _renderHTML() {
		// Build rows (modules + settings) to mirror Exclusions UI
		const inc = game.settings.get(BBMM_ID, "userInclusions") || {};
		const mods = Array.isArray(inc.modules)  ? inc.modules  : [];
		const sets = Array.isArray(inc.settings) ? inc.settings : [];

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
			// Identifier matches exclusions style: "<Module Title>, <Setting Label>"
			const entry = game.settings.settings.get(`${ns}.${key}`);
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
			</section>
		`;

		return html;
	}

	async _replaceHTML(result, _options) {
		// Clamp + layout (match exclusions)
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

		// avoid double-binding across re-renders
		if (this._delegated) return;
		this._delegated = true;

		// Footer Close (mirror exclusions)
		const footer = document.createElement("footer");
		footer.style.display = "flex";
		footer.style.justifyContent = "center";
		footer.style.padding = "8px";
		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.dataset.action = "cancel";
		cancelBtn.textContent = LT.buttons.close();
		cancelBtn.addEventListener("click", () => {
			try { this.close({ force: true }); } catch {}
		});
		footer.appendChild(cancelBtn);
		content.appendChild(footer);

		content.addEventListener("click", async (ev) => {
			const btn = ev.target.closest?.("button[data-action], .bbmm-x-del");
			if (!(btn instanceof HTMLButtonElement)) return;

			ev.preventDefault();
			ev.stopPropagation();

			const action = btn.dataset.action || "";
			DL(`inclusions.js | BBMMInclusionsAppV2.click(): ${action}`);

			if (action === "add-module") {

				// Add Module (confirm first)
				const addModuleBtn = ev.target.closest?.('button[data-action="add-module"]');
				if (addModuleBtn instanceof HTMLButtonElement) {
					
					// Build the dialog body with a proper content-link, styled orange
					const uuid = "Compendium.bbmm.bbmm-journal.JournalEntry.u3uUIp6Jfg8411Pn.JournalEntryPage.Q3JVPh8ykzMc3kLS";
					const docLink = `<a class="bbmm-doc-link content-link" data-uuid="${uuid}" style="color: orange;">${LT.inclusions.addModuleWarnSeeDoc()}</a>`;
					const raw = LT.inclusions.addModuleWarnMsg({ docLink });

					// Enrich (async to get content-link handled)
					const contentHtml = await TextEditor.enrichHTML(raw, { async: true });

					// Temporary handler to catch clicks on the doc link
					const onDocLinkClick = async (e) => {
						const a = e.target?.closest?.(".bbmm-doc-link");
						if (!a) return;

						e.preventDefault();
						e.stopPropagation();

						try {
							DL("inclusions.js | add-module dialog: opening documentation UUID", { uuid: a.dataset.uuid });

							const doc = await fromUuid(a.dataset.uuid);

							// JournalEntryPage → open parent JournalEntry to that page, read-only
							if (doc?.documentName === "JournalEntryPage") {
								const parent = doc.parent;
								if (parent?.sheet) {
									if (typeof parent.view === "function") {
										await parent.view({ pageId: doc.id });
									} else {
										await parent.sheet.render(true, { pageId: doc.id, editable: false });
									}
									return;
								}
							}

							// JournalEntry → open read-only
							if (doc?.documentName === "JournalEntry" && doc.sheet) {
								if (typeof doc.view === "function") {
									await doc.view();
								} else {
									await doc.sheet.render(true, { editable: false });
								}
								return;
							}

							// Fallback
							if (doc?.sheet) {
								await doc.sheet.render(true);
								return;
							}

							ui.notifications?.warn("Document not found or no sheet.");
						} catch (err) {
							DL(3, "inclusions.js | add-module dialog: failed to open documentation", err);
							ui.notifications?.error("Failed to open Documentation (see console).");
						}
					};
					document.addEventListener("click", onDocLinkClick, true);

					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: game.i18n.localize("bbmm.inclusions.addModuleWarnTitle") || "Include Entire Module?" },
						content: contentHtml,
						defaultYes: false,
						ok: { label: game.i18n.localize("bbmm.buttons.yes") },
						cancel: { label: game.i18n.localize("bbmm.buttons.no") }
					}).finally(() => {
						// Always remove the temporary handler when the dialog resolves
						document.removeEventListener("click", onDocLinkClick, true);
					});

					DL(`inclusions.js | Manager: add-module confirm -> ${ok ? "YES" : "NO"}`);

					if (!ok) return;

					// Proceed: close manager, open Add Module picker
					try { this.close({ force: true }); } catch {}
					(globalThis.bbmm?.openAddModuleInclusionApp || globalThis.openAddModuleInclusionApp)?.();
					return;
				}
			}

			if (action === "add-setting") {
				try { this.close({ force: true }); } catch {}
				setTimeout(() => {
					try { (globalThis.bbmm?.openAddSettingInclusionApp || globalThis.openAddSettingInclusionApp)?.(); }
					catch (e) { DL(3, "inclusions.js | openAddSettingInclusionApp(): failed", e); }
				}, 0);
				return;
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
						const data = game.settings.get(BBMM_ID, "userInclusions") || {};
						const mods = Array.isArray(data.modules) ? data.modules : [];
						data.modules = mods.filter(x => x !== ns);
						await game.settings.set(BBMM_ID, "userInclusions", data);
						try { Hooks.callAll("bbmmInclusionsChanged", { type: "module", namespace: ns, removed: true }); } catch {}
						await this.render(true);
					} catch (e) {
						btn.disabled = false;
						DL(3, "inclusions.js | delete(module): failed", e);
						ui.notifications?.error(LT.inclusions.failedRemoveInclusion());
					}
					return;
				}

				if (type === "setting" && ns && key) {
					// Remove setting inclusion (use existing helper)
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