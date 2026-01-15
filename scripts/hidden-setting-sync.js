/* BBMM Hidden Client Setting Sync ============================================
	- Manager: show synced hidden client settings (client + config:false)
	- Add Setting Sync: list eligible hidden client settings not already synced
	- Soft Lock / Lock All: calls exported API in setting-sync.js
============================================================================ */

import { DL, BBMM_README_UUID } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_injectHeaderHelpButton } from "./helpers.js";
import { bbmmAddUserSettingSoftLock, bbmmAddUserSettingLockAll } from "./setting-sync.js";

// Ensure namespace once
globalThis.bbmm ??= {};

// Register openers on bbmm namespace
Object.assign(globalThis.bbmm, {
	openhiddenSettingSyncManagerApp,
	openAddHiddenClientSettingSyncApp
});

// Open Hidden Client Setting Sync Manager
export function openhiddenSettingSyncManagerApp() {
	try {
		const app = new BBMMhiddenSettingSyncManagerAppV2();
		app.render(true);
		return app;
	} catch (err) {
		DL(3, "hidden-setting-sync.js | openhiddenSettingSyncManagerApp(): failed", err);
	}
}

// Open Add Hidden Client Setting Sync App
export function openAddHiddenClientSettingSyncApp() {
	try {
		const app = new BBMMAddHiddenClientSettingSyncAppV2();
		app.render(true);
		return app;
	} catch (err) {
		DL(3, "hidden-setting-sync.js | openAddHiddenClientSettingSyncApp(): failed", err);
	}
}

/* Helpers =================================================================== */

// Is this a hidden client setting?
function _hcsIsHiddenClientSetting(cfg) {
	try {
		if (!cfg) return false;
		if (cfg.__isMenu) return false;
		if (String(cfg.scope ?? "") !== "client") return false;
		if (cfg.config !== false) return false;
		const ns = String(cfg.namespace ?? "");
		const key = String(cfg.key ?? "");
		if (!ns || !key) return false;
		return true;
	} catch {
		return false;
	}
}

// setting ID from ns + key
function _hcsSettingId(ns, key) {
	return `${String(ns)}.${String(key)}`;
}

