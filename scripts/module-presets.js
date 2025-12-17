import { DL } from './settings.js';
import { hlp_esc, hlp_timestampStr, hlp_saveJSONFile, hlp_pickLocalJSONFile, hlp_normalizePresetName } from './helpers.js';
import { LT, BBMM_ID } from "./localization.js";
const MODULE_SETTING_PRESETS = "modulePresetsUser";  // { [name]: string[] }  enabled module ids
const MODULE_PRESETS_MIGRATION_FLAG = "modulePresetsPersistentStorageMigration";

/*	=====	HELPERS =====
*/

const MODULE_PRESETS_STORAGE_DIR = "presets";
const MODULE_PRESETS_STORAGE_FILE = "module-presets.json";
let _presetCache = null;

// Sanitize a { [name]: string[] } preset map
function hlp_sanitizePresetMap(raw) {
	const out = {};
	if (!raw || typeof raw !== "object") return out;

	for (const [k, v] of Object.entries(raw)) {
		if (typeof k !== "string" || !k.trim()) continue;
		if (!Array.isArray(v)) continue;

		const clean = [...new Set(v.filter(id => typeof id === "string" && id.trim()))];
		out[k] = clean;
	}

	return out;
}

function hlp_worldId() {
	return game.world?.id || "unknownWorld";
}

function hlp_sanitizePresetsStorageRoot(raw) {
	const wid = hlp_worldId();

	// New schema
	if (raw && typeof raw === "object" && raw.worlds && typeof raw.worlds === "object") {
		const out = { worlds: {} };

		for (const [worldId, presetsMap] of Object.entries(raw.worlds)) {
			if (typeof worldId !== "string" || !worldId.trim()) continue;
			out.worlds[worldId] = hlp_sanitizePresetMap(presetsMap);
		}

		return out;
	}

	// Legacy flat schema -> claim to current world
	const legacyMap = hlp_sanitizePresetMap(raw);
	return { worlds: { [wid]: legacyMap } };
}

function hlp_getWorldPresetsFromRoot(root, worldId) {
	if (!root || typeof root !== "object") return {};
	if (!root.worlds || typeof root.worlds !== "object") return {};
	const map = root.worlds[worldId];
	return hlp_sanitizePresetMap(map);
}

function hlp_setWorldPresetsOnRoot(root, worldId, presetsMap) {
	const out = hlp_sanitizePresetsStorageRoot(root);
	out.worlds[worldId] = hlp_sanitizePresetMap(presetsMap);
	return out;
}

async function hlp_fetchJSON(url) {
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) return null;

	try {
		return await res.json();
	} catch (err) {
		DL("module-presets.js | hlp_fetchJSON(): Failed to parse JSON", { url, err });
		return null;
	}
}

async function hlp_readPresetsFromStorage() {
	try {
		const dir = `modules/${BBMM_ID}/storage/presets`;
		const browse = await FilePicker.browse("data", dir, { extensions: ["json"] });

		const match = (browse?.files || []).find(f => String(f).endsWith("/module-presets.json"));
		if (match) {
			const data = await hlp_fetchJSON(match);
			return hlp_sanitizePresetsStorageRoot(data);
		}
	} catch (err) {
		const msg = String(err?.message ?? err);

		if (msg.includes("does not exist") || msg.includes("not accessible")) {
			DL("module-presets.js | hlp_readPresetsFromStorage(): presets folder not found yet, will try fallback");
		} else {
			DL(2, "module-presets.js | hlp_readPresetsFromStorage(): browse failed unexpectedly", err);
		}
	}

	// Fallback direct fetch
	try {
		const url = `modules/${BBMM_ID}/storage/presets/module-presets.json`;
		const data = await hlp_fetchJSON(url);
		return hlp_sanitizePresetsStorageRoot(data);
	} catch (err2) {
		return { worlds: {} };
	}
}

