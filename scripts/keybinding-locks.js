/* ==========================================================================
	BBMM: Keybinding Locks
	GM baseline (install-level data file) + per-user personal locks, re-applied
	on every load. Personal overrides the baseline. Delivery reuses the shared
	apply primitives on globalThis.bbmm.ctrl and the bbmm-ctrl-refresh socket,
	so there is one keybinding system.

	A "lock" entry: { id, namespace, action, mode: "clear"|"set", bindings: [] }
	  - id        = full action id, e.g. "core.elevateToken"
	  - namespace = portion before the first "."
	  - action    = portion after the first "."
	  - mode      = "clear" (unbind) or "set" (force to bindings)
	  - bindings  = [{ key, modifiers }], only used when mode === "set"
========================================================================== */

import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";

const PERSONAL_KEY = "keybindLocksPersonal";	// user scope: per-user, server-side
const SYNC_CH = `module.${BBMM_ID}`;

// GM baseline lives as an install-level data file (shared by every world on this
// install), not a world setting. GM writes it; players fetch to read.
const DATA_DIR = "bbmm-data";
const BASELINE_FILE = "keybind-locks.json";
const baselineUrl = () => foundry.utils.getRoute(`${DATA_DIR}/${BASELINE_FILE}`);

/* ==========================================================================
	{SHARED APPLY PRIMITIVES}
	Reuse Control Sync's binding read/write/compare (exposed by setting-sync.js
	on globalThis.bbmm.ctrl). Minimal fallbacks keep this robust if the shared
	object is not present yet.
========================================================================== */
function ctrlBindings(ns, action) {
	const fn = globalThis.bbmm?.ctrl?.bindings;
	if (fn) return fn(ns, action);
	try {
		return (game.keybindings.get(ns, action) ?? [])
			.map(b => ({ key: b?.key, modifiers: (b?.modifiers ?? []).slice() }))
			.filter(b => b.key);
	} catch { return []; }
}

async function ctrlSetBindings(ns, action, arr) {
	const fn = globalThis.bbmm?.ctrl?.setBindings;
	if (fn) return fn(ns, action, arr);
	try {
		await game.keybindings.set(ns, action, (arr ?? []).filter(b => b?.key)
			.map(b => ({ key: b.key, modifiers: Array.isArray(b.modifiers) ? b.modifiers.slice() : [] })));
	} catch (err) { DL(2, "keybinding-locks.js | ctrlSetBindings fallback failed", { ns, action, err }); }
}

function ctrlSame(a, b) {
	const fn = globalThis.bbmm?.ctrl?.same;
	if (fn) return fn(a, b);
	try {
		const ser = x => JSON.stringify((x ?? []).map(v => ({
			key: v?.key, modifiers: (v?.modifiers ?? []).slice().sort()
		})).sort((x, y) => (x.key || "").localeCompare(y.key || "")));
		return ser(a) === ser(b);
	} catch { return false; }
}

/* ==========================================================================
	{DATA HELPERS}
========================================================================== */
function readLocks(key) {
	try {
		const v = game.settings.get(BBMM_ID, key);
		return Array.isArray(v) ? v : [];
	} catch { return []; }
}

function clone(arr) {
	try { return structuredClone(arr); }
	catch { return JSON.parse(JSON.stringify(arr ?? [])); }
}

// Collapse duplicate locks for the same action id (last occurrence wins).
function dedupeById(arr) {
	const m = new Map();
	for (const l of (arr ?? [])) if (l?.id) m.set(l.id, l);
	return [...m.values()];
}

// Split a full action id into { namespace, action }. Package ids cannot contain
// dots, so splitting on the first "." reconstructs the original id.
function splitId(id) {
	const dot = String(id).indexOf(".");
	if (dot < 0) return { namespace: id, action: "" };
	return { namespace: id.slice(0, dot), action: id.slice(dot + 1) };
}

/* ==========================================================================
	{BASELINE FILE I/O}
	Install-level data file shared by all worlds. GM-write / everyone-read.
========================================================================== */
async function readBaseline() {
	try {
		const res = await fetch(baselineUrl(), { cache: "no-store" });
		if (!res.ok) return [];
		const data = await res.json();
		if (Array.isArray(data)) return data;
		if (data && Array.isArray(data.baseline)) return data.baseline;
		return [];
	} catch { return []; }
}

