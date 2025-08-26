import { DL } from './settings.js';
const BBMM_ID = "bbmm";

/* ============================================================================
	BBMMAddModuleExclusionAppV2
	- Lists all modules not already excluded
	- Shows Enabled/Disabled state
	- "Exclude" updates setting, closes, then re-opens manager
   ========================================================================== 
*/
class BBMMAddModuleExclusionAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-exclusions-add-module",
			window: { title: "BBMM — Add Module Exclusion" },
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

	/* ---------------------------------------------------------------------- */
	/* Data                                                                   */
	/* ---------------------------------------------------------------------- */

	_getExcludedIds() {
		const ex = game.settings.get("bbmm", "userExclusions") || {};
		return new Set(Array.isArray(ex.modules) ? ex.modules : []);
	}

	_collectCandidates() {
		const excluded = this._getExcludedIds();
		const out = [];
		for (const m of game.modules.values()) {
			if (m.id === "bbmm") continue;			// optional self-skip
			if (excluded.has(m.id)) continue;		// skip already excluded
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
				<td class="c-state">${m.active ? "Enabled" : "Disabled"}</td>
				<td class="c-act"><button type="button" class="bbmm-exc-act" data-id="${m.id}">Exclude</button></td>
			</tr>
		`).join("");

		const html = `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-am-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-am-toolbar{display:flex;align-items:center;gap:8px}
				.bbmm-am-count{opacity:.85;font-weight:600}

				.bbmm-am-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-am-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}
				.bbmm-am-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-am-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-am-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}
				.bbmm-am-table .c-title{width:auto}
				.bbmm-am-table .c-state{width:110px;white-space:nowrap;opacity:.85}
				.bbmm-am-table .c-act{width:90px;text-align:right}
			</style>

			<section class="bbmm-am-root">
				<div class="bbmm-am-toolbar">
					<h3 style="margin:0;flex:1;">Add Module Exclusion</h3>
					<div class="bbmm-am-count">Available: ${this._mods.length}</div>
				</div>

				<div class="bbmm-am-scroller">
					<table class="bbmm-am-table">
						<thead><tr><th>Module</th><th>State</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="3" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">All modules are already excluded.</td></tr>`}</tbody>
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

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.innerText = "Cancel";
		cancelBtn.addEventListener("click", () => {
			DL("AddModule.cancel(): reopen manager");
			try { this.close({ force: true }); } catch {}
			setTimeout(() => {
				try {
					(globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.();
				} catch (e) { DL(3, "AddModule.cancel(): reopen failed", e); }
			}, 0);
		});

		footer.appendChild(cancelBtn);
		content.appendChild(footer);

		content.addEventListener("click", async (ev) => {
			const btn = ev.target.closest?.(".bbmm-exc-act");
			if (!(btn instanceof HTMLButtonElement)) return;

			const id = btn.dataset.id || "";
			if (!id) return;

			try {
				btn.disabled = true;
				await this._exclude(id);
				try { this.close({ force: true }); } catch {}
				setTimeout(() => { try { openExclusionsManagerApp(); } catch (e) { DL(3,'reopen exclusions failed',e); } }, 0);
			} catch (e) {
				btn.disabled = false;
				DL(3, "exclude failed", e);
				ui.notifications?.error("Failed to add exclusion.");
			}
		});
	}

}

