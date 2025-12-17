/* =========================================================================
    BBMM: Macros 
========================================================================= */
import { DL } from "./settings.js";
import { hlp_esc } from "./helpers.js";
import { LT, BBMM_ID } from "./localization.js";


/* ==========================================================================
	Clipboard helper (navigator -> textarea -> Electron)
========================================================================== */
export async function copyPlainText(text) {
	try {
		await navigator.clipboard.writeText(String(text ?? ""));
		DL("macros.js | copyPlainText(): navigator.clipboard succeeded");
		ui.notifications.info(LT.macro.copiedValToClipboard());
		return true;
	} catch (e1) {
		DL("macros.js | copyPlainText(): navigator.clipboard failed... trying failback", e1);
		try {
			const ta = document.createElement("textarea");
			ta.value = String(text ?? "");
			ta.setAttribute("readonly", "");
			ta.style.position = "fixed";
			ta.style.top = "-9999px";
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			ta.setSelectionRange(0, ta.value.length);
			const ok = document.execCommand("copy");
			document.body.removeChild(ta);
			if (ok) {
				DL("macros.js | copyPlainText(): execCommand fallback succeeded");
				ui.notifications.info(LT.macro.copiedValToClipboard());
				return true;
			}
			throw new Error("execCommand returned false");
		} catch (e2) {
			DL(2, "macros.js | copyPlainText(): execCommand fallback failed", e2);
			try {
				const electron = globalThis.require?.("electron");
				if (electron?.clipboard) {
					electron.clipboard.writeText(String(text ?? ""));
					DL("copyPlainText(): electron.clipboard succeeded");
					ui.notifications.info(LT.macro.copiedValToClipboard());
					return true;
				}
			} catch (e3) {
				DL(2, "macros.js | copyPlainText(): electron.clipboard failed", e3);
			}
			ui.notifications.warn(LT.macro.failedCopyToClipboard());
			return false;
		}
	}
}

/* ==========================================================================
	Shared helpers (escaping / preview / pretty)
========================================================================== */


// single-line preview
function toPreview(v) { 
	try {
		if (v === undefined) return "undefined";
		if (v === null) return "null";
		if (typeof v === "string") return v;
		if (typeof v === "number" || typeof v === "boolean") return String(v);
		return JSON.stringify(v);
	} catch { return String(v); }
}

// pretty-printed (multi-line) JSON or string
function toPretty(v) {
    try {
		if (typeof v === "string") {
			try { return JSON.stringify(JSON.parse(v), null, 2); }
			catch { return v; }
		}
		return JSON.stringify(v, null, 2);
	} catch { return String(v); }
}

/* ==========================================================================
	Tiny loader dialog (DialogV2) used by inspectors
========================================================================== */
function createLoader({ title = LT.macro.titleLoading(), label = LT.macro.labelLoading(), total = 0 } = {}) {
	let aborted = false;

	const content = `
		<style>
			.bbmm-load-wrap{display:flex;flex-direction:column;gap:.5rem;min-width:320px}
			.bbmm-load-row{display:flex;justify-content:space-between;gap:.5rem}
			.bbmm-bar{height:10px;border:1px solid var(--color-border,#555);border-radius:6px;overflow:hidden;background:rgba(255,255,255,.05)}
			.bbmm-fill{height:100%;width:0%;}
		</style>
		<div class="bbmm-load-wrap">
			<div class="bbmm-load-row">
				<div><strong>${hlp_esc(label)}</strong></div>
				<div><span id="bbmm-pct">0%</span></div>
			</div>
			<div class="bbmm-bar"><div id="bbmm-fill" class="bbmm-fill"></div></div>
			<div id="bbmm-status" style="opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
		</div>
	`;

	const dlg = new foundry.applications.api.DialogV2({
		window: { title, resizable: false },
		position: { width: "auto", height: "auto" },
		content,
		buttons: [{ action: "cancel", label: "Cancel", default: false }],
		submit: (ctx) => ctx.action
	});

	const onRender = (app) => {
		if (app !== dlg) return;
		Hooks.off("renderDialogV2", onRender);
		try {
			const el = app.element;
			el.style.maxWidth = "520px";
			el.style.overflow = "hidden";
			dlg.setPosition({ height: "auto", left: null, top: null });
		} catch {}
		try {
			const form = app.element?.querySelector("form");
			form?.querySelectorAll("button").forEach(b => b.setAttribute("type", "button"));
			form?.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.("button");
				if (!(btn instanceof HTMLButtonElement)) return;
				if ((btn.dataset.action || "") !== "cancel") return;
				aborted = true;
				try { dlg.close(); } catch {}
			});
		} catch {}
	};
	Hooks.on("renderDialogV2", onRender);
	dlg.render(true);

	function setPct(pct) {
		const p = Math.max(0, Math.min(100, Math.round(pct)));
		const elPct = dlg.element?.querySelector?.("#bbmm-pct");
		const elFill = dlg.element?.querySelector?.("#bbmm-fill");
		if (elPct) elPct.textContent = `${p}%`;
		if (elFill) {
			elFill.style.width = `${p}%`;
			elFill.style.background = p < 100 ? "var(--color-text,#bbb)" : "var(--color-positive,#5fbf7f)";
		}
	}
	function setStatus(txt) {
		const el = dlg.element?.querySelector?.("#bbmm-status");
		if (el) el.textContent = String(txt ?? "");
	}

	return {
		update(i, tot, status = "") {
			const pct = tot > 0 ? (i / tot) * 100 : 0;
			setPct(pct);
			if (status) setStatus(status);
		},
		isAborted() { return aborted; },
		close() { try { dlg.close(); } catch {} }
	};
}