async function writeBaseline(arr) {
	// bbmm-data dir is ensured by settings.js; wait for that before uploading.
	await (globalThis.bbmm?._dataFilesReady ?? Promise.resolve());
	const payload = JSON.stringify({ baseline: arr ?? [] }, null, 2);
	const f = new File([payload], BASELINE_FILE, { type: "application/json" });
	const res = await foundry.applications.apps.FilePicker.implementation.upload("data", DATA_DIR, f, { notify: false });
	if (!res || (!res.path && !res.url)) throw new Error("baseline upload returned no path/url");
	DL(`keybinding-locks.js | baseline written (${(arr ?? []).length} lock(s))`);
}

/* ==========================================================================
	{KEY DISPLAY HELPERS}
========================================================================== */
function modName(m) {
	switch (m) {
		case "Control": return "Ctrl";
		case "Shift":   return "Shift";
		case "Alt":     return "Alt";
		case "Meta":    return "Meta";
		default:        return m;
	}
}

function fallbackKeyName(code) {
	if (!code) return "";
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
	if (code.startsWith("Arrow")) return code.slice(5);
	return code;
}

function humanizeBinding(b) {
	if (!b || !b.key) return "(none)";
	let keyStr = b.key;
	try {
		const KM = foundry.helpers?.interaction?.KeyboardManager;
		if (KM?.getKeycodeDisplayString) keyStr = KM.getKeycodeDisplayString(b.key);
	} catch { /* fall through */ }
	if (keyStr === b.key) keyStr = fallbackKeyName(b.key);
	const mods = (b.modifiers ?? []).map(modName);
	return [...mods, keyStr].join(" + ");
}

function currentBindingLabel(namespace, action) {
	try {
		const bindings = ctrlBindings(namespace, action) ?? [];
		if (!bindings.length) return LT.keybindLocks.unbound();
		return bindings.map(humanizeBinding).join(", ");
	} catch { return "?"; }
}

/* ==========================================================================
	{APPLY LOCKS}
	Merge baseline (everyone) + personal (this client); personal wins. Re-apply
	desired binding state. Exposed as globalThis.bbmm.applyKeybindLocks.
========================================================================== */
export async function bbmmApplyKeybindLocks() {
	if (!game.keybindings?.actions) return;

	const baseline = await readBaseline();
	const personal = readLocks(PERSONAL_KEY);

	const merged = new Map();
	for (const l of baseline) if (l?.id) merged.set(l.id, l);
	for (const l of personal) if (l?.id) merged.set(l.id, l);	// personal overrides

	DL(`keybinding-locks.js | applyKeybindLocks(): loading (baseline: ${baseline.length}, personal: ${personal.length}, effective: ${merged.size})`);

	let applied = 0, unchanged = 0, missing = 0, failed = 0;
	for (const lock of merged.values()) {
		if (!game.keybindings.actions.has(lock.id)) {
			missing++;	// action not registered this session (module disabled, etc.)
			DL(2, `keybinding-locks.js | skipped "${lock.id}" (action not registered this session)`);
			continue;
		}

		const { namespace, action } = lock.namespace != null && lock.action != null
			? lock
			: splitId(lock.id);

		const desired = lock.mode === "set" ? (Array.isArray(lock.bindings) ? lock.bindings : []) : [];
		const current = ctrlBindings(namespace, action) ?? [];
		if (ctrlSame(current, desired)) { unchanged++; continue; }

		try {
			await ctrlSetBindings(namespace, action, desired);
			applied++;
			DL(`keybinding-locks.js | ${lock.mode === "set" ? "set" : "cleared"} "${lock.id}"`);
		} catch (err) {
			failed++;
			DL(3, `keybinding-locks.js | apply failed for "${lock.id}": ${err?.message ?? err}`);
		}
	}

	DL(`keybinding-locks.js | applyKeybindLocks(): done (applied: ${applied}, already-correct: ${unchanged}, missing: ${missing}, failed: ${failed})`);
}

/* ==========================================================================
	{SHARED ACTION HELPERS}
========================================================================== */
// Localized label for a namespace (module title, or "Core").
function nsLabel(ns) {
	if (ns === "core") return LT.keybindLocks.core();
	try { return game.modules.get(ns)?.title ?? ns; } catch { return ns; }
}

