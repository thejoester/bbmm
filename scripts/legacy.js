/* legacy.js
	Minimal v12 export-only UI for BBMM
	- Dialog with message + 2 buttons
	- Exports settings + module states to .json
	- Uses DL() for all logging
*/

// legacy.js
import { DL } from "./settings.js";

/* minimal esc for v12 */  
function _esc(str) {
	try {
		return String(str).replace(/[&<>"']/g, s => ({
			"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
		}[s]));
	} catch { return String(str ?? ""); }
}

export async function openLegacyExportDialog() {
    DL("i18n tree 'bbmm' present=" + !!game.i18n.translations?.bbmm, game.i18n.translations?.bbmm && Object.keys(game.i18n.translations.bbmm).slice(0,5));
	try {
		DL("openLegacyExportDialog(): open");

		// i18n (uses YOUR existing keys)
		const title    = game.i18n.localize("bbmm.titlev12Legacy");
		const msg      = game.i18n.localize("bbmm.v12Note");
		const lblA     = game.i18n.localize("bbmm.buttons.expSettingsJSON");
		const lblB     = game.i18n.localize("bbmm.buttons.expModuleStateJSON");
		const lblClose = game.i18n.localize("bbmm.buttons.close");

		// Debug what i18n actually returned (keys vs strings)
		const hasTree = !!game.i18n?.translations?.bbmm;
		DL(`i18n tree 'bbmm' present=${hasTree} | title="${title}"`);

		const content = `
			<section style="min-width:520px;display:flex;flex-direction:column;gap:.75rem;">
				<p>${msg}</p>
			</section>
		`;

		await new foundry.applications.api.DialogV2({
			window: { title, modal: true },
			content,
			buttons: [
				{
					action: "export-settings",
					label: lblA,
					callback: async () => {
						try { DL("Legacy: export-settings"); await exportSettingsJSON_v12(); }
						catch (err) { DL(3, "export-settings error", err); ui.notifications.error(game.i18n.localize("bbmm.errors.settingsExportFailed")); }
					}
				},
				{
					action: "export-mods",
					label: lblB,
					callback: async () => {
						try { DL("Legacy: export-mods"); await exportModuleStatesJSON_v12(); }
						catch (err) { DL(3, "export-mods error", err); ui.notifications.error(game.i18n.localize("bbmm.errors.failedModulestateExp")); }
					}
				},
				{ action: "close", label: lblClose, default: true }
			],
			submit: () => "close"
		}).render(true);
	} catch (err) {
		DL(3, "openLegacyExportDialog(): error", err);
		ui.notifications.error(game.i18n.localize("bbmm.errors.failedOpenLegacyExport"));
	}
}


/* ---------------------------------------------------------------------- */
/* Export: SETTINGS (v12) — export ALL registered settings (no compares)  */
/* ---------------------------------------------------------------------- */
export async function exportSettingsJSON_v12() {
	try {
		DL("exportSettingsJSON_v12(): start");

		const reg = game?.settings?.settings;
		if (!reg || typeof reg.forEach !== "function") {
			ui.notifications.warn(game.i18n.localize("bbmm.errors.settingsRegUnavail"));
			return;
		}

		const out = {
			type: "bbmm-settings",
			created: new Date().toISOString(),
			world: {},
			client: {},
			user: {}
		};

		let scanned = 0;
		let written = 0;

		// helper: stash scoped values
		const put = (scope, ns, key, value) => {
			out[scope][ns] ??= {};
			out[scope][ns][key] = value;
		};

		// iterate every registered setting and capture current value
		reg.forEach((cfg, fullKey) => {
			try {
				const ns = cfg?.namespace;
				const key = cfg?.key;
				const scope = cfg?.scope;	// "world" | "client" | "user"
				if (!ns || !key || !scope) return;

				// do not include the module enable map here (this exporter is for *settings*)
				if (ns === "core" && key === "moduleConfiguration") return;

				scanned++;

				let val;
				try {
					val = game.settings.get(ns, key);
				} catch (e) {
					DL(2, `exportSettingsJSON_v12(): get failed for ${ns}.${key}`, e);
					return;
				}

				// only skip truly undefined; keep null/false/0/"" etc.
				if (typeof val === "undefined") return;

				put(scope, ns, key, val);
				written++;
			} catch (errInner) {
				DL(2, `exportSettingsJSON_v12(): error scanning ${fullKey}`, errInner);
			}
		});

		const filename = `bbmm-settings-v12-${game.world?.id ?? "world"}-${foundry.utils.randomID(5)}.json`;
		const blob = JSON.stringify(out, null, 2);

		DL(`exportSettingsJSON_v12(): scanned=${scanned} wrote=${written} → ${filename}`, out);
		saveDataToFile(blob, "application/json", filename);

		ui.notifications.info(game.i18n.localize("bbmm.exportedv12Settings"));
	} catch (err) {
		DL(3, "exportSettingsJSON_v12(): error", err);
		ui.notifications.error(game.i18n.localize("bbmm.errors.settingsExportFailed"));
	}
}


