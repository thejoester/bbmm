import { DL } from './settings.js';
import { EXPORT_SKIP } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";

/* Cache the effective skip map until invalidated */
let _skipMapCache = null;

/* ==========================================================================
	General helpers
========================================================================== */

// Tiny safe HTML escaper for labels/values
export function hlp_esc(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	}[m]));
}

// get time stamp
export function hlp_timestampStr(d = new Date()) {
	const p = (n, l=2) => String(n).padStart(l, "0");
	return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// export to .json file
export async function hlp_saveJSONFile(data, filename) {
	if (typeof saveDataToFile === "function") {
		return saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
	}

	if (window.showSaveFilePicker) {
		try {
			const handle = await showSaveFilePicker({
				suggestedName: filename,
				types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
			});
			const stream = await handle.createWritable();
			await stream.write(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
			return stream.close();
		} catch (e) {
			// user probably cancelled; just return
			return;
		}
	}

	// 3) Fallback: anchor download (uses browser download location / may not prompt)
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// prompt to pick .json file
export function hlp_pickLocalJSONFile() {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "application/json";
		input.style.display = "none";
		document.body.appendChild(input);
		input.addEventListener("change", () => {
			const file = input.files?.[0] ?? null;
			document.body.removeChild(input);
			resolve(file || null);
		}, { once: true });
		input.click();
	});
}

// Normalize name to compare when saving
export function hlp_normalizePresetName(s) {
	return String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/* ==========================================================================
	Exclusion helpers
========================================================================== */

export function invalidateSkipMap() {
	// Call this if you change bbmm.userExclusions or EXPORT_SKIP at runtime
	_skipMapCache = null;
}

// build effective skip map from EXPORT_SKIP + user exclusions
export function getSkipMap() {
	if (_skipMapCache) return _skipMapCache;

	const out = new Map(EXPORT_SKIP ?? new Map());
	const ex = globalThis.bbmm?._userExclusions ?? { settings: [], modules: [] };
	
	// Entire modules → add "*"
	for (const ns of ex.modules ?? []) {
		if (!ns) continue;
		const set = out.get(ns) ?? new Set();
		set.add("*");
		out.set(ns, set);
	}

	// Specific settings [{ namespace, key }]
	for (const ent of ex.settings ?? []) {
		if (!ent?.namespace || !ent?.key) continue;
		const set = out.get(ent.namespace) ?? new Set();
		set.add(ent.key);
		out.set(ent.namespace, set);
	}

	_skipMapCache = out;
	return _skipMapCache;
}

/* Fast predicate that uses a provided map (no rebuild/logging) */
export function isExcludedWith(skipMap, namespace, key) {
	const val = skipMap.get(namespace);
	if (!val) return false;
	if (val === "*" || (val instanceof Set && val.has("*"))) return true;
	return !!(key && val instanceof Set && val.has(key));
}

/* ==========================================================================
	Help / Manual button injection (DialogV2 + other Apps)
========================================================================== */

// Open a JournalEntry or JournalEntryPage by UUID
export async function hlp_openManualByUuid(uuid) {
	const FN = "helpers.js | hlp_openManualByUuid():";

	try {
		const u = String(uuid || "").trim();
		if (!u) {
			DL(2, `${FN} missing uuid`, { uuid });
			return false;
		}

		DL(`${FN} opening`, { uuid: u });

		let doc;
		try {
			doc = await fromUuid(u);
		} catch (e) {
			DL(3, `${FN} fromUuid failed`, { uuid: u, err: e });
			return false;
		}

		if (!doc) {
			DL(2, `${FN} uuid not found`, { uuid: u });
			return false;
		}

		// If it's a JournalEntryPage, open the parent journal and try to focus the page.
		// Foundry versions differ a bit here, so we try a few safe approaches.
		const isPage = doc.documentName === "JournalEntryPage" || doc.constructor?.name === "JournalEntryPage";
		if (isPage) {
			const parent = doc.parent;
			if (!parent) {
				DL(2, `${FN} JournalEntryPage has no parent`, { uuid: u, doc });
				return false;
			}

			DL(`${FN} opening parent JournalEntry for page`, { journalId: parent.id, pageId: doc.id });

			// Try render with pageId hint (works in newer builds)
			try {
				parent.sheet?.render(true, { pageId: doc.id });
				return true;
			} catch (e) {
				DL(2, `${FN} parent.sheet.render(pageId) failed, falling back`, e);
			}

			// Fallback: just open the journal
			try {
				parent.sheet?.render(true);
				return true;
			} catch (e) {
				DL(3, `${FN} parent.sheet.render() failed`, e);
				return false;
			}
		}

		// JournalEntry (or anything else with a sheet)
		if (doc.sheet?.render) {
			try {
				doc.sheet.render(true);
				return true;
			} catch (e) {
				DL(3, `${FN} doc.sheet.render() failed`, e);
				return false;
			}
		}

		DL(2, `${FN} doc has no sheet to render`, { uuid: u, documentName: doc.documentName });
		return false;
	} catch (e) {
		DL(3, `${FN} fatal error`, e);
		return false;
	}
}

// Inject a help/manual button into a Foundry Window header.
export function hlp_injectHeaderHelpButton(app, opts = {}) {
	const FN = "helpers.js | hlp_injectHeaderHelpButton():";

	try {
		const uuid = String(opts.uuid || "").trim();
		if (!uuid) {
			DL(2, `${FN} missing uuid`, { opts });
			return false;
		}

		const root = app?.element;
		if (!root) {
			DL(2, `${FN} missing app.element`, { app });
			return false;
		}

		// Avoid double-injection
		const injectKey = "bbmmHelpInjected"; 
		if (root.dataset[injectKey] === uuid) return true;

		const header = root.querySelector(".window-header");
		if (!header) {
			DL(2, `${FN} missing .window-header`, { rootTag: root?.tagName });
			return false;
		}

		// Find the controls container
		let controls =
			header.querySelector(".window-controls") ||
			header.querySelector(".window-header-controls") ||
			header.querySelector('[data-application-part="controls"]');

		// If Foundry didn't wrap controls, they're often just direct children of .window-header.
		if (!controls) controls = header;

		// If header still isn't usable, bail once (no retry spam).
		if (!controls) {
			DL(2, `${FN} missing header controls host`, {
				appName: app?.constructor?.name,
				rootTag: root?.tagName,
				headerTag: header?.tagName
			});
			return false;
		}

		const btnClass = String(opts.btnClass || "bbmm-help-btn").trim();
		const existing = controls.querySelector(`.${btnClass.replace(/\s+/g, ".")}`);
		if (existing) {
			// already injected
			return true;
		}

		// Find the close button so we can insert right before it.
		// Foundry usually uses .close, but we fall back gracefully.
		const closeBtn =
			controls.querySelector('[data-action="close"]') ||
			controls.querySelector(".close") ||
			controls.querySelector(".header-control.close") ||
			controls.lastElementChild;

		const a = document.createElement("a");
		a.className = `header-control ${btnClass}`.trim();
		a.href = "#";
		a.role = "button";
		a.dataset.action = "bbmm-help";
		a.dataset.uuid = uuid;

		// our localized text, not user input, so no escape needed
		a.title = String(opts.title || (LT?.buttons?.help?.() ?? "Help"));

		const iconClass = String(opts.iconClass || "fas fa-circle-question");
		a.innerHTML = `<i class="${iconClass}"></i>`;

		// Insert before close button
		if (closeBtn?.parentElement === controls) controls.insertBefore(a, closeBtn);
		else controls.appendChild(a);

		// Click handler
		a.addEventListener("click", async (ev) => {
			ev.preventDefault();
			ev.stopPropagation();

			try {
				const u = a.dataset.uuid;
				DL(`${FN} help clicked`, { uuid: u });

				const doc = await fromUuid(u);
				if (!doc) {
					DL(2, `${FN} fromUuid returned nothing`, { uuid: u });
					return;
				}

				// JournalEntryPage renders itself; JournalEntry has .sheet
				if (doc.documentName === "JournalEntryPage") {
					await doc.sheet.render(true);
				} else if (doc.sheet?.render) {
					await doc.sheet.render(true);
				} else {
					DL(2, `${FN} doc has no renderable sheet`, { uuid: u, documentName: doc.documentName });
				}
			} catch (e) {
				DL(3, `${FN} help click failed`, e);
			}
		});

		DL(`${FN} injected help button`, {
			uuid,
			appName: app?.constructor?.name,
			headerTitle: header.querySelector(".window-title")?.textContent?.trim()
		});

		root.dataset[injectKey] = uuid; // mark as injected
		return true;
	} catch (e) {
		DL(3, `${FN} fatal`, e);
		return false;
	}
}

/* ==========================================================================
	Import / Export functions
========================================================================== */

// export Module presets
export async function bbmm_exportModulePresetsAll() {
	const FN = "helpers.js | bbmm_exportModulePresetsAll():";
	const storageFile = "module-presets.json";
	const url = `bbmm-data/${storageFile}`;

	try {
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) {
			DL(3, `${FN} fetch not ok`, { url, status: res.status });
			ui.notifications.error(`${LT.errors.errorOccured()}.`);
			return;
		}

		const data = await res.json();
		const d = new Date();
		const pad = (n) => String(n).padStart(2, "0");
		const fname = `${d.getFullYear()}-${pad(d.getDate())}-${pad(d.getMonth() + 1)}-bbmm-module-presets.json`;

		await hlp_saveJSONFile(data ?? {}, fname);
		DL(1, `${FN} exported module presets`, { url, fname, count: Object.keys(data ?? {}).length });
	} catch (err) {
		DL(3, `${FN} failed`, err);
		ui.notifications.error(`${LT.errors.errorOccured()}.`);
	}
}

// import Module presets
export async function bbmm_importModulePresetsAll() {
	const FN = "helpers.js | bbmm_importModulePresetsAll():";
	const storageFile = "module-presets.json";
	const url = `bbmm-data/${storageFile}`;

	const file = await hlp_pickLocalJSONFile();
	if (!file) return;

	let data;
	try {
		data = JSON.parse(await file.text());
	} catch (err) {
		DL(3, `${FN} invalid json import file`, err);
		ui.notifications.error(`${LT.errors.invalidJSONFile()}.`);
		return;
	}

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		DL(3, `${FN} invalid import shape`, data);
		ui.notifications.error(`${LT.errors.invalidJSONFile()}.`);
		return;
	}

	// Load current presets so we can MERGE instead of overwrite
	let current = {};
	try {
		const res = await fetch(url, { cache: "no-store" });
		if (res.ok) {
			current = await res.json();
			if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
		} else {
			DL(2, `${FN} current presets fetch not ok, starting empty`, { url, status: res.status });
			current = {};
		}
	} catch (err) {
		DL(2, `${FN} current presets fetch failed, starting empty`, err);
		current = {};
	}

	// Merge imported presets into current
	let added = 0;
	let renamed = 0;

	for (const [name, preset] of Object.entries(data)) {
		if (!name || typeof name !== "string") continue;

		// Module preset format should be an array (module ids)
		if (!Array.isArray(preset)) continue;

		// Clean array: strings only, trimmed, unique
		const clean = [...new Set(preset.filter(x => typeof x === "string" && x.trim()).map(x => x.trim()))];

		let finalName = name;

		// Only rename if there is a collision
		if (Object.prototype.hasOwnProperty.call(current, finalName)) {
			const d = new Date();
			const pad = (n) => String(n).padStart(2, "0");
			const dateStamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
			const timeStamp = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

			finalName = `${name} (imported on ${dateStamp} ${timeStamp})`;
			renamed++;

			let i = 2;
			while (Object.prototype.hasOwnProperty.call(current, finalName)) {
				finalName = `${name} (imported on ${dateStamp} ${timeStamp}) (${i})`;
				i++;
			}
		}

		current[finalName] = clean;
		added++;
	}

	try {
		const payload = JSON.stringify(current ?? {}, null, 2);
		const f = new File([payload], storageFile, { type: "application/json" });
		const res = await foundry.applications.apps.FilePicker.implementation.upload("data", `bbmm-data`, f, { notify: false });

		if (!res || (!res.path && !res.url)) {
			DL(3, `${FN} upload returned no path/url`, res);
			ui.notifications.error(`${LT.errors.errorOccured()}.`);
			return;
		}

		DL(1, `${FN} imported module presets (merged)`, { added, renamed, res });
		ui.notifications.info(`Imported ${added} module preset(s).${renamed ? ` Renamed ${renamed}.` : ""}`);
	} catch (err) {
		DL(3, `${FN} uploadPersistent failed`, err);
		ui.notifications.error(`${LT.errors.errorOccured()}.`);
	}
}

