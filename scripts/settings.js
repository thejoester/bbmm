import { openPresetManager } from './module-presets.js';
import { openSettingsPresetManager } from './settings-presets.js';
import { LT, BBMM_ID } from "./localization.js";
import { openInclusionsManagerApp } from "./inclusions.js";
import { hlp_readUserExclusions } from "./exclusions.js";
import { hlp_openManualByUuid, hlp_injectHeaderHelpButton } from "./helpers.js";

export const MODULE_SETTING_PRESETS_U = "modulePresetsUser";  
export const SETTING_SETTINGS_PRESETS_U = "settingsPresetsUser"; 
const BBMM_COMP_FOLDER_NAME = "Big Bad Module Manager";
export const BBMM_README_UUID = "Compendium.bbmm.bbmm-journal.JournalEntry.u3uUIp6Jfg8411Pn";
export const BBMM_MIGRATION_INSTRUCTIONS = "Compendium.bbmm.bbmm-journal.JournalEntry.u3uUIp6Jfg8411Pn.JournalEntryPage.fBhc3e12eZRtNnSd";

/* Controls Sync Globals ======================================================*/
export const CTRL_STORE_KEY = "userControlSync";				// world: { [id]: {rev, lock?, soft?} }
export const CTRL_REV_STORE = "softLockRevMap_controls";		// world: { [id]: number }
export const CTRL_TOGGLE = "enableControlSync";					// world: boolean

// Do not export these settings
export const EXPORT_SKIP = new Map([
	["bbmm", new Set(["settingsPresetsUser", "modulePresetsUser"])],
	["core", new Set(["moduleConfiguration", "compendiumConfiguration", "time"])],	
	["pf2e-alchemist-remaster-ducttape", new Set(["alchIndex"])] // Known large set, excluding for performance
]);

