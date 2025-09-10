/*  BBMM Setting Lock===========================================================
	- GM: adds Person icon + Lock icon to every *user/client* setting
	- GM clicking Lock icon: toggle in bbmm.userSettingSync (store/remove GM value)
	- Player: on ready, apply diffs; show reload dialog if needed
	- GM updates: broadcast a lightweight trigger; clients pull & apply
	============================================================================ */

import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";


/*  ============================================================================
        {GLOBALS}
	============================================================================ */

	const BBMM_REG = { byId: new Map() };	// Live registry of settings
const BBMM_SYNC_CH = `module.${BBMM_ID}`;	// Socket channel for this module
const ENABLE_KEY = "enableUserSettingSync";
const SELECT_USERS_KEY = "selectUsersOnPushLock"; 
const _bbmmPendingOps = [];	 // Pending operations queue (applied on Save Changes)


/*  ============================================================================
        {HELPERS}
	============================================================================ */

	function _bbmmQueueOp(entry) {
	try {
		// Last selection wins (replace, don't union)
		const idx = _bbmmPendingOps.findIndex(e => e.op === entry.op && e.id === entry.id);
		const clean = {
			...entry,
			userIds: Array.isArray(entry.userIds) ? entry.userIds.slice() : []
		};
		if (idx >= 0) {
			_bbmmPendingOps[idx] = clean;
		} else {
			_bbmmPendingOps.push(clean);
		}
		DL(`bbmm-queue: +${entry.op} ${entry.id}`, clean);
	} catch (err) {
		DL(3, "bbmm-queue: error", err);
	}
}

function _bbmmClearQueue() {
	_bbmmPendingOps.length = 0;
	DL("bbmm-queue: cleared");
}

// Apply queued ops AFTER GM clicks Save Changes
async function _bbmmApplyPendingOps() {
	try {
		if (!_bbmmPendingOps.length) return;

		// Apply all LOCK ops by mutating the world map once
		let map = game.settings.get(BBMM_ID, "userSettingSync") || {};
		let mapChanged = false;

		for (const op of _bbmmPendingOps.filter(o => o.op === "lock")) {
			const { id, namespace, key, value, userIds } = op;
			const cfg = game.settings.settings.get(id);
			if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

			// Non-GM users are targetable for locking
			const targets = (game.users?.contents || []).filter(u => !u.isGM).map(u => u.id);
			const selected = (Array.isArray(userIds) ? userIds : []).filter(uid => targets.includes(uid));

			// Case A: selected = 0 → remove lock (unlock)
			if (selected.length === 0) {
				if (map[id]) {
					delete map[id];
					mapChanged = true;
					DL(`bbmm-apply: lock REMOVE ${id} (no users selected)`);
				}
				continue;
			}

			// Case B: selected covers all targets → store as global lock (omit userIds)
			if (targets.length > 0 && selected.length === targets.length) {
				map[id] = {
					namespace,
					key,
					value,
					requiresReload: !!cfg?.requiresReload
					// no userIds → means all users
				};
				mapChanged = true;
				DL(`bbmm-apply: lock ${id} (users=all)`);
				continue;
			}

			// Case C: partial subset
			map[id] = {
				namespace,
				key,
				value,
				requiresReload: !!cfg?.requiresReload,
				userIds: selected
			};
			mapChanged = true;
			DL(`bbmm-apply: lock ${id} (users=${selected.length}/${targets.length})`);
		}

		// After processing all LOCK ops, persist if changed
		if (mapChanged) {
			await game.settings.set(BBMM_ID, "userSettingSync", map);
			bbmmBroadcastTrigger(); // notify players
			DL("bbmm-apply: map snapshot", game.settings.get(BBMM_ID, "userSettingSync"));
		}

		// Apply all PUSH ops by emitting socket with targets
		for (const op of _bbmmPendingOps.filter(o => o.op === "push")) {
			const { id, namespace, key, userIds } = op;

			// Pull the latest value *after* save finished
			const value = game.settings.get(namespace, key);
			game.socket.emit(BBMM_SYNC_CH, {
				t: "bbmm-sync-push",
				id,
				namespace,
				key,
				value,
				requiresReload: !!game.settings.settings.get(id)?.requiresReload,
				targets: Array.isArray(userIds) && userIds.length ? userIds : null
			});
			DL(`bbmm-apply: push ${id} (targets=${(op.userIds || []).length || "all"})`);
		}

		_bbmmClearQueue();
	} catch (err) {
		DL(3, "bbmm-apply: error", err);
	}
}

// equality helper
const objectsEqual = foundry?.utils?.objectsEqual ?? ((a, b) => {
	try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
});

// Helper: is feature enabled?
function bbmmIsSyncEnabled() {
	try { return !!game.settings.get(BBMM_ID, ENABLE_KEY); }
	catch { return true; } // safe default if setting not found
}

