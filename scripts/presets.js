/* Module Management+ — Feature A: Presets (v13-safe)
   Rebuild by TheJoester & helper
   - Save / Load / Delete / Export / Import module presets
   - Uses DialogV2, no jQuery, v12/v13 compatible
*/

const MM_ID = "joesters-module-management";
const SETTING_PRESETS = "presets";  // { [name]: string[] }  enabled module ids

//	Function for debugging
function debugLog(intLogType, stringLogMsg, objObject = null) {
	
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

/*	=====	HELPERS =====
*/

// Open Dialog to export Module state json
async function exportCurrentModuleStateDialog() {
	new foundry.applications.api.DialogV2({
		window: { title: "Export Current Module State" },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">Export Name</label>
					<input name="exportName" type="text" placeholder="e.g. prod-setup" style="flex:1;">
				</div>
				<p class="notes">File will be named <code>module-state-{name}-{YYYYMMDD-HHMMSS}.json</code></p>
			</div>
		`,
		buttons: [
			{ action: "cancel", label: "Cancel" },
			{
				action: "ok",
				label: "Export",
				default: true,
				callback: (ev, button) => button.form.elements.exportName?.value?.trim() || ""
			}
		],
		submit: (_result) => {
			const baseName = _result;
			if (!baseName) { ui.notifications.warn("Please enter an export name."); return; }

			const stamp = timestampStr();
			const fname = `module-state-${slugify(baseName)}-${stamp}.json`;

			const enabled = getEnabledModuleIds();
			const versions = {};
			for (const id of enabled) versions[id] = game.modules.get(id)?.version ?? null;

			saveJSONFile({
				type: "mmplus-state",
				name: baseName,
				created: new Date().toISOString(),
				modules: enabled,
				versions
			}, fname);
		}
	}).render(true);
}

async function importModuleStateAsPreset(modules) {
	new foundry.applications.api.DialogV2({
		window: { title: "Import as Preset" },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">Preset Name</label>
					<input name="presetName" type="text" placeholder="e.g. staging" style="flex:1;">
				</div>
				<p class="notes">Preset will be saved as <code>{name}-{YYYYMMDD-HHMMSS}</code></p>
			</div>
		`,
		buttons: [
			{ action: "cancel", label: "Cancel" },
			{
				action: "ok",
				label: "Import",
				default: true,
				callback: (ev, button) => button.form.elements.presetName?.value?.trim() || ""
			}
		],
		submit: async (_result) => {
			const baseName = _result;
			if (!baseName) { ui.notifications.warn("Please enter a preset name."); return; }
			const key = `${slugify(baseName)}-${timestampStr()}`;

			const p = getPresets();
			p[key] = modules;
			await setPresets(p);
			
			// Now run integrity check
			const report = validateModuleState(modules);
			if (report.unknown.length || report.depIssues.length) {
				showImportIssuesDialog(report);
			}

			ui.notifications.info(`Imported preset "${key}" (${modules.length} modules).`);
			openPresetManager();
		}
	}).render(true);
}

// Tiny safe HTML escaper for labels/values
function esc(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	}[m]));
}

