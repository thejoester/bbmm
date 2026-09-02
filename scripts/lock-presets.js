import { DL, BBMM_README_UUID } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_esc, hlp_injectHeaderHelpButton, hlp_saveJSONFile, hlp_pickLocalJSONFile, hlp_timestampStr } from "./helpers.js";

const LOCK_PRESETS_FILE   = "lock-presets.json";
const BBMM_SYNC_CH        = "module.bbmm";

let _lockPresetCache = null;

/* =======================================================================
	{FILE I/O}
======================================================================= */

async function _readLockPresets() {
	try {
		const res = await fetch(`bbmm-data/${LOCK_PRESETS_FILE}`, { cache: "no-store" });
		if (res.status === 404) return {};
		if (!res.ok) return null;
		return await res.json();
	} catch (err) {
		DL(2, "lock-presets.js | _readLockPresets(): failed", err);
		return null;
	}
}

async function _writeLockPresets(obj) {
	try {
		const payload = JSON.stringify(obj ?? {}, null, 2);
		const file = new File([payload], LOCK_PRESETS_FILE, { type: "application/json" });
		const res = await foundry.applications.apps.FilePicker.implementation.upload("data", "bbmm-data", file, { notify: false });
		if (!res?.path && !res?.url) {
			DL(3, "lock-presets.js | _writeLockPresets(): upload returned no path/url", res);
			return false;
		}
		return true;
	} catch (err) {
		DL(3, "lock-presets.js | _writeLockPresets(): failed", err);
		return false;
	}
}

/* =======================================================================
	{SERVICES}
======================================================================= */

async function svc_loadLockPresets(force = false) {
	if (!force && _lockPresetCache !== null) return _lockPresetCache;
	_lockPresetCache = null;
	const data = await _readLockPresets();
	_lockPresetCache = (data && typeof data === "object") ? data : {};
	return _lockPresetCache;
}

function svc_getLockPresets() {
	return (_lockPresetCache && typeof _lockPresetCache === "object") ? _lockPresetCache : {};
}

async function svc_setLockPresets(obj) {
	const clean = (obj && typeof obj === "object") ? obj : {};
	_lockPresetCache = clean;
	await _writeLockPresets(clean);
}

/* =======================================================================
	{IMPORT / EXPORT}
======================================================================= */

// export all lock presets to a .json file
export async function bbmm_exportLockPresetsAll() {
	const FN = "lock-presets.js | bbmm_exportLockPresetsAll():";
	try {
		const data = await svc_loadLockPresets(true);
		const payload = { type: "bbmm-lock-presets", version: 1, data: data ?? {} };
		await hlp_saveJSONFile(payload, `bbmm-lock-presets-${hlp_timestampStr()}.json`);
		DL(1, `${FN} exported lock presets`, { count: Object.keys(data ?? {}).length });
	} catch (err) {
		DL(3, `${FN} failed`, err);
		ui.notifications.error(`${LT.errors.errorOccured()}.`);
	}
}

// import lock presets (merge into existing, rename on name collision)
export async function bbmm_importLockPresetsAll() {
	const FN = "lock-presets.js | bbmm_importLockPresetsAll():";

	const file = await hlp_pickLocalJSONFile();
	if (!file) return;

	let parsed;
	try {
		parsed = JSON.parse(await file.text());
	} catch (err) {
		DL(3, `${FN} invalid json import file`, err);
		ui.notifications.error(`${LT.errors.invalidJSONFile()}.`);
		return;
	}

	// Accept either the wrapped envelope or a bare { [name]: preset } map
	let data;
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.type === "bbmm-lock-presets") {
		data = parsed.data;
	} else {
		data = parsed;
	}

	if (!data || typeof data !== "object" || Array.isArray(data)) {
		DL(3, `${FN} invalid import shape`, data);
		ui.notifications.error(`${LT.errors.invalidJSONFile()}.`);
		return;
	}

	// Load current presets so we MERGE instead of overwrite
	const current = { ...(await svc_loadLockPresets(true)) };

	const suffixBase = ` (imported ${hlp_timestampStr()})`;
	let added = 0;
	let renamed = 0;

	for (const [name, presetRaw] of Object.entries(data)) {
		if (!name || typeof name !== "string") continue;
		if (!presetRaw || typeof presetRaw !== "object" || Array.isArray(presetRaw)) continue;
		if (!Array.isArray(presetRaw.locks)) continue;

		let finalName = name;
		if (Object.prototype.hasOwnProperty.call(current, finalName)) {
			finalName = `${name}${suffixBase}`;
			renamed++;
			let i = 2;
			while (Object.prototype.hasOwnProperty.call(current, finalName)) {
				finalName = `${name}${suffixBase} (${i})`;
				i++;
			}
		}

		current[finalName] = presetRaw;
		added++;
	}

	await svc_setLockPresets(current);
	DL(1, `${FN} imported lock presets (merged)`, { added, renamed });
	let msg = LT.lockPresets.imported({ added });
	if (renamed) msg += LT.lockPresets.importedRenamed({ renamed });
	ui.notifications.info(msg);
}

