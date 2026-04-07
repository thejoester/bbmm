/* BBMM: Manage Modules list restyle ===========================================
   	- Hook: renderModuleManagement
	- Goals:
		• Make each module entry a compact, cardlike row (similar to changelog left column)
		• Whole row visually selectable (does not toggle enable/disable yet)
		• Keep this purely presentational (no core behavior changes)
============================================================================== */
import { DL, BBMM_README_UUID, injectBBMMHeaderButton, openTagManager as _openTagManagerFromSettings } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_esc, hlp_injectHeaderHelpButton } from "./helpers.js";

// ── Tag data helpers ──────────────────────────────────────────────────────────

const TAGS_DEFAULT = { tags: [], subtags: [], assignments: {} };
const TAGS_FILE  = "module-tags.json";
const NOTES_FILE = "module-notes.json";

// ── in-memory caches (null = not yet loaded) ──────────────────────────────────
let _tagsCache  = null;   // { tags, subtags, assignments }
let _notesCache = null;   // { [moduleId]: htmlString }

// ── shared low-level read/write ───────────────────────────────────────────────

async function _bbmmFetchJSON(filename) {
	try {
		const browse = await FilePicker.browse("data", "bbmm-data", { extensions: ["json"] });
		const match = (browse?.files ?? []).find(f => String(f).endsWith(`/${filename}`));
		if (match) {
			const res = await fetch(match, { cache: "no-store" });
			if (res.ok) return await res.json();
		}
	} catch (e) {
		const msg = String(e?.message ?? e);
		if (!msg.includes("does not exist") && !msg.includes("not accessible"))
			DL(2, `module-management.js | _bbmmFetchJSON(${filename}): browse failed`, e);
	}
	// fallback direct fetch
	try {
		const url = foundry.utils.getRoute(`bbmm-data/${filename}`);
		const res = await fetch(url, { cache: "no-store" });
		if (res.ok) return await res.json();
	} catch (_) { /* file not yet created */ }
	return null;
}

async function _bbmmWriteJSON(filename, data) {
	const payload = JSON.stringify(data ?? {}, null, 2);
	const file = new File([payload], filename, { type: "application/json" });
	try {
		await FilePicker.upload("data", "bbmm-data", file, { notify: false });
		return true;
	} catch (e) {
		DL(3, `module-management.js | _bbmmWriteJSON(${filename}): upload failed`, e);
		return false;
	}
}

// ── tag data ──────────────────────────────────────────────────────────────────

export async function loadTagData() {
	try {
		const raw = await _bbmmFetchJSON(TAGS_FILE);
		_tagsCache = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : foundry.utils.duplicate(TAGS_DEFAULT);
		_tagsCache.tags      ??= [];
		_tagsCache.subtags   ??= [];
		_tagsCache.assignments ??= {};
		DL(`module-management.js | loadTagData(): loaded (${_tagsCache.tags.length} tags)`);
	} catch (e) {
		DL(3, "module-management.js | loadTagData(): failed", e);
		_tagsCache = foundry.utils.duplicate(TAGS_DEFAULT);
	}
}

function _getTagData() {
	if (_tagsCache === null) {
		DL(2, "module-management.js | _getTagData(): cache not loaded, returning default");
		return foundry.utils.duplicate(TAGS_DEFAULT);
	}
	return foundry.utils.duplicate(_tagsCache);
}

async function _saveTagData(data) {
	data.tags?.sort((a, b) => a.label.localeCompare(b.label));
	data.subtags?.sort((a, b) => a.label.localeCompare(b.label));
	_tagsCache = foundry.utils.duplicate(data);
	await _bbmmWriteJSON(TAGS_FILE, data);
}

// ── notes data ────────────────────────────────────────────────────────────────

export async function loadNotesData() {
	try {
		const raw = await _bbmmFetchJSON(NOTES_FILE);
		_notesCache = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
		DL(`module-management.js | loadNotesData(): loaded (${Object.keys(_notesCache).length} entries)`);
	} catch (e) {
		DL(3, "module-management.js | loadNotesData(): failed", e);
		_notesCache = {};
	}
}

function _getNotesData() {
	if (_notesCache === null) {
		DL(2, "module-management.js | _getNotesData(): cache not loaded, returning empty");
		return {};
	}
	return foundry.utils.duplicate(_notesCache);
}

async function _saveNotesData(notes) {
	_notesCache = foundry.utils.duplicate(notes);
	await _bbmmWriteJSON(NOTES_FILE, notes);
}

function _slugify(str) {
	return str.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function _uniqueSlug(base, existingIds) {
	if (!existingIds.includes(base)) return base;
	let n = 2;
	while (existingIds.includes(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/* Return true if the module has at least one configurable setting (config === true). */
function _bbmmModuleHasConfigSettings(modId) {
	try {
		if (!modId) return false;
		for (const [fullKey, cfg] of game.settings.settings) {
			// keys look like "<moduleId>.<settingKey>"
			if (!fullKey?.startsWith(`${modId}.`)) continue;
			if (cfg?.config === true) return true;
		}
		return false;
	} catch (err) {
		DL(3, `_bbmmModuleHasConfigSettings(): error for ${modId}`, err);
		return false;
	}
}

/* 	Open the Configure Settings sheet and focus the specific module tab. */
async function _bbmmOpenModuleSettingsTab(modId) {	
	try {
		const mod = game.modules.get(modId);
		if (!mod) {
			DL(2, `_bbmmOpenModuleSettingsTab(): module not found ${modId}`);
			return;
		}
		if (!_bbmmModuleHasConfigSettings(modId)) {
			ui.notifications.warn(LT.noSettingsFoundFor({ title: mod.title ?? modId }));
			DL(2, `_bbmmOpenModuleSettingsTab(): no configurable settings for ${modId}`);
			return;
		}

		const app = new SettingsConfig();

		// Render and then poll the global document for the tab button
		app.render(true);

		// Poll up to ~600ms (12 * 50ms) for the tab button to exist, then click it.
		let tries = 12;
		const tryFocus = () => {
			try {
				const btn = document.querySelector(`.tabs button[data-tab="${modId}"]`);
				if (btn) {
					btn.click();
					ui.notifications.info(LT.openedSettingsFor({ title: mod.title ?? modId }));
					DL(`_bbmmOpenModuleSettingsTab(): focused settings for ${modId}`);
					return;
				}
			} catch (e) {
				DL(2, `_bbmmOpenModuleSettingsTab(): tab lookup error for ${modId}`, e);
			}
			if (--tries > 0) {
				setTimeout(tryFocus, 50);
			} else {
				ui.notifications.warn(LT.noSettingsFoundFor({ title: mod.title ?? modId }));
				DL(2, `_bbmmOpenModuleSettingsTab(): tab button not found for ${modId} after polling`);
			}
		};

		// Small initial delay
		setTimeout(tryFocus, 300);
	} catch (err) {
		DL(3, "_bbmmOpenModuleSettingsTab(): error", err);
	}
}

/* Render saved notes HTML for display in the expanded panel */
async function _bbmmRenderSavedNotesHTML(moduleId) {
	try {
		const all = _getNotesData();
		const raw = _bbmmExtractEditorContent(all[moduleId] || "").trim();

		// If we have user notes, those take priority.
		if (raw) {
			try {
				const html = await TextEditor.enrichHTML(raw, { async: true, secrets: false });
				return html || raw;
			} catch (e) {
				DL(2, "_bbmmRenderSavedNotesHTML(): enrichHTML failed; using raw", e);
				return raw;
			}
		}

		// No user note — fall back to module description if available.
		const desc = _bbmmGetModuleDescription(moduleId).trim();
		if (!desc) return "";

		try {
			const html = await TextEditor.enrichHTML(desc, { async: true, secrets: false });
			return html || desc;
		} catch (e) {
			DL(2, "_bbmmRenderSavedNotesHTML(): enrichHTML(desc) failed; using raw", e);
			return desc;
		}
	} catch (err) {
		DL(3, "_bbmmRenderSavedNotesHTML(): error", err);
		return "";
	}
}

/* Get the module description from various possible sources */
function _bbmmGetModuleDescription(moduleId) {
	try {
		const mod = game.modules.get(moduleId);
		if (!mod) return "";

		// Prefer direct property, then manifest, then metadata, then legacy data
		let desc =
			mod.description ??
			mod?.manifest?.description ??
			mod?.metadata?.description ??
			mod?.data?.description ?? // legacy fallback
			"";

		// Some manifests put markdown or HTML here; return as-is.
		if (typeof desc !== "string") desc = String(desc ?? "");
		return desc;
	} catch (e) {
		DL(2, "_bbmmGetModuleDescription(): failed", e);
		return "";
	}
}

/* Extract just the editor content HTML from whatever we have saved */
function _bbmmExtractEditorContent(html) {
    try {
        if (!html) return "";
        if (!html.includes("editor-menu") && !html.includes("ProseMirror")) return html.trim();
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        const pm = tmp.querySelector(".ProseMirror");
        if (pm) return pm.innerHTML.trim();
        tmp.querySelectorAll("menu.editor-menu, .editor-prosemirror, .editor").forEach(el => el.remove());
        return tmp.innerHTML.trim();
    } catch { return html || ""; }
}

/* Determine if the given HTML is effectively empty (no visible content) */
function _bbmmIsEmptyNoteHTML(html) {
	try {
		if (!html) return true;
		let s = String(html);

		// Normalize whitespace
		s = s.replace(/\s+/g, " ");

		// Drop ProseMirror trailing breaks
		s = s.replace(/<br[^>]*class=["']?ProseMirror-trailingBreak["']?[^>]*>/gi, "");

		// Drop generic <br>, &nbsp;, zero-width, and whitespace
		s = s.replace(/<br\s*\/?>/gi, "")
			.replace(/&nbsp;/gi, " ")
			.replace(/[\u200B-\u200D\uFEFF]/g, " ")
			.trim();

		// Remove empty paragraph/div blocks (including nested empties)
		// e.g., <p> </p>, <div><br></div>, etc.
		let prev;
		do {
			prev = s;
			s = s.replace(/<(p|div)>\s*<\/\1>/gi, "");
			s = s.replace(/<(p|div)>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, "");
		} while (s !== prev);

		// If nothing left or only bare tags without visible text, consider empty
		// Strip all tags and inspect remaining text
		const textOnly = s.replace(/<[^>]*>/g, "").trim();
		return textOnly.length === 0;
	} catch (e) {
		DL(2, "_bbmmIsEmptyNoteHTML(): error while normalizing", e);
		// Fail-safe: don’t treat as empty on error
		return false;
	}
}

// ── BBMMTagManagerApp ─────────────────────────────────────────────────────────

class BBMMTagManagerApp extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-tag-manager",
			window: { title: LT.moduleManagement.tagMgrTitle(), resizable: true },
			position: { width: 560, height: 500 }
		});
	}

	async _renderHTML() {
		const data = _getTagData();
		const noTags = !data.tags.length;
		let tagsHTML = noTags
			? `<p class="bbmm-tag-empty">${hlp_esc(LT.moduleManagement.tagMgrNoTags())}</p>`
			: data.tags.map(tag => {
				const subs = data.subtags.filter(s => s.tagId === tag.id);
				const subsHTML = subs.map(sub => `
					<div class="bbmm-subtag-row" data-subtag-id="${hlp_esc(sub.id)}">
						<span class="bbmm-subtag-label"><i class="fa-solid fa-circle-dot fa-xs"></i> ${hlp_esc(sub.label)}</span>
						<button type="button" class="bbmm-bulk-assign" data-tag-id="${hlp_esc(tag.id)}" data-subtag-id="${hlp_esc(sub.id)}" title="${hlp_esc(LT.moduleManagement.tagMgrAssignToModules())}"><i class="fa-solid fa-plus"></i></button>
						<button type="button" class="bbmm-subtag-rename" data-subtag-id="${hlp_esc(sub.id)}" title="Rename">${hlp_esc(LT.errors.rename())}</button>
						<button type="button" class="bbmm-subtag-delete" data-subtag-id="${hlp_esc(sub.id)}" title="Delete"><i class="fa-solid fa-xmark"></i></button>
					</div>
				`).join("");
				return `
					<div class="bbmm-tag-block" data-tag-id="${hlp_esc(tag.id)}">
						<div class="bbmm-tag-row">
							<span class="bbmm-tag-label"><i class="fa-solid fa-tag fa-sm"></i> ${hlp_esc(tag.label)}</span>
							<button type="button" class="bbmm-bulk-assign" data-tag-id="${hlp_esc(tag.id)}" title="${hlp_esc(LT.moduleManagement.tagMgrAssignToModules())}"><i class="fa-solid fa-plus"></i></button>
							<button type="button" class="bbmm-tag-rename" data-tag-id="${hlp_esc(tag.id)}" title="Rename">${hlp_esc(LT.errors.rename())}</button>
							<button type="button" class="bbmm-tag-delete" data-tag-id="${hlp_esc(tag.id)}" title="Delete"><i class="fa-solid fa-xmark"></i></button>
						</div>
						${subsHTML}
						<div class="bbmm-subtag-add-row">
							<input type="text" class="bbmm-subtag-input" data-tag-id="${hlp_esc(tag.id)}" placeholder="${hlp_esc(LT.moduleManagement.tagMgrSubtagPlaceholder())}">
							<button type="button" class="bbmm-subtag-add-btn" data-tag-id="${hlp_esc(tag.id)}">${hlp_esc(LT.moduleManagement.tagMgrAddSubtag())}</button>
						</div>
					</div>
				`;
			}).join("");

		const root = document.createElement("div");
		root.className = "bbmm-tag-manager-content";
		root.innerHTML = `
			<div class="bbmm-tag-list">${tagsHTML}</div>
			<div class="bbmm-tag-add-row">
				<input type="text" id="bbmm-tag-input" placeholder="${hlp_esc(LT.moduleManagement.tagMgrTagPlaceholder())}">
				<button type="button" id="bbmm-tag-add-btn">${hlp_esc(LT.moduleManagement.tagMgrAddTag())}</button>
			</div>
		`;
		return root;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
		this._attachListeners(result);
	}

	_attachListeners(content) {
		// Add tag (button or Enter)
		const tagInput = content.querySelector("#bbmm-tag-input");
		content.querySelector("#bbmm-tag-add-btn")?.addEventListener("click", () => this._addTag(tagInput));
		tagInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this._addTag(tagInput); }});

		// Tag: rename / delete
		content.addEventListener("click", async (ev) => {
			const bulkBtn = ev.target.closest?.(".bbmm-bulk-assign[data-tag-id]");
			if (bulkBtn) return openBulkTagAssignApp(bulkBtn.dataset.tagId, bulkBtn.dataset.subtagId || undefined);

			const renameBtn = ev.target.closest?.(".bbmm-tag-rename[data-tag-id]");
			if (renameBtn) return this._renameTag(renameBtn.dataset.tagId);

			const deleteBtn = ev.target.closest?.(".bbmm-tag-delete[data-tag-id]");
			if (deleteBtn) return this._deleteTag(deleteBtn.dataset.tagId);

			const addSubBtn = ev.target.closest?.(".bbmm-subtag-add-btn[data-tag-id]");
			if (addSubBtn) {
				const input = content.querySelector(`.bbmm-subtag-input[data-tag-id="${addSubBtn.dataset.tagId}"]`);
				return this._addSubtag(addSubBtn.dataset.tagId, input);
			}

			const renameSubBtn = ev.target.closest?.(".bbmm-subtag-rename[data-subtag-id]");
			if (renameSubBtn) return this._renameSubtag(renameSubBtn.dataset.subtagId);

			const deleteSubBtn = ev.target.closest?.(".bbmm-subtag-delete[data-subtag-id]");
			if (deleteSubBtn) return this._deleteSubtag(deleteSubBtn.dataset.subtagId);
		});

		// Subtag: add on Enter
		content.querySelectorAll(".bbmm-subtag-input").forEach(input => {
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); this._addSubtag(input.dataset.tagId, input); }
			});
		});
	}

	async _addTag(input) {
		const label = input?.value?.trim();
		if (!label) return;
		const data = _getTagData();
		const id = _uniqueSlug(_slugify(label), data.tags.map(t => t.id));
		data.tags.push({ id, label });
		await _saveTagData(data);
		input.value = "";
		this.render();
	}

	async _renameTag(tagId) {
		const data = _getTagData();
		const tag = data.tags.find(t => t.id === tagId);
		if (!tag) return;
		const val = await foundry.applications.api.DialogV2.prompt({
			window: { title: LT.moduleManagement.tagMgrRenameTag() },
			content: `<input type="text" name="label" value="${hlp_esc(tag.label)}" style="width:100%">`,
			ok: { label: LT.buttons.save(), callback: (_ev, btn) => btn.form?.elements?.label?.value?.trim() ?? "" }
		});
		if (!val || val === tag.label) return;
		tag.label = val;
		await _saveTagData(data);
		this.render();
		_bbmmRefreshModuleManagerApp();
	}

	async _deleteTag(tagId) {
		const data = _getTagData();
		const tag = data.tags.find(t => t.id === tagId);
		if (!tag) return;
		const subCount = data.subtags.filter(s => s.tagId === tagId).length;
		const confirm = await foundry.applications.api.DialogV2.confirm({
			window: { title: LT.moduleManagement.tagMgrDeleteTagTitle() },
			content: `<p>${hlp_esc(LT.moduleManagement.tagMgrDeleteTagConfirm({ label: tag.label, subtags: subCount }))}</p>`
		});
		if (!confirm) return;
		data.tags = data.tags.filter(t => t.id !== tagId);
		data.subtags = data.subtags.filter(s => s.tagId !== tagId);
		for (const [modId, arr] of Object.entries(data.assignments)) {
			data.assignments[modId] = arr.filter(a => a.tagId !== tagId);
			if (!data.assignments[modId].length) delete data.assignments[modId];
		}
		await _saveTagData(data);
		this.render();
		_bbmmRefreshModuleManagerApp();
	}

	async _addSubtag(tagId, input) {
		const label = input?.value?.trim();
		if (!label) return;
		const data = _getTagData();
		const id = _uniqueSlug(_slugify(label), data.subtags.map(s => s.id));
		data.subtags.push({ id, label, tagId });
		await _saveTagData(data);
		input.value = "";
		this.render();
	}

	async _renameSubtag(subtagId) {
		const data = _getTagData();
		const sub = data.subtags.find(s => s.id === subtagId);
		if (!sub) return;
		const val = await foundry.applications.api.DialogV2.prompt({
			window: { title: LT.moduleManagement.tagMgrRenameSubtag() },
			content: `<input type="text" name="label" value="${hlp_esc(sub.label)}" style="width:100%">`,
			ok: { label: LT.buttons.save(), callback: (_ev, btn) => btn.form?.elements?.label?.value?.trim() ?? "" }
		});
		if (!val || val === sub.label) return;
		sub.label = val;
		await _saveTagData(data);
		this.render();
		_bbmmRefreshModuleManagerApp();
	}

	async _deleteSubtag(subtagId) {
		const data = _getTagData();
		const sub = data.subtags.find(s => s.id === subtagId);
		if (!sub) return;
		const confirm = await foundry.applications.api.DialogV2.confirm({
			window: { title: LT.moduleManagement.tagMgrDeleteSubtagTitle() },
			content: `<p>${hlp_esc(LT.moduleManagement.tagMgrDeleteSubtagConfirm({ label: sub.label }))}</p>`
		});
		if (!confirm) return;
		data.subtags = data.subtags.filter(s => s.id !== subtagId);
		// Demote assignments: remove subtagId reference, keep tagId
		for (const [modId, arr] of Object.entries(data.assignments)) {
			data.assignments[modId] = arr.map(a =>
				a.subtagId === subtagId ? { tagId: a.tagId } : a
			);
		}
		await _saveTagData(data);
		this.render();
		_bbmmRefreshModuleManagerApp();
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		try { injectBBMMHeaderButton(this.element); } catch (e) { DL(2, "BBMMTagManagerApp | header button inject failed", e); }
	}
}

