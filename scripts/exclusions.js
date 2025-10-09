
/* BBMM Exclusions ============================================================
	- Lists all modules not already excluded
	- Shows Enabled/Disabled state
	- "Exclude" updates setting, closes, then re-opens manager
============================================================================ */

import { DL } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";

//	Ensure namespace once
globalThis.bbmm ??= {};

//	Register on bbmm namespace
Object.assign(globalThis.bbmm, {
	openExclusionsManagerApp,
	openAddModuleExclusionApp,
	openAddSettingExclusionApp
});

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

	_getExcludedIds() {
		const ex = game.settings.get("bbmm", "userExclusions") || {};
		return new Set(Array.isArray(ex.modules) ? ex.modules : []);
	}

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

	async _exclude(id) {
		const data = game.settings.get("bbmm", "userExclusions") || {};
		if (!Array.isArray(data.modules)) data.modules = [];
		if (!data.modules.includes(id)) data.modules.push(id);
		await game.settings.set("bbmm", "userExclusions", data);
		try { Hooks.callAll("bbmmExclusionsChanged", { type: "module", id }); } catch {}
	}

	async _renderHTML(_context, _options) {
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

			// Footer "Cancel"/"Close" should just close
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
			width: 760,
			height: 500,
			resizable: true,
			classes: ["bbmm-exclusions-app"]
		});
		this._minW = 420;
		this._maxW = 1000;
		this._minH = 320;
		this._maxH = 720;

		this._rows = [];
	}

	/* ============================================================================
		{DATA HELPERS}
	============================================================================ */
	_getExcludedPairsSet() {
		const ex = game.settings.get("bbmm", "userExclusions") || {};
		const arr = Array.isArray(ex.settings) ? ex.settings : [];
		const set = new Set(arr.map(s => `${s?.namespace ?? ""}::${s?.key ?? ""}`));
		return set;
	}

	_collectSettings() {
		// Build the table model for Add Setting Exclusion
		try {
			// Already-excluded pairs as a Set of "ns::key"
			const excluded = this._getExcludedPairsSet();
			const rows = [];

			for (const s of game.settings.settings.values()) {
				try {
					const ns  = String(s?.namespace ?? "");
					const key = String(s?.key ?? "");
					const scope = String(s?.scope ?? "client");	// "world" | "client" | "user"
					if (!ns || !key) continue;

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

					rows.push({ namespace: ns, key, modTitle, setTitle, scope });
				} catch (e1) {
					DL(2, "AddSetting._collectSettings() item failed", e1);
				}
			}

			// Also list registerMenu entries as exclude-able placeholders
			try {
				for (const [menuId, menu] of game.settings.menus.entries()) {
					const dot = menuId.indexOf(".");
					if (dot <= 0) continue;

					const ns  = String(menuId.slice(0, dot));
					const key = String(menuId.slice(dot + 1));
					if (!ns || !key) continue;

					// skip already excluded
					const pairKey = `${ns}::${key}`;
					if (excluded.has(pairKey)) continue;

					// Module title (fallback to namespace)
					const mod = game.modules.get(ns);
					const modTitle = String(mod?.title ?? ns);

					// Menu label (localized if provided)
					let setTitle = key;
					try {
						if (menu?.name) {
							const nm = game.i18n.localize(String(menu.name));
							setTitle = nm || key;
						}
					} catch { /* keep fallback */ }

					const scope = menu?.restricted ? "world" : "client";

					// Mark this as a menu row; exclusion will store a placeholder pair
					rows.push({ namespace: ns, key, modTitle, setTitle, scope, __isMenu: true });
				}
				DL("exclusions.js | AddSetting._collectSettings(): menus appended", { count: rows.length });
			} catch (e) {
				DL(2, "exclusions.js | AddSetting._collectSettings(): menu enumeration failed", e);
			}

			// Sort by module title, then setting title
			rows.sort((a, b) =>
				a.modTitle.localeCompare(b.modTitle, game.i18n.lang || undefined, { sensitivity: "base" }) ||
				a.setTitle.localeCompare(b.setTitle, game.i18n.lang || undefined, { sensitivity: "base" })
			);

			this._rows = rows;
			DL("AddSetting._collectSettings(): built", { count: rows.length });
		} catch (e) {
			DL(3, "AddSetting._collectSettings(): failed to enumerate settings", e);
			this._rows = [];
		}
	}

	// Add {namespace,key} to userExclusions.settings
	async _exclude(namespace, key) {
		const data = game.settings.get("bbmm", "userExclusions") || {};
		if (!Array.isArray(data.settings)) data.settings = [];
		const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
		if (!exists) data.settings.push({ namespace, key });
		await game.settings.set("bbmm", "userExclusions", data);
		try { Hooks.callAll("bbmmExclusionsChanged", { type: "setting", namespace, key }); } catch {}
	}

	// Special case: exclude a menu placeholder
	async _excludeMenu(namespace, key) {
		try {
			const data = game.settings.get("bbmm", "userExclusions") || {};
			if (!Array.isArray(data.settings)) data.settings = [];
			const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
			if (!exists) data.settings.push({ namespace, key });
			await game.settings.set("bbmm", "userExclusions", data);
			try { Hooks.callAll("bbmmExclusionsChanged", { type: "menu", namespace, key }); } catch {}
			DL(`exclusions.js | _excludeMenu(): stored placeholder for ${namespace}.${key}`);
		} catch (e) {
			DL(3, "exclusions.js | _excludeMenu() failed", e);
			throw e;
		}
	}

	async _renderHTML(_context, _options) {
		this._collectSettings();

		const rows = this._rows.map(r => `
			<tr>
				<td class="c-mod" title="${foundry.utils.escapeHTML(r.namespace)}">${foundry.utils.escapeHTML(r.modTitle)}</td>
				<td class="c-setting" title="${foundry.utils.escapeHTML(`${r.namespace}.${r.key}`)}">${foundry.utils.escapeHTML(r.setTitle)}</td>
				<td class="c-scope">${r.scope}</td>
				<td class="c-act">
					<button type="button" class="bbmm-exc-act" data-ns="${foundry.utils.escapeHTML(r.namespace)}" data-key="${foundry.utils.escapeHTML(r.key)}">${LT.buttons.exclude()}</button>
				</td>
			</tr>
		`).join("");

		const html = `
			<style>
				/* App layout */
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-as-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-as-toolbar{display:flex;align-items:center;gap:8px}
				.bbmm-as-count{opacity:.85;font-weight:600}

				.bbmm-as-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-as-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}

				/* Header */
				.bbmm-as-table thead th{
					position:sticky;top:0;z-index:1;
					background:var(--color-bg-header,#1f1f1f);
					border-bottom:2px solid var(--color-border-light-2);
					padding:8px 10px;text-align:left
				}
				/* Column plan: Module (fixed), Setting (auto), Scope (fixed), Action (fixed, right) */
				.bbmm-as-table thead th:first-child{width:30%}          	/* Module */
				.bbmm-as-table thead th:nth-child(3){width:90px}        	/* Scope */
				.bbmm-as-table thead th:last-child{width:96px;text-align:right} /* Action */

				/* Body */
				.bbmm-as-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-as-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}

				/* Cells */
				.bbmm-as-table .c-mod{
					width:30%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis
				}
				.bbmm-as-table .c-setting{
					width:auto;overflow:hidden;text-overflow:ellipsis
				}
				.bbmm-as-table .c-scope{
					width:90px;text-transform:capitalize;opacity:.85
				}
				.bbmm-as-table .c-act{
					width:96px;
					display:flex;justify-content:flex-end;align-items:center;
					padding-right:8px
				}

				/* Exclude button — larger click target */
				.bbmm-as-table .bbmm-exc-act{
					display:inline-flex;align-items:center;justify-content:center;
					min-width:80px;			/* roomy for the word "Exclude" */
					height:32px;			/* bigger tap/click area */
					padding:0 12px;
					font-size:0.95rem;
					line-height:1;
				}

				/* Optional: clearer focus for keyboard users */
				.bbmm-as-table .bbmm-exc-act:focus-visible{
					outline:2px solid var(--color-border-highlight,#79c);
					outline-offset:2px;
				}

				.bbmm-as-table .bbmm-exc-act.bbmm-exc-done{
					pointer-events:none;
					opacity:.75;
					font-weight:700;
				}
			</style>

			<section class="bbmm-as-root">
				<div class="bbmm-as-toolbar">
					<h3 style="margin:0;flex:1;">${LT.addSettingExclusion()}</h3>
					<div class="bbmm-as-count">${LT.available()}: ${this._rows.length}</div>
				</div>

				<div class="bbmm-as-scroller">
					<table class="bbmm-as-table">
						<thead>
							<tr><th>${LT.module()}</th><th>${LT.setting()}</th><th>${LT.scope()}</th><th></th></tr>
						</thead>
						<tbody>${rows || `<tr><td colspan="4" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">${LT.noEligSettingFound()}.</td></tr>`}</tbody>
					</table>
				</div>
			</section>
		`;

		return html;
	}

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

		// Append footer with Cancel that reopens manager
		const footer = document.createElement("footer");
		footer.classList.add("form-footer");
		footer.style.display = "flex";
		footer.style.justifyContent = "flex-end";
		footer.style.marginTop = "0.75rem";

		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.innerText = LT.buttons.close();
		closeBtn.addEventListener("click", () => {
			DL("exclusions.js | AddSetting.closeBtn(): reopen manager");
			try { this.close({ force: true }); } catch {}
			setTimeout(() => {
				try {
					(globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.();
				} catch (e) { DL(3, "exclusions.js | AddSetting.closeBtn(): reopen failed", e); }
			}, 0);
		});

		footer.appendChild(closeBtn);
		content.appendChild(footer);

		// Delegated click: Exclude 
		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			const btn = ev.target.closest?.(".bbmm-exc-act");
			if (btn instanceof HTMLButtonElement) {
				ev.preventDefault();
				ev.stopPropagation();

				const ns  = btn.dataset.ns  || "";
				const key = btn.dataset.key || "";
				if (!ns || !key) return;

				try {
					btn.disabled = true;

					// menu or setting?
					const row = this._rows?.find?.(r => r.namespace === ns && r.key === key);
					if (row?.__isMenu) {
						await this._excludeMenu(ns, key);   // placeholder
					} else {
						await this._exclude(ns, key);       // normal setting pair
					}

					// Keep dialog open; mark on success
					btn.classList.add("bbmm-exc-done");
					btn.setAttribute("aria-label", "Excluded");
					btn.innerHTML = "✓";
					btn.disabled = true;
					DL("exclusions.js | AddSetting: row marked as excluded");
				} catch (e) {
					btn.disabled = false;
					DL(3, "exclusions.js | AddSetting.exclude failed", e);
					ui.notifications?.error(`${LT.errors.failedToAddExclusion()}.`);
				}
				return;
			}

			// Footer "Cancel"/"Close" should close without reopening the manager
			const cancel = ev.target.closest?.('button[data-action="cancel"], [data-action="close"], .bbmm-close');
			if (cancel) {
				try { this.close({ force: true }); } catch {}
				return;
			}
		});
	}
}

/* BBMMExclusionsAppV2 ========================================================
    - Lists current exclusions from game.settings.get("bbmm","userExclusions")
	- Two buttons: Add Module / Add Setting (setting flow TBD)
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

	// Remove a module from userExclusions.settings 
	async _removeExcludedModule(moduleId) {
		try {
			const data = game.settings.get("bbmm", "userExclusions") || {};
			const list = Array.isArray(data.modules) ? data.modules : [];
			const next = list.filter(id => id !== moduleId);
			data.modules = next;
			await game.settings.set("bbmm", "userExclusions", data);
			DL(`exclusions.js | _removeExcludedModule(): removed ${moduleId}`);
		} catch (e) {
			DL(3, "exclusions.js | _removeExcludedModule(): failed", e);
			throw e;
		}
	}

	// Remove a {namespace,key} from userExclusions.settings 
	async _removeExcludedSetting(namespace, key) {
		try {
			const data = game.settings.get("bbmm", "userExclusions") || {};
			const list = Array.isArray(data.settings) ? data.settings : [];
			const next = list.filter(s => !(s?.namespace === namespace && s?.key === key));
			data.settings = next;
			await game.settings.set("bbmm", "userExclusions", data);
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

	_getExclusions() {
		const ex = game.settings.get("bbmm", "userExclusions") || {};
		const modules = Array.isArray(ex.modules) ? ex.modules : [];
		const settings = Array.isArray(ex.settings) ? ex.settings : [];
		return { modules, settings };
	}

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

	async _renderHTML(_context, _options) {
		// DL('_renderHTML(): fired');
		this._buildRows();

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
						title="${LT.removeFromExclusions()}">
						<i class="fas fa-trash"></i>
					</button>
				</td>
			</tr>
		`).join("");

		const html = `
			<style>
				/* Make the app body flex so the scroller can own overflow */
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-x-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}

				/* Toolbar: two fixed cells + spacer + count */
				.bbmm-x-toolbar{display:grid;grid-template-columns:auto auto 1fr max-content;align-items:center;column-gap:8px}
				.bbmm-x-toolbar .bbmm-btn{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}

				.bbmm-x-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-x-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}

				/* Header */
				.bbmm-x-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-x-table thead th:first-child{width:72px}          /* Type column tighter */
				.bbmm-x-table thead th:last-child{width:44px;text-align:right} /* Trash col */

				/* Body */
				.bbmm-x-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-x-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}

				/* Column widths */
				.bbmm-x-table .c-type{
					width:72px;                 /* match header */
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
				.bbmm-x-table .c-del{
					width:44px;                 /* match header */
					padding-right:8px;
					display:flex;
					justify-content:flex-end;   /* push trash right */
					align-items:center
				}

				/* Trash button sizing */
				.bbmm-x-table .bbmm-x-del{
					display:inline-flex;
					align-items:center;
					justify-content:center;
					width:28px;
					height:28px
				}

				.bbmm-x-count{opacity:.85;font-weight:600}
			</style>



			<section class="bbmm-x-root">
				<div class="bbmm-x-toolbar">
					<button type="button" class="bbmm-btn bbmm-x-add-module" data-action="add-module">${LT.buttons.addModule()}</button>
					<button type="button" class="bbmm-btn bbmm-x-add-setting" data-action="add-setting">${LT.buttons.	addSetting()}</button>
					<div></div>
					<div class="bbmm-x-count">${LT.total()}: ${this._rows.length}</div>
				</div>

				<div class="bbmm-x-scroller">
					<table class="bbmm-x-table">
						<thead><tr><th>${LT.type()}</th><th>${LT.identifier()}</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="3" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">${LT.noExclusionsYet()}.</td></tr>`}</tbody>
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
		} catch (e) { DL(2, "exclusions.js | BBMMExclusionsAppV2: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		// avoid double-binding across re-renders
		if (this._delegated) return;
		this._delegated = true;
		
		const footer = document.createElement("footer");
		footer.classList.add("form-footer");
		footer.style.display = "flex";
		footer.style.justifyContent = "flex-end";
		footer.style.marginTop = "0.75rem";

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.innerText = LT.buttons.close();
		cancelBtn.addEventListener("click", () => {
			DL("exclusions.js | ExclusionsManager.cancel(): close");
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
			DL(`exclusions.js | BBMMExclusionsAppV2.click(): ${action}`);

			if (action === "add-module") {
				try { this.close({ force: true }); } catch {}
				setTimeout(() => {
					try { openAddModuleExclusionApp(); }
					catch (e) { DL(3, "exclusions.js | openAddModuleExclusionApp(): failed", e); }
				}, 0);
				return;
			}

			if (action === "add-setting") {
				try { this.close({ force: true }); } catch {}
				setTimeout(() => {
					try { (globalThis.bbmm?.openAddSettingExclusionApp || globalThis.openAddSettingExclusionApp)?.(); }
					catch (e) { DL(3, "exclusions.js | openAddSettingExclusionApp(): failed", e); }
				}, 0);
				return;
			}
			
			// delete handling
			if (btn.classList.contains("bbmm-x-del")) {
				ev.preventDefault();
				ev.stopPropagation();

				const type = btn.dataset.type;
				if (type === "module") {
					const id = btn.dataset.id || "";
					if (!id) return;
					DL(`id: `, id);
					const mod = game.modules.get(id);
					const title = String(mod?.title ?? id);
					const ok = await this._confirmDelete(`${LT.confirmRemoveModuleExclusion({title: title })}?`);
					if (!ok) return;

					try {
						DL(`delete confirmed - firing _removeExcludedModule(id): `, id);
						btn.disabled = true;
						await this._removeExcludedModule(id);
						await this.render(true);	// re-render manager
					} catch (e) {
						btn.disabled = false;
						ui.notifications?.error(`${LT.errors.failedRemoveModuleExclusion()}.`);
					}
					return;
				}

				if (type === "setting") {
					// read attributes the button was rendered with
					const ns  = btn.dataset.ns  || "";
					const key = btn.dataset.key || "";
					if (!ns || !key) return;

					DL("exclusions.js | delete(setting): opening confirm", { ns, key });
					const ok = await this._confirmDelete(`${LT.confirmRemoveSettingExclusion({ ns: ns, key: key })}?`);
					if (!ok) return;

					try {
						btn.disabled = true;
						DL(`exclusions.js | delete confirmed - firing _removeExcludedSetting(): ${ns}.${key}`);
						await this._removeExcludedSetting(ns, key);
						await this.render(true); // refresh the list
					} catch (e) {
						btn.disabled = false;
						DL(3, "exclusions.js | _removeExcludedSetting() failed", e);
						ui.notifications?.error(LT.failRemoveSettingExclusion());
					}
					return;
				}
			}
			
		});
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