/* Save current locks as a named preset (lock type only, no values) */
async function svc_saveCurrentLocksAsPreset(name, skipOverwriteConfirm = false) {
	const rawName = String(name ?? "").trim();
	if (!rawName) {
		ui.notifications.warn(`${LT.lockPresets.nameRequired()}.`);
		return { status: "cancel" };
	}

	const syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
	let locks = [];
	for (const [_id, entry] of Object.entries(syncMap)) {
		locks.push({
			namespace: entry.namespace,
			key:       entry.key,
			lockType:  entry.soft === true ? "soft" : "lock"
		});
	}

	// Check for locks belonging to modules that are no longer installed
	const _isUninstalled = (ns) =>
		ns !== "core" && ns !== (game.system?.id ?? "") && !game.modules.get(ns);
	const staleLocks = locks.filter(l => _isUninstalled(l.namespace));
	if (staleLocks.length) {
		const byNs = {};
		for (const l of staleLocks) byNs[l.namespace] = (byNs[l.namespace] ?? 0) + 1;
		const listHTML = Object.entries(byNs)
			.map(([ns, count]) => `<li><b>${hlp_esc(ns)}</b> (${count} lock${count !== 1 ? "s" : ""})</li>`)
			.join("");
		const staleChoice = await new Promise((resolve) => {
			new foundry.applications.api.DialogV2({
				window:      { title: LT.lockPresets.staleTitle(), modal: true },
				content:     `<p>${LT.lockPresets.staleFound()}</p><ul>${listHTML}</ul><p>${LT.lockPresets.staleQuestion()}</p>`,
				rejectClose: false,
				buttons: [
					{ action: "include",  label: LT.lockPresets.staleKeep(),     default: false, callback: () => resolve("include") },
					{ action: "skip",     label: LT.lockPresets.staleDontSave(), default: true,  callback: () => resolve("skip") },
					{ action: "purge",    label: LT.lockPresets.stalePurge(),    default: false, callback: () => resolve("purge") },
				],
				submit:  () => {},
				close:   () => resolve("skip"),
			}).render(true);
		});

		if (staleChoice === "skip" || staleChoice === "purge") {
			locks = locks.filter(l => !_isUninstalled(l.namespace));
		}
		if (staleChoice === "purge") {
			let syncMap = game.settings.get(BBMM_ID, "userSettingSync") || {};
			let revMap  = game.settings.get(BBMM_ID, "softLockRevMap")  || {};
			for (const l of staleLocks) {
				const id = `${l.namespace}.${l.key}`;
				delete syncMap[id];
				delete revMap[id];
			}
			await game.settings.set(BBMM_ID, "userSettingSync", syncMap);
			await game.settings.set(BBMM_ID, "softLockRevMap", revMap);
			if (game.socket) game.socket.emit(BBMM_SYNC_CH, { t: "bbmm-sync-refresh" });
		}
	}

	if (!locks.length) {
		ui.notifications.warn(`${LT.lockPresets.noActiveLocks()}.`);
		return { status: "cancel" };
	}

	if (!_lockPresetCache) await svc_loadLockPresets();
	const all = svc_getLockPresets();

	if (all[rawName] && !skipOverwriteConfirm) {
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window:     { title: LT.lockPresets.titleConfirmOverwrite() },
			content:    `<p>${LT.lockPresets.confirmOverwrite({ name: hlp_esc(rawName) })}</p>`,
			defaultYes: false,
			ok:         { label: LT.errors.overwrite() },
			cancel:     { label: LT.buttons.cancel() },
		});
		if (!confirmed) return { status: "cancel" };
	}

	const now      = Date.now();
	const existing = all[rawName];
	all[rawName]   = { created: existing?.created ?? now, updated: now, locks };

	await svc_setLockPresets(all);
	ui.notifications.info(`${LT.lockPresets.saved({ name: rawName, count: locks.length })}.`);
	return { status: "saved", name: rawName };
}