function slugify(s) {
	return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// get time stamp
function timestampStr(d = new Date()) {
	const p = (n, l=2) => String(n).padStart(l, "0");
	return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Helper to export to .json file
async function saveJSONFile(data, filename) {
	// 1) Foundry's native helper (best across Electron + browsers)
	if (typeof saveDataToFile === "function") {
		return saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
	}

	// 2) Modern browsers over HTTPS/localhost: File System Access API
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

function pickLocalJSONFile() {
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

// validate Module state JSON
function validateModuleState(modIds) {
	const unknown = [];		// { id, reason: "not installed" }
	const depIssues = [];	// { id, depId, reason: "dependency missing" }

	// 1) not installed
	for (const id of modIds) {
		if (!game.modules.has(id)) unknown.push({ id, reason: "not installed" });
	}

	// 2) required dependencies
	for (const id of modIds) {
		const mod = game.modules.get(id);
		if (!mod) continue; // already flagged above
		const requires = getRequiredIds(mod); // you already have this helper
		for (const depId of requires) {
			// Require it to be installed; you can also enforce "present in preset" if you prefer
			if (!game.modules.has(depId)) {
				depIssues.push({ id, depId, reason: "dependency missing" });
			}
		}
	}

	return { unknown, depIssues };
}

//	show import issues
function showImportIssuesDialog({ unknown, depIssues }) {
	if ((!unknown || unknown.length === 0) && (!depIssues || depIssues.length === 0)) return;

	const lines = [];

	if (unknown.length) {
		lines.push(`<p><b>Modules not installed:</b></p>`);
		lines.push(`<ul style="margin-top:.25rem;">${
			unknown.map(it => `<li><code>${esc(it.id)}</code> — Module not installed</li>`).join("")
		}</ul>`);
	}

	if (depIssues.length) {
		// Group by module → list missing deps
		const byMod = new Map();
		for (const it of depIssues) {
			if (!byMod.has(it.id)) byMod.set(it.id, []);
			byMod.get(it.id).push(it.depId);
		}
		lines.push(`<p><b>Dependencies missing:</b></p>`);
		lines.push(`<ul style="margin-top:.25rem;">${
			[...byMod.entries()].map(([id, deps]) =>
				`<li><code>${esc(id)}</code> → missing: ${deps.map(d => `<code>${esc(d)}</code>`).join(", ")}</li>`
			).join("")
		}</ul>`);
	}

	new foundry.applications.api.DialogV2({
		window: { title: "Import Check — Issues Detected" },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<p class="notes">The imported preset was saved, but the following issues were found:</p>
				${lines.join("\n")}
			</div>
		`,
		buttons: [{ action: "ok", label: "OK", default: true }]
	}).render(true);
}

/** Utility: read/set preset map */
function getPresets() {
	return foundry.utils.duplicate(game.settings.get(MM_ID, SETTING_PRESETS) || {});
}

async function setPresets(presets) {
	await game.settings.set(MM_ID, SETTING_PRESETS, presets);
}

/** Current enabled module ids (exclude core/system) */
function getEnabledModuleIds() {
	const list = [];
	for (const m of game.modules.values()) {
		// Only non-core modules (systems live elsewhere)
		if (m.active) list.push(m.id);
	}
	return list;
}

/** Read moduleConfiguration safely */
function getModuleConfig() {
	return foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
}

/** Apply a set of enabled ids -> update core.moduleConfiguration */
async function applyEnabledIds(enabledIds, {autoEnableDeps = true} = {}) {
	const config = getModuleConfig();

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
				const requires = getRequiredIds(mod);
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

/** Get required dependency ids declared by a module (v10+ manifest) */
function getRequiredIds(mod) {
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

//	Open Dialog to manage presets 
async function openPresetManager() {
	debugLog("openPresetManager: start");

	const presets = getPresets();
	debugLog("openPresetManager: presets loaded", presets);

	const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
	const options = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");

	const content = `
		<div style="min-width:520px;display:flex;flex-direction:column;gap:.75rem;">

			<div style="display:flex;gap:.5rem;align-items:center;">
				<label style="min-width:10rem;">Saved Presets</label>
				<select name="presetName" style="flex:1;">${options}</select>
				<button type="button" data-action="load">Load</button>
				<button type="button" data-action="delete">Delete</button>
			</div>

			<hr>

			<div style="display:flex;gap:.5rem;align-items:center;">
				<input name="newName" type="text" placeholder="New preset name…" style="flex:1;">
				<button type="button" data-action="save-current">Save Current</button>
			</div>

			<hr>

			<h3 style="margin:0;">Export/Import Current Module State</h3>
			<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
				<button type="button" data-action="mmplus-export-state">Export to .json</button>
				<button type="button" data-action="mmplus-import-state">Import from .json</button>
			</div>

			<p class="notes">Applying a preset updates <code>core.moduleConfiguration</code>. You may be prompted to reload.</p>
		</div>
	`;

	const dlg = new foundry.applications.api.DialogV2({
		window: { title: "Module Management+ — Presets" },
		content,
		buttons: [{ action: "close", label: "Close", default: true }]
	});

	const onRender = (app) => {
		if (app !== dlg) return;
		Hooks.off("renderDialogV2", onRender);
		debugLog("renderDialogV2 fired for Preset Manager", { appId: app.appId });

		const form = app.element?.querySelector("form");
		if (!form) { debugLog(2, "form not found"); return; }

		form.addEventListener("click", async (ev) => {
			const btn = ev.target;
			if (!(btn instanceof HTMLButtonElement)) return;
			const action = btn.dataset.action || "";

			// Only handle our buttons; stop any other listeners
			if (!action.startsWith("mmplus-") && !["save-current", "load", "delete"].includes(action)) return;
			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation();

			debugLog(`Dialog click: ${action}`);

			const sel = form.elements.namedItem("presetName");
			const txt = form.elements.namedItem("newName");

			const selected = (sel instanceof HTMLSelectElement) ? sel.value : "";
			const newName = (txt instanceof HTMLInputElement) ? txt.value.trim() : "";

			try {
				if (action === "save-current") {
					if (!newName) { ui.notifications.warn("Enter a name for the new preset."); return; }
					const enabled = getEnabledModuleIds();
					debugLog("save-current: enabled modules", enabled);
					const p = getPresets(); p[newName] = enabled; await setPresets(p);
					ui.notifications.info(`Saved preset "${newName}" (${enabled.length} modules).`);
					app.close(); openPresetManager();
				}
				else if (action === "load") {
					if (!selected) return ui.notifications.warn("Select a preset to load.");
					const enabled = (getPresets()[selected] || []);
					debugLog("load: applying preset", { name: selected, count: enabled.length });
					const proceed = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Apply Preset" },
						content: `<p>Apply preset <b>${esc(selected)}</b> to this world?</p>`,
						modal: true, ok: { label: "Apply" }
					});
					if (!proceed) return;

					await applyEnabledIds(enabled, { autoEnableDeps: true });
					debugLog("load: applied; prompting reload");

					const reload = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Reload Foundry?" },
						content: `<p>Preset applied. Reload now?</p>`,
						ok: { label: "Reload" }
					});
					if (reload) location.reload();
				}
				else if (action === "delete") {
					if (!selected) return ui.notifications.warn("Select a preset to delete.");
					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Preset" },
						content: `<p>Delete preset <b>${esc(selected)}</b>?</p>`,
						ok: { label: "Delete" }
					});
					if (!ok) return;
					const p = getPresets(); delete p[selected]; await setPresets(p);
					ui.notifications.info(`Deleted preset "${selected}".`);
					app.close(); openPresetManager();
				}
				else if (action === "mmplus-export-state") {
					exportCurrentModuleStateDialog();
				}
				else if (action === "mmplus-import-state") {
					const file = await pickLocalJSONFile();
					if (!file) return;
					let data;
					try { data = JSON.parse(await file.text()); }
					catch { ui.notifications.error("Invalid JSON file."); return; }

					let modules = null;
					if (data?.type === "mmplus-state" && Array.isArray(data.modules)) modules = data.modules;
					else if (Array.isArray(data)) modules = data;
					else if (data && typeof data === "object") {
						const all = [];
						for (const v of Object.values(data)) if (Array.isArray(v)) all.push(...v);
						if (all.length) modules = [...new Set(all)];
					}
					if (!modules?.length) return ui.notifications.error("No module list found in JSON.");
					
					// Import file to preset
					importModuleStateAsPreset(modules);
				}
			} catch (err) {
				debugLog(3, "Dialog click handler error", err);
				ui.notifications.error("An error occurred; see console for details.");
			}
		});
	};
	Hooks.on("renderDialogV2", onRender);

	debugLog("rendering DialogV2…");
	dlg.render(true);
	debugLog("DialogV2.render returned");
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
		label: "Open Preset Manager",
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

Hooks.once("ready", () => {
	const mod = game.modules.get("joesters-module-management");
	if (!mod) return;
	mod.api ??= {};
	mod.api.openPresetManager = openPresetManager;
	debugLog("API exposed: mod.api.openPresetManager ready");
});

Hooks.on("setup", () => debugLog("setup fired"));
Hooks.once("ready", () => debugLog("ready fired"));

window.openPresetManager = openPresetManager; // lets you run it from console