// Pretty-print for expanded view
function _hcsToPretty(v) {
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

// get module title
function _hcsModTitle(ns) {
	try {
		if (ns === "core") return LT.sourceCore();
		if (game.system?.id === ns) return String(game.system?.title ?? ns);
		return String(game.modules?.get(ns)?.title ?? ns);
	} catch {
		return String(ns);
	}
}

// get setting label
function _hcsSettingLabel(ns, key, cfg) {
	// Prefer NAME for the label, not hint
	try {
		const nm = cfg?.name;
		if (typeof nm === "string" && nm.trim().length) {
			try { return game.i18n.localize(nm) || nm; }
			catch { return nm; }
		}
		return String(key);
	} catch {
		return String(key);
	}
}

// get setting hint (if any)
function _hcsSettingHint(cfg) {
	try {
		const hint = cfg?.hint;
		if (typeof hint === "string" && hint.trim().length) {
			try { return game.i18n.localize(hint) || hint; }
			catch { return hint; }
		}
		return "";
	} catch {
		return "";
	}
}

// Short preview for table listing
function _hcsToPreview(v) {
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

class BBMMhiddenSettingSyncManagerAppV2 extends foundry.applications.api.ApplicationV2 {

	constructor() {
		super({
			id: "bbmm-hidden-client-sync",
			window: { title: LT.hiddenSettingSync.title() },
			width: 980,
			height: 600,
			resizable: true,
			classes: ["bbmm-exclusions-app", "bbmm-hidden-client-sync"]
		});

		this._minW = 520;
		this._maxW = 1200;
		this._minH = 420;
		this._maxH = 720;

		this._rows = [];
	}

	_collectRows() {
		try {
			const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const out = [];

			for (const [id, entry] of Object.entries(map)) {
				const cfg = game.settings.settings.get(id);
				if (!_hcsIsHiddenClientSetting(cfg)) continue;

				const ns = String(entry?.namespace ?? cfg?.namespace ?? "");
				const key = String(entry?.key ?? cfg?.key ?? "");
				if (!ns || !key) continue;

				out.push({
					ns,
					key,
					modTitle: _hcsModTitle(ns),
					setTitle: _hcsSettingLabel(ns, key, cfg),
					setHint: _hcsSettingHint(cfg),
					state: entry?.soft === true ? (LT.name_SoftLock()) : (LT.lockAllTip()),
					preview: _hcsToPreview(entry?.value)
				});
			}

			out.sort((a, b) => {
				const am = String(a.modTitle).toLowerCase();
				const bm = String(b.modTitle).toLowerCase();
				if (am !== bm) return am.localeCompare(bm);
				return String(a.setTitle).toLowerCase().localeCompare(String(b.setTitle).toLowerCase());
			});

			this._rows = out;
		} catch (err) {
			DL(2, "hidden-setting-sync.js | manager._collectRows(): failed", err);
			this._rows = [];
		}
	}

	_rowHTML(r) {
		const ns = foundry.utils.escapeHTML(String(r.ns));
		const key = foundry.utils.escapeHTML(String(r.key));
		const modTitle = foundry.utils.escapeHTML(String(r.modTitle));
		const setTitle = foundry.utils.escapeHTML(String(r.setTitle));
		const setHint = foundry.utils.escapeHTML(String(r.setHint ?? ""));
		const state = foundry.utils.escapeHTML(String(r.state));
		const preview = foundry.utils.escapeHTML(String(r.preview));

		return `
			<div class="row" data-ns="${ns}" data-key="${key}">
				<div class="c-mod" title="${ns}">${modTitle}</div>

				<div class="c-key" title="${ns}.${key}">
					<div class="setting-title">${setTitle}</div>
					${setHint ? `<div class="setting-hint">${setHint}</div>` : ``}
				</div>

				<div class="c-state" title="${state}">${state}</div>

				<div class="c-val" title="${preview}">
					<div class="val-preview">
						<code>${preview}</code>
					</div>
					<div class="val-expand" style="display:none">
						<pre class="val-pre" data-loaded="0"></pre>
					</div>
				</div>

				<div class="c-act">
					<button type="button" class="bbmm-hcs-del">${LT.buttons.delete()}</button>
				</div>
			</div>
		`;
	}

	async _renderHTML() {
		this._collectRows();

		const cols = "grid-template-columns: minmax(220px,1.2fr) minmax(260px,1.8fr) 110px minmax(360px,2.2fr) 140px;";
		const css = `#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important;overflow:hidden}
			.bbmm-hcs-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}
			.bbmm-hcs-toolbar{display:flex;gap:.5rem;align-items:center;flex-wrap:nowrap}
			.bbmm-hcs-count{margin-left:auto;opacity:.85}
			.bbmm-hcs-table{display:flex;flex-direction:column;border:1px solid var(--color-border,#444);border-radius:.5rem;overflow:hidden}
			.bbmm-hcs-head{display:grid;${cols}gap:0;border-bottom:1px solid var(--color-border,#444);padding:.35rem .5rem;font-weight:600}
			.bbmm-hcs-body{overflow:auto;min-height:0}
			.bbmm-hcs-body .row{display:grid;${cols}gap:0;border-bottom:1px solid rgba(255,255,255,.06);padding:.35rem .5rem;align-items:start}
			.bbmm-hcs-body .row:last-child{border-bottom:none}
			.bbmm-hcs-body .c-mod,.bbmm-hcs-body .c-state{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.bbmm-hcs-body .c-key{min-width:0;overflow:hidden}
			.bbmm-hcs-body .c-key .setting-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.bbmm-hcs-body .c-key .setting-hint{font-size:.85em;font-style:italic;opacity:.75;line-height:1.1;white-space:normal}
			.c-val{min-width:0;cursor:pointer}
			.val-preview code{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
			.val-expand{margin-top:.25rem}
			.val-pre{max-height:220px;overflow:auto;padding:.35rem .5rem;border:1px solid rgba(255,255,255,.12);border-radius:.35rem}
			.c-act{display:flex;justify-content:flex-end;align-items:flex-start}
			.c-act button{white-space:nowrap}`;

		const rows = this._rows || [];
		const body = rows.length
			? rows.map(r => this._rowHTML(r)).join("")
			: `<div style="padding:.75rem;opacity:.85">${LT.hiddenSettingSync.none()}</div>`;

		return `
			<style>${css}</style>
			<section class="bbmm-hcs-root">
				<div class="bbmm-hcs-toolbar">
					<button type="button" class="bbmm-hcs-add">${LT.hiddenSettingSync.btnAdd()}</button>
					<div class="bbmm-hcs-count">${foundry.utils.escapeHTML(String(rows.length))}</div>
				</div>

				<div class="bbmm-hcs-table">
					<div class="bbmm-hcs-head">
						<div>${LT.module()}</div>
						<div>${LT.setting()}</div>
						<div>${LT.state()}</div>
						<div>${LT.macro.value()}</div>
						<div>${LT.macro.columnAction()}</div>
					</div>
					<div class="bbmm-hcs-body">${body}</div>
				</div>
			</section>
		`;
	}

	async _replaceHTML(result, _options) {

		try {
			this.element.style.minWidth  = `${this._minW ?? 520}px`;
			this.element.style.maxWidth  = `${this._maxW ?? 980}px`;
			this.element.style.minHeight = `${this._minH ?? 420}px`;
			this.element.style.maxHeight = `${this._maxH ?? 720}px`;
			this.element.style.overflow  = "hidden";
		} catch (err) { /* ignore */ }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass: "fas fa-circle-question",
				title: LT.buttons.help()
			});
		} catch (err) {
			DL(2, "hidden-setting-sync.js | manager._replaceHTML(): help inject failed", err);
		}

		if (this._delegated) return;
		this._delegated = true;

		try {
			const root = this.element?.querySelector?.(".bbmm-hcs-root");
			if (!root) return;

			root.addEventListener("click", async (ev) => {

				const cval = ev.target?.closest?.(".c-val");
				if (cval) {
					ev.preventDefault();

					const rowEl = cval.closest(".row");
					const box = rowEl?.querySelector?.(".val-expand");
					const pre = rowEl?.querySelector?.(".val-pre");
					if (!rowEl || !box || !pre) return;

					const isOpen = box.style.display !== "none";
					if (isOpen) {
						box.style.display = "none";
						return;
					}

					box.style.display = "";

					if (pre.dataset.loaded !== "1") {
						try {
							const ns = rowEl.dataset.ns;
							const key = rowEl.dataset.key;
							const id = _hcsSettingId(ns, key);
							const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
							pre.textContent = _hcsToPretty(map?.[id]?.value);
							pre.dataset.loaded = "1";
						} catch (err) {
							DL(2, "hidden-setting-sync.js | manager: expand load failed", err);
						}
					}

					return;
				}

				const addBtn = ev.target?.closest?.(".bbmm-hcs-add");
				if (addBtn) {
					ev.preventDefault();
					try { this.close({ force: true }); } catch {}
					setTimeout(() => {
						try { openAddHiddenClientSettingSyncApp(); }
						catch (e) { DL(3, "hidden-setting-sync.js | openAddHiddenClientSettingSyncApp(): failed", e); }
					}, 0);
					return;
				}

				const delBtn = ev.target?.closest?.(".bbmm-hcs-del");
				if (delBtn) {
					ev.preventDefault();

					const rowEl = delBtn.closest(".row");
					const ns = rowEl?.dataset?.ns;
					const key = rowEl?.dataset?.key;
					if (!rowEl || !ns || !key) return;

					const id = _hcsSettingId(ns, key);

					let ok = false;
					try {
						ok = await new Promise((resolve) => {
							const dlg = new foundry.applications.api.DialogV2({
								window: { title: LT.buttons.delete(), modal: true, width: 520 },
								content: `
									<section style="display:flex;flex-direction:column;gap:.75rem;min-width:520px;">
										<div style="font-weight:600;">${LT.buttons.delete()}</div>
										<div style="opacity:.85;">${LT.hiddenSettingSync.deleteLock()} <b>${foundry.utils.escapeHTML(id)}</b>?</div>
									</section>
								`,
								buttons: [
									{ action: "delete", label: LT.buttons.delete(), default: true, callback: () => resolve(true) },
									{ action: "cancel", label: LT.buttons.cancel(), callback: () => resolve(false) }
								],
								close: () => resolve(false)
							});
							dlg.render(true);
						});
					} catch (err) {
						DL(2, "hidden-setting-sync.js | manager: delete confirm failed", err);
						ok = false;
					}

					if (!ok) return;

					try {
						const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
						if (map[id]) {
							delete map[id];
							await game.settings.set(BBMM_ID, "userSettingSync", map);
							DL(`hidden-setting-sync.js | manager: deleted userSettingSync entry ${id}`);
						}

						rowEl.remove();

						try {
							const cnt = root.querySelector(".bbmm-hcs-count");
							if (cnt) {
								const cur = Number(String(cnt.textContent ?? "0").trim());
								cnt.textContent = String(Math.max(0, cur - 1));
							}
						} catch {}
					} catch (err) {
						DL(3, "hidden-setting-sync.js | manager: delete failed", err);
					}
					return;
				}
			});
		} catch (err) {
			DL(2, "hidden-setting-sync.js | manager._replaceHTML(): listener failed", err);
		}
	}
}
class BBMMAddHiddenClientSettingSyncAppV2 extends foundry.applications.api.ApplicationV2 {

