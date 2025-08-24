import { openPresetManager } from './presets.js';
import { openSettingsPresetManager } from './settings-presets.js';

const MM_ID = "bbmm";
const MODULE_SETTING_PRESETS = "module-presets";  
const SETTING_SETTINGS_PRESETS = "settingsPresets"; 
//	Function for debugging
export function debugLog(intLogType, stringLogMsg, objObject = null) {
	
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
				console.log(`%cBBMM [${timestamp}] | ${formattedLogMsg}`, "color: green; font-weight: bold;", objObject);
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
				console.log(`%cBBMM [${timestamp}] | ${formattedLogMsg}`, "color: green; font-weight: bold;");
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

Hooks.once("init", () => {
	
	// Module Presets button
	game.settings.register(MM_ID, MODULE_SETTING_PRESETS, {
		name: "Module Presets",
		hint: "Stored module enable/disable presets.",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});
	
	// Settings Presets button
	game.settings.register(MM_ID, SETTING_SETTINGS_PRESETS, {
		name: "Settings Presets",
		hint: "Stored module enable/disable presets.",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

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
		restricted: false,
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

Hooks.on("setup", () => debugLog("settings.js | setup fired"));
Hooks.once("ready", () => debugLog("settings.js | ready fired"));

// Open a small chooser dialog, then launch the selected manager
export async function openBBMMLauncher() {
	debugLog("openBBMMLauncher()");

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

	debugLog(`openBBMMLauncher(): choice = ${choice}`);

	if (choice === "modules") {
		openPresetManager();
	} else if (choice === "settings") {
		openSettingsPresetManager();
	} 
	// "cancel" → do nothing
}

// Add button to module managment screen
Hooks.on("renderModuleManagement", (app, html/*HTMLElement*/) => {
	
	debugLog(`renderModuleManagement hook fired!`);
	
	// Robust root + footer lookup
	const root = html instanceof HTMLElement ? html : (html?.[0] ?? null);
	if (!root) return;
	const footer = root.querySelector("footer.form-footer");
	if (!footer) return;

	// Prevent duplicates
	if (footer.querySelector(".bbmm-btn")) return;

	// Create button
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "bbmm-btn";
	btn.innerHTML = `<i class="fa-solid fa-layer-group"></i> BBMM`;

	// Click → open your manager
	btn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		openBBMMLauncher();
	});

	// Append at the end (next to “Deactivate All Modules”)
	footer.appendChild(btn);
});

window.openBBMMLauncher = openBBMMLauncher;