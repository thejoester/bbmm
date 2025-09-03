/*
	=======================================================
		BBMM Setting Sync
		- GM: adds Person icon + Sync icon to every *user/client* setting
		- GM clicking Sync icon: toggle in bbmm.userSettingSync (store/remove GM value)
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
    GM: trigger clients to refresh their local sync map 
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
			DL("bbmm-setting-sync: broadcast refresh trigger");
		}, 50); // debounce minor bursts
	} catch (err) {
		DL(2, "bbmm-setting-sync: broadcast error", err);
	}
}

/*
	=======================================================
		BBMM Sync: resnap userSettingSync
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
			DL("bbmm-setting-sync: resnap → no entries");
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
				DL(`bbmm-setting-sync: resnap updated ${id} ->`, live);
			}
		}

		if (changed) {
			await game.settings.set(BBMM_ID, "userSettingSync", map);
            bbmmBroadcastTrigger();
			DL("bbmm-setting-sync: resnap complete, map saved");
		} else {
			DL("bbmm-setting-sync: resnap complete, no changes");
		}
	} catch (err) {
		DL(2, "bbmm-setting-sync: resnap error", err);
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
				DL(`sync-capture: registered ${id} (scope=${data?.scope})`);
			} catch (e) {
				DL(2, "sync-capture: record error", e);
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
		DL(`sync-capture: bootstrap complete, total=${BBMM_REG.byId.size}`);
	} catch (err) {
		DL(3, "sync-capture:init error", err);
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
				DL(`bbmm-setting-sync: resnap on close ${id} ->`, cur);
			}
		}

		if (changed) {
			await game.settings.set(BBMM_ID, "userSettingSync", map);
			bbmmBroadcastTrigger(); // notify players after write
			DL("bbmm-setting-sync: userSettingSync updated on closeSettingsConfig");
		}
	} catch (err) {
		DL(2, "bbmm-setting-sync: resnap on close error", err);
	}
});

/*
	=======================================================
        GM: decorate settings UI (icons for user/client) 
	=======================================================
*/
Hooks.on("renderSettingsConfig", (app, html) => {
	try {
		if (!game.user?.isGM) return;

		const form = app?.form || html?.[0] || app?.element?.[0] || document;

		const decorate = () => {
			try {
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

					let bar = label.querySelector(".bbmm-sync-icons");
					if (!bar) {
						bar = document.createElement("span");
						bar.className = "bbmm-sync-icons";
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

					// 👤 scope badge
					makeIcon(
						cfg.scope === "user" ? LT.sync.BadgeUser() : LT.sync.BadgeClient(),
						"fa-solid fa-user bbmm-badge"
					);

					// 🔁 sync toggle
					const isSynced = !!syncMap[id];
					const syncIcon = makeIcon(LT.sync.ToggleHint(), "fa-solid fa-arrows-rotate", true);
					if (isSynced) syncIcon.classList.add("bbmm-active");

					const toggleSync = (ev) => {
						try {
							ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

							const currentMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
							const already = !!currentMap[id];

							if (already) {
								delete currentMap[id];
								game.settings.set(BBMM_ID, "userSettingSync", currentMap).then(() => {
									syncIcon.classList.remove("bbmm-active");
									DL(`bbmm-setting-sync: removed ${id}`);
									bbmmBroadcastTrigger(); // trigger after write
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
									syncIcon.classList.add("bbmm-active");
									DL(`bbmm-setting-sync: added ${id}`, currentValue);
									bbmmBroadcastTrigger(); // trigger after write
								});
							}
						} catch (err) {
							DL(3, "bbmm-setting-sync(toggle): error", err);
							ui.notifications?.error?.(LT.sync.ToggleError());
						}
					};

					syncIcon.addEventListener("click", toggleSync);
					syncIcon.addEventListener("keydown", (e) => {
						if (e.key === "Enter" || e.key === " ") toggleSync(e);
					});

					attached++;
				}

				DL(`bbmm-setting-sync: decorate(): user/client found=${found}, bars attached=${attached}`);
			} catch (err) {
				DL(3, "bbmm-setting-sync: decorate(): error", err);
			}
		};

		// Paint now + a couple of retries; re-run on tab clicks (no observers)
		decorate();
		requestAnimationFrame(decorate);
		setTimeout(decorate, 50);
		setTimeout(decorate, 200);

		const tabBtns = form.querySelectorAll?.('nav.tabs [data-action="tab"]') || [];
		for (const btn of tabBtns) {
			btn.addEventListener("click", () => setTimeout(decorate, 0), { passive: true });
		}
	} catch (err) {
		DL(3, "bbmm-setting-sync: renderSettingsConfig(): error", err);
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
		// GM: inject CSS for the icons
		if (game.user?.isGM) {

            // Resnap current GM values into the sync map and broadcast immediately
            // (so connected players pick up changes even if GM is about to reload)
            bbmmResnapUserSync();
        
			const css = document.createElement("style");
			css.id = `${BBMM_ID}-sync-style`;
			css.textContent = `
				.bbmm-sync-icons { display:inline-flex; gap:.4rem; margin-left:.4rem; vertical-align:middle; }
				.bbmm-sync-icons .bbmm-badge { opacity:.85; }
				.bbmm-sync-icons .bbmm-click { cursor:pointer; opacity:.85; }
				.bbmm-sync-icons .bbmm-click:hover { opacity:1; transform: translateY(-1px); }
				.bbmm-sync-icons .bbmm-active { color: orange; }
			`;
			document.head.appendChild(css);
			DL("bbmm-setting-sync: injected CSS");
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
						DL(`bbmm-setting-sync: apply ${ent.namespace}.${ent.key} ->`, ent.value);
						await game.settings.set(ent.namespace, ent.key, ent.value);
						changed = true;
						if (ent.requiresReload || cfg.requiresReload) needsReload = true;
					}
				} catch (err) {
					DL(2, "bbmm-setting-sync: apply error", err);
				}
			}

			if (changed && needsReload) {
				try {
                    new foundry.applications.api.DialogV2({
                        window: { title: LT.sync.ReloadTitle(), modal: true },
                        content: `<p>${LT.sync.ReloadMsg()}</p>`,
                        buttons: [
                            { 
                                action: "reload", 
                                label: LT.sync.ReloadNow(), 
                                icon: "fa-solid fa-arrows-rotate",	// FA6
                                default: true,
                                callback: () => { 
                                    DL(`Sending refresh command`)
                                    try { location.reload(); } catch (e) { /* no-op */ } 
                                }
                            },
                            { 
                                action: "later", 
                                label: LT.sync.ReloadLater(), 
                                icon: "fa-regular fa-clock",
                                callback: () => {} 
                            }
                        ],
                        submit: () => {},			// match your other dialogs
                        rejectClose: false			// allow closing without calling submit
                    }).render(true);
                } catch (err) {
                    DL(2, "bbmm-setting-sync: could not show reload dialog", err);
                    ui.notifications?.warn?.(LT.sync.ReloadWarn());
                }
			} else if (changed) {
				ui.notifications?.info?.(LT.sync.Updated());
			}
		}

		// All clients: listen for live refresh triggers (always installed)
		if (game.socket) {
			game.socket.on(BBMM_SYNC_CH, async (msg) => {
				try {
					if (!msg || msg.t !== "bbmm-sync-refresh") return;
					if (game.user?.isGM) return; // GM doesn't need to apply

					DL("bbmm-setting-sync: received sync refresh trigger");

					const map = game.settings.get(BBMM_ID, "userSettingSync") || {};
					let changed = false, needsReload = false;

					for (const ent of Object.values(map)) {
						if (!ent || typeof ent.namespace !== "string" || typeof ent.key !== "string") continue;

						const id = `${ent.namespace}.${ent.key}`;
						const cfg = game.settings.settings.get(id);
						if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) continue;

						const current = game.settings.get(ent.namespace, ent.key);
						if (!objectsEqual(current, ent.value)) {
							DL(`bbmm-setting-sync: trigger apply ${id} ->`, ent.value);
							await game.settings.set(ent.namespace, ent.key, ent.value);
							changed = true;
							if (ent.requiresReload || cfg.requiresReload) needsReload = true;
						}
					}

					if (changed && needsReload) {
						try {
                            // resolve via your dynamic LT (with fallbacks)
                            const labelReload = LT.sync.ReloadNow?.() || "Reload Now";
                            const labelLater  = LT.sync.ReloadLater?.() || "Later";

                            new foundry.applications.api.DialogV2({
                                window: { title: LT.sync.ReloadTitle(), modal: true },
                                content: `<p>${LT.sync.ReloadMsg()}</p>`,
                                buttons: [
                                    { 
                                        action: "reload", 
                                        label: LT.sync.ReloadNow(), 
                                        icon: "fa-solid fa-arrows-rotate",	// FA6
                                        default: true,
                                        callback: () => { 
                                            DL(`Sending refresh command`)
                                            try { location.reload(); } catch (e) { /* no-op */ } 
                                        }
                                    },
                                    { 
                                        action: "later", 
                                        label: LT.sync.ReloadLater(), 
                                        icon: "fa-regular fa-clock",
                                        callback: () => {} 
                                    }
                                ],
                                submit: () => {},			// match your other dialogs
                                rejectClose: false			// allow closing without calling submit
                            }).render(true);
                        } catch (err) {
                            DL(2, "bbmm-setting-sync: could not show reload dialog", err);
                            ui.notifications?.warn?.(LT.sync.ReloadWarn());
                        }
					} else if (changed) {
						ui.notifications?.info?.(LT.sync.Updated());
					}
				} catch (err) {
					DL(2, "bbmm-setting-sync: trigger handler error", err);
				}
			});
		}
	} catch (err) {
		DL(3, "bbmm-setting-sync: ready(): error", err);
	}
});