	constructor() {
		super({
			id: "bbmm-hidden-client-sync-add",
			window: { title: LT.hiddenSettingSync.titleAdd() },
			width: 980,
			height: 600,
			resizable: true,
			classes: ["bbmm-exclusions-app", "bbmm-hidden-client-sync-add"]
		});

		this._minW = 520;
		this._maxW = 1200;
		this._minH = 420;
		this._maxH = 720;

		this._rows = [];
		this._selectedModule = "";
		this._filterText = "";
		this._delegated = false;
	}

	_collectEligible() {
		try {
			const out = [];

			// What is already synced/locked?
			const map = game.settings.get(BBMM_ID, "userSettingSync") || {};

			for (const [id, cfg] of game.settings.settings.entries()) {
				if (!_hcsIsHiddenClientSetting(cfg)) continue;

				// skip if already in soft/hard state
				if (map[id]) continue;

				const ns = String(cfg.namespace ?? "");
				const key = String(cfg.key ?? "");
				if (!ns || !key) continue;

				let v;
				try { v = game.settings.get(ns, key); } catch { v = undefined; }

				out.push({
					ns,
					key,
					modTitle: _hcsModTitle(ns),
					setTitle: _hcsSettingLabel(ns, key, cfg),
					setHint: _hcsSettingHint(cfg),
					preview: _hcsToPreview(v)
				});
			}

			out.sort((a, b) => {
				const am = String(a.modTitle).toLowerCase();
				const bm = String(b.modTitle).toLowerCase();
				if (am !== bm) return am.localeCompare(bm);
				return String(a.setTitle).toLowerCase().localeCompare(String(b.setTitle).toLowerCase());
			});

			this._rows = out;
		} catch (err) {
			DL(2, "hidden-setting-sync.js | add._collectEligible(): failed", err);
			this._rows = [];
		}
	}

