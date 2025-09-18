/* BBMM: Manage Modules list restyle ===========================================
   	- Hook: renderModuleManagement
	- Goals:
		• Make each module entry a compact, cardlike row (similar to changelog left column)
		• Whole row visually selectable (does not toggle enable/disable yet)
		• Keep this purely presentational (no core behavior changes)
============================================================================== */
import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";

async function _bbmmWaitFor(test, timeoutMs = 1500, intervalMs = 50) {
	const t0 = Date.now();
	return new Promise((resolve) => {
		const tick = () => {
			try { if (test()) return resolve(true); } catch {}
			if (Date.now() - t0 >= timeoutMs) return resolve(false);
			setTimeout(tick, intervalMs);
		};
		tick();
	});
}

// Seed the <prose-mirror> with HTML using multiple strategies
async function _bbmmSeedProseMirror(pm, html) {
	try {
		if (!pm) return;

		// 1) preferred: component API / value
		let seeded = false;
		try {
			if (typeof pm.setHTML === "function") { await pm.setHTML(html); seeded = true; }
		} catch {}
		if (!seeded) {
			try { pm.value = html; seeded = !!pm.value; } catch {}
		}

		// 2) if not seeded yet, wait for the internal editor to mount then write directly
		if (!seeded) {
			const ok = await _bbmmWaitFor(() => pm.shadowRoot?.querySelector?.(".ProseMirror"));
			const doc = pm.shadowRoot?.querySelector?.(".ProseMirror");
			if (ok && doc) {
				try {
					doc.innerHTML = html || "";
					seeded = true;
				} catch {}
			}
		}

		// 3) one more microtask to fight late upgrades
		if (!seeded) {
			queueMicrotask(() => { try { pm.value = html; } catch {} });
		}

		DL(`module-management | seed prose-mirror ${seeded ? "OK" : "fallback"}`);
	} catch (e) {
		DL(2, "module-management | _bbmmSeedProseMirror(): error", e);
	}
}

// Extract just the editor content HTML from whatever we have saved
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

/*	build one compact row from an existing <li> */
function _bbmmBuildModRow(li) {
	try {
		const pkgId = li.getAttribute("data-module-id") || li.getAttribute("data-package-id") || "";
		const nameEl = li.querySelector(".package-overview .title");
		const versionEl = li.querySelector(".package-overview .badge, .package-overview .tag.badge");
		const authorEl = li.querySelector(".package-description .author");
		const cb = li.querySelector('label.package-title input[type="checkbox"]');

		const name = (nameEl?.textContent ?? pkgId).trim();
		const version = (versionEl?.textContent ?? "").trim();
		const author = (authorEl?.textContent ?? "").trim();

		const row = document.createElement("div");
		row.className = "bbmm-modrow";
		row.dataset.packageId = pkgId;

		// left: checkbox
		const colLeft = document.createElement("div");
		colLeft.className = "bbmm-col-left";
		if (cb) {
			cb.classList.add("bbmm-toggle");
			colLeft.appendChild(cb);
		}
		row.appendChild(colLeft);

		// middle
		const colMid = document.createElement("div");
		colMid.className = "bbmm-col-middle";
		const elName = document.createElement("div");
		elName.className = "bbmm-name";
		elName.textContent = name;
		const elMeta = document.createElement("div");
		elMeta.className = "bbmm-meta";
		if (version) { const v = document.createElement("span"); v.textContent = version; elMeta.appendChild(v); }
		if (author) { const a = document.createElement("span"); a.textContent = author; elMeta.appendChild(a); }
		colMid.appendChild(elName);
		colMid.appendChild(elMeta);
		row.appendChild(colMid);

		// right: tags + edit button
		const colRight = document.createElement("div");
		colRight.className = "bbmm-col-right";
		const tags = li.querySelectorAll(".package-overview .tag");
		if (tags.length) {
			const frag = document.createDocumentFragment();
			for (const t of tags) {
				const clone = t.cloneNode(true);
				clone.classList.add("bbmm-tag");
				frag.appendChild(clone);
			}
			colRight.appendChild(frag);
		}

		const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "bbmm-edit tag flexrow";
        editBtn.setAttribute("aria-label", game.i18n.localize("bbmm.modListEditNotes"));
        editBtn.innerHTML = `<i class="fa-solid fa-pen-to-square fa-fw"></i>`;
        editBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            _bbmmOpenNotesDialog(pkgId);
        });
        colRight.appendChild(editBtn);

		row.appendChild(colRight);

		// selectable highlight (visual only)
		row.addEventListener("click", (ev) => {
			if (ev.target instanceof HTMLInputElement && ev.target.type === "checkbox") return;
			row.classList.toggle("bbmm-selected");
			DL(`module-management | toggled selection for ${pkgId}`);
		});

		return row;
	} catch (err) {
		DL(3, "module-management | _bbmmBuildModRow(): failed", err);
		return null;
	}
}

