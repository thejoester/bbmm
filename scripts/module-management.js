/* BBMM: Manage Modules list restyle ===========================================
   	- Hook: renderModuleManagement
	- Goals:
		• Make each module entry a compact, cardlike row (similar to changelog left column)
		• Whole row visually selectable (does not toggle enable/disable yet)
		• Keep this purely presentational (no core behavior changes)
============================================================================== */
import { DL } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";

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

/* Create the small gear button for a module row. */
function _bbmmCreateSettingsGear(modId) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "bbmm-settings tag flexrow";
	btn.setAttribute("aria-label", LT.openSettings());
	btn.setAttribute("data-bbmm-action", "open-settings");
	btn.setAttribute("data-mod-id", modId);
	btn.innerHTML = `<i class="fa-solid fa-gear fa-fw"></i>`;
	btn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		_bbmmOpenModuleSettingsTab(modId);
	});
	return btn;
}

/* Render saved notes HTML for display in the expanded panel */
async function _bbmmRenderSavedNotesHTML(moduleId) {
	try {
		const KEY = "moduleNotes";

		// Use the correct namespace id (BBMM_ID), not a string literal.
		const all = game.settings.get(BBMM_ID, KEY) || {};
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

/* copy native checkbox states → BBMM clones */
function _bbmmSyncClonesFromNative(root) {
	try {
		const natives = root.querySelectorAll('label.package-title input[type="checkbox"]');
		let n = 0;
		for (const cb of natives) {
			const clone = cb.bbmmClone;
			if (!clone) continue;
			clone.checked = cb.checked;
			n++;
		}
		DL(`module-management | _bbmmSyncClonesFromNative: synced ${n} clone(s)`);
	} catch (e) {
		DL(2, "module-management | _bbmmSyncClonesFromNative failed", e);
	}
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

/* Open the notes editor dialog for a specific module */
async function _bbmmOpenNotesDialog(moduleId) {
    try {
        const KEY = "moduleNotes";
        const allNotes = game.settings.get(BBMM_ID, KEY) || {};
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

						// If effectively empty (including ProseMirror-trailingBreak cases) → delete entry
						const notes = foundry.utils.duplicate(game.settings.get(BBMM_ID, KEY) || {});
						if (_bbmmIsEmptyNoteHTML(html)) {
							if (moduleId in notes) delete notes[moduleId];

							// If nothing left, store {} to keep setting small
							if (!Object.keys(notes).length) {
								await game.settings.set(BBMM_ID, KEY, {});
							} else {
								await game.settings.set(BBMM_ID, KEY, notes);
							}

							ui.notifications.info(LT.modListNotesDeleted?.() ?? "Note cleared.");
							DL(`module-management | cleared empty note for ${moduleId}`);
							return;
						}

						// Non-empty → save/update
						notes[moduleId] = html;
						await game.settings.set(BBMM_ID, KEY, notes);

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

/*	build one compact row from an existing <li> */
function _bbmmBuildModRow(li, root) {
	try {
		// Resolve a safe root to use for native→BBMM sync calls
		const __bbmmResolveRoot = () => (
			root ||
			(li instanceof HTMLElement ? li.closest(".bbmm-modmgmt") : null) ||
			document
		);
		const pkgId = li.getAttribute("data-module-id") || li.getAttribute("data-package-id") || "";
		const nameEl = li.querySelector(".package-overview .title");
		const cb = li.querySelector('label.package-title input[type="checkbox"]');

		const name = (nameEl?.textContent ?? pkgId).trim();
		

        // build a lowercased "search blob" from the original LI's text + id
		const searchBlob =
			((li.textContent ?? "") + " " + pkgId)
				.replace(/\s+/g, " ")
				.toLowerCase()
				.trim();

		const row = document.createElement("div");
		row.className = "bbmm-modrow";
		row.dataset.packageId = pkgId;

        row.dataset.search = searchBlob; // used by filter

		// left: checkbox (clone)
		const colLeft = document.createElement("div");
		colLeft.className = "bbmm-col-left";
		if (cb) {
			// Create a visual clone for BBMM; do not submit it with the form
			const cloneCb = cb.cloneNode(true);
			cloneCb.classList.add("bbmm-toggle");
			cloneCb.removeAttribute("id");    // avoid duplicate IDs
			cloneCb.removeAttribute("name");  // prevent duplicate submission
			cloneCb.checked = cb.checked;

			// Cross-link for fast syncing in either direction
			cloneCb.bbmmNative = cb;
			cb.bbmmClone = cloneCb;

			// BBMM -> native (user clicks our checkbox)
			cloneCb.addEventListener("change", () => {
			try {
				cb.checked = cloneCb.checked;
				cb.dispatchEvent(new Event("change", { bubbles: true }));
				DL(`module-management | mirror BBMM→native ${pkgId}: ${cloneCb.checked}`);

				// Dependency dialog flips native checkboxes asynchronously.
				// Burst resync so BBMM clones match after dialog actions.
				const hostRoot = __bbmmResolveRoot();
				queueMicrotask(() => _bbmmSyncClonesFromNative(hostRoot));
				setTimeout(() => _bbmmSyncClonesFromNative(hostRoot), 60);
				setTimeout(() => _bbmmSyncClonesFromNative(hostRoot), 200);
			} catch (e) {
				DL(2, `module-management | mirror BBMM→native failed ${pkgId}`, e);
			}
		}, { passive: true });

			// native -> BBMM (covers any native toggles that DO fire change)
			if (!cb.dataset.bbmmMirrorBound) {
				cb.addEventListener("change", () => {
					try {
						if (cb.bbmmClone) cb.bbmmClone.checked = cb.checked;
						DL(`module-management | mirror native→BBMM ${pkgId}: ${cb.checked}`);
					} catch (e) {
						DL(2, `module-management | mirror native→BBMM failed ${pkgId}`, e);
					}
				}, { passive: true });
				cb.dataset.bbmmMirrorBound = "1";
			}

			colLeft.appendChild(cloneCb);
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
		// settings gear (if applicable)
		try {
			if (_bbmmModuleHasConfigSettings(pkgId)) {
				const gearBtn = _bbmmCreateSettingsGear(pkgId);
				colRight.prepend(gearBtn); // ensure left-most
				DL(`module-management | settings gear added for ${pkgId}`);
			} else {
				DL(`module-management | no config settings for ${pkgId}`);
			}
		} catch (e) {
			DL(2, `module-management | settings gear inject failed for ${pkgId}`, e);
		}
		// Edit notes button
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

		// notes panel (initially collapsed)
		const notesPanel = document.createElement("div");
		notesPanel.className = "bbmm-notes-panel";
		notesPanel.innerHTML = `<div class="bbmm-notes-empty"></div>`;
		row.appendChild(notesPanel);

		// expand/collapse on row click 
		row.addEventListener("click", async (ev) => {
			
            // ignore clicks on interactive controls and inside notes panel
            if (ev.target.closest("button, a, input, label, .bbmm-col-right, .bbmm-notes-panel")) return;

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

/*	render hook */
/*	render hook */
Hooks.on("renderModuleManagement", (app, rootEl) => {
	try {

		// Check if enabled
		if (!game.settings.get("bbmm", "enableModuleManagement")) {
			DL("module-management | enhancements disabled (world setting)");
			return;
		}

		// Patch static SearchFilter methods to be more robust
		try {
			if (!SearchFilter.__bbmmPatched) {
				const origClean = SearchFilter.cleanQuery;
				SearchFilter.cleanQuery = function (q) {
					if (q == null) return "";
					if (typeof q !== "string") q = String(q);
					try { return origClean.call(this, q); }
					catch { return (q ?? "").trim?.() ?? ""; }
				};
				const origTest = SearchFilter.testQuery;
				SearchFilter.testQuery = function (query, ...rest) {
					if (query == null) {
						try { query = this?.input?.value ?? ""; } catch { query = ""; }
					}
					try { return origTest.call(this, query, ...rest); }
					catch (e) { DL(2, "module-management | guarded SearchFilter.testQuery error", e); return true; }
				};
				SearchFilter.__bbmmPatched = true;
				DL("module-management | patched static SearchFilter.cleanQuery/testQuery");
			}
		} catch (e) {
			DL(2, "module-management | failed to patch static SearchFilter", e);
		}

		// Find the root element
		const root = (rootEl instanceof HTMLElement) ? rootEl : (app?.element ?? null);
		if (!root) {
			DL(2, "module-management | renderModuleManagement(): root element missing");
			return;
		}
		root.classList.add("bbmm-modmgmt");

		// Ensure our hidden class exists (once) for fast show/hide with no layout thrash
		if (!document.getElementById("bbmm-hidden-style")) {
			const st = document.createElement("style");
			st.id = "bbmm-hidden-style";
			st.textContent = `.bbmm-modrow.bbmm-hidden{display:none !important}`;
			document.head.appendChild(st);
		}

		DL("module-management | renderModuleManagement(): initiated");

		// Find the <menu> or .package-list container
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

		// overall stopwatch for the build
		const tBuild0 = performance.now();

		for (const li of items) {
			if (li.dataset.bbmmTransformed === "1") continue;

			// per-item stopwatch
			const t0 = performance.now();

			// NOTE: pass root so click → dependency dialog resync can use it
			const row = _bbmmBuildModRow(li, root);
			if (!row) continue;

			grid.appendChild(row);
			li.dataset.bbmmTransformed = "1";
			built++;

			const t1 = performance.now();
			const pkgId =
				row?.dataset?.packageId ||
				li.getAttribute("data-module-id") ||
				li.getAttribute("data-package-id") ||
				"";

			DL(`module-management | build item ${pkgId}: ${(t1 - t0).toFixed(1)}ms`);
		}

		// overall timing
		const tBuild1 = performance.now();
		DL(`module-management | built ${built}/${items.length} rows in ${(tBuild1 - tBuild0).toFixed(1)}ms`);

		if (!built) {
			DL(2, "module-management | nothing transformed (selectors may need tuning)");
			return;
		}

		// put BBMM grid as a SIBLING after the native <menu>
		list.insertAdjacentElement("afterend", grid);

		// push the native menu off-screen so core search still operates but theme rules won't hide our grid
		list.classList.add("bbmm-source-offscreen");

		// initial clone ← native sync so the BBMM grid shows correct state on open
		_bbmmSyncClonesFromNative(root);

		// Mirror the native filter's visibility onto BBMM rows
		try {
			const menuEl = root.querySelector("menu.package-list") || root.querySelector(".package-list");
			const grid = menuEl?.nextElementSibling?.classList?.contains("bbmm-modlist")
				? menuEl.nextElementSibling
				: root.querySelector(".bbmm-modlist");
			if (!menuEl || !grid) throw new Error("missing menu/grid");

			// menu-scoped squelch to suppress MO storms during native filter bulk flips
			menuEl.__bbmmSquelchMo = false;

			// Read current query text (lowercased, trimmed). Fall back safely.
			const getQuery = () => {
				try {
					const q =
						app?.searchFilter?.input?.value ??
						menuEl.querySelector('input[name="search"]')?.value ??
						"";
					return String(q ?? "").toLowerCase().trim();
				} catch { return ""; }
			};

			// Strict substring match against the row's cached search blob (dataset.search).
			const bbmmMatchesQuery = (row, q) => {
				if (!q) return true;
				try {
					const blob = row?.dataset?.search ?? "";
					return blob.includes(q);
				} catch { return true; }
			};

			// Build fresh maps each pass (fast) — avoid stale references
			const buildMaps = () => {
				const liById = new Map();
				for (const li of menuEl.querySelectorAll(':scope > li.package')) {
					const id = li.getAttribute("data-module-id") || li.getAttribute("data-package-id") || "";
					if (id) liById.set(id, li);
				}
				const rowById = new Map();
				for (const row of grid.querySelectorAll(".bbmm-modrow")) {
					const id = row.dataset.packageId || "";
					if (id) rowById.set(id, row);
				}
				return { liById, rowById };
			};

			// Fast visibility test — no heavy style reads, but detect when core hides inner content
			const isNativeShown = (li) => {
				try {
					// Core ways it hides the <li> itself
					if (li.hidden) return false;
					if (li.classList.contains("hidden")) return false;
					if (li.style && li.style.display === "none") return false;

					// Check a stable inner container for actual visibility.
					const inner =
						li.querySelector(".package-overview") ||
						li.firstElementChild ||
						li;
					// clientWidth/Height==0 is a cheap visibility proxy (read-phase only).
					if ((inner.clientWidth === 0 && inner.clientHeight === 0)) return false;

					return true;
				} catch {
					// Fail-open to avoid hiding good rows on errors
					return true;
				}
			};

			const mirrorOnce = () => {
				const t0 = performance.now();

				// Snapshot query once per pass
				const q = getQuery();

				// map builder
				const { liById, rowById } = buildMaps();

				// READ PHASE: compute desired visibility (native result AND BBMM text match)
				const decisions = [];
				let shown = 0, hidden = 0, firstShownId = null;

				for (const [id, li] of liById) {
					const row = rowById.get(id);
					if (!row) continue;

					// native visibility
					let show = isNativeShown(li);
					try {
						if (li.hidden) show = false;
						else if (li.classList.contains("hidden")) show = false;
						else if (li.style && li.style.display === "none") show = false;
						else {
							// Some themes hide only inner content; treat 0x0 as hidden.
							const inner = li.querySelector(".package-overview") || li.firstElementChild || li;
							if (inner && inner.clientWidth === 0 && inner.clientHeight === 0) show = false;
						}
					} catch {}

					// BBMM strict substring filter on the module's cached search text
					if (show && q) show = bbmmMatchesQuery(row, q);

					if (show) { shown++; if (!firstShownId) firstShownId = id; }
					else { hidden++; }

					decisions.push({ row, show });
				}
				const tRead = performance.now();

				// WRITE PHASE: toggle a class + hidden boolean only if needed
				for (const d of decisions) {
					const shouldHide = !d.show;
					if (d.row.classList.contains("bbmm-hidden") !== shouldHide) {
						d.row.classList.toggle("bbmm-hidden", shouldHide);
					}
					if (!!d.row.hidden !== shouldHide) d.row.hidden = shouldHide;
				}
				const tWrite = performance.now();

				DL(`module-management | mirror(filter): shown=${shown}, hidden=${hidden}` +
					(firstShownId ? `, first=${firstShownId}` : ``) +
					`, read=${(tRead - t0).toFixed(1)}ms, write=${(tWrite - tRead).toFixed(1)}ms, total=${(tWrite - t0).toFixed(1)}ms`);
			};

			// Once-per-frame scheduler (no duplicate identifier)
			const scheduleMirror = (() => {
				let scheduled = false;
				return () => {
					if (scheduled) return;
					scheduled = true;
					requestAnimationFrame(() => {
						scheduled = false;
						mirrorOnce();
					});
				};
			})();

			// Prefer libWrapper; otherwise patch the instance filter
			const tryPatchSearchFilter = () => {
				const sf = app?.searchFilter;

				if (globalThis.libWrapper) {
					try {
						if (!SearchFilter.__bbmmFilterWrapped) {
							libWrapper.register("bbmm", "SearchFilter.prototype.filter", function (wrapped, query, ...args) {
								menuEl.__bbmmSquelchMo = true; // suppress MO during bulk flips
								let out;
								try {
									out = wrapped.call(this, query, ...args);
									// immediate single mirror for snappy UI
									mirrorOnce();
								} catch (e) {
									DL(3, "module-management | SearchFilter.filter (libWrapper) error", e);
								} finally {
									// re-enable MO next frame (no second mirror)
									requestAnimationFrame(() => { menuEl.__bbmmSquelchMo = false; });
								}
								return out;
							}, "WRAPPER");
							SearchFilter.__bbmmFilterWrapped = true;
							DL("module-management | libWrapper: wrapped SearchFilter.prototype.filter (squelch MOs)");
						}
						return true;
					} catch (e) {
						DL(2, "module-management | libWrapper wrap failed, falling back to instance patch", e);
					}
				}

				// Instance-level fallback
				if (!sf || sf.__bbmmMirrorPatched) return false;
				const origFilter = sf.filter.bind(sf);
				sf.filter = (query, ...args) => {
					menuEl.__bbmmSquelchMo = true;
					let out;
					try {
						out = origFilter(query, ...args);
						mirrorOnce(); // single immediate pass
					} catch (e) {
						DL(3, "module-management | SearchFilter.filter (instance) error", e);
					} finally {
						requestAnimationFrame(() => { menuEl.__bbmmSquelchMo = false; });
					}
					return out;
				};
				sf.__bbmmMirrorPatched = true;
				DL("module-management | patched app.searchFilter.filter() (squelch MOs)");
				return true;
			};

			// Try once now, then poll a few times in case the SearchFilter isn't ready yet
			if (!tryPatchSearchFilter()) {
				let attempts = 0;
				const t = setInterval(() => { if (tryPatchSearchFilter() || ++attempts >= 10) clearInterval(t); }, 50);
			}

			// Delegate typing on the native search box (once-per-frame mirror)
			if (!root.__bbmmDelegatedMirror) {
				const onKeyOrInput = (ev) => {
					const target = ev.target;
					if (!(target instanceof HTMLInputElement)) return;
					if (target.name !== "search") return;
					scheduleMirror();
				};
				root.addEventListener("input", onKeyOrInput, true);
				root.addEventListener("keyup", onKeyOrInput, true);
				root.__bbmmDelegatedMirror = true;
				DL("module-management | delegated mirror bound on window root");
			}

			// Observe the native menu for changes that affect visibility — avoid subtree floods
			const mo = new MutationObserver(() => {
				if (menuEl.__bbmmSquelchMo) return;
				scheduleMirror();
			});
			mo.observe(menuEl, {
				attributes: true,
				attributeFilter: ["class","style","hidden"],
				childList: true,
				subtree: false
			});

			// First mirror after initial paint
			scheduleMirror();

			// Bulk button integration: mirror core actions to BBMM clones
			try {
				if (!root.dataset.bbmmBulkBound) {
					const handler = (ev) => {
						const btn = ev.target.closest("button");
						if (!btn) return;

						// Prefer data-action if Foundry exposes it
						const act = (btn.dataset?.action || "").toLowerCase();
						// Fallback to label text (English)
						const label = (btn.textContent || btn.ariaLabel || "").trim().toLowerCase();

						let isBulk = false;
						if (act === "activateall" || act === "deactivateall") isBulk = true;
						else if ((/(^|\b)activate all\b/.test(label)) || (/(\b)deactivate all\b/.test(label))) isBulk = true;

						if (!isBulk) return;

						// Let core flip NATIVE checkboxes silently; then mirror NATIVE → BBMM clones.
						queueMicrotask(() => _bbmmSyncClonesFromNative(root));
						setTimeout(() => _bbmmSyncClonesFromNative(root), 60);
						setTimeout(() => _bbmmSyncClonesFromNative(root), 200);

						DL("module-management | bulk detected (activate/deactivate all) — mirrored clones from natives without dispatch");
					};

					// Capture so this still works if footer buttons get re-rendered
					root.addEventListener("click", handler, true);
					root.dataset.bbmmBulkBound = "1";
				}
			} catch (e) {
				DL(2, "module-management | bulk button wiring failed", e);
			}

			// Observe the native menu for changes that might affect checkbox states
			try {
				// Observe native menu for any attribute/child changes (for state sync only)
				if (!menuEl.__bbmmSyncMo) {
					const mo2 = new MutationObserver(() => {
						requestAnimationFrame(() => _bbmmSyncClonesFromNative(root));
					});
					mo2.observe(menuEl, { attributes: true, subtree: true, childList: true });
					menuEl.__bbmmSyncMo = mo2;
					DL("module-management | mutation observer bound for native→BBMM sync");
				}

				// After ANY DialogV2 renders or closes, resync 
				if (!window.__bbmmDialogSyncBound) {
					try {
						Hooks.on?.("closeDialogV2", () => {
							setTimeout(() => _bbmmSyncClonesFromNative(root), 0);
							setTimeout(() => _bbmmSyncClonesFromNative(root), 100);
							setTimeout(() => _bbmmSyncClonesFromNative(root), 200);
						});
						Hooks.on?.("renderDialogV2", (dlgApp, el) => {
							// Also catch button presses inside the dialog
							el.addEventListener("click", (ev) => {
								if (ev.target.closest('button,[type="submit"]')) {
									setTimeout(() => _bbmmSyncClonesFromNative(root), 0);
									setTimeout(() => _bbmmSyncClonesFromNative(root), 100);
								}
							}, true);
						});
					} catch {}

					// Fallback: capture clicks within any V2 dialog container
					document.addEventListener("click", (ev) => {
						const dlg = ev.target.closest('.app-v2[data-application="dialogv2"], .dialog-v2, .dialog');
						if (!dlg) return;
						if (ev.target.closest('button,[type="submit"]')) {
							setTimeout(() => _bbmmSyncClonesFromNative(root), 0);
							setTimeout(() => _bbmmSyncClonesFromNative(root), 120);
						}
					}, true);

					window.__bbmmDialogSyncBound = true;
					DL("module-management | dialog sync bound (DialogV2 close/render/click)");
				}

				// Also resync when the form element fires change 
				const formEl = root.querySelector('form.package-list') || root.querySelector('form[method="post"]');
				if (formEl && !formEl.__bbmmChangeSync) {
					formEl.addEventListener("change", () => {
						queueMicrotask(() => _bbmmSyncClonesFromNative(root));
					});
					formEl.__bbmmChangeSync = "1";
				}
			} catch (e) {
				DL(2, "module-management | dependency resync wiring failed", e);
			}
		} catch (e) {
			DL(2, "module-management | mirror patch failed", e);
		}

		DL(`module-management | injected compact grid with ${built} rows`);
	} catch (err) {
		DL(3, "module-management | renderModuleManagement(): error", err);
	}
});


Hooks.on("setup", () => DL("module-management.js | setup fired"));
Hooks.on("ready", () => DL("module-management.js | ready fired"));
Hooks.once("init", () => {DL("module-management.js | init hook — file loaded");});