/* ---------------------------------------------------------------------- */
/* Export: MODULE STATES (v12)                                            */
/* ---------------------------------------------------------------------- */
/* ---------------------------------------------------------------------- */
/* Export: MODULE STATE (v12) → bbmm-state envelope                        */
/*  - Reads core.moduleConfiguration (enabled map)                         */
/*  - Builds: { type:"bbmm-state", name, created, modules[], versions{} }  */
/* ---------------------------------------------------------------------- */
export async function exportModuleStatesJSON_v12() {
	try {
		DL("exportModuleStatesJSON_v12(): start");

		// 1) read v12 module enable map
		const cfg = game.settings.get("core", "moduleConfiguration") ?? {};
		if (!cfg || typeof cfg !== "object") {
			ui.notifications.warn(game.i18n.localize("bbmm.errors.modConfigUnavailable") || "Module configuration is unavailable.");
			return;
		}

		// 2) collect enabled module ids
		const modules = Object.entries(cfg)
			.filter(([_, enabled]) => !!enabled)
			.map(([id]) => id)
			.sort((a, b) => a.localeCompare(b));

		// 3) collect versions for enabled modules only
		const versions = {};
		for (const id of modules) {
			try {
				const mod = game.modules.get(id);
				// v12 compatibility: version can be on .version OR .data?.version OR ._source?.version
				const v =
					(mod?.version)
					|| (mod?.data && (mod.data.version || mod.data?.manifest?.version))
					|| (mod?._source && (mod._source.version || mod._source?.manifest?.version))
					|| "";
				if (v) versions[id] = String(v);
			} catch (e) {
				DL(2, `exportModuleStatesJSON_v12(): failed to read version for ${id}`, e);
			}
		}

		// 4) choose a default name (simple + deterministic)
		const name =
			(game.world?.id ? `${game.world.id}` : "world") ||
			"v12";

		// 5) build bbmm-state envelope
		const out = {
			type: "bbmm-state",
			name,
			created: new Date().toISOString(),
			modules,
			versions
		};

		// 6) write file
		const filename = `bbmm-state-v12-${name}-${foundry.utils.randomID(5)}.json`;
		const blob = JSON.stringify(out, null, 2);

		DL(`exportModuleStatesJSON_v12(): enabled=${modules.length} → ${filename}`, out);
		saveDataToFile(blob, "application/json", filename);
		ui.notifications.info(game.i18n.localize("bbmm.exportedv12Modules") || "Exported module state.");
	} catch (err) {
		DL(3, "exportModuleStatesJSON_v12(): error", err);
		ui.notifications.error(game.i18n.localize("bbmm.errors.failedModulestateExp") || "Failed to export module state.");
	}
}