async function hlp_writePresetsToStorage(root) {
	const cleanRoot = hlp_sanitizePresetsStorageRoot(root);

	const payload = JSON.stringify(cleanRoot ?? { worlds: {} }, null, 2);
	const file = new File([payload], MODULE_PRESETS_STORAGE_FILE, { type: "application/json" });

	try {
		// If you ship the folders in the release, this can stay as a verify-only helper.
		// Keep as-is if you want, but do NOT try to mkdir() via FilePicker (it will ENOENT on some hosts).
		// await hlp_ensurePresetsDir();

		const res = await FilePicker.uploadPersistent(BBMM_ID, MODULE_PRESETS_STORAGE_DIR, file, {}, { notify: false });

		if (!res || (!res.path && !res.url)) {
			DL(3, "module-presets.js | hlp_writePresetsToStorage(): uploadPersistent returned no path/url", res);
			return false;
		}

		DL("module-presets.js | hlp_writePresetsToStorage(): wrote presets to persistent storage", {
			dir: MODULE_PRESETS_STORAGE_DIR,
			path: res.path,
			url: res.url
		});

		return true;
	} catch (err) {
		DL(3, "module-presets.js | hlp_writePresetsToStorage(): uploadPersistent failed", err);
		return false;
	}
}


async function hlp_verifyPresetsDir() {
	const dir = `modules/${BBMM_ID}/storage/presets`;

	try {
		await FilePicker.browse("data", dir, {});
		DL("module-presets.js | hlp_verifyPresetsDir(): presets directory verified", dir);
		return true;
	} catch (err) {
		DL(3, "module-presets.js | hlp_verifyPresetsDir(): presets directory missing or inaccessible", {
			dir,
			err
		});
		return false;
	}
}

async function hlp_loadPresets() {
	if (_presetCache !== null) return _presetCache;

	const wid = hlp_worldId();

	if (hlp_hasFlag(MODULE_PRESETS_MIGRATION_FLAG)) {
		DL("module-presets.js | hlp_loadPresets(): migration flag already set, skipping legacy migration");
	}

	const root = await hlp_readPresetsFromStorage();
	const worldMap = hlp_getWorldPresetsFromRoot(root, wid);

	// If we already have current-world data in storage, use it
	if (worldMap && Object.keys(worldMap).length) {
		_presetCache = worldMap;

		// If file exists but flag missing (manual restore / older version), fix flag
		if (!hlp_hasFlag(MODULE_PRESETS_MIGRATION_FLAG) && game.user.isGM) {
			await hlp_setFlag(MODULE_PRESETS_MIGRATION_FLAG, true);
			DL("module-presets.js | hlp_loadPresets(): storage found, migration flag was missing and is now set");
		}

		DL("module-presets.js | hlp_loadPresets(): loaded presets from persistent storage (current world)", {
			world: wid,
			count: Object.keys(worldMap).length
		});

		return _presetCache;
	}

	// If flag set but storage missing current-world map, attempt repair from legacy (GM only)
	if (hlp_hasFlag(MODULE_PRESETS_MIGRATION_FLAG)) {
		const legacy = foundry.utils.duplicate(game.settings.get(BBMM_ID, MODULE_SETTING_PRESETS) || {});
		const legacyClean = hlp_sanitizePresetMap(legacy);

		_presetCache = legacyClean;

		if (!Object.keys(legacyClean).length) {
			DL(2, "module-presets.js | hlp_loadPresets(): migration flag set but storage file missing/empty and no legacy presets available. Presets empty.");
			_presetCache = {};
			return _presetCache;
		}

		if (game.user.isGM) {
			DL(2, "module-presets.js | hlp_loadPresets(): migration flag set but storage missing/empty. Attempting repair write from legacy.", {
				world: wid,
				count: Object.keys(legacyClean).length
			});

			const repairedRoot = hlp_setWorldPresetsOnRoot(root, wid, legacyClean);
			const ok = await hlp_writePresetsToStorage(repairedRoot);

			if (ok) {
				DL("module-presets.js | hlp_loadPresets(): repair migration succeeded, continuing with repaired presets");
				_presetCache = legacyClean;
				return _presetCache;
			}

			DL(3, "module-presets.js | hlp_loadPresets(): repair migration failed. Leaving presets empty.");
			_presetCache = {};
			return _presetCache;
		}

		DL(2, "module-presets.js | hlp_loadPresets(): migration flag set but storage missing/empty. Non-GM cannot repair. Presets empty.");
		_presetCache = {};
		return _presetCache;
	}

	// Migration path (per-world): take legacy *for this world* and write into root.worlds[wid]
	const legacy = foundry.utils.duplicate(game.settings.get(BBMM_ID, MODULE_SETTING_PRESETS) || {});
	const legacyClean = hlp_sanitizePresetMap(legacy);

	_presetCache = legacyClean;

	if (!Object.keys(legacyClean).length) {
		DL("module-presets.js | hlp_loadPresets(): no legacy presets found, setting migration flag to avoid repeated checks");
		if (game.user.isGM) await hlp_setFlag(MODULE_PRESETS_MIGRATION_FLAG, true);
		return _presetCache;
	}

	DL("module-presets.js | hlp_loadPresets(): migrating legacy presets to persistent storage (current world)", {
		world: wid,
		count: Object.keys(legacyClean).length
	});

	if (game.user.isGM) {
		const nextRoot = hlp_setWorldPresetsOnRoot(root, wid, legacyClean);
		const ok = await hlp_writePresetsToStorage(nextRoot);

		if (ok) {
			await hlp_setFlag(MODULE_PRESETS_MIGRATION_FLAG, true);
			DL("module-presets.js | hlp_loadPresets(): migration complete, flag set");
		} else {
			DL(3, "module-presets.js | hlp_loadPresets(): migration failed, leaving flag unset");
		}
	} else {
		DL(2, "module-presets.js | hlp_loadPresets(): non-GM cannot migrate, using legacy in-memory only");
	}

	return _presetCache;
}