// Preset Storage Migration =====================================================
// !!! REMOVE after version 0.8.0 !!!
async function hlp_loadPresets() {
	if (!game.user.isGM) return; // GM Only	

	// constants
	const FLAG_INC = "inclusionsPersistentStorageMigration";
	const FLAG_EXC = "exclusionsPersistentStorageMigration";
	const FILE_INC = "user-inclusions.json";
	const FILE_EXC = "user-exclusions.json";
	const worldTitleRaw = String(game.world?.title || "Unknown World").trim();
	const worldTitle = worldTitleRaw || "Unknown World";

	/* ==================================================================
		HELPERS
	================================================================== */

	// Get storage URL for a given subdir and filename
	function storageUrl(subdir, filename) {
		return `modules/${BBMM_ID}/storage/${subdir}/${filename}`;
	}

	// Read object from storage file (returns null on failure/not found)
	async function readStorageObject(subdir, filename) {
		const url = storageUrl(subdir, filename);

		try {
			const res = await fetch(url, { cache: "no-store" });
			if (!res.ok) {
				// Avoid noisy logs for expected "missing file" cases
				if (res.status !== 404) {
					DL(2, `settings.js | hlp_loadPresets(): readStorageObject(): fetch not ok for "${url}" (${res.status})`);
				}
				return null;
			}
			const data = await res.json();
			return data;
		} catch (err) {
			DL(2, `settings.js | hlp_loadPresets(): readStorageObject(): failed for "${url}"`, err);
			return null;
		}
	}

	// Write object to storage file (returns true on success)
	async function writeStorageObject(subdir, filename, obj) {
		const payload = JSON.stringify(obj ?? {}, null, 2);
		const file = new File([payload], filename, { type: "application/json" });

		try {
			const res = await FilePicker.uploadPersistent(BBMM_ID, subdir, file, {}, { notify: false });
			if (!res || (!res.path && !res.url)) {
				DL(3, `settings.js | hlp_loadPresets(): writeStorageObject(): upload returned no path/url for "${subdir}/${filename}"`, res);
				return false;
			}
			DL(`settings.js | hlp_loadPresets(): writeStorageObject(): wrote "${subdir}/${filename}"`, res);
			return true;
		} catch (err) {
			DL(3, `settings.js | hlp_loadPresets(): writeStorageObject(): uploadPersistent failed for "${subdir}/${filename}"`, err);
			return false;
		}
	}

	// Check if storage file exists (fetchable)
	async function storageFileExistsIn(subdir, filename) {
		const dir = `modules/${BBMM_ID}/storage/${subdir}`;
		const url = storageUrl(subdir, filename);

		// Try browse first (more reliable in Foundry hosting)
		try {
			const res = await FilePicker.browse("data", dir);
			const files = Array.isArray(res?.files) ? res.files : [];
			if (files.some(f => String(f).endsWith(`/${filename}`))) return true;
		} catch (err) {
			DL(2, `settings.js | hlp_loadPresets(): storageFileExistsIn(): browse failed for "${dir}", falling back to fetch`, err);
		}

		// Fallback: fetch
		try {
			const res = await fetch(url, { cache: "no-store" });
			return res.ok;
		} catch {
			return false;
		}
	}

	// Sanitize inclusions object
	function sanitizeInclusions(raw) {
		const out = { settings: [], modules: [] };
		if (!raw || typeof raw !== "object") return out;

		if (Array.isArray(raw.settings)) {
			out.settings = raw.settings
				.filter(s => s && typeof s === "object")
				.map(s => ({
					namespace: String(s.namespace ?? "").trim(),
					key: String(s.key ?? "").trim()
				}))
				.filter(s => s.namespace && s.key);
		}

		if (Array.isArray(raw.modules)) {
			out.modules = raw.modules
				.filter(x => typeof x === "string")
				.map(x => x.trim())
				.filter(Boolean);
		}

		return out;
	}

	// Sanitize exclusions object
	function sanitizeExclusions(raw) {
		const out = { settings: [], modules: [] };
		if (!raw || typeof raw !== "object") return out;

		if (Array.isArray(raw.settings)) {
			out.settings = raw.settings
				.filter(s => s && typeof s === "object")
				.map(s => ({
					namespace: String(s.namespace ?? "").trim(),
					key: String(s.key ?? "").trim()
				}))
				.filter(s => s.namespace && s.key);
		}

		if (Array.isArray(raw.modules)) {
			out.modules = raw.modules
				.filter(x => typeof x === "string")
				.map(x => x.trim())
				.filter(Boolean);
		}

		return out;
	}

	// Merge two arrays of {namespace, key} objects, ensuring uniqueness
	function mergePairArraysUnique(targetArr, sourceArr) {
		const set = new Set(targetArr.map(s => `${s.namespace}::${s.key}`));
		let added = 0;

		for (const s of sourceArr) {
			const k = `${s.namespace}::${s.key}`;
			if (set.has(k)) continue;
			set.add(k);
			targetArr.push(s);
			added++;
		}

		return added;
	}

	// Merge two arrays of strings, ensuring uniqueness
	function mergeStringArraysUnique(targetArr, sourceArr) {
		const set = new Set(targetArr);
		let added = 0;

		for (const v of sourceArr) {
			if (set.has(v)) continue;
			set.add(v);
			targetArr.push(v);
			added++;
		}

		return added;
	}

	// Get all flags object
	function getFlags() {
		const obj = game.settings.get(BBMM_ID, "bbmmFlags");
		return obj && typeof obj === "object" ? { ...obj } : {};
	}

	// Check a flag; falsy if missing.
	function hasFlag(key) {
		return Boolean(getFlags()[key]);
	}

	// Set/merge a single flag without clobbering others.
	async function setFlag(key, value) {
		const current = getFlags();
		current[key] = value;
		await game.settings.set(BBMM_ID, "bbmmFlags", current);
	}

	/* ========================================================================= 
		Inclusions Migration
	========================================================================= */
	DL("settings.js | hlp_loadPresets(): inclusions migration check starting");

	
	if (!hasFlag(FLAG_INC)) {
		DL(2, "settings.js | hlp_loadPresets(): BEGINNING INCLUSIONS MIGRATION ---");

		const legacyRaw = game.settings.get(BBMM_ID, "userInclusions");
		const legacy = sanitizeInclusions(legacyRaw);

		DL(`settings.js | hlp_loadPresets(): exclusions legacy sanitized Settings: ${legacy.settings.length}, Modules: ${legacy.modules.length}`, {
			legacySettings: legacy.settings,
			legacyModules: legacy.modules
		});

		// Ensure persistent storage file exists (do not overwrite if it already exists)
		const incExists = await storageFileExistsIn("lists", FILE_INC);
		if (!incExists) {
			try { await writeStorageObject("lists", FILE_INC, { settings: [], modules: [] }); DL("settings.js | hlp_loadPresets(): Created inclusions storage file"); }
			catch (err) { DL(3, "settings.js | hlp_loadPresets(): FAILED ensuring inclusions storage file exists:", err);}
		}

		const storageRaw = await readStorageObject("lists", FILE_INC);
		const storage = sanitizeInclusions(storageRaw);

		DL("settings.js | hlp_loadPresets(): inclusions storage sanitized", {
			storageSettings: storage.settings.length,
			storageModules: storage.modules.length
		});

		let addedSettings = 0;
		let addedModules = 0;

		if (legacy.settings.length) {
			addedSettings = mergePairArraysUnique(storage.settings, legacy.settings);
			DL("settings.js | hlp_loadPresets(): inclusions merged settings", { addedSettings });
		}

		if (legacy.modules.length) {
			addedModules = mergeStringArraysUnique(storage.modules, legacy.modules);
			DL("settings.js | hlp_loadPresets(): inclusions merged modules", { addedModules });
		}

		if (addedSettings || addedModules) {
			const ok = await writeStorageObject("lists", FILE_INC, storage);
			if (ok) {
				await setFlag(FLAG_INC, true);
				DL("settings.js | hlp_loadPresets(): migrated inclusions to storage", { addedSettings, addedModules });
			} else {
				DL(3, "settings.js | hlp_loadPresets(): FAILED migrating inclusions to storage (flag not set, will retry next start)");
			}
		} else {
			await setFlag(FLAG_INC, true);
			DL("settings.js | hlp_loadPresets(): no inclusions to migrate (or all duplicates), flag set");
		}
	} else {
		DL("settings.js | hlp_loadPresets(): SKIPPING INCLUSIONS MIGRATION - flag already set");
	}

	/* ========================================================================= 
		Exclusions Migration
	========================================================================= */
	DL("settings.js | hlp_loadPresets(): EXCLUSIONS MIGRATION CHECK:");

	// await ensureStorageFileIn("lists", FILE_EXC, { settings: [], modules: [] });

	if (!hasFlag(FLAG_EXC)) {
		DL(2, "settings.js | hlp_loadPresets(): BEGINNING EXCLUSIONS MIGRATION ---");

		const legacyRaw = game.settings.get(BBMM_ID, "userExclusions");
		const legacy = sanitizeExclusions(legacyRaw);

		// Ensure persistent storage file exists (do not overwrite if it already exists)
		const excExists = await storageFileExistsIn("lists", FILE_EXC);
		if (!excExists) {
			try { await writeStorageObject("lists", FILE_EXC, { settings: [], modules: [] }); DL("settings.js | hlp_loadPresets(): Created exclusions storage file"); }
			catch (err) { DL(3, "settings.js | hlp_loadPresets(): FAILED ensuring exclusions storage file exists:", err);}
		}

		DL(`settings.js | hlp_loadPresets(): exclusions legacy sanitized Settings: ${legacy.settings.length}, Modules: ${legacy.modules.length}`, {
			legacySettings: legacy.settings,
			legacyModules: legacy.modules
		});

		const storageRaw = await readStorageObject("lists", FILE_EXC);
		const storage = sanitizeExclusions(storageRaw);

		DL("settings.js | hlp_loadPresets(): exclusions storage sanitized", {
			storageSettings: storage.settings.length,
			storageModules: storage.modules.length
		});

		let addedSettings = 0;
		let addedModules = 0;

		if (legacy.settings.length) {
			addedSettings = mergePairArraysUnique(storage.settings, legacy.settings);
			DL("settings.js | hlp_loadPresets(): exclusions merged settings", { addedSettings });
		}

		if (legacy.modules.length) {
			addedModules = mergeStringArraysUnique(storage.modules, legacy.modules);
			DL("settings.js | hlp_loadPresets(): exclusions merged modules", { addedModules });
		}

		if (addedSettings || addedModules) {
			const ok = await writeStorageObject("lists", FILE_EXC, storage);
			if (ok) {
				await setFlag(FLAG_EXC, true);
				DL("settings.js | hlp_loadPresets(): migrated exclusions to storage", { addedSettings, addedModules });
			} else {
				DL(3, "settings.js | hlp_loadPresets(): FAILED migrating exclusions to storage (flag not set, will retry next start)");
			}
		} else {
			await setFlag(FLAG_EXC, true);
			DL("settings.js | hlp_loadPresets(): no exclusions to migrate (or all duplicates), flag set");
		}
	} else {
		DL("settings.js | hlp_loadPresets(): SKIPPING EXCLUSIONS MIGRATION - flag already set");
	}
}

