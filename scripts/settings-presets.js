import { debugLog } from './settings.js';
const BBMM_ID = "bbmm";
const SETTING_SETTINGS_PRESETS = "settingsPresets"; 

Hooks.once("init", () => {
	game.settings.register(BBMM_ID, SETTING_SETTINGS_PRESETS, {
		name: "Settings Presets",
		hint: "Stored Settings presets (world/client).",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});
});

// ===== Helpers =====

// Tiny esc
function esc(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	}[m]));
}

function slugify(s) {
	return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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

function normalizeName(s) {
	return String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function getSettingsPresets() {
	return foundry.utils.duplicate(game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS) || {});
}

async function setSettingsPresets(obj) {
	await game.settings.set(BBMM_ID, SETTING_SETTINGS_PRESETS, obj);
}

function findExistingSettingsPresetKey(name) {
	const wanted = normalizeName(name);
	const presets = getSettingsPresets();
	for (const k of Object.keys(presets)) {
		if (normalizeName(k) === wanted) return k;
	}
	return null;
}

// Export helpers
async function saveJSONFile(data, filename) {
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
		} catch {
			return;
		}
	}
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url; a.download = filename;
	document.body.appendChild(a);
	a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickLocalJSONFile() {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file"; input.accept = "application/json"; input.style.display = "none";
		document.body.appendChild(input);
		input.addEventListener("change", () => {
			const file = input.files?.[0] ?? null;
			document.body.removeChild(input);
			resolve(file || null);
		}, { once: true });
		input.click();
	});
}

/*	Collect / Apply Settings
	Collect module settings by scope, optionally restricting to active modules.
	- Skips config:false entries
	- GM: world + client, Non‑GM: client only
	- includeDisabled=false → skip modules that are not active (except core/system)
*/
function collectAllModuleSettings({ includeDisabled = false } = {}) {
	const isGM = game.user.isGM;
	const out = { type: "bbmm-settings", created: new Date().toISOString(), world: {}, client: {} };
	const sysId = game.system.id;

	for (const def of game.settings.settings.values()) {
		const { namespace, key, scope, config } = def;
		// skip hidden settings
		//if (config === false) continue;

		// scope filter by permission
		if (scope === "world" && !isGM) continue;

		// module filter (active vs disabled)
		if (!includeDisabled) {
			if (namespace !== "core" && namespace !== sysId) {
				const mod = game.modules.get(namespace);
				if (!mod || !mod.active) continue;
			}
		}

		let value;
		try {
			value = foundry.utils.duplicate(game.settings.get(namespace, key));
		} catch {
			continue;
		}

		const bucket = (scope === "world") ? out.world : out.client;
		bucket[namespace] ??= {};
		bucket[namespace][key] = value;
	}

	return out;
}

/* 	Apply settings export (bbmm-settings).
	- GM applies world + client; non‑GM applies client only
	- Skips namespaces where module not installed (collects report)
	- Always reloads after apply (per your requirement)
*/
async function applySettingsExport(exportData) {
	if (!exportData || exportData.type !== "bbmm-settings") {
		ui.notifications.error("Not a BBMM settings export.");
		return { applied: [], skipped: [], missingModules: new Set() };
	}

	const isGM = game.user.isGM;
	const scopes = isGM ? ["world","client"] : ["client"];

	const applied = [];
	const skipped = [];
	const missingModules = new Set();

	for (const scope of scopes) {
		const tree = exportData[scope] || {};
		for (const [namespace, entries] of Object.entries(tree)) {
			if (namespace !== "core" && namespace !== game.system.id && !game.modules.has(namespace)) {
				missingModules.add(namespace);
				continue;
			}
			for (const [key, value] of Object.entries(entries)) {
				const def = [...game.settings.settings.values()].find(d => d.namespace === namespace && d.key === key);
				if (!def) { skipped.push(`${namespace}.${key}`); continue; }
				if (def.scope !== scope) { skipped.push(`${namespace}.${key}`); continue; }

				// permission: world requires GM
				if (def.scope === "world" && !isGM) { skipped.push(`${namespace}.${key}`); continue; }

				try {
					await game.settings.set(namespace, key, value);
					applied.push(`${namespace}.${key}`);
				} catch {
					skipped.push(`${namespace}.${key}`);
				}
			}
		}
	}

	// Always reload
	const doReload = await foundry.applications.api.DialogV2.confirm({
		window: { title: "Reload Foundry?" },
		content: `<p>Settings preset applied. Reload now to ensure everything initializes correctly?</p>`,
		ok: { label: "Reload" },
		modal: true
	});
	if (doReload) location.reload();

	return { applied, skipped, missingModules };
}

