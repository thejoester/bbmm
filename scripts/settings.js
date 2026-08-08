import { openPresetManager } from './module-presets.js';
import { openSettingsPresetManager, openPlayerSettingsPresetManager, svc_loadSettingsPresets, svc_loadPlayerSettingsPresets, svc_setPlayerSettingsPresets } from './settings-presets.js';
import { LT, BBMM_ID } from "./localization.js";
import { openInclusionsManagerApp, hlp_readUserInclusions } from "./inclusions.js";
import { hlp_readUserExclusions } from "./exclusions.js";
import { 
	hlp_openManualByUuid, 
	hlp_injectHeaderHelpButton, 
	hlp_saveJSONFile, 
	hlp_pickLocalJSONFile, 
	bbmm_exportSettingsPresetsAll, 
	bbmm_importSettingsPresetsAll, 
	bbmm_exportModulePresetsAll, 
	bbmm_importModulePresetsAll, 
	hlp_esc 
} from "./helpers.js";

export const MODULE_SETTING_PRESETS_U = "modulePresetsUser";  
export const SETTING_SETTINGS_PRESETS_U = "settingsPresetsUser"; 
export const BBMM_README_UUID = "Compendium.bbmm.bbmm-journal.JournalEntry.HlNgBs29jBCBnzbP";

/* Controls Sync Globals ======================================================*/
export const CTRL_STORE_KEY = "userControlSync";				// world: { [id]: {rev, lock?, soft?} }
export const CTRL_REV_STORE = "softLockRevMap_controls";		// world: { [id]: number }
export const CTRL_TOGGLE = "enableControlSync";					// world: boolean

// folder name for compendium organization
const BBMM_COMP_FOLDER_NAME = "Big Bad Module Manager";

/* Remote Messages ============================================================*/
const BBMM_MESSAGE_FEED_URL = "https://raw.githubusercontent.com/thejoester/bbmm/main/bbmm-messages.json"; 

// Do not export these settings
export const EXPORT_SKIP = new Map([
	["bbmm", new Set(["settingsPresetsUser", "modulePresetsUser"])],
	["core", new Set(["moduleConfiguration", "compendiumConfiguration", "time"])],	
	["pf2e-alchemist-remaster-ducttape", new Set(["alchIndex"])] // Known large set, excluding for performance
]);

//	Function for debugging - Prints out colored and tagged debug lines
export function DL(intLogType, stringLogMsg, objObject = null) {
	
	// Get Timestamps
	const now = new Date();
	const timestamp = now.toTimeString().split(' ')[0]; // "HH:MM:SS"
	
	// Handle the case where the first argument is a string
	if (typeof intLogType === "string") {
		objObject = stringLogMsg; // Shift arguments
		stringLogMsg = intLogType;
		intLogType = 1; // Default log type to 'all'
	}
	let debugLevel = "all"; // default until setting exists
	try {
		// Only read after it’s registered
		if (game?.settings?.settings?.has?.(`${BBMM_ID}.debugLevel`)) {
			debugLevel = game.settings.get(BBMM_ID, "debugLevel");
		}
	} catch (e) {
		// Swallow: setting not registered yet
	}

	// Map debugLevel setting to numeric value for comparison
	const levelMap = {
		"none": 4,
		"error": 3,
		"warn": 2,
		"all": 1
	};

	const currentLevel = levelMap[debugLevel] || 4; // Default to 'none' if debugLevel is undefined

	// Check if the log type should be logged based on the current debug level
	if (intLogType < currentLevel) return;

	// Capture stack trace to get file and line number
	const stack = new Error().stack.split("\n");
	let fileInfo = "";
	for (let i = 2; i < stack.length; i++) {
		const line = stack[i].trim();
		const fileInfoMatch = line.match(/(\/[^)]+):(\d+):(\d+)/); // Match file path and line number
		if (fileInfoMatch) {
			const [, filePath, lineNumber] = fileInfoMatch;
			const fileName = filePath.split("/").pop(); // Extract just the file name
		}
	}

	// Prepend the file and line info to the log message
	const formattedLogMsg = fileInfo === ""
		? stringLogMsg
		: `[${fileInfo}] ${stringLogMsg}`;
	
	if (objObject) {
		switch (intLogType) {
			case 1: // Info/Log (all)
				console.log(`%cBBMM [${timestamp}] | ${formattedLogMsg}`, "color: LightGreen; font-weight: bold;", objObject);
				break;
			case 2: // Warning
				console.log(`%cBBMM [${timestamp}] | WARNING: ${formattedLogMsg}`, "color: orange; font-weight: bold;", objObject);
				break;
			case 3: // Critical/Error
				console.log(`%cBBMM [${timestamp}] | ERROR: ${formattedLogMsg}`, "color: red; font-weight: bold;", objObject);
				break;
			default:
				console.log(`%cBBMM [${timestamp}] | ${formattedLogMsg}`, "color: aqua; font-weight: bold;", objObject);
		}
	} else {
		switch (intLogType) {
			case 1: // Info/Log (all)
				console.log(`%cBBMM [${timestamp}] | ${formattedLogMsg}`, "color: LightGreen; font-weight: bold;");
				break;
			case 2: // Warning
				console.log(`%cBBMM [${timestamp}] | WARNING: ${formattedLogMsg}`, "color: orange; font-weight: bold;");
				break;
			case 3: // Critical/Error
				console.log(`%cBBMM [${timestamp}] | ERROR: ${formattedLogMsg}`, "color: red; font-weight: bold;");
				break;
			default:
				console.log(`%cBBMM [${timestamp}] | ${formattedLogMsg}`, "color: aqua; font-weight: bold;");
		}
	}
}

// Check folder migration for compendiums and move packs if needed
async function checkFolderMigration(){
	if (!game.user.isGM) return; // GM only

	const BBMM_PACK_NAMES = [
		"bbmm-macros",
		"bbmm-journal"
	];

	// Get the full migrations object (always returns an object).
	function getMigrations() {
		const obj = game.settings.get(BBMM_ID, "bbmmFlags");
		return obj && typeof obj === "object" ? { ...obj } : {};
	}

	// Set/merge a single flag without clobbering others.
	async function setMigrationFlag(key, value) {
		const current = getMigrations();
		current[key] = value;
		await game.settings.set(BBMM_ID, "bbmmFlags", current);
	}

	/** Check a flag; falsy if missing. */
	function hasMigrationFlag(key) {
		const current = getMigrations();
		return Boolean(current[key]);
	}

	if (hasMigrationFlag("folderMigration")) return; // we already migrated

	try {
		let folder = game.folders.find((f) => f.type === "Compendium" && f.name === BBMM_COMP_FOLDER_NAME);
		// If folder doesn't exist create it
		if (!folder) { 
			folder = await Folder.create({ name: BBMM_COMP_FOLDER_NAME, type: "Compendium", sorting: "a" });
			DL("settings.js | Created compendium folder:", BBMM_COMP_FOLDER_NAME, folder?.id);
		}

		// move packs into folder
		for (const name of BBMM_PACK_NAMES) {
			const cid = `${BBMM_ID}.${name}`;
			const pack = game.packs.get(cid);
			if (!pack) { DL("settings.js | Pack not found, skipping:", cid); continue; }
			await pack.configure({ folder: folder.id });
			DL("settings.js | Moved pack into folder:", cid, "→", BBMM_COMP_FOLDER_NAME);
		}

		// update flag
		await setMigrationFlag("folderMigration", true);
		ui.compendium.render(true);
		DL("settings.js | Compendium folder migration complete.");
	} catch (err) {
		DL(3, "settings.js | Compendium folder migration failed:", err?.message ?? err);
	}
}

