/* BBMM: Manage Modules list restyle ===========================================
   	- Hook: renderModuleManagement
	- Goals:
		• Make each module entry a compact, cardlike row (similar to changelog left column)
		• Whole row visually selectable (does not toggle enable/disable yet)
		• Keep this purely presentational (no core behavior changes)
============================================================================== */
import { DL, injectBBMMHeaderButton, openBBMMLauncher } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_esc } from "./helpers.js";

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

/* copy native checkbox states -> BBMM clones */
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

						// If effectively empty (including ProseMirror-trailingBreak cases) -> delete entry
						const notes = foundry.utils.duplicate(game.settings.get(BBMM_ID, KEY) || {});
						if (_bbmmIsEmptyNoteHTML(html)) {
							if (moduleId in notes) delete notes[moduleId];

							// If nothing left, store {} to keep setting small
							if (!Object.keys(notes).length) {
								await game.settings.set(BBMM_ID, KEY, {});
							} else {
								await game.settings.set(BBMM_ID, KEY, notes);
							}

							ui.notifications.info(LT.modListNotesDeleted());
							DL(`module-management | cleared empty note for ${moduleId}`);
							return;
						}

						// Non-empty -> save/update
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
		// Resolve a safe root to use for native->BBMM sync calls
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
				DL(`module-management | mirror BBMM->native ${pkgId}: ${cloneCb.checked}`);

				// Dependency dialog flips native checkboxes asynchronously.
				// Burst resync so BBMM clones match after dialog actions.
				const hostRoot = __bbmmResolveRoot();
				queueMicrotask(() => _bbmmSyncClonesFromNative(hostRoot));
				setTimeout(() => _bbmmSyncClonesFromNative(hostRoot), 60);
				setTimeout(() => _bbmmSyncClonesFromNative(hostRoot), 200);
			} catch (e) {
				DL(2, `module-management | mirror BBMM->native failed ${pkgId}`, e);
			}
		}, { passive: true });

			// native -> BBMM (covers any native toggles that DO fire change)
			if (!cb.dataset.bbmmMirrorBound) {
				cb.addEventListener("change", () => {
					try {
						if (cb.bbmmClone) cb.bbmmClone.checked = cb.checked;
						DL(`module-management | mirror native->BBMM ${pkgId}: ${cb.checked}`);
					} catch (e) {
						DL(2, `module-management | mirror native->BBMM failed ${pkgId}`, e);
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

			// NOTE: pass root so click -> dependency dialog resync can use it
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

						// Let core flip NATIVE checkboxes silently; then mirror NATIVE -> BBMM clones.
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
					DL("module-management | mutation observer bound for native->BBMM sync");
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

		// working set (planned states), by module id -> boolean
		this.plan = new Map();
		// filter state
		this.query = "";
		this.scope = "all"; // "all" | "active" | "inactive"

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

	/* Load bbmm.tempModConfig; if empty, seed from core and return live in-memory copy */
	async _loadOrSeedTemp() {
		try {
			let temp = foundry.utils.duplicate(game.settings.get(BBMM_ID, "tempModConfig") || {});
			const core = foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
			this._coreSnap = core;

			// If temp is empty (first open), seed from core
			if (!Object.keys(temp).length) {
				await game.settings.set(BBMM_ID, "tempModConfig", core);
				temp = foundry.utils.duplicate(core);
				DL("BBMMModuleManagerApp::_loadOrSeedTemp(): seeded temp from core");
			}
			this._temp = temp;
			return temp;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_loadOrSeedTemp(): error", e);
			this._coreSnap = {};
			this._temp = {};
			return {};
		}
	}

	/* Overwrite temp with a fresh snapshot from core (called on first render/open) */
	async _resetTempFromCore() {
		try {
			const core = foundry.utils.duplicate(game.settings.get("core", "moduleConfiguration") || {});
			await game.settings.set(BBMM_ID, "tempModConfig", core);
			this._coreSnap = core;
			this._temp = foundry.utils.duplicate(core);
			DL("BBMMModuleManagerApp::_resetTempFromCore(): temp reset from core");
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_resetTempFromCore(): error", e);
			this._coreSnap = {};
			this._temp = {};
		}
	}

	/* Persist temp back to the setting (keep in-memory in sync) */
	async _writeTemp(nextObj) {
		try {
			await game.settings.set(BBMM_ID, "tempModConfig", nextObj);
			this._temp = foundry.utils.duplicate(nextObj);
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_writeTemp(): error", e);
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

	async _setTempActiveBulk(onIds = [], offIds = []) {
		try {
			const cur = foundry.utils.duplicate(game.settings.get(BBMM_ID, "tempModConfig") || {});
			for (const id of onIds) cur[id] = true;
			for (const id of offIds) cur[id] = false;
			await game.settings.set(BBMM_ID, "tempModConfig", cur);
			this._temp = cur;
			DL("BBMMModuleManagerApp::_setTempActiveBulk()", { onIds, offIds });
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
				const req = (mod?.relationships?.requires ?? []);
				const requires = [];
				for (const r of req) if (r?.id && (r.type ?? "module") === "module") requires.push(r.id);
				const conflicts = (mod?.relationships?.conflicts ?? []);
				const confIds = [];
				for (const c of conflicts) if (c?.id && (c.type ?? "module") === "module") confIds.push(c.id);

				data.push({ id, title, version, requires, conflicts: confIds });
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
		return (this._mods ?? []).filter(m => {
			const planned = !!this._getTempActive(m.id);
			if (scope === "active" && !planned)   return false;
			if (scope === "inactive" && planned)  return false;
			if (!q) return true;
			const blob = (m.title + " " + m.id + " " + (m.version || "")).toLowerCase();
			return blob.includes(q);
		});
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

	/* Return a Set of module ids that (transitively) depend on the given module.
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
			// 1) Dependents of this module (modules that will break if we disable it)
			const dependents = this._collectDependents(moduleId);
			if (dependents.size) {
				const list = [...dependents].sort((a, b) => a.localeCompare(b)).map(id => {
					const t = game.modules.get(id)?.title ?? id;
					return `<li><code>${hlp_esc(id)}</code> — ${hlp_esc(t)}</li>`;
				}).join("");
				const content = document.createElement("div"); // DialogV2: no attributes on root
				const p = document.createElement("p");
				p.textContent = LT.moduleManagement?.disableDependentsPrompt?.() ?? "The module you are disabling is required by the following module(s). Disable them as well?";
				const ul = document.createElement("ul"); ul.innerHTML = list;
				content.appendChild(p); content.appendChild(ul);

				let accepted = false;
				await new Promise(resolve => {
					const safeResolve = () => { try { resolve(); } catch {} };
					new foundry.applications.api.DialogV2({
						id: "bbmm-mm-disable-dependents",
						modal: true,
						window: { title: LT.moduleManagement?.disableDependentsTitle?.() ?? "Disable Dependent Modules" },
						content,
						buttons: [
							{ action: "ok", label: LT.moduleManagement?.disable?.() ?? "Disable", icon: "fa-solid fa-check", default: true,
								callback: () => { accepted = true; safeResolve(); } },
							{ action: "cancel", label: LT.buttons?.cancel?.() ?? "Cancel", icon: "fa-solid fa-xmark",
								callback: () => { accepted = false; safeResolve(); } }
						],
						close: safeResolve
					}).render(true);
				});
				if (!accepted) {
					DL(`BBMMModuleManagerApp::_ensureSafeDisable(${moduleId}): user canceled dependents`);
					return false;
				}
				// Turn off the dependents in temp
				await this._setTempActiveBulk([], [...dependents]);
			}

			// 2) Orphaned requires (things this module needed that nothing else still needs)
			const orphans = this._collectOrphanedRequires(moduleId);
			if (orphans.size) {
				const list = [...orphans].sort((a, b) => a.localeCompare(b)).map(id => {
					const t = game.modules.get(id)?.title ?? id;
					return `<li><code>${hlp_esc(id)}</code> — ${hlp_esc(t)}</li>`;
				}).join("");
				const content = document.createElement("div");
				const p = document.createElement("p");
				p.textContent = LT.moduleManagement?.disableOrphansPrompt?.() ?? "The module you are disabling has required module(s) that are no longer needed by anything else. Disable them too?";
				const ul = document.createElement("ul"); ul.innerHTML = list;
				content.appendChild(p); content.appendChild(ul);

				let accepted = false;
				await new Promise(resolve => {
					const safeResolve = () => { try { resolve(); } catch {} };
					new foundry.applications.api.DialogV2({
						id: "bbmm-mm-disable-orphans",
						modal: true,
						window: { title: LT.moduleManagement?.disableOrphansTitle?.() ?? "Disable Unneeded Dependencies" },
						content,
						buttons: [
							{ action: "ok", label: LT.moduleManagement?.disable?.() ?? "Disable", icon: "fa-solid fa-check", default: true,
								callback: () => { accepted = true; safeResolve(); } },
							{ action: "cancel", label: LT.buttons?.cancel?.() ?? "Cancel", icon: "fa-solid fa-xmark",
								callback: () => { accepted = false; safeResolve(); } }
						],
						close: safeResolve
					}).render(true);
				});
				if (accepted) {
					await this._setTempActiveBulk([], [...orphans]);
				}
			}

			// If we get here, it’s safe to disable the original module
			return true;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_ensureSafeDisable(): error", e);
			return false;
		}
	}

	/* When a module is toggled ON, ensure required deps are also toggled ON (with confirmation). */
	async _ensureDependenciesForEnable(moduleId) {
		try {
			const need = this._collectRequired(moduleId);
			if (!need.size) return true;

			// deps not already active or planned ON
			const toEnable = [];
			for (const dep of need) {
				const curActive = !!game.modules.get(dep)?.active;
				const planned = this.plan.has(dep) ? !!this.plan.get(dep) : curActive;
				if (!planned) toEnable.push(dep);
			}
			if (!toEnable.length) return true;

			DL(`BBMMModuleManagerApp::_ensureDependenciesForEnable(${moduleId}) need`, { toEnable });

			// DialogV2 content — root element must have NO attributes
			const content = document.createElement("div");
			const p = document.createElement("p");
			p.textContent = LT.moduleManagement?.depsPrompt();
			content.appendChild(p);

			const list = document.createElement("div");
			list.innerHTML = toEnable
				.map(id => `${game.modules.get(id)?.title ?? id} (${id})`)
				.sort((a, b) => a.localeCompare(b))
				.join("<br>");
			list.style.maxHeight = "40vh";
			list.style.overflow = "auto";
			list.style.border = "1px solid #444";
			list.style.padding = ".5rem";
			list.style.borderRadius = ".35rem";
			content.appendChild(list);

			let accept = false;
			await new Promise((resolve) => {
				let resolved = false;
				const safeResolve = (v) => {
					if (resolved) return;
					resolved = true;
					resolve(v);
				};

				const dlg = new foundry.applications.api.DialogV2({
					id: "bbmm-mm-dep-confirm",
					modal: true,
					window: { title: LT.moduleManagement?.depsTitle() },
					content, // HTMLElement with no attributes
					buttons: [
						{
							action: "ok",
							label: LT.moduleManagement?.enable(),
							icon: "fa-solid fa-check",
							default: true,
							callback: () => {
								accept = true;
								DL(`BBMMModuleManagerApp::_ensureDependenciesForEnable(${moduleId}): user accepted`);
								safeResolve(true);
							}
						},
						{
							action: "cancel",
							label: LT.buttons?.cancel(),
							icon: "fa-solid fa-xmark",
							callback: () => {
								accept = false;
								DL(`BBMMModuleManagerApp::_ensureDependenciesForEnable(${moduleId}): user cancelled (button)`);
								safeResolve(false);
							}
						}
					],
					// If dialog is closed any other way, treat as cancel
					close: () => {
						if (!resolved) {
							DL(`BBMMModuleManagerApp::_ensureDependenciesForEnable(${moduleId}): user cancelled (close)`);
							safeResolve(false);
						}
					}
				});
				dlg.render(true);
			});

			if (!accept) return false;

			// Apply deps into temp config (single write) and re-render
			const ids = [...new Set([...toEnable, moduleId])];
			await this._setTempActiveBulk(ids, []);
			this._rerender({ keepFocus: true });
			DL("BBMMModuleManagerApp::_ensureDependenciesForEnable(): deps enabled", { toEnable });
			return true;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_ensureDependenciesForEnable(): error", e);
			return true; // fail-open so main toggle still works
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
				ui.notifications.info(LT.moduleManagement?.noChanges());
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
					window: { title: LT.moduleManagement?.reloadRequiredTitle() },
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
				try { (foundry.utils?.debouncedReload?.() || window.location.reload)(); }
				catch (e) { DL(3, "BBMMModuleManagerApp::_saveViaCoreSettings(): reload failed", e); }
			} else {
				ui.notifications.info(LT.moduleManagement.reloadLaterNotice());
			}
		} catch (e) {
			DL(3, "BBMMModuleManagerApp::_saveViaCoreSettings(): error", e);
			ui.notifications.error(LT.moduleManagement.saveFailed());
		}
	}

	/* Clone the native icon/tag strip from the core <li>, and optionally strip its version chip */
	_bbmmCloneCoreTags(modId, { stripVersion = true } = {}) {
		try {
			const li =
				document.querySelector(`li.package[data-module-id="${CSS.escape(modId)}"]`) ||
				document.querySelector(`li.package[data-package-id="${CSS.escape(modId)}"]`);
			if (!li) return "";

			const src = li.querySelector(".package-overview");
			if (!src) return "";

			// Clone only the tag strip
			const tags = src.querySelectorAll(".tag");
			if (!tags.length) return "";

			const frag = document.createDocumentFragment();
			for (const t of tags) {
				// Optionally remove core's version chip (we will render our own neutral text)
				if (stripVersion && (t.classList.contains("version") || /v\d/i.test(t.textContent || ""))) continue;
				const clone = t.cloneNode(true);
				clone.classList.add("bbmm-tag"); // harmless marker; keeps native sizing
				frag.appendChild(clone);
			}

			// Ensure we still have something after stripping
			if (!frag.childNodes.length) return "";

			const wrap = document.createElement("div");
			wrap.appendChild(frag);
			return wrap.innerHTML;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_bbmmCloneCoreTags(): failed", e);
			return "";
		}
	}

	/* Build a core-style tag strip from module metadata (no version pill). */
	_buildTagsFor(mod) {
		try {
			const parts = [];

			// Settings gear (same size as native via "tag flexrow")
			if (_bbmmModuleHasConfigSettings(mod.id)) {
				parts.push(
					`<button type="button" class="tag flexrow" data-bbmm-action="open-settings" data-mod-id="${hlp_esc(mod.id)}" aria-label="${hlp_esc(LT.openSettings?.() ?? "Open Settings")}">` +
						`<i class="fa-solid fa-gear fa-fw"></i>` +
					`</button>`
				);
			}

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
					parts.push(`<span class="tag flexrow" title="Verified"><i class="fa-solid fa-circle-check fa-fw"></i></span>`);
				} else if (min || max) {
					parts.push(`<span class="tag flexrow" title="Compatibility not verified"><i class="fa-solid fa-triangle-exclamation fa-fw"></i></span>`);
				}
			} catch {}

			return parts.join("");
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_buildTagsFor(): failed", e);
			return "";
		}
	}

	/* Fallback: synthesize a core-like tag strip when native <li> is not available */
	_bbmmBuildTagStripFallback(mod) {
		try {
			const parts = [];

			// settings gear (native sizing: .tag.flexrow)
			if (_bbmmModuleHasConfigSettings(mod.id)) {
                parts.push(
					`<button type="button" class="tag flexrow" data-bbmm-action="open-settings" data-mod-id="${hlp_esc(mod.id)}" aria-label="${hlp_esc(LT.openSettings?.() ?? "Open Settings")}">` +
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
					parts.push(`<span class="tag flexrow" title="Verified"><i class="fa-solid fa-circle-check fa-fw"></i></span>`);
				} else if (min || max) {
					parts.push(`<span class="tag flexrow" title="Compatibility not verified"><i class="fa-solid fa-triangle-exclamation fa-fw"></i></span>`);
				}
			} catch {}

			// Return combined
			return parts.join("");
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_bbmmBuildTagStripFallback(): failed", e);
			return "";
		}
	}

	_renderNativeTagsHTML(modId) {
		try {
			// Look for the native Module Management <li> for this id and clone its .tag elements.
			const li =
				document.querySelector(`li.package[data-module-id="${CSS.escape(modId)}"]`) ||
				document.querySelector(`li.package[data-package-id="${CSS.escape(modId)}"]`);
			if (!li) return "";

			const tags = li.querySelectorAll(".package-overview .tag");
			if (!tags?.length) return "";

			const frag = document.createDocumentFragment();
			for (const t of tags) {
				const clone = t.cloneNode(true);
				clone.classList.add("bbmm-tag"); // harmless class so bbmm.css can tweak spacing if desired
				frag.appendChild(clone);
			}
			const div = document.createElement("div");
			div.appendChild(frag);
			return div.innerHTML;
		} catch (e) {
			DL(2, "BBMMModuleManagerApp::_renderNativeTagsHTML(): failed", e);
			return "";
		}
	}

	_renderHeaderHTML() {
		const { enable, disable } = this._diffCounts();
		const filterLabel = LT.moduleManagement.filterModules();
		return `
			<div class="bbmm-mm-toolbar" id="bbmm-mm-toolbar">
				<input id="bbmm-mm-q" type="text" placeholder="${hlp_esc(filterLabel)}" value="${hlp_esc(this.query)}" />
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
			return `<div class="bbmm-mm-empty">${LT.moduleManagement?.noResults()}</div>`;
			}

			return rows.map((m) => {
			const planned = !!this._getTempActive(m.id);
			const changed = planned !== !!this._coreSnap?.[m.id];
			const verTxt  = m.version ? String(m.version) : "";

			// get the REAL Module object for the tag strip
			const modObj = game.modules.get(m.id);

			// ONLY deps/conf moved into notes header
			const depBadge = (m.requires?.length)
				? `<span class="tag dep" title="${hlp_esc(m.requires.join(", "))}">${LT.moduleManagement.dependencies()}: ${m.requires.length}</span>`
				: "";
			const conBadge = (m.conflicts?.length)
				? `<span class="tag con" title="${hlp_esc(m.conflicts.join(", "))}">${LT.moduleManagement.conflicts()}: ${m.conflicts.length}</span>`
				: "";

			return `
				<div class="row ${planned ? "on" : ""} ${changed ? "chg" : ""}" data-id="${hlp_esc(m.id)}">
				<label class="toggle" onclick="event.stopPropagation()">
					<input type="checkbox" ${planned ? "checked" : ""}>
				</label>

				<div class="main">
					<div class="title" title="${hlp_esc(m.title)}">${hlp_esc(m.title)}</div>
				</div>

				<div class="actions">
					<div class="tags">
					${this._buildTagsFor(modObj)}
					${verTxt ? `<span class="ver-text">v${hlp_esc(verTxt)}</span>` : ``}
					</div>
					<button type="button" class="btn-edit" data-id="${hlp_esc(m.id)}" title="${hlp_esc(LT.modListEditNotes())}">
					<i class="fa-solid fa-pen-to-square fa-fw"></i>
					</button>
				</div>

				<div class="notes">
					<div class="notes-head">
					${depBadge}${conBadge}
					</div>
					<div class="html"></div>
				</div>
				</div>
			`;
			}).join("");
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
		const content = this.element.querySelector(".window-content") || this.element;
		content.style.display = "flex";
		content.style.flexDirection = "column";
		content.style.height = "100%";
		content.style.minHeight = "0";
		content.innerHTML = result;
		this._root = content;

		// add the standard BBMM header button 
		try { injectBBMMHeaderButton(this.element); } catch (e) { DL(2, "BBMM MM | header btn inject failed", e); }

		// Reset temp from core on first open of this window
		await this._resetTempFromCore();

		// build dataset & draw using temp
		this._refreshDataset();
		this._rerender();

		// Expose the live instance for debugging
		try {
			this.element.__bbmmApp = this;           // DOM → instance
			window.BBMM_MM = this;                   // global quick access
		} catch (e) { DL(2, "BBMM | failed to expose app instance", e); }

		// Explicit centering (some themes offset V2 windows on first paint)
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

			// scope buttons
			this._root.addEventListener("click", (ev) => {
				const btn = ev.target.closest?.(".bbmm-mm-scopes button");
				if (!btn) return;
				this.scope = btn.dataset.scope || "all";
				this._rerender({ keepFocus: true });
			}, true);

			// row toggle
			this._root.addEventListener("change", async (ev) => {
				const row = ev.target.closest?.(".row");
				if (!row) return;
				const id = row.getAttribute("data-id");
				if (!id) return;

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
			const ids = (this._mods ?? []).map(m => m.id);
			await this._setTempActiveBulk([], ids);   // set all OFF in temp
			this._rerender({ keepFocus: true });
			}, true);

			// footer: Activate All
			this._root.addEventListener("click", async (ev) => {
			if (ev.target?.id !== "bbmm-mm-activate-all") return;
			const ids = (this._mods ?? []).map(m => m.id);
			await this._setTempActiveBulk(ids, []);   // set all ON in temp
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
						new FTC().render(true); // singleton ctor; safe to call multiple times
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

// --- Rewire Settings sidebar "Manage Modules" to open BBMMModuleManagerApp ---
Hooks.on("renderSettings", (_app, rootEl) => {
	try {
	const root = rootEl instanceof HTMLElement ? rootEl : (rootEl?.[0] ?? null);
	if (!root) return;

	// Already wired?
	if (root.dataset.bbmmManageModulesBound === "1") return;

	const candidates = [
		...root.querySelectorAll('button[data-action="moduleManagement"]'),
		...root.querySelectorAll('button[data-action="manage-modules"]'),
		...root.querySelectorAll('button, a')
	];

	const manageBtn = candidates.find(b => {
		const label = (b.textContent || b.ariaLabel || "").trim().toLowerCase();
		return (
		b.matches('button[data-action="moduleManagement"], button[data-action="manage-modules"]') ||
		/manage modules/.test(label)
		);
	});

	if (!manageBtn) return;

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
  const btn = root.querySelector('button[data-bbmm-rewired="1"]') || root.querySelector('button[data-action="moduleManagement"]');
  if (!btn) return;
  btn.title = "Opens BBMM Module Manager (Shift-click for core)";
  btn.setAttribute("data-tooltip", "Opens BBMM Module Manager (Shift-click for core)");
});

Hooks.on("ready", () => {
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
	DL("module-management.js | ready fired")
});


Hooks.on("setup", () => DL("module-management.js | setup fired"));
Hooks.once("init", () => {DL("module-management.js | init hook — file loaded");});