// Sorted list of all registered keybinding actions: { id, namespace, action, name }.
function actionList() {
	const out = [];
	for (const [id, cfg] of game.keybindings.actions.entries()) {
		const { namespace, action } = splitId(id);
		let name = id;
		try { name = cfg?.name ? game.i18n.localize(cfg.name) : id; } catch {}
		out.push({ id, namespace, action, name });
	}
	out.sort((a, b) => {
		if (a.namespace !== b.namespace) {
			if (a.namespace === "core") return -1;
			if (b.namespace === "core") return 1;
			return nsLabel(a.namespace).localeCompare(nsLabel(b.namespace));
		}
		return a.name.localeCompare(b.name);
	});
	return out;
}

// Normalize a working lock into the stored shape; drop actions not registered.
function cleanLocks(arr) {
	return dedupeById((arr ?? [])
		.filter(l => l && l.id && game.keybindings.actions.has(l.id))
		.map(l => {
			const { namespace, action } = splitId(l.id);
			const mode = l.mode === "set" ? "set" : "clear";
			return {
				id: l.id, namespace, action, mode,
				bindings: mode === "set" ? (Array.isArray(l.bindings) ? l.bindings : []) : []
			};
		}));
}

/* ==========================================================================
	{ADD LOCK DIALOG}
	Searchable picker: namespace filter + search (matches action name AND the
	action's current key), pick an action, choose Clear or Set-to-key, then Add.
========================================================================== */
class BBMMKeybindLocksAddDialog extends foundry.applications.api.ApplicationV2 {

	static DEFAULT_OPTIONS = {
		id: "bbmm-keybind-lock-add",
		window: { title: "", icon: "fas fa-plus", resizable: true },
		position: { width: 640, height: 560 }
	};

	constructor(onAdd, isBaseline) {
		super({ window: { title: LT.keybindLocks.addTitle() } });
		this._onAdd = onAdd;				// callback(lock) back into the pane
		this._isBaseline = !!isBaseline;
		this._filter = "";
		this._ns = "__ALL__";
		this._selected = null;				// { id, namespace, action, name }
		this._mode = "clear";
		this._bindings = [];
		this._capturing = false;
		this._actions = [];
	}

	async _renderHTML() {
		return (
			`<div class="bbmm-kbla-wrap">` +
				`<div class="bbmm-kbla-controls">` +
					`<select class="bbmm-kbla-ns"></select>` +
					`<input type="text" class="bbmm-kbla-search" placeholder="${LT.keybindLocks.searchPlaceholder()}" autofocus />` +
				`</div>` +
				`<div class="bbmm-kbla-list"></div>` +
				`<div class="bbmm-kbla-footer">` +
					`<div class="bbmm-kbla-selinfo">${LT.keybindLocks.selectAction()}</div>` +
					`<div class="bbmm-kbla-setrow">` +
						`<select class="bbmm-kbla-mode">` +
							`<option value="clear">${LT.keybindLocks.modeClear()}</option>` +
							`<option value="set">${LT.keybindLocks.modeSet()}</option>` +
						`</select>` +
						`<span class="bbmm-kbla-keywrap" style="display:none;">` +
							`<span class="bbmm-kbla-keylist"></span>` +
							`<button type="button" class="bbmm-kbla-capture"><i class="fas fa-keyboard"></i> ${LT.keybindLocks.addKey()}</button>` +
						`</span>` +
						`<button type="button" class="bbmm-kbla-cancel">${LT.keybindLocks.cancel()}</button>` +
						`<button type="button" class="bbmm-kbla-add" disabled><i class="fas fa-plus"></i> ${LT.keybindLocks.addLock()}</button>` +
					`</div>` +
				`</div>` +
			`</div>`
		);
	}

	async _replaceHTML(result, _options) {
		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;
		this._wire();
	}

	// Namespaces that actually have registered actions, core first.
	_namespaces() {
		const seen = new Map();
		for (const a of this._actions) if (!seen.has(a.namespace)) seen.set(a.namespace, nsLabel(a.namespace));
		const arr = [...seen.entries()].map(([ns, label]) => ({ ns, label }));
		arr.sort((a, b) => {
			if (a.ns === "core") return -1;
			if (b.ns === "core") return 1;
			return a.label.localeCompare(b.label);
		});
		return arr;
	}

