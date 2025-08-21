import { debugLog } from './settings.js';
const MM_ID = "bbmm";
const MODULE_SETTING_PRESETS = "module-presets";  // { [name]: string[] }  enabled module ids

/*	=====	HELPERS =====
*/

// Validate Module Preset JSON structure	
function validateModulePresetJSON(data) {

	// Accept ONLY our known payloads
	// 1) Current state export
	if (data && typeof data === "object" && data.type === "bbmm-state" && Array.isArray(data.modules)) {
		return { kind: "state", modules: [...new Set(data.modules.filter(x => typeof x === "string"))] };
	}

	// Everything else: reject
	return null;
}

// Check if modules in preset are missing or have missing dependencies
function validateModuleState(modIds) {
	const unknown = [];			// { id, reason: "not installed" }
	const depIssues = [];		// { id, depId, reason: "dependency missing" }

	for (const id of modIds) {
		if (!game.modules.has(id)) unknown.push({ id, reason: "not installed" });
	}

	for (const id of modIds) {
		const mod = game.modules.get(id);
		if (!mod) continue;
		const requires = getRequiredIds(mod);
		for (const depId of requires) {
			if (!game.modules.has(depId)) {
				depIssues.push({ id, depId, reason: "dependency missing" });
			}
		}
	}

	// Optional debug
	if (!unknown.length && !depIssues.length) {
		debugLog("validateModuleState(): No missing modules or dependencies");
	} else {
		debugLog("validateModuleState(): Missing modules or dependencies found!");
	}

	return { unknown, depIssues };
}

// Show dialog report of Import issues
async function showImportIssuesDialog({ unknown, depIssues }) {
	
	function displayIssues(lines) {
		// Wrap DialogV2 in a Promise so we can await a boolean
		return new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window: { title: "Import Check — Issues Detected" },
				content: `
					<div style="display:flex;flex-direction:column;gap:.5rem;">
						<p class="notes">The imported preset was saved, but the following issues were found:</p>
						${lines.join("\n")}
					</div>
				`,
				buttons: [
					{ action: "ok", label: "OK", default: true }
				],
				submit: (_res, _ev, button) => button?.action === "ok"
			}).render(true);
		})
	}
	
	
	debugLog(`showImportIssuesDialog(): unknown: `, unknown);
	debugLog(`showImportIssuesDialog(): depIssues: `, depIssues);

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
			const modId = it.module?.id ?? it.id;   // fall back if shape is { id, depId }
			const depId = it.dep?.id ?? it.depId;
			if (!byMod.has(modId)) byMod.set(modId, []);
			if (depId != null) byMod.get(modId).push(depId);
		}
		lines.push(`<p><b>Dependencies missing:</b></p>`);
		lines.push(`<ul style="margin-top:.25rem;">${
			[...byMod.entries()].map(([id, deps]) =>
				`<li><code>${esc(id)}</code> → missing: ${deps.map(d => `<code>${esc(d)}</code>`).join(", ")}</li>`
			).join("")
		}</ul>`);
	}

	if (!lines.length) return;
	
	debugLog(`showImportIssuesDialog(): Issues with import found`);
	const issues = await displayIssues(lines);
	return;
		
}

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
			{
				action: "ok",
				label: "Export",
				default: true,
				callback: (ev, button) => button.form.elements.exportName?.value?.trim() || ""
			},
			{ action: "cancel", label: "Cancel" }
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
				type: "bbmm-state",
				name: baseName,
				created: new Date().toISOString(),
				modules: enabled,
				versions
			}, fname);
		}
	}).render(true);
}