// Section headers for the BBMM settings tab (targets regular settings only, not menus)
const SETTINGS_SECTIONS = [
	{ header: "Changelogs",        firstKey: "showChangelogsOnLogin" },
	{ header: "Module Management", firstKey: "enableModuleManagement" },
	{ header: "Sync",              firstKey: "enableUserSettingSync" },
	{ header: "Advanced",          firstKey: "autoForceReload" },
];

function injectSettingsSectionHeaders(html) {
	const tab = html.querySelector(`[data-tab="bbmm"][data-category="bbmm"]`);
	if (!tab) return;

	for (const { header, firstKey } of SETTINGS_SECTIONS) {
		const firstEl = tab.querySelector(`[name="bbmm.${firstKey}"]`);
		const formGroup = firstEl?.closest(".form-group");
		if (!formGroup) {
			DL(1, `settings.js | injectSettingsSectionHeaders: no form-group found for "${firstKey}", skipping`);
			continue;
		}
		const h = document.createElement("h3");
		h.textContent = header;
		h.classList.add("bbmm-settings-header");
		formGroup.before(h);
	}
}

//  Inject BBMM button into a Foundry window header
export function injectBBMMHeaderButton(root) {
	
	// if (!game.user.isGM) return;
	
	// Resolve the root element (jQuery or HTMLElement)
	root = root instanceof HTMLElement ? root : (root?.[0] ?? null);
	if (!root) {
		DL(2, "settings.js | BBMM header injection: no root element found");
		return;
	}

	// Find header and its controls bucket
	const header = root.querySelector("header.window-header");
	if (!header) {
		DL(2, "settings.js | BBMM header injection: no header found");
		return;
	}
	const controls = header.querySelector(".window-controls") || header;

	// Prevent duplicate header menu
	if (controls.querySelector(".bbmm-header-menu-btn")) return;

	// Single direct opener for the BBMM Toolbox (no dropdown). Changelog Files
	// and Import/Export live in the Configure Settings menu buttons.
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "header-control bbmm-header-menu-btn";
	btn.setAttribute("aria-label", LT.buttons.bbmmBtnToolTip());
	btn.innerHTML = `<i class="fa-solid fa-layer-group"></i><span>BBMM</span>`;

	btn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		try {
			globalThis.bbmm?.openBBMMToolbox?.();
		} catch (e) {
			DL(3, "settings.js | BBMM header button: failed to open toolbox", e);
		}
	});

	// Insert before the Close button if present
	const closeBtn = controls.querySelector('button.header-control[data-action="close"]');
	if (closeBtn) controls.insertBefore(btn, closeBtn);
	else controls.appendChild(btn);

	// Minimal style (inject once)
	if (!document.getElementById("bbmm-header-style")) {
		const style = document.createElement("style");
		style.id = "bbmm-header-style";
		style.textContent = `
			header.window-header .header-control.bbmm-header-menu-btn {
				display: inline-flex;
				align-items: center;
				gap: 0.5rem;
				white-space: nowrap;
				padding-inline: 0.6rem;
				font-size: 0.95rem;
			}
			header.window-header .header-control.bbmm-header-menu-btn i {
				font-size: 0.9em;
			}
		`;
		document.head.appendChild(style);
	}

	DL("settings.js | BBMM header toolbox button injected");
}

// Open Exclusions Manager
export function openExclusionsManager() {
	// Wrapper that calls the actual app launcher if present
	DL("settings.js | openExclusionsManager(): fired");
	try {
		const fn = globalThis.bbmm?.openExclusionsManagerApp ?? globalThis.openExclusionsManagerApp;
		if (typeof fn === "function") return fn();
		DL(3, "settings.js | openExclusionsManager(): launcher not found");
	ui.notifications?.warn(LT?.exclusionsNotAvailable?.() ?? `${LT.errors.exclusionsMgrNotFound()}.`);
	} catch (e) {
		DL(3, "settings.js | openExclusionsManager(): error", e);
	}
}

// Open Changelog Filename Manager
export function openChangelogFilesManager() {
	DL("settings.js | openChangelogFilesManager(): fired");
	try {
		const fn = globalThis.bbmm?.openChangelogFilesManager;
		if (typeof fn === "function") return fn();
		DL(3, "settings.js | openChangelogFilesManager(): launcher not found");
	} catch (e) {
		DL(3, "settings.js | openChangelogFilesManager(): error", e);
	}
}

// Open Lock Preset manager
function openLockPresetManager() {
	DL("settings.js | openLockPresetManager(): fired");
	try {
		const fn = globalThis.bbmm?.openLockPresetManager;
		if (typeof fn === "function") return fn();
		DL(3, "settings.js | openLockPresetManager(): launcher not found");
	} catch (err) {
		DL(3, "settings.js | openLockPresetManager(): failed", err);
	}
}

// Open Tag Manager dialog
export function openTagManager() {
	DL("settings.js | openTagManager(): fired");
	try {
		const fn = globalThis.bbmm?.openTagManager;
		if (typeof fn === "function") return fn();
		DL(3, "settings.js | openTagManager(): launcher not found on globalThis.bbmm");
	} catch (e) {
		DL(3, "settings.js | openTagManager(): error", e);
	}
}

// Back-compat: the old launcher dialog is replaced by the BBMM Toolbox.
// Kept as a thin opener so existing macros / window.openBBMMLauncher references work.
export async function openBBMMLauncher() {
	DL("settings.js | openBBMMLauncher(): deep-link to toolbox");
	globalThis.bbmm?.openBBMMToolbox?.();
}

// BBMM Import / Export Dialog
// Import / Export content (was the BBMMImportExportDialog constructor content).
function _ie_contentHTML() {
	return `
				<div style="display:flex;flex-direction:column;gap:.75rem;">
					${game.user.isGM ? `
					<div style="display:flex;align-items:center;gap:.75rem;">
						<div style="min-width:160px;font-weight:700;">${LT.modulePresetsBtn()}:</div>
						<div style="display:flex;gap:.5rem;">
							<button type="button" data-action="bbmm-mod-import" style="width:auto;">${LT.buttons.import()}</button>
							<button type="button" data-action="bbmm-mod-export" style="width:auto;">${LT.buttons.export()}</button>
						</div>
					</div>

					<div style="display:flex;align-items:center;gap:.75rem;">
						<div style="min-width:160px;font-weight:700;">Module Tags:</div>
						<div style="display:flex;gap:.5rem;">
							<button type="button" data-action="bbmm-tags-import" style="width:auto;">${LT.buttons.import()}</button>
							<button type="button" data-action="bbmm-tags-export" style="width:auto;">${LT.buttons.export()}</button>
						</div>
					</div>

					<div style="display:flex;align-items:center;gap:.75rem;">
						<div style="min-width:160px;font-weight:700;">${LT.inclusions.manager()} / ${LT.exclusions()}:</div>
						<div style="display:flex;gap:.5rem;">
							<button type="button" data-action="bbmm-inc-import" style="width:auto;">${LT.buttons.import()}</button>
							<button type="button" data-action="bbmm-inc-export" style="width:auto;">${LT.buttons.export()}</button>
						</div>
					</div>

					<div style="display:flex;align-items:center;gap:.75rem;">
						<div style="min-width:160px;font-weight:700;">${LT.lockPresetsBtn()}:</div>
						<div style="display:flex;gap:.5rem;">
							<button type="button" data-action="bbmm-lock-import" style="width:auto;">${LT.buttons.import()}</button>
							<button type="button" data-action="bbmm-lock-export" style="width:auto;">${LT.buttons.export()}</button>
						</div>
					</div>
					` : ``}

					<div style="display:flex;align-items:center;gap:.75rem;">
						<div style="min-width:160px;font-weight:700;">${LT.settingsPresetsBtn()}:</div>
						<div style="display:flex;gap:.5rem;">
							<button type="button" data-action="bbmm-set-import" style="width:auto;">${LT.buttons.import()}</button>
							<button type="button" data-action="bbmm-set-export" style="width:auto;">${LT.buttons.export()}</button>
						</div>
					</div>

					<div style="display:flex;align-items:center;gap:.75rem;">
						<div style="min-width:160px;font-weight:700;">Keybindings:</div>
						<div style="display:flex;gap:.5rem;">
							<button type="button" data-action="bbmm-kb-import" style="width:auto;">${LT.buttons.import()}</button>
							<button type="button" data-action="bbmm-kb-export" style="width:auto;">${LT.buttons.export()}</button>
						</div>
					</div>
				</div>
	`;
}

