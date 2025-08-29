import { DL, EXPORT_SKIP } from './settings.js';
import { hlp_esc, hlp_timestampStr, hlp_saveJSONFile, hlp_pickLocalJSONFile, hlp_normalizePresetName, getSkipMap, isExcludedWith } from './helpers.js';
import { LT, BBMM_ID } from "./localization.js";
const SETTING_SETTINGS_PRESETS = "settingsPresetsUser";	// user-scoped store defined in settings.js
const PRESET_MANAGER_ID = "bbmm-settings-preset-manager";	// stable window id

const AppV2 = foundry?.applications?.api?.ApplicationV2;
if (!AppV2) {
	// Comment
	DL(1, "ApplicationV2 base class not found.");
}

// ===== Helpers =====

const BBMM_V2_WINDOWS = new Map();	// id -> app

Hooks.on("renderDialogV2", (app) => {
	try {
		if (app?.id) BBMM_V2_WINDOWS.set(app.id, app);
		DL(`renderDialogV2: registered ${app?.id}`);
	} catch (e) {
		DL(2, "renderDialogV2: registry failed", e);
	}
});

Hooks.on("closeDialogV2", (app) => {
	try {
		if (app?.id) BBMM_V2_WINDOWS.delete(app.id);
		DL(`closeDialogV2: unregistered ${app?.id}`);
	} catch (e) {
		DL(2, "closeDialogV2: unregistry failed", e);
	}
});

// Return an open app by id.
function getWindowById(id) {
	// Check v2 registry first
	const v2 = BBMM_V2_WINDOWS.get(id);
	if (v2) return v2;

	// Fallback for classic windows tracked in ui.windows
	const all = Object.values(ui.windows ?? {});
	return all.find(w => w?.id === id) ?? null;
}

/* 
	Convert a bbmm-settings export envelope:
	{ world:{ns:{key:val}}, client:{...}, user:{...} }
	-> flat entries: [{namespace,key,scope,value}, ...] 
*/
function hlp_normalizeToEntries(bbmmExport) {
	// Build skip map once (EXPORT_SKIP + userExclusions)
	const skip = getSkipMap();

	DL("hlp_normalizeToEntries(): start");

	const entries = [];
	try {
		const scopes = ["world", "client", "user"];
		for (const scope of scopes) {
			const bucket = bbmmExport?.[scope];
			if (!bucket || typeof bucket !== "object") continue;

			for (const namespace of Object.keys(bucket)) {
				// Skip whole module if excluded
				if (isExcludedWith(skip, namespace)) {
					DL(`hlp_normalizeToEntries(): excluded module "${namespace}" (scope=${scope})`);
					continue;
				}

				const settings = bucket[namespace];
				if (!settings || typeof settings !== "object") continue;

				for (const key of Object.keys(settings)) {
					// Skip specific setting if excluded
					if (isExcludedWith(skip, namespace, key)) {
						DL(`hlp_normalizeToEntries(): excluded setting "${namespace}.${key}" (scope=${scope})`);
						continue;
					}

					const value = settings[key];
					entries.push({
						namespace,
						key,
						scope,
						// Use json-safe helper if present
						value: (typeof hlp_toJsonSafe === "function") ? hlp_toJsonSafe(value) : value
					});
				}
			}
		}
	} catch (e) {
		DL(3, "hlp_normalizeToEntries(): failed", { message: e?.message, stack: e?.stack });
		throw e;
	}

	// Stable sort: scope -> namespace -> key
	entries.sort((a, b) =>
		String(a.scope ?? "").localeCompare(String(b.scope ?? "")) ||
		String(a.namespace ?? "").localeCompare(String(b.namespace ?? "")) ||
		String(a.key ?? "").localeCompare(String(b.key ?? ""))
	);

	DL("hlp_normalizeToEntries(): produced entries", { count: entries.length });
	return entries;
}

function hlp_entriesToEnvelope(entries) {
	const out = { type: "bbmm-settings", created: new Date().toISOString(), world: {}, client: {}, user: {} };
	for (const e of entries || []) {
		const scope = (e.scope === "world") ? "world" : (e.scope === "user" ? "user" : "client");
		out[scope][e.namespace] ??= {};
		out[scope][e.namespace][e.key] = e.value;
	}
	return out;
}