/* ==========================================================================
	Namespace/Settings & Flags Inspector (merged)
	- Source: settings | flags-me | flags-all
========================================================================== */
class BBMMNamespaceInspector extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: `bbmm-namespace-inspector`,
			window: { title: LT.macro.titleInspectSettings() },
			width: 1200,
			height: 600,
			resizable: true
		});
		this.DEBOUNCE_MS = 800;
		this.BATCH_SIZE = 200;

		this.source = "settings"; // "settings" | "flags-me" | "flags-all"
		this.namespaces = this._listNamespacesForSettings();
		this.nsSelected = "";
		this.items = [];
		this.filter = "";
		this.sortKey = "key";
		this.sortDir = "asc";
		this._valueById = new Map();
		this._matchRows = [];
		this._renderedCount = 0;
	}

	_listNamespacesForSettings() {
		const set = new Set();
		for (const [fullKey] of game.settings.settings.entries()) {
			const idx = fullKey.indexOf(".");
			if (idx > 0) set.add(fullKey.slice(0, idx));
		}
		return Array.from(set).sort((a,b)=>a.localeCompare(b));
	}
	_listNamespacesForFlagsMe() {
		return Object.keys(game.user?.flags || {}).sort((a,b)=>a.localeCompare(b));
	}
	_listNamespacesForFlagsAll() {
		const set = new Set();
		for (const u of game.users.contents) {
			for (const ns of Object.keys(u.flags || {})) set.add(ns);
		}
		return Array.from(set).sort((a,b)=>a.localeCompare(b));
	}

	async _collectSettingsNamespace(ns) {
		const out = [];
		if (!ns) return out;

		let entries = [];
		try {
			for (const [fullKey, cfg] of game.settings.settings.entries()) {
				const idx = fullKey.indexOf(".");
				if (idx <= 0) continue;
				const nsKey = fullKey.slice(0, idx);
				if (nsKey !== ns) continue;
				const key = fullKey.slice(idx + 1);
				entries.push([key, cfg]);
			}
		} catch (e) {
			DL(3, `macros.js | collectSettingsNamespace(${ns}): unable to read settings map`, e);
			return out;
		}

		const loader = createLoader({ title: LT.macro.titleLoadingSettings(), label: LT.macro.labelLoadingNumSettings({ns}), total: entries.length });
		const sleep = (ms) => new Promise(r => setTimeout(r, ms));

		for (let i = 0; i < entries.length; i++) {
			if (loader.isAborted()) { DL(2, "macros.js | collectSettingsNamespace: cancelled by user"); out.length = 0; break; }
			const [key, cfg] = entries[i];

			let value;
			try { value = game.settings.get(ns, key); }
			catch (e) { value = { "macros.js | _bbmm_error": `Failed to read value: ${e?.message || e}` }; }

			const scope = String(cfg?.scope ?? "");
			const config = !!cfg?.config;
			const preview = toPreview(value);

			out.push({
				source: "settings",
				namespace: ns,
				key,
				value,
				scope,
				visible: config ? "config" : "hidden",
				__preview: preview
			});

			if ((i % 20) === 0 || i === entries.length - 1) {
				loader.update(i + 1, entries.length, `${ns}.${key}`);
				await sleep(0);
			}
		}

		loader.close();
		return out;
	}

	async _collectUserFlagsNamespaceMe(ns) {
		const out = [];
		const flags = game.user?.flags?.[ns];
		if (!flags) return out;

		const keys = Object.keys(flags);
		const loader = createLoader({ title: LT.macro.titleLoadingFlagsMe() , label: LT.macro.labelLoadingNumFlags({ns}), total: keys.length });

		for (let i = 0; i < keys.length; i++) {
			if (loader.isAborted()) { out.length = 0; break; }
			const key = keys[i];

			let value;
			try { value = await game.user.getFlag(ns, key); }
			catch (e) { value = { "macros.js | _bbmm_error": `Failed to read flag: ${e?.message || e}` }; }

			out.push({
				source: "flags-me",
				namespace: ns,
				key,
				value,
				scope: "user",
				visible: "flag",
				__preview: toPreview(value)
			});

			if ((i % 20) === 0 || i === keys.length - 1) {
				loader.update(i + 1, keys.length, `${ns}.${key}`);
				await new Promise(r => setTimeout(r, 0));
			}
		}

		loader.close();
		return out;
	}

	async _collectUserFlagsNamespaceAll(ns) {
		const out = [];
		if (!game.user?.isGM) return out;

		const users = game.users?.contents || [];
		const total = users.length;
		const loader = createLoader({ title: LT.macro.titleLoadingFlagsAll(), label: LT.macro.labelLoadingNumFlags({ns}), total });

		for (let i = 0; i < users.length; i++) {
			if (loader.isAborted()) { out.length = 0; break; }
			const u = users[i];
			const flags = u.flags?.[ns];
			if (!flags) { loader.update(i + 1, total, u.name); continue; }

			for (const key of Object.keys(flags)) {
				let value;
				try { value = await u.getFlag(ns, key); }
				catch (e) { value = { "macros.js | _bbmm_error": `Failed to read flag: ${e?.message || e}` }; }

				out.push({
					source: "flags-all",
					namespace: ns,
					key: `${key} — ${u.name}`,
					_valueRawKey: key,
					_userId: u.id,
					value,
					scope: "user",
					visible: "flag",
					__preview: toPreview(value)
				});
			}
			loader.update(i + 1, total, u.name);
			await new Promise(r => setTimeout(r, 0));
		}

		loader.close();
		return out;
	}

	_makeRow(e) {
		return {
			ns: e.namespace,
			key: e.key ?? "",
			scope: e.scope ?? "",
			visible: e.visible ?? "",
			preview: e.__preview,
			_valueId: `${this.source}::${e.namespace}::${e.key}`
		};
	}

	_runFilter() {
		const q = String(this.filter ?? "").trim().toLowerCase();
		let list = this.items;

		if (q) {
			list = list.filter(e =>
				String(e.key ?? "").toLowerCase().includes(q) ||
				String(e.__preview ?? "").toLowerCase().includes(q) ||
				String(e.scope ?? "").toLowerCase().includes(q) ||
				String(e.visible ?? "").toLowerCase().includes(q)
			);
		}

		const dir = this.sortDir === "asc" ? 1 : -1;
		const cmp = (a, b) => String(a ?? "").localeCompare(String(b ?? ""));
		list = [...list].sort((a, b) => {
			if (this.sortKey === "key") return (cmp(a.key, b.key)) * dir;
			if (this.sortKey === "scope") return (cmp(a.scope, b.scope) || cmp(a.key, b.key)) * dir;
			if (this.sortKey === "visible") return (cmp(a.visible, b.visible) || cmp(a.key, b.key)) * dir;
			return (cmp(a.key, b.key)) * dir;
		});

		this._matchRows = list.map(e => this._makeRow(e));
		this._renderedCount = 0;
	}

	_renderHeader() {
		const arrow = (k) => this.sortKey !== k ? "" : (this.sortDir === "asc" ? " ▲" : " ▼");
		return (
			`<div class="h c-key sortable" data-sort="key">${LT.macro.key()}${arrow("key")}</div>` +
			`<div class="h c-scope sortable" data-sort="scope">${LT.macro.scope()}${arrow("scope")}</div>` +
			`<div class="h c-vis sortable" data-sort="visible">${LT.macro.type()}${arrow("visible")}</div>` +
			`<div class="h c-val">${LT.macro.value()}</div>`
		);
	}

	_rowHTML(r) {
		const id = `${r.ns}::${r.key}`;
		const preview =hlp_esc(r.preview);
		return `
			<div class="row" data-id="${hlp_esc(id)}">
				<div class="c-key" title="${hlp_esc(r.key)}">${hlp_esc(r.key)}</div>
				<div class="c-scope" title="${hlp_esc(r.scope)}">${hlp_esc(r.scope)}</div>
				<div class="c-vis" title="${hlp_esc(r.visible)}">${hlp_esc(r.visible)}</div>
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
			</div>`;
	}

	async _renderHTML() {
		const cols = "grid-template-columns: minmax(220px,1.4fr) 0.8fr 0.8fr minmax(280px,2fr);";
		const css =
			`#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important}` +
			`.bbmm-inspector-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}` +
			`.bbmm-toolbar{display:flex;gap:.5rem;align-items:center;flex-wrap:nowrap}` +
			`.bbmm-toolbar select{width:180px;min-width:180px;max-width:180px}` +
			`.bbmm-toolbar #bbmm-namespace{width:220px;min-width:220px;max-width:220px}` +
			`.bbmm-toolbar input[type="text"]{flex:1;min-width:260px}` +
			`.bbmm-grid-head{display:grid;${cols}gap:0;border:1px solid var(--color-border,#444);border-radius:.5rem .5rem 0 0;background:var(--color-bg-header,#1e1e1e)}` +
			`.bbmm-grid-head .h{padding:.35rem .5rem;border-bottom:1px solid #444;font-weight:600}` +
			`.bbmm-grid-head .sortable{cursor:pointer;user-select:none}` +
			`.bbmm-grid-body{display:block;flex:1 1 auto;min-height:0;max-height:100%;overflow:auto;border:1px solid var(--color-border,#444);border-top:0;border-radius:0 0 .5rem .5rem}` +
			`.bbmm-grid-body .row{display:grid;${cols}gap:0;border-bottom:1px solid #333}` +
			`.bbmm-grid-body .row>div{padding:.3rem .5rem;min-width:0}` +
			`.bbmm-grid-body .c-val .val-preview{max-height:2.4em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}` +
			`.bbmm-grid-body .c-val .val-preview code{white-space:pre-wrap;word-break:break-word}` +
			`.bbmm-grid-body .c-val{cursor:pointer}` +
			`.bbmm-grid-body .row .val-expand{display:none;grid-column:4 / 5;margin-top:.25rem;border-top:1px dotted #444;padding-top:.25rem}` +
			`.bbmm-grid-body .row.expanded .val-expand{display:block}` +
			`.bbmm-grid-body .val-toolbar{display:flex;gap:.5rem;margin-bottom:.25rem}` +
			`.bbmm-grid-body .val-pre{max-height:40vh;overflow:auto;margin:0;background:rgba(255,255,255,.03);padding:.4rem;border-radius:.35rem}`;

		const head = `<div class="bbmm-grid-head" id="bbmm-head">${this._renderHeader()}</div>`;
		const body = `<div class="bbmm-grid-body" id="bbmm-body"></div>`;

		return (
			`<style>${css}</style>` +
			`<div class="bbmm-inspector-root">` +
				`<div class="bbmm-toolbar">` +
					`<select id="bbmm-source" title="Source">` +
						`<option value="settings"${this.source==="settings"?" selected":""}>${LT.macro.settings()}</option>` +
						`<option value="flags-me"${this.source==="flags-me"?" selected":""}>${LT.macro.flagsUserMe()}</option>` +
						`<option value="flags-all"${this.source==="flags-all"?" selected":""}>${LT.macro.flagsUserAll()}</option>` +
					`</select>` +
					`<select id="bbmm-namespace" title="Namespace"></select>` +
					`<input id="bbmm-filter" type="text" placeholder="${LT.macro.search()}" value="${hlp_esc(this.filter ?? "")}" />` +
					`<span class="count">${LT.macro.showing()} <span id="bbmm-count">0</span> ${LT.macro.of()} <span id="bbmm-total">0</span></span>` +
				`</div>` +
				head +
				body +
			`</div>`
		);
	}

	async _replaceHTML(result, _options) {
		const content = this.element.querySelector(".window-content") || this.element;
		Object.assign(content.style, { display:"flex", flexDirection:"column", height:"100%", minHeight:"0" });

		try {
			const winEl = this.element;
			winEl.style.minWidth = "500px";
			winEl.style.maxWidth = "1200px";
			winEl.style.minHeight = "400px";
			winEl.style.maxHeight = "700px";
			winEl.style.overflow = "hidden";
			DL("macros.js | NamespaceInspector: size clamps applied");
		} catch (e) { DL(2, "macros.js | NamespaceInspector: size clamps failed", e); }

		content.innerHTML = result;
		this._root = content;
		if (this._delegated) return;
		this._delegated = true;

		const root = this._root;
		const bodyEl  = root.querySelector("#bbmm-body");
		const headEl  = root.querySelector("#bbmm-head");
		const countEl = root.querySelector("#bbmm-count");
		const totalEl = root.querySelector("#bbmm-total");
		const inputEl = root.querySelector("#bbmm-filter");
		const selNs   = root.querySelector("#bbmm-namespace");
		const selSrc  = root.querySelector("#bbmm-source");

		// populate namespaces for initial source
		const rebuildNamespaces = () => {
			if (this.source === "settings") this.namespaces = this._listNamespacesForSettings();
			else if (this.source === "flags-me") this.namespaces = this._listNamespacesForFlagsMe();
			else this.namespaces = this._listNamespacesForFlagsAll();

			this.nsSelected = "";
			this.items = [];
			this._valueById.clear();

			const opts = ['<option value=""></option>']
				.concat(this.namespaces.map(ns => `<option value="${hlp_esc(ns)}">${hlp_esc(ns)}</option>`))
				.join("");

			if (selNs) selNs.innerHTML = opts;

			bodyEl.innerHTML = "";
			if (countEl) countEl.textContent = "0";
			if (totalEl) totalEl.textContent = "0";
			if (headEl) headEl.innerHTML = this._renderHeader();
		};
		rebuildNamespaces();

		// Render helpers ----------------------------------------------------
		const renderNextBatch = () => {
			const start = this._renderedCount;
			const end = Math.min(start + this.BATCH_SIZE, this._matchRows.length);
			if (start >= end) return;
			const frag = document.createDocumentFragment();
			for (let i = start; i < end; i++) {
				const div = document.createElement("div");
				div.innerHTML = this._rowHTML(this._matchRows[i]);
				frag.appendChild(div.firstElementChild);
			}
			bodyEl.appendChild(frag);
			this._renderedCount = end;
			if (countEl) countEl.textContent = String(this._renderedCount);
			if (totalEl) totalEl.textContent = String(this._matchRows.length);
		};

		// Initially blank
		if (countEl) countEl.textContent = "0";
		if (totalEl) totalEl.textContent = "0";

		// Infinite scroll
		let ticking = false;
		bodyEl.addEventListener("scroll", () => {
			if (ticking) return; ticking = true;
			requestAnimationFrame(() => {
				ticking = false;
				const nearBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 200;
				if (nearBottom) renderNextBatch();
			});
		}, { passive: true });

		// Sorting
		root.addEventListener("click", (ev) => {
			const h = ev.target.closest?.(".bbmm-grid-head .sortable");
			if (!h) return;
			const k = h.dataset.sort;
			if (!k) return;
			if (this.sortKey === k) this.sortDir = (this.sortDir === "asc" ? "desc" : "asc");
			else { this.sortKey = k; this.sortDir = "asc"; }
			this._runFilter();
			bodyEl.innerHTML = "";
			this._renderedCount = 0;
			renderNextBatch();
			if (headEl) headEl.innerHTML = this._renderHeader();
		});

		// Expand / Copy / Collapse
		root.addEventListener("click", async (ev) => {
			const copyBtn = ev.target.closest?.(".btn-copy");
			if (copyBtn) {
				const row = copyBtn.closest?.(".row");
				if (!row) return;

				// Prefer loaded pretty text; if empty, compute from backing map.
				let pre = row.querySelector(".val-pre");
				let txt = pre?.textContent ?? "";
				if (!txt) {
					const id = row.getAttribute("data-id") || "";
					const value = this._valueById.get(`${this.source}::${id}`);
					txt = toPretty(value);
					if (pre) { pre.textContent = txt; pre.setAttribute("data-loaded", "1"); }
				}
				const api = game.modules.get(BBMM_ID)?.api;
				await (api?.copyPlainText ? api.copyPlainText(txt) : copyPlainText(txt));
				return;
			}

			const collapseBtn = ev.target.closest?.(".btn-collapse");
			if (collapseBtn) { collapseBtn.closest?.(".row")?.classList.remove("expanded"); return; }

			const valCell = ev.target.closest?.(".c-val");
			if (!valCell) return;
			const row = valCell.closest?.(".row"); if (!row) return;
			const id = row.getAttribute("data-id") || "";
			const pre = row.querySelector(".val-pre");
			const loaded = pre?.getAttribute("data-loaded") === "1";
			if (row.classList.contains("expanded")) {
				row.classList.remove("expanded");
			} else {
				row.classList.add("expanded");
				if (!loaded) {
					const value = this._valueById.get(`${this.source}::${id}`);
					const pretty = toPretty(value);
					if (pre) { pre.textContent = pretty; pre.setAttribute("data-loaded","1"); }
				}
			}
		});

		// Source change
		selSrc?.addEventListener("change", async (ev) => {
			this.source = ev.currentTarget.value || "settings";
			rebuildNamespaces();
		});

		// Namespace change -> load
		selNs?.addEventListener("change", async (ev) => {
			this.nsSelected = ev.currentTarget.value || "";
			this.items = [];
			this._valueById.clear();
			bodyEl.innerHTML = "";
			if (countEl) countEl.textContent = "0";
			if (totalEl) totalEl.textContent = "0";

			if (!this.nsSelected) return;

			let items = [];
			if (this.source === "settings") items = await this._collectSettingsNamespace(this.nsSelected);
			else if (this.source === "flags-me") items = await this._collectUserFlagsNamespaceMe(this.nsSelected);
			else items = await this._collectUserFlagsNamespaceAll(this.nsSelected);

			if (!items.length) { ui.notifications.warn(LT.macro.noEntriesFound()); return; }

			this.items = items;
			for (const e of items) this._valueById.set(`${this.source}::${e.namespace}::${e.key}`, e.value);

			this._runFilter();
			bodyEl.innerHTML = "";
			this._renderedCount = 0;
			renderNextBatch();

			if (headEl) headEl.innerHTML = this._renderHeader();
			if (countEl) countEl.textContent = String(Math.min(this.BATCH_SIZE, this._matchRows.length));
			if (totalEl) totalEl.textContent = String(this._matchRows.length);
		});

		// Debounced filter
		let debTimer = null;
		inputEl?.addEventListener("input", () => {
			clearTimeout(debTimer);
			debTimer = setTimeout(() => {
				this.filter = inputEl?.value ?? "";
				this._runFilter();
				bodyEl.innerHTML = "";
				this._renderedCount = 0;
				renderNextBatch();
				if (headEl) headEl.innerHTML = this._renderHeader();
			}, this.DEBOUNCE_MS);
		}, { passive: true });

		try { this.setPosition({ height: "auto", left: null, top: null }); } catch {}
	}
}

