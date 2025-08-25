import { DL } from './settings.js';
import { hlp_esc, hlp_timestampStr, hlp_saveJSONFile, hlp_pickLocalJSONFile, hlp_normalizePresetName } from './helpers.js';
const BBMM_ID = "bbmm";
const MODULE_SETTING_PRESETS = "modulePresetsUser";  // { [name]: string[] }  enabled module ids

/*	=====	HELPERS =====
*/

// Validate Module Preset JSON structure	
function hlp_validateModulePresetJSON(data) {

	// Accept ONLY our known payloads
	// 1) Current state export
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
		DL("hlp_validateModuleState(): No missing modules or dependencies");
	} else {
		DL("hlp_validateModuleState(): Missing modules or dependencies found!");
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
	return foundry.utils.duplicate(game.settings.get(BBMM_ID, MODULE_SETTING_PRESETS) || {});
}

// set preset map
async function hlp_setPresets(presets) {
	await game.settings.set(BBMM_ID, MODULE_SETTING_PRESETS, presets);
}

// Save Preset checking if it exists and prompting to overwrite or rename
async function hlp_savePreset(name, modules) {
	
	// Prompt how to handle duplicate name 
	function askPresetConflict(existingKey) {
		return new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window: { title: "Preset Exists", modal: true },
				content: `
					<p>A preset named <b>${hlp_esc(existingKey)}</b> already exists.</p>
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
						<input name="newName" type="text" value="${hlp_esc(rawInput)}" autofocus style="flex:1;">
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
	DL(`hlp_savePreset(): rawInput: '${rawInput}'`);

	// use normalized copy only for matching
	const normalizedWanted = hlp_normalizePresetName(rawInput);
	DL(`hlp_savePreset(): normalizedWanted: '${normalizedWanted}'`);
	const presets = hlp_getPresets();

	let existingKey = null;
	for (const k of Object.keys(presets)) {
		if (hlp_normalizePresetName(k) === normalizedWanted) { existingKey = k; break; }
	}

	// default final name is the raw input (preserve casing/spaces the user typed)
	let finalName = rawInput;

	DL(`hlp_savePreset(): existingKey: ${existingKey}`);
	
	if (existingKey) {
		DL(`hlp_savePreset(): existingKey condition fired!`);
		const choice = await askPresetConflict(existingKey);
		DL(`hlp_savePreset(): choice: ${choice}`);
		if (choice === "cancel") return { status: "cancel" };
		else if (choice === "overwrite") {
			DL(`hlp_savePreset(): Chose overwrite`);
			// proceed with overwrite
			finalName = existingKey;
		}
		else if (choice === "rename") {
			DL(`hlp_savePreset(): Chose rename`);
			const newName = await promptRename(rawInput);
			DL(`hlp_savePreset(): newName = '${newName}'`);
			if (!newName) return { status: "cancel" };
			finalName = newName.trim();
		}
	}

	const p = hlp_getPresets();
	p[finalName] = modules;
	await hlp_setPresets(p);
	DL(`hlp_savePreset(): saved presets: `, p);
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
	
	
	DL(`showImportIssuesDialog(): unknown: `, unknown);
	DL(`showImportIssuesDialog(): depIssues: `, depIssues);

	const lines = [];

	if (unknown.length) {
		lines.push(`<p><b>Modules not installed:</b></p>`);
		lines.push(`<ul style="margin-top:.25rem;">${
			unknown.map(it => `<li><code>${hlp_esc(it.id)}</code> — Module not installed</li>`).join("")
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
				`<li><code>${hlp_esc(id)}</code> → missing: ${deps.map(d => `<code>${hlp_esc(d)}</code>`).join(", ")}</li>`
			).join("")
		}</ul>`);
	}

	if (!lines.length) return;
	
	DL(`showImportIssuesDialog(): Issues with import found`);
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

			const stamp = hlp_timestampStr();
			const fname = `module-state-${hlp_slugify(baseName)}-${stamp}.json`;

			const enabled = hlp_getEnabledModuleIds();
			const versions = {};
			for (const id of enabled) versions[id] = game.modules.get(id)?.version ?? null;

			hlp_saveJSONFile({
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
	const validated = hlp_validateModulePresetJSON(data);
	if (!validated || !Array.isArray(validated.modules) || !validated.modules.length) {
		DL(3, "Not a BBMM export. Expected a file created by BBMM.");
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
	const report = hlp_validateModuleState(modules);

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

			const res = await hlp_savePreset(`${baseName} (${hlp_formatDateD_Mon_YYYY()})`, modules);
			if (res.status !== "saved") return;

			ui.notifications.info(`Imported preset "${res.name}" (${modules.length} modules).`);

			// Show issues once (if any), do NOT reopen the manager here.
			const report = hlp_validateModuleState(modules);
			if (report.unknown.length || report.depIssues.length) {
				await showImportIssuesDialog(report);
			}

			// Return to caller so it can decide whether to close/refresh the manager.
			return res;
		}
	}).render(true);
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
	DL("openPresetManager: start");

	const presets = hlp_getPresets();
	DL("openPresetManager: presets loaded", presets);

	const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
	const options = names.map(n => `<option value="${hlp_esc(n)}">${hlp_esc(n)}</option>`).join("");

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
		DL("renderDialogV2 fired for Preset Manager", { appId: app.appId });

		const form = app.element?.querySelector("form");
		if (!form) { DL(2, "form not found"); return; }

		form.addEventListener("click", async (ev) => {
			const btn = ev.target;
			if (!(btn instanceof HTMLButtonElement)) return;
			const action = btn.dataset.action || "";

			// Only handle our buttons; stop any other listeners
			if (!action.startsWith("bbmm-") && !["save-current", "load", "delete"].includes(action)) return;
			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation();

			DL(`Dialog click: ${action}`);

			const sel = form.elements.namedItem("presetName");
			const txt = form.elements.namedItem("newName");

			const selected = (sel instanceof HTMLSelectElement) ? sel.value : "";
			const newName = (txt instanceof HTMLInputElement) ? txt.value.trim() : "";

			try {
				if (action === "save-current") {
					if (!newName) { ui.notifications.warn("Enter a name for the new preset."); return; }
					const enabled = hlp_getEnabledModuleIds();
					const res = await hlp_savePreset(newName, enabled);
					if (res.status !== "saved") return;
					ui.notifications.info(`Saved preset "${res.name}" (${enabled.length} modules).`);
					app.close();
					openPresetManager();
					return;
				}
				else if (action === "load") {
					if (!selected) return ui.notifications.warn("Select a preset to load.");
					const enabled = (hlp_getPresets()[selected] || []);
					DL("load: applying preset", { name: selected, count: enabled.length });
					const proceed = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Apply Module Preset" },
						content: `<p>Apply module preset <b>${hlp_esc(selected)}</b> to this world?</p>`,
						modal: true, ok: { label: "Apply" }
					});
					if (!proceed) return;

					await applyEnabledIds(enabled, { autoEnableDeps: true });
					DL("load: applied; prompting reload");

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
						content: `<p>Delete module preset <b>${hlp_esc(selected)}</b>?</p>`,
						ok: { label: "Delete" }
					});
					if (!ok) return;
					const p = hlp_getPresets(); delete p[selected]; await hlp_setPresets(p);
					ui.notifications.info(`Deleted preset "${selected}".`);
					app.close(); openPresetManager();
				}
				else if (action === "bbmm-export-state") {
					exportCurrentModuleStateDialog();
				}
				else if (action === "bbmm-import-state") {
					const file = await hlp_pickLocalJSONFile();
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
				DL(3, "Dialog click handler error", err);
				ui.notifications.error("An error occurred; see console for details.");
			}
		});
	};
	Hooks.on("renderDialogV2", onRender);

	DL("rendering DialogV2…");
	dlg.render(true);
	DL("DialogV2.render returned");
}

Hooks.once("ready", () => {
	window.openPresetManager = openPresetManager; // run it from console
	const mod = game.modules.get("bbmm");
	if (!mod) return;
	mod.api ??= {};
	mod.api.openPresetManager = openPresetManager;
	DL("API exposed: mod.api.openPresetManager ready");
});

Hooks.on("setup", () => DL("presets.js | setup fired"));
Hooks.once("ready", () => DL("ready fired"));