function hlp_getFlags() {
	const obj = game.settings.get(BBMM_ID, "bbmmFlags");
	return obj && typeof obj === "object" ? { ...obj } : {};
}

function hlp_hasFlag(key) {
	const flags = hlp_getFlags();
	return Boolean(flags[key]);
}

async function hlp_setFlag(key, value) {
	const flags = hlp_getFlags();
	flags[key] = value;
	await game.settings.set(BBMM_ID, "bbmmFlags", flags);
}

// Validate Module Preset JSON structure	
function hlp_validateModulePresetJSON(data) {

	// Accept ONLY our known payloads
	// "bbmm-state": { type, name, created, modules[], versions{} }
	if (data && typeof data === "object" && data.type === "bbmm-state" && Array.isArray(data.modules)) {
		return { kind: "state", modules: [...new Set(data.modules.filter(x => typeof x === "string"))] };
	}

	// Everything else: reject
	return null;
}

// Check if modules in preset are missing or have missing dependencies
function hlp_validateModuleState(modIds) {
	const unknown = [];			// { id, reason: "not installed" }
	const depIssues = [];		// { id, depId, reason: "dependency missing" }

	for (const id of modIds) {
		if (!game.modules.has(id)) unknown.push({ id, reason: "not installed" });
	}

	for (const id of modIds) {
		const mod = game.modules.get(id);
		if (!mod) continue;
		const requires = hlp_getRequiredIds(mod);
		for (const depId of requires) {
			if (!game.modules.has(depId)) {
				depIssues.push({ id, depId, reason: "dependency missing" });
			}
		}
	}

	// Optional debug
	if (!unknown.length && !depIssues.length) {
		DL("module-presets.js | hlp_validateModuleState(): No missing modules or dependencies");
	} else {
		DL("module-presets.js | hlp_validateModuleState(): Missing modules or dependencies found!");
	}

	return { unknown, depIssues };
}

