/* ==========================================================================
	BBMM: Setting Lock / Sync
========================================================================== */

import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_esc } from "./helpers.js";


/* ============================================================================
        {GLOBALS}
============================================================================= */

	const BBMM_REG = { byId: new Map() };	// Live registry of settings
	const BBMM_SYNC_CH = `module.${BBMM_ID}`;	// Socket channel for this module
	const _bbmmPendingOps = [];	 // Pending operations queue (applied on Save Changes)
	/*  equality helper ============================================================ */
	const objectsEqual = foundry?.utils?.equals ?? foundry?.utils?.objectsEqual ?? ((a, b) => {
		try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
	});
	let _bbmmTriggerTimer = null; // For bbmmBroadcastTrigger()

/* ============================================================================
        {SETTINGS SYNC HELPERS}
============================================================================ */

	// true if an unlock (or legacy soft-disable) op is queued for this id
	function _bbmmIsUnlockQueued(id) {
		try {
			return _bbmmPendingOps.some(op =>
			op?.id === id && (
				op.op === "unlock" ||
				(op.op === "soft" && op.soft === false)
			)
			);
		} catch { return false; }
	}

	// true if the GM enabled auto-force-reload
	function hlp_shouldAutoForceReload() {
		try {
			return Boolean(game.settings.get(BBMM_ID, "autoForceReload"));
		} catch (err) {
			DL(2, "setting-sync.js | hlp_shouldAutoForceReload(): failed reading setting", err);
			return false;
		}
	}

	/* Update the lock icon =======================================================
		Update the lock icon glyph + tint for a given state
		States: "unlocked" | "lockSelected" | "softLock" | "lockAll"
	============================================================================ */
	function _bbmmSetLockIconState(iconEl, state) {
		try {
			iconEl.classList.remove(
				"fa-lock-open", "fa-lock",
				"fa-solid", "fa-regular", "bbmm-active", "bbmm-diverged", "bbmm-pending", "fa-arrows-rotate"
			);

			switch (state) {
				case "softLock":
					// If FA build lacks 'fa-regular fa-lock', the fallback color still shows via bbmm-active
					iconEl.className = "fa-regular fa-lock bbmm-active bbmm-click";
					iconEl.title = LT.name_SoftLock();
					break;
				case "lockAll":
					iconEl.className = "fa-solid fa-lock bbmm-active bbmm-click";
					iconEl.title = LT.lockAllTip();
					break;
				case "staged-lock":
					iconEl.className = "fa-solid fa-lock bbmm-pending bbmm-click";
					iconEl.title = LT.lockDialog?.stageLock?.() || "Staged: hard lock";
					break;
				case "staged-soft":
					iconEl.className = "fa-regular fa-lock bbmm-pending bbmm-click";
					iconEl.title = LT.lockDialog?.stageLock?.() || "Staged: soft lock";
					break;
				case "controlSoft":
					// Use the proper class tokens (no leading dot) and keep the clickable marker so the icon stays visible
					iconEl.className = "fa-solid fa-arrows-rotate bbmm-active bbmm-click";
					iconEl.title = LT.sync.PushHintControls() + "\n" +
						"• " + LT.sync.ClickPickUsers() + "\n" +
						"• " + LT.sync.ShiftAll() + "\n" +
						"• " + LT.sync.RightClearSoft();
					break;
				case "controlClear":
					// Ensure the sync icon keeps the required FA style prefix and clickable marker
					iconEl.className = "fa-solid fa-arrows-rotate bbmm-click";
					iconEl.title = LT.sync.PushHintControls() + "\n" +
						"• " + LT.sync.ClickPickUsers() + "\n" +
						"• " + LT.sync.ShiftAll() + "\n" +
						"• " + LT.sync.RightClearSoft();
					break;
				default:
					iconEl.className = "fa-solid fa-lock-open bbmm-click";
					iconEl.title = LT.lockDialog?.title?.() || "Lock setting";
					break;
			}
			iconEl.dataset.lockState = state || "unlocked";
		} catch (err) {
			DL(2, "_bbmmSetLockIconState(): failed", err);
		}
	}

	/* Build sync icon tooltip ==================================================== */
	function _bbmmBuildSyncTooltip() {
		try {
			return LT.sync.ConfirmPushAll();
		} catch (err) {
			DL(2, "_bbmmBuildSyncTooltip(): error", err);
			return "Push current value to all connected players";
		}
	}

	/* Confirm + queue a push of the current value to all players ================= */
	async function _bbmmConfirmPushToAll(id, ns, key, iconEl) {
		try {
			const ok = await foundry.applications.api.DialogV2.confirm({
				window: { title: LT.sync?.ConfirmPushTitle?.() || "Push to Players", modal: true },
				content: `<p>${LT.sync?.ConfirmPushAll?.() || "Push current value to all connected players?"}</p>`
			});
			if (!ok) return;
			_bbmmQueueOp({ op: "push", id, namespace: ns, key });
			_bbmmUpdateApplyButton(iconEl?.closest("form") ?? document.querySelector("form#client-settings"));
			ui.notifications?.info?.(LT.sync?.QueuedPushAll?.() || "Queued push to all players.");
		} catch (err) {
			DL(2, "setting-sync.js | _bbmmConfirmPushToAll(): error", err);
		}
	}

	/* Lightweight value editor for lock dialog ================================= */
	function _bbmmBuildValueInput(cfg, value) {
		if (cfg?.type === Boolean || typeof value === "boolean") {
			return `<input type="checkbox" class="bbmm-ld-val"${value ? " checked" : ""}>`;
		}
		const resolveChoices = (raw) => {
			if (!raw) return null;
			if (typeof raw === "function") { try { raw = raw(); } catch { return null; } }
			if (Array.isArray(raw)) {
				const obj = {};
				for (const item of raw) {
					if (item && typeof item === "object" && "value" in item) obj[String(item.value)] = String(item.label ?? item.value);
					else obj[String(item)] = String(item);
				}
				return Object.keys(obj).length ? obj : null;
			}
			if (typeof raw === "object" && Object.keys(raw).length) return raw;
			return null;
		};
		const choices = resolveChoices(cfg?.choices) ?? resolveChoices(cfg?.type?.choices);
		if (choices) {
			const strVal = String(value ?? "");
			const opts = Object.entries(choices)
				.map(([k, lbl]) => `<option value="${hlp_esc(k)}"${strVal === k ? " selected" : ""}>${hlp_esc(game.i18n.localize(String(lbl)))}</option>`)
				.join("");
			return `<select class="bbmm-ld-val">${opts}</select>`;
		}
		if (cfg?.type === Number || typeof value === "number") {
			return `<input type="number" class="bbmm-ld-val" step="any" value="${hlp_esc(String(value ?? 0))}">`;
		}
		if (cfg?.type === String || typeof value === "string") {
			return `<input type="text" class="bbmm-ld-val" value="${hlp_esc(String(value ?? ""))}">`;
		}
		let jsonStr = "";
		try { jsonStr = JSON.stringify(value); } catch { jsonStr = String(value ?? ""); }
		return `<textarea class="bbmm-ld-val" style="width:100%;min-height:4em;font-family:monospace;font-size:.85em;">${hlp_esc(jsonStr)}</textarea>`;
	}

	function _bbmmReadValueInput(root, cfg, originalValue) {
		const el = root.querySelector(".bbmm-ld-val");
		if (!el) return undefined;
		if (el.type === "checkbox") return el.checked;
		if (el.tagName === "TEXTAREA") {
			try { return JSON.parse(el.value); }
			catch { ui.notifications?.warn?.("Invalid JSON in lock value."); return undefined; }
		}
		if (el.type === "number") { const n = Number(el.value); return Number.isFinite(n) ? n : 0; }
		const raw = el.value;
		// Coerce to number if the registered type or the live value indicates number
		if (cfg?.type === Number || typeof originalValue === "number") {
			const n = Number(raw);
			return Number.isFinite(n) ? n : raw;
		}
		return raw;
	}

	/* BBMMLockDialog - dialog-driven lock/unlock flow ========================== */
	const BBMMLockDialog = {
		async show(id, syncMap, iconEl) {
			try {
				const dot = id.indexOf(".");
				const ns  = id.slice(0, dot);
				const key = id.slice(dot + 1);
				const cfg = game.settings.settings.get(id) || BBMM_REG.byId.get(id);
				const state = bbmmGetLockState(id, syncMap);

				if (state !== "none") {
					await BBMMLockDialog._showManage(id, ns, key, cfg, syncMap[id], iconEl);
				} else {
					await BBMMLockDialog._showStage(id, ns, key, cfg, null, iconEl);
				}
			} catch (err) {
				DL(2, "BBMMLockDialog.show(): error", err);
			}
		},

		_settingLabel(id, cfg, ns) {
			try {
				const raw = cfg?.name ? game.i18n.localize(cfg.name) : id;
				const nsLabel = ns === "core" ? "Core Foundry" : (game.modules?.get(ns)?.title || game.system?.title || ns);
				return `<strong>${hlp_esc(raw)}</strong> <span style="opacity:.7;font-size:.9em">(${hlp_esc(nsLabel)})</span>`;
			} catch { return hlp_esc(id); }
		},

		async _showStage(id, ns, key, cfg, existing, iconEl) {
			try {
				let curVal;
				try { curVal = existing?.value !== undefined ? existing.value : game.settings.get(ns, key); }
				catch { curVal = undefined; }

				const defaultLockType = existing?.lockType ?? (existing?.soft ? "soft" : "hard");

				const content = `
<div style="display:flex;flex-direction:column;gap:.75rem;min-width:480px;">
	<div>${BBMMLockDialog._settingLabel(id, cfg, ns)}</div>
	<div>
		<div style="font-weight:600;margin-bottom:.25rem;">${LT.lockDialog?.lockedValue?.() || "Value (for players)"}</div>
		<div class="bbmm-ld-value-wrap">${_bbmmBuildValueInput(cfg, curVal)}</div>
	</div>
	<div>
		<div style="font-weight:600;margin-bottom:.25rem;">${LT.lockDialog?.lockType?.() || "Lock Type"}</div>
		<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;margin-bottom:.2rem;">
			<input type="radio" name="bbmm-ld-type" value="hard"${defaultLockType !== "soft" ? " checked" : ""}>
			<span><strong>${LT.lockDialog?.hardLock?.() || "Hard Lock"}</strong> - ${LT.lockDialog?.hardLockDesc?.() || "Players cannot change this setting"}</span>
		</label>
		<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;">
			<input type="radio" name="bbmm-ld-type" value="soft"${defaultLockType === "soft" ? " checked" : ""}>
			<span><strong>${LT.lockDialog?.softLock?.() || "Soft Lock"}</strong> - ${LT.lockDialog?.softLockDesc?.() || "Pushes recommended value; players may still change it"}</span>
		</label>
	</div>
</div>`;

				const dlg = new foundry.applications.api.DialogV2({
					window: { title: LT.lockDialog?.title?.() || "Lock Setting", modal: true, width: 500 },
					content,
					buttons: [
						{
							action: "stage",
							label: LT.lockDialog?.stageLock?.() || "Stage Lock",
							default: true,
							callback: async (event, button, dialog) => {
								try {
									const root = dialog.element ?? dialog;
									const value = _bbmmReadValueInput(root, cfg, curVal);
									if (value === undefined) return false;

									const lockTypeEl = root.querySelector('input[name="bbmm-ld-type"]:checked');
									const lockType = lockTypeEl?.value === "soft" ? "soft" : "hard";

									if (lockType === "soft") {
										_bbmmQueueOp({ op: "soft", id, namespace: ns, key, soft: true, value });
										_bbmmSetLockIconState(iconEl, "staged-soft");
									} else {
										_bbmmQueueOp({ op: "lock", id, namespace: ns, key, value });
										_bbmmSetLockIconState(iconEl, "staged-lock");
									}

									_bbmmUpdateApplyButton(iconEl.closest("form") ?? document.querySelector("form#client-settings"));
									return true;
								} catch (err) {
									DL(2, "BBMMLockDialog stage callback error", err);
									return false;
								}
							}
						},
						{ action: "cancel", label: LT.buttons?.cancel?.() || "Cancel" }
					]
				});

				await dlg.render(true);
			} catch (err) {
				DL(2, "BBMMLockDialog._showStage(): error", err);
			}
		},

		async _showManage(id, ns, key, cfg, entry, iconEl) {
			try {
				const isSoft = !!entry?.soft;
				const lockTypeLabel = isSoft
					? (LT.lockDialog?.softLock?.() || "Soft Lock")
					: (LT.lockDialog?.hardLock?.() || "Hard Lock");
				let valPreview = "";
				try { valPreview = entry?.value !== undefined ? JSON.stringify(entry.value) : "—"; }
				catch { valPreview = String(entry?.value ?? "—"); }

				const content = `
<div style="display:flex;flex-direction:column;gap:.6rem;min-width:400px;">
	<div>${BBMMLockDialog._settingLabel(id, cfg, ns)}</div>
	<div style="display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem;align-items:baseline;">
		<span style="font-weight:600;">${LT.lockDialog?.lockType?.() || "Type"}</span>
		<span>${hlp_esc(lockTypeLabel)}</span>
		<span style="font-weight:600;">${LT.lockDialog?.lockedValue?.() || "Locked Value"}</span>
		<code style="font-size:.85em;word-break:break-all;">${hlp_esc(valPreview)}</code>
	</div>
</div>`;

				const existingData = {
					lockType: isSoft ? "soft" : "hard",
					value: entry?.value
				};

				const dlg = new foundry.applications.api.DialogV2({
					window: { title: LT.lockDialog?.editLock?.() || "Manage Lock", modal: true, width: 460 },
					content,
					buttons: [
						{
							action: "edit",
							label: LT.lockDialog?.editLock?.() || "Edit Lock",
							callback: async () => {
								await BBMMLockDialog._showStage(id, ns, key, cfg, existingData, iconEl);
								return true;
							}
						},
						{
							action: "unlock",
							label: LT.lockDialog?.unlock?.() || "Unlock",
							callback: async () => {
								_bbmmQueueOp({ op: "unlock", id, namespace: ns, key });
								_bbmmSetLockIconState(iconEl, "unlocked");
								_bbmmUpdateApplyButton(iconEl.closest("form") ?? document.querySelector("form#client-settings"));
								ui.notifications?.info?.(LT.infoClearedLocks?.() || "Lock removed.");
								return true;
							}
						},
						{ action: "cancel", label: LT.buttons?.cancel?.() || "Cancel" }
					]
				});

				await dlg.render(true);
			} catch (err) {
				DL(2, "BBMMLockDialog._showManage(): error", err);
			}
		}
	};

	/* Inject/refresh the "Apply N Pending Locks" button in the settings form === */
	function _bbmmUpdateApplyButton(form) {
		try {
			if (!form) return;
			const lockOps = _bbmmPendingOps.filter(o => o.op === "lock" || o.op === "soft" || o.op === "unlock" || o.op === "push");
			const count = lockOps.length;

			let btn = form.querySelector("#bbmm-apply-pending");
			if (!btn) {
				const footer = form.querySelector(".main .form-footer, .main footer, .main .sheet-footer") ?? form.querySelector("[data-application-part='main'] .form-footer") ?? null;
				btn = document.createElement("button");
				btn.type = "button";
				btn.id = "bbmm-apply-pending";
				btn.style.cssText = "background:#22c55e;color:#fff;border:none;border-radius:.3rem;padding:.35rem .75rem;cursor:pointer;font-weight:600;";
				if (footer) {
					footer.insertBefore(btn, footer.firstChild);
				} else {
					form.appendChild(btn);
				}
				btn.addEventListener("click", async () => {
					try {
						await _bbmmApplyPendingOps();
						_bbmmUpdateApplyButton(form);
						Hooks.callAll("bbmm:locksApplied");
					} catch (err) {
						DL(2, "_bbmmUpdateApplyButton click: error", err);
					}
				});
			}

			if (count > 0) {
				btn.style.display = "";
				btn.textContent = LT.lockPendingApply?.({ count }) || `Apply ${count} Pending Lock(s)`;
			} else {
				btn.style.display = "none";
			}
		} catch (err) {
			DL(2, "_bbmmUpdateApplyButton(): error", err);
		}
	}

	/*  Queue a pending lock or push operation until "Save Changes" ================ */
	function _bbmmQueueOp(entry) {
		try {
			// Remove conflicting op types for this id.
			// lock <-> soft are mutually exclusive; unlock cancels both lock and soft.
			const conflicts = entry.op === "soft" ? ["lock", "unlock"] :
							entry.op === "lock" ? ["soft", "unlock"] :
							entry.op === "unlock" ? ["lock", "soft"] : [];
			if (conflicts.length) {
			for (let i = _bbmmPendingOps.length - 1; i >= 0; i--) {
				const op = _bbmmPendingOps[i];
				if (op?.id === entry.id && conflicts.includes(op.op)) {
				_bbmmPendingOps.splice(i, 1);
				}
			}
			}

			// Normalize
			const clean = { ...entry };

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

			// UNLOCK ops (explicit lock/soft removal)
			for (const op of _bbmmPendingOps.filter(o => o.op === "unlock")) {
				const { id } = op;
				if (map[id]) {
					delete map[id];
					mapChanged = true;
					DL(`setting-sync.js |  bbmm-apply: UNLOCK ${id}`);
				}
				if (id in revMap) {
					delete revMap[id];
					revChanged = true;
				}
			}

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

			// HARD LOCK ops (always global, applies to every non-GM player)
			for (const op of _bbmmPendingOps.filter(o => o.op === "lock")) {
				try {
					const { id, namespace, key, value } = op;
					const cfg = game.settings.settings.get(id);
					if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

					map[id] = {
						namespace,
						key,
						value,
						requiresReload: !!cfg?.requiresReload
					};
					mapChanged = true;
					DL(`setting-sync.js |  bbmm-apply: lock ${id} (global)`);
				} catch (e) {
					DL(2, "setting-sync.js |  bbmm-apply: lock loop error", e);
				}
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

			// Emit queued hard pushes AFTER map save (always to all players)
			if (hardPushes.length && game.socket) {
				for (const op of hardPushes) {
					const { id, namespace, key } = op;
					const value = game.settings.get(namespace, key);
					game.socket.emit(BBMM_SYNC_CH, {
						t: "bbmm-sync-push",
						id,
						namespace,
						key,
						value,
						requiresReload: !!game.settings.settings.get(id)?.requiresReload,
						targets: null
					});
					DL(`setting-sync.js |  bbmm-apply: push ${id} (targets=all)`);
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

	/*  Get lock state for a setting: "none", "soft", or "all" ====================
		All locks are global (apply to every non-GM player). Legacy entries that
		still carry a userIds array read as "all" until migration clears them.
	============================================================================== */
	function bbmmGetLockState(id, map) {
		try {
			const rec = map?.[id];
			if (!rec) return "none";

			// Soft lock takes precedence for icon state
			if (rec?.soft === true) return "soft";

			// Any hard-lock entry applies to all players
			return "all";
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

	/*  Pretty label for a namespace ============================================== */
	function _bbmmNsLabel(ns) {
		try {
			if (ns === "core") return "Core Foundry";
			if (ns === game.system?.id) return game.system?.title || ns;
			return game.modules?.get(ns)?.title || ns;
		} catch { return ns; }
	}

	/* Migration: legacy per-player locks -> all-players or delete.
	   Idempotent; prompts the GM once per login until none remain. */
	async function checkPartialLockMigration() {
		try {
			if (!game.user?.isGM) return;

			const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const partials = Object.entries(map).filter(([, e]) => Array.isArray(e?.userIds) && e.userIds.length > 0);
			if (!partials.length) return;

			// Build a readable list of affected locks
			const nonGMTotal = (game.users?.contents || []).filter(u => !u.isGM).length;
			const listHTML = partials.map(([id, e]) => {
				const cfg = game.settings.settings.get(id);
				const settingName = cfg?.name ? (game.i18n.localize(cfg.name) || e.key) : (e.key || id);
				const count = Array.isArray(e.userIds) ? e.userIds.length : 0;
				return `<li><strong>${hlp_esc(settingName)}</strong> <span style="opacity:.7">(${hlp_esc(_bbmmNsLabel(e.namespace || id.slice(0, id.indexOf("."))))})</span> — ${count} / ${nonGMTotal}</li>`;
			}).join("");

			const content = `
<div style="display:flex;flex-direction:column;gap:.6rem;">
	<p>${LT.migration?.partialIntro?.() || "One or more setting locks target specific players. Per-player locks were removed in 1.4.0."}</p>
	<ul style="margin:.25rem 0 .25rem 1.2rem;">${listHTML}</ul>
</div>`;

			let choice = "later";
			try {
				choice = await foundry.applications.api.DialogV2.wait({
					window: { title: LT.migration?.partialTitle?.() || "Per-Player Locks Removed", modal: true },
					content,
					buttons: [
						{ action: "apply",  label: LT.migration?.partialApplyAll?.() || "Apply to All Players", default: true },
						{ action: "delete", label: LT.migration?.partialDelete?.() || "Delete Locks" },
						{ action: "later",  label: LT.migration?.partialLater?.() || "Decide Later" }
					],
					rejectClose: false
				});
			} catch { choice = "later"; }

			if (choice === "later" || !choice) {
				DL("setting-sync.js | checkPartialLockMigration(): deferred");
				return;
			}

			if (choice === "apply") {
				const hardPushes = [];
				for (const [id, e] of partials) {
					delete e.userIds;                       // becomes a global lock
					map[id] = e;
					hardPushes.push({ id, namespace: e.namespace || id.slice(0, id.indexOf(".")), key: e.key || id.slice(id.indexOf(".") + 1) });
				}
				await game.settings.set(BBMM_ID, "userSettingSync", map);
				bbmmBroadcastTrigger();

				// Push each value so players not previously covered pick it up immediately
				if (game.socket) {
					for (const hp of hardPushes) {
						let value;
						try { value = game.settings.get(hp.namespace, hp.key); } catch { value = map[hp.id]?.value; }
						game.socket.emit(BBMM_SYNC_CH, {
							t: "bbmm-sync-push",
							id: hp.id,
							namespace: hp.namespace,
							key: hp.key,
							value,
							requiresReload: !!game.settings.settings.get(hp.id)?.requiresReload,
							targets: null
						});
					}
				}
				DL(`setting-sync.js | checkPartialLockMigration(): applied ${partials.length} lock(s) to all players`);
				ui.notifications?.info?.(LT.migration?.partialDone?.({ count: partials.length }) || `Applied ${partials.length} lock(s) to all players.`);
				return;
			}

			if (choice === "delete") {
				for (const [id] of partials) delete map[id];
				await game.settings.set(BBMM_ID, "userSettingSync", map);
				bbmmBroadcastTrigger();
				DL(`setting-sync.js | checkPartialLockMigration(): deleted ${partials.length} partial lock(s)`);
				ui.notifications?.info?.(LT.migration?.partialDeleted?.({ count: partials.length }) || `Deleted ${partials.length} per-player lock(s).`);
				return;
			}
		} catch (err) {
			DL(2, "setting-sync.js | checkPartialLockMigration(): error", err);
		}
	}

	/* ==========================================================================
		Class: BBMMUserPicker (per-user picker, controls/keybind sync only)
	========================================================================== */
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
							// Allow zero selection to mean "no targets"
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

	/* ==========================================================================
		{ HOOK: Init } capture registered settings for lock support
	========================================================================== */
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

	/* ==========================================================================
		{ HOOK: closeSettingsConfig } capture GM setting changes
	========================================================================== */
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

				const existing = map[id];

				// Refresh requiresReload if it drifted; lock value is intentionally left unchanged
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


	/* ==========================================================================
		{ HOOK: setSetting } player guard against changing locked settings
	========================================================================== */
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

			// A lock entry means the setting is locked for every non-GM player.

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
				const hideLocked = (() => { try { return game.settings.get(BBMM_ID, "hideLockedSettings") !== false; } catch { return true; } })();

				let seen = 0, hidden = 0;

				// Helper: hide an element robustly
				const hideNode = (el) => {
					try { el.classList.add("bbmm-locked-hide"); el.style.display = "none"; } catch {}
				};

				// Helper: show an element as disabled (used when hideLockedSettings is off)
				const disableNode = (el) => {
					try {
						el.querySelectorAll?.("input, select, textarea, button").forEach(inp => {
							inp.disabled = true;
						});
						el.classList.add("bbmm-locked-disabled");
					} catch {}
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
					if (state !== "all") continue;

					// Hard locks apply to every player, so hide for everyone.

					if (hideLocked) {
						hideNode(group);
						group.setAttribute("data-bbmm-hidden", "true");
					} else {
						disableNode(group);
					}
					hidden++;
				}

				// Hide section headers that have no visible rows left (only when actually hiding)
				if (hideLocked) {
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
				}

				DL(`setting-sync.js |  bbmm-setting-lock: decorate(PLAYER-HIDE): seen=${seen}, hidden=${hidden}`);

				// Prevent "Save Changes" from doing anything unexpected 
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
					const cfg = game.settings.settings.get(id) || BBMM_REG.byId.get(id);
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
					} else if (state === "soft") {
						const softTitle = LT.name_SoftLock?.() || "Soft Lock";
						lockIcon = makeIcon(softTitle, "fa-regular fa-lock", true);
						lockIcon.classList.add("bbmm-active");
					} else {
						lockIcon = makeIcon(LT.lockDialog?.title?.() || "Lock setting", "fa-solid fa-lock-open", true);
					}

					// If locked and GM's live value differs from the stored lock value, tint the icon blue
					if (state !== "none") {
						const rec = syncMap[id];
						if (rec?.value !== undefined) {
							try {
								const dot = id.indexOf(".");
								const liveVal = game.settings.get(id.slice(0, dot), id.slice(dot + 1));
								if (!objectsEqual(liveVal, rec.value)) {
									lockIcon.classList.remove("bbmm-active");
									lockIcon.classList.add("bbmm-diverged");
									lockIcon.title += `\n${LT.lockDivergedTip?.() || "Your current value differs from the locked value."}`;
								}
							} catch {}
						}
					}

					// push icon...
					const pushIcon = makeIcon(_bbmmBuildSyncTooltip(), "fa-solid fa-arrows-rotate", true);
					pushIcon.addEventListener("click", (ev) => {
						try {
							ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

							const dot = id.indexOf(".");
							const ns = id.slice(0, dot);
							const key = id.slice(1 + dot);

							_bbmmConfirmPushToAll(id, ns, key, pushIcon);
						} catch (err) {
							DL(2, "setting-sync.js | bbmm-setting-lock(push): click error", err);
						}
					});

					// Single click opens the lock dialog
					lockIcon.addEventListener("click", (ev) => {
						try {
							ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
							const currentSyncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
							BBMMLockDialog.show(id, currentSyncMap, lockIcon);
						} catch (err) {
							DL(2, "setting-sync.js | lockIcon click handler error", err);
						}
					});

					attached++;
				}

				/* GM late-pass: attach icons to user/client rows still missing them */
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
							lockIcon = mk(LT.lockAllTip(), "fa-solid fa-lock");
							lockIcon.classList.add("bbmm-active");
						} else if (state === "soft") {
							const softTitle = (LT.name_SoftLock());
							lockIcon = mk(softTitle, "fa-regular fa-lock");
							lockIcon.classList.add("bbmm-active");
						} else {
							lockIcon = mk(LT.lockDialog?.title?.() || "Lock setting", "fa-solid fa-lock-open");
						}

						// If locked and GM's live value differs from the stored lock value, tint the icon blue
						if (state !== "none") {
							const rec = syncMap[id];
							if (rec?.value !== undefined) {
								try {
									const dot = id.indexOf(".");
									const liveVal = game.settings.get(id.slice(0, dot), id.slice(dot + 1));
									if (!objectsEqual(liveVal, rec.value)) {
										lockIcon.classList.remove("bbmm-active");
										lockIcon.classList.add("bbmm-diverged");
										lockIcon.title += `\n${LT.lockDivergedTip?.() || "Your current value differs from the locked value."}`;
									}
								} catch {}
							}
						}

						// Single click opens the lock dialog
						lockIcon.addEventListener("click", (ev) => {
							try {
								ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
								const currentSyncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
								BBMMLockDialog.show(id, currentSyncMap, lockIcon);
							} catch (err) { DL(2, `setting-sync.js | late-pass lock click error for ${id}`, err); }
						});
						bar.appendChild(lockIcon);

						// SYNC icon
						const syncIcon = mk(_bbmmBuildSyncTooltip(), "fa-solid fa-arrows-rotate");
						syncIcon.addEventListener("click", (ev) => {
							try {
								ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
								const dot = id.indexOf("."), ns = id.slice(0, dot), key = id.slice(dot + 1);
								_bbmmConfirmPushToAll(id, ns, key, syncIcon);
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

			// Inject apply button and re-update after locks are applied
			_bbmmUpdateApplyButton(form);
			Hooks.on("bbmm:locksApplied", () => {
				decorate();
				_bbmmUpdateApplyButton(form);
			});

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

			/* Apply pending SOFT locks at login (players only), deferred until modules
			   finish registering: canvasReady, or a 2000ms fallback if the canvas is off. */
			if (!game.user?.isGM) {
				const _softLoginApply = async () => { try {
					const map    = game.settings.get(BBMM_ID, "userSettingSync") || {};
					const ledger = foundry.utils.duplicate(game.settings.get(BBMM_ID, "softLockLedger") || {});
					let applied = 0;

					for (const [id, ent] of Object.entries(map)) {
						try {
							if (!ent?.soft) continue;

							const dot = id.indexOf(".");
							if (dot <= 0) continue;
							const ns  = id.slice(0, dot);
							const key = id.slice(dot + 1);

							if (!game.settings.settings.get(id)) {
								DL(`setting-sync.js |  SOFT login-apply skipped (unregistered): ${id}`);
								continue;
							}

							const worldRev = Number.isInteger(ent.rev) ? ent.rev : 0;
							const prevRev  = Number.isInteger(ledger[id]?.r) ? ledger[id].r : 0;
							if (worldRev <= prevRev) continue; // already up-to-date

							await game.settings.set(ns, key, ent.value);

							// Jump ledger directly to worldRev
							ledger[id] = { v: JSON.stringify(ent.value ?? null), r: worldRev };
							applied++;
							DL(`setting-sync.js |  SOFT login-apply: set ${id} rev=${worldRev}`);
						} catch (eApply) {
							DL(2, `setting-sync.js |  SOFT login-apply failed for ${id}`, eApply);
						}
					}

					if (applied > 0) {
						await game.settings.set(BBMM_ID, "softLockLedger", ledger);
						DL(`setting-sync.js |  SOFT login-apply complete: applied=${applied}`);
					}
				} catch (e) {
					DL(2, "setting-sync.js |  SOFT login-apply block failed", e);
				} };

				const noCanvas      = !!game.settings.get("core", "noCanvas");
				const noActiveScene = !game.scenes?.active;
				if (noCanvas || noActiveScene) {
					DL(`setting-sync.js |  SOFT login-apply: no canvas/scene, using 2s fallback`);
					setTimeout(_softLoginApply, 2000);
				} else {
					DL(`setting-sync.js |  SOFT login-apply: waiting for canvasReady`);
					Hooks.once("canvasReady", _softLoginApply);
				}
			}

			/* GM BLOCK ======================================================================== */
			if (game.user?.isGM) {

				/* BBMM Lock: resnap userSettingSync (GM only).
				   Lock values are frozen; only refresh requiresReload if it drifted. */
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

							const existing = map[id] || {};

							// If we've queued an unlock for this id, don't resnap it back in
							if (_bbmmIsUnlockQueued?.(id)) {
								DL(`setting-sync.js |  bbmm-resnap: skipping ${id} (unlock queued)`);
								continue;
							}

							// SOFT: lock value is frozen; only refresh requiresReload if it drifted
							if (existing.soft === true) {
								if (existing.requiresReload !== !!cfg?.requiresReload) {
									map[id] = { ...existing, requiresReload: !!cfg?.requiresReload };
									changed = true;
									DL(`setting-sync.js |  bbmm-resnap: refreshed requiresReload for SOFT ${id}`);
								}
								continue;
							}

							// HARD: lock value is frozen; only refresh requiresReload if it drifted
							if (existing.requiresReload !== !!cfg?.requiresReload) {
								map[id] = { ...existing, requiresReload: !!cfg?.requiresReload };
								changed = true;
								DL(`setting-sync.js |  bbmm-resnap: refreshed requiresReload for HARD ${id}`);
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

				// One-time migration: convert legacy per-player (partial) locks to all-players
				await checkPartialLockMigration();

				DL("setting-sync.js |  bbmm-setting-lock: injected CSS");
				return;
			}

			// Player: apply GM-enforced settings (initial), skip soft entries (soft = push-on-enable only)
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			console.log("[BBMM] Player login-apply: checking", Object.keys(syncMap).length, "locked settings");
			const initialEntries = Object.values(syncMap);

			// If there is a sync map - 
			if (initialEntries.length) {
				let changed = false, needsReload = false;

				for (const ent of initialEntries) {
					try {
						const cfg = game.settings.settings.get(`${ent.namespace}.${ent.key}`);
						if (!cfg || !(cfg.scope === "user" || cfg.scope === "client")) continue;

						// Soft locks are advisory: do NOT auto-apply here; they're handled above for login and by socket pushes
						if (ent?.soft === true) continue;

						// get current setting
						const current = game.settings.get(ent.namespace, ent.key);
						console.log(`[BBMM] checking ${ent.namespace}.${ent.key}: current=${JSON.stringify(current)} (${typeof current}), locked=${JSON.stringify(ent.value)} (${typeof ent.value}), equal=${objectsEqual(current, ent.value)}`);
						// compare if different
						if (!objectsEqual(current, ent.value)) {
							DL(`setting-sync.js |  bbmm-setting-lock: apply ${ent.namespace}.${ent.key} ->`, ent.value);
							// update setting
							await game.settings.set(ent.namespace, ent.key, ent.value);
							changed = true;
							if (ent.requiresReload || cfg.requiresReload) {
								needsReload = true;
								console.warn(`[BBMM] Reload required by locked setting: ${ent.namespace}.${ent.key} | locked value: ${JSON.stringify(ent.value)} (${typeof ent.value}) | was: ${JSON.stringify(current)} (${typeof current})`);
							}
						}
					} catch (err) {
						DL(2, "setting-sync.js |  bbmm-setting-lock: apply error", err);
					}
				}

				// See if we need to reload
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

						// Update ledger to reflect last evaluated rev regardless of whether value changed
						if (soft === true) {
							try {
								const ledger = foundry.utils.duplicate(game.settings.get(BBMM_ID, "softLockLedger") || {});
								const prev = ledger[id];
								const prevRev = (prev && typeof prev === "object" && Number.isInteger(prev.r)) ? prev.r : -1;
								const recordRev = Number.isInteger(softRev) ? softRev : prevRev;
								ledger[id] = { v: JSON.stringify(value ?? null), r: recordRev };
								await game.settings.set(BBMM_ID, "softLockLedger", ledger);
								DL(`setting-sync.js |  soft-ledger: marked evaluated rev=${recordRev} for ${id}`);
							} catch (e) {
								DL(2, "setting-sync.js |  soft-ledger: mark on evaluate failed", e);
							}
						}

						if (!objectsEqual(current, value)) {
							DL(`setting-sync.js |  bbmm-setting-lock: push apply ${id} ->`, value);
							await game.settings.set(namespace, key, value);

							if (requiresReload || cfg.requiresReload) {
								console.error(`[BBMM] SOCKET push reload triggered by: ${id} | locked value:`, value, `| was:`, current);
								if (hlp_shouldAutoForceReload()) {
									DL(`setting-sync.js | client push: autoForceReload enabled, reloading now (${id})`);
									try { ui.notifications?.warn?.(LT.sync.ReloadWarn()); } catch {}
									setTimeout(() => {
										try { location.reload(); } catch {}
									}, 250);
								} else {
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
										DL(2, "setting-sync.js | client push: could not show reload dialog", err);
										ui.notifications?.warn?.(LT.sync.ReloadWarn());
									}
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

							// SKIP soft in on-demand refresh (soft handled by login + push)
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
							if (hlp_shouldAutoForceReload()) {
								DL("setting-sync.js | client refresh: autoForceReload enabled, reloading now");
								try { ui.notifications?.warn?.(LT.sync.ReloadWarn()); } catch {}
								setTimeout(() => {
									try { location.reload(); } catch {}
								}, 250);
							} else {
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
									DL(2, "setting-sync.js | client refresh: could not show reload dialog", err);
									ui.notifications?.warn?.(LT.sync.ReloadWarn());
								}
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

						const ns = msg.namespace ?? msg.ns, action = msg.action;
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

	/*  Get Control Soft-Lock Ledger ======================================= */
	function _bbmmGetControlLedger() {
		try {
			return game.settings.get(BBMM_ID, "controlSoftLedger") ?? {};
		} catch {
			return {};
		}
	}

	/*  Set Control Soft-Lock Ledger ======================================= */
	async function _bbmmSetControlLedger(ledger) {
		try {
			return await game.settings.set(BBMM_ID, "controlSoftLedger", ledger);
		} catch (err) {
			DL(2, "setting-sync.js | failed to save controlSoftLedger", err);
		}
	}

	/*  Build unique control ID =====================================================
		Join namespace + action into a single string identifier.
	============================================================================= */
	function _bbmmCtrlId(ns, action) { return `${ns}.${action}`; }

	/*  Get Control Sync store ======================================================
		Fetch world-level storage object containing current control locks/sync state.
		Returns {} if not yet set.
	============================================================================= */
	function _bbmmCtrlGetStore() {
		try { return game.settings.get(BBMM_ID, "userControlSync") ?? {}; } catch { return {}; }
	}

	/*  Set Control Sync store ======================================================
		Replace the world-level storage object with new contents.
		Persists immediately via game.settings.
	============================================================================= */
	async function _bbmmCtrlSetStore(next) {
		try { await game.settings.set(BBMM_ID, "userControlSync", next ?? {}); }
		catch (err) { DL(2, "setting-sync.js | ctrlSetStore() failed", err); }
	}

	/*  Get Control Revision Map ====================================================
		Returns persistent rev map used for soft-locks.
		Tracks revision numbers per control for change detection.
	============================================================================= */
	function _bbmmCtrlGetRevMap() {
		try { return game.settings.get(BBMM_ID, "softLockRevMap_controls") ?? {}; } catch { return {}; }
	}

	/*  Set Control Revision Map ====================================================
		Update stored revision map for control soft-locks.
		Saves to world settings.
	============================================================================= */
	async function _bbmmCtrlSetRevMap(map) {
		try { await game.settings.set(BBMM_ID, "softLockRevMap_controls", map ?? {}); }
		catch (err) { DL(2, "setting-sync.js | ctrlSetRevMap() failed", err); }
	}

	/*  Is Control Sync enabled? ====================================================
		Returns true if GM has enabled control synchronization feature.
	============================================================================= */
	function _bbmmCtrlEnabled() {
		try {
			const master = bbmmIsSyncEnabled();
			const ctrl = game.settings.get(BBMM_ID, "enableControlSync") !== false;
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

				// Mark handled so it won't re-apply on refresh/load
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
	async function _bbmmCtrlGMSoft({ ns, action, iconEl = null }) {
		try {
			const id = _bbmmCtrlId(ns, action);
			DL(`ctrlGMSoft(): start for ${id}`);

			const store = _bbmmCtrlGetStore();
			const revMap = _bbmmCtrlGetRevMap();

			/* Apply Soft Lock ================================================== */
			const next = { ...(store[id] ?? {}) };
			next.soft = { value: _bbmmCtrlBindings(ns, action) };
			next.lock = null;
			next.rev = (Number(next.rev) || 0) + 1;
			store[id] = next;
			revMap[id] = next.rev;
			DL(`Soft lock APPLIED for ${id} (rev=${next.rev})`);

			/* Persist store + revMap ============================================= */
			await _bbmmCtrlSetStore(store);
			await _bbmmCtrlSetRevMap(revMap);

			/* Update Ledger (tracks which users have seen this soft lock)  */
			try {
				const ledger = _bbmmGetControlLedger();
				const userId = game.user?.id;
				if (userId) {
					ledger[userId] ??= [];
					if (!ledger[userId].includes(id)) ledger[userId].push(id);
					await _bbmmSetControlLedger(ledger);
				}
			} catch (ledgerErr) {
				DL(2, "ctrlGMSoft(): failed to update controlSoftLedger", ledgerErr);
			}

			/* Update UI icon (orange tint for soft lock) ======================== */
			try {
				if (iconEl) {
					_bbmmSetLockIconState(iconEl, "controlSoft");
				} else {
					const sel = `.form-group[data-action-id="${ns}.${action}"] .bbmm-ctrlbar i.fa-arrows-rotate`;
					const el = document.querySelector(sel);
					if (el) _bbmmSetLockIconState(el, "controlSoft");
				}
			} catch (iconErr) {
				DL(2, "ctrlGMSoft(): icon tint update failed", iconErr);
			}

			/* Notify and broadcast =========================================== */
			ui.notifications?.info?.(LT.controlsSoftApplied());
			game.socket?.emit?.(BBMM_SYNC_CH, { t: "bbmm-ctrl-refresh" });
			DL(`ctrlGMSoft(): broadcast bbmm-ctrl-refresh after soft lock for ${id}`);
		} catch (err) {
			DL(2, "setting-sync.js | ctrlGMSoft() failed", { ns, action, err });
		}
	}

	/* ==========================================================================
		Wire Control Config UI (Sync/Lock icons on the Controls window)
	========================================================================== */
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
				"• " + LT.sync.ShiftAll() + "\n" +
				"• " + LT.sync.RightClearSoft();

				bar.appendChild(syncIcon);

				// (Click/keyboard handlers handled later in this function; remove duplicate broken handlers)

				// Highlight if currently soft-locked
				const id = `${ns}.${action}`;
				try {
					const store = _bbmmCtrlGetStore();
					DL(`setting-sync.js | controls: wiring ${id}`, store?.[id] ?? {});
					if (store?.[id]?.soft?.value) {
						_bbmmSetLockIconState(syncIcon, "controlSoft");
					} else {
						_bbmmSetLockIconState(syncIcon, "controlClear");
					}
				} catch {}


				// LEFT CLICK -> open user picker, then push current bindings to the selected players
				syncIcon.addEventListener("click", async (ev) => {
					try {
						ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

						if (ev.shiftKey) {
							DL(`controls: ${ns}.${action} | soft-lock (Shift+Click)`);
							await _bbmmCtrlGMSoft({ ns, action });

							// Refresh icon state (we have syncIcon here!)
							try {
								const id = `${ns}.${action}`;
								const store = _bbmmCtrlGetStore();
								const state = store?.[id]?.soft?.value ? "controlSoft" : "controlClear";
								_bbmmSetLockIconState(syncIcon, state);
							} catch (err) {
								DL(2, "ctrl soft-lock: failed to update icon state", err);
							}

							game.socket?.emit?.(BBMM_SYNC_CH, { t: "bbmm-ctrl-refresh" });
							return;
						}

						// CLICK => PICK PLAYERS AND PUSH CURRENT BINDINGS (no locks)
						// Keybind sync keeps per-player targeting, unlike settings locks/sync.
						DL(`controls: ${ns}.${action} | push to selected players`);
						const cur = _bbmmCtrlBindings(ns, action); // snapshot current bindings

						const picker = new BBMMUserPicker({
							title: LT.titleSyncForUsers(),
							settingId: `${ns}.${action}`,
							valuePreview: cur,
							confirmLabel: LT.buttons.btnSync(),
							onlyOnline: true,
							preChecked: "*",
							onConfirm: async (userIds) => {
								const targets = Array.isArray(userIds) ? userIds : [];
								// one-shot push (no lock), players apply immediately
								game.socket?.emit?.(BBMM_SYNC_CH, {
									t: "bbmm-ctrl-push",
									namespace: ns,
									action,
									value: cur,
									targets
								});
								ui.notifications?.info?.(`Synced ${ns}.${action} to ${targets.length} users.`);
							}
						});
						picker.show();
					} catch (err) {
						DL(2, "controls syncIcon click error", err);
					}
				});

				// RIGHT CLICK -> clear soft lock for this control
				syncIcon.addEventListener("contextmenu", async (ev) => {
					ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

					try {
						const id = _bbmmCtrlId(ns, action);
						const store = _bbmmCtrlGetStore();
						const revMap = _bbmmCtrlGetRevMap();

						if (store?.[id]?.soft) {
							delete store[id].soft;
							delete revMap[id];
							await _bbmmCtrlSetStore(store);
							await _bbmmCtrlSetRevMap(revMap);
							_bbmmSetLockIconState(syncIcon, "controlClear");
							ui.notifications?.info?.(`Soft lock cleared for ${ns}.${action}`);
							game.socket?.emit?.(BBMM_SYNC_CH, { t: "bbmm-ctrl-refresh" });
						}
					} catch (err) {
						DL(2, "setting-sync.js | failed to clear control soft lock (right click)", err);
					}
				});

				// swallow context menu so we don't clash with Foundry's buttons
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
	{ LOCK MANAGER }
	Moved here from macros.js so the manager lives next to the sync/socket logic
	it drives. Class renamed BBMMLockConfigurator -> BBMMLockManager. The picker
	(BBMMLockPicker) is a sub-popup used only by the manager and moves with it.
============================================================================= */

	// single-line preview of any value (local copy; macros.js keeps its own)
	function toPreview(v) {
		try {
			if (v === undefined) return "undefined";
			if (v === null) return "null";
			if (typeof v === "string") return v;
			if (typeof v === "number" || typeof v === "boolean") return String(v);
			return JSON.stringify(v);
		} catch { return String(v); }
	}

	/* ==========================================================================
		Lock write helper, shared by BBMMLockManager + BBMMLockPicker
	========================================================================== */
	async function _lc_writeLockChanges({ toAdd = [], toRemove = [] } = {}) {
		const map    = game.settings.get(BBMM_ID, "userSettingSync") || {};
		const revMap = game.settings.get(BBMM_ID, "softLockRevMap")  || {};
		const nonGMIds = (game.users?.contents || []).filter(u => !u.isGM).map(u => u.id);

		let hardCount = 0, softCount = 0, removeCount = 0;
		const softPushes = [], hardPushes = [];
		let needsRefresh = false;

		for (const { namespace, key } of toRemove) {
			const id = `${namespace}.${key}`;
			if (map[id]) { delete map[id]; removeCount++; needsRefresh = true; }
		}

		for (const { namespace, key, lockType, value } of toAdd) {
			const id  = `${namespace}.${key}`;
			const cfg = game.settings.settings.get(id);
			if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

			if (lockType === "locked") {
				map[id] = { namespace, key, value, requiresReload: !!cfg.requiresReload };
				hardPushes.push({ namespace, key, value, requiresReload: !!cfg.requiresReload });
				hardCount++; needsRefresh = true;
			} else if (lockType === "soft") {
				const currentRev = Number.isInteger(revMap[id]) ? revMap[id] : 0;
				const newRev     = currentRev + 1;
				map[id]          = { namespace, key, value, requiresReload: !!cfg.requiresReload, soft: true, rev: newRev };
				revMap[id]       = newRev;
				softPushes.push({ namespace, key, value, requiresReload: !!cfg.requiresReload, softRev: newRev });
				softCount++; needsRefresh = true;
			}
		}

		await game.settings.set(BBMM_ID, "userSettingSync", map);
		if (softPushes.length) await game.settings.set(BBMM_ID, "softLockRevMap", revMap);

		if (game.socket && needsRefresh) {
			setTimeout(() => game.socket.emit(BBMM_SYNC_CH, { t: "bbmm-sync-refresh" }), 300);
			for (const sp of softPushes) {
				game.socket.emit(BBMM_SYNC_CH, {
					t: "bbmm-sync-push", soft: true, softRev: sp.softRev,
					namespace: sp.namespace, key: sp.key, value: sp.value,
					targets: nonGMIds, requiresReload: sp.requiresReload
				});
			}
			for (const hp of hardPushes) {
				game.socket.emit(BBMM_SYNC_CH, {
					t: "bbmm-sync-push",
					namespace: hp.namespace, key: hp.key, value: hp.value,
					targets: null, requiresReload: hp.requiresReload
				});
			}
		}

		return { hardCount, softCount, removeCount };
	}

	/* ==========================================================================
		Lock Manager, main window (list of current locks)
	========================================================================== */
	class BBMMLockManager extends foundry.applications.api.ApplicationV2 {
		constructor() {
			super({
				id: "bbmm-lock-configurator",
				window: { title: LT.lockConfigurator.title() },
				width: 700,
				height: 500,
				resizable: true
			});
			this.filter = "";
		}

		_nsLabel(ns) {
			if (ns === "core") return "Core Foundry";
			if (ns === game.system?.id) return game.system?.title || ns;
			return game.modules.get(ns)?.title || ns;
		}

		_loadRows() {
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const rows = [];
			for (const [id, entry] of Object.entries(syncMap)) {
				const cfg = game.settings.settings.get(id);
				const ns  = entry.namespace || id.slice(0, id.indexOf("."));
				const key = entry.key      || id.slice(id.indexOf(".") + 1);
				rows.push({
					id,
					namespace:   ns,
					key,
					lockType:    entry.soft ? "soft" : "locked",
					value:       entry.value,
					nsLabel:     this._nsLabel(ns),
					settingName: cfg?.name ? (game.i18n.localize(cfg.name) || key) : key,
					hint:        cfg?.hint ? (game.i18n.localize(cfg.hint) || "") : "",
					isHidden:    cfg ? (cfg.config === false) : false
				});
			}
			rows.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key));
			return rows;
		}

		_rowHTML(r) {
			const lockedSel = r.lockType === "locked" ? " selected" : "";
			const softSel   = r.lockType === "soft"   ? " selected" : "";
			const badge     = r.isHidden
				? `<span class="bbmm-lc-hbadge">${LT.lockConfigurator.hiddenBadge()}</span>`
				: "";
			return `
				<div class="bbmm-lc-row" data-id="${hlp_esc(r.id)}">
					<div class="bbmm-lc-cell c-lock">
						<select class="bbmm-lc-type" data-id="${hlp_esc(r.id)}">
							<option value="locked"${lockedSel}>${LT.lockConfigurator.lockTypeLocked()}</option>
							<option value="soft"${softSel}>${LT.lockConfigurator.lockTypeSoft()}</option>
						</select>
					</div>
					<div class="bbmm-lc-cell c-ns" title="${hlp_esc(r.nsLabel)}">${hlp_esc(r.nsLabel)}</div>
					<div class="bbmm-lc-cell c-setting">
						<div class="bbmm-lc-name">${hlp_esc(r.settingName)} ${badge}</div>
						${r.hint ? `<div class="bbmm-lc-hint">${hlp_esc(r.hint)}</div>` : ""}
					</div>
					<div class="bbmm-lc-cell c-value" title="${hlp_esc(toPreview(r.value))}"><code>${hlp_esc(toPreview(r.value))}</code></div>
					<div class="bbmm-lc-cell c-actions">
						<button type="button" class="bbmm-lc-edit" data-id="${hlp_esc(r.id)}">${LT.lockConfigurator.editBtn()}</button>
					</div>
				</div>`;
		}

		_getFilteredRows(allRows) {
			const q = (this.filter || "").trim().toLowerCase();
			if (!q) return allRows;
			return allRows.filter(r =>
				r.namespace.toLowerCase().includes(q) ||
				r.key.toLowerCase().includes(q) ||
				r.settingName.toLowerCase().includes(q)
			);
		}

		_rerenderRows() {
			if (!this._root) return;
			const bodyEl  = this._root.querySelector("#bbmm-lc-body");
			const countEl = this._root.querySelector("#bbmm-lc-count");
			if (!bodyEl) return;
			const allRows      = this._loadRows();
			const filteredRows = this._getFilteredRows(allRows);
			bodyEl.innerHTML   = filteredRows.length
				? filteredRows.map(r => this._rowHTML(r)).join("")
				: `<div class="bbmm-lc-empty">${LT.lockConfigurator.noLocks()}</div>`;
			if (countEl) countEl.textContent = LT.lockConfigurator.activeCount({ count: allRows.length });
		}

		async _switchLockType(id, newLockType) {
			if (!game.user?.isGM) return;
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const entry   = syncMap[id];
			if (!entry) return;
			await _lc_writeLockChanges({
				toAdd:    [{ namespace: entry.namespace, key: entry.key, lockType: newLockType, value: entry.value }],
				toRemove: []
			});
			this._rerenderRows();
		}

		async _unlockSetting(id) {
			if (!game.user?.isGM) { ui.notifications.warn(LT.lockConfigurator.gmOnly()); return; }
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const entry   = syncMap[id];
			if (!entry) return;
			await _lc_writeLockChanges({ toAdd: [], toRemove: [{ namespace: entry.namespace, key: entry.key }] });
			ui.notifications.info(LT.lockConfigurator.unlocked({ key: entry.key }));
			this._rerenderRows();
		}

		// Edit dialog: same value/type editor as the settings-sheet lock dialog, applied now
		async _editSetting(id) {
			if (!game.user?.isGM) { ui.notifications.warn(LT.lockConfigurator.gmOnly()); return; }
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const entry   = syncMap[id];
			if (!entry) return;

			const ns     = entry.namespace;
			const key    = entry.key;
			const cfg    = game.settings.settings.get(id);
			const curVal = entry.value;
			const isSoft = !!entry.soft;

			const content = `
				<div style="display:flex;flex-direction:column;gap:.75rem;min-width:480px;">
					<div>${BBMMLockDialog._settingLabel(id, cfg, ns)}</div>
					<div>
						<div style="font-weight:600;margin-bottom:.25rem;">${LT.lockDialog.lockedValue()}</div>
						<div class="bbmm-ld-value-wrap">${_bbmmBuildValueInput(cfg, curVal)}</div>
					</div>
					<div>
						<div style="font-weight:600;margin-bottom:.25rem;">${LT.lockDialog.lockType()}</div>
						<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;margin-bottom:.2rem;">
							<input type="radio" name="bbmm-ld-type" value="hard"${!isSoft ? " checked" : ""}>
							<span><strong>${LT.lockDialog.hardLock()}</strong> - ${LT.lockDialog.hardLockDesc()}</span>
						</label>
						<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;">
							<input type="radio" name="bbmm-ld-type" value="soft"${isSoft ? " checked" : ""}>
							<span><strong>${LT.lockDialog.softLock()}</strong> - ${LT.lockDialog.softLockDesc()}</span>
						</label>
					</div>
				</div>`;

			const dlg = new foundry.applications.api.DialogV2({
				window: { title: LT.lockDialog.editLock(), modal: true, width: 500 },
				content,
				buttons: [
					{
						action: "save",
						label: LT.buttons.save(),
						default: true,
						callback: async (event, button, dialog) => {
							const root  = dialog.element ?? dialog;
							const value = _bbmmReadValueInput(root, cfg, curVal);
							if (value === undefined) return false;	// invalid JSON, keep dialog open
							const typeEl   = root.querySelector('input[name="bbmm-ld-type"]:checked');
							const lockType = typeEl?.value === "soft" ? "soft" : "locked";
							await _lc_writeLockChanges({ toAdd: [{ namespace: ns, key, lockType, value }], toRemove: [] });
							this._rerenderRows();
							return true;
						}
					},
					{
						action: "unlock",
						label: LT.lockDialog.unlock(),
						callback: async () => { await this._unlockSetting(id); return true; }
					},
					{ action: "cancel", label: LT.buttons.cancel() }
				]
			});
			await dlg.render(true);
		}

		_openPicker() {
			new BBMMLockPicker(this).render(true);
		}

		async _renderHTML() {
			const allRows      = this._loadRows();
			const filteredRows = this._getFilteredRows(allRows);
			const bodyHTML     = filteredRows.length
				? filteredRows.map(r => this._rowHTML(r)).join("")
				: `<div class="bbmm-lc-empty">${LT.lockConfigurator.noLocks()}</div>`;

			const cols = "130px 130px 1fr 140px 76px";
			const css  = `
				#bbmm-lock-configurator .window-content{display:flex;flex-direction:column;padding:.4rem !important}
				#bbmm-lock-configurator .bbmm-lc-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.4rem}
				#bbmm-lock-configurator .bbmm-lc-toolbar{display:flex;gap:.5rem;align-items:center}
				#bbmm-lock-configurator .bbmm-lc-toolbar input{flex:1}
				#bbmm-lock-configurator .bbmm-lc-head{display:grid;grid-template-columns:${cols};border:1px solid var(--color-border,#444);border-radius:.4rem .4rem 0 0;background:var(--color-bg-header,#1e1e1e)}
				#bbmm-lock-configurator .bbmm-lc-head .h{padding:.25rem .4rem;border-bottom:1px solid #444;font-weight:600;line-height:1.2}
				#bbmm-lock-configurator .bbmm-lc-body{display:block;flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--color-border,#444);border-top:0;border-radius:0 0 .4rem .4rem}
				#bbmm-lock-configurator .bbmm-lc-row{display:grid;grid-template-columns:${cols};border-bottom:1px solid #333;align-items:start}
				#bbmm-lock-configurator .bbmm-lc-cell{padding:.25rem .4rem;min-width:0}
				#bbmm-lock-configurator .c-ns{font-size:.85em;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
				#bbmm-lock-configurator .c-value code{font-size:.8em;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
				#bbmm-lock-configurator .bbmm-lc-name{font-weight:500}
				#bbmm-lock-configurator .bbmm-lc-hint{font-size:.8em;opacity:.6;margin-top:.1rem}
				#bbmm-lock-configurator .bbmm-lc-hbadge{display:inline-block;padding:.05em .35em;border-radius:3px;font-size:.75em;background:rgba(255,200,0,.2);border:1px solid rgba(255,200,0,.35);margin-left:.25rem;vertical-align:middle}
				#bbmm-lock-configurator .bbmm-lc-empty{padding:2rem;text-align:center;opacity:.6;font-style:italic}
				#bbmm-lock-configurator .bbmm-lc-footer{display:flex;justify-content:space-between;align-items:center;padding:.35rem .4rem 0;border-top:1px solid #333;flex-shrink:0}
			`;

			return (
				`<style>${css}</style>` +
				`<div class="bbmm-lc-root">` +
					`<div class="bbmm-lc-toolbar">` +
						`<input id="bbmm-lc-filter" type="text" placeholder="${hlp_esc(LT.lockConfigurator.filterPlaceholder())}" value="${hlp_esc(this.filter ?? "")}" />` +
						`<button type="button" id="bbmm-lc-add-top">${LT.lockConfigurator.addLocks()}</button>` +
					`</div>` +
					`<div class="bbmm-lc-head">` +
						`<div class="h">${LT.lockConfigurator.colLockType()}</div>` +
						`<div class="h">${LT.lockConfigurator.colNamespace()}</div>` +
						`<div class="h">${LT.lockConfigurator.colSetting()}</div>` +
						`<div class="h">${LT.lockConfigurator.colValue()}</div>` +
						`<div class="h"></div>` +
					`</div>` +
					`<div class="bbmm-lc-body" id="bbmm-lc-body">${bodyHTML}</div>` +
					`<div class="bbmm-lc-footer">` +
						`<span id="bbmm-lc-count">${LT.lockConfigurator.activeCount({ count: allRows.length })}</span>` +
						`<button type="button" id="bbmm-lc-add-bottom">${LT.lockConfigurator.addLocks()}</button>` +
					`</div>` +
				`</div>`
			);
		}

		async _replaceHTML(result, _options) {
			const content = this.element.querySelector(".window-content") || this.element;
			Object.assign(content.style, { display:"flex", flexDirection:"column", height:"100%", minHeight:"0" });

			try {
				const winEl = this.element;
				winEl.style.minWidth  = "500px";
				winEl.style.maxWidth  = "1000px";
				winEl.style.minHeight = "300px";
				winEl.style.maxHeight = "700px";
				winEl.style.overflow  = "hidden";
			} catch {}

			content.innerHTML = result;
			this._root = content;

			this._bind(this._root);

			try { this.setPosition({ height: "auto", left: null, top: null }); } catch {}
		}

		// Delegated listeners; bound once to the persistent root (window-content or pane wrapper).
		_bind(root) {
			if (this._delegated) { this._rerenderRows(); return; }
			this._delegated = true;

			// All events bound to root so they survive future innerHTML replacements of children
			let debTimer = null;
			root.addEventListener("input", (ev) => {
				const el = ev.target.closest?.("#bbmm-lc-filter");
				if (!el) return;
				clearTimeout(debTimer);
				debTimer = setTimeout(() => { this.filter = el.value ?? ""; this._rerenderRows(); }, 150);
			}, { passive: true });

			root.addEventListener("click", (ev) => {
				if (ev.target.closest?.("#bbmm-lc-add-top") || ev.target.closest?.("#bbmm-lc-add-bottom")) {
					this._openPicker(); return;
				}
				const btn = ev.target.closest?.(".bbmm-lc-edit");
				if (btn) this._editSetting(btn.dataset.id);
			});

			root.addEventListener("change", (ev) => {
				const sel = ev.target.closest?.(".bbmm-lc-type");
				if (sel) this._switchLockType(sel.dataset.id, sel.value);
			});
		}

		// Mount into a toolbox pane. Reuses _renderHTML + _bind; binds to a persistent
		// inner wrapper whose id scopes the inline styles, so switching tabs can't double-bind.
		async _bbmmMountInto(container) {
			this._bbmmEmbed = container;
			if (!this._paneWrap || !container.contains(this._paneWrap)) {
				this._paneWrap = document.createElement("div");
				this._paneWrap.id = "bbmm-lock-configurator";
				container.replaceChildren(this._paneWrap);
				this._delegated = false;
			}
			const wrap = this._paneWrap;
			wrap.innerHTML = await this._renderHTML();
			this._root = wrap;
			this._bind(wrap);
		}
	}

	/* ==========================================================================
		Lock Picker, add-locks dialog (sub-popup of the Lock Manager)
	========================================================================== */
	class BBMMLockPicker extends foundry.applications.api.ApplicationV2 {
		constructor(parentConfigurator) {
			super({
				id: "bbmm-lock-picker",
				window: { title: LT.lockPicker.title() },
				width: 1825,
				height: 600,
				resizable: true
			});
			this._parent          = parentConfigurator;
			this._staged          = new Map();
			this._selectedNs      = "";
			this.filter           = "";
			this._showUnlabeled   = false;
		}

		_nsLabel(ns) {
			if (ns === "core") return "Core Foundry";
			if (ns === game.system?.id) return game.system?.title || ns;
			return game.modules.get(ns)?.title || ns;
		}

		_listNamespaces() {
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const nsSet   = new Set();
			for (const [fullKey, cfg] of game.settings.settings.entries()) {
				if (cfg.__isMenu) continue;
				if (cfg.scope !== "user" && cfg.scope !== "client") continue;
				if (syncMap[fullKey]) continue;
				if (this._staged.has(fullKey)) continue;
				const idx = fullKey.indexOf(".");
				if (idx <= 0) continue;
				nsSet.add(fullKey.slice(0, idx));
			}
			const list = Array.from(nsSet);
			list.sort((a, b) => {
				if (a === "core") return -1; if (b === "core") return 1;
				const sysId = game.system?.id;
				if (a === sysId) return -1; if (b === sysId) return 1;
				return this._nsLabel(a).localeCompare(this._nsLabel(b));
			});
			return list;
		}

		_loadNamespaceRows(ns) {
			if (!ns) return [];
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const rows    = [];
			for (const [fullKey, cfg] of game.settings.settings.entries()) {
				const idx = fullKey.indexOf(".");
				if (idx <= 0) continue;
				if (fullKey.slice(0, idx) !== ns) continue;
				if (cfg.__isMenu) continue;
				if (cfg.scope !== "user" && cfg.scope !== "client") continue;
				if (syncMap[fullKey]) continue;
				if (this._staged.has(fullKey)) continue;
				const key            = fullKey.slice(idx + 1);
				const rawName        = cfg.name ? game.i18n.localize(cfg.name) : "";
				const isUnlabeled    = !rawName || (rawName === cfg.name && cfg.name.includes("."));
				if (isUnlabeled && !this._showUnlabeled) continue;
				const settingName    = isUnlabeled ? key : rawName;
				let value;
				try { value = game.settings.get(ns, key); } catch { value = null; }
				rows.push({
					id:          fullKey,
					namespace:   ns,
					key,
					cfg,
					value,
					settingName,
					hint:        cfg.hint ? (game.i18n.localize(cfg.hint) || "") : "",
					isHidden:    cfg.config === false,
					isUnlabeled
				});
			}
			rows.sort((a, b) => {
				if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
				return a.key.localeCompare(b.key);
			});
			return rows;
		}

		_valueInputHTML(cfg, value) {
			// boolean type check first, also catches typeof boolean values
			if (cfg.type === Boolean || typeof value === "boolean") {
				return `<input type="checkbox" class="bbmm-lp-val"${value ? " checked" : ""}>`;
			}

			// Choices: plain object, array, function, or DataField-style (cfg.type.choices)
			// Normalize whatever shape we find into a plain { key: label } object
			const _resolveChoices = (raw) => {
				if (!raw) return null;
				if (typeof raw === "function") { try { raw = raw(); } catch { return null; } }
				if (Array.isArray(raw)) {
					// Array of strings: value === label; array of {value,label} objects
					const obj = {};
					for (const item of raw) {
						if (item && typeof item === "object" && "value" in item) obj[String(item.value)] = String(item.label ?? item.value);
						else obj[String(item)] = String(item);
					}
					return Object.keys(obj).length ? obj : null;
				}
				if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length) return raw;
				return null;
			};
			let choices = _resolveChoices(cfg.choices) ?? _resolveChoices(cfg.type?.choices);
			if (choices) {
				const strVal = String(value ?? "");
				const opts   = Object.entries(choices)
					.map(([k, label]) => `<option value="${hlp_esc(k)}"${strVal === k ? " selected" : ""}>${hlp_esc(game.i18n.localize(String(label)))}</option>`)
					.join("");
				return `<select class="bbmm-lp-val">${opts}</select>`;
			}

			// Number: explicit type or typeof fallback
			if (cfg.type === Number || typeof value === "number") {
				return `<input type="number" class="bbmm-lp-val" step="any" value="${hlp_esc(String(value ?? 0))}">`;
			}

			// String: explicit type or typeof fallback
			if (cfg.type === String || typeof value === "string") {
				return `<input type="text" class="bbmm-lp-val" value="${hlp_esc(String(value ?? ""))}">`;
			}

			// Fallback for objects/arrays/unknown: preview + pop-out JSON editor
			let jsonStr = "";
			try { jsonStr = JSON.stringify(value); } catch { jsonStr = String(value ?? ""); }
			let prettyPreview = "";
			try { prettyPreview = JSON.stringify(value, null, 2); } catch { prettyPreview = jsonStr; }
			return `<div class="bbmm-json-editor-wrap" style="display:flex;flex-direction:column;gap:.2rem;min-width:0;">` +
				`<code class="bbmm-json-preview" style="display:block;white-space:pre-wrap;word-break:break-all;font-size:.8em;opacity:.85;max-height:13em;overflow-y:auto;">${hlp_esc(prettyPreview)}</code>` +
				`<button type="button" class="bbmm-json-edit-btn" style="align-self:flex-start;white-space:nowrap;">${LT.lockPicker.jsonEditorBtn?.() ?? "Edit JSON…"}</button>` +
				`<input type="hidden" class="bbmm-lp-val" value="${hlp_esc(jsonStr)}">` +
				`</div>`;
		}

		_readInputValue(inputEl, cfg) {
			if (!inputEl) return undefined;
			if (inputEl.type === "checkbox") return inputEl.checked;
			if (inputEl.tagName === "TEXTAREA" || inputEl.type === "hidden") {
				try { return JSON.parse(inputEl.value); }
				catch { ui.notifications.warn(LT.lockPicker.invalidJSON()); return undefined; }
			}
			if (inputEl.type === "number") {
				const n = Number(inputEl.value);
				return Number.isFinite(n) ? n : 0;
			}
			return inputEl.value;
		}

		_rowHTML(r) {
			const hiddenBadge    = r.isHidden
				? `<span class="bbmm-lp-hbadge">${LT.lockPicker.hiddenBadge()}</span>`
				: "";
			const unlabeledBadge = r.isUnlabeled
				? `<span class="bbmm-lp-ulbadge">${LT.lockPicker.unlabeledBadge()}</span>`
				: "";
			const badge = hiddenBadge + unlabeledBadge;
			return `
				<div class="bbmm-lp-row" data-id="${hlp_esc(r.id)}" data-ns="${hlp_esc(r.namespace)}" data-key="${hlp_esc(r.key)}">
					<div class="bbmm-lp-cell c-setting">
						<div class="bbmm-lp-name">${hlp_esc(r.settingName)} ${badge}</div>
						${r.hint ? `<div class="bbmm-lp-hint">${hlp_esc(r.hint)}</div>` : ""}
					</div>
					<div class="bbmm-lp-cell c-value">${this._valueInputHTML(r.cfg, r.value)}</div>
					<div class="bbmm-lp-cell c-actions">
						<button type="button" class="bbmm-lp-lock" data-id="${hlp_esc(r.id)}">${LT.lockPicker.lockBtn()}</button>
						<button type="button" class="bbmm-lp-soft" data-id="${hlp_esc(r.id)}">${LT.lockPicker.softLockBtn()}</button>
					</div>
				</div>`;
		}

		_stageRow(id, lockType, rowEl) {
			const cfg     = game.settings.settings.get(id);
			const inputEl = rowEl.querySelector(".bbmm-lp-val");
			const value   = this._readInputValue(inputEl, cfg);
			if (value === undefined) return;
			this._staged.set(id, { namespace: rowEl.dataset.ns, key: rowEl.dataset.key, lockType, value });
			rowEl.remove();
			this._updateStagingBadge();
		}

		_updateStagingBadge() {
			if (!this._root) return;
			const count   = this._staged.size;
			const badge   = this._root.querySelector("#bbmm-lp-staged");
			const summary = this._root.querySelector("#bbmm-lp-staged-summary");
			const saveBtn = this._root.querySelector("#bbmm-lp-save");
			const rowsEl  = this._root.querySelector("#bbmm-lp-rows");

			if (badge) {
				badge.textContent   = count > 0 ? LT.lockPicker.stagedCount({ count }) : "";
				badge.style.display = count > 0 ? "" : "none";
			}
			if (summary) summary.textContent = LT.lockPicker.stagedSummary({ count });
			if (saveBtn) saveBtn.disabled    = count === 0;

			if (rowsEl && !rowsEl.querySelector(".bbmm-lp-row")) {
				rowsEl.innerHTML = `<div class="bbmm-lp-empty">${LT.lockPicker.noSettings()}</div>`;
			}
		}

		async _openJsonEditor(hiddenInput, keyLabel) {
			let pretty = "";
			try { pretty = JSON.stringify(JSON.parse(hiddenInput.value), null, 2); }
			catch { pretty = hiddenInput.value; }

			const newVal = await new Promise((resolve) => {
				new foundry.applications.api.DialogV2({
					window: { title: LT.lockPicker.jsonEditorTitle({ key: keyLabel }), modal: false },
					position: { width: 500 },
					content: `<textarea name="jsonVal" style="width:100%;min-height:280px;font-family:monospace;font-size:.85em;resize:vertical;box-sizing:border-box;">${hlp_esc(pretty)}</textarea>`,
					buttons: [
						{ action: "apply", label: LT.lockPicker.jsonEditorApply?.() ?? "Apply", default: true, callback: (_ev, btn) => resolve(btn.form.elements.jsonVal?.value ?? "") },
						{ action: "cancel", label: LT.lockPicker.cancel?.() ?? "Cancel", callback: () => resolve(null) },
					],
					submit: () => {},
					rejectClose: false,
				}).render(true);
			});

			if (newVal === null) return;

			try { JSON.parse(newVal); }
			catch { ui.notifications.warn(LT.lockPicker.invalidJSON()); return; }

			hiddenInput.value = newVal;
			const previewEl = hiddenInput.closest(".bbmm-json-editor-wrap")?.querySelector(".bbmm-json-preview");
			if (previewEl) {
				try { previewEl.textContent = JSON.stringify(JSON.parse(newVal), null, 2); }
				catch { previewEl.textContent = newVal; }
			}
		}

		_renderNamespaceRows(ns) {
			const rowsEl = this._root?.querySelector("#bbmm-lp-rows");
			if (!rowsEl) return;
			const q    = (this.filter || "").trim().toLowerCase();
			let rows   = this._loadNamespaceRows(ns);
			if (q) rows = rows.filter(r => r.key.toLowerCase().includes(q) || r.settingName.toLowerCase().includes(q));
			rowsEl.innerHTML = rows.length
				? rows.map(r => this._rowHTML(r)).join("")
				: `<div class="bbmm-lp-empty">${LT.lockPicker.noSettings()}</div>`;
		}

		async _saveLocks() {
			if (!game.user?.isGM)   { ui.notifications.warn(LT.lockConfigurator.gmOnly()); return; }
			if (!this._staged.size) { ui.notifications.warn(LT.lockPicker.nothingStaged()); return; }
			const { hardCount, softCount } = await _lc_writeLockChanges({ toAdd: [...this._staged.values()], toRemove: [] });
			ui.notifications.info(LT.lockPicker.saved({ hard: hardCount, soft: softCount }));
			this._staged.clear();
			try { this._parent?._rerenderRows(); } catch {}
			await this.close();
		}

		async _renderHTML() {
			const namespaces = this._listNamespaces();
			if (!this._selectedNs && namespaces.length) this._selectedNs = namespaces[0];

			const nsOpts = namespaces.map(ns =>
				`<option value="${hlp_esc(ns)}"${ns === this._selectedNs ? " selected" : ""}>${hlp_esc(this._nsLabel(ns))}</option>`
			).join("");

			const rows   = this._selectedNs ? this._loadNamespaceRows(this._selectedNs) : [];
			const q      = (this.filter || "").trim().toLowerCase();
			const filt   = q ? rows.filter(r => r.key.toLowerCase().includes(q) || r.settingName.toLowerCase().includes(q)) : rows;
			const bodyHTML = filt.length
				? filt.map(r => this._rowHTML(r)).join("")
				: `<div class="bbmm-lp-empty">${LT.lockPicker.noSettings()}</div>`;

			const staged = this._staged.size;

			return (
				`<div class="bbmm-lp-root">` +
					`<div class="bbmm-lp-toolbar">` +
						`<select id="bbmm-lp-ns">${nsOpts}</select>` +
						`<input id="bbmm-lp-filter" type="text" placeholder="${hlp_esc(LT.lockPicker.filterPlaceholder())}" value="${hlp_esc(this.filter ?? "")}" />` +
						`<label class="bbmm-lp-unlabeled-label" title="${hlp_esc(LT.lockPicker.includeUnlabeledTooltip())}">` +
							`<input type="checkbox" id="bbmm-lp-unlabeled"${this._showUnlabeled ? " checked" : ""}>` +
							hlp_esc(LT.lockPicker.includeUnlabeled()) +
						`</label>` +
						`<span id="bbmm-lp-staged" class="bbmm-lp-sbadge" style="${staged > 0 ? "" : "display:none;"}">${staged > 0 ? LT.lockPicker.stagedCount({ count: staged }) : ""}</span>` +
					`</div>` +
					`<div class="bbmm-lp-body" id="bbmm-lp-body">` +
						`<div class="bbmm-lp-head">` +
							`<div class="h">${LT.lockPicker.colSetting()}</div>` +
							`<div class="h">${LT.lockPicker.colValue()}</div>` +
							`<div class="h"></div>` +
						`</div>` +
						`<div id="bbmm-lp-rows">${bodyHTML}</div>` +
					`</div>` +
					`<div class="bbmm-lp-footer">` +
						`<span id="bbmm-lp-staged-summary">${LT.lockPicker.stagedSummary({ count: staged })}</span>` +
						`<div class="bbmm-lp-fbtns">` +
							`<button type="button" id="bbmm-lp-cancel">${LT.lockPicker.cancel()}</button>` +
							`<button type="button" id="bbmm-lp-save"${staged === 0 ? " disabled" : ""}>${LT.lockPicker.saveLocks()}</button>` +
						`</div>` +
					`</div>` +
				`</div>`
			);
		}

		static _LP_COLS = "525px 400px 150px";

		static _ensureStyles() {
			const id = "bbmm-lock-picker-styles";
			if (document.getElementById(id)) return;
			const cols = BBMMLockPicker._LP_COLS;
			const css = `
				#bbmm-lock-picker .window-content{display:flex;flex-direction:column;padding:.4rem !important}
				#bbmm-lock-picker .bbmm-lp-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:.4rem;overflow-x:hidden}
				#bbmm-lock-picker .bbmm-lp-toolbar{display:flex;gap:.5rem;align-items:center}
				#bbmm-lock-picker .bbmm-lp-toolbar select{flex:0 1 200px;min-width:100px;max-width:200px}
				#bbmm-lock-picker .bbmm-lp-toolbar input{flex:1;min-width:0}
				#bbmm-lock-picker .bbmm-lp-sbadge{display:inline-block;padding:.1em .5em;border-radius:3px;font-size:.85em;background:rgba(80,160,80,.3);border:1px solid rgba(80,160,80,.4)}
				#bbmm-lock-picker .bbmm-lp-body{display:block;flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;border:1px solid var(--color-border,#444);border-radius:.4rem}
				#bbmm-lock-picker .bbmm-lp-head{display:grid;grid-template-columns:${cols};position:sticky;top:0;z-index:1;background:var(--color-bg-header,#1e1e1e);border-bottom:1px solid #444}
				#bbmm-lock-picker .bbmm-lp-head .h{padding:.25rem .4rem;font-weight:600;min-width:0;overflow:hidden}
				#bbmm-lock-picker .bbmm-lp-row{display:grid;grid-template-columns:${cols};border-bottom:1px solid #333;align-items:start;overflow:hidden}
				#bbmm-lock-picker .bbmm-lp-cell{padding:.25rem .4rem;min-width:0;overflow:hidden}
				#bbmm-lock-picker .bbmm-lp-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
				#bbmm-lock-picker .bbmm-lp-hint{font-size:.8em;opacity:.6;margin-top:.1rem;overflow-wrap:break-word;word-break:break-word;white-space:normal}
				#bbmm-lock-picker .bbmm-lp-hbadge{display:inline-block;padding:.05em .35em;border-radius:3px;font-size:.75em;background:rgba(255,200,0,.2);border:1px solid rgba(255,200,0,.35);margin-left:.25rem;vertical-align:middle}
				#bbmm-lock-picker .bbmm-lp-ulbadge{display:inline-block;padding:.05em .35em;border-radius:3px;font-size:.75em;background:rgba(200,100,255,.2);border:1px solid rgba(200,100,255,.35);margin-left:.25rem;vertical-align:middle}
				#bbmm-lock-picker .bbmm-lp-unlabeled-label{display:flex;align-items:center;gap:.3rem;white-space:nowrap;cursor:pointer;font-size:.9em;flex-shrink:0}
				#bbmm-lock-picker .c-value .bbmm-lp-val{width:100%}
				#bbmm-lock-picker .c-actions{display:flex;gap:.25rem;align-items:center;flex-wrap:wrap;padding-top:.2rem}
				#bbmm-lock-picker .bbmm-lp-empty{padding:2rem;text-align:center;opacity:.6;font-style:italic}
				#bbmm-lock-picker .bbmm-lp-footer{display:flex;justify-content:space-between;align-items:center;padding:.35rem .4rem 0;border-top:1px solid #333;flex-shrink:0}
				#bbmm-lock-picker .bbmm-lp-fbtns{display:flex;gap:.5rem}
			`;
			const el = document.createElement("style");
			el.id = id;
			el.textContent = css;
			document.head.appendChild(el);
		}

		async _replaceHTML(result, _options) {
			BBMMLockPicker._ensureStyles();

			const content = this.element.querySelector(".window-content") || this.element;
			Object.assign(content.style, { display:"flex", flexDirection:"column", height:"100%", minHeight:"0" });

			try {
				const winEl = this.element;
				winEl.style.minWidth  = "600px";
				winEl.style.minHeight = "400px";
				winEl.style.maxHeight = "750px";
				winEl.style.overflow  = "hidden";
			} catch {}

			content.innerHTML = result;
			this._root = content;

			if (this._delegated) return;
			this._delegated = true;

			const root = this._root;

			root.addEventListener("change", (ev) => {
				const ns = ev.target.closest?.("#bbmm-lp-ns");
				if (ns) {
					this._selectedNs = ns.value || "";
					this.filter = "";
					const f = root.querySelector("#bbmm-lp-filter");
					if (f) f.value = "";
					this._renderNamespaceRows(this._selectedNs);
					return;
				}
				const unlabeled = ev.target.closest?.("#bbmm-lp-unlabeled");
				if (unlabeled) {
					this._showUnlabeled = unlabeled.checked;
					this._renderNamespaceRows(this._selectedNs);
					return;
				}
			});

			let debTimer = null;
			root.addEventListener("input", (ev) => {
				const el = ev.target.closest?.("#bbmm-lp-filter");
				if (!el) return;
				clearTimeout(debTimer);
				debTimer = setTimeout(() => { this.filter = el.value ?? ""; this._renderNamespaceRows(this._selectedNs); }, 150);
			}, { passive: true });

			root.addEventListener("click", (ev) => {
				const editBtn = ev.target.closest?.(".bbmm-json-edit-btn");
				if (editBtn) {
					const wrap = editBtn.closest?.(".bbmm-json-editor-wrap");
					const hiddenInput = wrap?.querySelector(".bbmm-lp-val");
					const row = editBtn.closest?.(".bbmm-lp-row");
					if (hiddenInput) this._openJsonEditor(hiddenInput, row?.dataset?.key ?? "");
					return;
				}
				const lock = ev.target.closest?.(".bbmm-lp-lock");
				if (lock) { const row = lock.closest?.(".bbmm-lp-row"); if (row) { this._stageRow(lock.dataset.id, "locked", row); return; } }
				const soft = ev.target.closest?.(".bbmm-lp-soft");
				if (soft) { const row = soft.closest?.(".bbmm-lp-row"); if (row) { this._stageRow(soft.dataset.id, "soft", row); return; } }
				if (ev.target.closest?.("#bbmm-lp-save"))   { this._saveLocks(); return; }
				if (ev.target.closest?.("#bbmm-lp-cancel")) { this.close(); return; }
			});

			try { this.setPosition({ height: "auto", left: null, top: null }); } catch {}
		}
	}

	/* ==========================================================================
		Lock Manager openers + API registration
		openLockManager() is the canonical opener; openLockConfigurator() is kept
		as a back-compat alias for existing macros / globalThis.bbmm references.
	========================================================================== */
	export async function openLockManager() {
		globalThis.bbmm?.openBBMMToolbox?.({ tool: "lockManager" });
	}

	// Back-compat alias
	export async function openLockConfigurator() {
		return openLockManager();
	}

	// Toolbox pane: mounts BBMMLockManager into the pane.
	async function mountLockManager(container) {
		if (!game.user?.isGM) {
			container.innerHTML = `<div class="bbmm-tb-placeholder">${LT.lockConfigurator.gmOnly()}</div>`;
			return;
		}

		try {
			const app = new BBMMLockManager();
			await app._bbmmMountInto(container);
		} catch (err) {
			DL(3, "setting-sync.js | mountLockManager(): error", err);
			container.innerHTML = `<div class="bbmm-tb-placeholder">${LT.lockConfigurator.failedOpen()}</div>`;
		}
	}

	Hooks.once("init", () => {
		try {
			globalThis.bbmm ??= {};
			globalThis.bbmm.openLockManager = openLockManager;
			globalThis.bbmm.openLockConfigurator = openLockConfigurator;
			const mod = game.modules.get(BBMM_ID);
			if (mod) { mod.api = mod.api || {}; Object.assign(mod.api, { openLockManager, openLockConfigurator }); }
			DL("setting-sync.js | init(): Lock Manager API registered");
		} catch (err) {
			DL(3, "setting-sync.js | init(): failed to register Lock Manager API", err);
		}
	});

	// Register the Lock Manager as a toolbox tool.
	globalThis.bbmm ??= {};
	globalThis.bbmm.toolboxTools ??= [];
	globalThis.bbmm.toolboxTools.push({
		id: "lockManager",
		icon: "fa-solid fa-lock",
		label: () => LT.toolbox.tabLockManager(),
		visible: () => game.user.isGM,
		group: null,
		mount: async (container) => { await mountLockManager(container); }
	});

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
			if (!_bbmmCtrlEnabled()) return; // controls sync disabled
			_bbmmCtrlWireConfig(app, html);
			requestAnimationFrame(() => _bbmmCtrlWireConfig(app, html));
			setTimeout(() => _bbmmCtrlWireConfig(app, html), 50);
		} catch (err) { DL(2, 'renderControlsConfig failed', err); }
	});