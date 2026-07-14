/* BBMM Player Permissions ====================================================
	- GM grants individual non-GM players access to specific BBMM features
	- Stored world-scoped in the "userPermissions" hidden setting
	- bbmm_hasPermission() is the single source of truth consumed by feature
	  scripts to gate their entry points (create/update/delete only; applying
	  a preset or pushing a lock/sync entry always stays GM-only regardless)
============================================================================== */

import { DL, BBMM_README_UUID } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_injectHeaderHelpButton } from "./helpers.js";

// Single source of truth for the manager UI and every bbmm_hasPermission() check
export const BBMM_PERMISSION_KEYS = [
	"modulePresets",
	"settingsPresets",
	"exclusions",
	"tagManager",
	"settingSync"
];

/* ============================================================================
	{PERMISSION CHECK}
============================================================================ */

// GMs always pass; non-GM must have an explicit true entry for this key
export function bbmm_hasPermission(key, userId = game.user.id) {
	if (game.user.isGM) return true;
	const table = game.settings.get(BBMM_ID, "userPermissions");
	return !!table?.[userId]?.[key];
}

/* ============================================================================
	{MANAGER APPLICATION}
============================================================================ */

class BBMMPlayerPermissionsAppV2 extends foundry.applications.api.ApplicationV2 {

	constructor() {
		super({
			id: "bbmm-player-permissions-manager",
			window: { title: LT.permissions.title() },
			width: 640,
			height: 500,
			resizable: true,
			classes: ["bbmm-permissions-app"]
		});
		this._minW = 480;
		this._maxW = 820;
		this._minH = 320;
		this._maxH = 700;
		this._selectedUserId = null;
	}

	async _renderHTML(_context, _options) {
		// Load once per app instance; edits live in this._table until Save
		if (!this._table) {
			const raw = game.settings.get(BBMM_ID, "userPermissions") || {};
			this._table = foundry.utils.duplicate(raw);
		}

		const players = game.users.filter(u => !u.isGM).sort((a, b) =>
			a.name.localeCompare(b.name, game.i18n.lang || undefined, { sensitivity: "base" })
		);

		if (this._selectedUserId && !players.some(u => u.id === this._selectedUserId)) {
			this._selectedUserId = null;
		}

		const playerRows = players.length
			? players.map(u => `
				<li>
					<button type="button" class="bbmm-perm-player${u.id === this._selectedUserId ? " active" : ""}" data-action="select-user" data-user-id="${u.id}">
						${foundry.utils.escapeHTML(u.name)}
					</button>
				</li>
			`).join("")
			: `<li class="bbmm-perm-empty">${LT.permissions.noPlayers()}</li>`;

		let permsHtml = `<p class="bbmm-perm-empty">${LT.permissions.selectPlayerHint()}</p>`;
		if (this._selectedUserId) {
			const row = this._table[this._selectedUserId] ?? {};
			permsHtml = `
				<ul class="bbmm-perm-checklist">
					${BBMM_PERMISSION_KEYS.map(key => `
						<li>
							<label>
								<input type="checkbox" data-perm-key="${key}" ${row[key] ? "checked" : ""}>
								<span class="bbmm-perm-label">${LT.permissions.keys[key].label()}</span>
								<span class="bbmm-perm-hint">${LT.permissions.keys[key].hint()}</span>
							</label>
						</li>
					`).join("")}
				</ul>
			`;
		}

		const html = `
			<style>
				#${this.id} .window-content{display:flex;flex-direction:column;min-height:0;overflow:hidden}
				.bbmm-perm-root{display:flex;gap:10px;min-height:0;flex:1 1 auto}

				.bbmm-perm-players{flex:0 0 200px;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;padding:4px}
				.bbmm-perm-players ul, .bbmm-perm-players li{list-style:none;margin:0;padding:0}
				.bbmm-perm-player{width:100%;text-align:left;padding:6px 8px;border:none;background:transparent;border-radius:6px;cursor:pointer}
				.bbmm-perm-player:hover{background:rgba(255,255,255,.08)}
				.bbmm-perm-player.active{background:var(--color-text-hyperlink, rgb(41, 135, 230));color:#fff}
				.bbmm-perm-empty{opacity:.75;padding:8px;font-style:italic}

				.bbmm-perm-detail{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border-light-2);border-radius:8px;padding:10px}
				.bbmm-perm-checklist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
				.bbmm-perm-checklist label{display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:baseline;cursor:pointer}
				.bbmm-perm-label{font-weight:600}
				.bbmm-perm-hint{grid-column:2;opacity:.75;font-size:.9em}

				.bbmm-perm-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
			</style>

			<section class="bbmm-perm-root">
				<nav class="bbmm-perm-players"><ul>${playerRows}</ul></nav>
				<div class="bbmm-perm-detail">${permsHtml}</div>
			</section>

			<div class="bbmm-perm-footer">
				<button type="button" class="bbmm-btn" data-action="save">${LT.buttons.save()}</button>
				<button type="button" class="bbmm-btn" data-action="close">${LT.buttons.close()}</button>
			</div>
		`;

		return html;
	}

	async _replaceHTML(result, _options) {
		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;

		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass: "fas fa-circle-question",
				title: LT.buttons.help?.() ?? "Help"
			});
		} catch (e) {
			DL(2, "user-permissions.js | _replaceHTML(): help inject failed", e);
		}

		if (this._delegated) return;
		this._delegated = true;

		content.addEventListener("click", async (ev) => {
			const playerBtn = ev.target?.closest?.('button[data-action="select-user"]');
			if (playerBtn) {
				this._selectedUserId = playerBtn.dataset.userId || null;
				await this.render(true);
				return;
			}

			const btn = ev.target?.closest?.("button[data-action]");
			if (!btn) return;

			const action = btn.dataset.action || "";

			if (action === "close") {
				try { this.close({ force: true }); } catch {}
				return;
			}

			if (action === "save") {
				try {
					await game.settings.set(BBMM_ID, "userPermissions", this._table);
					ui.notifications?.info(LT.permissions.saved());
					DL("user-permissions.js | save(): wrote userPermissions", this._table);
				} catch (e) {
					DL(3, "user-permissions.js | save(): failed", e);
					ui.notifications?.error(LT.permissions.saveFailed?.() ?? "Failed to save permissions. See console.");
				}
				return;
			}
		});

		content.addEventListener("change", (ev) => {
			const chk = ev.target?.closest?.("input[data-perm-key]");
			if (!chk || !this._selectedUserId) return;

			const key = chk.dataset.permKey;
			if (!BBMM_PERMISSION_KEYS.includes(key)) return;

			this._table[this._selectedUserId] ??= {};
			this._table[this._selectedUserId][key] = !!chk.checked;
		});
	}
}

/* ============================================================================
	{PUBLIC LAUNCHER}
============================================================================ */

export function openPlayerPermissionsManager() {
	new BBMMPlayerPermissionsAppV2().render(true);
}

// Register on globalThis.bbmm so GM-only menu openers can call this without
// a direct circular import (same pattern as lock-presets.js / module-management.js)
Hooks.once("init", () => {
	globalThis.bbmm ??= {};
	Object.assign(globalThis.bbmm, { openPlayerPermissionsManager, bbmm_hasPermission });
});