/* ==========================================================================
	Settings Preset Inspector
========================================================================== */

// Convert various preset formats into flat list of items
function toPresetItems(preset) {
	if (Array.isArray(preset?.items)) return preset.items;
	if (Array.isArray(preset?.entries)) return preset.entries;

	const out = [];
	const isPlain = (o) => !!o && typeof o === "object" && !Array.isArray(o);

	function addScope(scopeName, scopeData) {
		if (!scopeData) return;

		if (Array.isArray(scopeData)) { out.push(...scopeData); return; }
		if (Array.isArray(scopeData?.entries)) { out.push(...scopeData.entries); return; }

		if (isPlain(scopeData)) {
			for (const [ns, nsData] of Object.entries(scopeData)) {
				if (isPlain(nsData)) {
					for (const [key, value] of Object.entries(nsData)) {
						out.push({
							namespace: String(ns),
							key: String(key),
							value,
							scope: scopeName,
							config: true
						});
					}
				} else {
					out.push({
						namespace: "",
						key: String(ns),
						value: nsData,
						scope: scopeName,
						config: true
					});
				}
			}
		}
	}

	addScope("world", preset?.world);
	addScope("client", preset?.client);
	addScope("user", preset?.user);

	return out;
}

// Retrieve all user-defined settings presets (persistent storage JSON)
async function getAllSettingsPresets() {
	const url = `modules/${BBMM_ID}/storage/presets/settings-presets.json`;

	try {
		const res = await fetch(url, { cache: "no-store" });

		// Missing file is valid on first run
		if (res.status === 404) {
			DL("macros.js | getAllSettingsPresets(): settings-presets.json not found (404), returning empty object");
			return {};
		}

		if (!res.ok) {
			DL(2, "macros.js | getAllSettingsPresets(): fetch failed", { url, status: res.status, statusText: res.statusText });
			return {};
		}

		const data = await res.json();
		if (!data || typeof data !== "object") return {};

		return data;
	} catch (err) {
		DL(2, "macros.js | getAllSettingsPresets(): fetch threw, returning empty object", { url, err });
		return {};
	}
}