	_matches(a) {
		if (this._ns !== "__ALL__" && a.namespace !== this._ns) return false;
		const q = this._filter.trim().toLowerCase();
		if (!q) return true;
		const current = currentBindingLabel(a.namespace, a.action).toLowerCase();
		return a.name.toLowerCase().includes(q)
			|| a.id.toLowerCase().includes(q)
			|| current.includes(q);
	}

	_renderList() {
		const list = this.element.querySelector(".bbmm-kbla-list");
		if (!list) return;
		list.replaceChildren();

		const matches = this._actions.filter(a => this._matches(a));
		if (!matches.length) {
			const empty = document.createElement("p");
			empty.className = "bbmm-kbla-empty";
			empty.textContent = LT.keybindLocks.noMatch();
			list.appendChild(empty);
			return;
		}

		for (const a of matches) {
			const row = document.createElement("div");
			row.className = "bbmm-kbla-row";
			if (this._selected?.id === a.id) row.classList.add("selected");

			const current = currentBindingLabel(a.namespace, a.action);
			row.innerHTML =
				`<span class="bbmm-kbla-name"><strong>${a.name}</strong></span>` +
				`<span class="bbmm-kbla-nscol">${nsLabel(a.namespace)}</span>` +
				`<span class="bbmm-kbla-cur">${current}</span>`;
			row.dataset.tooltip = `${a.name} - ${nsLabel(a.namespace)} (${a.id})\n${current}`;

			row.addEventListener("click", () => {
				this._selected = a;
				this._renderList();
				this._syncFooter();
			});
			list.appendChild(row);
		}
	}

	_syncFooter() {
		const selInfo = this.element.querySelector(".bbmm-kbla-selinfo");
		const addBtn = this.element.querySelector(".bbmm-kbla-add");
		const keyWrap = this.element.querySelector(".bbmm-kbla-keywrap");

		if (selInfo) {
			selInfo.textContent = this._selected
				? `${this._selected.name} (${nsLabel(this._selected.namespace)})`
				: LT.keybindLocks.selectAction();
		}
		if (keyWrap) keyWrap.style.display = this._mode === "set" ? "" : "none";

		const ready = !!this._selected && (this._mode === "clear" || this._bindings.length > 0);
		if (addBtn) addBtn.disabled = !ready;
	}

	// Render the captured-key chips (one per binding; a lock may hold several).
	_renderKeyList() {
		const list = this.element.querySelector(".bbmm-kbla-keylist");
		if (!list) return;
		list.replaceChildren();
		if (!this._bindings.length) {
			const hint = document.createElement("span");
			hint.className = "bbmm-kbla-keyempty";
			hint.textContent = LT.keybindLocks.noKeys();
			list.appendChild(hint);
			return;
		}
		this._bindings.forEach((b, i) => {
			const chip = document.createElement("span");
			chip.className = "bbmm-kbla-keychip";
			chip.append(Object.assign(document.createElement("span"), {
				className: "bbmm-kbla-keytext", textContent: humanizeBinding(b)
			}));
			const rm = document.createElement("button");
			rm.type = "button";
			rm.className = "bbmm-kbla-keyremove";
			rm.innerHTML = `<i class="fas fa-xmark"></i>`;
			rm.dataset.tooltip = LT.keybindLocks.removeKey();
			rm.addEventListener("click", () => {
				this._bindings.splice(i, 1);
				this._renderKeyList();
				this._syncFooter();
			});
			chip.appendChild(rm);
			list.appendChild(chip);
		});
	}

	_beginCapture(btn) {
		if (this._capturing) return;
		this._capturing = true;
		const prev = btn.innerHTML;
		btn.innerHTML = `<i class="fas fa-keyboard"></i> ${LT.keybindLocks.pressKey()}`;

		const MOD_ONLY = new Set([
			"ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
			"AltLeft", "AltRight", "MetaLeft", "MetaRight"
		]);

		const handler = (ev) => {
			if (MOD_ONLY.has(ev.code)) return;
			ev.preventDefault();
			ev.stopPropagation();
			document.removeEventListener("keydown", handler, true);
			this._capturing = false;
			btn.innerHTML = prev;

			if (ev.code === "Escape") return;

			const modifiers = [];
			if (ev.ctrlKey)  modifiers.push("Control");
			if (ev.shiftKey) modifiers.push("Shift");
			if (ev.altKey)   modifiers.push("Alt");
			const b = { key: ev.code, modifiers };
			// Append, skipping an identical chord already captured.
			if (!this._bindings.some(x => ctrlSame([x], [b]))) this._bindings.push(b);
			this._renderKeyList();
			this._syncFooter();
		};
		document.addEventListener("keydown", handler, true);
	}