/*
Lock state helpers
- "none": no lock record
- "partial": lock exists with userIds that don't cover all targetable users
- "all": lock exists with no userIds (means all), or userIds covers all targetable users
*/
function bbmmTargetableUserIds() {
	try {
		// By default, treat non-GM users as the lock targets
		const users = game.users?.contents || [];
		return users.filter(u => !u.isGM).map(u => u.id);
	} catch (_e) {
		return [];
	}
}

function bbmmGetLockState(id, map) {
	try {
		const rec = map?.[id];
		if (!rec) return "none";

		const targets = bbmmTargetableUserIds();
		const arr = Array.isArray(rec.userIds) ? rec.userIds : null;

		// No list stored → treat as "all"
		if (!arr || !arr.length) return "all";

		// If there are no targetable users, keep it "partial" to avoid false "all"
		if (targets.length === 0) return "partial";

		const set = new Set(arr);
		let covered = 0;
		for (const uid of targets) if (set.has(uid)) covered++;
		return covered >= targets.length ? "all" : "partial";
	} catch (_e) {
		return "all";
	}
}

//  GM: trigger clients to refresh their local lock map 
let _bbmmTriggerTimer = null;
function bbmmBroadcastTrigger() {
	try {
		if (!bbmmIsSyncEnabled()) return; // feature disabled?
		if (!game.user?.isGM) return;
		if (!game.socket) return;
		clearTimeout(_bbmmTriggerTimer);
		_bbmmTriggerTimer = setTimeout(() => {
			game.socket.emit(BBMM_SYNC_CH, { t: "bbmm-sync-refresh" });
			DL("setting-sync.js |  bbmm-setting-lock: broadcast refresh trigger");
		}, 50); // debounce minor bursts
	} catch (err) {
		DL(2, "setting-sync.js |  bbmm-setting-lock: broadcast error", err);
	}
}

/* 	BBMM Lock: resnap userSettingSync ==========================================
		BBMM Lock: resnap userSettingSync
		- GM only
		- Compare live values vs stored map
		- Update map if different
	============================================================================ */
async function bbmmResnapUserSync() {
	try {
		if (!game.user?.isGM) return;

		let map = game.settings.get(BBMM_ID, "userSettingSync") || {};
		const ids = Object.keys(map);
		if (!ids.length) {
			DL("setting-sync.js |  bbmm-setting-lock: resnap > no entries");
			return;
		}

		let changed = false;

		for (const id of ids) {
			const dot = id.indexOf(".");
			if (dot <= 0) continue;

			const ns = id.slice(0, dot);
			const key = id.slice(dot + 1);

			const cfg = game.settings.settings.get(id);
			if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

			const live = game.settings.get(ns, key);
			const prev = map[id]?.value;

			// v13-safe equality
			const same = (typeof foundry?.utils?.objectsEqual === "function")
				? foundry.utils.objectsEqual(live, prev)
				: live === prev;

			if (!same) {
				// Preserve any existing userIds when resnapping
				const existing = map[id] || {};
				map[id] = {
					namespace: ns,
					key,
					value: live,
					requiresReload: existing.requiresReload ?? !!cfg.requiresReload,
					...(Array.isArray(existing.userIds) ? { userIds: existing.userIds.slice() } : {})
				};
				changed = true;
				DL(`setting-sync.js |  bbmm-setting-lock: resnap updated ${id} ->`, live);
			}
		}

		if (changed) {
			await game.settings.set(BBMM_ID, "userSettingSync", map);
			bbmmBroadcastTrigger();
			DL("setting-sync.js |  bbmm-setting-lock: resnap complete, map saved");
		} else {
			DL("setting-sync.js |  bbmm-setting-lock: resnap complete, no changes");
		}
	} catch (err) {
		DL(2, "setting-sync.js |  bbmm-setting-lock: resnap error", err);
	}
}

/* 	Push current GM value over socket ==========================================
	- Only for user/client scoped settings
	- Players apply value; prompt reload if needed
	============================================================================ */
function bbmmPushSetting(ns, key) {
	try {
		if (!bbmmIsSyncEnabled()) return; // feature disabled?
		if (!game.user?.isGM) return;
		if (!game.socket) return;

		const id = `${ns}.${key}`;
		const cfg = game.settings.settings.get(id);
		if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) return;

		const value = game.settings.get(ns, key);
		game.socket.emit(BBMM_SYNC_CH, {
			t: "bbmm-sync-push",
			id,
			namespace: ns,
			key,
			value,
			requiresReload: !!cfg.requiresReload
		});
		DL(`setting-sync.js |  bbmm-setting-lock: push -> ${id}`, value);
	} catch (err) {
		DL(2, "setting-sync.js |  bbmm-setting-lock: push error", err);
	}
}

/* 	Class: BBMMUserPicker ======================================================
	- Shows a per-user selection dialog for Lock/Sync
	- preChecked: array of user IDs OR the string 
	  "*" to pre-check all non-GM users
	- onlyOnline: when true, only show users currently 
	  online/connected (for Sync)
 	============================================================================*/