/* ============================================================================
	BBMMAddSettingExclusionAppV2
	- Lists all CONFIG settings not already excluded
	- Columns: Module (title or namespace), Setting (friendly name or key), Action
	- Exclude adds {namespace,key} to userExclusions.settings, then reopens manager
   ========================================================================== 
*/
class BBMMAddSettingExclusionAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-exclusions-add-setting",
			window: { title: "BBMM — Add Setting Exclusion" },
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

	/* ---------------------------------------------------------------------- */
	/* Data helpers                                                           */
	/* ---------------------------------------------------------------------- */

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

			// @type {{namespace:string,key:string,modTitle:string,setTitle:string}[]}
			const rows = [];

			for (const s of game.settings.settings.values()) {
				try {
					const ns  = String(s?.namespace ?? "");
					const key = String(s?.key ?? "");
					if (!ns || !key) continue;

					const pairKey = `${ns}::${key}`;
					if (excluded.has(pairKey)) continue;	// skip already excluded

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

					rows.push({ namespace: ns, key, modTitle, setTitle });
				} catch (e1) {
					DL(2, "AddSetting._collectSettings() item failed", e1);
				}
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

	async _exclude(namespace, key) {
		const data = game.settings.get("bbmm", "userExclusions") || {};
		if (!Array.isArray(data.settings)) data.settings = [];
		const exists = data.settings.some(s => s?.namespace === namespace && s?.key === key);
		if (!exists) data.settings.push({ namespace, key });
		await game.settings.set("bbmm", "userExclusions", data);
		try { Hooks.callAll("bbmmExclusionsChanged", { type: "setting", namespace, key }); } catch {}
	}

	async _renderHTML(_context, _options) {
		this._collectSettings();

		const rows = this._rows.map(r => `
			<tr>
				<td class="c-mod" title="${foundry.utils.escapeHTML(r.namespace)}">${foundry.utils.escapeHTML(r.modTitle)}</td>
				<td class="c-setting" title="${foundry.utils.escapeHTML(`${r.namespace}.${r.key}`)}">${foundry.utils.escapeHTML(r.setTitle)}</td>
				<td class="c-act">
					<button type="button" class="bbmm-exc-act" data-ns="${foundry.utils.escapeHTML(r.namespace)}" data-key="${foundry.utils.escapeHTML(r.key)}">Exclude</button>
				</td>
			</tr>
		`).join("");

		const html = `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-as-root{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto}
				.bbmm-as-toolbar{display:flex;align-items:center;gap:8px}
				.bbmm-as-count{opacity:.85;font-weight:600}

				.bbmm-as-scroller{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;background:rgba(255,255,255,.02)}
				.bbmm-as-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:.95rem}
				.bbmm-as-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-as-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-as-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}
				.bbmm-as-table .c-mod{width:40%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.bbmm-as-table .c-setting{width:45%;overflow:hidden;text-overflow:ellipsis}
				.bbmm-as-table .c-act{width:15%;text-align:right}
			</style>

			<section class="bbmm-as-root">
				<div class="bbmm-as-toolbar">
					<h3 style="margin:0;flex:1;">Add Setting Exclusion</h3>
					<div class="bbmm-as-count">Available: ${this._rows.length}</div>
				</div>

				<div class="bbmm-as-scroller">
					<table class="bbmm-as-table">
						<thead><tr><th>Module</th><th>Setting</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="3" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">No eligible settings found.</td></tr>`}</tbody>
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
		} catch (e) { DL(2, "AddSetting: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		// Append footer with Cancel that reopens manager
		const footer = document.createElement("footer");
		footer.classList.add("form-footer");
		footer.style.display = "flex";
		footer.style.justifyContent = "flex-end";
		footer.style.marginTop = "0.75rem";

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.innerText = "Cancel";
		cancelBtn.addEventListener("click", () => {
			DL("AddSetting.cancel(): reopen manager");
			try { this.close({ force: true }); } catch {}
			setTimeout(() => {
				try {
					(globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.();
				} catch (e) { DL(3, "AddSetting.cancel(): reopen failed", e); }
			}, 0);
		});

		footer.appendChild(cancelBtn);
		content.appendChild(footer);

		// Delegated click: Exclude 
		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			const btn = ev.target.closest?.(".bbmm-exc-act");
			if (!(btn instanceof HTMLButtonElement)) return;

			ev.preventDefault();
			ev.stopPropagation();

			const ns = btn.dataset.ns || "";
			const key = btn.dataset.key || "";
			if (!ns || !key) return;

			try {
				btn.disabled = true;
				await this._exclude(ns, key);
				try { this.close({ force: true }); } catch {}
				setTimeout(() => {
					try {
						(globalThis.bbmm?.openExclusionsManagerApp || globalThis.openExclusionsManagerApp)?.();
					} catch (e) { DL(3, "AddSetting.reopen manager failed", e); }
				}, 0);
			} catch (e) {
				btn.disabled = false;
				DL(3, "AddSetting.exclude failed", e);
				ui.notifications?.error("Failed to add setting exclusion.");
			}
		});
	}
}

/* ============================================================================
	BBMMExclusionsAppV2
	- Lists current exclusions from game.settings.get("bbmm","userExclusions")
	- Two buttons: Add Module / Add Setting (setting flow TBD)
	- Scrolls properly (flex column + min-height:0 + overflow:auto)
   ========================================================================== 
*/
class BBMMExclusionsAppV2 extends foundry.applications.api.ApplicationV2 {
	