class BBMMPresetInspector extends foundry.applications.api.ApplicationV2 {
	constructor({ name, items }) {
		super({
			id: `bbmm-preset-inspector-${name}`,
			window: {title: LT.macro.inspectSettingsPresetName({name})},
			width: 1200,
			height: 600,
			resizable: true
		});
		this.presetName = name;
		this.itemsAll = Array.isArray(items) ? items : [];
		this.filter = "";
		this.sortKey = "ns";
		this.sortDir = "asc";
		this._expanded = new Set();

		this._minW = 500;
		this._maxW = 1200;
		this._minH = 400;
		this._maxH = 700;
	}

	_prepareRows() {
		const q = String(this.filter ?? "").trim().toLowerCase();
		const rows = this.itemsAll.map(e => ({
			ns: e.namespace ?? "",
			key: e.key ?? "",
			scope: e.scope ?? "",
			visible: e.config ? "config" : "hidden",
			preview: toPreview(e.value),
			pretty: toPretty(e.value),
			_value: e.value
		}));

		const filtered = q
			? rows.filter(r =>
				r.ns.toLowerCase().includes(q) ||
				r.key.toLowerCase().includes(q) ||
				r.scope.toLowerCase().includes(q) ||
				r.visible.toLowerCase().includes(q) ||
				(r.preview ?? "").toLowerCase().includes(q))
			: rows;

		const dir = this.sortDir === "asc" ? 1 : -1;
		const cmp = (a, b) => String(a ?? "").localeCompare(String(b ?? ""));

		filtered.sort((a, b) => {
			if (this.sortKey === "ns") return (cmp(a.ns, b.ns) || cmp(a.key, b.key)) * dir;
			if (this.sortKey === "key") return (cmp(a.key, b.key) || cmp(a.ns, b.ns)) * dir;
			if (this.sortKey === "scope") return (cmp(a.scope, b.scope) || cmp(a.ns, b.ns)) * dir;
			if (this.sortKey === "visible") return (cmp(a.visible, b.visible) || cmp(a.ns, b.ns)) * dir;
			return 0;
		});

		this.rows = filtered;
	}