class BBMMUserPicker {
	constructor({ title, settingId, valuePreview, confirmLabel, preChecked, onlyOnline = false, onConfirm }) {
		this.title = title;
		this.settingId = settingId;
		this.valuePreview = valuePreview;
		this.onConfirm = typeof onConfirm === "function" ? onConfirm : () => {};
		this.confirmLabel = confirmLabel || "Queue";
		this.preChecked = Array.isArray(preChecked) || preChecked === "*" ? preChecked : [];
		this.onlyOnline = !!onlyOnline;
	}

	// Render a safe preview for the value block
	_renderValuePreview(v) {
		try {
			if (v === null || v === undefined) return String(v);
			if (typeof v === "string") return v;
			return JSON.stringify(v, null, 2);
		} catch {
			try { return String(v); } catch { return "(unprintable)"; }
		}
	}

	// determine if a user is currently online/connected
	_isUserOnline(u) {
		try {
			// Foundry commonly exposes .active for "currently connected".
			// Fallbacks cover alternate props in some versions/modules.
			if (typeof u.active === "boolean") return u.active;
			if (typeof u.isActive === "boolean") return u.isActive;
			// Some builds use a numeric/enum presence. Be liberal in detection.
			if (typeof u.status === "string") return u.status.toUpperCase?.() === "ACTIVE" || u.status.toUpperCase?.() === "ONLINE";
			if (typeof u.status === "number") return u.status > 0; // treat >0 as online-ish
		} catch {}
		return false;
	}

	async show() {
		try {
			// Setting metadata (pretty label + source/module name)
			const [ns, key] = String(this.settingId).split(".");
			const cfg = game.settings.settings.get(this.settingId);
			const settingPretty = (() => {
				try {
					const raw = cfg?.name ? game.i18n.localize(cfg.name) : key;
					return typeof raw === "string" ? raw : key;
				} catch {
					return key;
				}
			})();
			const sourcePretty = (() => {
				try {
					if (ns === "core") return LT.sourceCore();
					if (game.system?.id === ns) return game.system?.title || ns;
					const mod = game.modules?.get(ns);
					return mod?.title || ns;
				} catch {
					return ns;
				}
			})();

			// Base population: exclude GMs
			let users = (game.users?.contents || []).filter(u => !u.isGM);

			// Sync-only mode: restrict to currently-online users
			if (this.onlyOnline) {
				users = users.filter(u => this._isUserOnline(u));
			}

			// If no one connected
			if (!users.length) {
				const emptyDlg = new foundry.applications.api.DialogV2({
					window: { title: this.title, modal: true, width: 520 },
					content: `
						<section style="display:flex;flex-direction:column;gap:.75rem;min-width:520px;">
							<div>
								<div style="font-weight:600;">${LT.dialogSetting()}</div>
								<div>${this.settingId}</div>
								<div style="opacity:.8">${settingPretty} • ${ns} (${sourcePretty})</div>
							</div>
							<div>
								<div style="font-weight:600;">${LT.dialogValue()}</div>
								<pre style="margin:0;padding:.5rem;background:#00000014;border-radius:.25rem;white-space:pre-wrap;word-break:break-word;max-height:12rem;overflow:auto;">${this._renderValuePreview(this.valuePreview)}</pre>
							</div>
							<hr/>
							<p style="margin:.25rem 0 .5rem 0;">${LT.dialogNoUsersConnected()}</p>
						</section>
					`,
					buttons: [{ action: "close", label: LT.buttons.close(), default: true }]
				});
				await emptyDlg.render(true);
				return;
			}

			/* 	Build pre-check set ======================================================
				- If preChecked === "*"  => pre-check all current (filtered) non-GM users
				- If preChecked is array => pre-check those IDs
				- Else                   => pre-check none
			  ============================================================================ */
			let pre;
			if (this.preChecked === "*") {
				pre = new Set(users.map(u => u.id));
			} else if (Array.isArray(this.preChecked)) {
				pre = new Set(this.preChecked);
			} else {
				pre = new Set();
			}

			// Role label helper (Trusted vs Player)
			const roleLabel = (u) => {
				try {
					if (u.isGM) return LT.roleGM();
					return (typeof u.role === "number" && u.role >= 2) ? LT.roleTrusted() : LT.rolePlayer();
				} catch {
					return LT.rolePlayer();
				}
			};

			const rows = users.map(u => {
				const checked = pre.has(u.id) ? " checked" : "";
				return `
					<tr data-user-id="${u.id}">
						<td style="padding:.25rem .5rem;white-space:nowrap;">
							<input type="checkbox" name="u" value="${u.id}"${checked}>
						</td>
						<td style="padding:.25rem .5rem;white-space:nowrap;">${u.name ?? "(unnamed)"}</td>
						<td style="padding:.25rem .5rem;opacity:.8;">${roleLabel(u)}</td>
					</tr>
				`;
			}).join("");

			const content = `
				<section style="display:flex;flex-direction:column;gap:.75rem;min-width:520px;">
					<div>
						<div style="font-weight:600;">${LT.dialogSetting()}</div>
						<div>${this.settingId}</div>
						<div style="opacity:.8">${settingPretty} • ${ns} (${sourcePretty})</div>
					</div>
					<div>
						<div style="font-weight:600;">${LT.dialogValue()}</div>
						<pre style="margin:0;padding:.5rem;background:#00000014;border-radius:.25rem;white-space:pre-wrap;word-break:break-word;max-height:12rem;overflow:auto;">${this._renderValuePreview(this.valuePreview)}</pre>
						<div style="font-weight:600;">${LT.dialogNoteCurrentSaved()}</div>
					</div>
					<hr/>
					<div style="display:flex;align-items:center;justify-content:space-between;">
						<div style="font-weight:600;">${LT.dialogSelectUsers()}</div>
						<div style="display:flex;gap:.5rem;">
							<button type="button" data-action="all">${LT.dialogSelectAll()}</button>
							<button type="button" data-action="none">${LT.dialogClear()}</button>
						</div>
					</div>
					<div style="max-height:300px;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:.25rem;">
						<table style="width:100%;border-collapse:collapse;">
							<thead style="position:sticky;top:0;background:rgba(0,0,0,.2);">
								<tr>
									<th style="text-align:left;width:2rem;"></th>
									<th style="text-align:left;">${LT.dialogUser()}</th>
									<th style="text-align:left;">${LT.dialogRole()}</th>
                                </tr>
							</thead>
							<tbody>${rows}</tbody>
						</table>
					</div>
				</section>
			`;

			const dlg = new foundry.applications.api.DialogV2({
				window: { title: this.title, modal: true, width: 860 },
				content,
				buttons: [
					{
						action: "confirm",
						label: this.confirmLabel || LT.dialogQueue(),
						default: true,
						// Allow zero selection to mean "unlock"/"no targets"
						callback: async (event, button, dialog) => {
							const root = dialog.element ?? dialog;
							const picks = Array.from(root.querySelectorAll('input[name="u"]'))
								.filter(el => el.checked)
								.map(el => el.value);

							DL(`BBMMUserPicker: confirm picks=${picks.length}`, picks);
							await this.onConfirm(picks);
							return true;
						}
					},
					{ action: "cancel", label: LT.buttons.cancel() }
				]
			});

			// Render then wire handlers
			await dlg.render(true);

			try {
				const root = dlg.element?.[0] ?? dlg.element ?? document;

				// Select all / Clear event listener
				root.querySelector('[data-action="all"]')?.addEventListener("click", () => {
					root.querySelectorAll('input[name="u"]').forEach(cb => cb.checked = true);
					DL("BBMMUserPicker: select all");
				});
				root.querySelector('[data-action="none"]')?.addEventListener("click", () => {
					root.querySelectorAll('input[name="u"]').forEach(cb => cb.checked = false);
					DL("BBMMUserPicker: clear all");
				});

				// Row click toggles checkbox (but not when clicking checkbox itself)
				root.querySelectorAll('tbody tr').forEach(tr => {
					tr.addEventListener("click", (ev) => {
						if (ev.target.closest('input[type="checkbox"]')) return;
						const cb = tr.querySelector('input[name="u"]');
						if (cb) cb.checked = !cb.checked;
					});
				});
			} catch (wireErr) {
				DL(2, "BBMMUserPicker: wire handlers error", wireErr);
			}
		} catch (err) {
			DL(3, "BBMMUserPicker.show(): error", err);
		}
	}
}