// ── BBMMModuleTagsApp ─────────────────────────────────────────────────────────

class BBMMModuleTagsApp extends foundry.applications.api.ApplicationV2 {
	constructor(moduleId) {
		super({
			id: `bbmm-module-tags-${moduleId}`,
			window: { title: `${LT.moduleManagement.editTags()} — ${game.modules.get(moduleId)?.title ?? moduleId}`, resizable: false },
			position: { width: 440, height: "auto" }
		});
		this.moduleId = moduleId;
	}

	async _renderHTML() {
		const data = _getTagData();
		const root = document.createElement("div");
		root.className = "bbmm-module-tags-content";

		// No-tags empty state
		if (!data.tags.length) {
			root.innerHTML = `
				<div class="bbmm-module-tags-empty">
					<p>${hlp_esc(LT.moduleManagement.tagMgrNoTags())}</p>
					<button type="button" id="bbmm-mt-open-manager">${hlp_esc(LT.moduleManagement.tagMgrOpenTagManager())}</button>
				</div>
			`;
			return root;
		}

		const assignments = data.assignments[this.moduleId] ?? [];

		// Current assignment chips
		const chipsHTML = assignments.length
			? assignments.map((a, idx) => {
				const tag = data.tags.find(t => t.id === a.tagId);
				const sub = a.subtagId ? data.subtags.find(s => s.id === a.subtagId) : null;
				const label = sub ? `${tag?.label ?? a.tagId} / ${sub.label}` : (tag?.label ?? a.tagId);
				return `<span class="bbmm-tag-chip">
					${hlp_esc(label)}
					<button type="button" class="bbmm-chip-remove" data-idx="${idx}" title="Remove"><i class="fa-solid fa-xmark fa-xs"></i></button>
				</span>`;
			}).join("")
			: `<span class="bbmm-tag-none">${hlp_esc(LT.moduleManagement.tagMgrNoTags())}</span>`;

		// Tag dropdown (alphabetical)
		const sortedTags = [...data.tags].sort((a, b) => a.label.localeCompare(b.label));
		const tagOptions = sortedTags.map(t =>
			`<option value="${hlp_esc(t.id)}">${hlp_esc(t.label)}</option>`
		).join("");

		// Subtag options sorted alphabetically within each tag group
		const sortedSubtags = [...data.subtags].sort((a, b) => a.label.localeCompare(b.label));
		const allSubtagOptions = sortedSubtags.map(s =>
			`<option value="${hlp_esc(s.id)}" data-tag-id="${hlp_esc(s.tagId)}">${hlp_esc(s.label)}</option>`
		).join("");

		root.innerHTML = `
			<div class="bbmm-chip-list">${chipsHTML}</div>
			<hr>
			<div class="bbmm-tag-add-form">
				<label>${hlp_esc(LT.moduleManagement.tagMgrAddTag())}:</label>
				<div class="bbmm-tag-selects">
					<select id="bbmm-mt-tag">${tagOptions}</select>
					<select id="bbmm-mt-subtag"><option value="">${hlp_esc(LT.moduleManagement.tagMgrSubtagNone())}</option>${allSubtagOptions}</select>
					<button type="button" id="bbmm-mt-add">${hlp_esc(LT.buttons.add())}</button>
				</div>
			</div>
		`;
		return root;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
		this._attachListeners(result);
	}

	_attachListeners(content) {
		// Empty state: open tag manager button
		content.querySelector("#bbmm-mt-open-manager")?.addEventListener("click", () => {
			openTagManager();
		});

		// Filter subtag dropdown when tag changes
		const tagSel = content.querySelector("#bbmm-mt-tag");
		const subSel = content.querySelector("#bbmm-mt-subtag");
		const filterSubs = () => {
			if (!tagSel || !subSel) return;
			const tagId = tagSel.value;
			for (const opt of subSel.querySelectorAll("option")) {
				if (!opt.value) continue; // keep (none)
				opt.hidden = opt.dataset.tagId !== tagId;
			}
			// Reset to (none) if current selection is now hidden
			if (subSel.selectedOptions[0]?.hidden) subSel.value = "";
		};
		tagSel?.addEventListener("change", filterSubs);
		filterSubs();

		// Add assignment
		content.querySelector("#bbmm-mt-add")?.addEventListener("click", () => {
			const tagId = tagSel?.value;
			const subtagId = subSel?.value || undefined;
			if (!tagId) return;
			this._addAssignment(tagId, subtagId);
		});

		// Remove assignment chip
		content.addEventListener("click", (ev) => {
			const btn = ev.target.closest?.(".bbmm-chip-remove[data-idx]");
			if (!btn) return;
			this._removeAssignment(parseInt(btn.dataset.idx, 10));
		});
	}

	async _addAssignment(tagId, subtagId) {
		const data = _getTagData();
		const arr = data.assignments[this.moduleId] ?? [];
		// Skip duplicate
		const isDupe = arr.some(a => a.tagId === tagId && (a.subtagId ?? undefined) === (subtagId ?? undefined));
		if (!isDupe) {
			arr.push(subtagId ? { tagId, subtagId } : { tagId });
			data.assignments[this.moduleId] = arr;
			await _saveTagData(data);
		}
		this.render();
		_bbmmRefreshModuleManagerApp();
	}

	async _removeAssignment(idx) {
		const data = _getTagData();
		const arr = data.assignments[this.moduleId] ?? [];
		arr.splice(idx, 1);
		if (arr.length) data.assignments[this.moduleId] = arr;
		else delete data.assignments[this.moduleId];
		await _saveTagData(data);
		this.render();
		_bbmmRefreshModuleManagerApp();
	}

	async _renderFrame(options) {
		const frame = await super._renderFrame(options);
		const footer = document.createElement("footer");
		footer.className = "bbmm-module-tags-footer";
		footer.innerHTML = `<button type="button" id="bbmm-mt-close">${hlp_esc(LT.buttons.close())}</button>`;
		frame.appendChild(footer);
		footer.querySelector("#bbmm-mt-close")?.addEventListener("click", () => {
			this.close();
			// Return focus to the notes dialog for this module if it's still open
			try {
				const notesDlg = foundry.applications.instances.get(`bbmm-notes-${this.moduleId}`);
				notesDlg?.bringToTop?.();
			} catch (e) { DL(2, "BBMMModuleTagsApp | failed to focus notes dialog", e); }
		});
		return frame;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		try { injectBBMMHeaderButton(this.element); } catch (e) { DL(2, "BBMMModuleTagsApp | header button inject failed", e); }
	}
}

// ── BBMMBulkTagAssignApp ──────────────────────────────────────────────────────

class BBMMBulkTagAssignApp extends foundry.applications.api.ApplicationV2 {
	constructor(tagId, subtagId) {
		const suffix = subtagId ? `${tagId}-${subtagId}` : tagId;
		super({
			id: `bbmm-bulk-tag-assign-${suffix}`,
			window: { resizable: true },
			position: { width: 500, height: 560 }
		});
		this.tagId    = tagId;
		this.subtagId = subtagId ?? null;
		this.filter   = "";
	}

	get _title() {
		const data = _getTagData();
		const tag  = data.tags.find(t => t.id === this.tagId);
		const sub  = this.subtagId ? data.subtags.find(s => s.id === this.subtagId) : null;
		const label = sub ? `${tag?.label ?? this.tagId} / ${sub.label}` : (tag?.label ?? this.tagId);
		return `Assign: ${label}`;
	}

