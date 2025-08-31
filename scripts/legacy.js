/* legacy.js
	Minimal v12 export-only UI for BBMM
	- Dialog with message + 2 buttons
	- Exports settings + module states to .json
	- Uses DL() for all logging
*/

import { DL, EXPORT_SKIP } from './settings.js';
import { LT, BBMM_ID } from "./localization.js";

/* ---------------------------------------------------------------------- */
/* Main dialog                                                             */
/* ---------------------------------------------------------------------- */
export async function openLegacyExportDialog() {
	try {
		DL("openLegacyExportDialog(): open");

		const content = `
			<section style="min-width:520px;display:flex;flex-direction:column;gap:.75rem;">
					${LT.v12Note()}
				</p>
				<div style="display:flex;gap:.5rem;flex-wrap:wrap;">
					<button type="button" data-action="export-settings">${LT.buttons.expSettingsJSON()}</button>
					<button type="button" data-action="export-mods">${LT.buttons.expModuleStateJSON()}</button>
				</div>
			</section>
		`;

		const dlg = await new foundry.applications.api.DialogV2({
			window: { title: LT.titlev12Legacy, modal: true },
			content,
			buttons: [
				{ action: "close", label: LT.buttons.close(), default: true }
			],
			render: (html) => {
				// wire buttons
				const el = html[0];
				el.querySelector('[data-action="export-settings"]')?.addEventListener("click", () => {
					DL("Legacy: export-settings clicked");
					exportSettingsJSON_v12();
				});
				el.querySelector('[data-action="export-mods"]')?.addEventListener("click", () => {
					DL("Legacy: export-mods clicked");
					exportModuleStatesJSON_v12();
				});
			},
			submit: () => "close"
		}).render(true);

		return dlg;
	} catch (err) {
		DL(3, "openLegacyExportDialog(): error", err);
		ui.notifications.error(LT.errors.failedOpenLegacyExport());
	}
}

/* ---------------------------------------------------------------------- */
/* Export: SETTINGS (v12)                                                  */
/* ---------------------------------------------------------------------- */
/*
	Collects current values from the settings registry (world/client/user).
	We export a bbmm-settings envelope with only changed values per scope.
	We do NOT assume your other files are present; this is standalone.
*/
export async function exportSettingsJSON_v12() {
	try {
		DL("exportSettingsJSON_v12(): start");

		// Gather all registered settings
		// game.settings.settings is a Map<"namespace.key", SettingConfig>
		const reg = game?.settings?.settings;
		if (!reg || typeof reg.forEach !== "function") {
			ui.notifications.warn(LT.errors.settingsRegUnavail());
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
				const ns = cfg.namespace;
				const key = cfg.key;
				const scope = cfg.scope; // "world" | "client" | "user"
				if (!ns || !key || !scope) return;

				// skip core.moduleConfiguration (that’s exported by module-state exporter below)
				if (ns === "core" && key === "moduleConfiguration") return;

				// get current value
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
		ui.notifications.info("Exported v12 settings to .json");
	} catch (err) {
		DL(3, "exportSettingsJSON_v12(): error", err);
		ui.notifications.error(LT.errors.settingsExportFailed());
	}
}

/* ---------------------------------------------------------------------- */
/* Export: MODULE STATES (v12)                                            */
/* ---------------------------------------------------------------------- */
/*
	Exports the enable/disable state map from core.moduleConfiguration.
	This is exactly where Foundry stores module on/off in v12.
*/
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
		ui.notifications.info(LT.exportedv12Modules());
	} catch (err) {
		DL(3, "exportModuleStatesJSON_v12(): error", err);
		ui.notifications.error(LT.errors.failedModulestateExp());
	}
}