	_wire() {
		this._actions = actionList();

		// Namespace filter
		const nsSel = this.element.querySelector(".bbmm-kbla-ns");
		if (nsSel) {
			nsSel.replaceChildren();
			const all = document.createElement("option");
			all.value = "__ALL__"; all.textContent = LT.keybindLocks.allNamespaces();
			nsSel.appendChild(all);
			for (const { ns, label } of this._namespaces()) {
				const o = document.createElement("option");
				o.value = ns; o.textContent = label;
				nsSel.appendChild(o);
			}
			nsSel.value = this._ns;
			nsSel.addEventListener("change", () => { this._ns = nsSel.value; this._renderList(); });
		}

		// Search
		const search = this.element.querySelector(".bbmm-kbla-search");
		if (search) {
			search.value = this._filter;
			search.addEventListener("input", () => { this._filter = search.value; this._renderList(); });
		}

		// Mode + capture
		const modeSel = this.element.querySelector(".bbmm-kbla-mode");
		const captureBtn = this.element.querySelector(".bbmm-kbla-capture");
		if (modeSel) {
			modeSel.value = this._mode;
			modeSel.addEventListener("change", () => { this._mode = modeSel.value; this._syncFooter(); });
		}
		if (captureBtn) {
			captureBtn.addEventListener("click", () => this._beginCapture(captureBtn));
		}

		// Cancel / Add
		this.element.querySelector(".bbmm-kbla-cancel")?.addEventListener("click", () => this.close());
		this.element.querySelector(".bbmm-kbla-add")?.addEventListener("click", () => this._commit());

		this._renderList();
		this._renderKeyList();
		this._syncFooter();
	}

	_commit() {
		const a = this._selected;
		if (!a) return;
		if (this._mode === "set" && !this._bindings.length) {
			ui.notifications.warn(LT.keybindLocks.captureFirst());
			return;
		}
		this._onAdd?.({
			id: a.id, namespace: a.namespace, action: a.action,
			mode: this._mode,
			bindings: this._mode === "set" ? this._bindings : []
		});
		DL(`keybinding-locks.js | add dialog: added ${this._mode} lock for "${a.id}"`);
		this.close();
	}
}