	async _renderHTML() {
		const data = _getTagData();
		const tag  = data.tags.find(t => t.id === this.tagId);
		const sub  = this.subtagId ? data.subtags.find(s => s.id === this.subtagId) : null;
		const label = sub ? `${tag?.label ?? this.tagId} / ${sub.label}` : (tag?.label ?? this.tagId);

		// All installed modules sorted alphabetically
		const allMods = [...game.modules.values()]
			.filter(m => m.active !== undefined) // installed
			.sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id));

		const q = this.filter.toLowerCase().trim();
		const visible = q ? allMods.filter(m => (m.title + " " + m.id).toLowerCase().includes(q)) : allMods;

		const rows = visible.map(m => {
			const assignments = data.assignments[m.id] ?? [];
			const checked = assignments.some(a =>
				a.tagId === this.tagId && (a.subtagId ?? null) === this.subtagId
			);
			return `
				<label class="bbmm-bulk-row">
					<input type="checkbox" name="mod" value="${hlp_esc(m.id)}" ${checked ? "checked" : ""}>
					<span class="bbmm-bulk-mod-title">${hlp_esc(m.title ?? m.id)}</span>
				</label>
			`;
		}).join("");

		const root = document.createElement("div");
		root.className = "bbmm-bulk-assign-content";
		root.innerHTML = `
			<div class="bbmm-bulk-header">${hlp_esc(LT.moduleManagement.tagMgrAssigning())} <strong>${hlp_esc(label)}</strong></div>
			<input type="text" id="bbmm-bulk-filter" placeholder="${hlp_esc(LT.moduleManagement.tagMgrFilterPlaceholder())}" value="${hlp_esc(this.filter)}">
			<div class="bbmm-bulk-list">${rows || `<p>${hlp_esc(LT.moduleManagement.tagMgrNoModulesFound())}</p>`}</div>
		`;
		return root;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
		this._attachListeners(result);
	}

	_attachListeners(content) {
		content.querySelector("#bbmm-bulk-filter")?.addEventListener("input", (e) => {
			this.filter = e.target.value ?? "";
			this._updateList(content);
		});
	}

	_updateList(content) {
		const data = _getTagData();
		const q = this.filter.toLowerCase().trim();
		const allMods = [...game.modules.values()]
			.filter(m => m.active !== undefined)
			.sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id));
		const visible = q ? allMods.filter(m => (m.title + " " + m.id).toLowerCase().includes(q)) : allMods;

		// Snapshot current checkbox state from live DOM so user changes survive filter updates
		const currentState = new Map(
			[...content.querySelectorAll('input[name="mod"]')].map(el => [el.value, el.checked])
		);

		const rows = visible.map(m => {
			// Use live DOM state if we have it, otherwise fall back to saved assignments
			const isChecked = currentState.has(m.id)
				? currentState.get(m.id)
				: (data.assignments[m.id] ?? []).some(a =>
					a.tagId === this.tagId && (a.subtagId ?? null) === this.subtagId
				);
			return `
				<label class="bbmm-bulk-row">
					<input type="checkbox" name="mod" value="${hlp_esc(m.id)}" ${isChecked ? "checked" : ""}>
					<span class="bbmm-bulk-mod-title">${hlp_esc(m.title ?? m.id)}</span>
				</label>
			`;
		}).join("");

		const list = content.querySelector(".bbmm-bulk-list");
		if (list) list.innerHTML = rows || `<p>${hlp_esc(LT.moduleManagement.tagMgrNoModulesFound())}</p>`;
	}

	async _renderFrame(options) {
		const frame = await super._renderFrame(options);
		// Inject footer with Cancel / Save
		const footer = document.createElement("footer");
		footer.className = "bbmm-bulk-footer";
		footer.innerHTML = `
			<button type="button" id="bbmm-bulk-cancel">${hlp_esc(LT.buttons.cancel())}</button>
			<button type="button" id="bbmm-bulk-save">${hlp_esc(LT.buttons.save())}</button>
		`;
		frame.appendChild(footer);
		footer.querySelector("#bbmm-bulk-cancel")?.addEventListener("click", () => this.close());
		footer.querySelector("#bbmm-bulk-save")?.addEventListener("click", () => this._save());
		return frame;
	}

	async _save() {
		const data  = _getTagData();
		const boxes = this.element?.querySelectorAll('input[name="mod"]') ?? [];

		for (const box of boxes) {
			const modId = box.value;
			const arr   = data.assignments[modId] ?? [];
			const hasIt = arr.some(a => a.tagId === this.tagId && (a.subtagId ?? null) === this.subtagId);

			if (box.checked && !hasIt) {
				arr.push(this.subtagId ? { tagId: this.tagId, subtagId: this.subtagId } : { tagId: this.tagId });
				data.assignments[modId] = arr;
			} else if (!box.checked && hasIt) {
				data.assignments[modId] = arr.filter(a =>
					!(a.tagId === this.tagId && (a.subtagId ?? null) === this.subtagId)
				);
				if (!data.assignments[modId].length) delete data.assignments[modId];
			}
		}

		await _saveTagData(data);
		_bbmmRefreshModuleManagerApp();
		this.close();
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		try { injectBBMMHeaderButton(this.element); } catch (e) { DL(2, "BBMMBulkTagAssignApp | header button inject failed", e); }
	}
}

// ── Tag app openers (exposed on globalThis.bbmm) ──────────────────────────────

function openTagManager() {
	try { new BBMMTagManagerApp().render(true); }
	catch (err) { DL(3, `module-management.js | openTagManager(): ${err?.message ?? err}`, err); }
}

function openModuleTagsApp(moduleId) {
	try { new BBMMModuleTagsApp(moduleId).render(true); }
	catch (err) { DL(3, `module-management.js | openModuleTagsApp(): ${err?.message ?? err}`, err); }
}

function openBulkTagAssignApp(tagId, subtagId) {
	try { new BBMMBulkTagAssignApp(tagId, subtagId).render(true); }
	catch (err) { DL(3, `module-management.js | openBulkTagAssignApp(): ${err?.message ?? err}`, err); }
}

// Refresh the Module Manager after notes edit
function _bbmmRefreshModuleManagerApp() {
	try {
		const app = foundry.applications?.instances?.get?.("bbmm-module-manager");
		if (!app) return;

		if (typeof app._rerender === "function") {
			app._rerender({ keepFocus: true });
		} else if (typeof app.render === "function") {
			app.render({ force: true });
		}
	} catch (err) {
		DL(2, "module-management | _bbmmRefreshModuleManagerApp(): error", err);
	}
}

/* Open the notes editor dialog for a specific module */
async function _bbmmOpenNotesDialog(moduleId) {
    try {
        const allNotes = _getNotesData();
        const saved = typeof allNotes === "object" ? (allNotes[moduleId] || "") : "";
        const seed = _bbmmExtractEditorContent(saved);

        // bare content 
        const content = document.createElement("div");

        // build the form
        const form = document.createElement("form");
        form.className = "bbmm-notes-form";

        // section with separators
        const section = document.createElement("section");
        section.className = "bbmm-notes-section";

        // top rule
        const hrTop = document.createElement("hr");
        hrTop.className = "bbmm-hr";
        section.appendChild(hrTop);

        // header row (right-aligned heading)
        const head = document.createElement("div");
        head.className = "bbmm-notes-head";
        const heading = document.createElement("h3");
        heading.textContent = LT.modListNotesLabel();
        heading.className = "bbmm-notes-title";
        head.appendChild(heading);
        section.appendChild(head);

        // editor (full width)
        const pm = foundry.applications.elements.HTMLProseMirrorElement.create({
            name: "notes",
            value: seed,
            height: 200,
            collaborate: false,
            toggled: false,
            aria: { label: "BBMM Notes" },
            dataset: { bbmmId: moduleId }
        });
        section.appendChild(pm);

        // bottom rule
        const hrBot = document.createElement("hr");
        hrBot.className = "bbmm-hr";
        section.appendChild(hrBot);

        // assemble
        form.appendChild(section);
        content.appendChild(form);

        let dlgRef = null;
        const TARGET_WIDTH = 800;
        const TARGET_HEIGHT = 450;

        // robust read: prefer live document; fallback to component APIs
        const readFromProseMirror = async () => {
            try {
                const live =
                    document.querySelector(`prose-mirror[data-bbmm-id="${moduleId}"]`) ||
                    dlgRef?.element?.querySelector?.(`prose-mirror[data-bbmm-id="${moduleId}"]`) ||
                    dlgRef?.element?.querySelector?.('prose-mirror[name="notes"]');

                if (!live) { DL(2, `module-management | <prose-mirror> not found for read (id=${moduleId})`); return ""; }

                const doc = live.shadowRoot?.querySelector?.(".ProseMirror");
                if (doc?.innerHTML) {
                    const s = doc.innerHTML.trim();
                    DL(`module-management | read via shadow .ProseMirror (content-only): ${s.length} chars`);
                    return s;
                }
                if (typeof live.getHTML === "function") {
                    const a = await live.getHTML();
                    const s = _bbmmExtractEditorContent(a || "");
                    DL(`module-management | read via pm.getHTML() ⇒ content-only: ${s.length} chars`);
                    return s;
                }
                const b = _bbmmExtractEditorContent(live.value ?? "");
                if (b) {
                    DL(`module-management | read via pm.value ⇒ content-only: ${b.length} chars`);
                    return b;
                }
                DL("module-management | readFromProseMirror(): empty");
                return "";
            } catch (e) {
                DL(2, "module-management | readFromProseMirror(): error", e);
                return "";
            }
        };

        const dlg = new foundry.applications.api.DialogV2({
            id: `bbmm-notes-${moduleId}`,
            modal: false,
            window: {
                title: LT.modListEditTitle({ id: moduleId }),
                icon: "fa-solid fa-pen-to-square",
                resizable: false
            },
            content,
            render: (app) => {
                dlgRef = app;

                // helper: center using constants 
                const _bbmmCenter = () => {
                    try {
                        const left = Math.max((window.innerWidth  - TARGET_WIDTH)  / 2, 0);
                        const top  = Math.max((window.innerHeight - TARGET_HEIGHT) / 2, 0);
                        app.setPosition({ width: TARGET_WIDTH, height: TARGET_HEIGHT, left, top });
                    } catch (e) {
                        DL(2, "module-management | _bbmmCenter(): error", e);
                    }
                };

                try {
                    const el = app.element;

                    // defeat theme clamps + pin dimensions
                    el.style.maxWidth = "none";
                    el.style.width = `${TARGET_WIDTH}px`;
                    el.style.minWidth = `${TARGET_WIDTH}px`;
                    el.style.height = `${TARGET_HEIGHT}px`;

                    // initial center
                    _bbmmCenter();
                    requestAnimationFrame(() => requestAnimationFrame(_bbmmCenter));

                    // one-shot: if the element changes size once after paint, recenter then disconnect
                    const ro = new ResizeObserver(() => {
                        ro.disconnect();
                        _bbmmCenter();
                    });
                    ro.observe(el);
                } catch (e) {
                    DL(2, "module-management | render(): sizing error", e);
                }
            },
            buttons: [
                { action: "cancel", label: LT.buttons.cancel(), icon: "fa-solid fa-xmark" },
                {
					action: "tags",
					label: LT.moduleManagement.editTags(),
					icon: "fa-solid fa-tags",
					callback: () => { openModuleTagsApp(moduleId); return false; }
				},
                {
					action: "save",
					label: LT.buttons.save(),
					icon: "fa-solid fa-floppy-disk",
					default: true,
					callback: async () => {
						const raw = await readFromProseMirror();	// content-only HTML
						let html = raw ?? "";

						// Trim trailing whitespace
						html = html.replace(/\s+$/, "");

						// Remove trailing empty <p>/<div> blocks
						html = html.replace(/(<(p|div)>(\s|&nbsp;|<br\s*\/?>)*<\/\2>)+$/gi, "");

						// If effectively empty (including ProseMirror-trailingBreak cases) -> delete entry
						const notes = _getNotesData();
						if (_bbmmIsEmptyNoteHTML(html)) {
							if (moduleId in notes) delete notes[moduleId];
							await _saveNotesData(notes);
							_bbmmRefreshModuleManagerApp();
							ui.notifications.info(LT.modListNotesDeleted());
							DL(`module-management | cleared empty note for ${moduleId}`);
							return;
						}

						// Non-empty -> save/update
						notes[moduleId] = html;
						await _saveNotesData(notes);
						_bbmmRefreshModuleManagerApp();

						ui.notifications.info(LT.modListNotesSaved());
						DL(`module-management | saved notes for ${moduleId}`, { length: html.length });
					}
				}
            ]
        });

        await dlg.render(true);
        // assert width again after paint
        try {
            const el = dlg.element;
            el.style.maxWidth = "none";
            el.style.width = `${TARGET_WIDTH}px`;
            el.style.minWidth = `${TARGET_WIDTH}px`;
            el.style.height = `${TARGET_HEIGHT}px`;

            const left = Math.max((window.innerWidth  - TARGET_WIDTH)  / 2, 0);
            const top  = Math.max((window.innerHeight - TARGET_HEIGHT) / 2, 0);
            dlg.setPosition({ width: TARGET_WIDTH, height: TARGET_HEIGHT, left, top });
        } catch (e) {
            DL(2, "module-management | post-render sizing error", e);
        }
        DL("module-management | opened notes dialog (V2) for " + moduleId);
    } catch (err) {
        DL(3, "module-management | _bbmmOpenNotesDialog(DialogV2): error", err);
    }
}

