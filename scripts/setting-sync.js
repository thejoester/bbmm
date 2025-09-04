/*
	=======================================================
		BBMM Setting Lock
		- GM: adds Person icon + Lock icon to every *user/client* setting
		- GM clicking Lock icon: toggle in bbmm.userSettingSync (store/remove GM value)
		- Player: on ready, apply diffs; show reload dialog if needed
		- GM updates: broadcast a lightweight trigger; clients pull & apply
	=======================================================
*/

import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";

/*
	=======================================================
        Globals
	=======================================================
*/
const BBMM_REG = { byId: new Map() };	// Live registry of settings
const BBMM_SYNC_CH = `module.${BBMM_ID}`;	// Socket channel for this module

// equality helper
const objectsEqual = foundry?.utils?.objectsEqual ?? ((a, b) => {
	try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; }
});


/*
	=======================================================
    GM: trigger clients to refresh their local lock map 
	=======================================================
*/
let _bbmmTriggerTimer = null;
function bbmmBroadcastTrigger() {
	try {
		if (!game.user?.isGM) return;
		if (!game.socket) return;
		clearTimeout(_bbmmTriggerTimer);
		_bbmmTriggerTimer = setTimeout(() => {
			game.socket.emit(BBMM_SYNC_CH, { t: "bbmm-sync-refresh" });
			DL("bbmm-setting-lock: broadcast refresh trigger");
		}, 50); // debounce minor bursts
	} catch (err) {
		DL(2, "bbmm-setting-lock: broadcast error", err);
	}
}

/*
	=======================================================
		BBMM Lock: resnap userSettingSync
		- GM only
		- Compare live values vs stored map
		- Update map if different
	=======================================================
*/
async function bbmmResnapUserSync() {
	try {
		if (!game.user?.isGM) return;

		let map = game.settings.get(BBMM_ID, "userSettingSync") || {};
		const ids = Object.keys(map);
		if (!ids.length) {
			DL("bbmm-setting-lock: resnap → no entries");
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

			// use v13-safe equality
			const same = (typeof foundry?.utils?.objectsEqual === "function")
				? foundry.utils.objectsEqual(live, prev)
				: live === prev;

			if (!same) {
				map[id].value = live;
				map[id].requiresReload = map[id].requiresReload ?? !!cfg.requiresReload;
				changed = true;
				DL(`bbmm-setting-lock: resnap updated ${id} ->`, live);
			}
		}

		if (changed) {
			await game.settings.set(BBMM_ID, "userSettingSync", map);
			bbmmBroadcastTrigger();
			DL("bbmm-setting-lock: resnap complete, map saved");
		} else {
			DL("bbmm-setting-lock: resnap complete, no changes");
		}
	} catch (err) {
		DL(2, "bbmm-setting-lock: resnap error", err);
	}
}

/*
	Push current GM value over socket:
	- Only for user/client scoped settings
	- Players apply value; prompt reload if needed
*/
function bbmmPushSetting(ns, key) {
	try {
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
		DL(`bbmm-setting-lock: push -> ${id}`, value);
	} catch (err) {
		DL(2, "bbmm-setting-lock: push error", err);
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
				DL(`lock-capture: registered ${id} (scope=${data?.scope})`);
			} catch (e) {
				DL(2, "lock-capture: record error", e);
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
		DL(`lock-capture: bootstrap complete, total=${BBMM_REG.byId.size}`);
	} catch (err) {
		DL(3, "lock-capture:init error", err);
	}
});

/*
	=======================================================
        Capture GM setting changes      
	=======================================================
*/
Hooks.on("closeSettingsConfig", async (app) => {
	try {
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
				map[id].value = cur;
				map[id].requiresReload = map[id].requiresReload ?? !!cfg.requiresReload;
				changed = true;
				DL(`bbmm-setting-lock: resnap on close ${id} ->`, cur);
			}
		}

		if (changed) {
			await game.settings.set(BBMM_ID, "userSettingSync", map);
			bbmmBroadcastTrigger(); // notify players after write
			DL("bbmm-setting-lock: userSettingSync updated on closeSettingsConfig");
		}
	} catch (err) {
		DL(2, "bbmm-setting-lock: resnap on close error", err);
	}
});

/*
	=======================================================
		Player guard: prevent changing locked settings
	=======================================================
*/
Hooks.on("setSetting", async (namespace, key, value) => {
	try {
		if (game.user?.isGM) return;

		const id = `${namespace}.${key}`;
		const cfg = game.settings.settings.get(id);
		if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) return;

		const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
		const entry = map[id];
		if (!entry) return; // not locked

		// Revert if different from GM value
		const equal = objectsEqual(value, entry.value);
		if (!equal) {
			DL(`bbmm-setting-lock: player attempted to change locked ${id}, reverting`);
			setTimeout(async () => {
				try {
					await game.settings.set(namespace, key, entry.value);
					ui.notifications?.warn?.(LT.sync.LockedByGM());
				} catch (err) {
					DL(2, "bbmm-setting-lock: revert error", err);
				}
			}, 0);
		}
	} catch (err) {
		DL(2, "bbmm-setting-lock: setSetting guard error", err);
	}
});