	_renderHeader() {
		const arrow = (k) => this.sortKey !== k ? "" : (this.sortDir === "asc" ? " ▲" : " ▼");
		return (
			`<div class="h c-ns sortable" data-sort="ns">${LT.macro.columnNamespace()}${arrow("ns")}</div>` +
			`<div class="h c-key sortable" data-sort="key">${LT.macro.key()}${arrow("key")}</div>` +
			`<div class="h c-scope sortable" data-sort="scope">${LT.macro.scope()}${arrow("scope")}</div>` +
			`<div class="h c-vis sortable" data-sort="visible">${LT.macro.visibility()}${arrow("visible")}</div>` +
			`<div class="h c-val">${LT.macro.value()}</div>`
		);
	}

	_renderRows() {
		return (this.rows ?? []).map(r => {
			const id = `${r.ns}::${r.key}`;
			const expanded = this._expanded.has(id);
			const pretty =hlp_esc(r.pretty);
			const preview =hlp_esc(r.preview);
			return `
				<div class="row${expanded ? " expanded" : ""}" data-id="${hlp_esc(id)}">
					<div class="c-ns" title="${hlp_esc(r.ns)}">${hlp_esc(r.ns)}</div>
					<div class="c-key" title="${hlp_esc(r.key)}">${hlp_esc(r.key)}</div>
					<div class="c-scope" title="${hlp_esc(r.scope)}">${hlp_esc(r.scope)}</div>
					<div class="c-vis" title="${hlp_esc(r.visible)}">${hlp_esc(r.visible)}</div>
					<div class="c-val">
						<div class="val-preview" title="${preview}">
							<code>${preview}</code>
						</div>
						<div class="val-expand">
							<div class="val-toolbar">
								<button type="button" class="btn-copy">${LT.macro.copy()}</button>
								<button type="button" class="btn-collapse">${LT.macro.collapse()}</button>
							</div>
							<pre class="val-pre">${pretty}</pre>
						</div>
					</div>
				</div>
			`;
		}).join("");
	}