/*
	=======================================================
        Capture registrations  
	=======================================================
*/
Hooks.once("init", () => {
	try {
		
		const orig = game.settings.register.bind(game.settings);
		game.settings.register = function bbmm_register(namespace, key, data) {
			try {
				const id = `${namespace}.${key}`;
				BBMM_REG.byId.set(id, {
					namespace,
					key,
					scope: data?.scope,
					requiresReload: !!data?.requiresReload
				});
				// DL(`setting-sync.js |  lock-capture: registered ${id} (scope=${data?.scope})`);
			} catch (e) {
				DL(2, "setting-sync.js |  lock-capture: record error", e);
			}
			return orig(namespace, key, data);
		};

		// Bootstrap any already-registered settings before we wrapped register()
		for (const [id, cfg] of game.settings.settings) {
			if (!BBMM_REG.byId.has(id)) {
				BBMM_REG.byId.set(id, {
					namespace: cfg.namespace,
					key: cfg.key,
					scope: cfg.scope,
					requiresReload: !!cfg.requiresReload
				});
			}
		}
		// DL(`setting-sync.js |  lock-capture: bootstrap complete, total=${BBMM_REG.byId.size}`);
	} catch (err) {
		DL(3, "setting-sync.js |  lock-capture:init error", err);
	}
});