// Conflict-safe Preset Save
function askSettingsPresetConflict(existingKey) {
	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: "Preset Exists", modal: true },
			content: `
				<p>A settings preset named <b>${esc(existingKey)}</b> already exists.</p>
				<p>What would you like to do?</p>
			`,
			buttons: [
				{ action: "overwrite", label: "Overwrite", default: true, callback: () => resolve("overwrite") },
				{ action: "rename", label: "Rename", callback: () => resolve("rename") },
				{ action: "cancel", label: "Cancel", callback: () => resolve("cancel") }
			],
			submit: () => {},
			rejectClose: false
		}).render(true);
	});
}

//	Rename Prompt
function promptRenamePreset(defaultName) {
	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: "Rename Settings Preset", modal: true },
			content: `
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">New Name</label>
					<input name="newName" type="text" value="${esc(defaultName)}" autofocus style="flex:1;">
				</div>
			`,
			buttons: [
				{ action: "ok",     label: "Save", default: true,
				  callback: (_ev, btn) => resolve(btn.form.elements.newName?.value?.trim() || "") },
				{ action: "cancel", label: "Cancel", callback: () => resolve(null) }
			],
			submit: () => {},
			rejectClose: false
		}).render(true);
	});
}

// Save Settings Preset
async function saveSettingsPreset(name, payload) {
	const rawInput = String(name).trim();
	let finalName = rawInput;

	const existingKey = findExistingSettingsPresetKey(rawInput);
	if (existingKey) {
		const choice = await askSettingsPresetConflict(existingKey);
		if (choice === "cancel") return { status: "cancel" };
		if (choice === "overwrite") finalName = existingKey;
		if (choice === "rename") {
			const newName = await promptRenamePreset(rawInput);
			if (!newName) return { status: "cancel" };
			finalName = newName;
		}
	}
	const all = getSettingsPresets();
	all[finalName] = payload;
	await setSettingsPresets(all);
	return { status: "saved", name: finalName };
}