/* ==========================================================================
	{TOOLBOX TAB}
	Player-accessible pane. GM sees Baseline + Personal; player sees Personal.
	Working state lives in this closure; Save & Apply writes it out.
========================================================================== */
async function mountKeybindLocks(container) {
	const isGM = game.user.isGM;

	const working = {
		baseline: isGM ? dedupeById(clone(await readBaseline())) : [],
		personal: dedupeById(clone(readLocks(PERSONAL_KEY)))
	};
	// Players get a read-only view of the GM baseline (enforced locks).
	const enforced = isGM ? [] : dedupeById(clone(await readBaseline()));
	const nameById = new Map(actionList().map(a => [a.id, a]));

	const baselineSection = isGM
		? (
			`<fieldset class="bbmm-kbl-fieldset">` +
				`<legend><i class="fas fa-users"></i> ${LT.keybindLocks.baselineLegend()}</legend>` +
				`<p class="bbmm-kbl-hint">${LT.keybindLocks.baselineHint()}</p>` +
				`<div class="bbmm-kbl-list" data-scope="baseline"></div>` +
				`<button type="button" class="bbmm-kbl-add" data-scope="baseline"><i class="fas fa-plus"></i> ${LT.keybindLocks.addBaseline()}</button>` +
			`</fieldset>`
		)
		: "";

	// Read-only "GM-Enforced" section (players only).
	const enforcedSection = isGM
		? ""
		: (
			`<fieldset class="bbmm-kbl-fieldset">` +
				`<legend><i class="fas fa-users"></i> ${LT.keybindLocks.enforcedLegend()}</legend>` +
				`<p class="bbmm-kbl-hint">${LT.keybindLocks.enforcedHint()}</p>` +
				`<div class="bbmm-kbl-list" data-scope="enforced"></div>` +
			`</fieldset>`
		);

	const pushBtn = isGM
		? `<button type="button" class="bbmm-kbl-push"><i class="fas fa-paper-plane"></i> ${LT.keybindLocks.push()}</button>`
		: "";

	container.innerHTML =
		`<div class="bbmm-kbl-wrap">` +
			`<p class="bbmm-kbl-intro">${LT.keybindLocks.intro()}</p>` +
			`<p class="bbmm-kbl-hint bbmm-kbl-reapply">${LT.keybindLocks.reapplyHint()}</p>` +
			baselineSection +
			enforcedSection +
			`<fieldset class="bbmm-kbl-fieldset">` +
				`<legend><i class="fas fa-user"></i> ${LT.keybindLocks.personalLegend()}</legend>` +
				`<p class="bbmm-kbl-hint">${LT.keybindLocks.personalHint()}</p>` +
				`<div class="bbmm-kbl-list" data-scope="personal"></div>` +
				`<button type="button" class="bbmm-kbl-add" data-scope="personal"><i class="fas fa-plus"></i> ${LT.keybindLocks.addPersonal()}</button>` +
			`</fieldset>` +
			`<footer class="bbmm-kbl-footer">` +
				pushBtn +
				`<button type="button" class="bbmm-kbl-save"><i class="fas fa-save"></i> ${LT.keybindLocks.saveApply()}</button>` +
			`</footer>` +
		`</div>`;

	// Row for one lock: label + mode/key badge + remove. readOnly skips the remove
	// button (used for the players' GM-enforced list).
	const makeRow = (scope, lock, readOnly = false) => {
		const row = document.createElement("div");
		row.className = "bbmm-kbl-row";

		const info = nameById.get(lock.id);
		const name = info?.name ?? lock.id;
		const nsTxt = nsLabel(lock.namespace ?? splitId(lock.id).namespace);

		const label = document.createElement("span");
		label.className = "bbmm-kbl-actionlabel";
		label.innerHTML = `<strong>${name}</strong> <span class="bbmm-kbl-ns">${nsTxt}</span>`;
		label.dataset.tooltip = `${name} - ${nsTxt} (${lock.id})`;

		const summary = document.createElement("span");
		summary.className = "bbmm-kbl-summary";
		if (lock.mode === "set") {
			const keyTxt = (lock.bindings ?? []).map(humanizeBinding).join(", ") || "(none)";
			summary.innerHTML = `<i class="fas fa-keyboard"></i> ${keyTxt}`;
			summary.dataset.tooltip = LT.keybindLocks.forcedTo({ key: keyTxt });
			summary.classList.add("is-set");
		} else {
			summary.innerHTML = `<i class="fas fa-ban"></i> ${LT.keybindLocks.cleared()}`;
			summary.dataset.tooltip = LT.keybindLocks.keptUnbound();
			summary.classList.add("is-clear");
		}

		if (readOnly) {
			row.append(label, summary);
			return row;
		}

		const rm = document.createElement("button");
		rm.type = "button";
		rm.className = "bbmm-kbl-remove";
		rm.innerHTML = `<i class="fas fa-trash"></i>`;
		rm.dataset.tooltip = LT.keybindLocks.remove();
		rm.addEventListener("click", () => {
			const arr = working[scope];
			const idx = arr.indexOf(lock);
			if (idx >= 0) arr.splice(idx, 1);
			renderRows(scope);
		});

		row.append(label, summary, rm);
		return row;
	};

	// Render the players' read-only GM-enforced list.
	const renderEnforced = () => {
		const list = container.querySelector(`.bbmm-kbl-list[data-scope="enforced"]`);
		if (!list) return;
		list.replaceChildren();
		if (!enforced.length) {
			const empty = document.createElement("p");
			empty.className = "bbmm-kbl-empty";
			empty.textContent = LT.keybindLocks.noEnforced();
			list.appendChild(empty);
			return;
		}
		for (const lock of enforced) list.appendChild(makeRow("enforced", lock, true));
	};

	const renderRows = (scope) => {
		const list = container.querySelector(`.bbmm-kbl-list[data-scope="${scope}"]`);
		if (!list) return;
		list.replaceChildren();
		const arr = working[scope];
		if (!arr.length) {
			const empty = document.createElement("p");
			empty.className = "bbmm-kbl-empty";
			empty.textContent = LT.keybindLocks.noLocks();
			list.appendChild(empty);
			return;
		}
		for (const lock of arr) list.appendChild(makeRow(scope, lock));
	};

	// Insert or replace a lock for the given action, then re-render.
	const addLock = (scope, lock) => {
		const arr = working[scope];
		const existing = arr.find(l => l.id === lock.id);
		if (existing) {
			existing.mode = lock.mode;
			existing.bindings = lock.bindings;
			existing.namespace = lock.namespace;
			existing.action = lock.action;
		} else {
			arr.push(lock);
		}
		renderRows(scope);
	};

	const onClick = async (ev) => {
		const addBtn = ev.target.closest?.(".bbmm-kbl-add");
		if (addBtn) {
			const scope = addBtn.dataset.scope;
			new BBMMKeybindLocksAddDialog((lock) => addLock(scope, lock), scope === "baseline").render(true);
			return;
		}

		const saveBtn = ev.target.closest?.(".bbmm-kbl-save");
		if (saveBtn) {
			try {
				await game.settings.set(BBMM_ID, PERSONAL_KEY, cleanLocks(working.personal));
				if (isGM) await writeBaseline(cleanLocks(working.baseline));
				await bbmmApplyKeybindLocks();
				if (isGM) game.socket?.emit?.(SYNC_CH, { t: "bbmm-ctrl-refresh" });
				ui.notifications.info(LT.keybindLocks.saved());
				DL("keybinding-locks.js | saved and applied");
			} catch (err) {
				DL(3, "keybinding-locks.js | save failed", err);
				ui.notifications.error(LT.keybindLocks.saveFailed());
			}
			return;
		}

		const pushBtnEl = ev.target.closest?.(".bbmm-kbl-push");
		if (pushBtnEl && isGM) {
			// Live-push current baseline (+ effective locks) to online players now:
			// save first so receivers read the fresh file, then broadcast refresh.
			try {
				await writeBaseline(cleanLocks(working.baseline));
				await bbmmApplyKeybindLocks();
				game.socket?.emit?.(SYNC_CH, { t: "bbmm-ctrl-refresh" });
				ui.notifications.info(LT.keybindLocks.pushed());
				DL("keybinding-locks.js | pushed locks to players");
			} catch (err) {
				DL(3, "keybinding-locks.js | push failed", err);
				ui.notifications.error(LT.keybindLocks.saveFailed());
			}
			return;
		}
	};

	container.addEventListener("click", onClick);

	for (const scope of ["baseline", "personal"]) renderRows(scope);
	if (!isGM) renderEnforced();

	return () => container.removeEventListener("click", onClick);
}