// export Settings presets
export async function bbmm_exportSettingsPresetsAll() {
	const FN = "helpers.js | bbmm_exportSettingsPresetsAll():";
	const storageFile = "settings-presets.json";
	const url = `bbmm-data/${storageFile}`;

	try {
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) {
			DL(3, `${FN} fetch not ok`, { url, status: res.status });
			ui.notifications.error(`${LT.errors.errorOccured()}.`);
			return;
		}

		const data = await res.json();
		const d = new Date();
		const pad = (n) => String(n).padStart(2, "0");
		const fname = `${d.getFullYear()}-${pad(d.getDate())}-${pad(d.getMonth() + 1)}-bbmm-settings-presets.json`;

		await hlp_saveJSONFile(data ?? {}, fname);
		DL(1, `${FN} exported settings presets`, { url, fname, count: Object.keys(data ?? {}).length });
	} catch (err) {
		DL(3, `${FN} failed`, err);
		ui.notifications.error(`${LT.errors.errorOccured()}.`);
	}
}

// import Settings presets (merge into existing + convert old single-preset format)
export async function bbmm_importSettingsPresetsAll() {
	const FN = "helpers.js | bbmm_importSettingsPresetsAll():";
	const storageFile = "settings-presets.json";
	const url = `bbmm-data/${storageFile}`;

	const file = await hlp_pickLocalJSONFile();
	if (!file) return;

	let data;
	try {
		data = JSON.parse(await file.text());
		
		// If a user imports a SINGLE settings preset payload (type/created/world/client/user),
		// wrap it into the expected map format using the filename as the preset name.
		if (data && typeof data === "object" && !Array.isArray(data)
			&& data.type === "bbmm-settings"
			&& data.world && typeof data.world === "object"
			&& data.client && typeof data.client === "object"
			&& data.user && typeof data.user === "object"
		) {
			const presetName = (file?.name ?? "bbmm-settings-preset").replace(/\.json$/i, "");
			data = { [presetName]: data };
			DL(1, `${FN} wrapped single settings preset payload`, { presetName });
		}
	} catch (err) {
		DL(3, `${FN} invalid json import file`, err);
		ui.notifications.error(`${LT.errors.invalidJSONFile()}.`);
		return;
	}

	// Expect an object of presets: { [presetName]: presetObject }
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		DL(3, `${FN} invalid import shape`, data);
		ui.notifications.error(`${LT.errors.invalidJSONFile()}.`);
		return;
	}

	// Load current presets map from storage (if unreadable, start empty)
	let current = {};
	try {
		const res = await fetch(url, { cache: "no-store" });
		if (res.ok) {
			current = await res.json();
			if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
		} else {
			DL(2, `${FN} current presets fetch not ok, starting empty`, { url, status: res.status });
			current = {};
		}
	} catch (err) {
		DL(2, `${FN} current presets fetch failed, starting empty`, err);
		current = {};
	}

	// Date suffix used ONLY on collision
	const now = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	const dateStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const timeStamp = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
	const suffixBase = ` (imported on ${dateStamp} ${timeStamp})`;

	// track counts
	let added = 0;
	let renamed = 0;
	let converted = 0;

	for (const [name, presetRaw] of Object.entries(data)) {
		if (!name || typeof name !== "string") continue;
		if (!presetRaw || typeof presetRaw !== "object" || Array.isArray(presetRaw)) continue;

		let preset = presetRaw;

		// OLD FORMAT: { created, updated, items:[{ namespace,key,value,scope }] }
		if (Array.isArray(presetRaw.items)) {
			const out = {
				type: "bbmm-settings",
				created: null,
				world: {},
				client: {},
				user: {}
			};

			// created/updated in old exports are often ms timestamps
			const createdVal = presetRaw.created ?? presetRaw.updated ?? Date.now();
			if (typeof createdVal === "number") out.created = new Date(createdVal).toISOString();
			else if (typeof createdVal === "string" && createdVal.trim()) out.created = createdVal.trim();
			else out.created = new Date().toISOString();

			for (const it of presetRaw.items) {
				const ns = it?.namespace;
				const key = it?.key;
				if (!ns || !key) continue;

				const scope = String(it?.scope || "world").toLowerCase();
				const bucket = (scope === "world" || scope === "client" || scope === "user") ? scope : "world";

				if (!out[bucket][ns]) out[bucket][ns] = {};
				out[bucket][ns][key] = it?.value;
			}

			preset = out;
			converted++;
		} else {
			// NEW/EXPECTED FORMAT: ensure envelope fields exist if partially missing
			const hasBuckets = presetRaw.world && presetRaw.client && presetRaw.user
				&& typeof presetRaw.world === "object"
				&& typeof presetRaw.client === "object"
				&& typeof presetRaw.user === "object";

			if (hasBuckets && presetRaw.type !== "bbmm-settings") {
				preset = { ...presetRaw, type: "bbmm-settings" };
			}
			if (hasBuckets && !preset.created) {
				preset = { ...preset, created: new Date().toISOString() };
			}
		}

		let finalName = name;

		// Only rename if name already exists
		if (Object.prototype.hasOwnProperty.call(current, finalName)) {
			finalName = `${name}${suffixBase}`;
			renamed++;

			let i = 2;
			while (Object.prototype.hasOwnProperty.call(current, finalName)) {
				finalName = `${name}${suffixBase} (${i})`;
				i++;
			}
		}

		current[finalName] = preset;
		added++;
	}

	try {
		const payload = JSON.stringify(current ?? {}, null, 2);
		const f = new File([payload], storageFile, { type: "application/json" });
		const res = await foundry.applications.apps.FilePicker.implementation.upload("data", `bbmm-data`, f, { notify: false });

		if (!res || (!res.path && !res.url)) {
			DL(3, `${FN} upload returned no path/url`, res);
			ui.notifications.error(`${LT.errors.errorOccured()}.`);
			return;
		}

		DL(1, `${FN} imported settings presets (merged)`, { added, renamed, converted, res });
		ui.notifications.info(`Imported ${added} settings preset(s).${converted ? ` Converted ${converted}.` : ""}${renamed ? ` Renamed ${renamed}.` : ""}`);
	} catch (err) {
		DL(3, `${FN} uploadPersistent failed`, err);
		ui.notifications.error(`${LT.errors.errorOccured()}.`);
	}
}