/* Apply a named preset: read current values, apply locks.
   Additive, only touches settings in the preset; existing locks remain. */
async function svc_applyLockPreset(name, wipeFirst = false) {
	const all    = svc_getLockPresets();
	const preset = all[name];
	if (!preset || !Array.isArray(preset.locks) || !preset.locks.length) {
		ui.notifications.warn(`${LT.lockPresets.noLocksInPreset()}.`);
		return;
	}

	const valid   = [];
	let   skipped = 0;
	for (const { namespace, key, lockType } of preset.locks) {
		const cfg = game.settings.settings.get(`${namespace}.${key}`);
		if (!cfg || (cfg.scope !== "user" && cfg.scope !== "client")) { skipped++; continue; }
		valid.push({ namespace, key, lockType });
	}

	if (!valid.length) {
		ui.notifications.warn(`${LT.lockPresets.allSkipped()}.`);
		return;
	}

	let map    = wipeFirst ? {} : (game.settings.get(BBMM_ID, "userSettingSync") || {});
	let revMap = game.settings.get(BBMM_ID, "softLockRevMap") || {};
	let revChanged = false;
	const softPushes = [];
	const hardPushes = [];

	for (const { namespace, key, lockType } of valid) {
		const id  = `${namespace}.${key}`;
		const cfg = game.settings.settings.get(id);
		let value;
		try {
			value = game.settings.get(namespace, key);
		} catch (err) {
			DL(2, `lock-presets.js | svc_applyLockPreset(): failed to read ${id}`, err);
			skipped++;
			continue;
		}

		if (lockType === "soft") {
			const currentRev = Number.isInteger(revMap[id]) ? revMap[id] : 0;
			const newRev = Math.max(Date.now(), currentRev + 1); // epoch-based monotonic rev
			map[id]          = { namespace, key, value, requiresReload: !!cfg.requiresReload, soft: true, rev: newRev };
			revMap[id]       = newRev;
			revChanged       = true;
			softPushes.push({ id, namespace, key, value, softRev: newRev, requiresReload: !!cfg.requiresReload });
		} else {
			map[id] = { namespace, key, value, requiresReload: !!cfg.requiresReload };
			hardPushes.push({ id, namespace, key, value, requiresReload: !!cfg.requiresReload });
		}
	}

	await game.settings.set(BBMM_ID, "userSettingSync", map);
	if (revChanged) await game.settings.set(BBMM_ID, "softLockRevMap", revMap);

	if (game.socket) {
		const nonGMIds = (game.users?.contents || []).filter(u => !u.isGM).map(u => u.id);

		// Refresh signal so players re-apply all hard locks
		setTimeout(() => game.socket.emit(BBMM_SYNC_CH, { t: "bbmm-sync-refresh" }), 300);

		// Immediate soft pushes (rev-aware on client)
		for (const p of softPushes) {
			game.socket.emit(BBMM_SYNC_CH, {
				t:            "bbmm-sync-push",
				soft:         true,
				softRev:      p.softRev,
				namespace:    p.namespace,
				key:          p.key,
				value:        p.value,
				targets:      nonGMIds,
				requiresReload: p.requiresReload,
			});
		}

		// Immediate hard pushes
		for (const p of hardPushes) {
			game.socket.emit(BBMM_SYNC_CH, {
				t:            "bbmm-sync-push",
				id:           p.id,
				namespace:    p.namespace,
				key:          p.key,
				value:        p.value,
				requiresReload: p.requiresReload,
				targets:      null,
			});
		}
	}

	const applied = valid.length - skipped;
	ui.notifications.info(`${LT.lockPresets.loaded({ name, count: applied, skipped })}.`);
}

async function svc_updateLockPreset(name) {
	return svc_saveCurrentLocksAsPreset(name, true);
}