function hlp_slugify(s) {
	return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hlp_formatDateD_Mon_YYYY(d = new Date()) {
	const dd = String(d.getDate()).padStart(2, "0");
	const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
	const yyyy = d.getFullYear();
	return `${dd}-${MON}-${yyyy}`;
}

// Get required dependency ids declared by a module 
function hlp_getRequiredIds(mod) {
	// Supports both legacy and modern manifest styles
	const data = mod?.manifest || mod?.data?.manifest || {};
	const req = Array.isArray(data?.relationships?.requires)
		? data.relationships.requires
		: (Array.isArray(mod?.relationships?.requires) ? mod.relationships.requires : []);
	const ids = [];
	for (const r of req) {
		// {id, type:'module'|'system', ...}
		if (!r) continue;
		if ((r.id || r.name) && (r.type === "module" || !r.type)) {
			ids.push(r.id || r.name);
		}
	}
	return ids;
}

// read preset map
function hlp_getPresets() {
	if (_presetCache === null) {
		DL("module-presets.js | hlp_getPresets(): cache not loaded yet, returning empty map");
		return {};
	}
	return foundry.utils.duplicate(_presetCache || {});
}

// set preset map
async function hlp_setPresets(presets) {
	const wid = hlp_worldId();
	const clean = hlp_sanitizePresetMap(presets);

	_presetCache = clean;

	// Persist ONLY this world's presets into the shared storage root
	const root = await hlp_readPresetsFromStorage();
	const nextRoot = hlp_setWorldPresetsOnRoot(root, wid, clean);

	const ok = await hlp_writePresetsToStorage(nextRoot);
	if (!ok) {
		ui.notifications.warn(LT.errors?.failedToWritePresets?.() ?? "Failed to write presets to storage.");
	}
}

// Save Preset checking if it exists and prompting to overwrite or rename
async function hlp_savePreset(name, modules) {
	
	// Prompt how to handle duplicate name 
	function askPresetConflict(existingKey) {
		const boldName = "<b>" + hlp_esc(existingKey) + "</b>";
		const contentHtml = "<p>"
			+ LT.errors.presetExists({ name: boldName })
			+ "</p><p>"
			+ LT.errors.existsPrompt()
			+ "?</p>";
		
		return new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window: { title: LT.errors.conflictTitleExists(), modal: true },
				content: contentHtml,
				buttons: [
					{ action: "overwrite", label: LT.errors.overwrite(), default: true, callback: () => "overwrite" },
					{ action: "rename", label: LT.errors.rename(), callback: () => "rename" },
					{ action: "cancel", label: LT.buttons.cancel(), callback: () => "cancel" }
				],
				submit: (result) => resolve(result ?? "cancel"),
				rejectClose: false
			}).render(true);
		});
	}
	
	// Rename preset
	function promptRename(rawInput) {
		return new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window: { title: LT.renamePreset(), modal: true },
				content: `
					<div style="display:flex;gap:.5rem;align-items:center;">
						<label style="min-width:7rem;">${LT.newName()}</label>
						<input name="newName" type="text" value="${hlp_esc(rawInput)}" autofocus style="flex:1;">
					</div>
				`,
				buttons: [
					{ action: "ok", label: LT.buttons.save(), default: true,
					  callback: (_ev, btn) => resolve(btn.form.elements.newName?.value?.trim() || "") },
					{ action: "cancel", label: LT.buttons.cancel(), callback: () => resolve(null) }
				],
				submit: () => {},
				rejectClose: false
			}).render(true);
		});
	}
	
	// keep what the user typed for the rename dialog
	const rawInput = String(name).trim();
	DL(`module-presets.js | hlp_savePreset(): rawInput: '${rawInput}'`);

	// use normalized copy only for matching
	const normalizedWanted = hlp_normalizePresetName(rawInput);
	DL(`module-presets.js | hlp_savePreset(): normalizedWanted: '${normalizedWanted}'`);
	const presets = hlp_getPresets();

	let existingKey = null;
	for (const k of Object.keys(presets)) {
		if (hlp_normalizePresetName(k) === normalizedWanted) { existingKey = k; break; }
	}

	// default final name is the raw input (preserve casing/spaces the user typed)
	let finalName = rawInput;

	DL(`module-presets.js | hlp_savePreset(): existingKey: ${existingKey}`);
	
	if (existingKey) {
		DL(`module-presets.js | hlp_savePreset(): existingKey condition fired!`);
		const choice = await askPresetConflict(existingKey);
		DL(`module-presets.js | hlp_savePreset(): choice: ${choice}`);
		if (choice === "cancel") return { status: "cancel" };
		else if (choice === "overwrite") {
			DL(`module-presets.js | hlp_savePreset(): Chose overwrite`);
			// proceed with overwrite
			finalName = existingKey;
		}
		else if (choice === "rename") {
			DL(`module-presets.js | hlp_savePreset(): Chose rename`);
			const newName = await promptRename(rawInput);
			DL(`module-presets.js | hlp_savePreset(): newName = '${newName}'`);
			if (!newName) return { status: "cancel" };
			finalName = newName.trim();
		}
	}

	const p = hlp_getPresets();
	p[finalName] = modules;
	await hlp_setPresets(p);
	DL(`module-presets.js | hlp_savePreset(): saved presets: `, p);
	return { status: "saved", name: finalName };
}