Hooks.on("setSetting", (namespace, key, value) => {
	if (namespace === "bbmm" && key === "userExclusions") {
		invalidateSkipMap();
	}
});

/* ==========================================================================
	Clipboard helper (navigator -> textarea -> Electron) (moved from macros.js)
========================================================================== */
export async function copyPlainText(text) {
	try {
		await navigator.clipboard.writeText(String(text ?? ""));
		DL("helpers.js | copyPlainText(): navigator.clipboard succeeded");
		ui.notifications.info(LT.macro.copiedValToClipboard());
		return true;
	} catch (e1) {
		DL("helpers.js | copyPlainText(): navigator.clipboard failed... trying fallback", e1);
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
				DL("helpers.js | copyPlainText(): execCommand fallback succeeded");
				ui.notifications.info(LT.macro.copiedValToClipboard());
				return true;
			}
			throw new Error("execCommand returned false");
		} catch (e2) {
			DL(2, "helpers.js | copyPlainText(): execCommand fallback failed", e2);
			try {
				const electron = globalThis.require?.("electron");
				if (electron?.clipboard) {
					electron.clipboard.writeText(String(text ?? ""));
					DL("copyPlainText(): electron.clipboard succeeded");
					ui.notifications.info(LT.macro.copiedValToClipboard());
					return true;
				}
			} catch (e3) {
				DL(2, "helpers.js | copyPlainText(): electron.clipboard failed", e3);
			}
			ui.notifications.warn(LT.macro.failedCopyToClipboard());
			return false;
		}
	}
}