// Check folder migration 
// !!! REMOVE  after version 0.7.0 !!!
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

// Show notice that presets have moved to their own module
// !!! REMOVE  after version 0.8.0 !!!
async function showPresetsMovedNotice() {
	
	if (!game.user.isGM) return;

	const flags = game.settings.get(BBMM_ID, "bbmmFlags");
	if (flags && typeof flags === "object" && flags["0.6.0-hidepresetnotice"]) return;

	const content = `
		<style>
			.bbmm-presets-moved-notice-dialog .window-content{
				padding:.5rem .75rem !important;
			}
			.bbmm-presets-moved-notice-dialog .bbmm-presets-moved-notice p{
				margin:0;
			}

			/* Stop the equal-width button crime */
			.bbmm-presets-moved-notice-dialog .dialog-buttons{
				display:flex;
				gap:.5rem;
				justify-content:flex-end;
				flex-wrap:wrap;
			}
			.bbmm-presets-moved-notice-dialog .dialog-buttons .dialog-button{
				flex:0 0 auto;
				width:auto;
				min-width:140px;
			}
		</style>

		<div class="bbmm-presets-moved-notice">
			<h2>${LT.presetNoticePleaseRead()}</h2>
			<p>${LT.presetNoticeBody()}</p>
		</div>
	`;

	new foundry.applications.api.DialogV2({
		window: { title: LT.presetNoticeTitle() },
		classes: ["bbmm-presets-moved-notice-dialog"],
		content,
		buttons: [
			{
				action: "docs",
				label: LT.presetNoticeOpenDocs(),
				icon: "fas fa-book-open",
				callback: () => {
					try {
						hlp_openManualByUuid(BBMM_MIGRATION_INSTRUCTIONS);
						DL("settings.js | showPresetsMovedNotice(): opened BBMM manual journal");
					} catch (err) {
						DL(3, "settings.js | showPresetsMovedNotice(): failed to open manual journal", err);
					}
				}
			},
			{
				action: "dontShowAgain",
				label: LT.presetNoticeDontShowAgain(),
				icon: "fas fa-eye-slash",
				callback: async (_event, _button, dialog) => {
					try {
						const current = game.settings.get(BBMM_ID, "bbmmFlags");
						const next = (current && typeof current === "object") ? { ...current } : {};
						next["0.6.0-hidepresetnotice"] = true;
						await game.settings.set(BBMM_ID, "bbmmFlags", next);
						DL("settings.js | showPresetsMovedNotice(): user hid preset notice");
					} catch (err) {
						DL(3, "settings.js | showPresetsMovedNotice(): failed to set hide flag", err);
					} finally {
						dialog?.close();
					}
				}
			},
			{
				action: "close",
				label: LT.presetNoticeClose(),
				default: true
			}
		],
		rejectClose: false,
		position: { width: 560, height: "auto" }
	}).render(true);
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

//  Inject BBMM button into a Foundry window header
export function injectBBMMHeaderButton(root) {
	
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

	// Prevent duplicate header menu
	if (controls.querySelector(".bbmm-header-menu-btn")) return;

	// Create main button (looks like a normal header control)
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "header-control bbmm-header-menu-btn";
	btn.setAttribute("data-tooltip", LT.buttons.bbmmBtnToolTip());
	btn.setAttribute("aria-label", LT.buttons.bbmmBtnToolTip());
	btn.innerHTML = `<i class="fa-solid fa-layer-group"></i><span>BBMM</span><i class="fa-solid fa-caret-down"></i>`;


	// Create dropdown menu, but attach it to BODY so it doesn't get clipped by the header
	const menu = document.createElement("div");
	menu.className = "bbmm-header-dropdown";
	menu.hidden = true;

	const isGM = game.user.isGM;

	const items = isGM
		? [
			{ action: "modules", label: LT.modulePresetMgr(), onClick: () => openPresetManager() },
			{ action: "settings", label: LT.settingsPresetMgr(), onClick: () => openSettingsPresetManager() },
			{ action: "exclusions", label: LT.exclusionsMgr(), onClick: () => openExclusionsManager() },
			{ action: "inclusions", label: LT.inclusionsMgr(), onClick: () => openInclusionsManagerApp() },
			{ action: "hiddenSettings", label: LT.hiddenSettingSync.menuLabel(), onClick: () => openhiddenSettingSyncManager() },
			{ action: "help", label: (LT.buttons.help?.() ?? "Help"), onClick: () => hlp_openManualByUuid(BBMM_README_UUID) }
		]
		: [
			{ action: "settings", label: LT.settingsPresetMgr(), onClick: () => openSettingsPresetManager() },
			{ action: "help", label: (LT.buttons.help?.() ?? "Help"), onClick: () => hlp_openManualByUuid(BBMM_README_UUID) }
		];

	for (const it of items) {
		const mi = document.createElement("button");
		mi.type = "button";
		mi.className = "bbmm-header-item";
		mi.dataset.action = it.action;
		mi.textContent = it.label;

		mi.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			menu.hidden = true;

			try {
				it.onClick();
			} catch (e) {
				DL(3, `settings.js | BBMM header dropdown: click failed (${it.action})`, e);
			}
		});

		menu.appendChild(mi);
	}

	// Position menu under the button (fixed, so no clipping)
	function positionMenu() {
		const r = btn.getBoundingClientRect();
		menu.style.top = `${Math.round(r.bottom + 4)}px`;

		// Align RIGHT edge of menu to RIGHT edge of button
		let left = r.right - menu.offsetWidth;

		// Clamp to viewport
		left = Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8));

		menu.style.left = `${Math.round(left)}px`;
	}

	btn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		menu.hidden = !menu.hidden;
		if (!menu.hidden) {
			positionMenu();
		}
	});

	// Close menu when clicking elsewhere
	const onDocClick = (ev) => {
		if (ev.target === btn || menu.contains(ev.target)) return;
		menu.hidden = true;
	};
	document.addEventListener("click", onDocClick, { capture: true });

	// Reposition on resize/scroll while open
	const onWindowMove = () => {
		if (!menu.hidden) positionMenu();
	};
	window.addEventListener("resize", onWindowMove);
	window.addEventListener("scroll", onWindowMove, true);

	// Cleanup when the window is removed from DOM
	const obs = new MutationObserver(() => {
		if (!document.body.contains(root)) {
			try {
				document.removeEventListener("click", onDocClick, { capture: true });
			} catch (e) {}
			try {
				window.removeEventListener("resize", onWindowMove);
				window.removeEventListener("scroll", onWindowMove, true);
			} catch (e) {}
			try {
				menu.remove();
			} catch (e) {}
			obs.disconnect();
		}
	});
	obs.observe(document.body, { childList: true, subtree: true });

	// Insert before the Close button if present
	const closeBtn = controls.querySelector('button.header-control[data-action="close"]');
	if (closeBtn) controls.insertBefore(btn, closeBtn);
	else controls.appendChild(btn);

	// Add dropdown to body
	document.body.appendChild(menu);

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
			.bbmm-header-dropdown {
				position: fixed;
				z-index: 100000;
				display: flex;
				flex-direction: column;
				min-width: 260px;
				padding: .75rem;
				border: 1px solid var(--color-border-dark, #491313ff);
				border-radius: 0.6rem;
				background: var(--color-bg, #111);
				box-shadow: 0 6px 16px rgba(0,0,0,0.45);
			}
			.bbmm-header-item {
				text-align: left;
				padding: 0.5rem 0.75rem;
				border-radius: 0.4rem;
				white-space: nowrap;
				font-size: 0.95rem;
				line-height: 1.2;
			}
			.bbmm-header-item:hover {
				background: rgba(255,255,255,0.08);
			}
		`;
		document.head.appendChild(style);
	}

	DL("settings.js | BBMM header dropdown injected");
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

// Open Hidden Client Setting Sync Manager
export function openhiddenSettingSyncManager() {
	DL("settings.js | openhiddenSettingSyncManager(): fired");
	try {
		const fn = globalThis.bbmm?.openhiddenSettingSyncManagerApp;
		if (typeof fn === "function") return fn();
		DL(3, "settings.js | openhiddenSettingSyncManager(): launcher not found");
	} catch (err) {
		DL(3, "settings.js | openhiddenSettingSyncManager(): failed", err);
	}
}

// Open a small chooser dialog, then launch the selected manager
// Open a small chooser dialog, then launch the selected manager
export async function openBBMMLauncher() {
	DL("settings.js | openBBMMLauncher()");

	const choice = await new Promise((resolve) => {
		(async () => {
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
					{ action: "hiddenSettings",   label: LT.hiddenSettingSync.menuLabel() },
					{ action: "cancel",   label: LT.buttons.cancel() }
				],
				submit: (res) => resolve(res ?? "cancel"),
				rejectClose: false,
				position: { width: 400, height: "auto" }
			});

			// Render FIRST so dlg.element exists
			await dlg.render(true);

			// Inject help button into title bar AFTER render
			try {
				hlp_injectHeaderHelpButton(dlg, {
					uuid: BBMM_README_UUID,
					iconClass: "fas fa-circle-question",
					title: LT.buttons.help?.() ?? "Help"
				});
			} catch (e) {
				DL(2, "settings.js | openBBMMLauncher(): help injection failed", e);
			}
		})();
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
	} else if (choice === "hiddenSettings") {
		openhiddenSettingSyncManager();
	}
	// "cancel" -> do nothing
}

Hooks.once("init", () => {

	try {
		// ===== FLAGS ======
			// Setting to hold module flags
			game.settings.register(BBMM_ID, "bbmmFlags", {
				name: LT._settings.bbmmFlags_name(),
				hint: LT._settings.bbmmFlags_hint(),
				scope: "world",
				config: false,
				type: Object,
				default: {}	
			});

		// ====== HIDDEN VARIABLES ===== 
		// These do not need to be localized
			// User Exclusions 
			game.settings.register(BBMM_ID, "userExclusions", {
				name: LT._settings.userExclusions_name(),
				hint: LT._settings.userExclusions_hint(),
				scope: "world",	
				config: false,	
				type: Object,
				default: { modules: [], settings: [] }
			});

			// User Inclusions (hidden settings to include when saving presets)
			game.settings.register(BBMM_ID, "userInclusions", {
				name: LT._settings.userInclusions_name(),
				hint: LT._settings.userInclusions_hint(),
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// User scoped Settings presets
			game.settings.register(BBMM_ID, SETTING_SETTINGS_PRESETS_U, {
				name: LT._settings.settingsPresetsUser_name(),
				hint: LT._settings.settingsPresetsUser_hint(),
				scope: "user",
				config: false,
				type: Object,
				default: {}
			});

			// User scoped Module Presets
			game.settings.register(BBMM_ID, MODULE_SETTING_PRESETS_U, {
				name:  LT._settings.modulePresetsUser_name(),
				hint: LT._settings.modulePresetsUser_hint(),
				scope: "user",
				config: false,
				type: Object,
				default: {}
			});

			// HIDDEN World map of { [moduleId]: "x.y.z" } that we've marked as seen
			game.settings.register(BBMM_ID, "seenChangelogs", {
				name: LT._settings.seenChangelogs_name(),
				hint: LT._settings.seenChangelogs_hint(),
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// User map of soft-locked settings
			game.settings.register(BBMM_ID, "userSettingSync", {
				name: LT._settings.userSettingSync_name(),
				hint: LT._settings.userSettingSync_hint(),
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// User-scoped ledger: remembers which soft-lock value was last auto-applied per setting id
			game.settings.register(BBMM_ID, "softLockLedger", {
				name: LT._settings.softLockLedger_name(),
				hint: LT._settings.softLockLedger_hint(),
				scope: "user",
				config: false,
				type: Object,
				default: {}	// { "<namespace>.<key>": <serializedValue> }
			});

			// persistant soft-lock rev map - Master list of soft lock values and revisions
			game.settings.register(BBMM_ID, "softLockRevMap", {
				name: LT._settings.softLockRevMap_name(),
				hint: LT._settings.softLockRevMap_hint(),
				scope: "world",
				config: false,
				type: Object,
				default: {}
			});

			// Controls Sync Storage
			game.settings.register?.(BBMM_ID, CTRL_STORE_KEY, {
				name: LT._settings.userControlSync_name(),
				hint: LT._settings.userControlSync_hint(),
				scope: "world", 
				config: false, 
				default: {}
			});

			// Controls Sync RevMap
			game.settings.register?.(BBMM_ID, CTRL_REV_STORE, {
				name: LT._settings.softLockRevMap_controls_name(),
				hint: LT._settings.softLockRevMap_controls_hint(),
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

			// Module Management - Notes
			game.settings.register("bbmm", "moduleNotes", {
				name: LT._settings.moduleNotes_name(),
				hint: LT._settings.moduleNotes_hint(),
				scope: "world",
				config: false,
				type: Object,
				default: {}
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
				name: game.i18n.localize("bbmm.settings.moduleLocksName"),
				hint: game.i18n.localize("bbmm.settings.moduleLocksHint"),
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

			// Hidden Client Setting Sync Manager menu
			game.settings.registerMenu(BBMM_ID, "hiddenSettingSyncManager", {
				name: LT.hiddenSettingSync?.menuName?.() ?? "Hidden Client Setting Sync",
				label: LT.hiddenSettingSync?.menuLabel?.() ?? "Open Manager",
				icon: "fas fa-user-gear",
				restricted: true,
				type: class extends FormApplication {
					constructor(...args){ super(...args); }
					static get defaultOptions() {
						return foundry.utils.mergeObject(super.defaultOptions, {
							id: "bbmm-hidden-client-sync-opener",
							title: LT.hiddenSettingSync?.title?.() ?? "Hidden Client Setting Sync",
							template: null,
							width: 600
						});
					}
					async render(...args) {
						try {
							const fn = globalThis.bbmm?.openhiddenSettingSyncManagerApp;

							if (typeof fn !== "function") {
								DL(3, "settings.js | openhiddenSettingSyncManager(): global opener not found", globalThis.bbmm);
								ui.notifications?.error(LT.hiddenSettingSync?.openError?.() ?? "Hidden Client Sync Manager not available.");
								return this;
							}

							fn();
						} catch (err) {
							DL(2, "settings.js | Hidden Client Sync Manager open failed", err);
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

			// Enable/disable BBMM Controls Sync
			game.settings.register?.(BBMM_ID, CTRL_TOGGLE, {
				name: LT.controlsToggleName(),
				hint: LT.controlsToggleHint(),
				scope: "world", config: true, type: Boolean, default: true
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
			
			game.settings.register(BBMM_ID, "autoForceReload", {
				name: LT._settings.autoForceReloadName(),
				hint: LT._settings.autoForceReloadHint(),
				scope: "world",
				config: true,
				type: Boolean,
				default: false
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

Hooks.on("setup", () => {
	DL("settings.js | setup fired");
});

Hooks.once("ready", async () => {
	
	DL("settings.js | ready fired");

	// migrate inclusions/exclusions to storage - Remove after version 0.8.0
	try { await hlp_loadPresets(); DL(`settings.js | Inclusions/Exclusions migrated`)} catch (err) { DL(3, "settings.js | Inclusions/Exclusions migration failed:", err?.message ?? err); }

	// Prime exclusions cache for getSkipMap() users
	try { await hlp_readUserExclusions(); } catch (err) { DL(2, "settings.js | ready | preload exclusions failed", err); }1

	// check folder migration - Remove after version 0.7.0
	try { await checkFolderMigration();} catch (err) {DL(3, "settings.js | Compendium folder migration failed:", err?.message ?? err);}

	// show presets moved notice - Remove after version 0.8.0
	try { await showPresetsMovedNotice(); } catch (err) { DL(2, "settings.js | ready | presets moved notice failed", err); }
	
	// Hook into settings and manage modules window to add app button in header 
	Hooks.on("renderSettingsConfig", (app, html) => injectBBMMHeaderButton(html));
	Hooks.on("renderModuleManagement", (app, html) => injectBBMMHeaderButton(html));
	
});

// For use in macro for easy testing
window.openBBMMLauncher = openBBMMLauncher;