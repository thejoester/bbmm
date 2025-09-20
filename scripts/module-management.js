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

async function _bbmmRenderSavedNotesHTML(moduleId) {
	try {
		const KEY = "moduleNotes";
		const all = game.settings.get("bbmm", KEY) || {};
		const raw = _bbmmExtractEditorContent(all[moduleId] || "");
		if (!raw) return "";

		// Try to enrich (safe; NOT TextEditor.create)
		try {
			const html = await TextEditor.enrichHTML(raw, { async: true, secrets: false });
			return html || raw;
		} catch (e) {
			DL(2, "module-management | enrichHTML failed; using raw", e);
			return raw;
		}
	} catch (err) {
		DL(2, "module-management | _bbmmRenderSavedNotesHTML(): error", err);
		return "";
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

        colMid.appendChild(elName);
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
		editBtn.setAttribute("aria-label", LT.modListEditNotes());
		editBtn.innerHTML = `<i class="fa-solid fa-pen-to-square fa-fw"></i>`;
		editBtn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			_bbmmOpenNotesDialog(pkgId);
		});
		colRight.appendChild(editBtn);

		row.appendChild(colRight);

		// ── BBMM notes preview panel (starts collapsed) ───────────────────────
		const notesPanel = document.createElement("div");
		notesPanel.className = "bbmm-notes-panel";
		notesPanel.innerHTML = `<div class="bbmm-notes-empty"></div>`;
		row.appendChild(notesPanel);

		// ── Expand/Collapse on row click (not selection) ──────────────────────
		row.addEventListener("click", async (ev) => {
			// ignore clicks on interactive controls
			if (ev.target.closest("button, a, input, label, .bbmm-col-right")) return;

			const isOpen = row.classList.toggle("bbmm-open");
			if (!isOpen) {
				DL(`module-management | collapsed ${pkgId}`);
				return;
			}

			// expand: load notes from settings each time (fresh)
			try {
				const html = await _bbmmRenderSavedNotesHTML(pkgId);
				notesPanel.innerHTML = html
					? `<div class="bbmm-notes-html">${html}</div>`
					: `<div class="bbmm-notes-empty"></div>`;
				DL(`module-management | expanded ${pkgId} (notes length: ${html?.length || 0})`);
			} catch (e) {
				DL(2, "module-management | expand failed", e);
			}
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
        const TARGET_HEIGHT = 430;

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

                // helper: center using constants (no center())
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
                    action: "save",
                    label: LT.buttons.save(),
                    icon: "fa-solid fa-floppy-disk",
                    default: true,
                    callback: async () => {
                        const html = await readFromProseMirror();	// content-only
                        const notes = foundry.utils.duplicate(game.settings.get("bbmm", KEY) || {});
                        notes[moduleId] = html;
                        await game.settings.set("bbmm", KEY, notes);
                        ui.notifications.info(LT.modListNotesSaved());
                        DL("module-management | saved notes for " + moduleId, { length: html.length });
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

		// append inside the <menu> so it inherits the scroll behavior
		list.appendChild(grid);

		DL(`module-management | injected compact grid with ${built} rows`);
	} catch (err) {
		DL(3, "module-management | renderModuleManagement(): error", err);
	}
});

Hooks.on("setup", () => DL("module-management.js | setup fired"));
Hooks.on("ready", () => DL("module-management.js | ready fired"));
Hooks.once("init", () => {DL("module-management.js | init hook — file loaded");});