/*
	=======================================================
        Capture GM setting changes      
	=======================================================
*/
Hooks.on("closeSettingsConfig", async (app) => {
	try {

		if (!bbmmIsSyncEnabled()) return; // feature disabled?
		if (!game.user?.isGM) return;

		const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
		const ids = Object.keys(map);
		if (!ids.length) return;

		let changed = false;

		for (const id of ids) {
			const dot = id.indexOf(".");
			if (dot <= 0) continue;

			const ns = id.slice(0, dot);
			const key = id.slice(dot + 1);

			// Only user/client settings are enforced
			const cfg = game.settings.settings.get(id);
			if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

			const cur = game.settings.get(ns, key);
			const prev = map[id]?.value;

			// v13-safe compare
			if (!objectsEqual(cur, prev)) {
				// Preserve existing userIds if present
				const existing = map[id] || {};
				map[id] = {
					namespace: ns,
					key,
					value: cur,
					requiresReload: existing.requiresReload ?? !!cfg.requiresReload,
					...(Array.isArray(existing.userIds) ? { userIds: existing.userIds.slice() } : {})
				};
				changed = true;
				DL(`setting-sync.js |  bbmm-setting-lock: resnap on close ${id} ->`, cur);
			}
		}

		if (changed) {
			await game.settings.set(BBMM_ID, "userSettingSync", map);
			bbmmBroadcastTrigger(); // notify players after write
			DL("setting-sync.js |  bbmm-setting-lock: userSettingSync updated on closeSettingsConfig");
		}
	} catch (err) {
		DL(2, "setting-sync.js |  bbmm-setting-lock: resnap on close error", err);
	}
});


/*
	=======================================================
		Player guard: prevent changing locked settings
	=======================================================
*/
Hooks.on("setSetting", async (namespace, key, value) => {
	try {

		if (!bbmmIsSyncEnabled()) return;
		if (game.user?.isGM) return;

		const id = `${namespace}.${key}`;
		const cfg = game.settings.settings.get(id);
		if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) return;

		const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
		const entry = map[id];
		if (!entry) return; // not locked at all

		// Respect per-user locks: if userIds exist but don't include me > not locked for me
		const list = Array.isArray(entry.userIds) ? entry.userIds : null;
		if (list && !list.includes(game.user.id)) return;

		// Revert if different from GM value
		const equal = objectsEqual(value, entry.value);
		if (!equal) {
			DL(`setting-sync.js |  bbmm-setting-lock: player attempted to change locked ${id}, reverting`);
			setTimeout(async () => {
				try {
					await game.settings.set(namespace, key, entry.value);
					ui.notifications?.warn?.(LT.sync.LockedByGM());
				} catch (err) {
					DL(2, "setting-sync.js |  bbmm-setting-lock: revert error", err);
				}
			}, 0);
		}
	} catch (err) {
		DL(2, "setting-sync.js |  bbmm-setting-lock: setSetting guard error", err);
	}
});

