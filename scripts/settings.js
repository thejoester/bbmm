import { openPresetManager } from './module-presets.js';
import { openSettingsPresetManager } from './settings-presets.js';
import { LT, BBMM_ID } from "./localization.js";
import { openLegacyExportDialog } from "./legacy.js";
import { openInclusionsManagerApp } from "./inclusions.js";

const MODULE_SETTING_PRESETS = "module-presets";  // OLD will go away 
const SETTING_SETTINGS_PRESETS = "settingsPresets"; // OLD will go away
const MODULE_SETTING_PRESETS_U = "modulePresetsUser";  
const SETTING_SETTINGS_PRESETS_U = "settingsPresetsUser"; 
const BBMM_COMP_FOLDER_NAME = "Big Bad Module Manager";

/* Controls Sync Globals ======================================================*/
export const CTRL_STORE_KEY = "userControlSync";				// world: { [id]: {rev, lock?, soft?} }
export const CTRL_REV_STORE = "softLockRevMap_controls";		// world: { [id]: number }
export const CTRL_TOGGLE = "enableControlSync";					// world: boolean

let __bbmm_isV12 = null; // cache after init

// Do not export these settings
export const EXPORT_SKIP = new Map([
	["bbmm", new Set(["settingsPresets", "module-presets", "settingsPresetsUser", "modulePresetsUser", 
		"migratedPresetsV1", "userSettingSync", "migratedPresetsV1", "softLockLedger", "softLockRevMap"])],
	["core", new Set(["moduleConfiguration", "compendiumConfiguration", "time"])],	
	["pf2e-alchemist-remaster-ducttape", new Set(["alchIndex"])] // Known large set, excluding for performance
]);

// Check folder migration 
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

/* V12 Check =============================================================== */
export function isFoundryV12() {
	try {
		// if we've already computed it post-init, trust the cache
		if (__bbmm_isV12 !== null) return __bbmm_isV12;

		// fallback computation (in case someone calls before init again)
		const gen = Number(game?.release?.generation);
		const ver = String(game?.version ?? game?.data?.version ?? CONFIG?.version ?? "");
		const major = Number.isFinite(gen) ? gen : parseInt((ver.split(".")[0] || "0"), 10);
		const is12 = major === 12;
		DL(`settings.js | isFoundryV12(): gen=${gen} version="${ver}" → ${is12}`);
		return is12;
	} catch (err) {
		DL(2, "settings.js | isFoundryV12(): detection failed", err);
		return false;
	}
}

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
	let fileInfo = "Unknown Source";
	for (let i = 2; i < stack.length; i++) {
		const line = stack[i].trim();
		const fileInfoMatch = line.match(/(\/[^)]+):(\d+):(\d+)/); // Match file path and line number
		if (fileInfoMatch) {
			const [, filePath, lineNumber] = fileInfoMatch;
			const fileName = filePath.split("/").pop(); // Extract just the file name
		}
	}

	// Prepend the file and line info to the log message
	const formattedLogMsg = `[${fileInfo}] ${stringLogMsg}`;
	
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