// Current enabled module ids (exclude core/system) 
function hlp_getEnabledModuleIds() {
	const list = [];
	for (const m of game.modules.values()) {
		// Only non-core modules (systems live elsewhere)
		if (m.active) list.push(m.id);
	}
	return list;
}

// Read moduleConfiguration safely 
function hlp_getModuleConfig() {
	return foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
}

// Show dialog report of Import issues
async function showImportIssuesDialog({ unknown, depIssues }) {
	
	function displayIssues(lines) {
		// Wrap DialogV2 in a Promise so we can await a boolean
		return new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window: { title: LT.titleImportIssues },
				content: `
					<div style="display:flex;flex-direction:column;gap:.5rem;">
						<p class="notes">${LT.descImportIssues()}:</p>
						${lines.join("\n")}
					</div>
				`,
				buttons: [
					{ action: "ok", label: LT.buttons.ok(), default: true }
				],
				submit: (_res, _ev, button) => button?.action === "ok"
			}).render(true);
		})
	}
	
	
	DL(`module-presets.js | showImportIssuesDialog(): unknown: `, unknown);
	DL(`module-presets.js | showImportIssuesDialog(): depIssues: `, depIssues);

	const lines = [];

	if (unknown.length) {
		lines.push(`<p><b>${LT.titleModulesNotInstalled()}:</b></p>`);
		lines.push(`<ul style="margin-top:.25rem;">${
			unknown.map(it => `<li><code>${hlp_esc(it.id)}</code> — ${LT.descModulesNotInstalled()}</li>`).join("")
		}</ul>`);
	}

	if (depIssues.length) {
		// Group by module → list missing deps
		const byMod = new Map();
		for (const it of depIssues) {
			const modId = it.module?.id ?? it.id;   // fall back if shape is { id, depId }
			const depId = it.dep?.id ?? it.depId;
			if (!byMod.has(modId)) byMod.set(modId, []);
			if (depId != null) byMod.get(modId).push(depId);
		}
		lines.push(`<p><b>${LT.dependencyMissing()}:</b></p>`);
		lines.push(`<ul style="margin-top:.25rem;">${
			[...byMod.entries()].map(([id, deps]) =>
				`<li><code>${hlp_esc(id)}</code> → ${LT.errors.missing()}: ${deps.map(d => `<code>${hlp_esc(d)}</code>`).join(", ")}</li>`
			).join("")
		}</ul>`);
	}

	if (!lines.length) return;
	
	DL(`module-presets.js | showImportIssuesDialog(): Issues with import found`);
	const issues = await displayIssues(lines);
	return;
		
}