/*
	=======================================================
        GM: decorate settings UI (icons for user/client) 
	=======================================================
*/
Hooks.on("renderSettingsConfig", (app, html) => {
	try {

		if (!bbmmIsSyncEnabled()) return; // feature disabled?

		const form = app?.form || html?.[0] || app?.element?.[0] || document;

		// Player branch: HIDE locked controls completely
		if (!game.user?.isGM) {
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const lockedIds = new Set();
			const myId = game.user?.id;

			for (const [id, rec] of Object.entries(syncMap)) {
				// If userIds omitted > lock for all users (back-compat).
				// If userIds present > lock only when current user is targeted.
				const list = Array.isArray(rec?.userIds) ? rec.userIds : null;
				if (!list || (myId && list.includes(myId))) {
					lockedIds.add(id);
				}
			}
			let seen = 0, hidden = 0;
			
			// Helper: hide an element robustly
			const hideNode = (el) => {
				try { el.classList.add("bbmm-locked-hide"); el.style.display = "none"; } catch {}
			};

			// 1) Hide each locked setting's group
			const labels = form.querySelectorAll?.('label[for^="settings-config-"]') || [];
			for (const label of labels) {
				const forAttr = label.getAttribute("for");
				if (!forAttr) continue;

				const id = forAttr.replace(/^settings-config-/, "");
				const cfg = game.settings.settings.get(id);
				if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

				seen++;
				if (!lockedIds.has(id)) continue;

				// Try to find the whole row/group to remove
				let group =
					label.closest(".form-group, .form-group-stacked, .form-fields") ||
					label.parentElement;

				// Fallback: derive by input name if needed
				if (!group) {
					const sel = `input[name="settings.${cfg.namespace}.${cfg.key}"], select[name="settings.${cfg.namespace}.${cfg.key}"], textarea[name="settings.${cfg.namespace}.${cfg.key}"]`;
					const input = form.querySelector(sel);
					group = input?.closest(".form-group, .form-group-stacked, .form-fields") || input?.parentElement || label;
				}

				if (group) {
					hideNode(group);
					group.setAttribute("data-bbmm-hidden", "true");
					hidden++;
				}
			}

			// 2) Hide section headers that have no visible rows left
			const sections = form.querySelectorAll?.(".settings-list, fieldset") || [];
			for (const section of sections) {
				// Any visible rows?
				const hasVisible = section.querySelector(':scope .form-group:not(.bbmm-locked-hide), :scope .form-group-stacked:not(.bbmm-locked-hide), :scope .form-fields:not(.bbmm-locked-hide)');
				if (!hasVisible) {
					// Hide the section and its heading if present
					hideNode(section);
					const heading = section.previousElementSibling;
					if (heading && (heading.matches("h2,h3,h4") || heading.classList.contains("form-header"))) {
						hideNode(heading);
					}
				}
			}

			DL(`setting-sync.js |  bbmm-setting-lock: decorate(PLAYER-HIDE): seen=${seen}, hidden=${hidden}`);

			// Prevent “Save Changes” from doing anything unexpected (nothing left to serialize)
			form.addEventListener("submit", (ev) => {
				DL("setting-sync.js |  bbmm-setting-lock: submit guard — nothing to save for hidden locked settings");
			}, true);

			return;	// IMPORTANT: don't run GM UI decoration
		}

		// GM branch
		const decorate = () => {
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const labels = form.querySelectorAll?.('label[for^="settings-config-"]') || [];

			let found = 0, attached = 0;

			for (const label of labels) {
				const forAttr = label.getAttribute("for");
				if (!forAttr) continue;

				const id = forAttr.replace(/^settings-config-/, "");
				const cfg = BBMM_REG.byId.get(id) || game.settings.settings.get(id);
				if (!cfg) continue;

				if (!(cfg.scope === "user" || cfg.scope === "client")) continue;
				found++;

				let bar = label.querySelector(".bbmm-lock-icons");
				if (!bar) {
					bar = document.createElement("span");
					bar.className = "bbmm-lock-icons";
					label.appendChild(bar);
				} else {
					bar.innerHTML = "";
				}

				const makeIcon = (title, classes, clickable = false) => {
					const i = document.createElement("i");
					i.className = classes;
					i.title = title;
					if (clickable) i.classList.add("bbmm-click");
					bar.appendChild(i);
					return i;
				};

				// scope badge
				makeIcon(
					cfg.scope === "user" ? (LT.sync.BadgeUser()) : (LT.sync.BadgeClient()),
					"fa-solid fa-user bbmm-badge"
				);

				// Compute per-user lock state for THIS id
				const state = bbmmGetLockState(id, syncMap);
				// DL(`setting-sync.js | decorate(): ${id} state=${state}`);

				// Choose icon + tooltip based on state
				let lockIcon;
				if (state === "all") {
					lockIcon = makeIcon(LT.lockAllTip(), "fa-solid fa-lock", true);
					lockIcon.classList.add("bbmm-active"); // orange (see CSS)
				} else if (state === "partial") {
					lockIcon = makeIcon(LT.lockPartialTip(), "fa-solid fa-user-lock", true);
					lockIcon.classList.add("bbmm-partial"); // blue (see CSS)
				} else {
					lockIcon = makeIcon(LT.sync.ToggleHint(), "fa-solid fa-lock", true);
				}

				// sync/push icon: force this one setting now to players
				const pushTitle = (LT.sync.PushHint());
				const pushIcon = makeIcon(pushTitle, "fa-solid fa-arrows-rotate", true);
				pushIcon.addEventListener("click", (ev) => {
					try {
						ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

						const selectUsers = !!game.settings.get(BBMM_ID, SELECT_USERS_KEY);
						const dot = id.indexOf(".");
						const ns = id.slice(0, dot);
						const key = id.slice(1 + dot);

						if (!selectUsers) {
							// Legacy immediate behavior
							bbmmPushSetting(ns, key);
							return;
						}

						const val = game.settings.get(ns, key);
						const picker = new BBMMUserPicker({
							title: LT.titleSyncForUsers(),
							settingId: id,
							valuePreview: val,
							confirmLabel: LT.dialogQueueSync(),
							onlyOnline: true, // show only currently connected users
							onConfirm: async (userIds) => {
								_bbmmQueueOp({ op: "push", id, namespace: ns, key, value: val, userIds });
								ui.notifications.info(LT.infoQueuedSync({ module: id, count: userIds.length }));
							}
						});
						picker.show();
					} catch (err) {
						DL(2, "bbmm-setting-lock(push): click error", err);
					}
				});

				// Lock icon handler
				const toggleLock = (ev) => {
					try {
						ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

						const selectUsers = !!game.settings.get(BBMM_ID, SELECT_USERS_KEY);
						if (selectUsers) {
							// Queue per-user lock; do NOT modify the map yet
							const dot = id.indexOf(".");
							const ns = id.slice(0, dot);
							const key = id.slice(1 + dot);
							const curVal = game.settings.get(ns, key);

							// Read any existing selection for this setting so we can pre-check them
							const currentMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
							const existing = currentMap[id];
							const preChecked = existing
								? (Array.isArray(existing.userIds) ? existing.userIds.slice() : "*") // "*" > pre-check all non-GM
								: [];

							const picker = new BBMMUserPicker({
								title: LT.titleLockForUsers(),
								settingId: id,
								valuePreview: curVal,
								preChecked,
								confirmLabel: LT.dialogQueueLock(),
								onConfirm: async (userIds) => {
									_bbmmQueueOp({ op: "lock", id, namespace: ns, key, value: curVal, userIds });
									ui.notifications.info(LT.infoQueuedLock({ module: id, count: userIds.length }));
								}
							});
							picker.show();
							return;
						}

						// Legacy immediate behavior (existing toggle)
						const currentMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
						const already = !!currentMap[id];

						if (already) {
							delete currentMap[id];
							game.settings.set(BBMM_ID, "userSettingSync", currentMap).then(() => {
								lockIcon.classList.remove("bbmm-active");
								lockIcon.classList.remove("bbmm-partial");
								DL(`setting-sync.js |  bbmm-setting-lock: removed ${id}`);
								bbmmBroadcastTrigger();
							});
						} else {
							const dot = id.indexOf(".");
							const namespace = id.slice(0, dot);
							const key = id.slice(1 + dot);
							const currentValue = game.settings.get(namespace, key);

							const prev = currentMap[id] || {};
							currentMap[id] = {
								namespace, key,
								value: currentValue,
								requiresReload: !!cfg.requiresReload,
								...(Array.isArray(prev.userIds) ? { userIds: prev.userIds.slice() } : {})
							};
							game.settings.set(BBMM_ID, "userSettingSync", currentMap).then(() => {
								// Since legacy is a global lock, set to "all"
								lockIcon.classList.add("bbmm-active");
								lockIcon.classList.remove("bbmm-partial");
								DL(`setting-sync.js |  bbmm-setting-lock: added ${id}`, currentValue);
								bbmmBroadcastTrigger();
							});
						}
					} catch (err) {
						DL(3, "bbmm-setting-lock(toggle): error", err);
						ui.notifications?.error?.(LT.syncToggleError());
					}
				};

				lockIcon.addEventListener("click", toggleLock);
				lockIcon.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") toggleLock(e);
				});

				attached++;
			}

			DL(`setting-sync.js |  bbmm-setting-lock: decorate(): user/client found=${found}, bars attached=${attached}`);
		};


		// Paint now + a couple of retries; re-run on tab clicks
		decorate();
		requestAnimationFrame(decorate);
		setTimeout(decorate, 50);
		setTimeout(decorate, 200);

		const tabBtns = form.querySelectorAll?.('nav.tabs [data-action="tab"]') || [];
		for (const btn of tabBtns) {
			btn.addEventListener("click", () => setTimeout(decorate, 0), { passive: true });
		}

		// Apply queued ops right after the Settings form is submitted (Save Changes)
		form.addEventListener("submit", (ev) => {
			setTimeout(() => {
				_bbmmApplyPendingOps().catch(err => DL(3, "_bbmmApplyPendingOps(): error", err));
			}, 0);
		}, { passive: true });
	} catch (err) {
		DL(3, "setting-sync.js |  bbmm-setting-lock: renderSettingsConfig(): error", err);
	}
});

