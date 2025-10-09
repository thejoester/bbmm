
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

	// Add custom class for styling
	static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
		classes: [...(super.DEFAULT_OPTIONS?.classes ?? []), "bbmm-em-app"]
	});

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

	async _renderHTML() {
		// Collect rows
		let rows = [];
		try {
			if (typeof this._collectModules === "function") {
				await this._collectModules();
				rows = Array.isArray(this._rows) ? this._rows : [];
			} else {
				const data = game.settings.get(BBMM_ID, "userExclusions") || {};
				const excluded = new Set(Array.isArray(data.modules) ? data.modules : []);
				rows = Array.from(game.modules.values()).map(m => ({
					ns: m.id,
					title: String(m?.title ?? m.id),
					active: !!m.active,
					excluded: excluded.has(m.id)
				})).sort((a, b) => a.title.localeCompare(b.title, game.i18n.lang || undefined, { sensitivity: "base" }));
			}
		} catch (e) {
			DL(2, "exclusions.js | AddModule._renderHTML(): collect failed", e);
			rows = [];
		}
		this._rows = rows;

		const body = rows.map(r => `
			<tr>
				<td class="c-title" title="${foundry.utils.escapeHTML(r.title)}">${foundry.utils.escapeHTML(r.title)}</td>
				<td class="c-state">${r.active ? "✓" : ""}</td>
				<td class="c-act">
					<button type="button" class="bbmm-exc-mod-act" data-ns="${foundry.utils.escapeHTML(r.ns)}">
						${LT.buttons.exclude()}
					</button>
				</td>
			</tr>
		`).join("");

		return `
			<div class="bbmm-em-root">
				<div class="bbmm-em-scroller">
					<table class="bbmm-em-table">
						<thead><tr><th>Module</th><th>Active</th><th></th></tr></thead>
						<tbody>${body || `<tr><td colspan="3" style="text-align:center;opacity:.8;padding:18px 0">No modules found.</td></tr>`}</tbody>
					</table>
				</div>
				<div class="bbmm-footer">
					<button type="button" class="bbmm-footer-close" data-action="close">${LT.buttons.close()}</button>
				</div>
			</div>
		`;
	}

	async _replaceHTML(result, _options) {
		// Clamp window
		try {
			const winEl = this.element;
			winEl.style.minWidth  = "520px";
			winEl.style.maxWidth  = "760px";
			winEl.style.minHeight = "360px";
			winEl.style.maxHeight = "800px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "exclusions.js | AddModule: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			try {
				// Exclude module — do it directly, no helper
				const excBtn = ev.target.closest?.(".bbmm-exc-mod-act");
				if (excBtn instanceof HTMLButtonElement) {
					const ns = excBtn.dataset.ns || "";
					if (!ns) return;

					try {
						excBtn.disabled = true;

						const data = game.settings.get(BBMM_ID, "userExclusions") || {};
						const mods = Array.isArray(data.modules) ? data.modules : [];
						if (!mods.includes(ns)) mods.push(ns);
						data.modules = mods;

						await game.settings.set(BBMM_ID, "userExclusions", data);
						try { Hooks.callAll("bbmmExclusionsChanged", { type: "module", namespace: ns }); } catch {}

						excBtn.classList.add("bbmm-exc-done");
						excBtn.innerHTML = "✓";
						DL(`exclusions.js | AddModule: excluded ${ns}`);
					} catch (e) {
						excBtn.disabled = false;
						DL(3, "exclusions.js | AddModule: exclude failed", e);
						ui.notifications?.error("Failed to add exclusion. See console.");
					}
					return;
				}

				// Close -> return to Exclusions Manager
				const closeBtn = ev.target.closest?.('[data-action="close"], [data-action="cancel"], .bbmm-close');
				if (closeBtn) {
					DL("exclusions.js | AddModule: close");
					try { this.close({ force: true }); } catch {}
					try { (globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.(); } catch {}
					return;
				}
			} catch (e) {
				DL(2, "exclusions.js | AddModule: click error", e);
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

	// Add custom class for styling
	static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
		classes: [...(super.DEFAULT_OPTIONS?.classes ?? []), "bbmm-es-app"]
	});

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
					const scope = String(s?.scope ?? "client");	
					if (!ns || !key) continue;

					const pairKey = `${ns}::${key}`;
					if (excluded.has(pairKey)) continue; 

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

	async _renderHTML() {
		// Ensure collector ran 
		try {
			if (typeof this._collectSettings === "function") {
				await this._collectSettings();
			}
		} catch (e) {
			DL(2, "exclusions.js | AddSetting._renderHTML(): _collectSettings failed", e);
		}
		const rows = Array.isArray(this._rows) ? this._rows : [];

		const body = rows.map(r => {
			const ns  = String(r.ns ?? r.namespace ?? "");
			const key = String(r.key ?? r._key ?? "");
			const mod = game.modules.get(ns);
			// FIX: group ?? and || so TS is happy
			const nsLabel = String((mod?.title ?? ns) || "—");
			const entry = game.settings.settings.get(`${ns}.${key}`);
			const label = entry?.name ? game.i18n.localize(String(entry.name)) : (key || "—");
			const scope = String(entry?.scope ?? r.scope ?? "").toLowerCase() || "world";

			return `
				<tr>
					<td class="c-ns" title="${foundry.utils.escapeHTML(ns)}">${foundry.utils.escapeHTML(nsLabel)}</td>
					<td class="c-setting" title="${foundry.utils.escapeHTML(key)}">${foundry.utils.escapeHTML(label)}</td>
					<td class="c-scope">${foundry.utils.escapeHTML(scope)}</td>
					<td class="c-act">
						<button type="button" class="bbmm-exc-act" data-ns="${foundry.utils.escapeHTML(ns)}" data-key="${foundry.utils.escapeHTML(key)}">
							${LT.buttons.exclude()}
						</button>
					</td>
				</tr>
			`;
		}).join("");

		return `
			<div class="bbmm-es-root">
				<div class="bbmm-es-scroller">
					<table class="bbmm-es-table">
						<thead><tr><th>Module</th><th>Setting</th><th>Scope</th><th></th></tr></thead>
						<tbody>${body || `<tr><td colspan="4" style="text-align:center;opacity:.8;padding:18px 0">No settings found.</td></tr>`}</tbody>
					</table>
				</div>
				<div class="bbmm-footer">
					<button type="button" class="bbmm-footer-close" data-action="close">${LT.buttons.close()}</button>
				</div>
			</div>
		`;
	}

	async _replaceHTML(result, _options) {
		// Clamp window
		try {
			const winEl = this.element;
			winEl.style.minWidth  = "520px";
			winEl.style.maxWidth  = "760px";
			winEl.style.minHeight = "360px";
			winEl.style.maxHeight = "800px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "exclusions.js | AddSetting: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			try {
				// Exclude a setting — do it directly, no helper dependency
				const excBtn = ev.target.closest?.(".bbmm-exc-act");
				if (excBtn instanceof HTMLButtonElement) {
					const ns  = excBtn.dataset.ns  || "";
					const key = excBtn.dataset.key || "";
					if (!ns || !key) return;

					try {
						excBtn.disabled = true;

						const data = game.settings.get(BBMM_ID, "userExclusions") || {};
						const list = Array.isArray(data.settings) ? data.settings : [];
						if (!list.some(s => s?.namespace === ns && s?.key === key)) {
							list.push({ namespace: ns, key });
						}
						data.settings = list;

						await game.settings.set(BBMM_ID, "userExclusions", data);
						try { Hooks.callAll("bbmmExclusionsChanged", { type: "setting", namespace: ns, key }); } catch {}

						excBtn.classList.add("bbmm-exc-done");
						excBtn.innerHTML = "✓";
						DL(`exclusions.js | AddSetting: excluded ${ns}.${key}`);
					} catch (e) {
						excBtn.disabled = false;
						DL(3, "exclusions.js | AddSetting: exclude failed", e);
						ui.notifications?.error("Failed to add exclusion. See console.");
					}
					return;
				}

				// Close -> return to Exclusions Manager
				const closeBtn = ev.target.closest?.('[data-action="close"], [data-action="cancel"], .bbmm-close');
				if (closeBtn) {
					DL("exclusions.js | AddSetting: close");
					try { this.close({ force: true }); } catch {}
					try { (globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.(); } catch {}
					return;
				}
			} catch (e) {
				DL(2, "exclusions.js | AddSetting: click error", e);
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

	// Add custom class for styling
	static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
		classes: [...(super.DEFAULT_OPTIONS?.classes ?? []), "bbmm-exc-mgr-app"]
	});
	
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



