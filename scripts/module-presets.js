import { DL, BBMM_README_UUID } from './settings.js';
import { hlp_esc, hlp_timestampStr, hlp_saveJSONFile, hlp_pickLocalJSONFile, hlp_normalizePresetName, hlp_injectHeaderHelpButton } from './helpers.js';
import { LT, BBMM_ID } from "./localization.js";
const MODULE_SETTING_PRESETS = "modulePresetsUser";  // { [name]: string[] }  enabled module ids

/*	===============================================
	HELPERS 
================================================ */

const MODULE_PRESETS_STORAGE_DIR = "presets";
const MODULE_PRESETS_STORAGE_FILE = "module-presets.json";
let _presetCache = null;

// Load presets from persistent storage into _presetCache
export async function hlp_loadPresets() {
	try {
		DL("module-presets.js | hlp_loadPresets(): loading presets from persistent storage");

		const data = await hlp_readPresetsFromStorage();

		if (!data || typeof data !== "object") {
			_presetCache = {};
			DL("module-presets.js | hlp_loadPresets(): no presets found, using empty cache");
			return;
		}

		// Ensure flat map: { presetName: [moduleIds] }
		const clean = {};
		for (const [name, modules] of Object.entries(data)) {
			if (!name || !Array.isArray(modules)) continue;
			clean[name] = modules.filter(m => typeof m === "string");
		}

		_presetCache = clean;

		DL("module-presets.js | hlp_loadPresets(): presets loaded", {
			count: Object.keys(_presetCache).length
		});
	} catch (err) {
		_presetCache = {};
		DL(3, "module-presets.js | hlp_loadPresets(): FAILED, using empty cache", err);
	}
}

// get list of presets
function hlp_getPresets() {
	if (_presetCache === null) {
		DL("module-presets.js | hlp_getPresets(): cache not loaded yet, returning empty map");
		return {};
	}
	return foundry.utils.duplicate(_presetCache || {});
}