async function svc_deleteLockPreset(name) {
	if (!_lockPresetCache) await svc_loadLockPresets();
	const all = svc_getLockPresets();
	if (!all[name]) return;
	delete all[name];
	await svc_setLockPresets(all);
	ui.notifications.info(`${LT.lockPresets.deleted({ name })}.`);
}

async function svc_renameLockPreset(oldName, newName) {
	const cleanNew = String(newName ?? "").trim();
	if (!cleanNew) return null;
	if (!_lockPresetCache) await svc_loadLockPresets();
	const all = svc_getLockPresets();
	if (!all[oldName]) return null;
	all[cleanNew] = { ...all[oldName], updated: Date.now() };
	delete all[oldName];
	await svc_setLockPresets(all);
	ui.notifications.info(`${LT.lockPresets.renamed({ name: cleanNew })}.`);
	return cleanNew;
}

/* =======================================================================
	{UI HELPERS}
======================================================================= */

function ui_promptRenameLockPreset(defaultName) {
	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: LT.lockPresets.titleRename(), modal: true },
			content: `
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">${LT.newName()}</label>
					<input name="newName" type="text" value="${hlp_esc(defaultName)}" autofocus style="flex:1;">
				</div>
			`,
			buttons: [
				{
					action:   "ok",
					label:    LT.buttons.save(),
					default:  true,
					callback: (_ev, btn) => resolve(btn.form.elements.newName?.value?.trim() || ""),
				},
				{
					action:   "cancel",
					label:    LT.buttons.cancel(),
					callback: () => resolve(null),
				},
			],
			submit:      () => {},
			rejectClose: false,
		}).render(true);
	});
}

/* =======================================================================
	{PREVIEW}
======================================================================= */

function ui_openLockPresetPreview(presetName) {
	try {
		const all    = svc_getLockPresets();
		const preset = all[presetName];
		if (!preset || !Array.isArray(preset.locks) || !preset.locks.length) {
			ui.notifications.warn(`${LT.lockPresets.noLocksInPreset()}.`);
			return;
		}

		const COL         = "160px 1fr 100px";
		const HEADER_STYLE = `display:grid;grid-template-columns:${COL};border-bottom:1px solid var(--color-border,#444);padding:.35rem .5rem;font-weight:600;font-size:12px;`;
		const ROW_STYLE    = `display:grid;grid-template-columns:${COL};align-items:start;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;`;
		const CELL_STYLE   = "padding:.25rem .4rem;min-width:0;overflow-wrap:break-word;";
		const HINT_STYLE   = "display:block;font-size:10px;opacity:.65;margin-top:.1rem;word-break:break-word;";
		const UNREG_STYLE  = "display:block;font-size:10px;opacity:.5;font-style:italic;";
		const BADGE_LOCK   = "display:inline-block;padding:.1em .5em;border-radius:3px;font-size:11px;background:rgba(200,80,80,.35);";
		const BADGE_SOFT   = "display:inline-block;padding:.1em .5em;border-radius:3px;font-size:11px;background:rgba(80,140,200,.35);";

		const body = preset.locks.map(({ namespace, key, lockType }) => {
			const id          = `${namespace}.${key}`;
			const cfg         = game.settings.settings.get(id);
			const settingName = cfg ? (game.i18n.localize(cfg.name) || key) : key;
			const hint        = cfg ? (game.i18n.localize(cfg.hint) || "") : "";
			const registered  = !!cfg;

			const nsLabel = game.modules.get(namespace)?.title
				?? (game.system?.id === namespace ? game.system.title : null)
				?? namespace;

			const nameCell = registered
				? `<span>${hlp_esc(settingName)}</span>${hint ? `<span style="${HINT_STYLE}">${hlp_esc(hint)}</span>` : ""}`
				: `<span style="opacity:.6;">${hlp_esc(key)}</span><span style="${UNREG_STYLE}">(${LT.lockPresets.unregistered()})</span>`;

			const badgeStyle = lockType === "soft" ? BADGE_SOFT : BADGE_LOCK;
			const badgeLabel = lockType === "soft" ? LT.lockPresets.typeSoft() : LT.lockPresets.typeLock();

			return `
				<div style="${ROW_STYLE}">
					<div style="${CELL_STYLE}">${hlp_esc(nsLabel)}</div>
					<div style="${CELL_STYLE}">${nameCell}</div>
					<div style="${CELL_STYLE}"><span style="${badgeStyle}">${hlp_esc(badgeLabel)}</span></div>
				</div>`;
		}).join("");

		const title   = LT.lockPresets.previewTitle({ name: presetName });
		const content = `
			<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.5rem;">
				<b>${hlp_esc(title)}</b>
				<span style="opacity:.7;">${preset.locks.length} ${LT.lockPresets.colCount().toLowerCase()}</span>
			</div>
			<div style="border:1px solid var(--color-border,#444);border-radius:6px;overflow:hidden;">
				<div style="${HEADER_STYLE}">
					<div>${hlp_esc(LT.lockPresets.colNamespace())}</div>
					<div>${hlp_esc(LT.lockPresets.colSetting())}</div>
					<div>${hlp_esc(LT.lockPresets.colLockType())}</div>
				</div>
				<div style="overflow-y:auto;max-height:36vh;">${body}</div>
			</div>`;

		new foundry.applications.api.DialogV2({
			id:       "bbmm-lock-preset-preview",
			window:   { title },
			position: { width: 780 },
			content,
			buttons: [{ action: "close", label: LT.buttons.close(), default: true }],
			submit:  () => "close",
		}).render(true);

	} catch (err) {
		DL(3, "lock-presets.js | ui_openLockPresetPreview(): failed", err);
	}
}