/* ============================================================================
	BBMM: Stand-alone Module Manager (ApplicationV2) — launchable from a macro
	V13-only. No core patching. Purely client-side planning of enable/disable.
============================================================================ */
class BBMMModuleManagerApp extends foundry.applications.api.ApplicationV2 {
	constructor() {
		super({
			id: "bbmm-module-manager",
			window: { title: LT.moduleManagement.modListWindowTitle() },
			width: 1000,
			height: 640,
			resizable: true
		});

		// working set, by module id -> boolean
		this.plan = new Map();
		// filter state
		this.query = "";
		this.scope = "all";
		this.tagFilter = new Set();  // tagIds to filter by (empty = show all)
		this.groupByTags = false;
		this.groupBySubtags = false;
		/* runtime lock state */
		this.locks = new Set();

		this._minW = 760;
		this._maxW = 1400;
		this._minH = 480;
		this._maxH = 900;

		// snapshot modules once on open
		this._refreshDataset();

		this._temp = null;       // working copy (object: id -> boolean)
		this._coreSnap = null;   // snapshot of core at open time (object: id -> boolean)
	}

	/* Seed/reset temp from core at open */
	async _resetTempFromCore() {
		try {
			const core = foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
			await game.settings.set(BBMM_ID, "tempModConfig", core);
			this._coreSnap = core;                 // snapshot for diff counts
			this._temp = foundry.utils.duplicate(core);
			DL("BBMMModuleManagerApp::_resetTempFromCore(): temp reset from core");
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_resetTempFromCore(): error", e);
			this._coreSnap = {};
			this._temp = {};
		}
	}

	/* Read “planned” state: prefer temp, else current active */
	_getTempActive(id) {
		const t = this._temp || {};
		return Object.prototype.hasOwnProperty.call(t, id) ? !!t[id] : !!game.modules.get(id)?.active;
	}

	/* Set planned state in temp (in-mem + persisted) */
	async _setTempActive(id, on) {
		try {
			const cur = foundry.utils.duplicate(game.settings.get(BBMM_ID, "tempModConfig") || {});
			cur[id] = !!on;
			await game.settings.set(BBMM_ID, "tempModConfig", cur);
			this._temp = cur;
			DL(`BBMMModuleManagerApp::_setTempActive(): ${id} = ${!!on}`);
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_setTempActive(): error", e);
		}
	}	

	// Load module locks data
	async _loadLocks() {
		try {
			const raw = await game.settings.get(BBMM_ID, "moduleLocks");
			const arr = Array.isArray(raw) ? raw : [];
			this.locks = new Set(arr);
			DL("_loadLocks(): loaded", { count: this.locks.size });
		} catch (e) {
			this.locks = new Set();
			DL(2, "_loadLocks(): error", e);
		}
	}

	// Save module locks data
	async _saveLocks() {
		try {
			await game.settings.set(BBMM_ID, "moduleLocks", Array.from(this.locks));
			DL("_saveLocks(): saved", { count: this.locks.size });
		} catch (e) {
			DL(2, "_saveLocks(): error", e);
		}
	}

	/* Debounced saver for moduleLocks */
	_queueSaveLocks() {
		try {
			if (this._locksSaveT) clearTimeout(this._locksSaveT);
			this._locksSaveT = setTimeout(async () => {
				this._locksSaveT = null;
				await this._saveLocks(); // write the world setting
			}, 200);
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_queueSaveLocks(): error", e);
		}
	}

	async _setTempActiveBulk(onIds = [], offIds = []) {
		try {
			const cur = foundry.utils.duplicate(game.settings.get(BBMM_ID, "tempModConfig") || {});

			// Do not touch locked modules (safety)
			const enableIds = (onIds ?? []).filter(id => !this.locks.has(id));
			const disableIds = (offIds ?? []).filter(id => !this.locks.has(id));
			const skippedEnable = (onIds ?? []).filter(id => this.locks.has(id));
			const skippedDisable = (offIds ?? []).filter(id => this.locks.has(id));
			if (skippedEnable.length || skippedDisable.length) {
				DL("BBMMModuleManagerApp::_setTempActiveBulk(): locked modules filtered out", { skippedEnable, skippedDisable });
			}

			for (const id of enableIds) cur[id] = true;
			for (const id of disableIds) cur[id] = false;

			await game.settings.set(BBMM_ID, "tempModConfig", cur);
			this._temp = cur;
			DL("BBMMModuleManagerApp::_setTempActiveBulk()", { onIds: enableIds, offIds: disableIds });
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_setTempActiveBulk(): error", e);
		}
	}

	_refreshDataset() {
		try {
			const data = [];
			for (const mod of game.modules) {
				const id = String(mod.id);
				const title = String(mod.title ?? id);
				const version = String(mod.version ?? mod?.manifest?.version ?? "");

				/* collect requires */
				const req = (mod?.relationships?.requires ?? []);
				const requires = [];
				for (const r of req) if (r?.id && (r.type ?? "module") === "module") requires.push(r.id);

				/* collect conflicts */
				const conflicts = (mod?.relationships?.conflicts ?? []);
				const confIds = [];
				for (const c of conflicts) if (c?.id && (c.type ?? "module") === "module") confIds.push(c.id);

				/* collect recommends */
				const rec = (mod?.relationships?.recommends ?? []);
				const recIds = [];
				for (const o of rec) if (o?.id && (o.type ?? "module") === "module") recIds.push(o.id);

				data.push({ id, title, version, requires, recommends: recIds, conflicts: confIds });
			}
			data.sort((a, b) => a.title.localeCompare(b.title));
			this._mods = data;
			DL(`BBMMModuleManagerApp::_refreshDataset(): loaded ${data.length} modules`);
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_refreshDataset(): error", e);
			this._mods = [];
		}
	}

	_getFiltered() {
		const q = (this.query ?? "").toLowerCase().trim();
		const scope = this.scope;
		const tagFilter = this.tagFilter;
		const tagData = tagFilter.size > 0 ? _getTagData() : null;
		return (this._mods ?? []).filter(m => {
			const planned = !!this._getTempActive(m.id);
			if (scope === "active" && !planned)   return false;
			if (scope === "inactive" && planned)  return false;
			if (tagFilter.size > 0) {
				const assignments = tagData.assignments[m.id] ?? [];
				if (!assignments.some(a => tagFilter.has(a.tagId))) return false;
			}
			if (!q) return true;
			const blob = (m.title + " " + m.id + " " + (m.version || "")).toLowerCase();
			return blob.includes(q);
		});
	}

	_getGrouped() {
		const filtered = this._getFiltered();
		const tagData = _getTagData();
		const groups = [];
		const placed = new Set();
		for (const tag of tagData.tags) {
			const mods = filtered.filter(m =>
				(tagData.assignments[m.id] ?? []).some(a => a.tagId === tag.id)
			);
			if (mods.length) {
				groups.push({ tag, mods });
				for (const m of mods) placed.add(m.id);
			}
		}
		const untagged = filtered.filter(m => !placed.has(m.id));
		if (untagged.length) groups.push({ tag: null, mods: untagged });
		return groups;
	}

	_getGroupedBySubtag() {
		const filtered = this._getFiltered();
		const tagData = _getTagData();
		const groups = new Map(); // label -> Set of mods
		const placed = new Set();

		for (const m of filtered) {
			const assignments = tagData.assignments[m.id] ?? [];
			for (const a of assignments) {
				const tag = tagData.tags.find(t => t.id === a.tagId);
				const sub = a.subtagId ? tagData.subtags.find(s => s.id === a.subtagId) : null;
				const label = sub
					? `${tag?.label ?? a.tagId} / ${sub.label}`
					: (tag?.label ?? a.tagId);
				if (!groups.has(label)) groups.set(label, []);
				groups.get(label).push(m);
				placed.add(m.id);
			}
		}

		const result = [...groups.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([label, mods]) => ({ label, mods }));

		const untagged = filtered.filter(m => !placed.has(m.id));
		if (untagged.length) result.push({ label: LT.moduleManagement.untagged(), mods: untagged });
		return result;
	}

	async _openTagFilterDialog() {
		const tagData = _getTagData();
		if (!tagData.tags.length) {
			ui.notifications?.info(LT.moduleManagement.tagMgrFilterNone());
			return;
		}
		const rows = tagData.tags.map(t => `
			<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
				<input type="checkbox" name="tag" value="${hlp_esc(t.id)}" ${this.tagFilter.has(t.id) ? "checked" : ""}>
				${hlp_esc(t.label)}
			</label>
		`).join("");

		let dlgEl = null;
		await new Promise(resolve => {
			const dlg = new foundry.applications.api.DialogV2({
				window: { title: LT.moduleManagement.tagMgrFilterTitle() },
				content: `<div style="display:flex;flex-direction:column;padding:0.5em;">${rows}</div>`,
				buttons: [
					{
						action: "apply",
						label: LT.buttons.apply(),
						default: true,
						callback: () => {
							const checked = dlg.element?.querySelectorAll?.('input[name="tag"]:checked') ?? [];
							this.tagFilter = new Set([...checked].map(el => el.value));
							resolve();
						}
					},
					{ action: "clear", label: LT.moduleManagement.tagMgrClearFilter(), callback: () => { this.tagFilter = new Set(); resolve(); } },
					{ action: "cancel", label: LT.buttons.cancel(), callback: () => resolve() }
				],
				rejectClose: false,
				close: resolve
			});
			dlg.render(true).then(() => { dlgEl = dlg; });
		});

		this._rerender({ keepFocus: true });
	}

	/* Current totals from the planned (temp) state */
	_diffCounts() {
		try {
			let enable = 0, disable = 0;
			for (const m of this._mods ?? []) {
				if (this._getTempActive(m.id)) enable++;
				else disable++;
			}
			return { enable, disable };
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_diffCounts(): error", e);
			return { enable: 0, disable: 0 };
		}
	}

	/* Return required MODULE ids from relationships.requires */
	_getModuleRequires(mod) {
		try {
			if (!mod) return [];
			const reqs = mod?.relationships?.requires;
			if (!reqs || typeof reqs[Symbol.iterator] !== "function") return [];

			const ids = [];
			for (const r of reqs) {
				if (!r?.id) continue;
				if ((r.type ?? "module") !== "module") continue;
				if (!game.modules.has(r.id)) continue;
				ids.push(r.id);
			}
			const uniq = Array.from(new Set(ids));
			DL(`BBMMModuleManagerApp::_getModuleRequires(${mod.id})`, { requires: uniq });
			return uniq;
		} catch (err) {
			DL(2, "BBMMModuleManagerApp::_getModuleRequires(): error", err);
			return [];
		}
	}

	/* Collect all transitive required module IDs for a given module id. */
	_collectRequired(moduleId) {
		try {
			const out = new Set();
			const seen = new Set();
			const q = [moduleId];

			while (q.length) {
				const cur = q.pop();
				if (seen.has(cur)) continue;
				seen.add(cur);

				const mod = game.modules.get(cur);
				if (!mod) continue;

				for (const rid of this._getModuleRequires(mod)) {
					if (rid === moduleId) continue; // guard cycle to root
					if (!out.has(rid)) {
						out.add(rid);
						q.push(rid);
					}
				}
			}
			const deps = Array.from(out);
			DL(`BBMMModuleManagerApp::_collectRequired(${moduleId})`, { deps });
			return out;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_collectRequired(): error", e);
			return new Set();
		}
	}

	/* Return a Set of module ids that depend on the given module.
	   Only includes modules that are currently planned ON (temp) to avoid noise. */
	_collectDependents(moduleId) {
		try {
			const dependents = new Set();
			const queue = [moduleId];
			const seen = new Set(queue);

			// Build a quick index: id -> Set(ids it requires)
			const requiresOf = new Map();
			for (const mod of game.modules) {
				const id = String(mod.id);
				const req = [...(mod.relationships?.requires ?? [])].map(r => r.id).filter(Boolean);
				requiresOf.set(id, new Set(req));
			}

			while (queue.length) {
				const target = queue.pop();
				for (const mod of game.modules) {
					const id = String(mod.id);
					if (seen.has(id)) continue;
					const reqs = requiresOf.get(id);
					if (!reqs || !reqs.has(target)) continue;

					// Only consider “planned ON” modules
					if (!this._getTempActive(id)) continue;

					dependents.add(id);
					seen.add(id);
					queue.push(id); // transitive dependents
				}
			}
			return dependents;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_collectDependents(): error", e);
			return new Set();
		}
	}

	/* Of the modules that THIS module requires, return the ones that are not required
	   by any OTHER planned-ON module (so they can be safely turned off when disabling this). */
	_collectOrphanedRequires(moduleId) {
		try {
			// Direct requires of the module being disabled
			const req = this._getModuleRequires(game.modules.get(moduleId));
			if (!req.length) return new Set();

			// Which of those are still needed by some other planned-ON module?
			const stillNeeded = new Set();
			for (const m of game.modules) {
				const id = String(m.id);
				if (id === moduleId) continue;
				if (!this._getTempActive(id)) continue;
				const r = this._getModuleRequires(m);
				for (const dep of r) {
					if (req.includes(dep)) stillNeeded.add(dep);
				}
			}

			// Orphans = requires that are not “still needed”
			const out = new Set();
			for (const dep of req) if (!stillNeeded.has(dep)) out.add(dep);
			return out;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_collectOrphanedRequires(): error", e);
			return new Set();
		}
	}