	_applyFilter() {
		try {
			const root = this.element?.querySelector?.(".bbmm-hcs-add-root");
			if (!root) return;

			const sel = String(this._selectedModule ?? "");
			const f = String(this._filterText ?? "").trim().toLowerCase();

			for (const row of root.querySelectorAll(".row")) {
				const ns = String(row.dataset.ns ?? "");
				const key = String(row.dataset.key ?? "");
				const id = `${ns}.${key}`.toLowerCase();
				const title = String(row.dataset.title ?? "").toLowerCase();

				let ok = true;

				if (sel && ns !== sel) ok = false;

				if (ok && f) {
					ok = id.includes(f) || title.includes(f);
				}

				row.style.display = ok ? "" : "none";
			}
		} catch (err) {
			DL(2, "hidden-setting-sync.js | add._applyFilter(): failed", err);
		}
	}

	_rowHTML(r) {
		const ns = foundry.utils.escapeHTML(String(r.ns));
		const key = foundry.utils.escapeHTML(String(r.key));
		const modTitle = foundry.utils.escapeHTML(String(r.modTitle));
		const setTitle = foundry.utils.escapeHTML(String(r.setTitle));
		const setHint = foundry.utils.escapeHTML(String(r.setHint ?? ""));
		const preview = foundry.utils.escapeHTML(String(r.preview));

		const titleSearch = foundry.utils.escapeHTML(`${r.modTitle} ${r.setTitle} ${r.ns}.${r.key}`);

		return `
			<div class="row" data-ns="${ns}" data-key="${key}" data-title="${titleSearch}">
				<div class="c-mod" title="${ns}">${modTitle}</div>
				<div class="c-key" title="${ns}.${key}">
					<div class="setting-title">${setTitle}</div>
					${setHint ? `<div class="setting-hint">${setHint}</div>` : ``}
				</div>

				<div class="c-val" title="${preview}">
					<div class="val-preview">
						<code>${preview}</code>
					</div>
					<div class="val-expand" style="display:none">
						<pre class="val-pre" data-loaded="0"></pre>
					</div>
				</div>

				<div class="c-act">
					<button type="button" class="bbmm-hcs-soft">${LT.hiddenSettingSync.softLock()}</button>
					<button type="button" class="bbmm-hcs-lock">${LT.hiddenSettingSync.lock()}</button>
				</div>
			</div>
		`;
	}

