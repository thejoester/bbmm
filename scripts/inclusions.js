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

// Given a menu namespace+key, return true if we have a resolver function for it
function _bbmmIsMenuResolvable(ns, key) {
	const id = `${ns}.${key}`;
	return typeof MENU_TO_SETTINGS[id] === "function";
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

// Does a namespace have any hidden settings (config:false) we could include?
function _bbmmNamespaceHasHidden(ns) {
	try {
		for (const [id, entry] of game.settings.settings.entries()) {
			if (!id.startsWith(`${ns}.`)) continue;
			if (entry?.config === false) return true;
		}
	} catch (e) { DL(2, "inclusions.js | _bbmmNamespaceHasHidden() failed", e); }
	return false;
}

// Collect all hidden settings in a namespace (respecting skip map)
function _bbmmCollectHiddenPairsForNamespace(ns) {
	try {
		const pairs = [];
		const skipMap = getSkipMap();
		for (const [id, entry] of game.settings.settings.entries()) {
			if (!id.startsWith(`${ns}.`)) continue;
			if (entry?.config !== false) continue;
			const dot = id.indexOf(".");
			const key = entry?.key || id.slice(dot + 1);
			if (isExcludedWith(skipMap, ns) || isExcludedWith(skipMap, ns, key)) continue;
			pairs.push({ namespace: ns, key });
		}
		return pairs;
	} catch (e) {
		DL(2, "inclusions.js | _bbmmCollectHiddenPairsForNamespace() failed", e);
		return [];
	}
}

// Fallback prompt to include hidden settings in the same namespace as a menu
async function _promptIncludeHiddenSettingsForMenu(menuNs, menuKey) {
	try {
		// Collect hidden settings in the same namespace
		const entries = Array.from(game.settings.settings.entries());
		const hiddenInNs = entries
			.filter(([id, s]) => id.startsWith(`${menuNs}.`) && s?.config === false)
			.map(([id, s]) => {
				const dot = id.indexOf(".");
				return {
					id,
					namespace: id.slice(0, dot),
					key: id.slice(dot + 1),
					name: s?.name ?? id,
					hint: s?.hint ?? ""
				};
			})
			.sort((a, b) => a.key.localeCompare(b.key));

		if (!hiddenInNs.length) {
			DL(2, `inclusions.js | _promptIncludeHiddenSettingsForMenu(): no hidden settings in namespace ${menuNs}`);
			ui.notifications?.warn(LT.inclusions.noHiddenInNamespace?.({ ns: menuNs }) ?? `No hidden settings found in "${menuNs}".`);
			return 0;
		}

		// Build simple checkbox form
		const rows = hiddenInNs.map((r) => {
			const safeName = foundry.utils.escapeHTML(String(r.name ?? r.id));
			const safeHint = foundry.utils.escapeHTML(String(r.hint ?? ""));
			return `
				<tr>
					<td class="name"><label for="bbmm-inc-${r.id}">${safeName}</label></td>
					<td class="key"><code>${r.key}</code></td>
					<td class="pick"><input id="bbmm-inc-${r.id}" type="checkbox" name="keys" value="${r.id}"></td>
				</tr>`;
		}).join("");

		const content = `
			<style>
				.bbmm-inc-fallback { display:flex; flex-direction:column; gap:.5rem; }
				.bbmm-inc-fallback table { width:100%; border-collapse:collapse; }
				.bbmm-inc-fallback th, .bbmm-inc-fallback td { padding:.25rem .35rem; border-bottom:1px solid var(--color-border-light-2); }
				.bbmm-inc-fallback td.key { opacity:.8; }
				.bbmm-inc-fallback td.pick { text-align:center; width:64px; }
			</style>
			<div class="bbmm-inc-fallback">
				<p>${LT.inclusions.selectHiddenPrompt?.({ ns: menuNs, menu: menuKey }) ?? `Select hidden settings from "${menuNs}" to include:`}</p>
				<table>
					<thead><tr><th>${LT.common?.name?.() ?? "Name"}</th><th>Key</th><th>${LT.common?.include?.() ?? "Include"}</th></tr></thead>
					<tbody>${rows}</tbody>
				</table>
			</div>`;

		const result = await foundry.applications.api.DialogV2.confirm({
			window: { title: LT.inclusions.title?.() ?? "BBMM: Inclusions" },
			yes: () => true,
			no: () => false,
			content,
			modal: true,
			rejectClose: false,
			classes: ["bbmm-inclusions-app", "bbmm-inc-fallback-dialog"]
		});

		if (!result) return 0;

		// Read selected
		const html = document.querySelector(".bbmm-inc-fallback-dialog") ?? document.body;
		const checked = Array.from(html.querySelectorAll('input[name="keys"]:checked')).map((el) => el.value);

		if (!checked.length) return 0;

		// Apply inclusions
		const data = foundry.utils.duplicate(game.settings.get(BBMM_ID, "userInclusions") || {});
		if (!Array.isArray(data.settings)) data.settings = [];

		let added = 0;
		for (const id of checked) {
			const dot = id.indexOf(".");
			const namespace = id.slice(0, dot);
			const key = id.slice(dot + 1);
			const exists = data.settings.some((s) => s?.namespace === namespace && s?.key === key);
			if (!exists) {
				data.settings.push({ namespace, key });
				added++;
				DL(`inclusions.js | fallback add: ${namespace}.${key} (from ${menuNs}.${menuKey})`);
			}
		}
		if (added > 0) {
			await game.settings.set(BBMM_ID, "userInclusions", data);
			try { Hooks.callAll("bbmmInclusionsChanged", { type: "menu-fallback", id: `${menuNs}.${menuKey}`, added }); } catch {}
		}
		return added;
	} catch (e) {
		DL(2, "inclusions.js | _promptIncludeHiddenSettingsForMenu() failed", e);
		return 0;
	}
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

	// Add custom class for styling
	static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
		classes: [...(super.DEFAULT_OPTIONS?.classes ?? []), "bbmm-ai-app"]
	});

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
					const ns  = menuId.slice(0, dot);
					const key = menuId.slice(dot + 1);

					// Skip if this menu was already added as a placeholder include
					if (included.has(`${ns}::${key}`)) continue;

					// Display row for a menu (we treat it as an include-able placeholder)
					const mod     = game.modules.get(ns);
					const nsLabel = String(mod?.title ?? ns);
					const label   = menu?.name ? game.i18n.localize(String(menu.name)) : key;
					const scope   = menu?.restricted ? "world" : "client";

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

			const data = foundry.utils.duplicate(game.settings.get(BBMM_ID, "userInclusions") || {});
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
				await game.settings.set(BBMM_ID, "userInclusions", data);
				try { Hooks.callAll("bbmmInclusionsChanged", { type: "menu", id: `${menuNs}.${menuKey}`, added }); } catch {}
				DL(`inclusions.js | _includeMenu(): committed ${added} setting(s) from ${menuNs}.${menuKey}`);
			}
		} catch (e) {
			DL(3, "inclusions.js | _includeMenu(): failed", e);
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
		if (typeof this._collectSettings === "function") {
			try { await this._collectSettings(); } catch (e) { DL(2, "inclusions.js | AddSetting._renderHTML(): _collectSettings failed", e); }
		}
		this._rows = Array.isArray(this._rows) ? this._rows : [];

		const rowsHtml = this._rows.map(r => `
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
			<div class="bbmm-ai-root">
				<div class="bbmm-ai-scroller">
					<table class="bbmm-ai-table">
						<thead><tr><th>${LT.module()}</th><th>${LT.setting()}</th><th>${LT.scope()}</th><th></th></tr></thead>
						<tbody>${rowsHtml || `<tr><td colspan="4" style="text-align:center;opacity:.8;padding:18px 0">${LT.inclusions.none()}.</td></tr>`}</tbody>
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
		} catch (e) { DL(2, "inclusions.js | AddSetting: size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			try {
				// Include button
				const incBtn = ev.target.closest?.(".bbmm-inc-act");
				if (incBtn instanceof HTMLButtonElement) {
					const ns  = incBtn.dataset.ns  || "";
					const key = incBtn.dataset.key || "";
					if (!ns || !key) return;

					try {
						DL(`inclusions.js | AddSetting: include ${ns}.${key}`);
						incBtn.disabled = true;

						const row = this._rows?.find?.((r) => (r.ns ?? r.namespace) === ns && (r.key === key || r._key === key));
						let added = 0;

						if (row?.__isMenu) {
							added = await this._includeMenu(ns, key) || 0;
						} else {
							const before = (game.settings.get(BBMM_ID, "userInclusions")?.settings ?? []).length;
							await this._include(ns, key);
							const after  = (game.settings.get(BBMM_ID, "userInclusions")?.settings ?? []).length;
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

				// Close -> return to Inclusions Manager
				const closeBtn = ev.target.closest?.('[data-action="close"], [data-action="cancel"], .bbmm-close');
				if (closeBtn) {
					DL("inclusions.js | AddSetting: close button clicked");
					try { this.close({ force: true }); } catch {}
					try { (globalThis.bbmm?.openInclusionsManagerApp || globalThis.openInclusionsManagerApp)?.(); } catch {}
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

		const data = game.settings.get(BBMM_ID, "userInclusions") || {};
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
			await game.settings.set(BBMM_ID, "userInclusions", data);
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

	// Add custom class for styling
	static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
		classes: [...(super.DEFAULT_OPTIONS?.classes ?? []), "bbmm-am-app"]
	});

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
		if (typeof this._collectModules === "function") {
			try { await this._collectModules(); } catch (e) { DL(2, "inclusions.js | AddModule._renderHTML(): _collectModules failed", e); }
		} else {
			// safe fallback
			const data = game.settings.get(BBMM_ID, "userInclusions") || {};
			const included = new Set(Array.isArray(data.modules) ? data.modules : []);
			this._rows = Array.from(game.modules.values()).map(m => ({
				ns: m.id, title: String(m?.title ?? m.id), active: !!m.active, included: included.has(m.id)
			})).sort((a,b)=>a.title.localeCompare(b.title, game.i18n.lang||undefined,{sensitivity:"base"}));
		}
		this._rows = Array.isArray(this._rows) ? this._rows : [];

		const rowsHtml = this._rows.map(r => `
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
			<div class="bbmm-am-root">
				<div class="bbmm-am-scroller">
					<table class="bbmm-am-table">
						<thead><tr><th>${LT.module()}</th><th>${LT.active()}</th><th></th></tr></thead>
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

						const data = game.settings.get(BBMM_ID, "userInclusions") || {};
						if (!Array.isArray(data.modules)) data.modules = [];
						if (!data.modules.includes(ns)) data.modules.push(ns);
						await game.settings.set(BBMM_ID, "userInclusions", data);
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

	// Add custom class for styling
	static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
		classes: [...(super.DEFAULT_OPTIONS?.classes ?? []), "bbmm-inc-mgr-app"]
	});

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

		// If not a setting, this may be a menu placeholder — use the menu's label
		try {
			const menu = game.settings.menus.get(`${ns}.${key}`);
			if (menu?.name) return game.i18n.localize(String(menu.name));
		} catch { /* ignore */ }

		// Fallback to raw key
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
		const inc = game.settings.get(BBMM_ID, "userInclusions") || {};
		const mods = Array.isArray(inc.modules)  ? inc.modules  : [];
		const sets = Array.isArray(inc.settings) ? inc.settings : [];

		const modRows = mods.map(ns => {
			const mod = game.modules.get(ns);
			const title = String(mod?.title ?? ns);
			return { type: "Module", identifier: title, _ns: ns, _key: "", _id: ns };
		});

		const setRows = sets.map(s => {
			const ns = String(s?.namespace ?? "");
			const key = String(s?.key ?? "");
			const mod = game.modules.get(ns);
			const nsLabel = String(mod?.title ?? ns);
			const settingLabel = this._getSettingLabel(ns, key);
			return { type: "Setting", identifier: `${nsLabel}, ${settingLabel}`, _ns: ns, _key: key, _id: `${ns}.${key}` };
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

		return `
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