//  Inject BBMM button into a Foundry window header
function injectBBMMHeaderButton(root) {
	
	//Only run as GM for now - until we migrate
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

	// Prevent duplicate header button
	if (controls.querySelector(".bbmm-header-btn")) return;

	// Create header button
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "header-control bbmm-header-btn";
	btn.setAttribute("data-tooltip", LT.buttons.bbmmBtnToolTip());
	btn.setAttribute("aria-label", LT.buttons.bbmmBtnToolTip());
	btn.innerHTML = `<i class="fa-solid fa-layer-group"></i><span>BBMM</span>`;

	btn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		if (game.user.isGM) {
			DL("settings.js | Opening BBMM Launcher from header button");
			openBBMMLauncher();
		} else {
			DL("settings.js | Opening BBMM Settings Preset Manager from header button");
			openSettingsPresetManager();
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
			header.window-header .header-control.bbmm-header-btn {
				display: inline-flex;
				align-items: center;
				gap: 0.4rem;
				white-space: nowrap;
				padding-inline: 0.5rem;
			}
			header.window-header .header-control.bbmm-header-btn i {
				font-size: 0.9em;
			}
		`;
		document.head.appendChild(style);
	}

	DL("settings.js | BBMM header button injected");
}

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

// Open a small chooser dialog, then launch the selected manager
export async function openBBMMLauncher() {
	DL("settings.js | openBBMMLauncher()");

	const choice = await new Promise((resolve) => {
		const dlg = new foundry.applications.api.DialogV2({
			window: { title: LT.moduleName() },
			classes: ["bbmm-launcher-dialog"],
			content: ``,
			buttons: [
				{ action: "modules",  label: LT.modulePresetMgr(), default: true },
				{ action: "settings", label: LT.settingsPresetMgr() },
				// { action: "controls-presets", label: LT.controlsPresetMgr() },
				{ action: "exclusions", label: LT.exclusionsMgr() },
				{ action: "inclusions", label: LT.inclusionsMgr() },	
				{ action: "cancel",   label: LT.buttons.cancel() }
			],
			submit: (res) => resolve(res ?? "cancel"),
			rejectClose: false,
			position: { width: 400, height: "auto" }
		});
		dlg.render(true);

	});

	DL(`settings.js | openBBMMLauncher(): choice = ${choice}`);

	if (choice === "modules") {
		openPresetManager();
	} else if (choice === "settings") {
		openSettingsPresetManager();
	} else if (choice === "exclusions") {
		openExclusionsManager();
	} else if (choice === "inclusions") {
		openInclusionsManagerApp();
	} else if (choice === "controls-presets") {
		openControlsPresetManager();
	}
	// "cancel" -> do nothing
}

/*  Migrationv1 Checker
	- Migrates users of v0.0.7 and below from WORLD scoped preset
	  data to USER scoped preset data. 
*/
async function migrationV1Check() {
	if (!game.user.isGM) return; // Only needed for GMs
	
	try {
		const migrated = game.settings.get(BBMM_ID, "migratedPresetsV1");
		if (!migrated) {
			const oldModule = game.settings.get(BBMM_ID, MODULE_SETTING_PRESETS) ?? {};
			const oldSetting = game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS) ?? {};

			if (Object.keys(oldModule).length) {
				await game.settings.set(BBMM_ID, MODULE_SETTING_PRESETS_U, oldModule);
				DL("settings.js | migrationV1Check(): migrated module presets to user scope");
			}
			if (Object.keys(oldSetting).length) {
				await game.settings.set(BBMM_ID, SETTING_SETTINGS_PRESETS_U, oldSetting);
				DL("settings.js | migrationV1Check(): migrated setting presets to user scope");
			}

			await game.settings.set(BBMM_ID, "migratedPresetsV1", true);
			DL("settings.js | migrationV1Check(): migration complete, flag set");
		}
	} catch (err) {
		DL(3, "settings.js | migrationV1Check(): migration error", err);
	}
	
}

Hooks.once("init", () => {

	/*	Detect Foundry version 
	*/
	try {
		const gen = Number(game?.release?.generation);
		const ver = String(game?.version ?? game?.data?.version ?? CONFIG?.version ?? "");
		const major = Number.isFinite(gen) ? gen : parseInt((ver.split(".")[0] || "0"), 10);
		__bbmm_isV12 = (major === 12);
		DL(`settings.js |  BBMM init: major=${major} (gen=${gen}, ver="${ver}") → isV12=${__bbmm_isV12}`);

		// now safely gate your injections
		if (!__bbmm_isV12) {
			Hooks.on("renderSettingsConfig", (app, html) => injectBBMMHeaderButton(html));
			Hooks.on("renderModuleManagement", (app, html) => injectBBMMHeaderButton(html));
		}
	} catch (err) {
		DL(2, "settings.js | BBMM init version gate failed", err);
	}

	try {
		DL("settings.js | init(): start");

		// v12-only legacy export menu
		if (isFoundryV12()) {
			DL("settings.js | init(): Foundry v12 detected — registering Legacy Export menu");

			// Add a  menu entry to launch legacy export dialog
			game.settings.registerMenu(BBMM_ID, "v12ExportSettings", {
				name:  game.i18n.localize("bbmm.titlev12Legacy"),
				label: game.i18n.localize("bbmm.titlev12Legacy"),
				icon: "fas fa-box-archive",
				restricted: true,
				type: class extends FormApplication {
					static get defaultOptions() {
						return foundry.utils.mergeObject(super.defaultOptions, {
							id: "bbmm-legacy-export",
							title: game.i18n.localize("bbmm.titlev12Legacy"),
							template: null,
							width: 600
						});
					}
					async render(...args) {
						await openLegacyExportDialog();
						return this;
					}
					async _updateObject() {}
				}
			});

			return;
		// Else show default settings. 
		} else {

			// ===== FLAGS ======
				//	World-scoped one-time migration flag
				game.settings.register(BBMM_ID, "migratedPresetsV1", {
					name: "BBMM Migration Flag",
					scope: "world",
					config: false,
					type: Boolean,
					default: false
				});

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
					name: "BBMM: User Exclusions",
					hint: "Modules or Settings to be ignored when importing/exporting BBMM presets.",
					scope: "world",	
					config: false,	
					type: Object,
					default: { modules: [], settings: [] }
				});

				// User Inclusions (hidden settings to include when saving presets)
				game.settings.register(BBMM_ID, "userInclusions", {
					name: "BBMM: User Inclusions",
					hint: "Hidden settings explicitly included when exporting BBMM settings presets.",
					scope: "world",
					config: false,
					type: Object,
					default: {}
				});

				// User scoped Settings presets
				game.settings.register(BBMM_ID, SETTING_SETTINGS_PRESETS_U, {
					name: "Module Presets (User)",
					hint: "User-scoped stored module enable/disable presets.",
					scope: "user",
					config: false,
					type: Object,
					default: {}
				});

				// User scoped Module Presets
				game.settings.register(BBMM_ID, MODULE_SETTING_PRESETS_U, {
					name: "Settings Presets (User)",
					hint: "User-scoped stored settings presets.",
					scope: "user",
					config: false,
					type: Object,
					default: {}
				});

				// HIDDEN World map of { [moduleId]: "x.y.z" } that we've marked as seen
				game.settings.register(BBMM_ID, "seenChangelogs", {
					name: "Seen Changelogs",
					hint: "Private setting: Internal map of module versions marked as 'seen'.",
					scope: "world",
					config: false,
					type: Object,
					default: {}
				});

				game.settings.register(BBMM_ID, "userSettingSync", {
					name: "User Setting Sync",
					hint: "GM: settings marked for sync are enforced on players when they load.",
					scope: "world",
					config: false,
					type: Object,
					default: {}
				});

				// User-scoped ledger: remembers which soft-lock value was last auto-applied per setting id
				game.settings.register(BBMM_ID, "softLockLedger", {
					name: "softLockLedger",
					scope: "user",
					config: false,
					type: Object,
					default: {}	// { "<namespace>.<key>": <serializedValue> }
				});

				// persistant soft-lock rev map
				game.settings.register(BBMM_ID, "softLockRevMap", {
					name: "softLockRevMap",
					scope: "world",
					config: false,
					type: Object,
					default: {}
				});

				// Controls Sync Storage
				game.settings.register?.(BBMM_ID, CTRL_STORE_KEY, {
					name: "BBMM Control Sync Store",
					scope: "world", config: false, default: {}
				});
				// Controls Sync RevMap
				game.settings.register?.(BBMM_ID, CTRL_REV_STORE, {
					name: "BBMM Control Sync RevMap",
					scope: "world", config: false, default: {}
				});
				

			// ===== SETTINGS ITEMS =====
			// These DO need to be localized

				// About BBMM menu button
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
							const uuid = "Compendium.bbmm.bbmm-journal.JournalEntry.u3uUIp6Jfg8411Pn";
							try {
								DL("settings.js | About BBMM button clicked", { uuid });
								const doc = await fromUuid(uuid);
								if (!doc) {
									DL(2, "settings.js | About BBMM open failed: document not found", { uuid });
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

				// Add a menu entry in Configure Settings to open the Preset Manager
				game.settings.registerMenu(BBMM_ID, "modulePresetManager", {
					name: LT.modulePresetsBtn(),
					label: LT.lblOpenModulePresets(),
					icon: "fas fa-layer-group",
					restricted: true,
					type: class extends FormApplication {
						constructor(...args){ super(...args); }
						static get defaultOptions() {
							return foundry.utils.mergeObject(super.defaultOptions, {
								id: "bbmm-module-preset-manager",
								title: LT.titleModulePresets(),
								template: null, // We’ll use DialogV2 instead
								width: 600
							});
						}
						async render(...args) {
							await openPresetManager();
							return this;
						}
						async _updateObject() {}
					}
				});
				
				// Add a menu entry in Configure Settings to open the Preset Manager
				game.settings.registerMenu(BBMM_ID, "settingsPresetManager", {
					name: LT.settingsPresetsBtn(),
					label: LT.lblOpenSettingsPresets(),
					icon: "fas fa-layer-group",
					restricted: false,
					type: class extends FormApplication {
						constructor(...args){ super(...args); }
						static get defaultOptions() {
							return foundry.utils.mergeObject(super.defaultOptions, {
								id: "bbmm-settings-preset-manager",
								title: LT.titleSettingsPresets(),
								template: null, // We’ll use DialogV2 instead
								width: 600
							});
						}
						async render(...args) {
							await openSettingsPresetManager();
							return this;
						}
						async _updateObject() {}
					}
				});
				
				// Add a  menu entry for Exclusions manager
				game.settings.registerMenu(BBMM_ID,"exclusionsManager",{
					name: LT.exclusionsMgrBtn(),
					label: LT.lblExclusionsMgr(),
					icon: "fas fa-filter",
					restricted: true,
					type: class extends FormApplication {
						constructor(...args){ super(...args); }
						static get defaultOptions() {
							return foundry.utils.mergeObject(super.defaultOptions, {
								id: "bbmm-exclusions-manager",
								title: LT.titleExclusionsMgr(),
								template: null, 
								width: 600
							});
						}
						async render(...args) {
							await openExclusionsManager();
							return this;
						}
						async _updateObject() {}
					}
				});
				
				//  Inclusions Manager menu 
				game.settings.registerMenu(BBMM_ID, "menuInclusionsManager", {
					name: LT.inclusions.btnInclusionMgr(),
					label: LT.inclusions.btnInclusionMgr(),
					icon: "fas fa-list-check",
					restricted: true,
					type: class extends FormApplication {
						constructor(...args){ super(...args); }
						static get defaultOptions() {
							return foundry.utils.mergeObject(super.defaultOptions, {
								id: "bbmm-inclusions-manager-opener",
								title: LT.inclusions.btnInclusionMgr(),
								template: null, // We'll open our own UI (DialogV2/App), no form tpl needed
								width: 600
							});
						}
						async render(...args) {
							try {
								DL("settings.js | Inclusions Manager button clicked");
								await openInclusionsManagerApp();
							} catch (err) {
								DL(2, "settings.js | Inclusions Manager open failed", err);
								ui.notifications?.error(LT.inclusionsOpenError());
							}
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
				game.settings.register?.(BBMM_ID, CTRL_TOGGLE, {
					name: LT.controlsToggleName(),
					hint: LT.controlsToggleHint(),
					scope: "world", config: true, type: Boolean, default: true
				});
				
				// Choices for lock-gestures 
				const GESTURE_ACTION_CHOICES = {
					"lockSelected": LT.name_LockSelected(),
					"softLock": LT.name_SoftLock(),
					"lockAll": LT.name_LockAll(),
					"clearLocks": LT.name_ClearLocks()
				};

				// Set action for "Click" (default: lock selected)
				game.settings.register(BBMM_ID, "gestureAction_click", {
					name: LT.name_SetActionClick(),
					scope: "world",
					restricted: true,
					config: true,
					type: String,
					choices: GESTURE_ACTION_CHOICES,
					default: "lockSelected",
					onChange: v => DL(`settings.js | gestureAction_click -> ${v}`)
				});

				// Set action for "Right-Click" (default: lock all)
				game.settings.register(BBMM_ID, "gestureAction_right", {
					name: LT.name_SetActionRightClick(),
					scope: "world",
					restricted: true,
					config: true,
					type: String,
					choices: GESTURE_ACTION_CHOICES,
					default: "lockAll",
					onChange: v => DL(`settings.js | gestureAction_right -> ${v}`)
				});

				// Set action for "Shift+Click" (default: soft lock)
				game.settings.register(BBMM_ID, "gestureAction_shift", {
					name: LT.name_SetActionShiftClick(),
					scope: "world",
					restricted: true,
					config: true,
					type: String,
					choices: GESTURE_ACTION_CHOICES,
					default: "softLock",
					onChange: v => DL(`settings.js | gestureAction_shift -> ${v}`)
				});

				// Set action for Shift+Right-Click (default: clearLocks)
				game.settings.register(BBMM_ID, "gestureAction_shiftRight", {
					name: LT.name_SetActionShiftRightClick(),
					scope: "world",
					restricted: true,
					config: true,
					type: String,
					choices: GESTURE_ACTION_CHOICES,
					default: "clearLocks",
					onChange: v => DL(`settings.js | gestureAction_shiftRight -> ${v}`)
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
		}
	} catch (err) {
		DL(3, "settings.js | init() error", err);
	}
});

Hooks.on("setup", () => DL("settings.js | setup fired"));
Hooks.once("ready", async () => {
	
	DL("settings.js | ready fired");

	//check folder migration
	try { await checkFolderMigration();} catch (err) {DL(3, "settings.js | Compendium folder migration failed:", err?.message ?? err);}

	if (!isFoundryV12()){
		// Hook into settings and manage modules window to add app button in header 
		Hooks.on("renderSettingsConfig", (app, html) => injectBBMMHeaderButton(html));
		Hooks.on("renderModuleManagement", (app, html) => injectBBMMHeaderButton(html));
		await migrationV1Check(); // mivgrationV1
	}
});

// For use in macro for easy testing
window.openBBMMLauncher = openBBMMLauncher;