// Default preset name suggestion
function hlp_defaultPresetName() {
	const d = new Date();
	const pad = (n) => `${n}`.padStart(2, "0");
	return `${LT.imported()} ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function hlp_findExistingSettingsPresetKey(name) {
	const wanted = hlp_normalizePresetName(name);
	const presets = svc_getSettingsPresets();
	for (const k of Object.keys(presets)) {
		if (hlp_normalizePresetName(k) === wanted) return k;
	}
	return null;
}

// JSON (de)hydration helpers so Sets/Maps survive JSON.stringify
function hlp_toJsonSafe(value, seen = new WeakSet(), path = "", depth = 0) {
	const here = path || "<root>";
	const ROOT = depth === 0;
	//if (ROOT) DL(`toJsonSafe IN ${here}`, value);

	let out;

	// primitives / null
	if (value == null || (typeof value !== "object" && typeof value !== "function")) {
		out = value;
		//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
		return out;
	}

	// cycle guard
	if (seen.has(value)) {
		out = "[[Circular]]";
		//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
		return out;
	}
	seen.add(value);

	// Sets / Maps
	if (value instanceof Set) {
		out = { __type: "Set", value: [...value] };
		//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
		return out;
	}
	if (value instanceof Map) {
		out = { __type: "Map", value: Object.fromEntries(value) };
		//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
		return out;
	}

	// Foundry Collection -> plain object
	try {
		if (typeof foundry !== "undefined" && foundry.utils?.Collection && value instanceof foundry.utils.Collection) {
			const obj = Object.fromEntries(value.entries());
			out = {};
			for (const [k, v] of Object.entries(obj)) out[k] = hlp_toJsonSafe(v, seen, `${here}.${k}`, depth + 1);
			//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
			return out;
		}
	} catch {}

	// Arrays
	if (Array.isArray(value)) {
		out = value.map((v, i) => hlp_toJsonSafe(v, seen, `${here}[${i}]`, depth + 1));
		//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
		return out;
	}

	// Generic objects: prefer Foundry duplicate, then fallback to safe enumerate
	try {
		if (foundry?.utils?.duplicate) {
			const dup = foundry.utils.duplicate(value);
			if (dup && dup !== value) {
				if (Array.isArray(dup)) out = dup.map((v, i) => hlp_toJsonSafe(v, seen, `${here}[${i}]`, depth + 1));
				else {
					out = {};
					for (const [k, v] of Object.entries(dup)) out[k] = hlp_toJsonSafe(v, seen, `${here}.${k}`, depth + 1);
				}
				//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
				return out;
			}
		}
	} catch {}

	// Fallback: shallow enumerate safely
	out = {};
	for (const k of Object.keys(value)) {
		let v;
		try { v = value[k]; } catch { v = "[[GetterError]]"; }
		out[k] = hlp_toJsonSafe(v, seen, `${here}.${k}`, depth + 1);
	}

	//if (ROOT) DL(`toJsonSafe OUT ${here}`, out);
	return out;
}

function hlp_fromJsonSafe(value) {
	if (Array.isArray(value)) return value.map(v => hlp_fromJsonSafe(v));
	if (value && typeof value === "object") {
		if (value.__type === "Set") return new Set((value.value ?? []).map(v => hlp_fromJsonSafe(v)));
		if (value.__type === "Map") return new Map(Object.entries(value.value ?? {}).map(([k, v]) => [k, hlp_fromJsonSafe(v)]));
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = hlp_fromJsonSafe(v);
		return out;
	}
	return value;
}

function hlp_isPlainEmptyObject(v) {
	return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;
}

function hlp_schemaCorrectNonPlainTypes(out) {
	for (const [fullKey, cfg] of game.settings.settings.entries()) {
		const [namespace, key] = fullKey.split(".");
		const scope = cfg?.scope === "user" ? "user" : (cfg?.scope === "client" ? "client" : "world");
		const bucket = out?.[scope]?.[namespace];
		if (!bucket) continue;

		const current = bucket[key];

		// Fix Sets/Maps that flattened
		if (cfg?.type === Set || cfg?.type === Map) {
			const flattened = !current || (typeof current === "object" && !Array.isArray(current) && Object.keys(current).length === 0);
			const wrongSet = cfg.type === Set && !(current && (current.__type === "Set" || Array.isArray(current)));
			const wrongMap = cfg.type === Map && !(current && (current.__type === "Map" || (current && typeof current === "object" && !Array.isArray(current))));
			if (flattened || wrongSet || wrongMap) {
				try { bucket[key] = hlp_toJsonSafe(game.settings.get(namespace, key)); } catch { bucket[key] = cfg.type === Set ? { __type:"Set", value:[] } : { __type:"Map", value:{} }; }
			}
		}

		// If schema expects Object and we captured {}, but live has data, re-pull it
		if ((cfg?.type === Object || !cfg?.type) && current && typeof current === "object" && !Array.isArray(current) && Object.keys(current).length === 0) {
			try {
				const live = game.settings.get(namespace, key);
				if (live && typeof live === "object" && Object.keys(live).length > 0) {
					bucket[key] = hlp_toJsonSafe(live);
				}
			} catch {}
		}
	}
}

// Return true if this setting exists in the registry
function hlp_isRegisteredSetting(namespace, key) {
	const fullKey = `${namespace}.${key}`;
	return game.settings?.settings?.has(fullKey) === true;
}

// ===== SERVICES =====

function svc_getSettingsPresets() {
	return foundry.utils.duplicate(game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS) || {});
}

async function svc_setSettingsPresets(obj) {
	// Write to user-scoped store "settingsPresetsUser"
	try {
		DL("svc_setSettingsPresets(): writing bbmm.settingsPresetsUser");
		await game.settings.set("bbmm", "settingsPresetsUser", obj);
		DL("svc_setSettingsPresets(): OK");
	} catch (e) {
		DL(3, "svc_setSettingsPresets(): FAILED", {
			name: e?.name,
			message: e?.message,
			stack: e?.stack,
			key: "bbmm.settingsPresetsUser"
		});
		throw e;
	}
}

/*	
	Collect all Settings - except excluded
	Collect module settings by scope, optionally restricting to active modules.
	- Skips config:false entries
	- GM: world + client, Non‑GM: client only
	- includeDisabled=false -> skip modules that are not active (except core/system)
*/
function svc_collectAllModuleSettings({ includeDisabled = false } = {}) {
	// Build a bbmm-settings envelope
	const isGM = game.user.isGM;
	const out = { type: "bbmm-settings", created: new Date().toISOString(), world: {}, client: {}, user: {} };
	const sysId = game.system.id;
	const skipMap = getSkipMap();

	try {
		for (const def of game.settings.settings.values()) {
			const { namespace, key, scope } = def;
			if (!namespace || !key) continue;

			// Players can't read world-scope settings
			if (scope === "world" && !isGM) continue;

			// Respect includeDisabled; let core + system through
			if (!includeDisabled) {
				if (namespace !== "core" && namespace !== sysId) {
					const mod = game.modules.get(namespace);
					if (!mod?.active) continue;
				}
			}


			// Single source of truth for exclusions 
			if (isExcludedWith(skipMap, namespace) || isExcludedWith(skipMap, namespace, key)) {
				DL(`svc_collectAllModuleSettings(): excluded ${namespace}.${key}`);
				continue;
			}

			// Read the value
			let value;
			try { value = game.settings.get(namespace, key); }
			catch (e) {
				DL(2, `svc_collectAllModuleSettings(): get failed ${namespace}.${key}`, { message: e?.message });
				continue;
			}

			// Bucket by scope and store (JSON-safe)
			const bucket = scope === "world" ? out.world : (scope === "client" ? out.client : out.user);
			bucket[namespace] ??= {};
			try {
				bucket[namespace][key] = (typeof hlp_toJsonSafe === "function") ? hlp_toJsonSafe(value) : value;
			} catch (e) {
				DL(2, `svc_collectAllModuleSettings(): toJsonSafe failed ${namespace}.${key}`, { message: e?.message });
				bucket[namespace][key] = value;
			}
		}

		// Summary
		const countNs = (obj) => Object.values(obj).reduce((n, ns) => n + Object.keys(ns).length, 0);
		DL("svc_collectAllModuleSettings(): collected", {
			counts: {
				world: countNs(out.world),
				client: countNs(out.client),
				user: countNs(out.user)
			}
		});
	} catch (e) {
		DL(3, "svc_collectAllModuleSettings(): FAILED", { message: e?.message, stack: e?.stack });
		throw e;
	}

	return out;
}

/* 	
	Apply settings export (bbmm-settings).
	- GM applies world + client; non‑GM applies client only
	- Skips namespaces where module not installed (collects report)
	- Always reloads after apply (per your requirement)
*/
async function svc_applySettingsExport(exportData) {
	// Validate envelope
	if (!exportData || exportData.type !== "bbmm-settings") {
		ui.notifications.error(`${LT.errors.notBBMMFile()}.`);
		return { applied: [], skipped: [], missingModules: new Set() };
	}

	// Scope permissions
	const isGM = game.user.isGM;
	const scopes = isGM ? ["world","client","user"] : ["client","user"];

	// Exclusions: build once
	const skip = getSkipMap();

	const applied = [];
	const skipped = [];
	const missingModules = new Set();

	for (const scope of scopes) {
		const tree = exportData[scope] || {};
		for (const [namespace, entries] of Object.entries(tree)) {
			// Exclude entire namespace first
			if (isExcludedWith(skip, namespace)) {
				DL(`svc_applySettingsExport(): excluded module "${namespace}" — skipping all keys in scope=${scope}`);
				continue;
			}

			// If module isn't core/system and not installed, record as missing and skip
			if (namespace !== "core" && namespace !== game.system.id && !game.modules.has(namespace)) {
				missingModules.add(namespace);
				continue;
			}

			for (const [key, value] of Object.entries(entries)) {
				// Exclude specific setting if needed
				if (isExcludedWith(skip, namespace, key)) {
					DL(`svc_applySettingsExport(): excluded setting "${namespace}.${key}" (scope=${scope})`);
					continue;
				}

				// Ensure setting exists and scope matches
				const def = [...game.settings.settings.values()].find(d => d.namespace === namespace && d.key === key);
				if (!def) { skipped.push(`${namespace}.${key}`); continue; }
				if (def.scope !== scope) { skipped.push(`${namespace}.${key}`); continue; }

				// Permission: world requires GM
				if (def.scope === "world" && !isGM) { skipped.push(`${namespace}.${key}`); continue; }

				try {
					// Type info
					const cfg = game.settings.settings.get(`${namespace}.${key}`);

					// Hydrate from JSON-safe
					let hydrated = hlp_fromJsonSafe(value);

					/* Back-compat: old exports stored {} for Set/Map — treat as empty */
					if (cfg?.type === Set && hlp_isPlainEmptyObject(value)) hydrated = new Set();
					if (cfg?.type === Map && hlp_isPlainEmptyObject(value)) hydrated = new Map();

					/* Coerce if caller didn't tag but type is known */
					if (cfg?.type === Set && !(hydrated instanceof Set)) {
						if (Array.isArray(hydrated)) hydrated = new Set(hydrated);
						else hydrated = new Set();
					}
					if (cfg?.type === Map && !(hydrated instanceof Map)) {
						if (hydrated && typeof hydrated === "object" && !Array.isArray(hydrated)) {
							hydrated = new Map(Object.entries(hydrated));
						} else {
							hydrated = new Map();
						}
					}

					/* If schema expects POJO but we have a Map, coerce */
					if (cfg?.type === Object && hydrated instanceof Map) {
						hydrated = Object.fromEntries(hydrated);
					}

					// Apply
					await game.settings.set(namespace, key, hydrated);
					applied.push(`${namespace}.${key}`);
				} catch (e) {
					DL(2, "svc_applySettingsExport(): set failed", { ns: namespace, key, message: e?.message });
					skipped.push(`${namespace}.${key}`);
				}
			}
		}
	}

	// Prompt reload
	const doReload = await foundry.applications.api.DialogV2.confirm({
		window: { title: `${LT.titleReload()}?` },
		content: `<p>${LT.promptReload()}?</p>`,
		ok: { label: LT.buttons.reload() },
		modal: true
	});
	if (doReload) location.reload();

	return { applied, skipped, missingModules };
}

// Conflict-safe Preset Save
function svc_askSettingsPresetConflict(existingKey) {
	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: LT.titlePresetExists(), modal: true },
			content: `
				<p>${LT.settingPresetExists({ name: hlp_esc(existingKey) })}.</p>
				<p>${LT.errors.existsPrompt()}?</p>
			`,
			buttons: [
				{ action: "overwrite", label: LT.errors.overwrite(), default: true, callback: () => resolve("overwrite") },
				{ action: "rename", label: LT.errors.rename(), callback: () => resolve("rename") },
				{ action: "cancel", label: LT.buttons.cancel(), callback: () => resolve("cancel") }
			],
			submit: () => {},
			rejectClose: false
		}).render(true);
	});
}

/*
	Preset persistence
	- Registers bbmm.presets (world, hidden) if needed
	- Saves/updates presets[name] = { created, updated, items:[entry...] }
*/
async function svc_savePresetToSettings(presetName, selectedEntries) {
	try {
		const current = foundry.utils.duplicate(
			game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS)
		) || {};
		const now = Date.now();

		current[presetName] ??= { created: now, updated: now, items: [] };
		current[presetName].updated = now;
		current[presetName].items = selectedEntries;

		await game.settings.set(BBMM_ID, SETTING_SETTINGS_PRESETS, current);

		DL(`svc_savePresetToSettings(): saved preset "${presetName}" with ${selectedEntries.length} entries`);
		return current[presetName];
	} catch (e) {
		DL(3, "svc_savePresetToSettings(): failed", { message: e?.message, stack: e?.stack });
		throw e;
	}
}

// Save Settings Preset
async function svc_saveSettingsPreset(name, payload) {
	const rawInput = String(name).trim();
	let finalName = rawInput;

	const existingKey = hlp_findExistingSettingsPresetKey(rawInput);
	if (existingKey) {
		const choice = await svc_askSettingsPresetConflict(existingKey);
		if (choice === "cancel") return { status: "cancel" };
		if (choice === "overwrite") finalName = existingKey;
		if (choice === "rename") {
			const newName = await ui_promptRenamePreset(rawInput);
			if (!newName) return { status: "cancel" };
			finalName = newName;
		}
	}
	const flatView = hlp_normalizeToEntries(payload)?.entries ?? [];
	const stored = flatView.length ? { ...payload, entries: flatView } : payload;
	const all = svc_getSettingsPresets();
	all[finalName] = stored;
	await svc_setSettingsPresets(all);
	return { status: "saved", name: finalName };
}

// ===== UI =====

//	Rename Prompt
function ui_promptRenamePreset(defaultName) {
	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: LT.renameSettingPreset(), modal: true },
			content: `
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">${LT.newName()}</label>
					<input name="newName" type="text" value="${hlp_esc(defaultName)}" autofocus style="flex:1;">
				</div>
			`,
			buttons: [
				{ action: "ok",     label: LT.buttons.save(), default: true,
				  callback: (_ev, btn) => resolve(btn.form.elements.newName?.value?.trim() || "") },
				{ action: "cancel", label: LT.buttons.cancel(), callback: () => resolve(null) }
			],
			submit: () => {},
			rejectClose: false
		}).render(true);
	});
}

// Open the import wizard. `data` is the parsed JSON object from file.
export async function ui_openSettingsImportWizard(data) {
	try {
		// If no data was passed in, prompt the user to pick a JSON file
		const json = data || await pickJsonFile();
		if (!json) {
			DL("ui_openSettingsImportWizard(): no JSON provided/selected");
			return;
		}

		// Normalize (your existing compat function is fine to keep, or inline it here)
		const normalizeToEntriesCompat = (jsonIn) => {
			/** @type {{namespace:string,key:string,value:any,scope:'world'|'client'|'user',config:boolean}[]} */
			const entries = [];

			// Push all settings in a bucket into the flat entries array
			const pushBucket = (bucket, scope) => {
				if (!bucket || typeof bucket !== "object") return;
				for (const [ns, settings] of Object.entries(bucket)) {
					if (!settings || typeof settings !== "object") continue;
					for (const [key, val] of Object.entries(settings)) {
						const isObj = val && typeof val === "object";
						const value = (isObj && "value" in val) ? val.value : val;
						const cfg = (isObj && "config" in val) ? !!val.config : true;
						const scp = (isObj && (val.scope === "world" || val.scope === "client" || val.scope === "user")) ? val.scope : scope;
						entries.push({ namespace: ns, key, value, scope: scp, config: cfg });
					}
				}
			};

			if (jsonIn?.world || jsonIn?.client || jsonIn?.user) {
				pushBucket(jsonIn.world, "world");
				pushBucket(jsonIn.client, "client");
				pushBucket(jsonIn.user, "user");
			} else if (jsonIn?.settings && typeof jsonIn.settings === "object") {
				pushBucket(jsonIn.settings, "client");
			}

			const moduleList = [...new Set(entries.map(e => e.namespace))].sort();
			return { entries, moduleList };
		};

		const normalized = normalizeToEntriesCompat(json);

		if (!normalized.entries.length) {
		ui.notifications.warn(`${LT.errors.noSettingsFound()}.`);
			DL("ui_openSettingsImportWizard(): Import Wizard: 0 entries after normalization", { json });
			return;
		}

		DL(`ui_openSettingsImportWizard(): Import Wizard: normalized ${normalized.entries.length} entries from ${normalized.moduleList.length} namespaces`);

		// Guard: verify base class is available before we construct
		if (!AppV2) {
			DL(3,"ui_openSettingsImportWizard(): ui_openSettingsImportWizard(): AppV2 base missing", { AppV2 });
			return;
		}

		// Construct with a try/catch to isolate ctor failures
		let app;
		try {
			app = new BBMMImportWizard({ json, normalized });
			app.render(true);	
		} catch (ctorErr) {
			DL("ui_openSettingsImportWizard(): BBMM Import Wizard: constructor failed", ctorErr);
			ui.notifications.error(`${LT.errors.importWizFailedCon()}.`);
			return;
		}

		// Render with a try/catch to isolate render failures
		try {
			await app.render(true);
		} catch (renderErr) {
			DL("ui_openSettingsImportWizard(): BBMM Import Wizard render failed", renderErr);
			ui.notifications.error(`${LT.errors.importWizFailRen()}.`);
			return;
		}
	} catch (err) {
		// If anything else goes wrong, log and notify
		DL("ui_openSettingsImportWizard(): failed to open", err);
		ui.notifications.error(`${LT.errors.importWizFailOpen()}.`);
	}
}

/*
	ApplicationV2: BBMMImportWizard
*/
class BBMMImportWizard extends AppV2 {
	constructor(state) {
		super({
			id: "bbmm-import-wizard",
			title: LT.titleImportSettingsPreset(),
			width: 700,
			height: "auto",
			resizable: true
		});
		this.bbmmState = state;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			tag: "section",
			class: ["bbmm-import-app"],
			position: { width: 700, height: 600, top: 100, left: 100 },
			window: { title: LT.titleImportSettingsPreset() }
		}, { inplace: false });
	}

	// Return a string, not an element, so there’s nothing to “move” in the DOM
	async _renderHTML() {
		// {Render the BBMM Import Wizard form}
		return `
			<form class="bbmm-import" style="display:flex;flex-direction:column;gap:.5rem;height:100%;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:12rem;">${LT.promptWhatImport()}?</label>
					<select name="mode">
						<option value="all" selected>${LT.allSettings()}</option>
						<option value="modules">${LT.selectModules()}</option>
						<option value="settings">${LT.selectSettings()}</option>
					</select>
					
				</div>

				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:12rem;">${LT.presetName()}</label>
					<input type="text" name="presetName" placeholder="${LT.myPreset()}" required>
				</div>

				<div id="bbmm-list" style="
					flex: 1;
					overflow: auto;
					max-height: 60vh;  /* prevents going off screen */
					border: 1px solid var(--color-border-dark-5);
					border-radius: 6px;
					padding: .5rem;">
				</div>

				<footer style="display:flex;justify-content:flex-end;gap:.5rem;">
					<button type="button" data-action="cancel">${LT.buttons.cancel()}</button>
					<button type="button" data-action="import" class="default">${LT.buttons.importToPreset()}</button>
				</footer>
			</form>
		`;
	}

	// Inject HTML via innerHTML (never replaceChildren), then cache refs and wire listeners
	async _replaceHTML(result, _options) {
		try {
			const win = this.element;
			const contentRegion = win.querySelector(".window-content") || win;

			// Make the content flex so the center panel can scroll
			contentRegion.style.display = "flex";
			contentRegion.style.flexDirection = "column";
			contentRegion.style.height = "100%";
			contentRegion.style.minHeight = "0";

			// Inject: result is expected to be a STRING here (like your macro)
			const htmlStr = (result instanceof HTMLElement) ? result.innerHTML : String(result ?? "");
			contentRegion.innerHTML = htmlStr;

			// Cache handles we'll use later
			this._root = contentRegion;
			this._form = (contentRegion.querySelector("form.bbmm-import"));
			this._list = (contentRegion.querySelector("#bbmm-list"));

			// Wire listeners on next tick
			setTimeout(() => this.activateListeners(), 0);
		} catch (e) {
			DL("BBMMImportWizard: _replaceHTML failed", e);
			throw e;
		}
	}

	/** Called once the form is in the DOM. Wires listeners and paints initial list. */
	activateListeners() {
		// Prevent double‑wiring if AppV2 rerenders or we get called twice
		if (this._wired) {
			DL("activateListeners(): activateListeners skipped (already wired)");
			return;
		}
		this._wired = true;

		// Root + cached refs from _replaceHTML
		const root = this._root || this.element;
		const form = this._form || (root?.querySelector("form.bbmm-import"));
		const list = this._list || (root?.querySelector("#bbmm-list"));

		DL("activateListeners(): activateListeners called", {
			hasRoot: !!root,
			hasForm: !!form,
			hasList: !!list
		});

		if (!root || !form || !list) {
			DL("activateListeners(): BBMM Import Wizard: form or #bbmm-list not found (post-activate)");
			return;
		}

		// Ensure our buttons are non-submitting buttons (defensive in case HTML changes later)
		form.querySelectorAll('button[data-action]').forEach(b => b.setAttribute("type", "button"));

		// Field handles
		const modeSel = (form.elements.namedItem("mode"));
		const presetName = (form.elements.namedItem("presetName"));

		// Set a friendly default name if empty
		if (!presetName.value) presetName.value = hlp_defaultPresetName();

		// Paint the center panel based on mode and then recenter the window.
		const paint = () => {
			const mode = modeSel.value;
			if (mode === "all") this.#paintAll(list);
			else if (mode === "modules") this.#paintModules(list);
			else this.#paintSettings(list);

			// Recalculate height and recenter so window never grows off-screen
			this.setPosition({ height: "auto", left: null, top: null });
			DL("paint() done and window re-centered", { mode });
		};

		// Prevent default form submission (which could cause double events)
		form.addEventListener("submit", (ev) => {
			ev.preventDefault();
			DL("BBMMImportWizard(): blocked default form submit");
		});

		// Mode changes repaint and recenter
		modeSel.addEventListener("change", paint);

		// Cancel button closes the wizard
		form.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
			DL("BBMMImportWizard: cancel clicked — closing");
			this.close();
		});

		// Import button: overwrite check, save, refresh, close
		form.querySelector('[data-action="import"]')?.addEventListener("click", async (ev) => {
			try {
				ev.preventDefault();
				if (this._inFlight) return; // Already processing; ignore further clicks
				this._inFlight = true;

				const name = presetName.value.trim();
				if (!name) {
					ui.notifications.warn(`${LT.importNamePrompt()}.`);
					this._inFlight = false;
					return;
				}

				// Duplicate name check (single prompt)
				const allPresets = game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS) || {};
				if (allPresets[name]) {
					const confirmed = await foundry.applications.api.DialogV2.confirm({
						window: { title: LT.errors.conflictTitleExists() },
						content: `<p>${LT.settingPresetExists({ name: name })}. ${LT.errors.overwrite()}?</p>`,
						defaultYes: false,
						ok: { label: LT.errors.overwrite() },
						cancel: { label: LT.buttons.cancel() }
					});
					if (!confirmed) { this._inFlight = false; return; }
				}

				const selected = this.#collectSelected(modeSel.value, list);
				if (!selected.length) {
					ui.notifications.warn(`${LT.errors.noEntrySelected()}.`);
					this._inFlight = false;
					return;
				}

				// Disable UI to prevent double‑clicks
				const importBtn = form.querySelector('[data-action="import"]');
				const cancelBtn = form.querySelector('[data-action="cancel"]');
				importBtn?.setAttribute("disabled", "true");
				cancelBtn?.setAttribute("disabled", "true");
				form.setAttribute("aria-busy", "true");

				ui.notifications.info(`${LT.importingToPreset({ count: selected.length, name: name })}…`);
				DL(`BBMMImportWizard: starting import of ${selected.length} entries to "${name}"`);

				// Close the window first; the async save continues in the background
				this.close();

				// Perform the save
				const preset = await svc_savePresetToSettings(name, selected);
				DL("BBMMImportWizard: savePresetToSettings OK", { name, count: selected.length });
				
				DL("BBMMImportWizard: Reopening Settings Preset Manager after import");
				openSettingsPresetManager();
				Hooks.callAll("bbmm:importPreset", { name, items: preset.items });

				// Final toast after completion
				ui.notifications.info(`${LT.importComplete()}.`);
			} catch (e) {
				DL(3, "Import Wizard: failed to save preset", { message: e?.message, stack: e?.stack });
				ui.notifications.error(`${LT.errors.savePresetFail()}.`);
			} finally {
				this._inFlight = false;
			}
		});

		// Initial paint when dialog opens
		paint();
	}

	/** All Settings mode: simple message with count */
	#paintAll(list) {
		const total = this.bbmmState.normalized.entries.length;
		list.innerHTML = `
			<div style="padding:.25rem;">
				<em>${LT.allSettingsMsg({ count: total })}.</em>
			</div>
		`;
	}

	/** Modules mode: checkbox per namespace, with counts */
	#paintModules(list) {
		const { moduleList, entries } = this.bbmmState.normalized;
		const counts = new Map();
		for (const e of entries) counts.set(e.namespace, (counts.get(e.namespace) || 0) + 1);

		const rows = moduleList.map(ns => `
			<label style="display:flex;align-items:center;gap:.5rem;padding:.25rem .5rem;border-radius:4px;">
				<input type="checkbox" class="bbmm-ns" data-ns="${ns}" checked>
				<span style="flex:1;"><b>${ns}</b> <span class="notes">(${counts.get(ns) || 0} ${LT.settings()})</span></span>
			</label>
		`).join("");

		list.innerHTML = rows || `<em>${LT.errors.noModulesDet()}.</em>`;
	}

	/** Settings mode: all keys grouped by namespace, with per-namespace master toggles */
	#paintSettings(list) {
		const { entries } = this.bbmmState.normalized;
		const sorted = [...entries].sort((a, b) =>
			(a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key))
		);

		const blocks = [];
		let currentNs = null;
		for (const e of sorted) {
			// Start a new fieldset whenever the namespace changes
			if (e.namespace !== currentNs) {
				if (currentNs !== null) blocks.push(`</div></fieldset>`);
				currentNs = e.namespace;
				blocks.push(`
					<fieldset style="border:1px solid var(--color-border-dark-5);border-radius:6px;padding:.25rem .5rem;margin-bottom:.25rem;">
						<legend style="font-weight:600;">
							<label style="display:inline-flex;gap:.5rem;align-items:center;">
								<input type="checkbox" class="bbmm-ns-master" data-ns="${currentNs}" checked>
								${currentNs}
							</label>
						</legend>
						<div style="display:flex;flex-direction:column;gap:.125rem;">
				`);
			}
			blocks.push(`
				<label style="display:flex;gap:.5rem;align-items:center;padding:.125rem .25rem;">
					<input type="checkbox" class="bbmm-setting" data-ns="${e.namespace}" data-key="${e.key}" checked>
					<span style="flex:1;"><code>${e.key}</code> <span class="notes">[${e.scope}${e.config ? "" : ", hidden"}]</span></span>
				</label>
			`);
		}
		if (currentNs !== null) blocks.push(`</div></fieldset>`);

		list.innerHTML = blocks.join("") || `<em>${LT.errors.noSettingsDet()}.</em>`;

		// Master checkbox toggles all child settings for that namespace
		list.querySelectorAll(".bbmm-ns-master").forEach(el => {
			el.addEventListener("change", ev => {
				const ns = ev.currentTarget.dataset.ns;
				list.querySelectorAll(`.bbmm-setting[data-ns="${ns}"]`)
					.forEach(cb => { cb.checked = ev.currentTarget.checked; });
			});
		});
	}

	/** Collect entries based on the current mode and which checkboxes are ticked */
	#collectSelected(mode, list) {
		const all = this.bbmmState.normalized.entries;

		if (mode === "all") return all;

		if (mode === "modules") {
			const chosen = new Set(
				[...list.querySelectorAll(".bbmm-ns:checked")].map(el => el.dataset.ns)
			);
			return all.filter(e => chosen.has(e.namespace));
		}

		// Settings mode: only include checked ns/key pairs
		const wanted = new Set(
			[...list.querySelectorAll(".bbmm-setting:checked")]
				.map(el => `${el.dataset.ns}::${el.dataset.key}`)
		);
		return all.filter(e => wanted.has(`${e.namespace}::${e.key}`));
	}
}


// Settings Preset Manager main
export async function openSettingsPresetManager() {
	// Stable id for this manager window so we can find/close it reliably
	const PRESET_MANAGER_ID = "bbmm-settings-preset-manager";

	/*
		Find an open window by id.
		- First check a global DialogV2/ApplicationV2 registry (BBMM_V2_WINDOWS) if one exists.
		- Fallback to legacy ui.windows for classic Application windows.
	*/
	const getWindowById = (id) => {
		try {
			// Check v2 registry if present
			if (globalThis.BBMM_V2_WINDOWS && typeof globalThis.BBMM_V2_WINDOWS.get === "function") {
				const v2 = globalThis.BBMM_V2_WINDOWS.get(id);
				if (v2) return v2;
			}
		} catch (e) {
			// If anything goes wrong reading the registry, ignore and fall back
			DL(2, "openSettingsPresetManager(): v2 registry lookup failed", e);
		}
		// Fallback
		return Object.values(ui.windows ?? {}).find(w => w?.id === id) ?? null;
	};

	// Close any existing instance so we reopen a fresh one
	const existing = getWindowById(PRESET_MANAGER_ID);
	if (existing) {
		DL("openSettingsPresetManager(): Settings Preset Manager: closing existing instance before reopen");
		try { await existing.close({ force: true }); }
		catch (e) { DL(2, "openSettingsPresetManager(): failed to close existing instance", e); }
	}

	// Build list of current presets
	const presets = svc_getSettingsPresets();
	const names = Object.keys(presets).sort((a,b)=>a.localeCompare(b));
	const options = names.map(n => `<option value="${ hlp_esc(n)}">${ hlp_esc(n)}</option>`).join("");

	// Content markup (make central area scrollable to avoid off-screen growth)
	const content = `
		<section class="bbmm-preset-manager-root" style="min-width:560px;display:flex;flex-direction:column;gap:.75rem;max-height:70vh;overflow:auto;">
			<div style="display:flex;gap:.5rem;align-items:center;">
				<label style="min-width:12rem;">${LT.savedSettingsPresets()}</label>
				<select name="presetName" style="flex:1;">${options}</select>
				<button type="button" data-action="load">${LT.buttons.load()}</button>
				<button type="button" data-action="update">${LT.buttons.update()}</button>
				<button type="button" data-action="delete">${LT.buttons.delete()}</button>
			</div>

			<hr>

			<div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;">
				<label><input type="checkbox" name="includeDisabled" checked> ${LT.incDisabledModules()}</label>
			</div>

			<div style="display:flex;gap:.5rem;align-items:center;">
				<input name="newName" type="text" placeholder="${LT.newSettingPresetName()}…" style="flex:1;">
				<button type="button" data-action="save-current">${LT.buttons.saveCurrentSettings()}</button>
			</div>

			<hr>

			<h3 style="margin:0;">${LT.expImpCurrentSettings()}</h3>
			<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
				<button type="button" data-action="export">${LT.buttons.exportToJSON()}</button>
				<button type="button" data-action="import">${LT.buttons.importFromJSON()}</button>
			</div>
		</section>
	`;

	/*
		Create DialogV2 with a stable id so we can close/refresh later.
		We’ll re-center it on render to avoid off-screen growth.
	*/
	const dlg = new foundry.applications.api.DialogV2({
		id: PRESET_MANAGER_ID,
		window: { title: LT.titleSettingsPresetMgr(), resizable: true },
		position: { width: 700, height: "auto" },
		content,
		buttons: [{ action: "close", label: LT.buttons.close(), default: true }]
	});

	/*
		Attach listeners after the DialogV2 DOM is in place.
		Also normalize button types and re-center the window so it never sits off-screen.
	*/
	const onRender = (app) => {
		if (app !== dlg) return;
		Hooks.off("renderDialogV2", onRender);

		// Re-size and re-center the window so it fits the viewport
		try { dlg.setPosition({ height: "auto", left: null, top: null }); } catch {}

		const root = app.element;
		const form = root?.querySelector("form");	// DialogV2 wraps content in a form
		if (!form) return;

		// Ensure all action buttons are non-submitting buttons (defensive)
		form.querySelectorAll('button[data-action]').forEach(b => b.setAttribute("type", "button"));

		// Single delegated click handler for all actions
		form.addEventListener("click", async (ev) => {
			const btn = ev.target;
			if (!(btn instanceof HTMLButtonElement)) return;
			const action = btn.dataset.action || "";
			if (!["save-current","load","update","delete","export","import"].includes(action)) return;

			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation();

			// Read controls directly from the dialog root (more reliable with DialogV2)
			const sel = root.querySelector('select[name="presetName"]');
			const txt = root.querySelector('input[name="newName"]');
			const chk = root.querySelector('input[name="includeDisabled"]');

			const selected = sel ? String(sel.value ?? "") : "";
			const newName = txt ? String(txt.value ?? "").trim() : "";
			const includeDisabled = !!(chk && chk.checked);

			DL(`openSettingsPresetManager(): \naction = ${action} \nselected = ${selected} \nnewName = ${newName} \nincludeDisabled = ${includeDisabled}`);

			// Guard: name required for save-current
			if (action === "save-current" && !newName) {
				ui.notifications.warn(`${LT.promptNameSettingsPreset()}.`);
				return;
			}

			try {
				/*
					SAVE CURRENT -> new named preset
				*/
				if (action === "save-current") {
					const payload = svc_collectAllModuleSettings({ includeDisabled });
					DL("openSettingsPresetManager(): save-current — collected payload", {
						counts: {
							world: Object.keys(payload.world ?? {}).length,
							client: Object.keys(payload.client ?? {}).length,
							user: Object.keys(payload.user ?? {}).length
						}
					});

					// Normalize schema types
					hlp_schemaCorrectNonPlainTypes(payload);
					DL("openSettingsPresetManager(): save-current — schema corrected");

					// Save preset (overwrites if same name already exists)
					DL("openSettingsPresetManager(): save-current — calling svc_saveSettingsPreset", { name: newName });
					const res = await svc_saveSettingsPreset(`${newName}`, payload);
					DL("openSettingsPresetManager(): save-current — save result", res);
					if (res?.status !== "saved") return;

					ui.notifications.info(`${LT.savedSettingsPreset({ name: res.name })}.`);

					// Refresh list
					app.close();
					openSettingsPresetManager();
					return;
				}

				/*
					UPDATE -> overwrite the SELECTED preset with CURRENT settings
				*/
				if (action === "update") {
					if (!selected) { ui.notifications.warn(`${LT.selectSettingsPreset()}.`); return; }

					// Collect fresh current settings
					const payload = svc_collectAllModuleSettings({ includeDisabled });
					DL("openSettingsPresetManager(): update — collected payload", {
						counts: {
							world: Object.keys(payload.world ?? {}).length,
							client: Object.keys(payload.client ?? {}).length,
							user: Object.keys(payload.user ?? {}).length
						}
					});

					// Normalize schema types
					hlp_schemaCorrectNonPlainTypes(payload);
					DL("openSettingsPresetManager(): update — schema corrected");

					// Save over the selected name
					DL("openSettingsPresetManager(): update — calling svc_saveSettingsPreset", { name: selected });
					const res = await svc_saveSettingsPreset(`${selected}`, payload);
					DL("openSettingsPresetManager(): update — save result", res);
					if (res?.status !== "saved") return;

					ui.notifications.info(`${LT.updatedSettingsPreset({ name: selected})}.`);

					// Refresh list (no need to rebuild options, but keep consistent)
					app.close();
					openSettingsPresetManager();
					return;
				}

				/*
					LOAD -> apply preset
				*/
				if (action === "load") {
					if (!selected) return ui.notifications.warn(`${LT.selectSettingsPresetLoad()}.`);
					const preset = svc_getSettingsPresets()[selected];
					if (!preset) return;

					const skippedMissing = [];

					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: LT.titleApplySettingsPreset() },
						content: `<p>${LT.titleApplySettingsPreset()} <b>${hlp_esc(selected)}</b>?</p>`,
						ok: { label: LT.buttons.apply() },
						modal: true
					});
					if (!ok) return;

					let payload = preset;

					// items: [...] or entries: [...] -> hydrate to bbmm-settings envelope
					const flat = Array.isArray(preset?.items) ? preset.items
						: (Array.isArray(preset?.entries) ? preset.entries : null);

					if (!preset?.type && flat) {
						// Build a proper bbmm-settings export envelope
						const out = { type: "bbmm-settings", created: new Date().toISOString(), world: {}, client: {}, user: {} };

						for (const e of flat) {
							if (!e || typeof e.namespace !== "string" || typeof e.key !== "string") continue;

							// Skip unregistered
							if (!hlp_isRegisteredSetting(e.namespace, e.key)) {
								skippedMissing.push(`${e.namespace}.${e.key}`);
								continue;
							}

							const scope = (e.scope === "world") ? "world" : (e.scope === "user" ? "user" : "client");
							out[scope][e.namespace] ??= {};
							out[scope][e.namespace][e.key] = e.value;
						}

						payload = out;
						DL(`openSettingsPresetManager(): Load converted preset "${selected}" with ${flat.length} entries to bbmm-settings envelope`, payload);
					}

					// Safety: ignore accidental nested world wrappers
					if (payload?.type === "bbmm-settings") {
						const stripWorldNameNest = (bucket) => {
							// If bucket has exactly one key and that key looks like a world id/name, unwrap it
							const keys = Object.keys(bucket || {});
							if (keys.length === 1) {
								const k = keys[0];
								const maybe = bucket[k];
								if (maybe && typeof maybe === "object" && Object.values(maybe).every(v => v && typeof v === "object")) {
									return maybe;
								}
							}
							return bucket;
						};
						payload.world = stripWorldNameNest(payload.world);
						payload.client = stripWorldNameNest(payload.client);
						payload.user = stripWorldNameNest(payload.user);
					}

					if (skippedMissing.length) {
						ui.notifications?.warn(`${LT.skippedSettingsApply({ count: skippedMissing.length })}.`);
						DL(`openSettingsPresetManager(): Skipped for missing modules/settings:\n${skippedMissing.join("\n")}`);
					}

					// Apply
					await svc_applySettingsExport(payload);
					return;
				}

				/*
					DELETE -> remove a preset
				*/
				if (action === "delete") {
					if (!selected) return ui.notifications.warn(`${LT.errors.selectSettingPresetDelete()}.`);
					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: LT.titleDelSettingsPreset() },
						content: `<p>${LT.promptDelSettingsPreset({ name: hlp_esc(selected) })}?</p>`,
						ok: { label: LT.buttons.delete() }
					});
					if (!ok) return;

					const all = svc_getSettingsPresets();
					delete all[selected];
					await svc_setSettingsPresets(all);
					ui.notifications.info(`${LT.deletedSettingsPreset({ name: selected })}.`);

					// Refresh list
					app.close();
					openSettingsPresetManager();
					return;
				}

				/*
					EXPORT -> file
				*/
				if (action === "export") {
					try {
						DL("openSettingsPresetManager(): Export: start");
						const payload = svc_collectAllModuleSettings({ includeDisabled });

						// Normalize schema types
						hlp_schemaCorrectNonPlainTypes(payload);

						const base = game.user.isGM ? "settings-world-client-user" : "settings-client-user";
						const fname = `bbmm-${base}-${hlp_timestampStr()}.json`;

						await hlp_saveJSONFile(payload, fname);
						ui.notifications.info(`${LT.exportedCurrentSettings()}.`);
						DL("openSettingsPresetManager(): Export: done");
					} catch (e) {
						DL(3, `Export: FAILED — ${e?.name ?? "Error"}: ${e?.message ?? e}`);
						ui.notifications.error(`${LT.errors.settingsExportFailed()}.`);
						throw e;
					}
					return;
				}

				// Import settings from a file
				if (action === "import") {
					const file = await hlp_pickLocalJSONFile();
					if (!file) return;

					let data;
					try { data = JSON.parse(await file.text()); }
					catch { ui.notifications.error(`${LT.invalidJSONFile()}.`); return; }

					// Require BBMM settings export type
					if (!data || data.type !== "bbmm-settings") {
						await new foundry.applications.api.DialogV2({
							window: { title: LT.errors.titleImportError() },
							content: `<p>${LT.errors.notBBMMSettingsFile()}.</p>`,
							buttons: [{ action: "ok", label: LT.buttons.ok(), default: true }],
							submit: () => "ok"
						}).render(true);
						return;
					}

					// Normalize (applies exclusions) then re-envelope
					const before = { 
						world: Object.values(data.world ?? {}).reduce((n,ns)=>n+Object.keys(ns).length,0),
						client: Object.values(data.client ?? {}).reduce((n,ns)=>n+Object.keys(ns).length,0),
						user: Object.values(data.user ?? {}).reduce((n,ns)=>n+Object.keys(ns).length,0)
					};
					const entries = hlp_normalizeToEntries(data);	// exclusions enforced here
					const filtered = hlp_entriesToEnvelope(entries);
					const after = { 
						world: Object.values(filtered.world ?? {}).reduce((n,ns)=>n+Object.keys(ns).length,0),
						client: Object.values(filtered.client ?? {}).reduce((n,ns)=>n+Object.keys(ns).length,0),
						user: Object.values(filtered.user ?? {}).reduce((n,ns)=>n+Object.keys(ns).length,0)
					};
					DL("Import: counts before/after exclusions", { before, after, entryCount: entries.length });

					// Hand off to Import Wizard with the filtered envelope
					await ui_openSettingsImportWizard(filtered);
					return;
				}
			} catch (err) {
				// Log the real failure details
				DL(3, "openSettingsPresetManager(): action failed", {
					action,
					name: err?.name,
					message: err?.message,
					stack: err?.stack
				});
				ui.notifications.error(`${LT.errors.errorOccured()}.`);
			}
		});
	};
	Hooks.on("renderDialogV2", onRender);

	// Render
	dlg.render(true);
}

// Expose API
Hooks.once("ready", () => {
	const mod = game.modules.get(BBMM_ID);
	if (!mod) return;
	mod.api ??= {};
	mod.api.openSettingsPresetManager = openSettingsPresetManager;
});
