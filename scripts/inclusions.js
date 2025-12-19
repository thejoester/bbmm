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

// Given a menu namespace+key, return true if we have a resolver function for it
function _bbmmIsMenuResolvable(ns, key) {
	const id = `${ns}.${key}`;
	return typeof MENU_TO_SETTINGS[id] === "function";
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

	_renderHeader() {
		return (
			`<div class="h c-mod">${LT.module()}</div>` +
			`<div class="h c-key">${LT.setting()}</div>` +
			`<div class="h c-scope">${LT.scope()}</div>` +
			`<div class="h c-val">${LT.value()}</div>` +
			`<div class="h c-act"></div>`
		);
	}

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
							<button type="button" class="btn-copy">${LT.copy()}</button>
							<button type="button" class="btn-collapse">${LT.collapse()}</button>
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

					rows.push({
						ns,
						key,
						nsLabel,
						label,
						scope,
						__isMenu: true,

						__value: null,
						__preview: "[menu]",
						__pretty: "[menu]",
						__valLoaded: true
					});

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
		try {
			this._collectSettings();
		} catch (e) {
			DL(2, "inclusions.js | AddSetting._renderHTML(): _collectSettings failed", e);
			this._rows = this._rows || [];
		}

		const cols = "grid-template-columns: minmax(220px,1.2fr) minmax(240px,1.6fr) 90px minmax(320px,2fr) 96px;";
		const css =
			`#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important;overflow:hidden}` +
			`.bbmm-ai-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}` +
			`.bbmm-toolbar{display:flex;gap:.5rem;align-items:center;flex-wrap:nowrap}` +
			`.bbmm-toolbar select{width:260px;min-width:260px;max-width:260px}` +
			`.bbmm-toolbar input[type="text"]{flex:1;min-width:260px}` +

			`.bbmm-grid-head{display:grid;${cols}gap:0;border:1px solid var(--color-border,#444);border-radius:.5rem .5rem 0 0;background:var(--color-bg-header,#1e1e1e)}` +
			`.bbmm-grid-head .h{padding:.35rem .5rem;border-bottom:1px solid #444;font-weight:600}` +

			`.bbmm-grid-body{display:block;flex:1 1 auto;min-height:0;max-height:100%;overflow:auto;border:1px solid var(--color-border,#444);border-top:0;border-radius:0 0 .5rem .5rem}` +
			`.bbmm-grid-body .row{display:grid;${cols}gap:0;border-bottom:1px solid #333}` +
			`.bbmm-grid-body .row>div{padding:.3rem .5rem;min-width:0}` +

			`.bbmm-grid-body .c-mod,.bbmm-grid-body .c-key{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
			`.bbmm-grid-body .c-scope{text-transform:capitalize;opacity:.85;white-space:nowrap}` +

			`.bbmm-grid-body .c-val{cursor:pointer}` +
			`.bbmm-grid-body .c-val .val-preview{max-height:2.4em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}` +
			`.bbmm-grid-body .c-val .val-preview code{white-space:pre-wrap;word-break:break-word}` +

			`.bbmm-grid-body .row .val-expand{display:none;margin-top:.25rem;border-top:1px dotted #444;padding-top:.25rem}` +
			`.bbmm-grid-body .row.expanded .val-expand{display:block}` +
			`.bbmm-grid-body .val-toolbar{display:flex;gap:.5rem;margin-bottom:.25rem}` +
			`.bbmm-grid-body .val-pre{max-height:40vh;overflow:auto;margin:0;background:rgba(255,255,255,.03);padding:.4rem;border-radius:.35rem}` +

			`.bbmm-grid-body .c-act{display:flex;justify-content:flex-end;align-items:center;padding-right:8px}` +
			`.bbmm-grid-body .bbmm-inc-act{display:inline-flex;align-items:center;justify-content:center;min-width:80px;height:32px;padding:0 12px;font-size:.95rem;line-height:1}` +
			`.bbmm-grid-body .bbmm-inc-act.bbmm-inc-done{pointer-events:none;opacity:.75;font-weight:700}` +

			/* FOOTER */
			`.bbmm-add-footer{` +
				`display:flex;` +
				`justify-content:center;` +
				`align-items:center;` +
				`width:100%;` +
				`padding:.5rem 0;` +
				`margin-top:.25rem;` +
				`border-top:1px solid var(--color-border,#444);` +
			`}` +
			`.bbmm-add-footer button{min-width:160px}`;

		const moduleList = this._buildModuleList();
		const moduleOpts = ['<option value=""></option>']
			.concat(moduleList.map(m =>
				`<option value="${foundry.utils.escapeHTML(m.ns)}"${this._moduleFilter===m.ns?" selected":""}>${foundry.utils.escapeHTML(m.title)}</option>`
			))
			.join("");

		const head = `<div class="bbmm-grid-head">${this._renderHeader()}</div>`;
		const rowsHtml = (this._rows || []).map(r => this._rowHTML(r)).join("");
		const body = `<div class="bbmm-grid-body" id="bbmm-ai-body">${rowsHtml}</div>`;

		return (
			`<style>${css}</style>` +
			`<section class="bbmm-ai-root">` +
				`<div class="bbmm-toolbar">` +
					`<select id="bbmm-ai-module">${moduleOpts}</select>` +
					`<input id="bbmm-ai-filter" type="text" placeholder="${foundry.utils.escapeHTML(LT.search())}" />` +
					`<span class="count" style="opacity:.85;font-weight:600">${LT.showing()} <span id="bbmm-ai-count">0</span> ${LT.of()} <span id="bbmm-ai-total">${this._rows.length}</span></span>` +
				`</div>` +
				head +
				body +
				`<div class="bbmm-add-footer">` +
					`<button type="button" id="bbmm-ai-close">${foundry.utils.escapeHTML(LT.buttons.close())}</button>` +
				`</div>` +
			`</section>`
		);
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
							const data = foundry.utils.duplicate(game.settings.get(BBMM_ID, "userInclusions") || {});
							if (!Array.isArray(data.settings)) data.settings = [];

							const before = data.settings.length;
							const exists = data.settings.some(s => s?.namespace === ns && s?.key === key);
							if (!exists) data.settings.push({ namespace: ns, key });

							await game.settings.set(BBMM_ID, "userInclusions", data);

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

				// Expand/collapse value cell
				if (rowEl && target.closest(".c-val")) {
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

				// Copy / collapse
				if (rowEl) {
					const copyBtn = target.closest(".btn-copy");
					if (copyBtn) {
						const pre = rowEl.querySelector(".val-pre");
						const txt = pre?.textContent ?? "";
						try {
							await navigator.clipboard.writeText(String(txt));
							ui.notifications?.info(LT.copiedToClipboard());
						} catch (e) {
							DL(2, "inclusions.js | AddSetting: clipboard failed", e);
							ui.notifications?.warn(LT.failedCopyToClipboard());
						}
						return;
					}

					const collapseBtn = target.closest(".btn-collapse");
					if (collapseBtn) {
						rowEl.classList.remove("expanded");
						return;
					}
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
		// Populate rows if needed
		try {
			if (typeof this._collectModules === "function") {
				await this._collectModules();
			} else {
				// Fallback collector (safe): all modules by title
				const data = game.settings.get(BBMM_ID, "userInclusions") || {};
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
		// Build rows (modules + settings) 
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