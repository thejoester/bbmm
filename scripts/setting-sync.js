/*  BBMM Setting Lock===========================================================
	- GM: adds Person icon + Lock icon to every *user/client* setting
	- GM clicking Lock icon: toggle in bbmm.userSettingSync (store/remove GM value)
	- Player: on ready, apply diffs; show reload dialog if needed
	- GM updates: broadcast a lightweight trigger; clients pull & apply
============================================================================== */

import { DL } from "./settings.js";
import { CTRL_STORE_KEY, CTRL_REV_STORE, CTRL_TOGGLE } from "./settings.js"; // Controls-Sync consts
import { LT, BBMM_ID } from "./localization.js";


/* ============================================================================
        {GLOBALS}
============================================================================= */

	const BBMM_REG = { byId: new Map() };	// Live registry of settings
	const BBMM_SYNC_CH = `module.${BBMM_ID}`;	// Socket channel for this module
	const _bbmmPendingOps = [];	 // Pending operations queue (applied on Save Changes)
	/*  equality helper ============================================================ */
	const objectsEqual = foundry?.utils?.objectsEqual ?? ((a, b) => { 
		try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
	});
	let _bbmmTriggerTimer = null; // For bbmmBroadcastTrigger()

/* ============================================================================
        {SETTINGS SYNC HELPERS}
============================================================================ */

	/*  Detect if unlock is queued =================================================
		Detect if an lock removal is queued for a given id.
		- Returns true if there is a 'lock' op for this id with userIds=[]
	============================================================================== */
	function _bbmmIsUnlockQueued(id) {
	try {
		return _bbmmPendingOps.some(op =>
		op?.id === id && (
			(op.op === "lock" && Array.isArray(op.userIds) && op.userIds.length === 0) ||
			(op.op === "soft" && op.soft === false)
		)
		);
	} catch { return false; }
	}

	/* Update the lock icon =======================================================
		Update the lock icon glyph + tint for a given state
		States: "unlocked" | "lockSelected" | "softLock" | "lockAll"
	============================================================================ */
	function _bbmmSetLockIconState(iconEl, state) {
		try {
			iconEl.classList.remove(
				"fa-lock-open", "fa-user-lock", "fa-lock",
				"fa-solid", "fa-regular", "bbmm-active", "bbmm-partial"
			);

			switch (state) {
				case "lockSelected":
					iconEl.className = "fa-solid fa-user-lock bbmm-partial";
					iconEl.title = LT.lockPartialTip();
					break;
				case "softLock":
					// If FA build lacks 'fa-regular fa-lock', the fallback color still shows via bbmm-active
					iconEl.className = "fa-regular fa-lock bbmm-active";
					iconEl.title = LT.name_SoftLock();
					break;
				case "lockAll":
					iconEl.className = "fa-solid fa-lock bbmm-active";
					iconEl.title = LT.lockAllTip();
					break;
				default:
					iconEl.className = "fa-solid fa-lock-open";
					iconEl.title = LT.sync?.ToggleHint();
					break;
			}
			iconEl.dataset.lockState = state || "unlocked";
		} catch (err) {
			DL(2, "_bbmmSetLockIconState(): failed", err);
		}
	}

	/* Clear Locks ================================================================
		remove any lock for this setting.
		Queues two ops:
		- soft:false -> removes the soft entry if present
		- lock with userIds:[] -> removes any hard lock entry
	============================================================================ */
	async function _bbmmApplyClearLocks({ id, ns, key, iconEl }) {
		try {
			DL(`setting-sync.js | clearLocks for ${id}`);

			// Remove soft-lock record (if any)
			_bbmmQueueOp({ op: "soft", id, namespace: ns, key, soft: false });

			// Remove hard-lock record (unlock)
			_bbmmQueueOp({ op: "lock", id, namespace: ns, key, value: undefined, userIds: [] });

			// Update icon
			_bbmmSetLockIconState(iconEl, "unlocked");

			// UX note
			ui.notifications?.info?.(LT.infoClearedLocks());
		} catch (err) {
			DL(2, "_bbmmApplyClearLocks(): failed", err);
		}
	}

	/* Route a gesture to the configured action ==================================== */
	async function _bbmmHandleLockGesture({ id, iconEl, gesture }) {

		try {
			const dot = id.indexOf(".");
			const ns = id.slice(0, dot);
			const key = id.slice(1 + dot);
			
			/* Gesture > Action mapping ===================================================
				Gesture > Action mapping (GM world settings with fallback)
				Returns: { click: "lockSelected"|"softLock"|"lockAll", shift: ..., right: ... }
			============================================================================ */
			function _bbmmBuildGestureActionMap() {
				try {
					let clickAct, shiftAct, rightAct, shiftRightAct;
					try { clickAct = game.settings.get(BBMM_ID, "gestureAction_click"); } catch {}
					try { shiftAct = game.settings.get(BBMM_ID, "gestureAction_shift"); } catch {}
					try { rightAct = game.settings.get(BBMM_ID, "gestureAction_right"); } catch {}
					try { shiftRightAct = game.settings.get(BBMM_ID, "gestureAction_shiftRight"); } catch {}

					const valid = new Set(["lockSelected", "softLock", "lockAll", "clearLocks"]);
					const good = (v) => valid.has(v);

					if (good(clickAct) && good(shiftAct) && good(rightAct) && good(shiftRightAct)) {
						return { click: clickAct, shift: shiftAct, right: rightAct, shiftRight: shiftRightAct };
					}

					// Fallback defaults if any are missing
					return {
						click: good(clickAct) ? clickAct : "lockSelected",
						shift: good(shiftAct) ? shiftAct : "softLock",
						right: good(rightAct) ? rightAct : "lockAll",
						shiftRight: good(shiftRightAct) ? shiftRightAct : "clearLocks"
					};
				} catch (err) {
					DL(2, "_bbmmBuildGestureActionMap(): error, using defaults", err);
					return { click: "lockSelected", shift: "softLock", right: "lockAll", shiftRight: "clearLocks" };
				}
			}

			/* Gesture Action handlers ====================================================
				Action handlers invoked by gesture router
				- All three queue ops so they apply on “Save Changes”
			============================================================================ */
			async function _bbmmApplyLockAll() {
				try {
					const curVal = game.settings.get(ns, key);
					// Non-GM users only
					const targets = (game.users?.contents || []).filter(u => !u.isGM).map(u => u.id);
					_bbmmQueueOp({ op: "lock", id, namespace: ns, key, value: curVal, userIds: targets });
					_bbmmSetLockIconState(iconEl, "lockAll");
					ui.notifications?.info?.(LT.infoQueuedLock?.({ module: id, count: targets.length }));
				} catch (err) {
					DL(2, "_bbmmApplyLockAll(): failed", err);
				}
			}

			/* Apply Soft Lock ============================================================== 
				Soft Lock:
				- Enable: store { soft:true, value:snapshot } 
					and PUSH ONCE (soft:true) to non-GM users.
				- Disable: remove soft entry; no push.
				- Players may change later; we do not revert.
			================================================================================*/
			async function _bbmmApplySoftLock() {
				try {
					const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
					const existing = map[id];

					// Toggle on if not currently soft
					const enable = !(existing && existing.soft === true);

					// Snapshot GM value when enabling (recommended value)
					let snapshot = undefined;
					if (enable) {
					try { snapshot = game.settings.get(ns, key); }
					catch (e) { DL(2, `_bbmmApplySoftLock(): read fail ${id}`, e); }
					}

					// Queue soft op (this also clears any queued hard/partial lock)
					_bbmmQueueOp({ op: "soft", id, namespace: ns, key, soft: enable, value: snapshot });

					// UI: update icon state immediately
					_bbmmSetLockIconState(iconEl, enable ? "softLock" : "unlocked");

					// Notify — reuse existing strings if present, else fallbacks
					if (enable) {
					ui.notifications?.info?.(
						LT?.infoQueuedLock?.({ module: id, count: 0 }) ||
						LT?.name_SoftLock?.() ||
						"Soft lock queued"
					);
					} else {
					ui.notifications?.info?.(
						LT?.controlsCleared?.() || "Lock cleared"
					);
					}

					DL(`setting-sync.js | bbmm-setting-lock(soft): ${enable ? "queued enable" : "queued disable"} ${id}`, snapshot);
				} catch (err) {
					DL(2, "_bbmmApplySoftLock(): failed", err);
				}
			}

			/* Apply Lock to Selected Users ==============================================
				Soft Lock (toggle on/off). 
				Stores a snapshot 'value' so we can auto-push if enabled.
			============================================================================*/
			async function _bbmmApplyLockSelected() {
				try {
					const curVal = game.settings.get(ns, key);
					const currentMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
					const existing = currentMap[id];
					const preChecked = existing
						? (Array.isArray(existing.userIds) && existing.userIds.length ? existing.userIds : "*")
						: [];

					const picker = new BBMMUserPicker({
						title: LT.titleLockForUsers?.() || "Lock for Selected Users",
						settingId: id,
						valuePreview: curVal,
						preChecked,
						confirmLabel: LT.dialogQueueLock?.() || "Queue Lock",
						onConfirm: async (userIds) => {
							// Queue lock; 0 users = unlock
							_bbmmQueueOp({ op: "lock", id, namespace: ns, key, value: curVal, userIds });

							if (!Array.isArray(userIds) || userIds.length === 0) {
								_bbmmSetLockIconState(iconEl, "unlocked");
							} else {
								const nonGMCount = (game.users?.contents || []).filter(u => !u.isGM).length;
								_bbmmSetLockIconState(iconEl, userIds.length === nonGMCount ? "lockAll" : "lockSelected");
							}

							ui.notifications?.info?.(
								LT.infoQueuedLock?.({ module: id, count: userIds?.length ?? 0 }) ||
								`Queued lock for ${userIds?.length ?? 0} users`
							);
						}
					});
					picker.show();
				} catch (err) {
					DL(2, "_bbmmApplyLockSelected(): failed", err);
				}
			}

			const map = _bbmmBuildGestureActionMap();
			const action = map?.[gesture] || "lockSelected";

			DL(`setting-sync.js | gesture "${gesture}" -> action "${action}" for ${id}`);

			switch (action) {
				case "lockAll":		return _bbmmApplyLockAll();
				case "softLock":	return _bbmmApplySoftLock();
				case "clearLocks":	return _bbmmApplyClearLocks({ id, ns, key, iconEl });
				case "lockSelected":
				default:			return _bbmmApplyLockSelected();
			}
		} catch (err) {
			DL(2, "_bbmmHandleLockGesture(): error", err);
		}
	}

	/*  Queue a pending lock or push operation until "Save Changes" ================ */
	function _bbmmQueueOp(entry) {
		try {
			// Remove conflicting op type for this id
			const opposite = entry.op === "soft" ? "lock" :
							entry.op === "lock" ? "soft" : null;
			if (opposite) {
			for (let i = _bbmmPendingOps.length - 1; i >= 0; i--) {
				const op = _bbmmPendingOps[i];
				if (op?.id === entry.id && op.op === opposite) {
				_bbmmPendingOps.splice(i, 1);
				}
			}
			}

			// Normalize
			const clean = {
			...entry,
			userIds: Array.isArray(entry.userIds) ? entry.userIds.slice() : []
			};

			// Replace same-type op if already queued
			const idx = _bbmmPendingOps.findIndex(
			e => e.op === clean.op && e.id === clean.id
			);
			if (idx >= 0) {
			_bbmmPendingOps[idx] = clean;
			} else {
			_bbmmPendingOps.push(clean);
			}

			DL(`setting-sync.js | bbmm-queue: +${clean.op} ${clean.id}`, clean);
		} catch (err) {
			DL(3, "setting-sync.js | bbmm-queue: error", err);
		}
	}

	/*  Apply queued ops AFTER GM clicks Save Changes ============================== */
	async function _bbmmApplyPendingOps() {
		try {
			if (!_bbmmPendingOps.length) return;

			// World map snapshot + rev map
			let map = game.settings.get(BBMM_ID, "userSettingSync") || {};
			let revMap = game.settings.get(BBMM_ID, "softLockRevMap") || {};
			let mapChanged = false, revChanged = false;

			// Collect pushes to emit AFTER saving
			const softPushes = [];
			const hardPushes = [];

			// SOFT ops (rev-aware)
			for (const op of _bbmmPendingOps.filter(o => o.op === "soft")) {
				const { id, namespace, key, soft, value } = op;
				const cfg = game.settings.settings.get(id);
				if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

				if (soft === false) {
					// Disable soft: remove if present
					if (map[id]?.soft === true) {
						delete map[id];
						mapChanged = true;
						DL(`setting-sync.js |  bbmm-apply: soft REMOVE ${id}`);
					}
					continue;
				}

				// Enable: increment persistent rev (survives clears) then write map entry
				const currentRev = Number.isInteger(revMap[id]) ? revMap[id] : 0;
				const newRev = currentRev + 1;

				map[id] = {
					namespace,
					key,
					value, // snapshot from queue-time
					requiresReload: !!cfg?.requiresReload,
					soft: true,
					rev: newRev
				};
				mapChanged = true;

				revMap[id] = newRev;
				revChanged = true;

				softPushes.push({
					id, namespace, key,
					value,
					softRev: newRev,
					requiresReload: !!cfg?.requiresReload
				});
				DL(`setting-sync.js |  bbmm-apply: soft SET ${id} rev=${newRev}`, value);
			}

			// HARD/PARTIAL LOCK ops
			for (const op of _bbmmPendingOps.filter(o => o.op === "lock")) {
				const { id, namespace, key, value, userIds } = op;
				const cfg = game.settings.settings.get(id);
				if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

				const allTargets = (game.users?.contents || []).filter(u => !u.isGM).map(u => u.id);
				const selected = (Array.isArray(userIds) ? userIds : []).filter(uid => allTargets.includes(uid));

				// No users -> unlock
				if (selected.length === 0) {
					if (map[id]) {
						delete map[id];
						mapChanged = true;
						DL(`setting-sync.js |  bbmm-apply: lock REMOVE ${id} (no users)`);
					}
					continue;
				}

				// All non-GMs -> global lock (omit userIds)
				if (selected.length === allTargets.length) {
					map[id] = {
						namespace,
						key,
						value,
						requiresReload: !!cfg?.requiresReload
					};
					mapChanged = true;
					DL(`setting-sync.js |  bbmm-apply: lock ${id} (all users)`);
					continue;
				}

				// Partial
				map[id] = {
					namespace,
					key,
					value,
					requiresReload: !!cfg?.requiresReload,
					userIds: selected.slice()
				};
				mapChanged = true;
				DL(`setting-sync.js |  bbmm-apply: lock ${id} (users=${selected.length})`);
			}

			// PUSH ops (hard push now)
			for (const op of _bbmmPendingOps.filter(o => o.op === "push")) {
				hardPushes.push(op);
			}

			// Save world map once
			if (mapChanged) {
				await game.settings.set(BBMM_ID, "userSettingSync", map);
				DL("setting-sync.js |  bbmm-apply: map saved");
			}

			// Save rev map once
			if (revChanged) {
				await game.settings.set(BBMM_ID, "softLockRevMap", revMap);
				DL("setting-sync.js |  bbmm-apply: softLockRevMap saved");
			}

			// Broadcast UI refresh for badges
			if (mapChanged) bbmmBroadcastTrigger();

			// After save: emit one-time SOFT pushes (players do rev check)
			if (softPushes.length && game.socket) {
				const targets = (game.users?.contents || []).filter(u => !u.isGM).map(u => u.id);
				for (const sp of softPushes) {
					game.socket.emit(BBMM_SYNC_CH, {
						t: "bbmm-sync-push",
						soft: true,
						softRev: sp.softRev,
						namespace: sp.namespace,
						key: sp.key,
						value: sp.value,
						targets,
						requiresReload: sp.requiresReload
					});
					DL(`setting-sync.js |  bbmm-apply: soft PUSH ${sp.id} rev=${sp.softRev}`);
				}
			}

			// Emit queued hard pushes AFTER map save
			if (hardPushes.length && game.socket) {
				for (const op of hardPushes) {
					const { id, namespace, key, userIds } = op;
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
					DL(`setting-sync.js |  bbmm-apply: push ${id} (targets=${(op.userIds || []).length || "all"})`);
				}
			}

			_bbmmPendingOps.length = 0;
		} catch (err) {
			DL(3, "setting-sync.js |  bbmm-apply: error", err);
		}
	}

	// Helper: is feature enabled?
	function bbmmIsSyncEnabled() {
		try { return !!game.settings.get(BBMM_ID, "enableUserSettingSync"); }
		catch { return true; } // safe default if setting not found
	}

	/*  Get lock state for a setting: "none", "partial", or "all" ================== */	
	function bbmmGetLockState(id, map) {
		try {
			
			const rec = map?.[id];
			if (!rec) return "none";

			// Soft lock takes precedence over targeted locks for icon state
			if (rec?.soft === true) return "soft";

			const targets = (() => {
				try {
					const users = game.users?.contents || [];
					return users.filter(u => !u.isGM).map(u => u.id);
				} catch { return []; }
			})();
			const arr = Array.isArray(rec.userIds) ? rec.userIds : null;

			// No list stored -> treat as "all"
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

	/*  GM: trigger clients to refresh their local lock map ======================== */
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

	/* 	Class: BBMMUserPicker ======================================================
		- Shows a per-user selection dialog for Lock/Sync
		- preChecked: array of user IDs OR the string 
		"*" to pre-check all non-GM users
		- onlyOnline: when true, only show users currently 
		online/connected (for Sync)
	==============================================================================*/
	class BBMMUserPicker {
		constructor({ title, settingId, valuePreview, confirmLabel, preChecked, onlyOnline = false, minimal = false, onConfirm }) {
			this.title = title;
			this.settingId = settingId;
			this.valuePreview = valuePreview;
			this.onConfirm = typeof onConfirm === "function" ? onConfirm : () => {};
			this.confirmLabel = confirmLabel || "Queue";
			this.preChecked = Array.isArray(preChecked) || preChecked === "*" ? preChecked : [];
			this.onlyOnline = !!onlyOnline;
			this.minimal = !!minimal;  // hide Setting/Value block when true
		}

		// Helper: Render a safe preview for the value block
		_renderValuePreview(v) {
			try {
				if (v === null || v === undefined) return String(v);
				if (typeof v === "string") return v;
				return JSON.stringify(v, null, 2);
			} catch {
				try { return String(v); } catch { return "(unprintable)"; }
			}
		}

		// Helper: determine if a user is currently online/connected
		_isUserOnline(u) {
			try {
				return !!u.active;
			} catch {
				return false;
			}
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
				let users = (game.users?.contents ?? []).filter(u => !u.isGM);

				// Sync-only mode: restrict to currently-online users
				if (this.onlyOnline) users = users.filter(u => this._isUserOnline(u));

				// If no one connected
				if (!users.length) {
					const emptyDlg = new foundry.applications.api.DialogV2({
						window: { title: this.title, modal: true, width: 520 },
						content: `
						<section style="display:flex;flex-direction:column;gap:.75rem;min-width:520px;">
							<p style="margin:.25rem 0 .5rem 0;">
							${LT.dialogNoUsersConnected()}
							</p>
						</section>
						`,
						buttons: [{ action: "close", label: LT.buttons?.close?.() || "Close", default: true }]
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

				const headerBlock = this.minimal ? "" : `
					<div>
						<div style="font-weight:600;">${LT.dialogSetting()}</div>
						<div>${this.settingId}</div>
						<div style="opacity:.8">${settingPretty} • ${ns} (${sourcePretty})</div>
					</div>
					`;

				const detailsBlock = this.minimal ? "" : `
					<div>
						<div style="font-weight:600;">${LT.dialogValue()}</div>
						<pre style="margin:0;padding:.5rem;background:#00000014;border-radius:.25rem;white-space:pre-wrap;word-break:break-word;max-height:12rem;overflow:auto;">${this._renderValuePreview(this.valuePreview)}</pre>
						<div style="font-weight:600;">${LT.dialogNoteCurrentSaved()}</div>
					</div>
					`;

				const content = `
					<section style="display:flex;flex-direction:column;gap:.75rem;min-width:520px;">
						${headerBlock}
						${detailsBlock}
						<hr/>
						<table style="border-collapse:collapse;width:100%;">
							<thead>
								<tr>
									<th style="text-align:left;padding:.25rem .5rem;">Select</th>
									<th style="text-align:left;padding:.25rem .5rem;">User</th>
									<th style="text-align:left;padding:.25rem .5rem;">Role</th>
								</tr>
							</thead>
							<tbody>
								${rows}
							</tbody>
						</table>
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

								DL(`setting-sync.js | BBMMUserPicker: confirm picks=${picks.length}`, picks);
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
						DL("setting-sync.js | BBMMUserPicker: select all");
					});
					root.querySelector('[data-action="none"]')?.addEventListener("click", () => {
						root.querySelectorAll('input[name="u"]').forEach(cb => cb.checked = false);
						DL("setting-sync.js | BBMMUserPicker: clear all");
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
					DL(2, "setting-sync.js | BBMMUserPicker: wire handlers error", wireErr);
				}
			} catch (err) {
				DL(3, "setting-sync.js | BBMMUserPicker.show(): error", err);
			}
		}
	}

/* ============================================================================
        { SETTINGS SYNC HOOKS}
============================================================================ */

	/* ============================================================================
			{ HOOK: Init }
			- Capture all registered settings at init 
			(for decoration/lock support)
	=============================================================================*/
	Hooks.once("init", () => {
		try {
			// Capture registrations  
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

	/* ============================================================================
			{ HOOK: closeSettingsConfig } 
			- Capture GM setting changes      
	==============================================================================*/
	Hooks.on("closeSettingsConfig", async (app) => {
		try {

			if (!bbmmIsSyncEnabled()) return; // feature disabled?
			if (!game.user?.isGM) return;

			let map = game.settings.get(BBMM_ID, "userSettingSync") || {};
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

				// If an unlock is queued for this id, remove it and skip resnap
				if (_bbmmIsUnlockQueued?.(id)) {
					if (map[id]) {
						delete map[id];
						changed = true;
						DL(`setting-sync.js | closeSettingsConfig: unlock queued, removed ${id}`);
					}
					continue;
				}

				// If ANY op is queued for this id, skip resnap and let the queued op win after Save
				if (_bbmmPendingOps.some(op => op?.id === id)) {
					DL(`setting-sync.js | closeSettingsConfig: pending op exists, skipping resnap for ${id}`);
					continue;
				}

				// Current live GM value vs stored snapshot
				const cur = game.settings.get(ns, key);
				const existing = map[id];
				const prev = existing?.value;

				// Core rule: if GM changed a setting that had a lock (soft or hard), CLEAR the lock
				if (existing && !objectsEqual(cur, prev)) {
					delete map[id];
					changed = true;
					DL(`setting-sync.js | closeSettingsConfig: GM changed ${id} -> cleared lock`);
					continue;
				}

				// No GM change; keep entry, but refresh requiresReload if it drifted
				if (existing && (existing.requiresReload !== !!cfg.requiresReload)) {
					map[id] = {
						...existing,
						requiresReload: !!cfg.requiresReload
					};
					changed = true;
					DL(`setting-sync.js | closeSettingsConfig: refreshed requiresReload for ${id}`);
				}
			}

			if (changed) {
				await game.settings.set(BBMM_ID, "userSettingSync", map);
				bbmmBroadcastTrigger(); // notify players after write
				DL("setting-sync.js | bbmm-setting-lock: userSettingSync updated on closeSettingsConfig");
			}
		} catch (err) {
			DL(2, "setting-sync.js | bbmm-setting-lock: resnap on close error", err);
		}
	});


	/* ============================================================================
			{ HOOK: setSetting } 
			- Player guard: prevent changing locked settings
	==============================================================================*/
	Hooks.on("setSetting", async (namespace, key, value) => {
		try {

			if (!bbmmIsSyncEnabled()) return;
			if (game.user?.isGM) return;

			// CONTROLS: if a PLAYER updates core.keybindings, mark any SOFT ctrl revs as handled
			if (!game.user?.isGM && namespace === "core" && key === "keybindings") {
				try {
					const store = _bbmmCtrlGetStore();
					const revMap = _bbmmCtrlGetRevMap() || {};
					const ledger = game.settings.get(BBMM_ID, "softLockLedger") || {};
					let wrote = false;

					for (const [id, rec] of Object.entries(store)) {
					if (!(rec && rec.soft)) continue;
					const rev = Number(rec?.rev) || Number(revMap[id]) || 1;
					const lkey = `@ctrl:${id}`;
					const last = ledger[lkey];
					const lastRev = (last && typeof last === "object" && Number.isInteger(last.r)) ? last.r : -1;

					if (lastRev < rev) {
						ledger[lkey] = { r: rev };
						wrote = true;
						DL(`controls | soft-ledger: player handled ${id} (rev=${rev})`);
					}
					}

					if (wrote) await game.settings.set(BBMM_ID, "softLockLedger", ledger);
				} catch (e) {
					DL(2, "controls | soft-ledger mark on player change failed", e);
				}
			}

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

	/* ============================================================================
			{ HOOK: renderSettingsConfig } 
			- GM: decorate settings UI (icons for user/client) 
	=============================================================================*/
	Hooks.on("renderSettingsConfig", (app, html) => {
		try {

			if (!bbmmIsSyncEnabled()) return; // feature disabled?

			const form = app?.form || html?.[0] || app?.element?.[0] || document;

			/* Player branch =============================================================
				HIDE hard-locked controls; 
				keep SOFT visible/editable and record "handled" on change
			============================================================================*/
			if (!game.user?.isGM) {
				// NOTE: requires a user-scoped setting "softLockLedger" ({ "<ns>.<key>": "<JSON rec value>" })
				const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
				const myId = game.user?.id;

				let seen = 0, hidden = 0;

				// Helper: hide an element robustly
				const hideNode = (el) => {
					try { el.classList.add("bbmm-locked-hide"); el.style.display = "none"; } catch {}
				};

				// Walk each labeled row
				const labels = form.querySelectorAll?.('label[for^="settings-config-"]') || [];
				for (const label of labels) {
					const forAttr = label.getAttribute("for");
					if (!forAttr) continue;

					const id = forAttr.replace(/^settings-config-/, "");
					const cfg = game.settings.settings.get(id);
					if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

					seen++;

					// Locate the row/group
					let group =
						label.closest(".form-group, .form-group-stacked, .form-fields") ||
						label.parentElement;

					if (!group) {
						const sel = `input[name="settings.${cfg.namespace}.${cfg.key}"], select[name="settings.${cfg.namespace}.${cfg.key}"], textarea[name="settings.${cfg.namespace}.${cfg.key}"]`;
						const input = form.querySelector(sel);
						group = input?.closest(".form-group, .form-group-stacked, .form-fields") || input?.parentElement || label;
					}
					if (!group) continue;

					// Resolve state/record for this id
					const ent = syncMap[id];
					const state = bbmmGetLockState(id, syncMap);

					// SOFT: keep visible/editable; mark handled on any change so future soft pushes are ignored
					if (state === "soft" && ent?.soft === true) {
						// Ensure enabled/visible
						const input = group.querySelector?.("input, select, textarea");
						if (input) { input.disabled = false; input.readOnly = false; }
						group.classList.remove("bbmm-locked-hide");
						group.style.removeProperty("display");

						// Optional: show soft icon if present
						const icon = group.querySelector?.(".bbmm-lock-icon");
						if (icon) _bbmmSetLockIconState(icon, "soft");

						// Record ledger immediately when user tweaks the control (even before Save),
						// and ask the GM to CLEAR the soft lock so it won't re-apply after reload.
						try {
							const rev = Number.isInteger(ent?.rev) ? ent.rev : 1;
							const recValSerialized = JSON.stringify(ent?.value ?? null);
							const inputs = group.querySelectorAll?.("input, select, textarea") || [];

							const markHandledAndRequestClear = async () => {
								try {
									const ledger = foundry.utils.duplicate(game.settings.get(BBMM_ID, "softLockLedger") || {});
									ledger[id] = { v: recValSerialized, r: rev };
									await game.settings.set(BBMM_ID, "softLockLedger", ledger);
									DL(`setting-sync.js |  soft-ledger: handled rev=${rev} for ${id}`);

									if (game.socket) {
										game.socket.emit(BBMM_SYNC_CH, { t: "bbmm-soft-clear", id });
										DL(`setting-sync.js |  soft-clear: requested for ${id}`);
									}
								} catch (e) {
									DL(2, "setting-sync.js |  soft-ledger/clear failed", e);
								}
							};

							for (const inp of inputs) {
								inp.addEventListener("change", markHandledAndRequestClear, { once: true });
								inp.addEventListener("input", markHandledAndRequestClear, { once: true });
							}
						} catch (e) {
							DL(2, "setting-sync.js |  soft-clear listener attach failed", e);
						}

						continue;
					}

					// If not a hard lock, leave visible
					if (!(state === "all" || state === "partial")) continue;

					/* Hard-lock handling =============================================
						- 'all' => hide for everyone
						- 'partial' => hide only if THIS player is in the targeted list
					===================================================================*/
					const list = Array.isArray(ent?.userIds) ? ent.userIds : null;
					const shouldHide =
						(state === "all") ||
						(state === "partial" && list && myId && list.includes(myId));

					if (!shouldHide) continue;

					hideNode(group);
					group.setAttribute("data-bbmm-hidden", "true");
					hidden++;
				}

				// Hide section headers that have no visible rows left
				const sections = form.querySelectorAll?.(".settings-list, fieldset") || [];
				for (const section of sections) {
					const hasVisible = section.querySelector(':scope .form-group:not(.bbmm-locked-hide), :scope .form-group-stacked:not(.bbmm-locked-hide), :scope .form-fields:not(.bbmm-locked-hide)');
					if (!hasVisible) {
						hideNode(section);
						const heading = section.previousElementSibling;
						if (heading && (heading.matches("h2,h3,h4") || heading.classList.contains("form-header"))) {
							hideNode(heading);
						}
					}
				}

				DL(`setting-sync.js |  bbmm-setting-lock: decorate(PLAYER-HIDE): seen=${seen}, hidden=${hidden}`);

				// Prevent “Save Changes” from doing anything unexpected 
				form.addEventListener("submit", (ev) => {
					DL("setting-sync.js |  bbmm-setting-lock: submit guard — nothing to save for hidden hard-locked settings");
				}, true);

				return; // IMPORTANT: don't run GM UI decoration
			}

			/* GM branch =============================================================== */
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

					// Compute per-user lock state for THIS id
					const state = bbmmGetLockState(id, syncMap);

					// Choose icon + tooltip based on state
					let lockIcon;
					if (state === "all") {
						lockIcon = makeIcon(LT.lockAllTip(), "fa-solid fa-lock", true);
						lockIcon.classList.add("bbmm-active");
					} else if (state === "partial") {
						lockIcon = makeIcon(LT.lockPartialTip(), "fa-solid fa-user-lock", true);
						lockIcon.classList.add("bbmm-partial");
					} else if (state === "soft") {
						const softTitle = LT.name_SoftLock?.() || "Soft Lock";
						lockIcon = makeIcon(softTitle, "fa-regular fa-lock", true);
						lockIcon.classList.add("bbmm-active");
					} else {
						lockIcon = makeIcon(LT.sync.ToggleHint(), "fa-solid fa-lock-open", true);
					}

					// if GM edits a locked setting value, queue CLEAR immediately
					// (prevents resnap/push/reload from re-applying)
					try {
						if (state !== "none") {
							const sel = `input[name="settings.${cfg.namespace}.${cfg.key}"], select[name="settings.${cfg.namespace}.${cfg.key}"], textarea[name="settings.${cfg.namespace}.${cfg.key}"]`;
							const inputs = form.querySelectorAll?.(sel) || [];
							if (inputs.length) {
								const dot = id.indexOf(".");
								const ns = id.slice(0, dot);
								const key = id.slice(dot + 1);
								const clearOnce = async () => {
									try {
										if (_bbmmIsUnlockQueued(id)) return;

										// Remove immediately from world map so resnap won’t re-add it
										let map = game.settings.get(BBMM_ID, "userSettingSync") || {};
										if (map[id]) {
											delete map[id];
											await game.settings.set(BBMM_ID, "userSettingSync", map);
											bbmmBroadcastTrigger();
											DL(`setting-sync.js | GM changed ${id} while locked -> immediate CLEAR`);
										}

										// Also queue clears for consistency (so pendingOps stays in sync)
										_bbmmApplyClearLocks({ id, ns, key, iconEl: lockIcon });
									} catch (e) {
										DL(2, "setting-sync.js | GM-change clearOnce failed", e);
									}
								};
								for (const inp of inputs) {
									inp.addEventListener("change", clearOnce, { once: true });
									inp.addEventListener("input", clearOnce, { once: true });
								}
							}
						}
					} catch (e) {
						DL(2, "setting-sync.js | attach GM-change clear handler failed", e);
					}
					
					// push icon...
					const pushTitle = (LT.sync.PushHint());
					const pushIcon = makeIcon(pushTitle, "fa-solid fa-arrows-rotate", true);
					pushIcon.addEventListener("click", (ev) => {
						try {
							ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

							const dot = id.indexOf(".");
							const ns = id.slice(0, dot);
							const key = id.slice(1 + dot);
							const val = game.settings.get(ns, key);

							const picker = new BBMMUserPicker({
								title: LT.titleSyncForUsers(),
								settingId: id,
								valuePreview: val,
								confirmLabel: LT.dialogQueueSync(),
								onlyOnline: true,
								onConfirm: async (userIds) => {
									_bbmmQueueOp({ op: "push", id, namespace: ns, key, value: val, userIds });
									ui.notifications.info(LT.infoQueuedSync({ module: id, count: userIds.length }));
								}
							});
							picker.show();
						} catch (err) {
							DL(2, "setting-sync.js | bbmm-setting-lock(push): click error", err);
						}
					});

					// Click / Shift+Click gestures
					lockIcon.addEventListener("click", (ev) => {
						try {
							ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
							const gesture = ev.shiftKey ? "shift" : "click";
							_bbmmHandleLockGesture({ id, iconEl: lockIcon, gesture });
						} catch (err) {
							DL(2, "setting-sync.js | lockIcon click handler error", err);
						}
					});
					lockIcon.addEventListener("contextmenu", (ev) => {
						try {
							ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
							const gesture = ev.shiftKey ? "shiftRight" : "right";
							_bbmmHandleLockGesture({ id, iconEl: lockIcon, gesture });
						} catch (err) {
							DL(2, "setting-sync.js | lockIcon contextmenu handler error", err);
						}
					});
					lockIcon.addEventListener("keydown", (e) => {
						try {
							if (e.key === "Enter" || e.key === " ") {
								_bbmmHandleLockGesture({ id, iconEl: lockIcon, gesture: "click" });
							}
						} catch (err) {
							DL(2, "setting-sync.js | lockIcon keydown handler error", err);
						}
					});

					attached++;
				}

				/* GM: late-pass — attach icons to any user/client rows still missing them === */
				try {
					const allLabels = form.querySelectorAll?.('label[for^="settings-config-"]') || [];
					let lateAttached = 0;

					for (const lbl of allLabels) {
						// skip if already has our bar
						if (lbl.querySelector?.(".bbmm-lock-icons")) continue;

						const forAttr = lbl.getAttribute("for");
						if (!forAttr) continue;

						const id = forAttr.replace(/^settings-config-/, "");
						// Only decorate user/client settings
						const cfg = game.settings.settings.get(id);
						if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

						// Find the row group (needed for gesture routing); same method you use
						const group =
							lbl.closest(".form-group, .form-group-stacked, .form-fields") ||
							lbl.parentElement || form;

						// Build inline bar next to the label
						const bar = document.createElement("span");
						bar.className = "bbmm-lock-icons";
						bar.style.display = "inline-flex";
						bar.style.gap = "0.4rem";
						bar.style.marginLeft = "0.5rem";
						lbl.appendChild(bar);

						// Compute lock state exactly as elsewhere
						const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
						const state = bbmmGetLockState(id, syncMap);

						// Helper to create icons (NO behavior change)
						const mk = (title, cls) => {
							const i = document.createElement("i");
							i.className = cls;
							i.title = title;
							i.classList.add("bbmm-click");
							return i;
						};

						// LOCK icon
						let lockIcon;
						if (state === "all") {
							lockIcon = mk(LT.lockAllTip?.() || "Locked for all players", "fa-solid fa-lock");
							lockIcon.classList.add("bbmm-active");
						} else if (state === "partial") {
							lockIcon = mk(LT.lockPartialTip?.() || "Locked for selected players", "fa-solid fa-user-lock");
							lockIcon.classList.add("bbmm-partial");
						} else if (state === "soft") {
							const softTitle = (LT.nameSoftLock?.() || LT.name_SoftLock?.() || "Soft Lock");
							lockIcon = mk(softTitle, "fa-regular fa-lock");
							lockIcon.classList.add("bbmm-active");
						} else {
							lockIcon = mk(LT.lockNoneTip?.() || "Lock Player settings", "fa-solid fa-lock-open");
						}

						// click + SHIFT-click + right-click gestures
						lockIcon.addEventListener("click", (ev) => {
							try {
								ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
								const gesture = ev.shiftKey ? "shift" : "click";
								_bbmmHandleLockGesture({ id, iconEl: lockIcon, gesture });
							} catch (err) { DL(2, `setting-sync.js | late-pass lock click error for ${id}`, err); }
						});
						lockIcon.addEventListener("contextmenu", (ev) => {
							try {
								ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
								const gesture = ev.shiftKey ? "shiftRight" : "right";
								_bbmmHandleLockGesture({ id, iconEl: lockIcon, gesture });
							} catch (err) { DL(2, `setting-sync.js | late-pass lock contextmenu error for ${id}`, err); }
						});
						lockIcon.addEventListener("keydown", (e) => {
							try {
								if (e.key === "Enter" || e.key === " ") {
									_bbmmHandleLockGesture({ id, iconEl: lockIcon, gesture: "click" });
								}
							} catch (err) { DL(2, `setting-sync.js | late-pass lock keydown error for ${id}`, err); }
						});
						bar.appendChild(lockIcon);

						// SYNC icon
						const syncIcon = mk(LT.sync?.PushHint?.() || "Sync setting to connected users", "fa-solid fa-arrows-rotate");
						syncIcon.addEventListener("click", (ev) => {
							try {
								ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
								const dot = id.indexOf("."), ns = id.slice(0, dot), key = id.slice(dot + 1);
								const val = game.settings.get(ns, key);
								const picker = new BBMMUserPicker({
									title: LT.titleSyncForUsers?.() || "Sync to Users",
									settingId: id,
									valuePreview: val,
									confirmLabel: LT.dialogQueueSync?.() || "Queue Sync",
									onlyOnline: true,
									onConfirm: async (userIds) => {
										_bbmmQueueOp({ op: "push", id, namespace: ns, key, value: val, userIds });
										const msg = LT.infoQueuedSync?.({ module: id, count: userIds.length }) || `Queued sync for ${id} to ${userIds.length} users`;
										ui.notifications.info(msg);
									}
								});
								picker.render(true);
							} catch (err) { DL(2, `setting-sync.js | late-pass sync click error for ${id}`, err); }
						});
						bar.appendChild(syncIcon);

						lateAttached++;
						DL(`setting-sync.js |  bbmm-setting-lock: late-pass attached icons for ${id}`);
					}

					if (lateAttached) DL(`setting-sync.js |  bbmm-setting-lock: late-pass total=${lateAttached}`);
				} catch (e) {
					DL(2, "setting-sync.js |  late-pass failed", e);
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
					_bbmmApplyPendingOps().catch(err => DL(3, "setting-sync.js | _bbmmApplyPendingOps(): error", err));
				}, 0);
			}, { passive: true });
		} catch (err) {
			DL(3, "setting-sync.js |  bbmm-setting-lock: renderSettingsConfig(): error", err);
		}
	});

	/* ============================================================================
			{ HOOK: ready } 
			Player: apply on ready; 
			GM: inject CSS; 
			All: listen for triggers
	=============================================================================*/
	Hooks.once("ready", async () => {
		try {

			// Check if feature enabled 
			if (!bbmmIsSyncEnabled()) {
				DL("setting-sync.js |  bbmm-setting-lock: disabled, skipping ready features");
				return;
			}

			if (game.user?.isGM) {

				/* 	BBMM Lock: resnap userSettingSync ==========================================
					- GM only
					- Compare live values vs stored map
					- Update map if different
				============================================================================ */
				const bbmmResnapUserSync = async () => {
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

							// Live GM value
							const live = game.settings.get(ns, key);

							// Existing stored record
							const existing = map[id] || {};
							const prev = existing.value;

							// If we’ve queued an unlock for this id, don’t resnap it back in
							if (_bbmmIsUnlockQueued?.(id)) {
								DL(`setting-sync.js |  bbmm-resnap: skipping ${id} (unlock queued)`);
								continue;
							}

							// Handle SOFT entries separately
							if (existing.soft === true) {
								// If GM changed their own setting, clear the soft lock entirely
								if (!objectsEqual(live, prev)) {
									delete map[id];
									changed = true;
									DL(`setting-sync.js |  bbmm-resnap: cleared SOFT ${id} (GM changed value)`);
									continue; // go to next id
								}

								// Otherwise, keep soft as-is, refresh the stored value/flags
								const rev = Number.isInteger(existing.rev) ? existing.rev : 1;
								map[id] = {
									namespace: ns,
									key,
									value: live,
									requiresReload: existing.requiresReload ?? !!cfg?.requiresReload,
									soft: true,
									rev
								};
								// Note: no "changed" flip if nothing materially changed
								continue; // next id
							}

							// HARD entry (lock all / partial)
							// Keep any targeted userIds as-is; just refresh stored value & requiresReload
							const needUpdate = !objectsEqual(live, prev) || (existing.requiresReload !== !!cfg?.requiresReload);
							if (needUpdate) {
								map[id] = {
									namespace: ns,
									key,
									value: live,
									requiresReload: !!cfg?.requiresReload,
									...(Array.isArray(existing.userIds) ? { userIds: existing.userIds.slice() } : {})
								};
								changed = true;
								DL(`setting-sync.js |  bbmm-resnap: updated HARD ${id}`);
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

				// GM: keep world map fresh, inject CSS, etc.
				await bbmmResnapUserSync();
				DL("setting-sync.js |  bbmm-setting-lock: injected CSS");
				return;
			}

			// Player: apply GM-enforced settings (initial) — SKIP soft entries (soft = push-on-enable only)
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const initialEntries = Object.values(syncMap);

			if (initialEntries.length) {
				let changed = false, needsReload = false;

				for (const ent of initialEntries) {
					try {
						const cfg = game.settings.settings.get(`${ent.namespace}.${ent.key}`);
						if (!cfg || !(cfg.scope === "user" || cfg.scope === "client")) continue;

						// Soft locks are advisory: do NOT auto-apply at ready; they were pushed once on enable
						if (ent?.soft === true) continue;

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

			// All clients: listen for live refresh/push triggers
			if (game.socket) {
				game.socket.on(BBMM_SYNC_CH, async (msg) => {

					// Setting Soft Clear
					if (msg?.t === "bbmm-soft-clear") {
						// GM only: remove a soft-lock entry when a player changes that setting
						if (!game.user?.isGM) return;

						try {
							const id = msg?.id;
							if (!id) return;

							const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
							if (map[id]?.soft === true) {
								delete map[id];
								await game.settings.set(BBMM_ID, "userSettingSync", map);

								DL(`setting-sync.js |  bbmm-setting-lock: SOFT cleared for ${id} (player changed setting)`);
								bbmmBroadcastTrigger();	// notify clients to refresh their UI lock badges
							}
						} catch (e) {
							DL(2, "setting-sync.js |  bbmm-setting-lock: soft-clear handling failed", e);
						}
						return;	// handled
					}

					// Setting Sync Push
					if (msg?.t === "bbmm-sync-push") {
						// Players only
						if (game.user?.isGM) return;

						// Respect optional targeting
						const targets = Array.isArray(msg?.targets) ? msg.targets : null;
						if (targets && targets.length && !targets.includes(game.user.id)) return;

						const { namespace, key, value, requiresReload, soft, softRev } = msg;
						const id = `${namespace}.${key}`;
						const cfg = game.settings.settings.get(id);
						if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) return;

						// SOFT skip/apply using rev; fallback to value compare if no softRev
						if (soft === true) {
							try {
								const ledger = game.settings.get(BBMM_ID, "softLockLedger") || {};
								const entry = ledger[id];
								const lastRev = (entry && typeof entry === "object" && Number.isInteger(entry.r)) ? entry.r : -1;

								if (Number.isInteger(softRev)) {
									if (lastRev >= softRev) {
										DL(`setting-sync.js |  soft-push skipped for ${id} (rev=${softRev} already handled)`);
										return;
									}
								} else {
									const handledVal = (entry && typeof entry === "object") ? entry.v : entry;
									const recValSerialized = JSON.stringify(value ?? null);
									if (handledVal === recValSerialized) {
										DL(`setting-sync.js |  soft-push skipped for ${id} (value already handled)`);
										return;
									}
								}
							} catch (e) {
								DL(2, "setting-sync.js |  soft-push skip-check failed", e);
							}
						}

						const current = game.settings.get(namespace, key);
						if (!objectsEqual(current, value)) {
							DL(`setting-sync.js |  bbmm-setting-lock: push apply ${id} ->`, value);
							await game.settings.set(namespace, key, value);

							// Mark handled for soft
							if (soft === true) {
								try {
									const ledger = foundry.utils.duplicate(game.settings.get(BBMM_ID, "softLockLedger") || {});
									const prev = ledger[id];
									const prevRev = (prev && typeof prev === "object" && Number.isInteger(prev.r)) ? prev.r : -1;

									ledger[id] = {
										v: JSON.stringify(value ?? null),
										r: Number.isInteger(softRev) ? softRev : (prevRev > -1 ? prevRev : 1)
									};
									await game.settings.set(BBMM_ID, "softLockLedger", ledger);
									DL(`setting-sync.js |  soft-ledger: marked applied rev=${Number.isInteger(softRev) ? softRev : (prevRev > -1 ? prevRev : 1)} for ${id}`);
								} catch (e) {
									DL(2, "setting-sync.js |  soft-ledger: mark after push failed", e);
								}
							}

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
					}

					// Setting Sync refresh
					if (msg?.t === "bbmm-sync-refresh") {
						if (game.user?.isGM) return; // GM doesn't need to apply

						DL("setting-sync.js |  bbmm-setting-lock: received refresh trigger");

						const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
						let changed = false, needsReload = false;

						for (const ent of Object.values(map)) {
							if (!ent || typeof ent.namespace !== "string" || typeof ent.key !== "string") continue;

							const id = `${ent.namespace}.${ent.key}`;
							const cfg = game.settings.settings.get(id);
							if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

							// SKIP soft in on-demand refresh (soft is push-on-enable only)
							if (ent?.soft === true) continue;

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
						return;
					}

					// Controls refresh
					if (msg?.t === "bbmm-ctrl-refresh") {
						DL(1, "setting-sync.js | controls: socket refresh");
						await _bbmmCtrlPullApplyAll();
					}

					// Control Sync push (players only; apply immediately)
					if (msg?.t === "bbmm-ctrl-push") {
						if (game.user?.isGM) return;

						// respect optional targeting
						const targets = Array.isArray(msg?.targets) ? msg.targets : null;
						if (targets && targets.length && !targets.includes(game.user.id)) return;

						const ns = msg.namespace, action = msg.action;
						const arr = Array.isArray(msg.value) ? msg.value : [];

						try {
							// Try modern API first
							if (game.keybindings?.reset && game.keybindings?.set) {
								await game.keybindings.reset(ns, action);
								for (const b of arr) await game.keybindings.set(ns, action, b);
							} else {
								// Fallback: write into the core keybindings blob
								const id = `${ns}.${action}`;
								const blob = foundry.utils.duplicate(game.settings.get("core", "keybindings") || {});
								blob[id] = arr.map(b => ({ key: b?.key, modifiers: (b?.modifiers ?? []).slice() }));
								await game.settings.set("core", "keybindings", blob);
							}
							ui.notifications?.info?.(LT.sync.Updated?.() || "Keybindings updated.");
						} catch (err) {
							DL(2, "ctrl push apply failed", { ns, action, err });
						}
						return; // handled
					}
				});
			}
		} catch (err) {
			DL(3, "setting-sync.js |  bbmm-setting-lock: ready(): error", err);
		}
	});

/* ============================================================================
		{CONTROLS SYNC HELPERS}
============================================================================ */

	/*  Build unique control ID =====================================================
		Join namespace + action into a single string identifier.
	============================================================================= */
	function _bbmmCtrlId(ns, action) { return `${ns}.${action}`; }

	/*  Get Control Sync store ======================================================
		Fetch world-level storage object containing current control locks/sync state.
		Returns {} if not yet set.
	============================================================================= */
	function _bbmmCtrlGetStore() {
		try { return game.settings.get(BBMM_ID, CTRL_STORE_KEY) ?? {}; } catch { return {}; }
	}

	/*  Set Control Sync store ======================================================
		Replace the world-level storage object with new contents.
		Persists immediately via game.settings.
	============================================================================= */
	async function _bbmmCtrlSetStore(next) {
		try { await game.settings.set(BBMM_ID, CTRL_STORE_KEY, next ?? {}); }
		catch (err) { DL(2, "setting-sync.js | ctrlSetStore() failed", err); }
	}

	/*  Get Control Revision Map ====================================================
		Returns persistent rev map used for soft-locks.
		Tracks revision numbers per control for change detection.
	============================================================================= */
	function _bbmmCtrlGetRevMap() {
		try { return game.settings.get(BBMM_ID, CTRL_REV_STORE) ?? {}; } catch { return {}; }
	}

	/*  Set Control Revision Map ====================================================
		Update stored revision map for control soft-locks.
		Saves to world settings.
	============================================================================= */
	async function _bbmmCtrlSetRevMap(map) {
		try { await game.settings.set(BBMM_ID, CTRL_REV_STORE, map ?? {}); }
		catch (err) { DL(2, "setting-sync.js | ctrlSetRevMap() failed", err); }
	}

	/*  Is Control Sync enabled? ====================================================
		Returns true if GM has enabled control synchronization feature.
	============================================================================= */
	function _bbmmCtrlEnabled() {
		try {
			const master = bbmmIsSyncEnabled();
			const ctrl = game.settings.get(BBMM_ID, CTRL_TOGGLE) !== false;
			return master && ctrl;
		} catch { return false; }
	}

	/*  Compare keybinding arrays ===================================================
		Compare two sets of keybinding entries for equality.
		Returns true if both contain same keys + modifiers.
	============================================================================= */
	function _bbmmCtrlSame(a = [], b = []) {
		try {
			const ser = x => JSON.stringify((x ?? []).map(v => ({
				key: v?.key,
				modifiers: (v?.modifiers ?? []).slice().sort()
			})).sort((x,y)=> (x.key||"").localeCompare(y.key||"")));
			return ser(a) === ser(b);
		} catch { return false; }
	}

	/*  Get live keybindings for an action =========================================
		Return array of bindings for namespace+action.
		Tries API first, falls back to core settings blob.
	============================================================================= */
	function _bbmmCtrlBindings(ns, action) {
	try {
		const normalize = (b) => {
		if (!b) return null;
		const key =
			(typeof b.key === "string" && b.key) ||
			(typeof b.code === "string" && b.code) ||
			(typeof b.k === "string" && b.k) ||
			null;
		if (!key) return null;
		const modsSrc =
			(Array.isArray(b.modifiers) && b.modifiers) ||
			(Array.isArray(b.mods) && b.mods) ||
			[];
		const modifiers = modsSrc.slice().filter(Boolean).sort(); // stable order
		return { key, modifiers };
		};

		let out = [];

		// Preferred: API
		try {
		const viaAPI = game.keybindings?.get?.(ns, action);
		if (Array.isArray(viaAPI)) out = viaAPI.map(normalize).filter(Boolean);
		} catch {}

		// Fallback: core setting blob(s)
		if (!out.length) {
		const id = `${ns}.${action}`;
		let blob = null;
		try { blob = game.settings.get("core", "keybindings"); } catch {}
		const raw =
			(blob && Array.isArray(blob[id]) && blob[id]) ||
			(blob?.bindings && Array.isArray(blob.bindings[id]) && blob.bindings[id]) ||
			[];
		out = raw.map(normalize).filter(Boolean);
		}

		// Deduplicate (key + modifiers signature)
		const seen = new Set();
		const unique = [];
		for (const b of out) {
		const sig = `${b.key}|${b.modifiers.join("+")}`;
		if (!seen.has(sig)) {
			seen.add(sig);
			unique.push(b);
		}
		}
		return unique;
	} catch (err) {
		DL(2, "setting-sync.js | ctrlBindings() failed", { ns, action, err });
		return [];
	}
	}

	/*  Set keybindings for an action ===============================================
		Apply array of keybinds for namespace+action.
		Updates via API when available, else patches settings blob.
	============================================================================= */
	async function _bbmmCtrlSetBindings(ns, action, arr) {
	try {
		const hasPerActionAPI = typeof game.keybindings?.reset === "function" &&
								typeof game.keybindings?.set === "function";

		if (hasPerActionAPI) {
		// Modern API path
		await game.keybindings.reset(ns, action);
		for (const b of (arr ?? [])) {
			if (b && b.key) await game.keybindings.set(ns, action, { key: b.key, modifiers: b.modifiers ?? [] });
		}
		return;
		}

		// Fallback path: write to core keybindings setting
		const id = `${ns}.${action}`;
		const current = foundry.utils.duplicate(game.settings.get("core", "keybindings") || {});
		current[id] = (arr ?? []).map(b => ({ key: b?.key, modifiers: (b?.modifiers ?? []).slice() }));
		await game.settings.set("core", "keybindings", current);

	} catch (err) {
		DL(2, "setting-sync.js | ctrlSetBindings() failed", { ns, action, err });
	}
	}

	/*  Pull + Apply all Control Sync state =========================================
		GM: broadcasted changes force clients to re-apply control sync state.
		Players: update local keybindings to match GM-synced store.
	============================================================================= */
	async function _bbmmCtrlPullApplyAll() {
	try {
		if (!_bbmmCtrlEnabled()) return;
		const store = _bbmmCtrlGetStore();
		const revMap = _bbmmCtrlGetRevMap() || {};
		const ledger = game.settings.get(BBMM_ID, "softLockLedger") || {};

		for (const [id, rec] of Object.entries(store)) {
		const dot = id.lastIndexOf(".");
		if (dot <= 0) continue;
		const ns = id.slice(0, dot);
		const action = id.slice(dot + 1);

		// HARD LOCK: always enforce
		if (rec?.lock?.value) {
			const have = _bbmmCtrlBindings(ns, action);
			if (!_bbmmCtrlSame(have, rec.lock.value)) {
			DL(1, `controls | apply HARD ${id}`);
			await _bbmmCtrlSetBindings(ns, action, rec.lock.value);
			}
			continue;
		}

		// SOFT LOCK: push once per rev, then never re-apply
		if (rec?.soft?.value) {
			const rev = Number(rec?.rev) || Number(revMap[id]) || 1;
			const lkey = `@ctrl:${id}`;
			const last = ledger[lkey];
			const lastRev = (last && typeof last === "object" && Number.isInteger(last.r)) ? last.r : -1;

			// Already handled this rev? Skip.
			if (lastRev >= rev) continue;

			// First time seeing this rev -> apply once, then mark ledger
			const have = _bbmmCtrlBindings(ns, action);
			if (!_bbmmCtrlSame(have, rec.soft.value)) {
			DL(1, `controls | apply SOFT ${id} (rev=${rev})`);
			await _bbmmCtrlSetBindings(ns, action, rec.soft.value);
			}

			// Mark handled so it won’t re-apply on refresh/load
			ledger[lkey] = { r: rev, v: JSON.stringify(rec.soft.value ?? []) };
			await game.settings.set(BBMM_ID, "softLockLedger", ledger);
		}
		}
	} catch (err) {
		DL(2, "setting-sync.js | ctrlPullApplyAll() failed", err);
	}
	}

	/*  Parse Binding ID ============================================================
		Split "ns.action.binding.N" into { ns, action } object.
		Safe fallback if malformed input.
	============================================================================= */
	function _bbmmParseBindingId(bindingId) {
	try {
		// "ns.action.binding.N" -> { ns, action }
		const base = String(bindingId || "").replace(/\.binding.*$/, "");
		const dot = base.indexOf(".");
		if (dot <= 0) return { ns: "core", action: base || "" };
		return { ns: base.slice(0, dot), action: base.slice(dot + 1) };
	} catch (e) {
		DL(2, "_bbmmParseBindingId() failed", { bindingId, e });
		return { ns: "core", action: "" };
	}
	}
	
	/*  Apply GM Soft Lock for a Control ============================================
		Queue/update a soft lock entry for namespace+action.
		Snapshot GM binding state, increment rev, save to store.
	============================================================================= */
	async function _bbmmCtrlGMSoft({ ns, action }) {
	try {
		const id = _bbmmCtrlId(ns, action);
		const store = _bbmmCtrlGetStore();
		const revMap = _bbmmCtrlGetRevMap();

		const next = { ...(store[id] ?? {}) };
		next.soft = { value: _bbmmCtrlBindings(ns, action) };
		next.lock = null;
		next.rev = (Number(next.rev) || 0) + 1;

		store[id] = next;
		revMap[id] = next.rev;

		await _bbmmCtrlSetStore(store);
		await _bbmmCtrlSetRevMap(revMap);

		ui.notifications?.info?.(LT.controlsSoftApplied());
		game.socket?.emit?.(BBMM_SYNC_CH, { t: "bbmm-ctrl-refresh" });
	} catch (err) {
		DL(2, "setting-sync.js | ctrlGMSoft() failed", { ns, action, err });
	}
	}

	/*  GM: push current bindings for a control to selected users (instant) ======= */
	async function _bbmmCtrlSyncToUsers({ ns, action, userIds }) {
		try {
			// snapshot current GM bindings for this action
			const value = _bbmmCtrlBindings(ns, action);

			// emit one-time push to players (optionally targeted)
			game.socket?.emit?.(BBMM_SYNC_CH, {
				t: "bbmm-ctrl-push",
				namespace: ns,
				action,
				value,                 // array of {key, modifiers[]}
				targets: Array.isArray(userIds) && userIds.length ? userIds : null
			});
			ui.notifications?.info?.(LT.infoQueuedSync?.({ module: `${ns}.${action}`, count: (userIds?.length ?? 0) }) || `Synced ${ns}.${action} to ${userIds?.length ?? 0} users`);
		} catch (err) {
			DL(2, "ctrlSyncToUsers() failed", { ns, action, err });
		}
	}

	/*  Wire Control Config UI ======================================================
		Decorate Controls Configuration window with Sync/Lock icons.
		- Attach icons next to labels or controls.
		- Handle click/shift/right gestures for lock/sync actions.
		- Skip restricted/uneditable bindings.
	============================================================================= */
	function _bbmmCtrlWireConfig(app, html) {
		try {
			// GM only; players see nothing
			if (!game.user?.isGM) return;

			const root = html?.[0] || html || app?.element?.[0] || document;
			if (!root?.querySelectorAll) return;

			// Controls UI uses .form-group[data-action-id="ns.action"]
			let groups = Array.from(root.querySelectorAll('.form-group[data-action-id]'));

			// Fallbacks (just in case templates differ)
			if (!groups.length) {
				const alt = Array.from(root.querySelectorAll('li[data-binding-id]'));
				const byGroup = new Map();
				for (const li of alt) {
					const g = li.closest('.form-group');
					if (g) byGroup.set(g, true);
				}
				groups = Array.from(byGroup.keys());
			}

			let attached = 0, skipped = 0;
			for (const group of groups) {
				// Avoid duplicate bars on re-renders
				if (group.querySelector('.bbmm-ctrlbar')) { skipped++; continue; }

				// Find label area
				const labelEl =
					group.querySelector('.label, label, .action-name') ||
					group.querySelector('.form-fields') || group.firstElementChild;
				if (!labelEl) { skipped++; continue; }

				// Resolve ns/action
				let ns = 'core', action = '';
				const actionId = group.getAttribute('data-action-id');
				if (actionId && actionId.includes('.')) {
					const dot = actionId.indexOf('.');
					ns = actionId.slice(0, dot);
					action = actionId.slice(dot + 1);
				} else {
					// backup: parse first li[data-binding-id]
					const li = group.querySelector('li[data-binding-id]');
					if (li && typeof _bbmmParseBindingId === 'function') {
						const p = _bbmmParseBindingId(li.getAttribute('data-binding-id'));
						ns = p.ns; action = p.action;
					}
				}
				if (!ns || !action) { skipped++; continue; }

				// Build compact toolbar next to label
				const bar = document.createElement('span');
				bar.className = 'bbmm-ctrlbar';
				bar.style.display = 'inline-flex';
				bar.style.alignItems = 'center';
				bar.style.gap = '.35rem';
				bar.style.marginLeft = '.35rem';

				// Sync icon (same visual language as settings push)
				const syncIcon = document.createElement("i");
				syncIcon.className = "fa-solid fa-arrows-rotate bbmm-click";
				syncIcon.setAttribute("role", "button");
				syncIcon.setAttribute("tabindex", "0");
				syncIcon.title =
				LT.sync.PushHintControls() + "\n" +
				"• " + LT.sync.ClickPickUsers() + "\n" +
				"• " + LT.sync.ShiftAll(); 

				bar.appendChild(syncIcon);

				// LEFT CLICK -> open minimal user picker, then IMMEDIATELY SYNC (no queue)
				syncIcon.addEventListener("click", (ev) => {
				try {
					if (ev.shiftKey) return;
					ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
					if (syncIcon.dataset.busy === "1") return; 

					const picker = new BBMMUserPicker({
					title: LT.titleSyncForUsers(),
					settingId: `${ns}.${action}`,
					valuePreview: null,
					confirmLabel: LT.buttons.btnSync(),
					preChecked: "*",
					onlyOnline: true,
					minimal: true,
					onConfirm: async (userIds) => {
						try {
						syncIcon.dataset.busy = "1";
						await _bbmmCtrlSyncToUsers({ ns, action, userIds });
						} finally {
						delete syncIcon.dataset.busy;
						}
					}
					});
					picker.show();
				} catch (err) {
					DL(2, "controls sync click error", err);
				}
				});

				// SHIFT+CLICK -> sync immediately to ALL non-GMs (no dialog)
				syncIcon.addEventListener("mousedown", async (ev) => {
				try {
					if (ev.button !== 0 || !ev.shiftKey) return; // only shift-left
					ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
					if (syncIcon.dataset.busy === "1") return;   // debounce
					syncIcon.dataset.busy = "1";
					try {
					const allNonGM = (game.users?.contents || []).filter(u => !u.isGM).map(u => u.id);
					await _bbmmCtrlSyncToUsers({ ns, action, userIds: allNonGM });
					} finally {
					delete syncIcon.dataset.busy;
					}
				} catch (err) {
					DL(2, "controls sync shift-click error", err);
				}
				}, true);

				// swallow context menu so we don’t clash with Foundry’s buttons
				syncIcon.addEventListener("contextmenu", (ev) => {
				ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
				});

				bar.appendChild(syncIcon);
				labelEl.appendChild(bar);
				attached++;
			}

			DL(`ctrlWireConfig(): groups=${groups.length}, attached=${attached}, skipped=${skipped}`);
		} catch (err) { DL(2, 'ctrlWireConfig() failed', err); }
	}

/* =============================================================================
	{ CONTROLS SYNC HOOKS}
============================================================================= */

	Hooks.on("ready", async () => {
		try {
			if (!_bbmmCtrlEnabled()) return;
			DL(1, "setting-sync.js | controls: ready pull+apply");
			await _bbmmCtrlPullApplyAll();
		} catch (err) { DL(2, "setting-sync.js | controls ready failed", err); }
	});

	Hooks.on('renderKeybindingsConfig', (app, html) => {
		try {
			if (!_bbmmCtrlEnabled()) return;
			_bbmmCtrlWireConfig(app, html);
			requestAnimationFrame(() => _bbmmCtrlWireConfig(app, html));
			setTimeout(() => _bbmmCtrlWireConfig(app, html), 50);
		} catch (err) { DL(2, 'renderKeybindingsConfig failed', err); }
	});

	Hooks.on('renderControlsConfig', (app, html) => {
		try {
			if (!_bbmmCtrlEnabled()) return;
			_bbmmCtrlWireConfig(app, html);
			requestAnimationFrame(() => _bbmmCtrlWireConfig(app, html));
			setTimeout(() => _bbmmCtrlWireConfig(app, html), 50);
		} catch (err) { DL(2, 'renderControlsConfig failed', err); }
	});