async function _bbmmOpenNotesDialog(moduleId) {
		try {
			const KEY = "moduleNotes";
			const allNotes = game.settings.get("bbmm", KEY) || {};
			const saved = typeof allNotes === "object" ? (allNotes[moduleId] || "") : "";
			const seed = _bbmmExtractEditorContent(saved);

			// bare content <div> per DialogV2 rules
			const content = document.createElement("div");

			// build the form
			const form = document.createElement("form");
			form.className = "bbmm-notes-form";
			const group = document.createElement("div");
			group.className = "form-group";

			const label = document.createElement("label");
			label.textContent = game.i18n.localize("bbmm.modListNotesLabel");
			group.appendChild(label);

			const pm = foundry.applications.elements.HTMLProseMirrorElement.create({
				name: "notes",
				value: seed,
				height: 320,
				collaborate: false,
				toggled: false,
				aria: { label: "BBMM Notes" },
				dataset: { bbmmId: moduleId }	// for easy lookup on save
			});

			group.appendChild(pm);
			form.appendChild(group);
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
					title: game.i18n.format("bbmm.modListEditTitle", { id: moduleId }),
					icon: "fa-solid fa-pen-to-square",
					resizable: true
				},
				content,
				render: (app) => {
					dlgRef = app;

					// force width; defeat theme clamps; center
					try {
						const el = app.element;
						el.style.maxWidth = "none";
                        el.style.width = `${TARGET_WIDTH}px`;
                        el.style.height = `${TARGET_HEIGHT}px`;
						// center horizontally + vertically
                        const left = Math.max((window.innerWidth - TARGET_WIDTH) / 2, 0);
                        const top = Math.max((window.innerHeight - TARGET_HEIGHT) / 2, 0);
                        app.setPosition({ width: TARGET_WIDTH, height: TARGET_HEIGHT, left, top });

					} catch {}
				},
				buttons: [
					{ action: "cancel", label: game.i18n.localize("bbmm.cancel"), icon: "fa-solid fa-xmark" },
					{
						action: "save",
						label: game.i18n.localize("bbmm.save"),
						icon: "fa-solid fa-floppy-disk",
						default: true,
						callback: async () => {
							const html = await readFromProseMirror();	// content-only
							const notes = foundry.utils.duplicate(game.settings.get("bbmm", KEY) || {});
							notes[moduleId] = html;
							await game.settings.set("bbmm", KEY, notes);
							ui.notifications.info(game.i18n.localize("bbmm.modListNotesSaved"));
							DL("module-management | saved notes for " + moduleId, { length: html.length });
						}
					}
				]
			});

			await dlg.render(true);
			// assert width again after paint
			try {
				dlg.element.style.maxWidth = "none";
				dlg.element.style.width = `${TARGET_WIDTH}px`;
                dlg.element.style.height = `${TARGET_HEIGHT}px`
				dlg.setPosition({ width: TARGET_WIDTH, height: TARGET_HEIGHT, left, top });
				if (typeof dlg.center === "function") dlg.center();
			} catch {}

			DL("module-management | opened notes dialog (V2) for " + moduleId);
		} catch (err) {
			DL(3, "module-management | _bbmmOpenNotesDialog(DialogV2): error", err);
		}
	}

/*	render hook */
Hooks.on("renderModuleManagement", (app, rootEl) => {
	try {
		const root = (rootEl instanceof HTMLElement) ? rootEl : (app?.element ?? null);
		if (!root) {
			DL(2, "module-management | renderModuleManagement(): root element missing");
			return;
		}
		root.classList.add("bbmm-modmgmt");

		DL("module-management | renderModuleManagement(): init (v13)");

		// v13 rows live in a <menu class="package-list scrollable">
		const list =
			root.querySelector("menu.package-list.scrollable") ||
			root.querySelector("menu.package-list") ||
			root.querySelector(".package-list");

		if (!list) {
			DL(2, "module-management | package list not found");
		 return;
		}

		// clean any old grids from previous renders
		for (const old of list.querySelectorAll(".bbmm-modlist")) old.remove();

		list.classList.add("bbmm-compact");

		const grid = document.createElement("div");
		grid.className = "bbmm-modlist";

		// Only direct module rows
		const items = list.querySelectorAll(":scope > li.package");
		DL(`module-management | found ${items.length} list items`);

		let built = 0;
		for (const li of items) {
			if (li.dataset.bbmmTransformed === "1") continue;
			const row = _bbmmBuildModRow(li);
			if (row) {
				grid.appendChild(row);
				li.dataset.bbmmTransformed = "1";
				li.style.display = "none";	// keep for form submit; hide visually
				built++;
			}
		}

		if (!built) {
			DL(2, "module-management | nothing transformed (selectors may need tuning)");
			return;
		}

		// ✅ append inside the <menu> so it inherits the scroll behavior
		list.appendChild(grid);

		DL(`module-management | injected compact grid with ${built} rows`);
	} catch (err) {
		DL(3, "module-management | renderModuleManagement(): error", err);
	}
});

Hooks.on("setup", () => DL("module-management.js | setup fired"));
Hooks.on("ready", () => DL("module-management.js | ready fired"));
Hooks.once("init", () => {DL("module-management.js | init hook — file loaded");});