	async _renderHTML() {
		this._prepareRows();

		const cols = "grid-template-columns: minmax(160px,1.1fr) minmax(200px,1.3fr) 0.6fr 0.7fr minmax(260px,1.8fr);";

		const css =
			`#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important}` +
			`#${this.id} section.bbmm-preset-inspector{display:flex;flex:1 1 auto;min-height:0}` +
			`.bbmm-inspector-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}` +
			`.bbmm-toolbar{display:flex;gap:.5rem;align-items:center}` +
			`.bbmm-toolbar input{flex:1}` +

			`.bbmm-grid-head{display:grid;${cols}gap:0;border:1px solid var(--color-border,#444);border-radius:.5rem .5rem 0 0;background:var(--color-bg-header,#1e1e1e)}` +
			`.bbmm-grid-head .h{padding:.35rem .5rem;border-bottom:1px solid #444;font-weight:600}` +
			`.bbmm-grid-head .sortable{cursor:pointer;user-select:none}` +

			`.bbmm-grid-body{display:block;flex:1 1 auto;min-height:0;max-height:100%;overflow:auto;border:1px solid var(--color-border,#444);border-top:0;border-radius:0 0 .5rem .5rem}` +
			`.bbmm-grid-body .row{display:grid;${cols}gap:0;border-bottom:1px solid #333}` +
			`.bbmm-grid-body .row>div{padding:.3rem .5rem;min-width:0}` +

			`.bbmm-grid-body .c-val .val-preview{max-height:2.4em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}` +
			`.bbmm-grid-body .c-val .val-preview code{white-space:pre-wrap;word-break:break-word}` +
			`.bbmm-grid-body .c-val{cursor:pointer}` +

			`.bbmm-grid-body .row .val-expand{display:none;grid-column:5 / 6;margin-top:.25rem;border-top:1px dotted #444;padding-top:.25rem}` +
			`.bbmm-grid-body .row.expanded .val-expand{display:block}` +
			`.bbmm-grid-body .val-toolbar{display:flex;gap:.5rem;margin-bottom:.25rem}` +
			`.bbmm-grid-body .val-toolbar .btn-copy,.bbmm-grid-body .val-toolbar .btn-collapse{padding:.15rem .4rem;border:1px solid var(--color-border,#555);background:rgba(255,255,255,.05);border-radius:.35rem}` +
			`.bbmm-grid-body .val-pre{max-height:40vh;overflow:auto;margin:0;background:rgba(255,255,255,.03);padding:.4rem;border-radius:.35rem}` +

			`.bbmm-grid-body .row>div:not(.c-val){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;

		const head =
			`<div class="bbmm-grid-head" id="bbmm-preset-head">` +
				this._renderHeader() +
			`</div>`;

		const body =
			`<div class="bbmm-grid-body" id="bbmm-preset-body">` +
				this._renderRows() +
			`</div>`;

		return (
			`<style>${css}</style>` +
			`<div class="bbmm-inspector-root">` +
				`<div class="bbmm-toolbar">` +
					`<input id="bbmm-preset-filter" type="text" placeholder="${LT.macro.presetFilterPlaceholder()}" value="${hlp_esc(this.filter ?? "")}" />` +
					`<span class="count">${LT.macro.showing()} <span id="bbmm-preset-count">${this.rows.length}</span> ${LT.macro.of()} ${this.itemsAll.length}</span>` +
				`</div>` +
				head +
				body +
			`</div>`
		);
	}

	async _replaceHTML(result, _options) {
		const contentRegion = this.element.querySelector(".window-content") || this.element;
		contentRegion.style.display = "flex";
		contentRegion.style.flexDirection = "column";
		contentRegion.style.height = "100%";
		contentRegion.style.minHeight = "0";

		try {
			const winEl = this.element;
			winEl.style.minWidth = "500px";
			winEl.style.maxWidth = "1200px";
			winEl.style.minHeight = "400px";
			winEl.style.maxHeight = "700px";
			winEl.style.overflow = "hidden";
			DL("macros.js | BBMMPresetInspector: applied size clamps.");
		} catch (e) {
			DL(2, "macros.js | BBMMPresetInspector: failed to apply size clamps", e);
		}

		contentRegion.innerHTML = result;
		this._root = contentRegion;

		if (this._delegated) {
			this._rerender();
			return;
		}
		this._delegated = true;

		const root = this._root;

		root.addEventListener("click", (ev) => {
			const h = ev.target.closest?.(".bbmm-grid-head .sortable");
			if (!h) return;
			const k = h.dataset.sort;
			if (!k) return;
			if (this.sortKey === k) this.sortDir = (this.sortDir === "asc" ? "desc" : "asc");
			else { this.sortKey = k; this.sortDir = "asc"; }
			this._prepareRows();
			this._rerender();
		});

		root.addEventListener("click", async (ev) => {
			const copyBtn = ev.target.closest?.(".btn-copy");
			if (copyBtn) {
				const row = copyBtn.closest?.(".row");
				if (!row) return;
				const pre = row.querySelector?.(".val-pre");
				let txt = pre?.textContent ?? "";
				if (!txt) {
					const id = row.getAttribute("data-id") || "";
					const [ns, key] = id.split("::");
					const r = (this.rows || []).find(rr => rr.ns === ns && rr.key === key);
					txt = r ? toPretty(r._value) : "";
					if (pre) pre.textContent = txt;
				}
				const api = game.modules.get(BBMM_ID)?.api;
				await (api?.copyPlainText ? api.copyPlainText(txt) : copyPlainText(txt));
				return;
			}
			const collapseBtn = ev.target.closest?.(".btn-collapse");
			if (collapseBtn) {
				const row = collapseBtn.closest?.(".row");
				if (!row) return;
				row.classList.remove("expanded");
				return;
			}
			const valCell = ev.target.closest?.(".c-val");
			if (!valCell) return;
			const row = valCell.closest?.(".row");
			if (!row) return;
			const id = row.getAttribute("data-id") || "";
			if (row.classList.contains("expanded")) {
				row.classList.remove("expanded");
				this._expanded.delete(id);
			} else {
				row.classList.add("expanded");
				this._expanded.add(id);
			}
		});

		let _debTimer = null;
		const inputEl = root.querySelector("#bbmm-preset-filter");
		inputEl?.addEventListener("input", (ev) => {
			const val = ev.currentTarget.value ?? "";
			clearTimeout(_debTimer);
			_debTimer = setTimeout(() => {
				this.filter = val;
				this._prepareRows();
				this._rerender();
			}, 150);
		}, { passive: true });

		try { this.setPosition({ height: "auto", left: null, top: null }); } catch {}
	}

	_rerender() {
		const root = this._root;
		if (!root) return;
		const head = root.querySelector("#bbmm-preset-head");
		const body = root.querySelector("#bbmm-preset-body");
		const count = root.querySelector("#bbmm-preset-count");
		if (head) head.innerHTML = this._renderHeader();
		if (body) body.innerHTML = this._renderRows();
		if (count) count.textContent = String(this.rows.length);
	}
}

/* ==========================================================================
	Keybinds Inspector (simple merged viewer)
	- Lists registered actions + current user bindings
========================================================================== */
class BBMMKeybindInspector extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-keybind-inspector",
			window: { title: LT.macro.titleKeybindInspecor() },
			width: 900,
			height: 580,
			resizable: true
		});
		this.filter = "";
		this._rows = [];
	}

		_collect() {
		const out = [];
		try {
			const isMap = (x) => x && typeof x === "object" && x instanceof Map;

			// v13: single Map id -> info. Fallback to _actions if needed.
			const kb = game.keybindings || {};
			let actions = kb.actions;
			if (!isMap(actions) && isMap(kb._actions)) actions = kb._actions;
			if (!isMap(actions)) {
				DL(2, "macros.js | BBMMKeybindInspector._collect(): actions map missing");
				return out;
			}

			function localizeMaybe(val) {
				if (val == null) return "";
				if (typeof val !== "string") return String(val);
				try {
					const loc = game.i18n?.localize?.(val);
					return loc && loc !== val ? loc : val;
				} catch { return val; }
			}
			function normalizeBinding(b) {
				if (!b) return null;
				if (typeof b === "object" && "key" in b) {
					return { key: String(b.key ?? ""), modifiers: { ...(b.modifiers ?? {}) } };
				}
				if (Array.isArray(b)) {
					const [key, mods] = b;
					return { key: String(key ?? ""), modifiers: (mods && typeof mods === "object") ? mods : {} };
				}
				if (typeof b === "string") return { key: b, modifiers: {} };
				return null;
			}
			function fmtBinding(b) {
				if (!b) return "";
				const parts = [];
				const m = b.modifiers || {};
				if (m.ctrl) parts.push("Ctrl");
				if (m.shift) parts.push("Shift");
				if (m.alt) parts.push("Alt");
				if (m.meta) parts.push("Meta");
				if (b.key) parts.push(String(b.key).toUpperCase());
				return parts.join("+");
			}
			function fmtBindingsList(arr) {
				return (arr ?? [])
					.map(normalizeBinding).filter(Boolean)
					.map(fmtBinding).filter(Boolean)
					.join(", ");
			}

			for (const [id, info] of actions.entries()) {
				const ns = String(info?.namespace ?? id.split(".")[0] ?? "");
				const action = String(info?.action ?? id.split(".").slice(1).join(".") ?? "");

				const editableList = fmtBindingsList(info?.editable);
				const uneditableList = fmtBindingsList(info?.uneditable);
				const preview = [editableList, uneditableList].filter(Boolean).join(", ") || "(none)";

				const name = localizeMaybe(info?.name);
				const hint = localizeMaybe(info?.hint);
				const restricted = !!info?.restricted;
				const reservedMods = Array.isArray(info?.reservedModifiers) ? info.reservedModifiers.join(", ") : "";

				out.push({
					ns,
					action,
					name,
					hint,
					keys: preview,
					restricted: restricted ? "✓" : "",
					editable: editableList,
					uneditable: uneditableList,
					mods: reservedMods,
					__lc: {
						ns: ns.toLowerCase(),
						action: action.toLowerCase(),
						name: String(name ?? "").toLowerCase(),
						hint: String(hint ?? "").toLowerCase(),
						keys: preview.toLowerCase(),
						mods: reservedMods.toLowerCase()
					}
				});
			}

			DL("macros.js | BBMMKeybindInspector._collect(): collected actions", { count: out.length });
		} catch (e) {
			DL(2, "macros.js | BBMMKeybindInspector._collect(): failed", e);
		}

		return out.sort((a, b) => (a.ns.localeCompare(b.ns) || a.action.localeCompare(b.action)));
	}

	_renderRows() {
		const q = (this.filter || "").trim().toLowerCase();
		const rows = q
			? this._rows.filter(r =>
				r.__lc.ns.includes(q) ||
				r.__lc.action.includes(q) ||
				r.__lc.name.includes(q) ||
				r.__lc.hint.includes(q) ||
				r.__lc.keys.includes(q) ||
				r.__lc.mods.includes(q))
			: this._rows;

		return rows.map(r => `
			<div class="row">
				<div class="c-name" title="${hlp_esc(r.name)}">${hlp_esc(r.name)}</div>
				<div class="c-hint" title="${hlp_esc(r.hint)}">${hlp_esc(r.hint)}</div>
				<div class="c-ns" title="${hlp_esc(r.ns)}">${hlp_esc(r.ns)}</div>
				<div class="c-action" title="${hlp_esc(r.action)}">${hlp_esc(r.action)}</div>
				<div class="c-keys" title="${hlp_esc(r.keys)}"><code>${hlp_esc(r.keys)}</code></div>
				<div class="c-flag">${r.restricted}</div>
				<div class="c-editable" title="${hlp_esc(r.editable)}">${hlp_esc(r.editable)}</div>
				<div class="c-uneditable" title="${hlp_esc(r.uneditable)}">${hlp_esc(r.uneditable)}</div>
				<div class="c-mods" title="${hlp_esc(r.mods)}">${hlp_esc(r.mods)}</div>
			</div>
		`).join("");
	}

	async _renderHTML() {
		this._rows = this._collect();

		// Name, Hint, Namespace, Action, Keys, Restricted, Editable, Uneditable, Reserved Mods
		const cols = "grid-template-columns: 1.2fr 1.4fr 1.0fr 1.0fr 1.2fr 0.7fr 1.1fr 1.1fr 1.0fr;";
		const css =
			`#${this.id} .window-content{display:flex;flex-direction:column;padding:.5rem !important}` +
			`.bbmm-kb-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.5rem}` +
			`.bbmm-toolbar{display:flex;gap:.5rem;align-items:center}` +
			`.bbmm-toolbar input{flex:1}` +
			`.grid-head{display:grid;${cols}gap:0;border:1px solid var(--color-border,#444);border-radius:.5rem .5rem 0 0;background:var(--color-bg-header,#1e1e1e)}` +
			`.grid-head .h{padding:.35rem .5rem;border-bottom:1px solid #444;font-weight:600;user-select:none}` +
			`.grid-body{display:block;flex:1 1 auto;min-height:0;max-height:100%;overflow:auto;border:1px solid var(--color-border,#444);border-top:0;border-radius:0 0 .5rem .5rem}` +
			`.grid-body .row{display:grid;${cols}gap:0;border-bottom:1px solid #333}` +
			`.grid-body .row>div{padding:.3rem .5rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;

		return (
			`<style>${css}</style>` +
			`<div class="bbmm-kb-root">` +
				`<div class="bbmm-toolbar">` +
					`<input id="bbmm-kb-filter" type="text" placeholder="${LT.macro.keybindFilterPlaceholder()}" value="${hlp_esc(this.filter ?? "")}" />` +
					`<span class="count">${LT.macro.showing()} <span id="bbmm-kb-count">${this._rows.length}</span></span>` +
				`</div>` +
				`<div class="grid-head">` +
					`<div class="h">${LT.macro.columnName()}</div>` +
					`<div class="h">${LT.macro.columnHint()}</div>` +
					`<div class="h">${LT.macro.columnNamespace()}</div>` +
					`<div class="h">${LT.macro.columnAction()}</div>` +
					`<div class="h">${LT.macro.columnKeys()}</div>` +
					`<div class="h">${LT.macro.columnRestricted()}</div>` +
					`<div class="h">${LT.macro.columnEditable()}</div>` +
					`<div class="h">${LT.macro.columnUneditable()}</div>` +
					`<div class="h">${LT.macro.columnMods()}</div>` +
				`</div>` +
				`<div class="grid-body" id="bbmm-kb-body">${this._renderRows()}</div>` +
			`</div>`
		);
	}

	async _replaceHTML(result, _options) {
		const contentRegion = this.element.querySelector(".window-content") || this.element;
		contentRegion.style.display = "flex";
		contentRegion.style.flexDirection = "column";
		contentRegion.style.height = "100%";
		contentRegion.style.minHeight = "0";

		try {
			const winEl = this.element;
			winEl.style.minWidth = "520px";
			winEl.style.maxWidth = "1200px";
			winEl.style.minHeight = "360px";
			winEl.style.maxHeight = "740px";
			winEl.style.overflow = "hidden";
			DL("macros.js | BBMMKeybindInspector: size clamps applied");
		} catch (e) { DL(2, "macros.js | BBMMKeybindInspector: clamps failed", e); }

		contentRegion.innerHTML = result;
		this._root = contentRegion;

		if (this._delegated) return;
		this._delegated = true;

		const root = this._root;
		const body = root.querySelector("#bbmm-kb-body");
		const count = root.querySelector("#bbmm-kb-count");

		const rerender = () => {
			if (body) body.innerHTML = this._renderRows();
			if (count) count.textContent = String((this.filter||"") ? (body?.children.length || 0) : this._rows.length);
		};

		const inputEl = root.querySelector("#bbmm-kb-filter");
		let t = null;
		inputEl?.addEventListener("input", (ev) => {
			const val = ev.currentTarget.value ?? "";
			clearTimeout(t);
			t = setTimeout(() => {
				this.filter = val;
				rerender();
			}, 150);
		}, { passive: true });

		try { this.setPosition({ height: "auto", left: null, top: null }); } catch {}
	}
}

/* ==========================================================================
	Launchers exposed on API
========================================================================== */
export function openNamespaceInspector() {
	try {
		DL("macros.js | openNamespaceInspector(): launching");
		new BBMMNamespaceInspector().render(true);
	} catch (err) {
		DL(3, "macros.js | openNamespaceInspector(): error", err);
		ui.notifications.error(LT.macro.failedOpenSettingsInspector());
	}
}

export async function openPresetInspector() {
	try {
		const presetsRoot = await getAllSettingsPresets();

		// Support both schemas:
		// 1) New: { worlds: { [worldId]: { [presetName]: presetObj } } }
		// 2) Old: { [presetName]: presetObj }
		const worlds = (presetsRoot?.worlds && typeof presetsRoot.worlds === "object")
			? presetsRoot.worlds
			: null;

		/** @type {Array<{ id: string, name: string, displayName: string, worldId: string, preset: object, isCurrentWorld: boolean }>} */
		const list = [];

		const currentWorldId = game.world?.id || "unknownWorld";

		if (worlds) {
			for (const [worldId, presetsObj] of Object.entries(worlds)) {
				if (!presetsObj || typeof presetsObj !== "object") continue;

				for (const [name, preset] of Object.entries(presetsObj)) {
					list.push({
						id: `${worldId}::${name}`,
						name,
						displayName: name, // possibly updated below
						worldId,
						preset: (preset && typeof preset === "object") ? preset : {},
						isCurrentWorld: worldId === currentWorldId
					});
				}
			}
		} else {
			// Flat legacy map
			for (const [name, preset] of Object.entries(presetsRoot || {})) {
				list.push({
					id: `__legacy__::${name}`,
					name,
					displayName: name,
					worldId: "__legacy__",
					preset: (preset && typeof preset === "object") ? preset : {},
					isCurrentWorld: true
				});
			}
		}

		if (!list.length) {
			ui.notifications.warn(LT.macro.settingsPresetNoneFound());
			return;
		}

		// Disambiguate duplicates by name across worlds
		const counts = {};
		for (const p of list) counts[p.name] = (counts[p.name] || 0) + 1;
		for (const p of list) {
			if (counts[p.name] > 1) p.displayName = `${p.name} (${p.worldId})`;
		}

		// Sort: current world first, then name, then worldId
		list.sort((a, b) => {
			if (a.isCurrentWorld !== b.isCurrentWorld) return a.isCurrentWorld ? -1 : 1;
			const an = a.name.toLowerCase();
			const bn = b.name.toLowerCase();
			if (an !== bn) return an.localeCompare(bn);
			return a.worldId.localeCompare(b.worldId);
		});

		// Build index for lookups on click
		const presetIndex = {};
		for (const p of list) presetIndex[p.id] = p;

		const options = list
			.map(p => `<option value="${hlp_esc(p.id)}">${hlp_esc(p.displayName)}</option>`)
			.join("");

		const content = `
			<div style="min-width:420px;display:flex;flex-direction:column;gap:.75rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:9rem;">${LT.settingsPresetsBtn()}</label>
					<select name="presetName" style="flex:1;">${options}</select>
				</div>
			</div>
		`;

		const dlg = new foundry.applications.api.DialogV2({
			window: {
				title: LT.macro.titleInspectPreset(),
				icon: "fas fa-magnifying-glass"
			},
			content,
			buttons: [
				{ action: "inspect", label: LT.macro.btnInspect(), default: true },
				{ action: "cancel", label: LT.buttons.cancel() }
			],
			submit: (ctx) => ctx.action
		});

		const onRender = (app) => {
			if (app !== dlg) return;
			Hooks.off("renderDialogV2", onRender);

			try {
				const el = app.element;

				el.style.minWidth = "420px";
				el.style.maxWidth = "600px";
				el.style.maxHeight = "600px";
				el.style.overflow = "hidden";
				DL("macros.js | BBMM Preset Picker: applied size clamps.");
			} catch (e) {
				DL(2, "macros.js | BBMM Preset Picker: failed to apply size clamps", e);
			}

			try { dlg.setPosition({ height: "auto", left: null, top: null }); } catch {}

			const form = app.element?.querySelector("form");
			if (!form) return;
			form.querySelectorAll("button").forEach(b => b.setAttribute("type", "button"));

			form.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.("button");
				if (!(btn instanceof HTMLButtonElement)) return;

				const action = btn.dataset.action || "";
				if (!["inspect", "cancel"].includes(action)) return;

				ev.preventDefault();

				if (action === "cancel") {
					app.close();
					return;
				}

				const sel = /** @type {HTMLSelectElement} */ (form.elements.namedItem("presetName"));
				const presetId = sel?.value;
				if (!presetId) {
					ui.notifications.warn(LT.macro.selectPreset());
					return;
				}

				const picked = presetIndex[presetId];
				const preset = picked?.preset ?? {};
				const items = toPresetItems(preset);

				if (!items.length) {
					ui.notifications.error(LT.macro.presetMalformed());
					return;
				}

				app.close();
				new BBMMPresetInspector({ name: picked.displayName, items }).render(true);
			});
		};

		Hooks.on("renderDialogV2", onRender);

		dlg.render(true);
	} catch (err) {
		DL(3, "macros.js | openPresetInspector(): error", err);
		ui.notifications.error(LT.macro.failedOpenPresetInspector());
	}
}

export function openKeybindInspector() {
	try {
		DL("macros.js | openKeybindInspector(): launching");
		new BBMMKeybindInspector().render(true);
	} catch (err) {
		DL(3, "macros.js | openKeybindInspector(): error", err);
		ui.notifications.error(LT.macro.failedOpenKeybindInspector());
	}
}

/* ==========================================================================
	API registration 
========================================================================== */
export function registerApi() {
	try {
		const mod = game.modules.get(BBMM_ID);
		if (!mod) return DL(2, "registerApi(): BBMM module not found");
		mod.api = mod.api || {};
		Object.assign(mod.api, {
			copyPlainText,
			openNamespaceInspector,
			openPresetInspector,
			openKeybindInspector
		});
		DL("macros.js | registerApi(): API attached", Object.keys(mod.api));
	} catch (err) {
		DL(3, "macros.js | registerApi(): error", err);
	}
}
Hooks.once("init", () => {
	try {
		registerApi();
		DL("macros.js | macros:init(): BBMM macro API registered");
	} catch (err) {
		DL(3, "macros.js | macros:init(): failed to register BBMM macro API", err);
	}
});