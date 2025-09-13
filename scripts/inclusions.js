/* BBMM Inclusions (Hidden Settings) =========================================
	- Lets GM include specific *hidden* settings (config:false) in preset saves
	- Mirrors the UX of exclusions manager but scoped to settings-only
	- Storage key: game.settings.get("bbmm", "userInclusions") -> { settings: [{namespace,key}] }
============================================================================ */

import { DL } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";
import { getSkipMap, isExcludedWith } from './helpers.js';

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

					// Skip already included
					if (included.has(`${ns}::${key}`)) continue;

					// Labels
					const mod = game.modules.get(ns);
					const nsLabel = String(mod?.title ?? ns);
					const rawName = entry?.name ?? "";
					const label = rawName ? game.i18n.localize(String(rawName)) : key;
					const scope = String(entry?.scope ?? "");
                    // skip if in EXPORT_SKIP in settings.js
                    if (isExcludedWith(skipMap, ns) || isExcludedWith(skipMap, ns, key)) {
                        // Optional debug trace
                        DL(`inclusions.js | _collectSettings(): skipped by EXPORT_SKIP -> ${ns}.${key}`);
                        continue;
                    }
					rows.push({ ns, key, nsLabel, label, scope });
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
					<h3 style="margin:0;flex:1;">${LT.inclusions.addSetting()}</h3>
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
        // clamp (optional, keep if you like)
        try {
            const winEl = this.element;
            winEl.style.minWidth  = "520px";
            winEl.style.maxWidth  = "760px";
            winEl.style.minHeight = "360px";
            winEl.style.maxHeight = "800px";
            winEl.style.overflow  = "hidden";
        } catch (e) { DL(2, "inclusions.js | Add: size clamp failed", e); }

        // write HTML
        const content = this.element.querySelector(".window-content") || this.element;
        content.innerHTML = result;

        // avoid double-binding across re-renders
        if (this._delegated) return;
        this._delegated = true;

        /* ============================================================================
		    {LISTENERS — event delegation (like exclusions.js)}
	    ============================================================================ */
        content.addEventListener("click", async (ev) => {
            // Include row
            const incBtn = ev.target.closest?.(".bbmm-inc-act");
            if (incBtn instanceof HTMLButtonElement) {
                const ns = incBtn.dataset.ns || "";
                const key = incBtn.dataset.key || "";
                if (!ns || !key) return;

                try {
                    DL(`inclusions.js | Add: include ${ns}.${key}`);
                    incBtn.disabled = true;
                    await this._include(ns, key);
                    try { this.close({ force: true }); } catch {}
                    (globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.();
                } catch (e) {
                    incBtn.disabled = false;
                    DL(3, "inclusions.js | Add: include failed", e);
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
		const all = this._getInclusions();
		const rows = all.map(s => {
			const nsLabel = this._getNsLabel(s.namespace);
			const label = this._getSettingLabel(s.namespace, s.key);
			const entry = game.settings.settings.get(`${s.namespace}.${s.key}`);
			const scope = String(entry?.scope ?? "");
			return `
				<tr>
					<td class="c-ns" title="${foundry.utils.escapeHTML(s.namespace)}">${foundry.utils.escapeHTML(nsLabel)}</td>
					<td class="c-setting" title="${foundry.utils.escapeHTML(s.key)}">${foundry.utils.escapeHTML(label)}</td>
					<td class="c-scope">${foundry.utils.escapeHTML(scope)}</td>
					<td class="c-act">
						<button type="button" class="bbmm-inc-remove" data-ns="${foundry.utils.escapeHTML(s.namespace)}" data-key="${foundry.utils.escapeHTML(s.key)}">${LT.inclusions.remove()}</button>
					</td>
				</tr>
			`;
		}).join("");

		return `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-im-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-im-toolbar{display:flex;align-items:center;gap:8px}
				.bbmm-im-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-im-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}
				.bbmm-im-table thead th{
					position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);
					border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left
				}
				.bbmm-im-table thead th:first-child{width:30%}
				.bbmm-im-table thead th:nth-child(3){width:90px}
				.bbmm-im-table thead th:last-child{width:96px;text-align:right}
				.bbmm-im-table tbody td{border-bottom:1px solid var(--color-border-light-2);padding:6px 10px;vertical-align:top}
				.bbmm-im-table .c-ns{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.bbmm-im-table .c-setting{overflow:hidden;text-overflow:ellipsis}
				.bbmm-im-table .c-scope{text-transform:capitalize;opacity:.85}
				.bbmm-im-table .c-act{display:flex;justify-content:flex-end}
				.bbmm-im-table .bbmm-inc-remove{min-width:88px;height:32px;padding:0 12px}
				.bbmm-im-table .c-empty{text-align:center;padding:18px 0}
			</style>

			<section class="bbmm-im-root">
				<div class="bbmm-im-toolbar">
					<h3 style="margin:0;">${LT.inclusions.manager()}</h3>
					<div class="spacer" style="flex:1;"></div>
					<button type="button" data-action="add">${LT.inclusions.addSetting()}</button>
				</div>

				<div class="bbmm-im-scroller">
					<table class="bbmm-im-table">
						<thead><tr><th>${LT.module()}</th><th>${LT.setting()}</th><th>${LT.scope()}</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="4" class="c-empty">${LT.inclusions.none()}.</td></tr>`}</tbody>
					</table>
				</div>
			</section>
		`;
	}

	async _replaceHTML(result, _options) {
        // clamp (optional, keep if you like)
        try {
            const winEl = this.element;
            winEl.style.minWidth  = "520px";
            winEl.style.maxWidth  = "760px";
            winEl.style.minHeight = "360px";
            winEl.style.maxHeight = "800px";
            winEl.style.overflow  = "hidden";
        } catch (e) { DL(2, "inclusions.js | Manager: size clamp failed", e); }

        // write HTML
        const content = this.element.querySelector(".window-content") || this.element;
        content.innerHTML = result;

        // avoid double-binding across re-renders
        if (this._delegated) return;
        this._delegated = true;

        /* ============================================================================
            {LISTENERS — event delegation (like exclusions.js)}
        ============================================================================ */
        content.addEventListener("click", async (ev) => {
            // Add Setting
            const addBtn = ev.target.closest?.('button[data-action="add"]');
            if (addBtn instanceof HTMLButtonElement) {
                try { this.close({ force: true }); } catch {}
                (globalThis.bbmm?.openAddSettingInclusionApp || globalThis.openAddSettingInclusionApp)?.();
                return;
            }

            // Remove inclusion
            const delBtn = ev.target.closest?.(".bbmm-inc-remove");
            if (delBtn instanceof HTMLButtonElement) {
                const ns  = delBtn.dataset.ns  || "";
                const key = delBtn.dataset.key || "";
                if (!ns || !key) return;

                try {
                    delBtn.disabled = true;
                    await this._remove(ns, key);
                    await this.render(true);
                } catch (e) {
                    delBtn.disabled = false;
                    DL(3, "inclusions.js | Manager: remove inclusion failed", e);
                    ui.notifications?.error(LT.inclusions.failedRemoveInclusion());
                }
                return;
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

export function openAddSettingInclusionApp() {
	new BBMMAddSettingInclusionAppV2().render(true);
}

// Ensure namespace once
globalThis.bbmm ??= {};
Object.assign(globalThis.bbmm, {
	openInclusionsManagerApp,
	openAddSettingInclusionApp
});