	async _renderHTML() {
		this._collectEligible();

		// Module | Setting | Value | Action
		const cols = "grid-template-columns: minmax(220px,1.2fr) minmax(260px,1.8fr) minmax(360px,2.2fr) 200px;";
		const css =
			`#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important;overflow:hidden}
			.bbmm-hcs-add-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}
			.bbmm-hcs-toolbar{display:flex;gap:.5rem;align-items:center;flex-wrap:nowrap}
			.bbmm-hcs-toolbar select{width:320px;min-width:320px;max-width:320px}
			.bbmm-hcs-toolbar input[type="text"]{flex:1;min-width:220px}
			.bbmm-hcs-table{display:flex;flex-direction:column;border:1px solid var(--color-border,#444);border-radius:.5rem;overflow:hidden}
			.bbmm-hcs-head{display:grid;${cols}gap:0;border-bottom:1px solid var(--color-border,#444);padding:.35rem .5rem;font-weight:600}
			.bbmm-hcs-body{overflow:auto;min-height:0}
			.bbmm-hcs-body .row{display:grid;${cols}gap:.5rem;border-bottom:1px solid rgba(255,255,255,.06);padding:.35rem .5rem;align-items:start}
			.bbmm-hcs-body .row:last-child{border-bottom:none}
			.bbmm-hcs-body .c-mod{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.bbmm-hcs-body .c-key{min-width:0;overflow:hidden}
			.bbmm-hcs-body .c-key .setting-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.bbmm-hcs-body .c-key .setting-hint{font-size:.85em;font-style:italic;opacity:.75;line-height:1.1;white-space:normal}

			.c-val{min-width:0;cursor:pointer}
			.val-preview code{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
			.val-expand{margin-top:.25rem}
			.val-pre{max-height:260px;overflow:auto;padding:.35rem .5rem;border:1px solid rgba(255,255,255,.12);border-radius:.35rem}
			.c-act{display:flex;gap:.4rem;justify-content:flex-end;align-items:flex-start}
			.c-act button{white-space:nowrap}
			.bbmm-footer{display:block;margin-top:10px}
			.bbmm-footer-close{display:flex;justify-content:center;align-items:center;width:100%;height:36px;padding:0 14px;border-radius:8px;font-weight:600}`;

		const rows = this._rows || [];

		const modules = [...new Set(rows.map(r => r.ns))];
		const moduleOptions = modules.map(ns => {
			const title = _hcsModTitle(ns);
			return `<option value="${foundry.utils.escapeHTML(String(ns))}">${foundry.utils.escapeHTML(String(title))}</option>`;
		}).join("");

		const body = rows.length
			? rows.map(r => this._rowHTML(r)).join("")
			: `<div style="padding:.75rem;opacity:.85">${LT.hiddenSettingSync.noneEligible()}</div>`;

		return `
			<style>${css}</style>

			<section class="bbmm-hcs-add-root">
				<div class="bbmm-hcs-toolbar">
					<select class="bbmm-hcs-module">
						<option value="">${LT.hiddenSettingSync.selectModule()}</option>
						${moduleOptions}
					</select>
					<input type="text" class="bbmm-hcs-filter" placeholder="${LT.hiddenSettingSync.filter()}" value="${foundry.utils.escapeHTML(String(this._filterText ?? ""))}">
				</div>

				<div class="bbmm-hcs-table">
					<div class="bbmm-hcs-head">
						<div>${LT.module()}</div>
						<div>${LT.setting()}</div>
						<div>${LT.dialogValue()}</div>
						<div>${LT.macro.columnAction()}</div>
					</div>
					<div class="bbmm-hcs-body">${body}</div>
				</div>

				<div class="bbmm-footer">
					<button type="button" class="bbmm-footer-close bbmm-hcs-close">${LT.buttons.close()}</button>
				</div>
			</section>
		`;
	}

