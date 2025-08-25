import { openPresetManager } from './module-presets.js';
import { openSettingsPresetManager } from './settings-presets.js';

const MM_ID = "bbmm";
const MODULE_SETTING_PRESETS = "module-presets";  
const SETTING_SETTINGS_PRESETS = "settingsPresets"; 
const MODULE_SETTING_PRESETS_U = "modulePresetsUser";  
const SETTING_SETTINGS_PRESETS_U = "settingsPresetsUser"; 

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
	const debugLevel = game.settings.get(MM_ID, "debugLevel");

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
		DL(2, "BBMM header injection: no root element found");
		return;
	}

	// Find header and its controls bucket
	const header = root.querySelector("header.window-header");
	if (!header) {
		DL(2, "BBMM header injection: no header found");
		return;
	}
	const controls = header.querySelector(".window-controls") || header;

	// Prevent duplicate header button
	if (controls.querySelector(".bbmm-header-btn")) return;

	// Create header button
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "header-control bbmm-header-btn";
	btn.setAttribute("data-tooltip", "Open Big Bad Module Manager");
	btn.setAttribute("aria-label", "Open Big Bad Module Manager");
	btn.innerHTML = `<i class="fa-solid fa-layer-group"></i><span>BBMM</span>`;

	btn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		if (game.user.isGM) {
			DL("Opening BBMM Launcher from header button");
			openBBMMLauncher();
		} else {
			DL("Opening BBMM Settings Preset Manager from header button");
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

	DL("BBMM header button injected");
}

// Open a small chooser dialog, then launch the selected manager
export async function openBBMMLauncher() {
	DL("openBBMMLauncher()");

	const choice = await new Promise((resolve) => {
		const dlg = new foundry.applications.api.DialogV2({
			window: { title: "Big Bad Module Manager" },
			content: `
				<div style="min-width:420px;display:flex;flex-direction:column;gap:.75rem;">
					<p class="notes">Choose which manager to open:</p>
				</div>
			`,
			buttons: [
				{ action: "modules",	label: "Module Preset Manager",	default: true, callback: () => "modules" },
				{ action: "settings",	label: "Settings Preset Manager", callback: () => "settings" },
				{ action: "cancel",		label: "Cancel" , callback: () => "cancel" }
			],
			submit: (res/*, _ev, _btn*/) => resolve(res ?? "cancel"),
			rejectClose: false,
			render: (app) => {
				// make the standard footer vertical
				const form = app.element?.querySelector("form");
				const footer = form?.querySelector("footer");
				if (footer) {
					footer.style.display = "flex";
					footer.style.flexDirection = "column";
					footer.style.gap = ".5rem";
					footer.style.alignItems = "stretch";
				}
			}
		});
		dlg.render(true);
	});

	DL(`openBBMMLauncher(): choice = ${choice}`);

	if (choice === "modules") {
		openPresetManager();
	} else if (choice === "settings") {
		openSettingsPresetManager();
	} 
	// "cancel" → do nothing
}

/*  Migrationv1 Checker
	- Migrates users of v0.0.7 and below from WORLD scoped preset
	  data to USER scoped preset data. 
*/
async function migrationV1Check() {
	if (!game.user.isGM) return; // Only needed for GMs
	
	try {
		const migrated = game.settings.get(MM_ID, "migratedPresetsV1");
		if (!migrated) {
			const oldModule = game.settings.get(MM_ID, MODULE_SETTING_PRESETS) ?? {};
			const oldSetting = game.settings.get(MM_ID, SETTING_SETTINGS_PRESETS) ?? {};

			if (Object.keys(oldModule).length) {
				await game.settings.set(MM_ID, MODULE_SETTING_PRESETS_U, oldModule);
				DL("migrationV1Check(): migrated module presets to user scope");
			}
			if (Object.keys(oldSetting).length) {
				await game.settings.set(MM_ID, SETTING_SETTINGS_PRESETS_U, oldSetting);
				DL("migrationV1Check(): migrated setting presets to user scope");
			}

			await game.settings.set(MM_ID, "migratedPresetsV1", true);
			DL("migrationV1Check(): migration complete, flag set");
		}
	} catch (err) {
		DL(3, "migrationV1Check(): migration error", err);
	}
	
}

// Hook into settings and manage modules window to add app button in header 
Hooks.on("renderSettingsConfig", (app, html) => injectBBMMHeaderButton(html));
Hooks.on("renderModuleManagement", (app, html) => injectBBMMHeaderButton(html));

Hooks.once("init", () => {
	
// ===== FLAGS ======
	//	World-scoped one-time migration flag
	game.settings.register(MM_ID, "migratedPresetsV1", {
		name: "BBMM Migration Flag",
		scope: "world",
		config: false,
		type: Boolean,
		default: false
	});
// ====== HIDDEN VARIABLES ===== 
	// User scoped Settings presets
	game.settings.register(MM_ID, MODULE_SETTING_PRESETS_U, {
		name: "Module Presets (User)",
		hint: "User-scoped stored module enable/disable presets.",
		scope: "user",
		config: false,
		type: Object,
		default: {}
	});

	// User scoped Module Presets
	game.settings.register(MM_ID, SETTING_SETTINGS_PRESETS_U, {
		name: "Settings Presets (User)",
		hint: "User-scoped stored settings presets.",
		scope: "user",
		config: false,
		type: Object,
		default: {}
	});

	// OLD Settings Presets 
	game.settings.register(MM_ID, MODULE_SETTING_PRESETS, {
		name: "Module Presets",
		hint: "Stored module enable/disable presets.",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});
	
	// OLD world Presets 
	game.settings.register(MM_ID, SETTING_SETTINGS_PRESETS, {
		name: "Settings Presets",
		hint: "Stored module enable/disable presets.",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});
// ===== SETTINGS ITEMS =====
	// Add a menu entry in Configure Settings to open the Preset Manager
	game.settings.registerMenu(MM_ID, "modulePresetManager", {
		name: "Module Presets",
		label: "Open Module Preset Manager",
		icon: "fas fa-layer-group",
		restricted: true,
		type: class extends FormApplication {
			constructor(...args){ super(...args); }
			static get defaultOptions() {
				return foundry.utils.mergeObject(super.defaultOptions, {
					id: "bbmm-module-preset-manager",
					title: "BBBM Module Presets",
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
	game.settings.registerMenu(MM_ID, "settingsPresetManager", {
		name: "Settings Presets",
		label: "Open Settings Preset Manager",
		icon: "fas fa-layer-group",
		restricted: true,
		type: class extends FormApplication {
			constructor(...args){ super(...args); }
			static get defaultOptions() {
				return foundry.utils.mergeObject(super.defaultOptions, {
					id: "bbmm-settings-preset-manager",
					title: "BBBM Settings Presets",
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
	
	// Debug level for THIS module
	game.settings.register(MM_ID, "debugLevel", {
		name: "Debug Level",
		hint: "Logging: all, warn, error, none",
		scope: "world",
		config: true,
		type: String,
		choices: { all: "All", warn: "Warnings", error: "Errors", none: "None" },
		default: "all"
	});
});

Hooks.on("setup", () => DL("settings.js | setup fired"));
Hooks.once("ready", async () => {
	
	DL("settings.js | ready fired");

	// mivgrationV1
	await migrationV1Check();
});

// For use in macro for easy testing
window.openBBMMLauncher = openBBMMLauncher;