// set preset map
async function hlp_setPresets(presets) {
	const clean = hlp_sanitizePresetMap(presets);
	_presetCache = clean;

	const ok = await hlp_writePresetsToStorage(clean);
	if (!ok) {
		ui.notifications.warn("Failed to write module presets to persistent storage.");
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

// fetch JSON from URL with no-cache
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

// Ensure storage root has expected shape
async function hlp_readPresetsFromStorage() {
	// Try browse first (optional convenience)
	try {
		const dir = `modules/${BBMM_ID}/storage/presets`;
		const browse = await FilePicker.browse("data", dir, { extensions: ["json"] });

		const match = (browse?.files || []).find(f => String(f).endsWith(`/${MODULE_PRESETS_STORAGE_FILE}`));
		if (match) {
			const data = await hlp_fetchJSON(match);
			return hlp_sanitizePresetMap(data);
		}
	} catch (err) {
		const msg = String(err?.message ?? err);

		// Folder missing is normal on first run if it wasn't shipped
		if (msg.includes("does not exist") || msg.includes("not accessible")) {
			DL("module-presets.js | hlp_readPresetsFromStorage(): presets folder not found yet, will try fallback");
		} else {
			DL(2, "module-presets.js | hlp_readPresetsFromStorage(): browse failed unexpectedly", err);
		}
	}

	// Direct fetch fallback
	try {
		const url = `modules/${BBMM_ID}/storage/presets/${MODULE_PRESETS_STORAGE_FILE}`;
		const data = await hlp_fetchJSON(url);
		return hlp_sanitizePresetMap(data);
	} catch (_err2) {
		return {};
	}
}

// Sanitize storage root shape
async function hlp_writePresetsToStorage(presets) {
	const clean = hlp_sanitizePresetMap(presets);

	const payload = JSON.stringify(clean ?? {}, null, 2);
	const file = new File([payload], MODULE_PRESETS_STORAGE_FILE, { type: "application/json" });

	try {
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

// Check if modules in preset are missing or have missing dependencies
function hlp_validateModuleState(modIds) {
	const unknown = [];			// { id, reason: "not installed" }
	const depIssues = [];		// { id, depId, reason: "dependency missing" }

	for (const id of modIds) {
		if (!game.modules.has(id)) unknown.push({ id, reason: LT.errors.notInstalled() });
	}

	for (const id of modIds) {
		const mod = game.modules.get(id);
		if (!mod) continue;
		const requires = hlp_getRequiredIds(mod);
		for (const depId of requires) {
			if (!game.modules.has(depId)) {
				depIssues.push({ id, depId, reason: LT.errors.depMissing() });
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

// Slugify string for filenames
function hlp_slugify(s) {
	return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
				submit: (_res, _ev, button) => resolve(button?.action === "ok")
			}).render(true);
		});
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
	await displayIssues(lines);
	return;
		
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
	DL("module-presets.js | openPresetManager: start");

	// Make sure the in-memory cache is populated before we build the list
	await hlp_loadPresets();

	// Build list and index of presets
	async function hlp_buildPresetList() {
		// This populates _presetCache but DOES NOT return the presets map.
		await hlp_loadPresets();

		// Always build from the cache
		const map = hlp_getPresets();

		/**	Build list of presets 
		 * @type {Array<{ id: string, name: string, displayName: string, modules: string[] }>} 
		*/
		const list = [];

		for (const [name, modules] of Object.entries(map)) {
			if (!name || !Array.isArray(modules)) continue;

			list.push({
				id: name,
				name,
				displayName: name,
				modules: modules.filter(x => typeof x === "string")
			});
		}

		// Sort alphabetically
		list.sort((a, b) => a.name.localeCompare(b.name));

		/** Build index of presets by id
		 * @type {Record<string, { id: string, name: string, displayName: string, modules: string[] }>} 
		*/
		const index = {};
		for (const p of list) index[p.id] = p;

		return { list, index };
	}

	(async () => {
		const { list, index } = await hlp_buildPresetList();

		DL("module-presets.js | openPresetManager: presets loaded", {
			count: list.length
		});

		const options = list
			.map(p => `<option value="${hlp_esc(p.id)}">${hlp_esc(p.displayName)}</option>`)
			.join("");

		// Dialog content
		const content = `
			<div style="min-width:520px;display:flex;flex-direction:column;gap:.75rem;">

				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:10rem;">${LT.savedPresets()}</label>
					<select name="presetName" style="flex:1;">${options}</select>
					<button type="button" data-action="load">${LT.buttons.load()}</button>
					<button type="button" data-action="update">${LT.buttons.update()}</button>
					<button type="button" data-action="rename">${LT.errors.rename()}</button>
					<button type="button" data-action="delete">${LT.buttons.delete()}</button>
				</div>

				<hr>
				<p>${LT.presetSaveCurrentModules()}:</p>
				<div style="display:flex;gap:.5rem;align-items:center;">
					<input name="newName" type="text" placeholder="${LT.newPresetName()}…" style="flex:1;">
					<button type="button" data-action="save-current">${LT.buttons.saveCurrent()}</button>
				</div>
			</div>
		`;

		const dlg = new foundry.applications.api.DialogV2({
			window: { title: LT.modulePresets() },
			content,
			buttons: [{ action: "close", label: LT.buttons.close(), default: true }]
		});

		const onRender = (app) => {
			if (app !== dlg) return;
			Hooks.off("renderDialogV2", onRender);

			DL("module-presets.js | renderDialogV2 fired for Preset Manager");

			const form = app.element?.querySelector("form");
			if (!form) { DL(2, "module-presets.js | openPresetManager(): form not found"); return; }

			// Inject help button into title bar
			try {
				hlp_injectHeaderHelpButton(app, {
					uuid: BBMM_README_UUID,
					iconClass: "fas fa-circle-question",
					title: LT.buttons.help?.() ?? "Help"
				});
			} catch (e) {
				DL(2, `module-presets.js | help injection failed`, e);
			}

			form.querySelectorAll('button[data-action]').forEach(b => b.setAttribute("type", "button"));

			form.addEventListener("click", async (ev) => {
				const btn = ev.target;
				if (!(btn instanceof HTMLButtonElement)) return;

				const action = btn.dataset.action || "";
				if (!["load", "update", "rename", "delete", "save-current"].includes(action)) return;

				// Prevent normal button form submission
				ev.preventDefault();
				ev.stopPropagation();
				ev.stopImmediatePropagation();

				try {
					const sel = form.elements.namedItem("presetName");
					const selectedId = sel ? String(sel.value || "") : "";
					const picked = selectedId ? index[selectedId] : null;

					// Save current enabled modules as new preset
					if (action === "save-current") {
						const raw = form.elements.namedItem("newName")?.value ?? "";
						const newName = String(raw).trim();
						if (!newName) return ui.notifications.warn(`${LT.warnEnterName()}.`);

						const enabled = hlp_getEnabledModuleIds();
						DL("module-presets.js | save-current: collected enabled module ids", { count: enabled.length });

						const res = await hlp_savePreset(newName, enabled);
						if (res?.status !== "saved") return;

						ui.notifications.info(`${LT.savedSummary({ name: res.name, count: enabled.length })}.`);
						app.close();
						openPresetManager();
						return;
					}

					// Import module state from JSON file
					if (action === "load") {
						if (!picked) return ui.notifications.warn(LT.selectPreset());

						const enabled = picked.modules || [];
						DL("module-presets.js | load: applying preset", { name: picked.name, count: enabled.length });

						const proceed = await foundry.applications.api.DialogV2.confirm({
							window: { title: LT.titleApplyModulePreset() },
							content: `<p>${LT.promptApplyModulePreset({ name: hlp_esc(picked.displayName) })}?</p>`,
							modal: true,
							ok: { label: LT.buttons.apply() }
						});
						if (!proceed) return;

						// Validate missing modules/dependencies before applying
						const { unknown, depIssues } = hlp_validateModuleState(enabled);
						if (unknown.length || depIssues.length) {
							await showImportIssuesDialog({ unknown, depIssues });
						}

						await applyEnabledIds(enabled, { autoEnableDeps: true });

						const reload = await foundry.applications.api.DialogV2.confirm({
							window: { title: LT.titleReloadFoundry() },
							content: `<p>${LT.promptReloadNow()}</p>`,
							ok: { label: LT.buttons.reload() }
						});
						if (reload) location.reload();
						return;
					}

					// Update preset
					if (action === "update") {
						if (!picked) return ui.notifications.warn(`${LT.warnUpdatePreset()}.`);

						const enabled = hlp_getEnabledModuleIds();
						DL("module-presets.js | update: collected enabled module ids", { count: enabled.length, target: picked.name });

						const res = await hlp_savePreset(picked.name, enabled);
						if (res?.status !== "saved") return;

						ui.notifications.info(`${LT.updatedSummary({ name: picked.name, count: enabled.length })}.`);
						app.close();
						openPresetManager();
						return;
					}

					// Rename preset (NO saving current module state)
					if (action === "rename") {
						if (!picked) return ui.notifications.warn(LT.selectPreset());

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

						// Rename preset prompt
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
										{
											action: "ok",
											label: LT.buttons.save(),
											default: true,
											callback: (_ev, btn) => resolve(btn.form.elements.newName?.value?.trim() || "")
										},
										{ action: "cancel", label: LT.buttons.cancel(), callback: () => resolve(null) }
									],
									submit: () => {},
									rejectClose: false
								}).render(true);
							});
						}

						const presets = hlp_getPresets();
						const oldKey = picked.name;
						const oldModules = Array.isArray(presets[oldKey]) ? presets[oldKey] : [];

						let finalName = null;
						let attemptName = await promptRename(oldKey);
						if (!attemptName) return;

						while (true) {
							const wanted = String(attemptName).trim();
							if (!wanted) return;

							// Find existing key by normalized compare (case-insensitive-ish)
							const wantedNorm = hlp_normalizePresetName(wanted);
							let existingKey = null;

							for (const k of Object.keys(presets)) {
								if (hlp_normalizePresetName(k) === wantedNorm) { existingKey = k; break; }
							}

							// If it's the same preset (including casing changes), accept it
							if (!existingKey || existingKey === oldKey) {
								finalName = wanted;
								break;
							}

							// Name conflict with a different preset
							const choice = await askPresetConflict(existingKey);
							if (choice === "cancel") return;

							if (choice === "overwrite") {
								// Overwrite the existingKey entry, and remove the oldKey entry
								finalName = existingKey;
								break;
							}

							// Rename again
							attemptName = await promptRename(wanted);
							if (!attemptName) return;
						}

						// Apply rename
						if (!finalName) return;

						// If overwrite chose existingKey, we keep that key and replace its value
						presets[finalName] = oldModules;
						if (oldKey !== finalName) delete presets[oldKey];

						await hlp_setPresets(presets);

						ui.notifications.info(`${LT.renamePreset()}: "${oldKey}" -> "${finalName}".`);
						app.close();
						openPresetManager();
						return;
					}


					// Delete preset
					if (action === "delete") {
						if (!picked) return ui.notifications.warn(`${LT.warnSelectPresetDelete()}.`);

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

				} catch (err) {
					DL(3, "module-presets.js | openPresetManager(): click handler error", {
						name: err?.name, message: err?.message, stack: err?.stack
					});
					ui.notifications.error(`${LT.errors.errorOccured()}.`);
				}
			});
		};

		Hooks.on("renderDialogV2", onRender);
		dlg.render(true);
	})();
}

Hooks.once("ready", async () => {
	// load presets into cache
	await hlp_loadPresets();

	// expose API
	window.openPresetManager = openPresetManager; 
	const mod = game.modules.get("bbmm");
	if (!mod) return;
	mod.api ??= {};
	mod.api.openPresetManager = openPresetManager;
	DL("module-presets.js | API exposed: mod.api.openPresetManager ready");
});

Hooks.on("setup", () => DL("module-presets.js | setup fired"));
Hooks.once("ready", () => DL("module-presets.js | ready fired"));