	constructor() {
		super({
			id: "bbmm-exclusions-manager",
			window: { title: "BBMM Exclusions" },	
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
	
	/* ---------------------------------------------------------------------- */
	/* Label helpers                                                          */
	/* ---------------------------------------------------------------------- */

	//	Resolve a module title from a namespace; fallback to the namespace itself.
	_getModuleTitle(ns) {
		// most modules use their id as namespace; fall back gracefully
		const mod = game.modules.get(ns);
		return String(mod?.title ?? ns ?? "");
	}

	//	Resolve a setting display name; fallback to the raw key if unnamed.
	_getSettingLabel(ns, key) {
		const entry = game.settings.settings.get(`${ns}.${key}`);
		// entry?.name is often a localization key or a plain string; localize either way
		const raw = entry?.name ?? "";
		const label = raw ? game.i18n.localize(String(raw)) : "";
		return label || String(key);
	}
	
	
	/* ---------------------------------------------------------------------- */
	/* Data helpers                                                           */
	/* ---------------------------------------------------------------------- */
	
	// Remove a module from userExclusions.settings 
	async _removeExcludedModule(moduleId) {
		try {
			const data = game.settings.get("bbmm", "userExclusions") || {};
			const list = Array.isArray(data.modules) ? data.modules : [];
			const next = list.filter(id => id !== moduleId);
			data.modules = next;
			await game.settings.set("bbmm", "userExclusions", data);
			DL(`_removeExcludedModule(): removed ${moduleId}`);
		} catch (e) {
			DL(3, "_removeExcludedModule(): failed", e);
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
			DL(`_removeExcludedSetting(): removed ${namespace}.${key}`);
		} catch (e) {
			DL(3, "_removeExcludedSetting(): failed", e);
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
					window: { title: "Confirm Removal" },
					content: host,
					buttons: [
						{
							action: "yes",
							label: "Yes",
							default: true,
							callback: () => { try { dlg.close(); } catch {} resolve(true); }
						},
						{
							action: "cancel",
							label: "Cancel",
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
				DL(3, "_confirmDelete(): failed", e);
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
						title="Remove from exclusions">
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
				.bbmm-x-table thead th{position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1f1f1f);border-bottom:2px solid var(--color-border-light-2);padding:8px 10px;text-align:left}
				.bbmm-x-table tbody td{padding:8px 10px;border-bottom:1px solid var(--color-border-light-2);vertical-align:middle}
				.bbmm-x-table tbody tr:nth-child(odd){background:rgba(255,255,255,.03)}
				.bbmm-x-table .c-type{width:40px;white-space:nowrap;color:#9bd}
				.bbmm-x-table .c-id{width:"auto";font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-word}
				.bbmm-x-table .c-del{width:15px;text-align:center}
				.bbmm-x-count{opacity:.85;font-weight:600}
			</style>

			<section class="bbmm-x-root">
				<div class="bbmm-x-toolbar">
					<button type="button" class="bbmm-btn bbmm-x-add-module" data-action="add-module">Add Module</button>
					<button type="button" class="bbmm-btn bbmm-x-add-setting" data-action="add-setting">Add Setting</button>
					<div></div>
					<div class="bbmm-x-count">Total: ${this._rows.length}</div>
				</div>

				<div class="bbmm-x-scroller">
					<table class="bbmm-x-table">
						<thead><tr><th>Type</th><th>Identifier</th><th></th></tr></thead>
						<tbody>${rows || `<tr><td colspan="3" class="c-empty" style="text-align:center;opacity:.8;padding:18px 0">No exclusions yet.</td></tr>`}</tbody>
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
		} catch (e) { DL(2, "BBMMExclusionsAppV2: size clamp failed", e); }

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
		cancelBtn.innerText = "Cancel";
		cancelBtn.addEventListener("click", () => {
			DL("ExclusionsManager.cancel(): close");
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
			DL(`BBMMExclusionsAppV2.click(): ${action}`);

			if (action === "add-module") {
				try { this.close({ force: true }); } catch {}
				setTimeout(() => {
					try { openAddModuleExclusionApp(); }
					catch (e) { DL(3, "openAddModuleExclusionApp(): failed", e); }
				}, 0);
				return;
			}

			if (action === "add-setting") {
				try { this.close({ force: true }); } catch {}
				setTimeout(() => {
					try { (globalThis.bbmm?.openAddSettingExclusionApp || globalThis.openAddSettingExclusionApp)?.(); }
					catch (e) { DL(3, "openAddSettingExclusionApp(): failed", e); }
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
					const ok = await this._confirmDelete(`Remove module "${title}" from exclusions?`);
					if (!ok) return;

					try {
						DL(`delete confirmed - firing _removeExcludedModule(id): `, id);
						btn.disabled = true;
						await this._removeExcludedModule(id);
						await this.render(true);	// re-render manager
					} catch (e) {
						btn.disabled = false;
						ui.notifications?.error("Failed to remove module exclusion.");
					}
					return;
				}

				if (type === "setting") {
					// read attributes the button was rendered with
					const ns  = btn.dataset.ns  || "";
					const key = btn.dataset.key || "";
					if (!ns || !key) return;

					DL("delete(setting): opening confirm", { ns, key });
					const ok = await this._confirmDelete(`Remove setting "${ns}.${key}" from exclusions?`);
					if (!ok) return;

					try {
						btn.disabled = true;
						DL(`delete confirmed - firing _removeExcludedSetting(): ${ns}.${key}`);
						await this._removeExcludedSetting(ns, key);
						ui.notifications?.info(`Removed "${ns}.${key}" from exclusions.`);
						await this.render(true); // refresh the list
					} catch (e) {
						btn.disabled = false;
						DL(3, "_removeExcludedSetting() failed", e);
						ui.notifications?.error("Failed to remove setting exclusion.");
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
if (!globalThis.bbmm) globalThis.bbmm = {};
globalThis.bbmm.openAddSettingExclusionApp = function () {
	// DL("openAddSettingExclusionApp(): fired");
	new BBMMAddSettingExclusionAppV2().render(true);
};
// Expose on global so settings.js can call without imports
if (!globalThis.bbmm) globalThis.bbmm = {};
globalThis.bbmm.openExclusionsManagerApp = openExclusionsManagerApp;
globalThis.bbmm.openAddModuleExclusionApp = openAddModuleExclusionApp;
globalThis.openAddSettingExclusionApp = globalThis.bbmm.openAddSettingExclusionApp;