	/* When a module is toggled OFF, confirm disabling its dependents and (optionally) its orphaned requires. */
	async _ensureSafeDisable(moduleId) {
		try {
			/*
				STEP 1: Dependents (modules that rely on this one).
				User can uncheck any they want to KEEP enabled.
				If they cancel this dialog entirely, we abort the disable.
			*/
			const dependents = this._collectDependents(moduleId);
			if (dependents.size) {

				// Build dialog body (detached DOM)
				const content = document.createElement("div"); // root MUST have no attributes for DialogV2

				const p = document.createElement("p");
				p.textContent = LT.moduleManagement.disableDependentsPromptMulti();
				content.appendChild(p);

				const listWrap = document.createElement("div");
				listWrap.style.maxHeight = "200px";
				listWrap.style.overflowY = "auto";
				listWrap.style.display = "flex";
				listWrap.style.flexDirection = "column";
				listWrap.style.gap = "4px";
				content.appendChild(listWrap);

				const depList = [...dependents]
					.sort((a, b) => a.localeCompare(b))
					.map(id => ({
						id,
						title: game.modules.get(id)?.title ?? id
					}));

				for (const dep of depList) {
					const row = document.createElement("label");
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.gap = "6px";

					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.classList.add("bbmm-disable-check");
					cb.setAttribute("checked", "checked");
					cb.checked = true;
					cb.dataset.modId = dep.id;

					const span = document.createElement("span");
					span.textContent = `${dep.id} — ${dep.title}`;

					row.appendChild(cb);
					row.appendChild(span);
					listWrap.appendChild(row);
				}

				let accepted = false;
				let approvedIds = [];

				await new Promise(resolve => {
					const safeResolve = () => { try { resolve(); } catch {} };

					const dlg = new foundry.applications.api.DialogV2({
						id: "bbmm-mm-disable-dependents",
						modal: true,
						window: { title: LT.moduleManagement.disableDependentsTitle() },
						content,
						buttons: [
							{
								action: "ok",
								label: LT.moduleManagement.disable(),
								icon: "fa-solid fa-check",
								default: true,
								callback: () => {
									accepted = true;

									// Get live checkboxes from the rendered dialog DOM
									const rootEl = document.getElementById("bbmm-mm-disable-dependents");
									const chosen = [];
									if (rootEl) {
										for (const cb of rootEl.querySelectorAll(".bbmm-disable-check")) {
											if (cb.checked) chosen.push(cb.dataset.modId);
										}
									}

									approvedIds = chosen;
									safeResolve();
								}
							},
							{
								action: "cancel",
								label: LT.buttons.cancel(),
								icon: "fa-solid fa-xmark",
								callback: () => {
									accepted = false;
									safeResolve();
								}
							}
						],
						close: () => {
							if (!accepted) accepted = false;
							safeResolve();
						}
					});

					dlg.render(true);
				});

				// User canceled dependents dialog
				if (!accepted) {
					DL(`BBMMModuleManagerApp::_ensureSafeDisable(${moduleId}): user canceled dependents`);
					return false;
				}

				// Disable ONLY the dependents that remained checked
				if (approvedIds.length) {
					await this._setTempActiveBulk([], approvedIds);
				}
			}

			/*
				STEP 2: Orphaned requires.
				User can uncheck any they want to KEEP enabled.
				If they cancel here, we do NOT block the disable of the original module.
			*/
			const orphans = this._collectOrphanedRequires(moduleId);
			if (orphans.size) {

				const content = document.createElement("div"); // root MUST have no attributes

				const p = document.createElement("p");
				p.textContent = LT.moduleManagement.disableOrphansPromptMulti();
				content.appendChild(p);

				const listWrap = document.createElement("div");
				listWrap.style.maxHeight = "200px";
				listWrap.style.overflowY = "auto";
				listWrap.style.display = "flex";
				listWrap.style.flexDirection = "column";
				listWrap.style.gap = "4px";
				content.appendChild(listWrap);

				const orphanList = [...orphans]
					.sort((a, b) => a.localeCompare(b))
					.map(id => ({
						id,
						title: game.modules.get(id)?.title ?? id
					}));

				for (const dep of orphanList) {
					const row = document.createElement("label");
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.gap = "6px";

					const cb = document.createElement("input");
					cb.type = "checkbox";
					cb.classList.add("bbmm-disable-check");
					cb.setAttribute("checked", "checked");
					cb.checked = true;
					cb.dataset.modId = dep.id;

					const span = document.createElement("span");
					span.textContent = `${dep.id} — ${dep.title}`;

					row.appendChild(cb);
					row.appendChild(span);
					listWrap.appendChild(row);
				}

				let okOrphans = false;
				let approvedOrphans = [];

				await new Promise(resolve => {
					const safeResolve = () => { try { resolve(); } catch {} };

					const dlg = new foundry.applications.api.DialogV2({
						id: "bbmm-mm-disable-orphans",
						modal: true,
						window: { title: LT.moduleManagement.disableOrphansTitle() },
						content,
						buttons: [
							{
								action: "ok",
								label: LT.moduleManagement.disable(),
								icon: "fa-solid fa-check",
								default: true,
								callback: () => {
									okOrphans = true;

									// read from live dialog DOM
									const rootEl = document.getElementById("bbmm-mm-disable-orphans");
									const chosen = [];
									if (rootEl) {
										for (const cb of rootEl.querySelectorAll(".bbmm-disable-check")) {
											if (cb.checked) chosen.push(cb.dataset.modId);
										}
									}

									approvedOrphans = chosen;
									safeResolve();
								}
							},
							{
								action: "cancel",
								label: LT.buttons.cancel(),
								icon: "fa-solid fa-xmark",
								callback: () => {
									okOrphans = false;
									safeResolve();
								}
							}
						],
						close: () => { safeResolve(); }
					});

					dlg.render(true);
				});

				// If they cancel or close here, we just don't disable orphans (but we still proceed with disabling the root module).
				if (okOrphans && approvedOrphans.length) {
					await this._setTempActiveBulk([], approvedOrphans);
				}
			}

			// STEP 3: We’re good to disable the requested module itself
			return true;

		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_ensureSafeDisable(): error", e);
			return false;
		}
	}


	/* When a module is toggled ON, ensure required deps are also toggled ON (with confirmation),
	and offer to also enable optional dependencies (checkbox, default ON). */
	async _ensureDependenciesForEnable(moduleId) {
		try {
			// Required 
			const need = this._collectRequired(moduleId);
			const toEnable = [];
			for (const dep of need) {
				const curActive = !!game.modules.get(dep)?.active;
				const planned = this.plan.has(dep) ? !!this.plan.get(dep) : curActive;
				if (!planned) toEnable.push(dep);
			}

			// Recommended
			const mod = game.modules.get(moduleId);
			const recommended = [];
			try {
				const rec = (mod?.relationships?.recommends ?? []);
				for (const o of rec) {
					if (!o?.id) continue;
					if ((o.type ?? "module") !== "module") continue;
					if (!game.modules.has(o.id)) continue; // only offer installed modules
					const curActive = !!game.modules.get(o.id)?.active;
					const planned = this.plan.has(o.id) ? !!this.plan.get(o.id) : curActive;
					if (!planned) recommended.push(o.id);
				}
			} catch (e) {
				DL(2, `BBMMModuleManagerApp::_ensureDependenciesForEnable(${moduleId}): recommends scan failed`, e);
			}

			// Nothing to do
			if (!toEnable.length && !recommended.length) return true;

			DL(`_ensureDependenciesForEnable(): discovered deps for ${moduleId}`, { required: toEnable, recommended });

			// Create an attribute-less root, and a styled inner container for layout.
			const content = document.createElement("div"); 
			const container = document.createElement("div");
			container.style.display = "flex";
			container.style.flexDirection = "column";
			container.style.gap = ".5rem";
			content.appendChild(container);

			const reqTitle = LT.moduleManagement.dependencies();
			const recTitle = LT.moduleManagement.recommendations();

			// Required list (informational)
			if (toEnable.length) {
				const p = document.createElement("p");
				p.textContent = LT.moduleManagement.depsPrompt();
				container.appendChild(p);

				const wrap = document.createElement("div");
				wrap.style.maxHeight = "200px";
				wrap.style.overflow = "auto";
				wrap.style.border = "1px solid var(--color-border, #888)";
				wrap.style.borderRadius = ".35rem";
				wrap.style.padding = ".5rem";

				const h = document.createElement("div");
				h.style.fontWeight = "bold";
				h.textContent = `${reqTitle} (${toEnable.length})`;
				wrap.appendChild(h);

				const ul = document.createElement("ul");
				for (const id of toEnable) {
					const li = document.createElement("li");
					const t = game.modules.get(id)?.title ?? id;
					li.innerHTML = `<code>${hlp_esc(id)}</code> — ${hlp_esc(t)}`;
					ul.appendChild(li);
				}
				wrap.appendChild(ul);
				container.appendChild(wrap);
			}

			// Recommended with per-item checkboxes (default checked)
			if (recommended.length) {
				const wrap = document.createElement("div");
				wrap.style.maxHeight = "200px";
				wrap.style.overflow = "auto";
				wrap.style.border = "1px solid var(--color-border, #888)";
				wrap.style.borderRadius = ".35rem";
				wrap.style.padding = ".5rem";

				const h = document.createElement("div");
				h.style.fontWeight = "bold";
				h.textContent = `${recTitle} (${recommended.length})`;
				wrap.appendChild(h);

				const list = document.createElement("div");
				list.style.display = "grid";
				list.style.gridTemplateColumns = "1fr";
				list.style.rowGap = ".25rem";

				for (const id of recommended) {
					const modTitle = game.modules.get(id)?.title ?? id;

					const row = document.createElement("label");
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.gap = ".5rem";

					const chk = document.createElement("input");
					chk.type = "checkbox";
					chk.defaultChecked = true;	
					chk.checked = true;
					chk.name = "bbmm-rec";
					chk.value = id;

					const span = document.createElement("span");
					span.innerHTML = `<code>${hlp_esc(id)}</code> — ${hlp_esc(modTitle)}`;

					row.appendChild(chk);
					row.appendChild(span);
					list.appendChild(row);
				}

				wrap.appendChild(list);
				container.appendChild(wrap);
			}

			// Dialog
			let accepted = false;
			let selectedRecs = [];
			await new Promise((resolve) => {
				let resolved = false;
				const safeResolve = (v) => { if (!resolved) { resolved = true; resolve(v); } };

				const dlg = new foundry.applications.api.DialogV2({
					id: "bbmm-mm-enable-deps",
					modal: true,
					window: { title: LT.moduleManagement.depsTitle() },
					content, 
					buttons: [
						{
							action: "ok",
							label: LT.moduleManagement.enable(),
							icon: "fa-solid fa-check",
							default: true,
							callback: () => {
								accepted = true;
								selectedRecs = Array.from(content.querySelectorAll('input[name="bbmm-rec"]:checked')).map(el => el.value);
								DL(`_ensureDependenciesForEnable(): accepted for ${moduleId}`, { selectedRecs });
								safeResolve(true);
							}
						},
						{
							action: "cancel",
							label: LT.buttons.cancel(),
							icon: "fa-solid fa-xmark",
							callback: () => { accepted = false; safeResolve(false); }
						}
					],
					close: () => safeResolve(false)
				});
				dlg.render(true);
			});

			if (!accepted) return false;

			// Apply: required + selected recommended + the target module
			const allToEnable = new Set([moduleId]);
			for (const id of toEnable) allToEnable.add(id);
			for (const id of selectedRecs) allToEnable.add(id);

			await this._setTempActiveBulk([...allToEnable], []);
			this._rerender({ keepFocus: true });
			DL("_ensureDependenciesForEnable(): applied", { required: toEnable, recommended: selectedRecs });
			return true;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_ensureDependenciesForEnable(): error", e);
			return true; // fail-open
		}
	}

	/* Persist via core.moduleConfiguration, then reload. */
	async _saveViaCoreSettings() {
		try {
			
			// Live core as base
			const current = foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
			const next = { ...current };

			let touched = 0;
			for (const m of (this._mods ?? [])) {
				const planned = !!this._getTempActive(m.id); // read from temp
				if (next[m.id] !== planned) {
					next[m.id] = planned;
					touched++;
				}
			}

			if (!touched) {
				ui.notifications.info(LT.moduleManagement.noChanges());
				DL("BBMMModuleManagerApp::_saveViaCoreSettings(): no changes");
				return;
			}

			DL(`BBMMModuleManagerApp::_saveViaCoreSettings(): writing ${touched} change(s) to core.moduleConfiguration`);
			await game.settings.set("core", "moduleConfiguration", next);

			// Reload dialog (left button default)
			let doReload = true;
			const content = document.createElement("div");
			const p = document.createElement("p");
			p.textContent = LT.moduleManagement.reloadMessage();
			content.appendChild(p);

			await new Promise(resolve => {
				let done = false;
				const safe = () => { if (!done) { done = true; resolve(); } };
				new foundry.applications.api.DialogV2({
					id: "bbmm-mm-reload",
					modal: true,
					window: { title: LT.moduleManagement.reloadRequiredTitle() },
					content,
					buttons: [
						{
							action: "ok",
							label: LT.moduleManagement.reloadNow(),
							icon: "fa-solid fa-rotate-right",
							default: true,
							callback: () => {
								doReload = true;
								DL("BBMMModuleManagerApp::_saveViaCoreSettings(): Reload Now clicked");
								safe();
							}
						},
						{
							action: "cancel",
							label: LT.moduleManagement.reloadLater(),
							icon: "fa-solid fa-xmark",
							callback: () => { doReload = false; safe(); }
						}
					],
					close: safe
				}).render(true);
			});

			if (doReload) {
				// Broadcast reload to ALL clients before reloading self
				try {
					if (game.user.isGM) {
						const channel = `module.${BBMM_ID}`;
						const payload = { cmd: "bbmm:reload", ts: Date.now() };
						DL("BBMM broadcast: sending reload to all clients", { channel, payload });
						game.socket.emit(channel, payload);
						// Small flush delay helps ensure delivery before this tab reloads
						await new Promise(r => setTimeout(r, 100));
					}
				} catch (e) {
					DL(2, "BBMM broadcast: emit failed", e);
				}

				// Reload this client
				try {
					if (foundry.utils?.debouncedReload) foundry.utils.debouncedReload();
					else window.location.reload();
				}
				catch (e) { DL(3, "BBMMModuleManagerApp::_saveViaCoreSettings(): reload failed", e); }
			} else {
				ui.notifications.info(LT.moduleManagement.reloadLaterNotice());
			}

		} catch (e) {
			DL(3, "BBMMModuleManagerApp::_saveViaCoreSettings(): error", e);
			ui.notifications.error(LT.moduleManagement.saveFailed());
		}
	}