/*
	=======================================================
        Player: apply on ready; 
        GM: inject CSS; 
        All: listen for triggers
	=======================================================
*/
Hooks.once("ready", async () => {
	try {

		// Check if feature enabled 
		if (!bbmmIsSyncEnabled()) {
			DL("setting-sync.js |  bbmm-setting-lock: disabled, skipping ready features");
			return;								
		}

		if (game.user?.isGM) { // GM: inject CSS for the icons
			bbmmResnapUserSync(); // GM: resnap map to keep values fresh

			/* Now in bbmm.css
			const css = document.createElement("style");
			css.id = `${BBMM_ID}-lock-style`;
			css.textContent = `
				.bbmm-lock-icons i + i { margin-left: .35rem; }
				.bbmm-lock-icons { display:inline-flex; gap:.4rem; margin-left:.4rem; vertical-align:middle; }
				.bbmm-lock-icons .bbmm-badge { opacity:.85; }
				.bbmm-lock-icons .bbmm-click { cursor:pointer; opacity:.85; }
				.bbmm-lock-icons .bbmm-click:hover { opacity:1; transform: translateY(-1px); }
				.bbmm-lock-icons .bbmm-active { color: orange; }
				.bbmm-lock-icons .bbmm-partial { filter: hue-rotate(25deg) saturate(1.2); }

				// Player disabled styles 
				.bbmm-locked-input { opacity: .65; pointer-events: none; }
				.bbmm-locked-badge { display: inline-flex; align-items: center; gap: .25rem; margin-left: .4rem; color: var(--color-text-dark-secondary, #999); }
				.bbmm-locked-hide { display: none !important; }
			`;
			document.head.appendChild(css);
			*/

			DL("setting-sync.js |  bbmm-setting-lock: injected CSS");
			return;
		}

		// Player: apply GM-enforced settings (initial)
		const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
		const initialEntries = Object.values(syncMap);

		if (initialEntries.length) {
			let changed = false, needsReload = false;

			for (const ent of initialEntries) {
				try {
					const cfg = game.settings.settings.get(`${ent.namespace}.${ent.key}`);
					if (!cfg || !(cfg.scope === "user" || cfg.scope === "client")) continue;

					const current = game.settings.get(ent.namespace, ent.key);
					if (!objectsEqual(current, ent.value)) {
						DL(`setting-sync.js |  bbmm-setting-lock: apply ${ent.namespace}.${ent.key} ->`, ent.value);
						await game.settings.set(ent.namespace, ent.key, ent.value);
						changed = true;
						if (ent.requiresReload || cfg.requiresReload) needsReload = true;
					}
				} catch (err) {
					DL(2, "setting-sync.js |  bbmm-setting-lock: apply error", err);
				}
			}

			if (changed && needsReload) {
				try {
					new foundry.applications.api.DialogV2({
						window: { title: LT.sync.ReloadTitle(), modal: true },
						content: `<p>${LT.sync.ReloadMsg()}</p>`,
						buttons: [
							{ action: "reload", label: LT.sync.ReloadNow(), icon: "fa-solid fa-arrows-rotate", default: true, callback: () => { try { location.reload(); } catch {} } },
							{ action: "later",  label: LT.sync.ReloadLater(), icon: "fa-regular fa-clock", callback: () => {} }
						],
						submit: () => {},
						rejectClose: false
					}).render(true);
				} catch (err) {
					DL(2, "setting-sync.js |  bbmm-setting-lock: could not show reload dialog", err);
					ui.notifications?.warn?.(LT.sync.ReloadWarn());
				}
			} else if (changed) {
				ui.notifications?.info?.(LT.sync.Updated());
			}
		}

		// All clients: listen for live refresh triggers (always installed)
		if (game.socket) {
			game.socket.on(BBMM_SYNC_CH, async (msg) => {
				if (msg?.t === "bbmm-sync-push") { // Pushing single setting sync
					
					// Players only
					if (game.user?.isGM) return;

					// Respect optional targeting
					const targets = Array.isArray(msg?.targets) ? msg.targets : null;
					if (targets && targets.length && !targets.includes(game.user.id)) return;

					const { namespace, key, value, requiresReload } = msg;
					const id = `${namespace}.${key}`;
					const cfg = game.settings.settings.get(id);
					if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) return;

					const current = game.settings.get(namespace, key);
					if (!objectsEqual(current, value)) {
						DL(`setting-sync.js |  bbmm-setting-lock: push apply ${id} ->`, value);
						await game.settings.set(namespace, key, value);

						if (requiresReload || cfg.requiresReload) {
							try {
								new foundry.applications.api.DialogV2({
									window: { title: LT.sync.ReloadTitle(), modal: true },
									content: `<p>${LT.sync.ReloadMsg()}</p>`,
									buttons: [
										{ action: "reload", label: LT.sync.ReloadNow(), icon: "fa-solid fa-arrows-rotate", default: true, callback: () => { try { location.reload(); } catch {} } },
										{ action: "later",  label: LT.sync.ReloadLater(), icon: "fa-regular fa-clock", callback: () => {} }
									],
									submit: () => {},
									rejectClose: false
								}).render(true);
							} catch {
								ui.notifications?.warn?.(LT.sync.ReloadWarn());
							}
						} else {
							ui.notifications?.info?.(LT.sync.Updated());
						}
					}
					return; // handled
				} else if (msg.t === "bbmm-sync-refresh") {
					if (game.user?.isGM) return; // GM doesn't need to apply

					DL("setting-sync.js |  bbmm-setting-lock: received refresh trigger");

					const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
					let changed = false, needsReload = false;

					for (const ent of Object.values(map)) {
						if (!ent || typeof ent.namespace !== "string" || typeof ent.key !== "string") continue;

						const id = `${ent.namespace}.${ent.key}`;
						const cfg = game.settings.settings.get(id);
						if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

						const current = game.settings.get(ent.namespace, ent.key);
						if (!objectsEqual(current, ent.value)) {
							DL(`setting-sync.js |  bbmm-setting-lock: trigger apply ${id} ->`, ent.value);
							await game.settings.set(ent.namespace, ent.key, ent.value);
							changed = true;
							if (ent.requiresReload || cfg.requiresReload) needsReload = true;
						}
					}

					if (changed && needsReload) {
						try {
							new foundry.applications.api.DialogV2({
								window: { title: LT.sync.ReloadTitle(), modal: true },
								content: `<p>${LT.sync.ReloadMsg()}</p>`,
								buttons: [
									{ action: "reload", label: LT.sync.ReloadNow(), icon: "fa-solid fa-arrows-rotate", default: true, callback: () => { try { location.reload(); } catch {} } },
									{ action: "later",  label: LT.sync.ReloadLater(), icon: "fa-regular fa-clock", callback: () => {} }
								],
								submit: () => {},
								rejectClose: false
							}).render(true);
						} catch (err) {
							ui.notifications?.warn?.(LT.sync.ReloadWarn());
						}
					} else if (changed) {
						ui.notifications?.info?.(LT.sync.Updated());
					}
				} 
			});
		}
	} catch (err) {
		DL(3, "setting-sync.js |  bbmm-setting-lock: ready(): error", err);
	}
});
