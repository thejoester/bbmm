import { openPresetManager } from './presets.js';
const MM_ID = "bbmm";
const SETTING_PRESETS = "presets";  // { [name]: string[] }  enabled module ids

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
				console.log(`%cTheJoester's Module Management [${timestamp}] | ${formattedLogMsg}`, "color: green; font-weight: bold;", objObject);
				break;
			case 2: // Warning
				console.log(`%cTheJoester's Module Management [${timestamp}] | WARNING: ${formattedLogMsg}`, "color: orange; font-weight: bold;", objObject);
				break;
			case 3: // Critical/Error
				console.log(`%cTheJoester's Module Management [${timestamp}] | ERROR: ${formattedLogMsg}`, "color: red; font-weight: bold;", objObject);
				break;
			default:
				console.log(`%cTheJoester's Module Management [${timestamp}] | ${formattedLogMsg}`, "color: aqua; font-weight: bold;", objObject);
		}
	} else {
		switch (intLogType) {
			case 1: // Info/Log (all)
				console.log(`%cTheJoester's Module Management [${timestamp}] | ${formattedLogMsg}`, "color: green; font-weight: bold;");
				break;
			case 2: // Warning
				console.log(`%cTheJoester's Module Management [${timestamp}] | WARNING: ${formattedLogMsg}`, "color: orange; font-weight: bold;");
				break;
			case 3: // Critical/Error
				console.log(`%cTheJoester's Module Management [${timestamp}] | ERROR: ${formattedLogMsg}`, "color: red; font-weight: bold;");
				break;
			default:
				console.log(`%cTheJoester's Module Management [${timestamp}] | ${formattedLogMsg}`, "color: aqua; font-weight: bold;");
		}
	}
}

Hooks.once("init", () => {
	
	// Store presets as a world setting (object map name->array)
	game.settings.register(MM_ID, SETTING_PRESETS, {
		name: "Presets",
		hint: "Stored module enable/disable presets.",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Add a menu entry in Configure Settings to open the Preset Manager
	game.settings.registerMenu(MM_ID, "presetManager", {
		name: "Module Presets",
		label: "Open Module Preset Manager",
		icon: "fas fa-layer-group",
		restricted: true,
		type: class extends FormApplication {
			constructor(...args){ super(...args); }
			static get defaultOptions() {
				return foundry.utils.mergeObject(super.defaultOptions, {
					id: "mmplus-preset-manager",
					title: "Module Management+ — Presets",
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