	/* Build a core-style tag strip from module metadata (no version pill). */
	_buildTagsFor(mod) {
		
		try {
			const parts = [];

			/* Lock toggle tag */
			try {
				const isLocked = this.locks?.has?.(mod.id) === true;
				parts.push(
					`<button type="button" class="tag flexrow" data-bbmm-action="toggle-lock" data-mod-id="${hlp_esc(mod.id)}" aria-label="${hlp_esc(isLocked ? LT.moduleManagement.lockUnlock() : LT.moduleManagement.lockLock())}">` +
						/* When locked: closed lock + inline orange so it’s instantly visible */
						`<i class="fa-solid ${isLocked ? "fa-lock" : "fa-lock-open"} fa-fw"${isLocked ? ' style="color: orange;"' : ""}></i>` +
					`</button>`
				);
			} catch (e) { DL(2, "BBMMModuleManagerApp::_buildTagsFor(): lock tag failed", e); }

			// Settings gear (same size as native via "tag flexrow")
			try{
				if (_bbmmModuleHasConfigSettings(mod.id)) {
					parts.push(
						`<button type="button" class="tag flexrow" data-bbmm-action="open-settings" data-mod-id="${hlp_esc(mod.id)}" aria-label="${hlp_esc(LT.openSettings())}">` +
							`<i class="fa-solid fa-gear fa-fw"></i>` +
						`</button>`
					);
				}
			} catch (e) { DL(2, "BBMMModuleManagerApp::_buildTagsFor(): settings tag failed", e); }

			// URL
			const url = mod.url || mod.manifest || "";
			if (url) {
				parts.push(
					`<a class="tag flexrow" href="${hlp_esc(url)}" target="_blank" rel="noopener" title="${hlp_esc(url)}">` +
						`<i class="fa-solid fa-link fa-fw"></i>` +
					`</a>`
				);
			}

			// Author(s)
			const authors = Array.from(mod.authors ?? []);
			if (authors.length) {
				parts.push(`<span class="tag flexrow" title="${hlp_esc(authors.map(a => a.name).join(", "))}"><i class="fa-solid fa-user fa-fw"></i></span>`);
			}

			// Compendium packs
			const packs = Array.from(mod.packs ?? []);
			if (packs.length) {
				parts.push(`<span class="tag flexrow" title="${LT.moduleManagement.tagCompendia()}: ${packs.length}"><i class="fa-solid fa-box-archive fa-fw"></i></span>`);
			}

			// Localization files
			const langs = Array.from(mod.languages ?? []);
			if (langs.length) {
				parts.push(`<span class="tag flexrow" title="${LT.moduleManagement.tagLocalization()}"><i class="fa-solid fa-language fa-fw"></i></span>`);
			}

			return parts.join("");
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_buildTagsFor(): failed", e);
			return "";
		}
	}

	_buildUserTagChips(modId, tagData) {
		const assignments = tagData?.assignments?.[modId] ?? [];
		if (!assignments.length) return "";
		return assignments.map(a => {
			const tag = tagData.tags.find(t => t.id === a.tagId);
			const sub = a.subtagId ? tagData.subtags.find(s => s.id === a.subtagId) : null;
			const label = sub ? `${tag?.label ?? a.tagId} / ${sub.label}` : (tag?.label ?? a.tagId);
			return `<span class="bbmm-tag-chip">${hlp_esc(label)}</span>`;
		}).join("");
	}

	/* Fallback: synthesize a core-like tag strip when native <li> is not available */
	_bbmmBuildTagStripFallback(mod) {
		try {
			const parts = [];

			// settings gear (native sizing: .tag.flexrow)
			if (_bbmmModuleHasConfigSettings(mod.id)) {
                parts.push(
					`<button type="button" class="tag flexrow" data-bbmm-action="open-settings" data-mod-id="${hlp_esc(mod.id)}" aria-label="${hlp_esc(LT.openSettings())}">` +
						`<i class="fa-solid fa-gear fa-fw"></i>` +
					`</button>`
				);
			}

			// URL
			const url = mod.url ?? mod.manifest ?? "";
			if (url) {
				parts.push(
					`<a class="tag flexrow" href="${hlp_esc(url)}" target="_blank" rel="noopener" title="${hlp_esc(url)}">` +
						`<i class="fa-solid fa-link fa-fw"></i>` +
					`</a>`
				);
			}

			// Authors
			const authors = Array.from(mod.authors ?? []);
			if (authors.length) {
				parts.push(`<span class="tag flexrow" title="${hlp_esc(authors.map(a => a.name).join(", "))}"><i class="fa-solid fa-user fa-fw"></i></span>`);
			}

			// Compendium packs
			const packs = Array.from(mod.packs ?? []);
			if (packs.length) {
				parts.push(`<span class="tag flexrow" title="Compendia: ${packs.length}"><i class="fa-solid fa-box-archive fa-fw"></i></span>`);
			}

			// Localization files
			const langs = Array.from(mod.languages ?? []);
			if (langs.length) {
				parts.push(`<span class="tag flexrow" title="Localization"><i class="fa-solid fa-language fa-fw"></i></span>`);
			}

			// Compatibility badges
			try {
				const comp = mod.compatibility ?? mod.manifest?.compatibility ?? {};
				const verified = comp?.verified;
				const min = comp?.minimum;
				const max = comp?.maximum;

				if (verified) {
					parts.push(`<span class="tag flexrow" title="${LT.moduleManagement.compatVerified()}"><i class="fa-solid fa-circle-check fa-fw"></i></span>`);
				} else if (min || max) {
					parts.push(`<span class="tag flexrow" title="${LT.moduleManagement.compatNotVerified()}"><i class="fa-solid fa-triangle-exclamation fa-fw"></i></span>`);
				}
			} catch {}

			// Return combined
			return parts.join("");
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_bbmmBuildTagStripFallback(): failed", e);
			return "";
		}
	}

	_renderHeaderHTML() {
		const { enable, disable } = this._diffCounts();
		const filterLabel = LT.moduleManagement.filterModules();
		return `
			<div class="bbmm-mm-toolbar" id="bbmm-mm-toolbar">
				<div class="bbmm-mm-toolbar-row1">
					<div class="bbmm-filter-wrap">
						<input id="bbmm-mm-q" type="text" placeholder="${hlp_esc(filterLabel)}" value="${hlp_esc(this.query)}" />
						<button type="button" class="bbmm-filter-clear" title="${hlp_esc(LT.moduleManagement.filterClear())}">
							<i class="fa-solid fa-xmark fa-fw"></i>
						</button>
					</div>
					<div class="bbmm-mm-scopes">
						<button type="button" data-scope="all" class="${this.scope==="all"?"on":""}">${LT.moduleManagement.allModules()}</button>
						<button type="button" data-scope="active" class="${this.scope==="active"?"on":""}">${LT.moduleManagement.activeModules()}</button>
						<button type="button" data-scope="inactive" class="${this.scope==="inactive"?"on":""}">${LT.moduleManagement.inactiveModules()}</button>
					</div>
					<div class="bbmm-mm-diff">
						<span class="ena">${LT.moduleManagement.enabled()}: <b id="bbmm-mm-cnt-enable">${enable}</b></span>
						<span class="dis">${LT.moduleManagement.disabled()}: <b id="bbmm-mm-cnt-disable">${disable}</b></span>
					</div>
				</div>
				<div class="bbmm-mm-toolbar-row2">
					<button type="button" id="bbmm-mm-filter-tags" class="${this.tagFilter.size > 0 ? "on" : ""}">
						<i class="fas fa-tags"></i> ${hlp_esc(LT.moduleManagement.filterByTags())}
					</button>
					<button type="button" id="bbmm-mm-group-tags" class="${this.groupByTags ? "on" : ""}">
						<i class="fas fa-layer-group"></i> ${hlp_esc(LT.moduleManagement.groupByTags())}
					</button>
					<button type="button" id="bbmm-mm-group-subtags" class="${this.groupBySubtags ? "on" : ""}">
						<i class="fas fa-layer-group"></i> ${hlp_esc(LT.moduleManagement.groupBySubtags())}
					</button>
					<button type="button" id="bbmm-mm-manage-tags">
						<i class="fas fa-tag"></i> ${hlp_esc(LT.moduleManagement.tagMgrLabel())}
					</button>
				</div>
			</div>
		`;
	}

	_renderFooterHTML() {
		const hasCulprit = !!game.modules.get("find-the-culprit")?.active;
		return `
			<div class="bbmm-mm-footer">
				<button type="button" id="bbmm-mm-save">${LT.moduleManagement.saveModuleSettings()}</button>
				<button type="button" id="bbmm-mm-deactivate-all">${LT.moduleManagement.deactivateAll()}</button>
				<button type="button" id="bbmm-mm-activate-all">${LT.moduleManagement.activateAll()}</button>
				${hasCulprit ? `<button type="button" id="bbmm-mm-culprit"><i class="fa-solid fa-search"></i> ${LT.moduleManagement.findTheCulprit()}</button>`: ``}
				
			</div>
		`;
	}

	_renderRowsHTML() {
		try {
			const rows = this._getFiltered();
			if (!rows.length) {
				return `<div class="bbmm-mm-empty">${LT.moduleManagement.noResults()}</div>`;
			}

			// Pull all saved notes and tag data once (avoid re-reading per row)
			const allNotes = _getNotesData();
			const tagData = _getTagData();

			const renderRow = (m) => {
				const planned = !!this._getTempActive(m.id);
				const changed = planned !== !!this._coreSnap?.[m.id];
				const verTxt  = m.version ? String(m.version) : "";

				// get the REAL Module object for the tag strip
				const modObj = game.modules.get(m.id);

				// Note badge: show if custom notes exist for this module
				const rawNote = _bbmmExtractEditorContent(allNotes[m.id] || "").trim();
				const hasCustomNote = !!rawNote && !_bbmmIsEmptyNoteHTML(rawNote);
				const noteBadge = hasCustomNote
					? `<span class="tag note" title="${hlp_esc(LT.modListCustomNotesExist())}">
						<i class="fa-solid fa-note-sticky fa-fw"></i>
					</span>`
					: "";
				
				// Compatibility color/tooltip applied to version tag
				let verColor = "";
				let verTitle = "";
				try {
					const compat = modObj?.compatibility ?? {};
					const core = game?.release?.version ?? game?.version ?? "0.0.0";
					const coreMajor = String(core).split(".")[0] ?? "";
					const targets = [compat.minimum, compat.verified].filter(Boolean).map(String);

					const isNewer = (a, b) => { try { return foundry.utils.isNewerVersion(a, b); } catch { return false; } };
					const isExactMatch = (t) => t === core;
					const isMajorOnly = (t) => /^\d+$/.test(t);
					const isMajorMatch = (t) => isMajorOnly(t) && t === coreMajor;
					const isHigherThanCore = (t) => {
						if (isMajorOnly(t)) return Number(t) > Number(coreMajor);
						return isNewer(t, core); // t > core
					};

					// Green when minimum or verified matches (exact) OR is major-only equal to core's major (e.g., "13" vs "13.x")
					const green = targets.some((t) => isExactMatch(t) || isMajorMatch(t));
					// Yellow when any target is higher than core
					const yellow = !green && targets.some((t) => isHigherThanCore(t));

					if (green) {
						verColor = "#16a34a"; // green
						verTitle = `${LT.moduleManagement.compatMatchesCore()} ${core}`;
					} else if (yellow) {
						verColor = "#d97706"; // amber
						verTitle = `${LT.moduleManagement.compatModuleExpects1()} ${targets.join(" / ")}; ${LT.moduleManagement.compatModuleExpects2()} ${core}`;
					} else {
						verColor = "#c7ca00ff"; // yellow
						verTitle = `${LT.moduleManagement.compatMinVer()}: ${targets.join(" / ") || "—"} • ${LT.moduleManagement.compatibility()}: ${core}`;
					}
				} catch (e) {
					DL(2, "BBMMModuleManagerApp::renderRowsHTML(): compat styling error", e);
					verColor = "";
					verTitle = "";
				}

				// ONLY deps/conf moved into notes header
				const depBadge = (m.requires?.length)
					? `<span class="tag dep" title="${hlp_esc(m.requires.join(", "))}">${LT.moduleManagement.dependencies()}: ${m.requires.length}</span>`
					: "";
				const conBadge = (m.conflicts?.length)
					? `<span class="tag con" title="${hlp_esc(m.conflicts.join(", "))}">${LT.moduleManagement.conflicts()}: ${m.conflicts.length}</span>`
					: "";
				
				/* recommended relationships badge */
				const recBadge = (m.recommends?.length)
					? `<span class="tag rec" title="${hlp_esc(m.recommends.join(", "))}">${LT.moduleManagement.recommendations()}: ${m.recommends.length}</span>`
					: "";

				const userTagChips = this._buildUserTagChips(m.id, tagData);
				return `
					<div class="row ${planned ? "on" : "off"} ${changed ? "chg" : ""} ${this.locks.has(m.id) ? "bbmm-locked" : ""}" data-id="${hlp_esc(m.id)}">
					<label class="toggle" onclick="event.stopPropagation()">
						<input type="checkbox" ${planned ? "checked" : ""} ${this.locks.has(m.id) ? "disabled" : ""}>
					</label>

					<div class="main">
						<div class="title" title="${hlp_esc(m.title)}">${hlp_esc(m.title)}</div>
						${userTagChips ? `<div class="bbmm-row-tag-chips">${userTagChips}</div>` : ""}
					</div>

					<div class="actions">
						<div class="tags">
						${noteBadge}
						${this._buildTagsFor(modObj)}
						${verTxt ? `<span class="ver-text" title="${hlp_esc(verTitle)}" style="${verColor ? `color:${verColor}` : ""}">v${hlp_esc(verTxt)}</span>` : ``}
						</div>
						<button type="button" class="btn-edit" data-id="${hlp_esc(m.id)}" title="${hlp_esc(LT.modListEditNotes())}">
						<i class="fa-solid fa-pen-to-square fa-fw"></i>
						</button>
					</div>

					<div class="notes">
						<div class="notes-head">
						${depBadge}${recBadge}${conBadge}
						</div>
						<div class="html"></div>
					</div>
					</div>
				`;
			};

			if (this.groupByTags) {
				const groups = this._getGrouped();
				return groups.map(({ tag, mods }) => {
					const label = tag ? hlp_esc(tag.label) : hlp_esc(LT.moduleManagement.untagged());
					return `<div class="bbmm-tag-group-header">${label}</div>` + mods.map(renderRow).join("");
				}).join("");
			}

			if (this.groupBySubtags) {
				const groups = this._getGroupedBySubtag();
				return groups.map(({ label, mods }) => {
					return `<div class="bbmm-tag-group-header">${hlp_esc(label)}</div>` + mods.map(renderRow).join("");
				}).join("");
			}

			return rows.map(renderRow).join("");
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_renderRowsHTML(): error", e);
			return `<div class="bbmm-mm-empty">Error rendering list.</div>`;
		}
	}