// Delegated click wiring for the Import/Export pane (was _onRender's handler).
function _ie_wire(container) {
	if (container.dataset.bbmmIeBound === "1") return;
	container.dataset.bbmmIeBound = "1";

	container.addEventListener("click", async (ev) => {
			const btn = ev.target?.closest?.("button[data-action]");
			if (!btn) return;

			const action = btn.dataset.action;

			try {
				// Module Preset Export
				if (action === "bbmm-mod-export") {
					const FN = "settings.js | BBMMImportExportDialog._onRender(): module preset export chooser:";
					try {
						const url = `bbmm-data/module-presets.json`;
						const res = await fetch(url, { cache: "no-store" });
						if (!res.ok) {
							DL(3, `${FN} fetch not ok`, { url, status: res.status });
							ui.notifications.error(LT.errors.failedReadModulePreset());
							return;
						}

						const presets = await res.json();
						const names = Object.keys(presets ?? {}).sort((a, b) => a.localeCompare(b));

						const options =
							`<option value="__all">${LT._importExport.allPresets()}</option>` +
							names.map(n => `<option value="${hlp_esc(n)}">${hlp_esc(n)}</option>`).join("");

						const pick = await new Promise((resolve) => {
							const dlg = new foundry.applications.api.DialogV2({
								window: { title: LT._importExport.exportModulePreset() },
								content: `
									<form>
										<div style="display:flex;flex-direction:column;gap:.5rem;">
											<label style="font-weight:700;">${LT._importExport.whichPreset()}?</label>
											<select name="preset" style="width:100%;">
												${options}
											</select>
										</div>
									</form>
								`,
								buttons: [
									{ action: "export", label: LT.buttons.export(), default: true },
									{ action: "cancel", label: LT.buttons.cancel() }
								],
								submit: (res) => {
									const val = dlg.element?.querySelector('select[name="preset"]')?.value ?? "__all";
									resolve({ action: res ?? "cancel", preset: val });
								},
								rejectClose: false,
								position: { width: 420, height: "auto" }
							});
							dlg.render(true);
						});

						if (!pick || pick.action !== "export") return;

						// All presets → existing behavior
						if (pick.preset === "__all") {
							await bbmm_exportModulePresetsAll();
							return;
						}

						// Single preset export
						const presetName = pick.preset;
						const one = presets?.[presetName];

						if (!Array.isArray(one)) {
							DL(3, `${FN} selected preset missing/invalid`, { presetName });
							ui.notifications.error(LT.errors.selectedPresetNotFound());
							return;
						}

						const d = new Date();
						const pad = (n) => String(n).padStart(2, "0");
						const safeName = presetName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
						const fname = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-bbmm-module-preset-${safeName}.json`;

						await hlp_saveJSONFile({ [presetName]: one }, fname);
						ui.notifications.info(LT._importExport.exportedModulePreset());
						DL(1, `${FN} exported single preset`, { presetName, fname });

					} catch (err) {
						DL(3, `${FN} failed`, err);
						ui.notifications.error(LT.errors.importExportFailed());
					}
					return;
				}
				// Module Preset Import
				if (action === "bbmm-mod-import") return await bbmm_importModulePresetsAll();
				// Settings Preset Export
				if (action === "bbmm-set-export") {
					const FN = "settings.js | BBMMImportExportDialog._onRender(): settings preset export chooser:";
					try {
						// GM reads from file storage; player reads from user-scoped setting
						let presets;
						if (game.user.isGM) {
							const url = `bbmm-data/settings-presets.json`;
							const res = await fetch(url, { cache: "no-store" });
							if (!res.ok) {
								DL(3, `${FN} fetch not ok`, { url, status: res.status });
								ui.notifications.error(LT.errors.failedReadSettingsPreset());
								return;
							}
							presets = await res.json();
						} else {
							presets = await svc_loadPlayerSettingsPresets({ force: true });
						}

						const names = Object.keys(presets ?? {}).sort((a, b) => a.localeCompare(b));

						const options =
							`<option value="__all">${LT._importExport.allPresets()}</option>` +
							names.map(n => `<option value="${hlp_esc(n)}">${hlp_esc(n)}</option>`).join("");

						const pick = await new Promise((resolve) => {
							const dlg = new foundry.applications.api.DialogV2({
								window: { title: LT._importExport.exportSettingsPreset() },
								content: `
									<form>
										<div style="display:flex;flex-direction:column;gap:.5rem;">
											<label style="font-weight:700;">${LT._importExport.whichPreset()}?</label>
											<select name="preset" style="width:100%;">
												${options}
											</select>
										</div>
									</form>
								`,
								buttons: [
									{ action: "export", label: LT.buttons.export(), default: true },
									{ action: "cancel", label: LT.buttons.cancel() }
								],
								submit: (res) => {
									const val = dlg.element?.querySelector('select[name="preset"]')?.value ?? "__all";
									resolve({ action: res ?? "cancel", preset: val });
								},
								rejectClose: false,
								position: { width: 420, height: "auto" }
							});
							dlg.render(true);
						});

						if (!pick || pick.action !== "export") return;

						// All presets
						if (pick.preset === "__all") {
							if (game.user.isGM) {
								await bbmm_exportSettingsPresetsAll();
							} else {
								const d = new Date();
								const pad = (n) => String(n).padStart(2, "0");
								const fname = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-bbmm-settings-presets.json`;
								await hlp_saveJSONFile(presets ?? {}, fname);
								ui.notifications.info(LT._importExport.exportedSettingsPreset());
								DL(1, `${FN} exported all player presets`, { fname });
							}
							return;
						}

						// Single preset export
						const presetName = pick.preset;
						const oneRaw = presets?.[presetName];

						if (!oneRaw || typeof oneRaw !== "object") {
							DL(3, `${FN} selected preset missing/invalid`, { presetName });
							ui.notifications.error(LT.errors.selectedPresetNotFound());
							return;
						}

						let one = oneRaw;

						// If the preset is in the OLD FORMAT, convert it before exporting
						// OLD FORMAT: { created, updated, items:[{ namespace,key,value,scope }] }
						if (Array.isArray(oneRaw.items)) {
							const out = {
								type: "bbmm-settings",
								created: null,
								world: {},
								client: {},
								user: {}
							};

							const createdVal = oneRaw.created ?? oneRaw.updated ?? Date.now();
							if (typeof createdVal === "number") out.created = new Date(createdVal).toISOString();
							else if (typeof createdVal === "string" && createdVal.trim()) out.created = createdVal.trim();
							else out.created = new Date().toISOString();

							for (const it of oneRaw.items) {
								const ns = it?.namespace;
								const key = it?.key;
								if (!ns || !key) continue;

								const scope = String(it?.scope || "world").toLowerCase();
								const bucket = (scope === "world" || scope === "client" || scope === "user") ? scope : "world";

								if (!out[bucket][ns]) out[bucket][ns] = {};
								out[bucket][ns][key] = it?.value;
							}

							one = out;
						} else {
							// Ensure expected envelope fields exist for export sanity
							const hasBuckets = oneRaw.world && oneRaw.client && oneRaw.user
								&& typeof oneRaw.world === "object"
								&& typeof oneRaw.client === "object"
								&& typeof oneRaw.user === "object";

							if (hasBuckets && oneRaw.type !== "bbmm-settings") one = { ...oneRaw, type: "bbmm-settings" };
							if (hasBuckets && !one?.created) one = { ...one, created: new Date().toISOString() };
						}

						const d = new Date();
						const pad = (n) => String(n).padStart(2, "0");
						const safeName = presetName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
						const fname = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-bbmm-settings-preset-${safeName}.json`;

						await hlp_saveJSONFile({ [presetName]: one }, fname);
						ui.notifications.info(LT._importExport.exportedSettingsPreset());
						DL(1, `${FN} exported single preset`, { presetName, fname });

					} catch (err) {
						DL(3, `${FN} failed`, err);
						ui.notifications.error(LT.errors.importExportFailed());
					}
					return;
				}
				// Settings Presets import
				if (action === "bbmm-set-import") {
					if (game.user.isGM) {
						await bbmm_importSettingsPresetsAll();
					} else {
						// Player path: merge into user-scoped setting
						const FN = "settings.js | BBMMImportExportDialog._onRender(): bbmm-set-import (player):";
						const file = await hlp_pickLocalJSONFile();
						if (!file) return;

						let data;
						try {
							data = JSON.parse(await file.text());

							// Wrap a single exported preset payload into the map format
							if (data && typeof data === "object" && !Array.isArray(data)
								&& data.type === "bbmm-settings"
								&& data.world && typeof data.world === "object"
								&& data.client && typeof data.client === "object"
								&& data.user && typeof data.user === "object"
							) {
								const presetName = (file?.name ?? "bbmm-settings-preset").replace(/\.json$/i, "");
								data = { [presetName]: data };
								DL(1, `${FN} wrapped single preset payload`, { presetName });
							}
						} catch (err) {
							DL(3, `${FN} invalid json`, err);
							ui.notifications.error(LT.errors.invalidJSONFile());
							return;
						}

						if (!data || typeof data !== "object" || Array.isArray(data)) {
							ui.notifications.error(LT.errors.invalidJSONFile());
							return;
						}

						const current = foundry.utils.deepClone(game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS_U) ?? {});

						const now = new Date();
						const padN = (n) => String(n).padStart(2, "0");
						const dateStamp = `${now.getFullYear()}-${padN(now.getMonth() + 1)}-${padN(now.getDate())}`;
						const timeStamp = `${padN(now.getHours())}:${padN(now.getMinutes())}`;
						const suffixBase = ` (imported on ${dateStamp} ${timeStamp})`;

						let added = 0, renamed = 0;

						for (const [name, presetRaw] of Object.entries(data)) {
							if (!name || typeof name !== "string") continue;
							if (!presetRaw || typeof presetRaw !== "object" || Array.isArray(presetRaw)) continue;

							let finalName = name;
							if (Object.prototype.hasOwnProperty.call(current, finalName)) {
								finalName = `${name}${suffixBase}`;
								renamed++;
								let i = 2;
								while (Object.prototype.hasOwnProperty.call(current, finalName)) {
									finalName = `${name}${suffixBase} (${i})`;
									i++;
								}
							}

							// strip world bucket, players can't apply world settings and it saves space
							const stripped = { ...presetRaw, world: {} };
							current[finalName] = stripped;
							added++;
						}

						try {
							await svc_setPlayerSettingsPresets(current);
							DL(1, `${FN} imported presets into user setting`, { added, renamed });
							ui.notifications.info(`Imported ${added} settings preset(s).${renamed ? ` Renamed ${renamed}.` : ""}`);
						} catch (err) {
							DL(3, `${FN} failed to write user setting`, err);
							ui.notifications.error(LT.errors.errorOccured());
							return;
						}
					}

					// Force refresh the appropriate preset cache and reopen its manager if open
					try {
						if (game.user.isGM) {
							await svc_loadSettingsPresets({ force: true });
							const existing = Object.values(ui.windows ?? {}).find(w => w?.id === "bbmm-settings-preset-manager") ?? null;
							if (existing) await openSettingsPresetManager();
						} else {
							await svc_loadPlayerSettingsPresets({ force: true });
							const existing = Object.values(ui.windows ?? {}).find(w => w?.id === "bbmm-player-settings-preset-manager") ?? null;
							if (existing) await openPlayerSettingsPresetManager();
						}
					} catch (err) {
						DL(2, "settings.js | BBMMImportExportDialog._onRender(): post-import refresh failed", err);
					}

					return;
				}

				// Module Tags import/export
				if (action === "bbmm-tags-export") return await globalThis.bbmm?.exportModuleTags?.();
				if (action === "bbmm-tags-import") return await globalThis.bbmm?.importModuleTags?.();

				// Inclusions/Exclusions: all-only file export/import (storage/lists)
				if (action === "bbmm-inc-export") return await bbmm_exportIncExcBundle();
				if (action === "bbmm-inc-import") return await bbmm_importIncExcBundle();
				if (action === "bbmm-exc-export") return await bbmm_exportIncExcBundle();
				if (action === "bbmm-exc-import") return await bbmm_importIncExcBundle();

				// Lock presets (bridged via globalThis to avoid a settings<->lock-presets import cycle)
				if (action === "bbmm-lock-export") return await globalThis.bbmm?.bbmm_exportLockPresetsAll?.();
				if (action === "bbmm-lock-import") return await globalThis.bbmm?.bbmm_importLockPresetsAll?.();

				if (action === "bbmm-kb-export") {
					const proceed = await new Promise((resolve) => {
						const dlg = new foundry.applications.api.DialogV2({
							window: { title: LT._importExport.exportKeybindings() },
							content: `
								<div style="display:flex;flex-direction:column;gap:.5rem;">
									<p class="notes">${LT._importExport.exportKeybindingsNote()}</p>
									<p class="notes">${LT._importExport.exportKeybindingsNote2()}</p>
								</div>
							`,
							buttons: [
								{ action: "export", label: LT.buttons.export(), default: true },
								{ action: "cancel", label: LT.buttons.cancel() }
							],
							submit: (res) => resolve(res === "export"),
							rejectClose: false,
							position: { width: 520, height: "auto" }
						});
						dlg.render(true);
					});
					if (!proceed) return;

					const data = foundry.utils.duplicate(game.settings.get("core", "keybindings") ?? {});
					const d = new Date();
					const pad = (n) => String(n).padStart(2, "0");
					const fname = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-bbmm-keybindings.json`;

					await hlp_saveJSONFile(data, fname);
					ui.notifications.info("Exported keybindings.");
					DL(1, "settings.js | BBMMImportExportDialog._onRender(): exported keybindings", { fname });
					return;
				}

				if (action === "bbmm-kb-import") {
					const proceed = await new Promise((resolve) => {
						const dlg = new foundry.applications.api.DialogV2({
							window: { title: LT._importExport.importKeybindings() },
							content: `
								<div style="display:flex;flex-direction:column;gap:.5rem;">
									<p class="notes">${LT._importExport.importKeybindingsNote()}</p>
									<p class="notes">${LT._importExport.importKeybindingsNote2()}</p>
								</div>
							`,
							buttons: [
								{ action: "import", label: LT.buttons.import(), default: true },
								{ action: "cancel", label: LT.buttons.cancel() }
							],
							submit: (res) => resolve(res === "import"),
							rejectClose: false,
							position: { width: 520, height: "auto" }
						});
						dlg.render(true);
					});
					if (!proceed) return;

					const file = await hlp_pickLocalJSONFile();
					if (!file) return;

					let parsed;
					try {
						parsed = JSON.parse(await file.text());
					} catch (e) {
						DL(2, "settings.js | BBMMImportExportDialog._onRender(): keybindings import JSON parse failed", e);
						ui.notifications.error("Invalid keybindings file.");
						return;
					}

					if (!parsed || typeof parsed !== "object") {
						ui.notifications.error("Invalid keybindings file.");
						return;
					}

					await game.settings.set("core", "keybindings", parsed);
					ui.notifications.info("Imported keybindings. Reload may be required.");
					DL(1, "settings.js | BBMMImportExportDialog._onRender(): imported keybindings", { name: file.name });

					return;
				}
			} catch (err) {
				DL(3, "settings.js | Import/Export: action failed", { action, name: err?.name, message: err?.message, stack: err?.stack });
				ui.notifications.error(LT.errors.importExportFailed());
			}
		});
}