/* =======================================================================
	{MAIN OPENER}
======================================================================= */

export async function openLockPresetManager() {
	globalThis.bbmm?.openBBMMToolbox?.({ tool: "lockPresets" });
}

// Toolbox pane: Lock Presets (migrated from the openLockPresetManager DialogV2).
async function mountLockPresets(container) {
	const root = container;

	const rerender = async () => {
		await svc_loadLockPresets(true);
		const presets = svc_getLockPresets();
		const list    = Object.entries(presets)
			.map(([name, preset]) => ({ name, preset }))
			.sort((a, b) => a.name.localeCompare(b.name));

		const rows = list.length
			? list.map(({ name, preset }) => `
				<tr style="border-bottom:1px solid rgba(255,255,255,.06);">
					<td style="padding:.25rem .5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hlp_esc(name)}</td>
					<td style="width:4rem;text-align:center;padding:.25rem .5rem;">${Array.isArray(preset.locks) ? preset.locks.length : 0}</td>
					<td style="padding:.25rem .5rem;">
						<div style="display:flex;gap:.25rem;justify-content:flex-end;">
							<button type="button" data-action="preview" data-preset-name="${hlp_esc(name)}">${LT.buttons.preview()}</button>
							<button type="button" data-action="load"    data-preset-name="${hlp_esc(name)}">${LT.buttons.load()}</button>
							<button type="button" data-action="update"  data-preset-name="${hlp_esc(name)}">${LT.buttons.update()}</button>
							<button type="button" data-action="rename"  data-preset-name="${hlp_esc(name)}">${LT.errors.rename()}</button>
							<button type="button" data-action="delete"  data-preset-name="${hlp_esc(name)}">${LT.buttons.delete()}</button>
						</div>
					</td>
				</tr>
			`).join("")
			: `<tr><td colspan="3" style="text-align:center;font-style:italic;padding:.5rem;">${LT.lockPresets.noPresets()}</td></tr>`;

		const content = `
			<section style="width:100%;display:flex;flex-direction:column;gap:.75rem;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<input name="newPresetName" type="text"
						placeholder="${hlp_esc(LT.lockPresets.namePlaceholder())}"
						style="flex:1;">
					<button type="button" data-action="save-current">${LT.lockPresets.saveBtnLabel()}</button>
				</div>
				<div style="overflow-y:auto;max-height:35vh;">
					<table style="width:100%;border-collapse:collapse;">
						<thead style="position:sticky;top:0;background:var(--color-bg,#1a1a1a);z-index:1;">
							<tr style="border-bottom:1px solid var(--color-border-dark-5);">
								<th style="text-align:left;padding:.25rem .5rem;">${LT.lockPresets.colName()}</th>
								<th style="width:4rem;text-align:center;padding:.25rem .5rem;">${LT.lockPresets.colCount()}</th>
								<th></th>
							</tr>
						</thead>
						<tbody>${rows}</tbody>
					</table>
				</div>
				<p style="font-size:.85em;color:var(--color-text-light-7);margin:0;">${LT.lockPresets.footerNote()}</p>
			</section>
		`;

		container.innerHTML = content;
	};

	// Single delegated click handler (bound once).
	container.addEventListener("click", async (ev) => {
				const btn = ev.target;
				if (!(btn instanceof HTMLButtonElement)) return;
				const action = btn.dataset.action;
				if (!["save-current", "preview", "load", "update", "rename", "delete"].includes(action)) return;
				ev.preventDefault();
				ev.stopImmediatePropagation();

				const presetName = btn.dataset.presetName ?? "";

				if (action === "save-current") {
					const nameInput = root.querySelector('input[name="newPresetName"]');
					const inputVal  = nameInput ? String(nameInput.value ?? "").trim() : "";
					const res       = await svc_saveCurrentLocksAsPreset(inputVal);
					if (res?.status === "saved") rerender();
					return;
				}

				if (action === "preview") {
					ui_openLockPresetPreview(presetName);
					return;
				}

				if (action === "load") {
					const { confirmed, clearFirst } = await new Promise((resolve) => {
						new foundry.applications.api.DialogV2({
							window:      { title: LT.lockPresets.titleConfirmLoad(), modal: true },
							content:     `
								<p>${LT.lockPresets.confirmLoad({ name: hlp_esc(presetName) })}</p>
								<label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;margin-top:.5rem;">
									<input type="checkbox" name="clearFirst">
									${LT.lockPresets.clearBeforeApply()}
								</label>
							`,
							buttons: [
								{
									action:   "ok",
									label:    LT.buttons.apply(),
									default:  false,
									callback: (_ev, btn) => resolve({ confirmed: true, clearFirst: !!btn.form?.elements?.clearFirst?.checked }),
								},
								{
									action:   "cancel",
									label:    LT.buttons.cancel(),
									default:  true,
									callback: () => resolve({ confirmed: false, clearFirst: false }),
								},
							],
							submit:      () => {},
							rejectClose: false,
							close:       () => resolve({ confirmed: false, clearFirst: false }),
						}).render(true);
					});
					if (!confirmed) return;
					await svc_applyLockPreset(presetName, clearFirst);
					return;
				}

				if (action === "update") {
					const confirmed = await foundry.applications.api.DialogV2.confirm({
						window:     { title: LT.lockPresets.titleConfirmUpdate() },
						content:    `<p>${LT.lockPresets.confirmUpdate({ name: hlp_esc(presetName) })}</p>`,
						defaultYes: false,
						ok:         { label: LT.buttons.update() },
						cancel:     { label: LT.buttons.cancel() },
					});
					if (!confirmed) return;
					const res = await svc_updateLockPreset(presetName);
					if (res?.status === "saved") rerender();
					return;
				}

				if (action === "rename") {
					const newName = await ui_promptRenameLockPreset(presetName);
					if (!newName) return;
					await svc_renameLockPreset(presetName, newName);
					rerender();
					return;
				}

				if (action === "delete") {
					const confirmed = await foundry.applications.api.DialogV2.confirm({
						window:     { title: LT.lockPresets.titleConfirmDelete() },
						content:    `<p>${LT.lockPresets.confirmDelete({ name: hlp_esc(presetName) })}</p>`,
						defaultYes: false,
						ok:         { label: LT.buttons.delete() },
						cancel:     { label: LT.buttons.cancel() },
					});
					if (!confirmed) return;
					await svc_deleteLockPreset(presetName);
					rerender();
					return;
				}
			});

	await rerender();
}

/* Register on globalThis.bbmm ========================================= */
Hooks.once("init", () => {
	globalThis.bbmm ??= {};
	Object.assign(globalThis.bbmm, { openLockPresetManager, bbmm_exportLockPresetsAll, bbmm_importLockPresetsAll });
});

// Register the Lock Presets pane as a toolbox tool.
globalThis.bbmm ??= {};
globalThis.bbmm.toolboxTools ??= [];
globalThis.bbmm.toolboxTools.push({
	id: "lockPresets",
	icon: "fa-solid fa-layer-group",
	label: () => LT.toolbox.tabLockPresets(),
	visible: () => game.user.isGM,
	group: null,
	mount: async (container) => { await mountLockPresets(container); }
});