/*
	=======================================================
        GM: decorate settings UI (icons for user/client) 
	=======================================================
*/
Hooks.on("renderSettingsConfig", (app, html) => {
	try {
		// Common
		const form = app?.form || html?.[0] || app?.element?.[0] || document;

		// Player branch: HIDE locked controls completely
		if (!game.user?.isGM) {
			const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			const lockedIds = new Set(Object.keys(syncMap));
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

			DL(`bbmm-setting-lock: decorate(PLAYER-HIDE): seen=${seen}, hidden=${hidden}`);

			// Prevent “Save Changes” from doing anything unexpected (nothing left to serialize)
			form.addEventListener("submit", (ev) => {
				DL("bbmm-setting-lock: submit guard — nothing to save for hidden locked settings");
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

				// lock toggle: lock setting and hide from players
				const isLocked = !!syncMap[id];
				const lockTitle = (LT.syncToggleHint());
				const lockIcon = makeIcon(lockTitle, "fa-solid fa-lock", true);
				if (isLocked) lockIcon.classList.add("bbmm-active");

				// sync/push icon: force this one setting now to players
				const pushTitle = (LT.syncPushHint());
				const pushIcon = makeIcon(pushTitle, "fa-solid fa-arrows-rotate", true);
				pushIcon.addEventListener("click", (ev) => {
					try {
						ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
						const dot = id.indexOf(".");
						bbmmPushSetting(id.slice(0, dot), id.slice(dot + 1));
					} catch (err) {
						DL(2, "bbmm-setting-lock(push): click error", err);
					}
				});

				// Keep one small try/catch here because it touches settings + socket
				const toggleLock = (ev) => {
					try {
						ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

						const currentMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
						const already = !!currentMap[id];

						if (already) {
							delete currentMap[id];
							game.settings.set(BBMM_ID, "userSettingSync", currentMap).then(() => {
								lockIcon.classList.remove("bbmm-active");
								DL(`bbmm-setting-lock: removed ${id}`);
								bbmmBroadcastTrigger();
							});
						} else {
							const dot = id.indexOf(".");
							const namespace = id.slice(0, dot);
							const key = id.slice(dot + 1);
							const currentValue = game.settings.get(namespace, key);

							currentMap[id] = {
								namespace, key,
								value: currentValue,
								requiresReload: !!cfg.requiresReload
							};
							game.settings.set(BBMM_ID, "userSettingSync", currentMap).then(() => {
								lockIcon.classList.add("bbmm-active");
								DL(`bbmm-setting-lock: added ${id}`, currentValue);
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
			DL(`bbmm-setting-lock: decorate(): user/client found=${found}, bars attached=${attached}`);
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
	} catch (err) {
		DL(3, "bbmm-setting-lock: renderSettingsConfig(): error", err);
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
		if (game.user?.isGM) { // GM: inject CSS for the icons
			bbmmResnapUserSync();

			const css = document.createElement("style");
			css.id = `${BBMM_ID}-lock-style`;
			css.textContent = `
				.bbmm-lock-icons i + i { margin-left: .35rem; }
				.bbmm-lock-icons { display:inline-flex; gap:.4rem; margin-left:.4rem; vertical-align:middle; }
				.bbmm-lock-icons .bbmm-badge { opacity:.85; }
				.bbmm-lock-icons .bbmm-click { cursor:pointer; opacity:.85; }
				.bbmm-lock-icons .bbmm-click:hover { opacity:1; transform: translateY(-1px); }
				.bbmm-lock-icons .bbmm-active { color: orange; }

				/* Player disabled styles */
				.bbmm-locked-input { opacity: .65; pointer-events: none; }
				.bbmm-locked-badge { display: inline-flex; align-items: center; gap: .25rem; margin-left: .4rem; color: var(--color-text-dark-secondary, #999); }
				.bbmm-locked-hide { display: none !important; }
			`;
			document.head.appendChild(css);
			DL("bbmm-setting-lock: injected CSS");
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
						DL(`bbmm-setting-lock: apply ${ent.namespace}.${ent.key} ->`, ent.value);
						await game.settings.set(ent.namespace, ent.key, ent.value);
						changed = true;
						if (ent.requiresReload || cfg.requiresReload) needsReload = true;
					}
				} catch (err) {
					DL(2, "bbmm-setting-lock: apply error", err);
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
					DL(2, "bbmm-setting-lock: could not show reload dialog", err);
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

					const { namespace, key, value, requiresReload } = msg;
					const id = `${namespace}.${key}`;
					const cfg = game.settings.settings.get(id);
					if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) return;

					const current = game.settings.get(namespace, key);
					if (!objectsEqual(current, value)) {
						DL(`bbmm-setting-lock: push apply ${id} ->`, value);
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

					DL("bbmm-setting-lock: received refresh trigger");

					const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
					let changed = false, needsReload = false;

					for (const ent of Object.values(map)) {
						if (!ent || typeof ent.namespace !== "string" || typeof ent.key !== "string") continue;

						const id = `${ent.namespace}.${ent.key}`;
						const cfg = game.settings.settings.get(id);
						if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

						const current = game.settings.get(ent.namespace, ent.key);
						if (!objectsEqual(current, ent.value)) {
							DL(`bbmm-setting-lock: trigger apply ${id} ->`, ent.value);
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
		DL(3, "bbmm-setting-lock: ready(): error", err);
	}
});