// Import module preset json file, validate it, save as preset. 
async function importModuleStateAsPreset(data) {
	// 1) validate shape
	const validated = validateModulePresetJSON(data);
	if (!validated || !Array.isArray(validated.modules) || !validated.modules.length) {
		debugLog(3, "Not a BBMM export. Expected a file created by BBMM.");
		await new foundry.applications.api.DialogV2({
			window: { title: "Import Error" },
			content: `<p>Error! Not a BBMM export. Expected a file created by BBMM.</p>`,
			buttons: [{ action: "ok", label: "OK", default: true }],
			submit: () => "ok"
		}).render(true);
		return;
	}
	const modules = validated.modules;

	// 2) compute report now
	const report = validateModuleState(modules);

	// 3) ask for preset name and save
	new foundry.applications.api.DialogV2({
		window: { title: "Import as module preset" },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">Preset Name</label>
					<input name="presetName" type="text" placeholder="e.g. staging" style="flex:1;">
				</div>
			</div>
		`,
		buttons: [
			{ action: "ok", label: "Import", default: true, callback: (ev, button) => button.form.elements.presetName?.value?.trim() || "" },
			{ action: "cancel", label: "Cancel" }
		],
		submit: async (_result) => {
			const baseName = _result;
			if (!baseName) { ui.notifications.warn("Please enter a preset name."); return; }

			const res = await savePreset(`${baseName} (${formatDateD_Mon_YYYY()})`, modules);
			if (res.status !== "saved") return;

			ui.notifications.info(`Imported preset "${res.name}" (${modules.length} modules).`);

			// Show issues once (if any), do NOT reopen the manager here.
			const report = validateModuleState(modules);
			if (report.unknown.length || report.depIssues.length) {
				await showImportIssuesDialog(report);
			}

			// Return to caller so it can decide whether to close/refresh the manager.
			return res;
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

function formatDateD_Mon_YYYY(d = new Date()) {
	const dd = String(d.getDate()).padStart(2, "0");
	const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
	const yyyy = d.getFullYear();
	return `${dd}-${MON}-${yyyy}`;
}

// Helper to export to .json file
async function saveJSONFile(data, filename) {
	// 1) Foundry's native helper 
	if (typeof saveDataToFile === "function") {
		return saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
	}

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

// read preset map 
function getPresets() {
	return foundry.utils.duplicate(game.settings.get(MM_ID, MODULE_SETTING_PRESETS) || {});
}

// set preset map
async function setPresets(presets) {
	await game.settings.set(MM_ID, MODULE_SETTING_PRESETS, presets);
}

// Normalize name to compare when saving
function normalizePresetName(s) {
	return String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

// Find if preset name exists
function findExistingPresetKey(name) {
	const wanted = normalizePresetName(name);
	const presets = getPresets();
	for (const k of Object.keys(presets)) {
		if (normalizePresetName(k) === wanted) return k;
	}
	return null;
}

// Save Preset checking if it exists and prompting to overwrite or rename
async function savePreset(name, modules) {
	
	// Prompt how to handle duplicate name 
	function askPresetConflict(existingKey) {
		return new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window: { title: "Preset Exists", modal: true },
				content: `
					<p>A preset named <b>${esc(existingKey)}</b> already exists.</p>
					<p>What would you like to do?</p>
				`,
				buttons: [
					{ action: "overwrite", label: "Overwrite", default: true, callback: () => "overwrite" },
					{ action: "rename", label: "Rename", callback: () => "rename" },
					{ action: "cancel", label: "Cancel", callback: () => "cancel" }
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
				window: { title: "Rename Preset", modal: true },
				content: `
					<div style="display:flex;gap:.5rem;align-items:center;">
						<label style="min-width:7rem;">New Name</label>
						<input name="newName" type="text" value="${esc(rawInput)}" autofocus style="flex:1;">
					</div>
				`,
				buttons: [
					{ action: "ok",     label: "Save",   default: true,
					  callback: (_ev, btn) => resolve(btn.form.elements.newName?.value?.trim() || "") },
					{ action: "cancel", label: "Cancel", callback: () => resolve(null) }
				],
				submit: () => {},
				rejectClose: false
			}).render(true);
		});
	}
	
	// keep what the user typed for the rename dialog
	const rawInput = String(name).trim();
	debugLog(`savePreset(): rawInput: '${rawInput}'`);

	// use normalized copy only for matching
	const normalizedWanted = normalizePresetName(rawInput);
	debugLog(`savePreset(): normalizedWanted: '${normalizedWanted}'`);
	const presets = getPresets();

	let existingKey = null;
	for (const k of Object.keys(presets)) {
		if (normalizePresetName(k) === normalizedWanted) { existingKey = k; break; }
	}

	// default final name is the raw input (preserve casing/spaces the user typed)
	let finalName = rawInput;

	debugLog(`savePreset(): existingKey: ${existingKey}`);
	
	if (existingKey) {
		debugLog(`savePreset(): existingKey condition fired!`);
		const choice = await askPresetConflict(existingKey);
		debugLog(`savePreset(): choice: ${choice}`);
		if (choice === "cancel") return { status: "cancel" };
		else if (choice === "overwrite") {
			debugLog(`savePreset(): Chose overwrite`);
			// proceed with overwrite
			finalName = existingKey;
		}
		else if (choice === "rename") {
			debugLog(`savePreset(): Chose rename`);
			const newName = await promptRename(rawInput);
			debugLog(`savePreset(): newName = '${newName}'`);
			if (!newName) return { status: "cancel" };
			finalName = newName.trim();
		}
	}

	const p = getPresets();
	p[finalName] = modules;
	await setPresets(p);
	debugLog(`savePreset(): saved presets: `, p);
	return { status: "saved", name: finalName };
}

// Current enabled module ids (exclude core/system) 
function getEnabledModuleIds() {
	const list = [];
	for (const m of game.modules.values()) {
		// Only non-core modules (systems live elsewhere)
		if (m.active) list.push(m.id);
	}
	return list;
}

// Read moduleConfiguration safely 
function getModuleConfig() {
	return foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
}

// Apply a set of enabled ids -> update core.moduleConfiguration 
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

// Get required dependency ids declared by a module 
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
export async function openPresetManager() {
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
				<button type="button" data-action="bbmm-export-state">Export to .json</button>
				<button type="button" data-action="bbmm-import-state">Import from .json</button>
			</div>

			<p class="notes">After applying a preset, You may be prompted to reload.</p>
		</div>
	`;

	const dlg = new foundry.applications.api.DialogV2({
		window: { title: "BBMM Module Presets" },
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
			if (!action.startsWith("bbmm-") && !["save-current", "load", "delete"].includes(action)) return;
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
					const res = await savePreset(newName, enabled);
					if (res.status !== "saved") return;
					ui.notifications.info(`Saved preset "${res.name}" (${enabled.length} modules).`);
					app.close();
					openPresetManager();
					return;
				}
				else if (action === "load") {
					if (!selected) return ui.notifications.warn("Select a preset to load.");
					const enabled = (getPresets()[selected] || []);
					debugLog("load: applying preset", { name: selected, count: enabled.length });
					const proceed = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Apply Module Preset" },
						content: `<p>Apply module preset <b>${esc(selected)}</b> to this world?</p>`,
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
						window: { title: "Delete Module Preset" },
						content: `<p>Delete module preset <b>${esc(selected)}</b>?</p>`,
						ok: { label: "Delete" }
					});
					if (!ok) return;
					const p = getPresets(); delete p[selected]; await setPresets(p);
					ui.notifications.info(`Deleted preset "${selected}".`);
					app.close(); openPresetManager();
				}
				else if (action === "bbmm-export-state") {
					exportCurrentModuleStateDialog();
				}
				else if (action === "bbmm-import-state") {
					const file = await pickLocalJSONFile();
					if (!file) return;
					let data;
					try { data = JSON.parse(await file.text()); }
					catch { ui.notifications.error("Invalid JSON file."); return; }
					
					// Import file to preset
					const res = await importModuleStateAsPreset(data);
					// If the import saved a preset, close and reopen the manager ONCE
					if (res?.status === "saved") {
						app.close();
						openPresetManager();
					}
					return;
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

Hooks.once("ready", () => {
	window.openPresetManager = openPresetManager; // run it from console
	const mod = game.modules.get("bbmm");
	if (!mod) return;
	mod.api ??= {};
	mod.api.openPresetManager = openPresetManager;
	debugLog("API exposed: mod.api.openPresetManager ready");
});

Hooks.on("setup", () => debugLog("presets.js | setup fired"));
Hooks.once("ready", () => debugLog("ready fired"));

