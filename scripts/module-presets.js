import { DL } from './settings.js';
import { hlp_esc, hlp_timestampStr, hlp_saveJSONFile, hlp_pickLocalJSONFile, hlp_normalizePresetName } from './helpers.js';
import { LT, BBMM_ID } from "./localization.js";
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
		DL("module-presets.js | hlp_validateModuleState(): No missing modules or dependencies");
	} else {
		DL("module-presets.js | hlp_validateModuleState(): Missing modules or dependencies found!");
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
				submit: (_res, _ev, button) => button?.action === "ok"
			}).render(true);
		})
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
	const issues = await displayIssues(lines);
	return;
		
}

// Open Dialog to export Module state json
async function exportCurrentModuleStateDialog() {
	new foundry.applications.api.DialogV2({
		window: { title: LT.titleExportModuleState() },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">${LT.exportName()}</label>
					<input name="exportName" type="text" placeholder="e.g. prod-setup" style="flex:1;">
				</div>
				<p class="notes">${LT.noteExportFileName()} 
				<code>${LT.filenameModuleState()}-{name}-{YYYYMMDD-HHMMSS}.json</code></p>
			</div>
		`,
		buttons: [
			{
				action: "ok",
				label: LT.buttons.export(),
				default: true,
				callback: (ev, button) => button.form.elements.exportName?.value?.trim() || ""
			},
			{
				action: "cancel",
				label: LT.buttons.cancel(),
				// Return null so submit receives a falsy result
				callback: () => null
			}
		],
		submit: (_result) => {
			// Guard against cancel or empty input
			if (!_result || _result === "cancel") {
				DL("module-presets.js | exportCurrentModuleStateDialog(): user cancelled export");
				return;
			}

			const baseName = String(_result).trim();
			if (!baseName) {
                // Warn only if they clicked Export with empty name
				ui.notifications.warn(`${LT.exportNamePrompt()}.`);
				return;
			}

			const stamp = hlp_timestampStr();
			const fname = `${LT.filenameModuleState()}-${hlp_slugify(baseName)}-${stamp}.json`;

			// Collect enabled modules and versions
			const enabled = hlp_getEnabledModuleIds();
			const versions = {};
			for (const id of enabled) versions[id] = game.modules.get(id)?.version ?? null;

			// Save JSON file
			hlp_saveJSONFile({
				type: "bbmm-state",
				name: baseName,
				created: new Date().toISOString(),
				modules: enabled,
				versions
			}, fname);

			DL(`module-presets.js | exportCurrentModuleStateDialog(): exported "${baseName}" as ${fname}`, { count: enabled.length });
		}
	}).render(true);
}

// Import module preset json file, validate it, save as preset. 
async function importModuleStateAsPreset(data) {
	// 1) validate shape
	const validated = hlp_validateModulePresetJSON(data);
	if (!validated || !Array.isArray(validated.modules) || !validated.modules.length) {
		DL(3, "module-presets.js | Not a BBMM export. Expected a file created by BBMM.");
		await new foundry.applications.api.DialogV2({
			window: { title: LT.errors.titleImportError() },
			content: `<p>${LT.errors.notBBMMFile()}.</p>`,
			buttons: [{ action: "ok", label: LT.buttons.ok(), default: true }],
			submit: () => "ok"
		}).render(true);
		return;
	}
	const modules = validated.modules;

	// 2) compute report now (so we can show it after save)
	const report = hlp_validateModuleState(modules);

	// 3) ask for preset name and save
	const dlgName = new foundry.applications.api.DialogV2({
		window: { title: LT.titleImportPreset() },
		content: `
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">${LT.presetName()}</label>
					<input name="presetName" type="text" placeholder="e.g. staging" style="flex:1;">
				</div>
			</div>
		`,
		buttons: [
			{ action: "ok", label: LT.buttons.import(), default: true,
			  callback: (ev, button) => button.form.elements.presetName?.value?.trim() || "" },
			{ action: "cancel", label: LT.buttons.cancel() }
		],
		submit: async (_result) => {
			const baseName = _result;
			if (!baseName) { ui.notifications.warn(`${LT.importNamePrompt()}.`); return; }

			const res = await hlp_savePreset(`${baseName} (${hlp_formatDateD_Mon_YYYY()})`, modules);
			if (res.status !== "saved") return res;

			ui.notifications.info(`${LT.importedSummary({ name: res.name, count: modules.length })}.`);

			// CLOSE the naming dialog *before* showing issues
			try { await dlgName.close(); } catch {}

			// Show issues once (if any)
			if (report.unknown.length || report.depIssues.length) {
				await showImportIssuesDialog(report); // this already returns a Promise in your file
			}

			DL("module-presets.js | importModuleStateAsPreset() returning ", res);
			return res;
		},
		rejectClose: false
	});
	dlgName.render(true);
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
	// Start
	DL("module-presets.js | openPresetManager: start");

	// Load existing presets and build the select options
	const presets = hlp_getPresets();
	DL("module-presets.js | openPresetManager: presets loaded", presets);

	const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
	const options = names.map(n => `<option value="${hlp_esc(n)}">${hlp_esc(n)}</option>`).join("");

	// Dialog content (adds "Update" button next to Load/Delete)
	const content = `
		<div style="min-width:520px;display:flex;flex-direction:column;gap:.75rem;">

			<div style="display:flex;gap:.5rem;align-items:center;">
				<label style="min-width:10rem;">${LT.savedPresets()}</label>
				<select name="presetName" style="flex:1;">${options}</select>
				<button type="button" data-action="load">${LT.buttons.load()}</button>
				<button type="button" data-action="update">${LT.buttons.update()}</button>
				<button type="button" data-action="delete">${LT.buttons.delete()}</button>
			</div>

			<hr>

			<div style="display:flex;gap:.5rem;align-items:center;">
				<input name="newName" type="text" placeholder="${LT.newPresetName()}…" style="flex:1;">
				<button type="button" data-action="save-current">${LT.buttons.saveCurrent()}</button>
			</div>

			<hr>

			<h3 style="margin:0;">${LT.titleImportExportModuleState()}</h3>
			<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
				<button type="button" data-action="bbmm-export-state">${LT.buttons.exportToJSON()}</button>
				<button type="button" data-action="bbmm-import-state">${LT.buttons.importFromJSON()}</button>
			</div>
		</div>
	`;

	// Create the DialogV2
	const dlg = new foundry.applications.api.DialogV2({
		window: { title: LT.modulePresets() },
		content,
		buttons: [{ action: "close", label: LT.buttons.close(), default: true }]
	});

	/*
		Hook to wire up the click handlers once the dialog is rendered
	*/
	const onRender = (app) => {
		if (app !== dlg) return;
		Hooks.off("renderDialogV2", onRender);
		DL("module-presets.js | renderDialogV2 fired for Preset Manager", { appId: app.appId });

		const form = app.element?.querySelector("form");
		if (!form) { DL(2, "module-presets.js | openPresetManager(): form not found"); return; }

		// Defensive: ensure buttons don’t submit the form
		form.querySelectorAll('button[data-action]').forEach(b => b.setAttribute("type", "button"));

		// Single delegated click handler
		form.addEventListener("click", async (ev) => {
			const btn = ev.target;
			if (!(btn instanceof HTMLButtonElement)) return;
			const action = btn.dataset.action || "";

			// Only handle our buttons; stop other listeners
			if (!action.startsWith("bbmm-") && !["save-current", "load", "update", "delete"].includes(action)) return;
			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation();

			DL(`module-presets.js | openPresetManager(): click ${action}`);

			const sel = form.elements.namedItem("presetName");
			const txt = form.elements.namedItem("newName");

			const selected = (sel instanceof HTMLSelectElement) ? sel.value : "";
			const newName = (txt instanceof HTMLInputElement) ? txt.value.trim() : "";

			try {
				/*
					Save Current → create/overwrite preset with current enabled modules
				*/
				if (action === "save-current") {
					if (!newName) { ui.notifications.warn(`${LT.promptNewPresetName()}.`); return; }

					const enabled = hlp_getEnabledModuleIds();
					DL("module-presets.js | save-current: collected enabled module ids", { count: enabled.length });

					const res = await hlp_savePreset(newName, enabled);
					if (res?.status !== "saved") return;
					ui.notifications.info(`${LT.savedSummary({ name: res.name, count: enabled.length })}.`);

					// Refresh UI list
					app.close();
					openPresetManager();
					return;
				}

				/*
					Update → overwrite the SELECTED preset with CURRENT enabled modules
				*/
				if (action === "update") {
					if (!selected) { ui.notifications.warn(`${LT.warnUpdatePreset()}.`); return; }

					const enabled = hlp_getEnabledModuleIds();
					DL("module-presets.js | update: collected enabled module ids", { count: enabled.length, target: selected });

					const res = await hlp_savePreset(selected, enabled);
					if (res?.status !== "saved") return;

					ui.notifications.info(`${LT.updatedSummary({name: selected, count: enabled.length})}.`);

					// Refresh UI list (names unchanged, but keep flow consistent)
					app.close();
					openPresetManager();
					return;
				}

				/*
					Load → apply preset (then optional reload)
				*/
				if (action === "load") {
					if (!selected) return ui.notifications.warn("Select a preset to load.");

					const enabled = (hlp_getPresets()[selected] || []);
					DL("module-presets.js | load: applying preset", { name: selected, count: enabled.length });

					const proceed = await foundry.applications.api.DialogV2.confirm({
						window: { title: LT.titleApplyModulePreset() },
						content: `<p>${LT.promptApplyModulePreset({ name: hlp_esc(selected) })}?</p>`,
						modal: true,
						ok: { label: LT.buttons.apply() }
					});
					if (!proceed) return;

					await applyEnabledIds(enabled, { autoEnableDeps: true });
					DL("module-presets.js | load: applied; prompting reload");

					const reload = await foundry.applications.api.DialogV2.confirm({
						window: { title: LT.titleReloadFoundry() },
						content: `<p>${LT.promptReloadNow()}</p>`,
						ok: { label: LT.buttons.reload() }
					});
					if (reload) location.reload();
					return;
				}

				/*
					Delete → remove preset
				*/
				if (action === "delete") {
					if (!selected) return ui.notifications.warn(`${LT.warnSelectPresetDelete()}.`);

					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: LT.titleDeleteModulePreset() },
						content: `<p>${LT.promptDeleteModulePreset()} <b>${hlp_esc(selected)}</b>?</p>`,
						ok: { label: LT.buttons.delete() }
					});
					if (!ok) return;

					const p = hlp_getPresets();
					delete p[selected];
					await hlp_setPresets(p);

					ui.notifications.info(`${LT.deletedPreset()} "${selected}".`);
					app.close();
					openPresetManager();
					return;
				}

				/*
					Export current module state to file
				*/
				if (action === "bbmm-export-state") {
					DL("module-presets.js | export-current: starting");
					exportCurrentModuleStateDialog();
					return;
				}

				/*
					Import module state from a file and save as preset 
				*/
				if (action === "bbmm-import-state") {
					const file = await hlp_pickLocalJSONFile();
					if (!file) return;

					let data;
					try { data = JSON.parse(await file.text()); }
					catch { ui.notifications.error(`${LT.errors.invalidJSONFile()}.`); return; }

					const res = await importModuleStateAsPreset(data);
					DL("module-presets.js | import-state: result:", res);

					if (res?.status === "saved") {
						app.close();
						openPresetManager();
						DL("module-presets.js | bbmm-import-state: app.close() fired");
					} else {
						DL("module-presets.js | bbmm-import-state: app.close() skipped");
					}
					
					
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

	// Render
	dlg.render(true);
}

Hooks.once("ready", () => {
	window.openPresetManager = openPresetManager; // run it from console
	const mod = game.modules.get("bbmm");
	if (!mod) return;
	mod.api ??= {};
	mod.api.openPresetManager = openPresetManager;
	DL("module-presets.js | API exposed: mod.api.openPresetManager ready");
});

Hooks.on("setup", () => DL("module-presets.js | setup fired"));
Hooks.once("ready", () => DL("module-presets.js | ready fired"));