	async _replaceHTML(result, _options) {

		try {
			this.element.style.minWidth  = `${this._minW ?? 520}px`;
			this.element.style.maxWidth  = `${this._maxW ?? 1200}px`;
			this.element.style.minHeight = `${this._minH ?? 420}px`;
			this.element.style.maxHeight = `${this._maxH ?? 720}px`;
			this.element.style.overflow  = "hidden";
		} catch (err) { /* ignore */ }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass: "fas fa-circle-question",
				title: LT.buttons.help()
			});
		} catch (err) {
			DL(2, "hidden-setting-sync.js | add._replaceHTML(): help inject failed", err);
		}

		if (!this._delegated) {
			this._delegated = true;

			try {
				const root = this.element?.querySelector?.(".bbmm-hcs-add-root");
				if (!root) return;

				root.addEventListener("input", (ev) => {
					const f = ev.target?.closest?.(".bbmm-hcs-filter");
					if (!f) return;
					this._filterText = String(f.value ?? "");
					this._applyFilter();
				});

				root.addEventListener("change", (ev) => {
					const sel = ev.target?.closest?.("select.bbmm-hcs-module");
					if (!sel) return;
					this._selectedModule = String(sel.value ?? "");
					this._applyFilter();
				});

				root.addEventListener("click", async (ev) => {

					const close = ev.target?.closest?.(".bbmm-hcs-close");
					if (close) {
						ev.preventDefault();
						try { this.close({ force: true }); } catch {}
						setTimeout(() => {
							try { globalThis.bbmm?.openhiddenSettingSyncManagerApp?.(); }
							catch (e) { DL(3, "hidden-setting-sync.js | openhiddenSettingSyncManagerApp(): failed", e); }
						}, 0);
						return;
					}

					const soft = ev.target?.closest?.(".bbmm-hcs-soft");
					if (soft) {
						ev.preventDefault();
						const rowEl = soft.closest(".row");
						const ns = rowEl?.dataset?.ns;
						const key = rowEl?.dataset?.key;
						if (!ns || !key) return;

						const ok = await bbmmAddUserSettingSoftLock({ ns, key });
						if (ok) rowEl.remove();
						this._applyFilter();
						return;
					}

					const lock = ev.target?.closest?.(".bbmm-hcs-lock");
					if (lock) {
						ev.preventDefault();
						const rowEl = lock.closest(".row");
						const ns = rowEl?.dataset?.ns;
						const key = rowEl?.dataset?.key;
						if (!ns || !key) return;

						const ok = await bbmmAddUserSettingLockAll({ ns, key });
						if (ok) rowEl.remove();
						this._applyFilter();
						return;
					}

					// Toggle expand/collapse by clicking the VALUE field (no button)
					const cval = ev.target?.closest?.(".c-val");
					if (cval) {
						ev.preventDefault();

						const rowEl = cval.closest(".row");
						const box = rowEl?.querySelector?.(".val-expand");
						const pre = rowEl?.querySelector?.(".val-pre");
						if (!rowEl || !box || !pre) return;

						const isOpen = box.style.display !== "none";
						if (isOpen) {
							box.style.display = "none";
							return;
						}

						box.style.display = "";

						if (pre.dataset.loaded !== "1") {
							try {
								const ns = rowEl.dataset.ns;
								const key = rowEl.dataset.key;
								let v;
								try { v = game.settings.get(ns, key); } catch { v = undefined; }
								pre.textContent = _hcsToPretty(v);
								pre.dataset.loaded = "1";
							} catch (err) {
								DL(2, "hidden-setting-sync.js | add: expand load failed", err);
							}
						}
						return;
					}
				});
			} catch (err) {
				DL(2, "hidden-setting-sync.js | add._replaceHTML(): listeners failed", err);
			}
		}

		this._applyFilter();
	}
}