	async _renderHTML() {
		return (
			`<div class="bbmm-mm-root">
				${this._renderHeaderHTML()}
				<div class="bbmm-mm-body" id="bbmm-mm-body">
					${this._renderRowsHTML()}
				</div>
				${this._renderFooterHTML()}
			</div>`
		);
	}

	async _replaceHTML(result, _options) {
		// ensure locks are loaded
		if (!this._locksLoadedOnce) {
			this._locksLoadedOnce = true;
			if (!this.locks) this.locks = new Set();
			await this._loadLocks();
		}
		const content = this.element.querySelector(".window-content") || this.element;
		content.style.display = "flex";
		content.style.flexDirection = "column";
		content.style.height = "100%";
		content.style.minHeight = "0";
		content.innerHTML = result;
		this._root = content;

		// Inject help button into title bar
		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass:  "fas fa-circle-question",
				title: LT.buttons.help?.() ?? "Help"
			});
		} catch (e) {
			DL(2, "module-management.js | _onRender(): help inject failed", e);
		}

		// add the standard BBMM header button 
		try { injectBBMMHeaderButton(this.element); } catch (e) { DL(2, "BBMM MM | header btn inject failed", e); }

		// Reset temp from core on first open of this window
		await this._resetTempFromCore();

		// build dataset & draw using temp
		this._refreshDataset();
		this._rerender();

		// Expose the live instance for debugging
		try {
			this.element.__bbmmApp = this;
			window.BBMM_MM = this;
		} catch (e) { DL(2, "BBMM | failed to expose app instance", e); }

		// Explicit centering
		const _centerNow = () => {
			try {
				const el = this.element;
				const W = el.offsetWidth || 1000;
				const H = el.offsetHeight || 640;
				const left = Math.max((window.innerWidth  - W) / 2, 0);
				const top  = Math.max((window.innerHeight - H) / 2, 0);
				this.setPosition({ left, top, width: W, height: H });
			} catch (e) { DL(2, "BBMMModuleManagerApp::_centerNow(): failed", e); }
		};
		_centerNow();
		requestAnimationFrame(_centerNow); // center again after first paint/measure

		// size clamps
		try {
			const winEl = this.element;
			winEl.style.minWidth = this._minW + "px";
			winEl.style.maxWidth = this._maxW + "px";
			winEl.style.minHeight = this._minH + "px";
			winEl.style.maxHeight = this._maxH + "px";
		} catch {}

		// ensure dataset is live then draw
		this._refreshDataset();
		this._rerender();

		// wire events once
		if (!this._bound) {
			this._bound = true;

			// Lock toggle (button in the row's actions/tags)
			this._root.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.('[data-bbmm-action="toggle-lock"]');
				if (!btn) return;
				const id = btn.getAttribute("data-mod-id");
				if (!id) return;
				ev.stopPropagation();

				try {
					const nowLocked = !this.locks.has(id);
					if (nowLocked) {
						this.locks.add(id);
						DL(`BBMMModuleManagerApp | locked ${id}`);
					} else {
						this.locks.delete(id);
						DL(`BBMMModuleManagerApp | unlocked ${id}`);
					}

					// Instant, surgical UI update for this row only
					const row = btn.closest?.(".row");
					if (row) {
						// toggle the checkbox disabled
						const chk = row.querySelector('label.toggle input[type="checkbox"]');
						if (chk) chk.disabled = nowLocked;

						// flip the icon + color inline
						const ico = btn.querySelector("i.fa-solid");
						if (ico) {
							ico.classList.remove("fa-lock", "fa-lock-open");
							ico.classList.add(nowLocked ? "fa-lock" : "fa-lock-open");
							if (nowLocked) {
								ico.style.color = "orange";
							} else {
								ico.style.color = ""; // remove inline color
							}
						}

						// mark the row with a class for any dimming you already do
						if (nowLocked) row.classList.add("bbmm-locked");
						else row.classList.remove("bbmm-locked");
					}

					// Debounced save 
					this._queueSaveLocks();
				} catch (e) {
					DL(2, "BBMMModuleManagerApp | toggle lock failed", e);
				}
			}, true);

			// open module settings (gear)
			this._root.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.('[data-bbmm-action="open-settings"]');
				if (!btn) return;
				const id = btn.getAttribute("data-mod-id");
				if (!id) return;
				ev.stopPropagation();
				try {
					_bbmmOpenModuleSettingsTab(id);
					DL(`BBMMModuleManagerApp | open settings for ${id}`);
				} catch (e) { DL(2, "BBMMModuleManagerApp | open settings failed", e); }
			}, true);

			// edit notes (pencil)
			this._root.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.(".btn-edit");
				if (!btn) return;
				const id = btn.getAttribute("data-id");
				if (!id) return;
				ev.stopPropagation();
				try {
					_bbmmOpenNotesDialog(id);
					DL(`BBMMModuleManagerApp | open notes editor for ${id}`);
				} catch (e) { DL(2, "BBMMModuleManagerApp | open notes failed", e); }
			}, true);

			// expand/collapse row to show notes/description
			this._root.addEventListener("click", async (ev) => {
				const row = ev.target.closest?.(".row");
				if (!row) return;

				// ignore clicks on controls inside the row
				if (ev.target.closest?.("button, a, input, label")) return;

				const id = row.getAttribute("data-id");
				if (!id) return;

				// toggle class
				const willOpen = !row.classList.contains("expanded");
				row.classList.toggle("expanded", willOpen);

				if (!willOpen) return;

				// load note (or fallback to module description)
				try {
					const html = (typeof _bbmmRenderSavedNotesHTML === "function")
						? (await _bbmmRenderSavedNotesHTML(id))
						: "";
					const host = row.querySelector(".notes .html");
					if (host) host.innerHTML = html ? `<div class="bbmm-notes-html">${html}</div>` : `<div class="bbmm-notes-empty"></div>`;
					DL(`BBMMModuleManagerApp | expanded ${id} (notes length: ${html?.length || 0})`);
				} catch (e) {
					DL(2, "BBMMModuleManagerApp | expand failed", e);
				}
			}, true);
			
			// filter query (do NOT rebuild the toolbar DOM; keep focus intact)
			this._root.addEventListener("input", (ev) => {
				if (ev.target?.id !== "bbmm-mm-q") return;
				this.query = String(ev.target.value ?? "");
				this._rerender({ keepFocus: true });
			}, true);

			// Clear filter (X button)
			this._root.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.(".bbmm-filter-clear");
				if (!btn) return;

				// Reset internal query
				this.query = "";

				// Reset the input's visible value
				const input = this._root.querySelector("#bbmm-mm-q");
				if (input) input.value = "";

				// Rerender list with empty filter
				this._rerender({ keepFocus: true });
			}, true);

			// scope buttons
			this._root.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.(".bbmm-mm-scopes button");
				if (!btn) return;
				this.scope = btn.dataset.scope || "all";
				this._rerender({ keepFocus: true });
			}, true);

			// Group by Tags toggle
			this._root.addEventListener("click", (ev) => {
				if (!ev.target.closest?.("#bbmm-mm-group-tags")) return;
				this.groupByTags = !this.groupByTags;
				if (this.groupByTags) this.groupBySubtags = false;
				this._rerender({ keepFocus: true });
			}, true);

			// Group by Subtags toggle
			this._root.addEventListener("click", (ev) => {
				if (!ev.target.closest?.("#bbmm-mm-group-subtags")) return;
				this.groupBySubtags = !this.groupBySubtags;
				if (this.groupBySubtags) this.groupByTags = false;
				this._rerender({ keepFocus: true });
			}, true);

			// Manage Tags button
			this._root.addEventListener("click", (ev) => {
				if (!ev.target.closest?.("#bbmm-mm-manage-tags")) return;
				openTagManager();
			}, true);

			// Filter by Tags
			this._root.addEventListener("click", async (ev) => {
				if (!ev.target.closest?.("#bbmm-mm-filter-tags")) return;
				await this._openTagFilterDialog();
			}, true);

			// row toggle
			this._root.addEventListener("change", async (ev) => {
				const row = ev.target.closest?.(".row");
				if (!row) return;
				const id = row.getAttribute("data-id");
				if (!id) return;

				// If locked, revert and bail
				if (this.locks.has(id)) {
					try { ev.target.checked = !!this._getTempActive(id); } catch {}
					ui.notifications?.warn(LT.moduleManagement.lockBlocked());
					DL(`BBMMModuleManagerApp | toggle blocked by lock for ${id}`);
					return;
				}

				const cur = this._getTempActive(id);
				const next = !!ev.target.checked;
				if (cur === next) return;

				// If enabling, ensure deps first
				if (next) {
					const ok = await this._ensureDependenciesForEnable(id);
					if (!ok) { ev.target.checked = cur; return; }
				}

				// If disabling, ensure we handle dependents + orphaned requires
				if (!next) {
					const ok = await this._ensureSafeDisable(id);
					if (!ok) { ev.target.checked = cur; return; }
				}

				await this._setTempActive(id, next);
				this._rerender({ keepFocus: true });
			}, true);

			// footer: Save -> write core.moduleConfiguration and reload
			this._root.addEventListener("click", async (ev) => {
				if (ev.target?.id !== "bbmm-mm-save") return;

				// Compare CORE snapshot vs TEMP (not this.plan)
				try {
					// Use the in-memory snapshots if present; fall back to settings to be safe
					const coreSnap = this._coreSnap ?? foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
					const tempSnap = this._temp ?? foundry.utils.duplicate(game.settings.get(BBMM_ID, "tempModConfig") || {});

					let touched = 0;
					const allIds = new Set([...Object.keys(coreSnap), ...Object.keys(tempSnap)]);
					for (const id of allIds) {
						if (Boolean(coreSnap[id]) !== Boolean(tempSnap[id])) { touched++; break; }
					}

					if (!touched) {
						ui.notifications.info(LT.moduleManagement.noChanges());
						DL("BBMMModuleManagerApp::_saveViaCoreSettings(): no changes (coreSnap vs tempSnap matched)");
						return;
					}
				} catch (e) {
					// If the quick diff itself fails, just proceed to saving — the saver will diff again.
					DL(2, "BBMMModuleManagerApp | pre-save diff failed; proceeding to save", e);
				}

				DL("BBMMModuleManagerApp | applying changes via core.moduleConfiguration (from temp)");
				await this._saveViaCoreSettings();
			}, true);

			// footer: Deactivate All
			this._root.addEventListener("click", async (ev) => {
				if (ev.target?.id !== "bbmm-mm-deactivate-all") return;
				const ids = (this._mods ?? []).map(m => m.id).filter(id => !this.locks.has(id));
				const skipped = (this._mods ?? []).map(m => m.id).filter(id => this.locks.has(id));
				if (skipped.length) DL("BBMMModuleManagerApp | Deactivate All skipped locked modules", { skipped });
				await this._setTempActiveBulk([], ids);   // set OFF in temp
				this._rerender({ keepFocus: true });
			}, true);

			// footer: Activate All
			this._root.addEventListener("click", async (ev) => {
				if (ev.target?.id !== "bbmm-mm-activate-all") return;
				const ids = (this._mods ?? []).map(m => m.id).filter(id => !this.locks.has(id));
				const skipped = (this._mods ?? []).map(m => m.id).filter(id => this.locks.has(id));
				if (skipped.length) DL("BBMMModuleManagerApp | Activate All skipped locked modules", { skipped });
				await this._setTempActiveBulk(ids, []);   // set ON in temp
				this._rerender({ keepFocus: true });
			}, true);

			// footer: Find the Culprit (best-effort)
			this._root.addEventListener("click", (ev) => {
				const btn = ev.target?.closest?.("#bbmm-mm-culprit");
				if (!btn) return;

				try {
					const FTC = CONFIG.ui?.ftc; // set by FTC on init: CONFIG.ui.ftc = FindTheCulprit
					if (typeof FTC === "function") {
						DL("BBMMModuleManagerApp | launching FindTheCulprit via CONFIG.ui.ftc");
						new FTC().render(true); 
						return;
					}
					ui.notifications.warn("Find the Culprit module is enabled but not initialized yet.");
					DL(2, "BBMMModuleManagerApp | CONFIG.ui.ftc is not a function (FTC not initialized?)", { ftc: FTC });
				} catch (e) {
					DL(2, "BBMMModuleManagerApp | failed to open FindTheCulprit", e);
					ui.notifications.error("BBMM: Failed to open Find the Culprit.");
				}
			}, true);
		}
	}

	_rerender({ keepFocus = false } = {}) {
		const root = this._root;
		if (!root) return;

		// update counts + scope button states without replacing the whole toolbar
		try {
			const { enable, disable } = this._diffCounts();
			const cntE = root.querySelector("#bbmm-mm-cnt-enable");
			const cntD = root.querySelector("#bbmm-mm-cnt-disable");
			if (cntE) cntE.textContent = String(enable);
			if (cntD) cntD.textContent = String(disable);

			const scopes = root.querySelectorAll(".bbmm-mm-scopes button");
			for (const b of scopes) {
                const on = (b.dataset.scope === this.scope);
                if (on) b.classList.add("on"); else b.classList.remove("on");
			}

			const groupTagsBtn = root.querySelector("#bbmm-mm-group-tags");
			if (groupTagsBtn) groupTagsBtn.classList.toggle("on", this.groupByTags);
			const groupSubtagsBtn = root.querySelector("#bbmm-mm-group-subtags");
			if (groupSubtagsBtn) groupSubtagsBtn.classList.toggle("on", this.groupBySubtags);
		} catch {}

		// body list
		const body = root.querySelector("#bbmm-mm-body");
		if (body) {
			// preserve scroll if possible
			const top = body.scrollTop;
			body.innerHTML = this._renderRowsHTML();
			body.scrollTop = top;
		}

		// keep input focus/value when typing
		if (keepFocus) {
			const qEl = root.querySelector("#bbmm-mm-q");
			if (qEl && document.activeElement !== qEl) qEl.focus();
		}
	}
}

