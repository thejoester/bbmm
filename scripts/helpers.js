import { DL } from './settings.js';
import { EXPORT_SKIP } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";

/* Cache the effective skip map until invalidated */
let _skipMapCache = null;

/* ---------------------------------------------------------------------- */
/* General helpers										                  */
/* ---------------------------------------------------------------------- */

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

// Helper to export to .json file
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

/* ---------------------------------------------------------------------- */
/* Exclusion helpers (used by settings and module presets)                */
/* ---------------------------------------------------------------------- */ 

export function invalidateSkipMap() {
	// Call this if you change bbmm.userExclusions or EXPORT_SKIP at runtime
	_skipMapCache = null;
}

/*
	Build effective skip map from EXPORT_SKIP + bbmm.userExclusions.
	No DL() here; we log only when we actually skip something.
*/
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

/* Back-compat helper if some call sites still use isExcluded(ns,key) */
export function isExcluded(namespace, key) {
	return isExcludedWith(getSkipMap(), namespace, key);
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

		// IMPORTANT: this text is OURS (localized), not user input, so no escape needed.
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
	const url = `modules/${BBMM_ID}/storage/presets/${storageFile}`;

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
// import Module presets
export async function bbmm_importModulePresetsAll() {
	const FN = "helpers.js | bbmm_importModulePresetsAll():";
	const storageSubdir = "presets";
	const storageFile = "module-presets.json";
	const url = `modules/${BBMM_ID}/storage/presets/${storageFile}`;

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
		const res = await FilePicker.uploadPersistent(BBMM_ID, storageSubdir, f, {}, { notify: false });

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
	const url = `modules/${BBMM_ID}/storage/presets/${storageFile}`;

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
	const storageSubdir = "presets";
	const storageFile = "settings-presets.json";
	const url = `modules/${BBMM_ID}/storage/presets/${storageFile}`;

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
		const res = await FilePicker.uploadPersistent(BBMM_ID, storageSubdir, f, {}, { notify: false });

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