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
/* Export: SETTINGS (v12)                                                 */
/* ---------------------------------------------------------------------- */
export async function exportSettingsJSON_v12() {
	try {
		DL("exportSettingsJSON_v12(): start");

		// Gather all registered settings
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

		// Helper: stash scoped values under out[scope][namespace][key] = value
		const put = (scope, ns, key, value) => {
			if (!out[scope][ns]) out[scope][ns] = {};
			out[scope][ns][key] = value;
		};

		reg.forEach((cfg, fullKey) => {
			// cfg = { key, namespace, scope, config, default, type, ... }
			try {
                // Always tabs
				const ns = cfg.namespace;
				const key = cfg.key;
				const scope = cfg.scope; // "world" | "client" | "user"
				if (!ns || !key || !scope) return;

				// skip core.moduleConfiguration (exported by module-state exporter)
				if (ns === "core" && key === "moduleConfiguration") return;

				// current value
				const val = game.settings.get(ns, key);

				// include if different from default or if no default available
				const hasDefault = Object.prototype.hasOwnProperty.call(cfg, "default");
				const isDifferent = hasDefault ? !foundry.utils.isPropertyEqual(val, cfg.default) : true;

				if (isDifferent) {
					put(scope, ns, key, val);
				}
			} catch (errInner) {
				DL(2, `exportSettingsJSON_v12(): failed setting read for ${fullKey}`, errInner);
			}
		});

		// Save file
		const filename = `bbmm-settings-v12-${game.world?.id ?? "world"}-${foundry.utils.randomID(5)}.json`;
		const blob = JSON.stringify(out, null, 2);
		DL(`exportSettingsJSON_v12(): writing ${filename}`);
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
export async function exportModuleStatesJSON_v12() {
	try {
		DL("exportModuleStatesJSON_v12(): start");

		const modMap = game.settings.get("core", "moduleConfiguration") ?? {};
		const out = {
			type: "bbmm-settings",
			created: new Date().toISOString(),
			world: {
				core: {
					moduleConfiguration: modMap
				}
			},
			client: {},
			user: {}
		};

		const filename = `bbmm-module-states-v12-${game.world?.id ?? "world"}-${foundry.utils.randomID(5)}.json`;
		const blob = JSON.stringify(out, null, 2);
		DL(`exportModuleStatesJSON_v12(): writing ${filename}`);
		saveDataToFile(blob, "application/json", filename);
		ui.notifications.info(game.i18n.localize("bbmm.exportedv12Modules"));
	} catch (err) {
		DL(3, "exportModuleStatesJSON_v12(): error", err);
		ui.notifications.error(game.i18n.localize("bbmm.errors.failedModulestateExp"));
	}
}