// Rewire Settings sidebar "Manage Modules" to open BBMMModuleManagerApp
Hooks.on("renderSettings", (_app, rootEl) => {
	if (!game.settings.get("bbmm", "enableModuleManagement")) return;
	try {
		const root = rootEl instanceof HTMLElement ? rootEl : (rootEl?.[0] ?? null);
		if (!root) return;

		// Already wired?
		if (root.dataset.bbmmManageModulesBound === "1") return;

		// Collect likely candidates across locales and core variants
		const candidates = [
			...root.querySelectorAll('button[data-action="moduleManagement"]'),
			...root.querySelectorAll('button[data-action="manage-modules"]'),
			// Locale-agnostic: Foundry v13 Settings menu uses data-app="modules"
			...root.querySelectorAll('button[data-app="modules"], a[data-app="modules"]'),
			...root.querySelectorAll('button, a')
		];

		const manageBtn = candidates.find(b => {
			const label = (b.textContent || b.ariaLabel || "").trim().toLowerCase();
			return (
				b.matches('button[data-action="moduleManagement"], button[data-action="manage-modules"]') ||
				b.matches('[data-app="modules"]') ||
				/manage modules|gérer les modules|gestionar módulos|gestire moduli|module verwalten/.test(label)
			);
		});

		if (!manageBtn) {
			DL(2, 'renderSettings(): Manage Modules button not found (no selector matched).');
			return;
		}

		// Mark once
		manageBtn.dataset.bbmmRewired = "1";
		root.dataset.bbmmManageModulesBound = "1";

		// Click handler: Shift-click opens core; normal click opens BBMM.
		manageBtn.addEventListener("click", (ev) => {
			try {
				if (ev.shiftKey) return; // allow core behavior when Shift is held
				ev.preventDefault();
				ev.stopPropagation();
				new BBMMModuleManagerApp().render(true);
			} catch (e) {
				// if anything goes wrong, fall back to core behavior
				console.error("BBMM | failed to open BBMMModuleManagerApp, falling back to core:", e);
			}
		}, true);
	} catch (e) {
		console.error("BBMM | renderSettings rewire failed:", e);
	}
});

/* Tooltip to advise shift+click will open core manage modules */
Hooks.on("renderSettings", (_app, rootEl) => {
	const root = rootEl instanceof HTMLElement ? rootEl : (rootEl?.[0] ?? null);
	if (!root) return;
	const btn =
		root.querySelector('button[data-bbmm-rewired="1"]') ||
		root.querySelector('button[data-action="moduleManagement"]') ||
		root.querySelector('[data-app="modules"]');
	if (!btn) {
		DL(2, 'renderSettings(tooltip): Manage Modules button not found for tooltip.');
		return;
	}
	btn.title = LT.moduleManagement.settingBtnToolTip();
	btn.setAttribute("data-tooltip", LT.moduleManagement.settingBtnToolTip());
});

Hooks.on("ready", () => {
	// Load persistent data caches (fire-and-forget; reads are fast and sync callers fall back gracefully)
	loadTagData().catch(e => DL(3, "module-management.js | ready: loadTagData failed", e));
	loadNotesData().catch(e => DL(3, "module-management.js | ready: loadNotesData failed", e));

	try {
		// Safely register the app class on the module API once the game is ready
		const MODID = (typeof BBMM_ID === "string" && BBMM_ID) ? BBMM_ID : "bbmm";
		const mod = game?.modules?.get?.(MODID);
		if (!mod) {
			DL(2, `module-management.js | API registration: module not found for id="${MODID}"`);
			return;
		}
		if (!mod.api) mod.api = {};
		mod.api.BBMMModuleManagerApp = BBMMModuleManagerApp;
		DL("module-management.js | BBMMModuleManagerApp registered on module API");
	} catch (e) {
		DL(3, "module-management.js | API registration failed", e);
	}

	// Reload listener
	try {
		const channel = `module.${BBMM_ID}`;
		// Avoid double-binding if hot reloaded
		if (game.bbmmReloadHookBound) return;
		game.bbmmReloadHookBound = true;

		game.socket.on(channel, (msg) => {
			try {
				if (!msg || msg.cmd !== "bbmm:reload") return;
				// If this client initiated it, we will also reload; harmless.
				DL("BBMM socket: reload received", msg);
				// Use core helper if present, else hard reload
				(foundry.utils?.debouncedReload?.() || window.location.reload)();
			} catch (e) {
				DL(2, "BBMM socket: reload handler error", e);
			}
		});
		DL("BBMM socket: reload listener bound", { channel });
	} catch (e) {
		DL(2, "BBMM socket: failed to bind reload listener", e);
	}

	/* ======== New Modules Prompt on Ready ======= */
	(async () => {
		try {
			if (!game.user.isGM) return; // only prompt GMs to avoid multiple prompts and confusion
			if (!game.settings.get(BBMM_ID, "promptEnableNewModules")) return; // setting disabled, do not prompt

			// Get current installed module IDs and previously known IDs
			const current = Array.from(game.modules.keys()).sort();
			let known = game.settings.get(BBMM_ID, "knownInstalledModules");
			if (!Array.isArray(known)) known = [];

			// First run: seed the list, do not prompt
			if (known.length === 0) {
				await game.settings.set(BBMM_ID, "knownInstalledModules", current);
				DL("module-management.js | knownInstalledModules seeded", { count: current.length });
				return;
			}

			const newIds = current.filter(id => !known.includes(id));

			// No new modules: optionally keep the stored list tidy (handles uninstalls)
			if (newIds.length === 0) {
				if (known.length !== current.length) {
					await game.settings.set(BBMM_ID, "knownInstalledModules", current);
					DL("module-management.js | knownInstalledModules updated (no new modules)", { count: current.length });
				}
				return;
			}

			// Build dialog content
			const content = document.createElement("div"); // root MUST have no attributes for DialogV2
			const p = document.createElement("p");
			p.textContent = LT.moduleManagement.newModulesIntro({ count: newIds.length });
			content.appendChild(p);

			const form = document.createElement("form");

			// Select all / none controls (ABOVE the list)
			const controlsRow = document.createElement("div");
			controlsRow.style.display = "flex";
			controlsRow.style.gap = "8px";
			controlsRow.style.margin = "8px 0 8px 0";

			const btnAll = document.createElement("button");
			btnAll.type = "button";
			btnAll.className = "bbmm-btn bbmm-newmods-all";
			btnAll.textContent = LT.moduleManagement.newModulesSelectAll();

			const btnNone = document.createElement("button");
			btnNone.type = "button";
			btnNone.className = "bbmm-btn bbmm-newmods-none";
			btnNone.textContent = LT.moduleManagement.newModulesSelectNone();

			controlsRow.appendChild(btnAll);
			controlsRow.appendChild(btnNone);
			form.appendChild(controlsRow);

			// Scroll container for long lists
			const listWrap = document.createElement("div");
			listWrap.style.maxHeight = "60vh";
			listWrap.style.overflowY = "auto";
			listWrap.style.paddingRight = "6px";

			for (const id of newIds) {
				const mod = game.modules.get(id);
				const title = mod?.title ?? id;

				const row = document.createElement("label");
				row.style.display = "flex";
				row.style.alignItems = "center";
				row.style.gap = "8px";
				row.style.margin = "2px 0";

				const cb = document.createElement("input");
				cb.type = "checkbox";
				cb.name = "bbmm-new-module";
				cb.value = id;
				cb.checked = true;

				const txt = document.createElement("span");
				txt.textContent = `${title} (${id})`;

				row.appendChild(cb);
				row.appendChild(txt);
				listWrap.appendChild(row);
			}

			form.appendChild(listWrap);
			content.appendChild(form);

			// Show dialog
			await new Promise((resolve) => {
				let done = false;
				const safe = () => { if (!done) { done = true; resolve(); } };

				const dlg = new foundry.applications.api.DialogV2({
					id: "bbmm-new-modules",
					modal: false,
					window: { title: LT.moduleManagement.newModulesTitle() },
					content,
					buttons: [
						{
							action: "enableReload",
							label: LT.moduleManagement.newModulesEnableAndReload(),
							icon: "fa-solid fa-rotate-right",
							default: true,
							callback: async () => {
								try {
									const selected = Array.from(dlg.element?.querySelectorAll('input[name="bbmm-new-module"]:checked') ?? []).map(el => el.value);

									// Record that we've seen these modules
									await game.settings.set(BBMM_ID, "knownInstalledModules", current);

									if (selected.length === 0) {
										ui.notifications.info(LT.moduleManagement.newModulesNoneSelected());
										DL("module-management.js | new modules prompt: enableReload clicked with none selected");
										safe();
										return;
									}

									const next = foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
									for (const id of selected) next[id] = true;

									DL("module-management.js | enabling newly installed modules", { selected });
									await game.settings.set("core", "moduleConfiguration", next);

									// Broadcast reload to all clients, then reload self
									if (game.user.isGM) {
										const channel = `module.${BBMM_ID}`;
										const payload = { cmd: "bbmm:reload", ts: Date.now() };
										DL("BBMM broadcast: sending reload to all clients (new modules enabled)", { channel, payload });
										game.socket.emit(channel, payload);
									}
									(foundry.utils?.debouncedReload?.() || window.location.reload)();
								} catch (e) {
									DL(3, "module-management.js | enableReload failed", e);
								} finally {
									safe();
								}
							}
						},
						{
							action: "dontAskAgain",
							label: LT.moduleManagement.newModulesDontAskAgain(),
							icon: "fa-solid fa-bell-slash",
							callback: async () => {
								try {
									await game.settings.set(BBMM_ID, "knownInstalledModules", current);
									DL("module-management.js | new modules prompt: marked current modules as known (dontAskAgain for these only)");
								} catch (e) {
									DL(2, "module-management.js | dontAskAgain failed", e);
								} finally {
									safe();
								}
							}
						},
						{
							action: "askLater",
							label: LT.moduleManagement.newModulesAskLater(),
							icon: "fa-solid fa-clock",
							callback: () => safe()
						}
					],
					close: () => safe()
				});

				dlg.render(true);

				// Bind Select All/None AFTER render
				let tries = 0;
				const bindTimer = setInterval(() => {
					const el = dlg.element;
					if (!el) {
						tries++;
						if (tries > 40) {
							clearInterval(bindTimer);
							DL(2, "module-management.js | new modules prompt: failed to bind select all/none (no dlg.element)");
						}
						return;
					}

					const allBtn = el.querySelector(".bbmm-newmods-all");
					const noneBtn = el.querySelector(".bbmm-newmods-none");
					if (!allBtn || !noneBtn) {
						tries++;
						if (tries > 40) {
							clearInterval(bindTimer);
							DL(2, "module-management.js | new modules prompt: failed to bind select all/none (buttons not found)");
						}
						return;
					}

					clearInterval(bindTimer);
					DL("module-management.js | new modules prompt: bound select all/none buttons");

					allBtn.addEventListener("click", (ev) => {
						ev.preventDefault();
						for (const cb of (dlg.element?.querySelectorAll('input[name="bbmm-new-module"]') ?? [])) cb.checked = true;
					});

					noneBtn.addEventListener("click", (ev) => {
						ev.preventDefault();
						for (const cb of (dlg.element?.querySelectorAll('input[name="bbmm-new-module"]') ?? [])) cb.checked = false;
					});
				}, 25);

			});
		} catch (err) {
			DL(2, "module-management.js | new modules prompt block failed", err);
		}
	})();


	// Expose tag app openers on globalThis.bbmm
	globalThis.bbmm ??= {};
	Object.assign(globalThis.bbmm, { openTagManager, openModuleTagsApp });

	DL("module-management.js | ready fired")
});

Hooks.on("setup", () => DL("module-management.js | setup fired"));
Hooks.once("init", () => {DL("module-management.js | init hook — file loaded");});