// Open Dialog to export Module state json
async function exportCurrentModuleStateDialog() {
	new foundry.applications.api.DialogV2({
		window: { title: LT.titleExportModuleState() },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">${LT.exportName()}</label>
					<input name="exportName" type="text" placeholder="e.g. prod-setup" style="flex:1;">
				</div>
				<p class="notes">${LT.noteExportFileName()} 
				<code>${LT.filenameModuleState()}-{name}-{YYYYMMDD-HHMMSS}.json</code></p>
			</div>
		`,
		buttons: [
			{
				action: "ok",
				label: LT.buttons.export(),
				default: true,
				callback: (ev, button) => button.form.elements.exportName?.value?.trim() || ""
			},
			{
				action: "cancel",
				label: LT.buttons.cancel(),
				// Return null so submit receives a falsy result
				callback: () => null
			}
		],
		submit: (_result) => {
			// Guard against cancel or empty input
			if (!_result || _result === "cancel") {
				DL("module-presets.js | exportCurrentModuleStateDialog(): user cancelled export");
				return;
			}

			const baseName = String(_result).trim();
			if (!baseName) {
                // Warn only if they clicked Export with empty name
				ui.notifications.warn(`${LT.exportNamePrompt()}.`);
				return;
			}

			const stamp = hlp_timestampStr();
			const fname = `${LT.filenameModuleState()}-${hlp_slugify(baseName)}-${stamp}.json`;

			// Collect enabled modules and versions
			const enabled = hlp_getEnabledModuleIds();
			const versions = {};
			for (const id of enabled) versions[id] = game.modules.get(id)?.version ?? null;

			// Save JSON file
			hlp_saveJSONFile({
				type: "bbmm-state",
				name: baseName,
				created: new Date().toISOString(),
				modules: enabled,
				versions
			}, fname);

			DL(`module-presets.js | exportCurrentModuleStateDialog(): exported "${baseName}" as ${fname}`, { count: enabled.length });
		}
	}).render(true);
}

// Import module preset json file, validate it, save as preset. 
async function importModuleStateAsPreset(data) {
	// validate file structure
	const validated = hlp_validateModulePresetJSON(data);
	if (!validated || !Array.isArray(validated.modules) || !validated.modules.length) {
		DL(3, "module-presets.js | Not a BBMM export. Expected a file created by BBMM.");
		await new foundry.applications.api.DialogV2({
			window: { title: LT.errors.titleImportError() },
			content: `<p>${LT.errors.notBBMMFile()}.</p>`,
			buttons: [{ action: "ok", label: LT.buttons.ok(), default: true }],
			submit: () => "ok"
		}).render(true);
		return;
	}
	const modules = validated.modules;

	// compute report now (so we can show it after save)
	const report = hlp_validateModuleState(modules);

	// ask for preset name and save
	const dlgName = new foundry.applications.api.DialogV2({
		window: { title: LT.titleImportPreset() },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">${LT.presetName()}</label>
					<input name="presetName" type="text" placeholder="e.g. staging" style="flex:1;">
				</div>
			</div>
		`,
		buttons: [
			{ action: "ok", label: LT.buttons.import(), default: true,
			  callback: (ev, button) => button.form.elements.presetName?.value?.trim() || "" },
			{ action: "cancel", label: LT.buttons.cancel() }
		],
		submit: async (_result) => {
			const baseName = _result;
			if (!baseName) { ui.notifications.warn(`${LT.importNamePrompt()}.`); return; }

			const res = await hlp_savePreset(`${baseName} (${hlp_formatDateD_Mon_YYYY()})`, modules);
			if (res.status !== "saved") return res;

			ui.notifications.info(`${LT.importedSummary({ name: res.name, count: modules.length })}.`);

			// CLOSE the naming dialog *before* showing issues
			try { await dlgName.close(); } catch {}

			// Show issues once (if any)
			if (report.unknown.length || report.depIssues.length) {
				await showImportIssuesDialog(report); 
			}

			DL("module-presets.js | importModuleStateAsPreset() returning ", res);
			return res;
		},
		rejectClose: false
	});
	dlgName.render(true);
}

// Apply a set of enabled ids -> update core.moduleConfiguration 
async function applyEnabledIds(enabledIds, {autoEnableDeps = true} = {}) {
	const config = hlp_getModuleConfig();

	// Start by disabling everything we manage (only modules, not systems)
	for (const m of game.modules.values()) {
		config[m.id] = false;
	}
	// Enable requested
	for (const id of enabledIds) {
		if (game.modules.has(id)) config[id] = true;
	}

	// Optionally pull in required deps
	if (autoEnableDeps) {
		const toEnable = new Set(enabledIds);
		let changed;
		do {
			changed = false;
			for (const id of Array.from(toEnable)) {
				const mod = game.modules.get(id);
				if (!mod) continue;
				const requires = hlp_getRequiredIds(mod);
				for (const depId of requires) {
					if (game.modules.has(depId) && !toEnable.has(depId)) {
						toEnable.add(depId);
						config[depId] = true;
						changed = true;
					}
				}
			}
		} while (changed);
	}

	await game.settings.set("core", "moduleConfiguration", config);
}