/* ==========================================================================
	{REGISTRATION}
========================================================================== */
globalThis.bbmm ??= {};
globalThis.bbmm.toolboxTools ??= [];
globalThis.bbmm.toolboxTools.push({
	id: "keybindLocks",
	icon: "fa-solid fa-keyboard",
	label: () => LT.toolbox.tabKeybindLocks(),
	visible: () => true,				// players manage personal locks; GM also sees baseline
	group: null,
	mount: async (container) => { await mountKeybindLocks(container); }
});

// Expose the apply primitive for setting-sync.js delegators + macro/console use.
globalThis.bbmm.applyKeybindLocks = bbmmApplyKeybindLocks;

Hooks.once("ready", async () => {
	// One-time cleanup: drop orphaned @ctrl: entries left by the retired control
	// soft-lock. softLockLedger is user-scoped and also holds settings soft-lock
	// state, so strip only @ctrl: keys, never the object.
	try {
		const ledger = game.settings.get(BBMM_ID, "softLockLedger");
		if (ledger && typeof ledger === "object") {
			let changed = false;
			for (const k of Object.keys(ledger)) if (k.startsWith("@ctrl:")) { delete ledger[k]; changed = true; }
			if (changed) await game.settings.set(BBMM_ID, "softLockLedger", ledger);
		}
	} catch (err) { DL(2, "keybinding-locks.js | @ctrl ledger cleanup failed", err); }

	// Apply locks on load, this is what stops bindings from reverting.
	await bbmmApplyKeybindLocks();

	const mod = game.modules.get(BBMM_ID);
	if (mod) { mod.api ??= {}; Object.assign(mod.api, { applyKeybindLocks: bbmmApplyKeybindLocks }); }
});