// Toolbox mount entry: Import / Export pane.
export async function mountImportExport(container) {
	container.innerHTML = _ie_contentHTML();
	_ie_wire(container);
}

// Deep-link opener.
export function openImportExport() {
	globalThis.bbmm?.openBBMMToolbox?.({ tool: "importExport" });
}

// Register the Import / Export pane as a toolbox tool (visible to everyone).
globalThis.bbmm ??= {};
globalThis.bbmm.openImportExport = openImportExport;
globalThis.bbmm.toolboxTools ??= [];
globalThis.bbmm.toolboxTools.push({
	id: "importExport",
	icon: "fa-solid fa-file-import",
	label: () => LT.buttons.importExport(),
	visible: () => true,
	group: null,
	mount: async (container) => { await mountImportExport(container); }
});

// Export inclusions/exclusions as a single file, with an optional filter by namespace (module)
async function bbmm_exportIncExcBundle() {
	const FN = "settings.js | bbmm_exportIncExcBundle():";

	// Read both stores
	let inc = {};
	let exc = {};

	try {
		inc = await fetch(`bbmm-data/user-inclusions.json`, { cache: "no-store" }).then(r => r.json());
	} catch (e) {
		DL(2, `${FN} failed reading inclusions, using empty`, e);
		inc = { modules: [], settings: [] };
	}

	try {
		exc = await fetch(`bbmm-data/user-exclusions.json`, { cache: "no-store" }).then(r => r.json());
	} catch (e) {
		DL(2, `${FN} failed reading exclusions, using empty`, e);
		exc = { modules: [], settings: [] };
	}

	const incModules = Array.isArray(inc?.modules) ? inc.modules.map(String) : [];
	const excModules = Array.isArray(exc?.modules) ? exc.modules.map(String) : [];
	const incSettings = Array.isArray(inc?.settings) ? inc.settings : [];
	const excSettings = Array.isArray(exc?.settings) ? exc.settings : [];

	// Namespace list (All first)
	const nsSet = new Set();
	for (const m of incModules) nsSet.add(String(m));
	for (const m of excModules) nsSet.add(String(m));
	for (const s of incSettings) if (s?.namespace) nsSet.add(String(s.namespace));
	for (const s of excSettings) if (s?.namespace) nsSet.add(String(s.namespace));

	const namespaces = Array.from(nsSet).sort((a, b) => a.localeCompare(b, game.i18n.lang || undefined, { sensitivity: "base" }));

	const chosen = await new Promise((resolve) => {
		const host = document.createElement("div");

		const p = document.createElement("p");
		p.textContent = "Export which namespace?";
		host.appendChild(p);

		const sel = document.createElement("select");
		sel.style.width = "100%";

		const optAll = document.createElement("option");
		optAll.value = "__all";
		optAll.textContent = "All";
		sel.appendChild(optAll);

		for (const ns of namespaces) {
			const opt = document.createElement("option");
			opt.value = ns;

			const mod = game.modules.get(ns);
			opt.textContent = String(mod?.title ?? ns);

			sel.appendChild(opt);
		}

		host.appendChild(sel);

		const dlg = new foundry.applications.api.DialogV2({
			window: { title: LT.buttons.export() },
			content: host,
			buttons: [
				{ action: "export", label: LT.buttons.export(), default: true, callback: () => { const v = dlg.element?.querySelector("select")?.value ?? sel.value; try { dlg.close(); } catch {} resolve(v); } },
				{ action: "cancel", label: LT.buttons.cancel(), callback: () => { try { dlg.close(); } catch {} resolve(null); } }
			],
			submit: () => { try { dlg.close(); } catch {} resolve(null); },
			rejectClose: false,
			position: { width: 420, height: "auto" }
		});

		dlg.render(true);
	});

	if (!chosen) return;

	const filterNs = (String(chosen) === "__all") ? "" : String(chosen);

	let moduleTitle = "";
	let moduleVersion = "";

	if (filterNs) {
		const mod = game.modules.get(filterNs);
		moduleTitle = String(mod?.title ?? "");
		moduleVersion = String(mod?.version ?? mod?.data?.version ?? "");
	}

	const filtered = {
		schemaVersion: 2,
		foundryVersion: String(game.version ?? ""),
		filter: filterNs || "all",

		// Rev 2: optional metadata (not required for import)
		...(filterNs ? { moduleTitle, moduleVersion } : {}),

		inclusions: {
			modules: filterNs ? incModules.filter(id => id === filterNs) : incModules,
			settings: filterNs ? incSettings.filter(s => String(s?.namespace ?? "") === filterNs) : incSettings
		},
		exclusions: {
			modules: filterNs ? excModules.filter(id => id === filterNs) : excModules,
			settings: filterNs ? excSettings.filter(s => String(s?.namespace ?? "") === filterNs) : excSettings
		}
	};

	const d = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	const tag = filterNs ? filterNs.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : "all";
	const fname = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-bbmm-inc-exc-${tag}.json`;

	await hlp_saveJSONFile(filtered, fname);
	DL(1, `${FN} exported`, { filter: filtered.filter, fname });
	ui.notifications?.info(LT._importExport?.exportedList?.() ?? "Exported.");
}

// import inclusions/exclusions from a file, merging with existing lists
async function bbmm_importIncExcBundle() {
	const FN = "settings.js | bbmm_importIncExcBundle():";

	const file = await hlp_pickLocalJSONFile();
	if (!file) return;

	let raw;
	try {
		raw = JSON.parse(await file.text());
	} catch (err) {
		DL(3, `${FN} invalid json import file`, err);
		ui.notifications?.error(LT.errors.invalidJSONFile());
		return;
	}

	// Detect format: bundle (has inclusions/exclusions keys) vs legacy flat file
	let inInc, inExc;
	const isFlat = !raw?.inclusions && !raw?.exclusions && (Array.isArray(raw?.settings) || Array.isArray(raw?.modules));
	if (isFlat) {
		// legacy flat file, determine direction from filename
		const name = file.name.toLowerCase();
		if (name.includes("exclusion")) {
			inInc = {};
			inExc = raw;
		} else {
			inInc = raw;
			inExc = {};
		}
	} else {
		inInc = raw?.inclusions ?? {};
		inExc = raw?.exclusions ?? {};
	}

	const inIncModules = Array.isArray(inInc?.modules) ? inInc.modules.map(String) : [];
	const inExcModules = Array.isArray(inExc?.modules) ? inExc.modules.map(String) : [];
	const inIncSettings = Array.isArray(inInc?.settings) ? inInc.settings : [];
	const inExcSettings = Array.isArray(inExc?.settings) ? inExc.settings : [];

	// Read current stores
	let curInc = {};
	let curExc = {};

	try {
		curInc = await fetch(`bbmm-data/user-inclusions.json`, { cache: "no-store" }).then(r => r.json());
	} catch (e) {
		DL(2, `${FN} failed reading current inclusions, using empty`, e);
		curInc = { modules: [], settings: [] };
	}

	try {
		curExc = await fetch(`bbmm-data/user-exclusions.json`, { cache: "no-store" }).then(r => r.json());
	} catch (e) {
		DL(2, `${FN} failed reading current exclusions, using empty`, e);
		curExc = { modules: [], settings: [] };
	}

	if (!Array.isArray(curInc.modules)) curInc.modules = [];
	if (!Array.isArray(curInc.settings)) curInc.settings = [];
	if (!Array.isArray(curExc.modules)) curExc.modules = [];
	if (!Array.isArray(curExc.settings)) curExc.settings = [];

	// Build identity sets (for "no new duplicates across lists")
	const curIncModSet = new Set(curInc.modules.map(String));
	const curExcModSet = new Set(curExc.modules.map(String));
	const curIncSetSet = new Set(curInc.settings.map(s => `${s?.namespace ?? ""}::${s?.key ?? ""}`));
	const curExcSetSet = new Set(curExc.settings.map(s => `${s?.namespace ?? ""}::${s?.key ?? ""}`));

	// Legacy duplicates preserved
	const legacyDupModSet = new Set([...curIncModSet].filter(x => curExcModSet.has(x)));
	const legacyDupSetSet = new Set([...curIncSetSet].filter(x => curExcSetSet.has(x)));

	// Merge exclusions first (they trump)
	for (const id of inExcModules) {
		if (!id) continue;
		if (!curExcModSet.has(id)) {
			curExc.modules.push(id);
			curExcModSet.add(id);
		}
	}

	for (const s of inExcSettings) {
		const ns = String(s?.namespace ?? "").trim();
		const key = String(s?.key ?? "").trim();
		if (!ns || !key) continue;
		const sig = `${ns}::${key}`;
		if (!curExcSetSet.has(sig)) {
			curExc.settings.push({ namespace: ns, key });
			curExcSetSet.add(sig);
		}
	}

	// Merge inclusions, but do NOT create new duplicates against exclusions
	for (const id of inIncModules) {
		if (!id) continue;

		// If exclusion already has it, only allow inclusion if it was a legacy duplicate
		if (curExcModSet.has(id) && !legacyDupModSet.has(id)) continue;

		if (!curIncModSet.has(id)) {
			curInc.modules.push(id);
			curIncModSet.add(id);
		}
	}

	for (const s of inIncSettings) {
		const ns = String(s?.namespace ?? "").trim();
		const key = String(s?.key ?? "").trim();
		if (!ns || !key) continue;

		const sig = `${ns}::${key}`;

		if (curExcSetSet.has(sig) && !legacyDupSetSet.has(sig)) continue;

		if (!curIncSetSet.has(sig)) {
			curInc.settings.push({ namespace: ns, key });
			curIncSetSet.add(sig);
		}
	}

	// Write both stores back (still separate files)
	{
		const payload = JSON.stringify(curInc ?? { modules: [], settings: [] }, null, 2);
		const f = new File([payload], "user-inclusions.json", { type: "application/json" });
		await foundry.applications.apps.FilePicker.implementation.upload("data", "bbmm-data", f, { notify: false });
	}

	{
		const payload = JSON.stringify(curExc ?? { modules: [], settings: [] }, null, 2);
		const f = new File([payload], "user-exclusions.json", { type: "application/json" });
		await foundry.applications.apps.FilePicker.implementation.upload("data", "bbmm-data", f, { notify: false });
	}

	// Refresh in-memory caches so the manager shows the new data without a reload
	await hlp_readUserInclusions({ force: true });
	await hlp_readUserExclusions({ force: true });

	DL(1, `${FN} imported + merged`, {
		addedInclusionsModules: inIncModules.length,
		addedInclusionsSettings: inIncSettings.length,
		addedExclusionsModules: inExcModules.length,
		addedExclusionsSettings: inExcSettings.length
	});

	ui.notifications?.info(LT._importExport.importedList());
}

// Remote Message Feed Check
async function bbmm_checkRemoteMessageFeed() {
	const FN = "settings.js | bbmm_checkRemoteMessageFeed():";

	// GM only
	if (!game.user?.isGM) return;

	// Read bbmmFlags object
	let flags = game.settings.get(BBMM_ID, "bbmmFlags");
	if (!flags || typeof flags !== "object") flags = {};

	// Ensure defaults exist
	let changed = false;

	if (typeof flags.lastMessageRev !== "number") {
		flags.lastMessageRev = 0;
		changed = true;
	}

	if (typeof flags.lastMessageCheckTs !== "number") {
		flags.lastMessageCheckTs = 0;
		changed = true;
	}

	// Throttle checks to once per hour (world)
	const now = Date.now();
	if (flags.lastMessageCheckTs && (now - flags.lastMessageCheckTs) < 3600000) {
		DL(1, `${FN} skipped (checked < 1 hour ago)`, { lastMessageCheckTs: flags.lastMessageCheckTs, now });
		return;
	}

	// Update last check timestamp in bbmmFlags if needed
	if (changed) {
		try {
			await game.settings.set(BBMM_ID, "bbmmFlags", flags);
		} catch (e) {
			DL(2, `${FN} failed to set bbmmFlags defaults/checkTs`, e);
		}
	}

	const lastRev = Number(flags.lastMessageRev || 0);

	// Fetch JSON
	let data;
	try {
		const resp = await fetch(BBMM_MESSAGE_FEED_URL, { cache: "no-store" });
		if (!resp?.ok) {
			DL(2, `${FN} fetch failed`, { status: resp?.status, statusText: resp?.statusText });
			return;
		}
		data = await resp.json();
	} catch (e) {
		DL(2, `${FN} fetch/json failed`, e);
		return;
	}

	// Blank/invalid JSON -> do nothing
	if (!data || typeof data !== "object") {
		DL(1, `${FN} feed empty/invalid, skipping`);
		return;
	}

	// Support either {messages:[...]} or a single message object
	let msg = null;

	if (Array.isArray(data?.messages)) {
		let best = null;
		for (const m of data.messages) {
			const rev = Number(m?.rev ?? 0);
			if (!rev || rev <= lastRev) continue;
			if (!best || rev > Number(best?.rev ?? 0)) best = m;
		}
		if (best) {
			msg = {
				rev: Number(best.rev),
				title: String(best?.title ?? "BBMM Message"),
				message: String(best?.message ?? ""),
				link: best?.link ? String(best.link) : ""
			};
		}
	} else {
		const rev = Number(data?.rev ?? 0);
		if (rev && rev > lastRev) {
			msg = {
				rev,
				title: String(data?.title ?? "BBMM Message"),
				message: String(data?.message ?? ""),
				link: data?.link ? String(data.link) : ""
			};
		}
	}

	if (!msg) {
		DL(1, `${FN} no new messages`, { lastRev });

		// update lastMessageCheckTs
		try {
			const current = game.settings.get(BBMM_ID, "bbmmFlags");
			const next = (current && typeof current === "object") ? { ...current } : {};
			next.lastMessageCheckTs = Date.now();
			await game.settings.set(BBMM_ID, "bbmmFlags", next);
		} catch (e) {
			DL(2, `${FN} failed to update lastMessageCheckTs (no message)`, e);
		}

		return;
	}

	const safeTitle = foundry.utils.escapeHTML(msg.title);
	const safeMsg = foundry.utils.escapeHTML(msg.message).replace(/\n/g, "<br>");

	let CheckGH = "Check the GitHub page for more information.";
	
	const html = `
		<div class="bbmm-remote-message">
			<p style="margin:0;">${safeMsg}</p>
			${CheckGH}
		</div>
	`;

	// Show dialog with "Don't show again" and "Remind me later" options
	const result = await new Promise((resolve) => {
		const dlg = new foundry.applications.api.DialogV2({
			window: { title: safeTitle },
			content: html,
			buttons: [
				{
					action: "ok",
					label: (LT.presetNoticeDontShowAgain() ?? "Don't show again"),
					default: true,
					callback: () => resolve("ok")
				},
				{
					action: "later",
					label: (LT.remindMeLater() ?? "Remind me later"),
					callback: () => resolve("later")
				}
			],
			submit: (res) => resolve(res ?? "later"),
			rejectClose: false,
			position: { width: 560, height: "auto" }
		});
		dlg.render(true);
	});

	if (result !== "ok") {
		DL(1, `${FN} dismissed (later)`, { rev: msg.rev });
		return;
	}

	// Update lastMessageRev in bbmmFlags
	try {
		const current = game.settings.get(BBMM_ID, "bbmmFlags");
		const next = (current && typeof current === "object") ? { ...current } : {};
		next.lastMessageRev = Number(msg.rev);
		next.lastMessageCheckTs = Date.now();
		await game.settings.set(BBMM_ID, "bbmmFlags", next);
		DL(`${FN} updated lastMessageRev`, { rev: msg.rev });
	} catch (e) {
		DL(2, `${FN} failed to update lastMessageRev`, e);
	}
}

Hooks.once("init", () => {

	try {
		// ===== FLAGS ======
			// Setting to hold module flags
			game.settings.register(BBMM_ID, "bbmmFlags", {
				scope: "world",
				config: false,
				type: Object,
				default: {}	
			});

		// ====== HIDDEN VARIABLES ===== 
		// These do not need to be localized
			// User Exclusions 
			game.settings.register(BBMM_ID, "userExclusions", {
				scope: "world",
				config: false,	
				type: Object,
				default: { modules: [], settings: [] }
			});

			// User Inclusions (hidden settings to include when saving presets)
			game.settings.register(BBMM_ID, "userInclusions", {
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// User scoped Settings presets
			game.settings.register(BBMM_ID, SETTING_SETTINGS_PRESETS_U, {
				scope: "user",
				config: false,
				type: Object,
				default: {}
			});

			// User scoped Module Presets
			game.settings.register(BBMM_ID, MODULE_SETTING_PRESETS_U, {
				scope: "user",
				config: false,
				type: Object,
				default: {}
			});

			// World map of { [moduleId]: "x.y.z" } that we've marked as seen
			game.settings.register(BBMM_ID, "seenChangelogs", {
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// User map of soft-locked settings
			game.settings.register(BBMM_ID, "userSettingSync", {
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// User-scoped ledger: remembers which soft-lock value was last auto-applied per setting id
			game.settings.register(BBMM_ID, "softLockLedger", {
				scope: "user",
				config: false,
				type: Object,
				default: {}	// { "<namespace>.<key>": <serializedValue> }
			});

			// persistant soft-lock rev map - Master list of soft lock values and revisions
			game.settings.register(BBMM_ID, "softLockRevMap", {
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// Controls Sync Storage
			game.settings.register?.(BBMM_ID, "userControlSync", {
				scope: "world",
				config: false, 
				default: {}
			});

			// Controls Sync RevMap
			game.settings.register?.(BBMM_ID, "softLockRevMap_controls", {
				scope: "world",
				config: false, 
				default: {}
			});

			// Ledger of soft-locked compendium entries per user
			game.settings.register(BBMM_ID, "controlSoftLedger", {
				scope: "world",
				config: false,
				type: Object,
				default: {}, // { userId: [ "compendium.action" ] }
			});

			// temp config store
			game.settings.register(BBMM_ID, "tempModConfig", {
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// Module Management - Module Locks
			game.settings.register(BBMM_ID, "moduleLocks", {
				scope: "world",
				config: false,
				type: Object,			
				default: [],			
				onChange: (value) => {
					try {
						DL("settings: moduleLocks changed", { count: Array.isArray(value) ? value.length : 0 });
					} catch (e) {
						// keep quiet
					}
				}
			});

			// List of installed modules we’ve detected (used for change detection and changelog display)
			game.settings.register(BBMM_ID, "knownInstalledModules", {
				scope: "world",
				config: false,
				type: Array,
				default: [],
				restricted: true
			});

			// Remote message feed: last seen message revision (per-user)
			game.settings.register(BBMM_ID, "lastMessageRev", {
				scope: "world",
				config: false,
				type: Number,
				default: 0
			});

			// list of filename patterns BBMM searches for when detecting a module's changelog
			game.settings.register(BBMM_ID, "changelogFilenames", {
				scope: "world",
				config: false,
				type: Array,
				default: ["changelog.md", "changelog.txt", "CHANGELOG", "docs/changelog.md", "docs/changelog.txt"]
			});

		// ===== SETTINGS ITEMS =====
		// These DO need to be localized

			// MENU: About BBMM menu button
			game.settings.registerMenu(BBMM_ID, "menuAboutBBMM", {
				name: LT.aboutName(),
				label: LT.aboutName(),
				icon: "fas fa-circle-info",
				restricted: true,
				type: class extends FormApplication {
					constructor(...args){ super(...args); }
					static get defaultOptions() {
						return foundry.utils.mergeObject(super.defaultOptions, {
							id: "bbmm-about-bbmm-opener",
							title: LT.aboutName(),
							template: null,
							width: 600
						});
					}
					async render(...args) {
						try {
							DL("settings.js | About BBMM button clicked", { BBMM_README_UUID });
							const doc = await fromUuid(BBMM_README_UUID);
							if (!doc) {
								DL(2, "settings.js | About BBMM open failed: document not found", { BBMM_README_UUID });
								return ui.notifications?.error(LT.aboutOpenMissing());
							}
							await doc.sheet.render(true);
						} catch (err) {
							DL(2, "settings.js | About BBMM open failed", err);
							ui.notifications?.error(LT.aboutOpenError());
						}
						return this;
					}
					async _updateObject() {}
				}
			});

			// MENU: open the BBMM Toolbox (single entry point for the migrated managers)
			game.settings.registerMenu(BBMM_ID, "toolbox", {
				name: LT.toolbox.title(),
				label: LT.toolbox.title(),
				icon: "fas fa-layer-group",
				restricted: false,
				type: class extends FormApplication {
					constructor(...args){ super(...args); }
					static get defaultOptions() {
						return foundry.utils.mergeObject(super.defaultOptions, {
							id: "bbmm-toolbox-opener",
							title: LT.toolbox.title(),
							template: null,
							width: 500
						});
					}
					async render(...args) {
						globalThis.bbmm?.openBBMMToolbox?.();
						return this;
					}
					async _updateObject() {}
				}
			});

			// MENU: Changelog Filename Manager
			game.settings.registerMenu(BBMM_ID, "changelogFilesManager", {
				name: LT.changelog.filesMgrName(),
				label: LT.changelog.filesMgrLabel(),
				icon: "fas fa-file-lines",
				restricted: true,
				type: class extends FormApplication {
					constructor(...args){ super(...args); }
					static get defaultOptions() {
						return foundry.utils.mergeObject(super.defaultOptions, {
							id: "bbmm-changelog-files-manager-opener",
							title: LT.changelog.filesMgrTitle(),
							template: null,
							width: 500
						});
					}
					async render(...args) {
						openChangelogFilesManager();
						return this;
					}
					async _updateObject() {}
				}
			});

			// World toggle to Show changelog on GM login
			game.settings.register(BBMM_ID, "showChangelogsOnLogin", {
				name: LT.name_showChangelogsOnLogin(),
				hint: LT.hint_showChangelogsOnLogin(),
				scope: "world",
				config: true,
				type: Boolean,
				default: true
			});

			// toggle to check disabled modules
			game.settings.register("bbmm", "checkDisabledModules", {
				scope: "world",
				config: true,
				type: Boolean,
				default: false,
				name: LT.name_checkDisabledModules(),
				hint: LT.hint_checkDisabledModules()
			});

			// Enable/disable "enhanced" module manager
			game.settings.register(BBMM_ID, "enableModuleManagement", {
				name: LT.enableModuleManagementName(),
				hint: LT.enableModuleManagementHint(),
				scope: "world",	
				config: true,
				type: Boolean,
				default: true,
				restricted: true,
				requiresReload: true,
			});

			// Default grouping mode for module manager
			game.settings.register(BBMM_ID, "defaultGrouping", {
				name: LT.defaultGroupingName(),
				hint: LT.defaultGroupingHint(),
				scope: "world",
				config: true,
				type: String,
				choices: {
					"none":   LT.defaultGroupingNone(),
					"tag":    LT.defaultGroupingByTag(),
					"subtag": LT.defaultGroupingBySubtag(),
				},
				default: "none",
				restricted: true,
			});

			// Auto collapse all groups when module manager opens
			game.settings.register(BBMM_ID, "autoCollapseList", {
				name: LT.autoCollapseListName(),
				hint: LT.autoCollapseListHint(),
				scope: "world",
				config: true,
				type: Boolean,
				default: false,
				restricted: true,
			});

			// Prompt to enable newly added modules
			game.settings.register(BBMM_ID, "promptEnableNewModules", {
				name: LT.moduleManagement.promptEnableNewModulesName(),
				hint: LT.moduleManagement.promptEnableNewModulesHint(),
				scope: "world",
				config: true,
				type: Boolean,
				default: true,
				restricted: true
			});

			// Enable/disable BBMM user/client setting sync
			game.settings.register(BBMM_ID, "enableUserSettingSync", {
				name: LT.sync.EnableName(),
				hint: LT.sync.EnableHint(),
				scope: "world",
				config: true,
				type: Boolean,
				default: true,
				requiresReload: true,
				onChange: (v) => {
					try {
						DL(`settings.js | bbmm-setting-lock: enableUserSettingSync -> ${v}`);
						// Optional: let connected clients know state changed (no-op if they aren't listening)
						game.socket?.emit?.(`module.${BBMM_ID}`, { t: "bbmm-sync-toggle", enabled: !!v });
					} catch (err) {
						DL(2, "settings.js | bbmm-setting-lock: onChange(enableUserSettingSync) error", err);
					}
				}
			});

			// Enable/disable BBMM Controls Sync
			game.settings.register?.(BBMM_ID, "enableControlSync", {
				name: LT.controlsToggleName(),
				hint: LT.controlsToggleHint(),
				scope: "world", config: true, type: Boolean, default: true
			});
			
			// Hide locked settings from players (vs. show disabled)
			game.settings.register(BBMM_ID, "hideLockedSettings", {
				name: LT._settings.hideLockedSettingsName(),
				hint: LT._settings.hideLockedSettingsHint(),
				scope: "world",
				config: true,
				type: Boolean,
				default: true,
				restricted: true
			});

			// Auto-force player reload
			game.settings.register(BBMM_ID, "autoForceReload", {
				name: LT._settings.autoForceReloadName(),
				hint: LT._settings.autoForceReloadHint(),
				scope: "world",
				config: true,
				type: Boolean,
				default: false
			});

			// Option to receive important messages from the module (like critical updates or announcements)
			game.settings.register(BBMM_ID, "receiveImportantMessages", {
				name: LT._settings.receiveImportantMessages(),
				hint: LT._settings.receiveImportantMessagesHint(),
				scope: "world",
				config: true,
				type: Boolean,
				default: true
			});

			// Debug level for THIS module
			game.settings.register(BBMM_ID, "debugLevel", {
				name: LT.debugLevel(),
				hint: LT.debugLevelHint(),
				scope: "world",
				config: true,
				type: String,
				choices: { 
					all: LT.debugLevelAll(), 
					warn: LT.debugLevelWarn(), 
					error: LT.debugLevelErr(), 
					none: LT.debugLevelNone() 
				},
				default: "none"
			});
		
	} catch (err) {
		DL(3, "settings.js | init() error", err);
	}
});

Hooks.once("ready", async () => {

	DL("settings.js | ready fired");

	// Seed data files before other ready hooks read them.
	// Stored as a promise so other scripts can await it (settings.js loads first).
	globalThis.bbmm ??= {};
	globalThis.bbmm._dataFilesReady = (async () => {
		if (!game.user.isGM) return;

		// Ensure directory
		try {
			await foundry.applications.apps.FilePicker.implementation.createDirectory("data", "bbmm-data");
			DL("settings.js | Directory 'bbmm-data' ensured");
		} catch (err) {
			const msg = String(err?.message ?? err);
			if (!msg.toLowerCase().includes("exist"))
				DL(2, "settings.js | createDirectory failed for bbmm-data", err);
		}

		// Seed any missing data files with empty defaults.
		// Uses fetch() to check each file individually rather than directory listing.
		const seeds = {
			"module-notes.json":     {},
			"module-presets.json":   {},
			"module-tags.json":      {},
			"settings-presets.json": {},
			"user-exclusions.json":  { settings: [], modules: [] },
			"user-inclusions.json":  { settings: [], modules: [] },
			"lock-presets.json":     {},
		};

		for (const [filename, defaultData] of Object.entries(seeds)) {
			// Check if the file already exists before seeding
			let fileExists = false;
			try {
				const check = await fetch(`bbmm-data/${filename}`, { cache: "no-store" });
				fileExists = check.ok;
			} catch (_) {
				// network error or file not found, treat as missing
			}

			if (fileExists) {
				DL(`settings.js | ${filename} already exists, skipping seed`);
				continue;
			}

			try {
				const file = new File([JSON.stringify(defaultData, null, 2)], filename, { type: "application/json" });
				await foundry.applications.apps.FilePicker.implementation.upload("data", "bbmm-data", file, { notify: false });
				DL(`settings.js | seeded ${filename}`);
			} catch (err) {
				DL(2, `settings.js | failed to seed ${filename}`, err);
			}
		}
	})();

	await globalThis.bbmm._dataFilesReady;

	// Prime exclusions cache for getSkipMap() users
	try { await hlp_readUserExclusions(); } catch (err) { DL(2, "settings.js | ready | preload exclusions failed", err); }

	// check folder migration (move compendiums into BBMM folder)
	try { await checkFolderMigration();} catch (err) {DL(3, "settings.js | Compendium folder migration failed:", err?.message ?? err);}

	// Hook into settings and manage modules window to add app button in header
	Hooks.on("renderSettingsConfig", (app, html) => {
		try {
			hlp_injectHeaderHelpButton(app, {
				uuid: BBMM_README_UUID,
				iconClass: "fas fa-circle-question",
				title: LT.buttons.help?.() ?? "Help"
			});
			injectBBMMHeaderButton(html);
		} catch (e) {
			DL(2, "settings.js | renderSettingsConfig: help or menu injection failed", e);
		}
		try {
			injectSettingsSectionHeaders(html);
		} catch (e) {
			DL(2, "settings.js | renderSettingsConfig: section headers injection failed", e);
		}
	});
	Hooks.on("renderModuleManagement", (app, html) => { try { injectBBMMHeaderButton(html) } catch (e) { DL(2, "settings.js | renderModuleManagement: menu injection failed", e); } });

	// Remote update messages from GitHub feed
	if (game.settings.get(BBMM_ID, "receiveImportantMessages") === true) {
		try {
			if (game.user?.isGM) { try { await bbmm_checkRemoteMessageFeed(); } catch (err) { DL(2, "settings.js | ready | remote message feed failed", err); } }
		} catch (err) {
			DL(2, "settings.js | ready | remote message feed outer failed", err);
		}
	}
});

// For use in macro for easy testing
window.openBBMMLauncher = openBBMMLauncher;