//	Open Dialog to manage presets 
export async function openPresetManager() {
	// Start
	DL("module-presets.js | openPresetManager: start");

	const wid = game.world?.id || "unknownWorld";

	async function hlp_buildMergedPresetList() {
		const root = await hlp_readPresetsFromStorage();
		const worlds = (root?.worlds && typeof root.worlds === "object") ? root.worlds : {};

		/** @type {Array<{ id: string, name: string, displayName: string, worldId: string, isCurrentWorld: boolean, modules: string[] }>} */
		const list = [];

		for (const [worldId, presetsObj] of Object.entries(worlds)) {
			if (!presetsObj || typeof presetsObj !== "object") continue;

			for (const [name, modules] of Object.entries(presetsObj)) {
				list.push({
					id: `${worldId}::${name}`,
					name,
					displayName: name,
					worldId,
					isCurrentWorld: worldId === wid,
					modules: Array.isArray(modules) ? modules.filter(x => typeof x === "string") : []
				});
			}
		}

		// Disambiguate duplicate names across worlds by appending (worldId)
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

		const index = {};
		for (const p of list) index[p.id] = p;

		return { list, index };
	}

	(async () => {
		const { list, index } = await hlp_buildMergedPresetList();

		// Current-world presets are still maintained via hlp_getPresets()
		// (so save/update/write paths remain world-separated).
		const currentWorldPresets = hlp_getPresets();
		DL("module-presets.js | openPresetManager: current world presets loaded", {
			world: wid,
			count: Object.keys(currentWorldPresets || {}).length
		});

		const options = list
			.map(p => `<option value="${hlp_esc(p.id)}">${hlp_esc(p.displayName)}</option>`)
			.join("");

		// Dialog content (adds "Update" button next to Load/Delete)
		const content = `
			<div style="min-width:520px;display:flex;flex-direction:column;gap:.75rem;">

				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:10rem;">${LT.savedPresets()}</label>
					<select name="presetName" style="flex:1;">${options}</select>
					<button type="button" data-action="load">${LT.buttons.load()}</button>
					<button type="button" data-action="update">${LT.buttons.update()}</button>
					<button type="button" data-action="delete">${LT.buttons.delete()}</button>
				</div>

				<hr>

				<div style="display:flex;gap:.5rem;align-items:center;">
					<input name="newName" type="text" placeholder="${LT.newPresetName()}…" style="flex:1;">
					<button type="button" data-action="save-current">${LT.buttons.saveCurrent()}</button>
				</div>

				<hr>

				<h3 style="margin:0;">${LT.titleImportExportModuleState()}</h3>
				<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
					<button type="button" data-action="bbmm-export-state">${LT.buttons.exportToJSON()}</button>
					<button type="button" data-action="bbmm-import-state">${LT.buttons.importFromJSON()}</button>
				</div>
			</div>
		`;

		// Create the DialogV2
		const dlg = new foundry.applications.api.DialogV2({
			window: { title: LT.modulePresets() },
			content,
			buttons: [{ action: "close", label: LT.buttons.close(), default: true }]
		});

		/*
			Hook to wire up the click handlers once the dialog is rendered
		*/
		const onRender = (app) => {
			if (app !== dlg) return;
			Hooks.off("renderDialogV2", onRender);
			DL("module-presets.js | renderDialogV2 fired for Preset Manager", { appId: app.appId });

			const form = app.element?.querySelector("form");
			if (!form) { DL(2, "module-presets.js | openPresetManager(): form not found"); return; }

			// Defensive: ensure buttons don’t submit the form
			form.querySelectorAll('button[data-action]').forEach(b => b.setAttribute("type", "button"));

			// Single delegated click handler
			form.addEventListener("click", async (ev) => {
				const btn = ev.target;
				if (!(btn instanceof HTMLButtonElement)) return;
				const action = btn.dataset.action || "";

				// Only handle our buttons; stop other listeners
				if (!["load", "update", "delete", "save-current", "bbmm-export-state", "bbmm-import-state"].includes(action)) return;

				ev.preventDefault();
				ev.stopPropagation();
				ev.stopImmediatePropagation();

				try {
					const sel = form.elements.namedItem("presetName");
					const selectedId = sel ? String(sel.value || "") : "";
					const picked = selectedId ? index[selectedId] : null;

					// Save current enabled modules as new preset (current world only)
					if (action === "save-current") {
						const raw = form.elements.namedItem("newName")?.value ?? "";
						const newName = String(raw).trim();
						if (!newName) return ui.notifications.warn(`${LT.warnEnterName()}.`);

						const enabled = hlp_getEnabledModuleIds();
						DL("module-presets.js | save-current: collected enabled module ids", { count: enabled.length });

						// Uses your existing save logic (current world only)
						const res = await hlp_savePreset(newName, enabled);
						if (res?.status !== "saved") return;

						ui.notifications.info(`${LT.savedSummary({ name: res.name, count: enabled.length })}.`);

						// Refresh UI list
						app.close();
						openPresetManager();
						return;
					}

					// Load preset (any world allowed)
					if (action === "load") {
						if (!picked) return ui.notifications.warn("Select a preset to load.");

						const enabled = picked.modules || [];
						DL("module-presets.js | load: applying preset", { name: picked.name, worldId: picked.worldId, count: enabled.length });

						const proceed = await foundry.applications.api.DialogV2.confirm({
							window: { title: LT.titleApplyModulePreset() },
							content: `<p>${LT.promptApplyModulePreset({ name: hlp_esc(picked.displayName) })}?</p>`,
							modal: true,
							ok: { label: LT.buttons.apply() }
						});
						if (!proceed) return;

						await applyEnabledIds(enabled, { autoEnableDeps: true });
						DL("module-presets.js | load: applied; prompting reload");

						const reload = await foundry.applications.api.DialogV2.confirm({
							window: { title: LT.titleReloadFoundry() },
							content: `<p>${LT.promptReloadNow()}</p>`,
							ok: { label: LT.buttons.reload() }
						});
						if (reload) location.reload();
						return;
					}

					// Update preset (current world only)
					if (action === "update") {
						if (!picked) { ui.notifications.warn(`${LT.warnUpdatePreset()}.`); return; }

						if (picked.worldId !== wid) {
							ui.notifications.warn("That preset belongs to a different world. Switch to that world to update it.");
							DL(2, "module-presets.js | update blocked (cross-world)", {
								currentWorld: wid,
								targetWorld: picked.worldId,
								name: picked.name
							});
							return;
						}

						const enabled = hlp_getEnabledModuleIds();
						DL("module-presets.js | update: collected enabled module ids", { count: enabled.length, target: picked.name });

						const res = await hlp_savePreset(picked.name, enabled);
						if (res?.status !== "saved") return;

						ui.notifications.info(`${LT.updatedSummary({ name: picked.name, count: enabled.length })}.`);

						app.close();
						openPresetManager();
						return;
					}

					// Delete preset (current world only)
					if (action === "delete") {
						if (!picked) return ui.notifications.warn(`${LT.warnSelectPresetDelete()}.`);

						if (picked.worldId !== wid) {
							ui.notifications.warn("That preset belongs to a different world. Switch to that world to delete it.");
							DL(2, "module-presets.js | delete blocked (cross-world)", {
								currentWorld: wid,
								targetWorld: picked.worldId,
								name: picked.name
							});
							return;
						}

						const ok = await foundry.applications.api.DialogV2.confirm({
							window: { title: LT.titleDeleteModulePreset() },
							content: `<p>${LT.promptDeleteModulePreset()} <b>${hlp_esc(picked.name)}</b>?</p>`,
							ok: { label: LT.buttons.delete() }
						});
						if (!ok) return;

						const p = hlp_getPresets();
						delete p[picked.name];
						await hlp_setPresets(p);

						ui.notifications.info(`${LT.deletedPreset()} "${picked.name}".`);
						app.close();
						openPresetManager();
						return;
					}

					// Export current enabled modules to JSON file
					if (action === "bbmm-export-state") {
						DL("module-presets.js | export-current: starting");
						exportCurrentModuleStateDialog();
						return;
					}

					// Import module state JSON file
					if (action === "bbmm-import-state") {
						DL("module-presets.js | import-current: starting");
						importModuleStateDialog();
						return;
					}
				} catch (err) {
					DL(3, "module-presets.js | openPresetManager(): click handler error", {
						name: err?.name, message: err?.message, stack: err?.stack
					});
					ui.notifications.error(`${LT.errors.errorOccured()}.`);
				}
			});
		};
		Hooks.on("renderDialogV2", onRender);

		// Render
		dlg.render(true);
	})();
}

Hooks.once("ready", async () => {
	// load presets into cache
	await hlp_loadPresets();

	window.openPresetManager = openPresetManager; 
	const mod = game.modules.get("bbmm");
	if (!mod) return;
	mod.api ??= {};
	mod.api.openPresetManager = openPresetManager;
	DL("module-presets.js | API exposed: mod.api.openPresetManager ready");
});

Hooks.on("setup", () => DL("module-presets.js | setup fired"));
Hooks.once("ready", () => DL("module-presets.js | ready fired"));