// UI — Settings Preset Manager
export async function openSettingsPresetManager() {
	const presets = getSettingsPresets();
	const names = Object.keys(presets).sort((a,b)=>a.localeCompare(b));
	const options = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");

	const content = `
		<div style="min-width:560px;display:flex;flex-direction:column;gap:.75rem;">
			<div style="display:flex;gap:.5rem;align-items:center;">
				<label style="min-width:12rem;">Saved Settings Presets</label>
				<select name="presetName" style="flex:1;">${options}</select>
				<button type="button" data-action="load">Load</button>
				<button type="button" data-action="delete">Delete</button>
			</div>

			<hr>

			<div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;">
				<label><input type="checkbox" name="includeDisabled"> Include disabled modules</label>
			</div>

			<div style="display:flex;gap:.5rem;align-items:center;">
				<input name="newName" type="text" placeholder="New settings preset name…" style="flex:1;">
				<button type="button" data-action="save-current">Save Current Settings</button>
			</div>

			<hr>

			<h3 style="margin:0;">Export/Import Current Settings</h3>
			<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
				<button type="button" data-action="export">Export to .json</button>
				<button type="button" data-action="import">Import from .json</button>
			</div>

			<p class="notes">GM exports world+client settings; players export client only. Applying a settings preset will prompt to reload.</p>
		</div>
	`;

	const dlg = new foundry.applications.api.DialogV2({
		window: { title: "BBMM — Settings Preset Manager" },
		content,
		buttons: [{ action: "close", label: "Close", default: true }]
	});

	const onRender = (app) => {
		if (app !== dlg) return;
		Hooks.off("renderDialogV2", onRender);

		const form = app.element?.querySelector("form");
		if (!form) return;

		form.addEventListener("click", async (ev) => {
			const btn = ev.target;
			if (!(btn instanceof HTMLButtonElement)) return;
			const action = btn.dataset.action || "";
			if (!["save-current","load","delete","export","import"].includes(action)) return;

			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation();

			const sel = form.elements.namedItem("presetName");
			const txt = form.elements.namedItem("newName");
			const chk = form.elements.namedItem("includeDisabled");

			const selected = (sel instanceof HTMLSelectElement) ? sel.value : "";
			const newName = (txt instanceof HTMLInputElement) ? txt.value.trim() : "";
			const includeDisabled = (chk instanceof HTMLInputElement) ? chk.checked : false;

			try {
				if (action === "save-current") {
					if (!newName) { ui.notifications.warn("Enter a name for the new settings preset."); return; }
					const payload = collectAllModuleSettings({ includeDisabled });
					const res = await saveSettingsPreset(`${newName}`, payload);
					if (res.status !== "saved") return;
					ui.notifications.info(`Saved settings preset "${res.name}".`);
					app.close(); openSettingsPresetManager();
					return;
				}

				if (action === "load") {
					if (!selected) return ui.notifications.warn("Select a settings preset to load.");
					const preset = getSettingsPresets()[selected];
					if (!preset) return;

					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Apply Settings Preset" },
						content: `<p>Apply settings preset <b>${esc(selected)}</b>?</p>`,
						ok: { label: "Apply" },
						modal: true
					});
					if (!ok) return;

					await applySettingsExport(preset);
					return;
				}

				if (action === "delete") {
					if (!selected) return ui.notifications.warn("Select a settings preset to delete.");
					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Settings Preset" },
						content: `<p>Delete settings preset <b>${esc(selected)}</b>?</p>`,
						ok: { label: "Delete" }
					});
					if (!ok) return;
					const all = getSettingsPresets();
					delete all[selected];
					await setSettingsPresets(all);
					ui.notifications.info(`Deleted settings preset "${selected}".`);
					app.close(); openSettingsPresetManager();
					return;
				}

				if (action === "export") {
					// Export *current* settings (not a stored preset), honoring the checkbox
					const payload = collectAllModuleSettings({ includeDisabled });
					const base = game.user.isGM ? "settings-world-client" : "settings-client";
					const fname = `bbmm-${base}-${timestampStr()}.json`;
					await saveJSONFile(payload, fname);
					ui.notifications.info("Exported current settings.");
					return;
				}

				if (action === "import") {
					const file = await pickLocalJSONFile();
					if (!file) return;

					let data;
					try { data = JSON.parse(await file.text()); }
					catch { ui.notifications.error("Invalid JSON file."); return; }

					if (!data || data.type !== "bbmm-settings") {
						await foundry.applications.api.DialogV2.confirm({
							window: { title: "Import Error" },
							content: `<p>Not a BBMM settings export (type "bbmm-settings").</p>`,
							ok: { label: "OK" },
							modal: true
						});
						return;
					}

					// Ask name -> save as preset
					new foundry.applications.api.DialogV2({
						window: { title: "Import Settings as Preset" },
						content: `
							<div style="display:flex;gap:.5rem;align-items:center;">
								<label style="min-width:9rem;">Preset Name</label>
								<input name="name" type="text" value="Settings (${esc(formatDateD_Mon_YYYY())})" style="flex:1;">
							</div>
						`,
						buttons: [
							{ action: "ok", label: "Save", default: true, callback: (_ev, b) => b.form.elements.name?.value?.trim() || "" },
							{ action: "cancel", label: "Cancel" }
						],
						submit: async (name) => {
							if (!name) { ui.notifications.warn("Please enter a name."); return; }
							const res = await saveSettingsPreset(name, data);
							if (res.status !== "saved") return;
							ui.notifications.info(`Imported settings preset "${res.name}".`);

							// Optionally apply immediately?
							const applyNow = await foundry.applications.api.DialogV2.confirm({
								window: { title: "Apply Now?" },
								content: `<p>Apply this settings preset now?</p>`,
								ok: { label: "Apply" }
							});
							if (applyNow) await applySettingsExport(data);

							app.close?.(); // close the import prompt if still open
							openSettingsPresetManager();
						}
					}).render(true);
				}
			} catch (err) {
				console.error("BBMM Settings Presets error:", err);
				ui.notifications.error("An error occurred; see console for details.");
			}
		});
	};
	Hooks.on("renderDialogV2", onRender);

	dlg.render(true);
}

// Expose API
Hooks.once("ready", () => {
	const mod = game.modules.get(BBMM_ID);
	if (!mod) return;
	mod.api ??= {};
	mod.api.openSettingsPresetManager = openSettingsPresetManager;
});