/* ==========================================================================
	Value preview / pretty formatting (moved from macros.js)
========================================================================== */

// single-line preview
export function toPreview(v) {
	try {
		if (v === undefined) return "undefined";
		if (v === null) return "null";
		if (typeof v === "string") return v;
		if (typeof v === "number" || typeof v === "boolean") return String(v);
		return JSON.stringify(v);
	} catch { return String(v); }
}

// pretty-printed (multi-line) JSON or string
export function toPretty(v) {
	try {
		if (typeof v === "string") {
			try { return JSON.stringify(JSON.parse(v), null, 2); }
			catch { return v; }
		}
		return JSON.stringify(v, null, 2);
	} catch { return String(v); }
}

/* ==========================================================================
	Tiny loader dialog (DialogV2) used by the Namespace Inspector
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
	Namespace/Settings & Flags Inspector (moved from macros.js)
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

	// settings namespaces
	_listNamespacesForSettings() {
		const set = new Set();
		for (const [fullKey] of game.settings.settings.entries()) {
			const idx = fullKey.indexOf(".");
			if (idx > 0) set.add(fullKey.slice(0, idx));
		}
		return Array.from(set).sort((a,b)=>a.localeCompare(b));
	}

	// current user's flags
	_listNamespacesForFlagsMe() {
		return Object.keys(game.user?.flags || {}).sort((a,b)=>a.localeCompare(b));
	}

	// all users' flags
	_listNamespacesForFlagsAll() {
		const set = new Set();
		for (const u of game.users.contents) {
			for (const ns of Object.keys(u.flags || {})) set.add(ns);
		}
		return Array.from(set).sort((a,b)=>a.localeCompare(b));
	}

	// collect settings for namespace
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
			DL(3, `helpers.js | collectSettingsNamespace(${ns}): unable to read settings map`, e);
			return out;
		}

		const loader = createLoader({ title: LT.macro.titleLoadingSettings(), label: LT.macro.labelLoadingNumSettings({ns}), total: entries.length });
		const sleep = (ms) => new Promise(r => setTimeout(r, ms));

		for (let i = 0; i < entries.length; i++) {
			if (loader.isAborted()) { DL(2, "helpers.js | collectSettingsNamespace: cancelled by user"); out.length = 0; break; }
			const [key, cfg] = entries[i];

			let value;
			try { value = game.settings.get(ns, key); }
			catch (e) { value = { "helpers.js | _bbmm_error": `Failed to read value: ${e?.message || e}` }; }

			const scope = String(cfg?.scope ?? "");
			const config = !!cfg?.config;
			const preview = toPreview(value);

			out.push({
				source: "settings",
				namespace: ns,
				key,
				value,
				scope,
				visible: config ? "visible" : "hidden",
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

	// collect current user's flags for namespace
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
			catch (e) { value = { "helpers.js | _bbmm_error": `Failed to read flag: ${e?.message || e}` }; }

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

	// collect all users' flags for namespace
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
				catch (e) { value = { "helpers.js | _bbmm_error": `Failed to read flag: ${e?.message || e}` }; }

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

	// make a row object from an entry
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

	// filter/sort items into _matchRows
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

	// header HTML
	_renderHeader() {
		const arrow = (k) => this.sortKey !== k ? "" : (this.sortDir === "asc" ? " ▲" : " ▼");
		return (
			`<div class="h c-key sortable" data-sort="key">${LT.macro.key()}${arrow("key")}</div>` +
			`<div class="h c-scope sortable" data-sort="scope">${LT.macro.scope()}${arrow("scope")}</div>` +
			`<div class="h c-vis sortable" data-sort="visible">${LT.macro.visibility()}${arrow("visible")}</div>` +
			`<div class="h c-val">${LT.macro.value()}</div>`
		);
	}

	// row HTML
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

	// render HTML
	async _renderHTML() {
		const cols = "grid-template-columns: minmax(220px,1.4fr) 0.8fr 0.8fr minmax(280px,2fr);";
		const css = `
			#${this.id} .window-content { display:flex; flex-direction:column; padding:.4rem !important; }
			#${this.id} .bbmm-inspector-root { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; gap:.4rem; }
			#${this.id} .bbmm-toolbar { display:flex; gap:.4rem; align-items:center; flex-wrap:nowrap; }
			#${this.id} .bbmm-grid-head { display:grid; grid-template-columns:minmax(220px,1.4fr) .8fr .8fr minmax(280px,2fr); border:1px solid var(--color-border,#444); border-radius:.4rem .4rem 0 0; background:var(--color-bg-header,#1e1e1e); }
			#${this.id} .bbmm-grid-head .h { padding:.25rem .4rem; border-bottom:1px solid #444; font-weight:600; line-height:1.2; }
			#${this.id} .bbmm-grid-body { display:block; flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--color-border,#444); border-top:0; border-radius:0 0 .4rem .4rem; }
			#${this.id} .bbmm-grid-body .row { display:grid; grid-template-columns:minmax(220px,1.4fr) .8fr .8fr minmax(280px,2fr); border-bottom:1px solid #333; }
			#${this.id} .bbmm-grid-body .row > div { padding:.2rem .4rem; min-width:0; line-height:1.2; }
			#${this.id} .bbmm-grid-body .c-val { cursor:pointer; }
			#${this.id} .bbmm-grid-body .c-val .val-preview { max-height:2.2em; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
			#${this.id} .bbmm-grid-body .c-val .val-preview code { white-space:pre-wrap; word-break:break-word; }
			#${this.id} .bbmm-grid-body .row .val-expand { display:none; grid-column:4 / 5; margin-top:.2rem; border-top:1px dotted #444; padding-top:.2rem; }
			#${this.id} .bbmm-grid-body .row.expanded .val-expand { display:block; }
			#${this.id} .bbmm-grid-body .val-toolbar { display:flex; gap:.4rem; margin-bottom:.2rem; }
			#${this.id} .bbmm-grid-body .val-pre { max-height:40vh; overflow:auto; margin:0; background:rgba(255,255,255,.03); padding:.3rem; border-radius:.3rem; }
			`;

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

	// render and setup interactivity
	async _replaceHTML(result, _options) {
		const content = this.element.querySelector(".window-content") || this.element;
		Object.assign(content.style, { display:"flex", flexDirection:"column", height:"100%", minHeight:"0" });

		try {
			const winEl = this.element;
			winEl.style.minWidth = "1200px";
			winEl.style.maxWidth = "1200px";
			winEl.style.minHeight = "400px";
			winEl.style.maxHeight = "700px";
			winEl.style.overflow = "hidden";
			DL("helpers.js | NamespaceInspector: size clamps applied");
		} catch (e) { DL(2, "helpers.js | NamespaceInspector: size clamps failed", e); }

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

export function openNamespaceInspector() {
	try {
		DL("helpers.js | openNamespaceInspector(): launching");
		new BBMMNamespaceInspector().render(true);
	} catch (err) {
		DL(3, "helpers.js | openNamespaceInspector(): error", err);
		ui.notifications.error(LT.macro.failedOpenSettingsInspector());
	}
}

Hooks.once("init", () => {
	try {
		globalThis.bbmm ??= {};
		globalThis.bbmm.openNamespaceInspector = openNamespaceInspector;
		const mod = game.modules.get(BBMM_ID);
		if (mod) { mod.api = mod.api || {}; Object.assign(mod.api, { copyPlainText, openNamespaceInspector }); }
		DL("helpers.js | init(): inspector + clipboard API registered");
	} catch (err) {
		DL(3, "helpers.js | init(): failed to register API", err);
	}
});