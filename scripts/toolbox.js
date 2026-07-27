/* =========================================================================
	BBMM: Toolbox
	Master-detail window that replaces the launcher's scatter of standalone
	manager windows. Left column is a fixed-width vertical list of tools;
	the right pane mounts the selected tool and scrolls internally.

	Tools self-register by pushing a descriptor onto globalThis.bbmm.toolboxTools
	at load time; this file loads last and reads that array to build the nav.
	Descriptor shape + full architecture: bbmm/CLAUDE.md and
	_plans/bbmm-toolbox-window-plan.md.
========================================================================= */

import { DL, BBMM_README_UUID } from "./settings.js";
import { LT, BBMM_ID } from "./localization.js";
import { hlp_injectHeaderHelpButton, hlp_openManualByUuid } from "./helpers.js";

/* Group registry: label/icon for collapsible nav groups. */
const BBMM_TB_GROUPS = {
	utilities: { icon: "fa-solid fa-screwdriver-wrench", label: () => LT.toolbox.utilities?.() ?? "Utilities" }
};

globalThis.bbmm ??= {};
globalThis.bbmm.toolboxTools ??= [];

/* left-nav tab order */
const BBMM_TB_ORDER = [
	"modulePresets",	// Module Presets
	"settingsPresets",	// Settings Presets
	"lockPresets",		// Lock Presets
	"exclusions",		// Inclusions / Exclusions
	"lockManager",		// Settings Locks
	"tags",				// Tag Manager
	"importExport",		// Import / Export
	"utilities",		// Utilities (GM-only)
	"readme"			// Read Me (everyone)
];

/* nav divider before these tab ids */
const BBMM_TB_DIVIDER_BEFORE = new Set(["exclusions", "importExport"]);

/* Utility tab: links to compendium macros */
const BBMM_TB_UTIL_MACROS = [
	{ key: "gameSettingsInspector", uuid: "Compendium.bbmm.bbmm-macros.Macro.MclNrZrBvfKhgRB5" },
	{ key: "settingPresetInspector", uuid: "Compendium.bbmm.bbmm-macros.Macro.sc6d0g6syYz3nEbB" },
	{ key: "settingLockPushTool", uuid: "Compendium.bbmm.bbmm-macros.Macro.5qYJeOOmMXxI9168" },
	{ key: "clearAllModuleTags", uuid: "Compendium.bbmm.bbmm-macros.Macro.2hDprUWA8E5mr4J5" },
	{ key: "keyBindingInspector", uuid: "Compendium.bbmm.bbmm-macros.Macro.cwDZlfhhZAZaUPER" },
	{ key: "resetChangelog", uuid: "Compendium.bbmm.bbmm-macros.Macro.KKjNNKp07HamxcUO" },
	{ key: "viewChangelog", uuid: "Compendium.bbmm.bbmm-macros.Macro.RYwtyq1VXqfwSGZe" }
];

/* Read the live registry, filtered to what the current user can see, in nav order. */
function tb_visibleTools() {
	const tools = globalThis.bbmm?.toolboxTools ?? [];
	const visible = tools.filter(t => {
		try { return typeof t.visible === "function" ? !!t.visible() : true; }
		catch (err) { DL(2, `toolbox.js | visible() threw for '${t?.id}'`, err); return false; }
	});
	const rank = (id) => { const i = BBMM_TB_ORDER.indexOf(id); return i === -1 ? BBMM_TB_ORDER.length : i; };
	return visible
		.map((t, i) => ({ t, i }))				// keep original index for stable tie-break
		.sort((a, b) => (rank(a.t.id) - rank(b.t.id)) || (a.i - b.i))
		.map(x => x.t);
}

/* -----------------------------------------------------------------------
	Native tabs: Utilities + Read Me
----------------------------------------------------------------------- */

async function tb_mountUtilities(container) {
	const FN = "toolbox.js | tb_mountUtilities():";

	const rows = BBMM_TB_UTIL_MACROS.map(m => {
		const label = (() => { try { return LT.toolbox.util[m.key](); } catch { return m.key; } })();
		return (
			`<button type="button" class="bbmm-tb-util-row" data-uuid="${m.uuid}">` +
				`<i class="fa-solid fa-play bbmm-tb-util-icon"></i>` +
				`<span class="bbmm-tb-util-label">${label}</span>` +
			`</button>`
		);
	}).join("");

	container.innerHTML =
		`<div class="bbmm-tb-util">` +
			`<h3 class="bbmm-tb-util-title">${LT.toolbox.utilTitle()}</h3>` +
			`<div class="bbmm-tb-util-list">${rows}</div>` +
		`</div>`;

	const onClick = async (ev) => {
		const btn = ev.target.closest?.(".bbmm-tb-util-row");
		if (!btn) return;
		const uuid = btn.dataset.uuid;
		try {
			const macro = await fromUuid(uuid);
			if (!macro) { ui.notifications?.warn(LT.toolbox.utilMissing()); return; }
			await macro.execute();
		} catch (err) {
			DL(3, `${FN} execute failed for ${uuid}`, err);
			ui.notifications?.error(LT.toolbox.utilRunError());
		}
	};
	container.addEventListener("click", onClick);
	return () => container.removeEventListener("click", onClick);
}

/* Read Me tab: opens the manual journal */
async function tb_mountReadMe(container) {
	container.innerHTML =
		`<div class="bbmm-tb-readme">` +
			`<p class="bbmm-tb-readme-intro">${LT.toolbox.readmeIntro()}</p>` +
			`<button type="button" class="bbmm-tb-readme-open">` +
				`<i class="fa-solid fa-book-open"></i> ${LT.toolbox.readmeOpen()}` +
			`</button>` +
		`</div>`;

	const btn = container.querySelector(".bbmm-tb-readme-open");
	const onClick = () => hlp_openManualByUuid(BBMM_README_UUID);
	btn?.addEventListener("click", onClick);
	return () => btn?.removeEventListener("click", onClick);
}

globalThis.bbmm ??= {};
globalThis.bbmm.toolboxTools ??= [];
globalThis.bbmm.toolboxTools.push(
	{
		id: "utilities",
		icon: "fa-solid fa-screwdriver-wrench",
		label: () => LT.toolbox.tabUtilities(),
		visible: () => game.user.isGM,
		group: null,
		mount: async (container) => tb_mountUtilities(container)
	},
	{
		id: "readme",
		icon: "fa-solid fa-book-open",
		label: () => LT.toolbox.tabReadMe(),
		visible: () => true,
		group: null,
		mount: async (container) => tb_mountReadMe(container)
	}
);

class BBMMToolboxAppV2 extends foundry.applications.api.ApplicationV2 {
	constructor(opts = {}) {
		super({
			id: "bbmm-toolbox",
			window: { title: LT.toolbox.title() },
			width: 1000,
			height: 700,
			resizable: true,
			classes: ["bbmm-toolbox-app"]
		});
		// Width is locked (min === max); height is resizable but capped so long
		// lists scroll inside the pane instead of growing the window.
		this._minW = 1000;
		this._maxW = 1000;
		this._minH = 400;
		this._maxH = 750;

		this._activeToolId = opts.tool ?? null;	// requested initial tool
		this._cleanup = null;						// current pane's cleanup fn
		this._root = null;							// window-content element
		this._expandedGroups = new Set();			// which nav groups are open
	}

	/* -----------------------------------------------------------------------
		Nav rendering
	----------------------------------------------------------------------- */

	_navRowHTML(tool, nested = false) {
		const active = tool.id === this._activeToolId ? " active" : "";
		const nest   = nested ? " bbmm-tb-nested" : "";
		const label  = (() => { try { return tool.label(); } catch { return tool.id; } })();
		return (
			`<button type="button" class="bbmm-tb-navrow${active}${nest}" data-tool="${tool.id}">` +
				`<i class="${tool.icon || "fa-solid fa-cube"}"></i>` +
				`<span class="bbmm-tb-navlabel">${label}</span>` +
			`</button>`
		);
	}

	_navHTML() {
		const tools = tb_visibleTools();
		if (!tools.length) return `<div class="bbmm-tb-nav-empty">${LT.toolbox.emptyNav()}</div>`;

		// Split into top-level (group == null) and grouped, preserving registration order.
		const flat = tools.filter(t => !t.group);
		const grouped = new Map();	// groupId -> [tools]
		for (const t of tools) {
			if (!t.group) continue;
			if (!grouped.has(t.group)) grouped.set(t.group, []);
			grouped.get(t.group).push(t);
		}

		let html = "";
		flat.forEach((t, i) => {
			if (i > 0 && BBMM_TB_DIVIDER_BEFORE.has(t.id)) html += `<hr class="bbmm-tb-divider">`;
			html += this._navRowHTML(t);
		});

		for (const [groupId, groupTools] of grouped) {
			const meta = BBMM_TB_GROUPS[groupId] ?? { icon: "fa-solid fa-folder", label: () => groupId };
			const open = this._expandedGroups.has(groupId);
			const chevron = open ? "fa-chevron-down" : "fa-chevron-right";
			const label = (() => { try { return meta.label(); } catch { return groupId; } })();
			html +=
				`<button type="button" class="bbmm-tb-group${open ? " open" : ""}" data-group="${groupId}">` +
					`<i class="fa-solid ${chevron} bbmm-tb-chev"></i>` +
					`<i class="${meta.icon}"></i>` +
					`<span class="bbmm-tb-navlabel">${label}</span>` +
				`</button>`;
			for (const t of groupTools) {
				html += this._navRowHTML(t, true).replace(
					'class="bbmm-tb-navrow',
					`class="bbmm-tb-navrow${open ? "" : " bbmm-tb-hidden"}`
				);
			}
		}
		return html;
	}

	/* -----------------------------------------------------------------------
		Mount / unmount
	----------------------------------------------------------------------- */

	async _mountTool(toolId) {
		// clean-up the current pane.
		if (this._cleanup) {
			try { this._cleanup(); } catch (err) { DL(2, "toolbox.js | pane cleanup threw", err); }
			this._cleanup = null;
		}
		const old = this._root?.querySelector("#bbmm-tb-pane");
		if (!old) return;
		// Swap in a fresh pane node so any listeners the previous tool bound on the
		// container die with the old node (mounts bind on the container and don't all
		// return cleanups; a shared pane leaks handlers across tabs).
		const pane = document.createElement("section");
		pane.id = "bbmm-tb-pane";
		pane.className = old.className || "bbmm-tb-pane";
		old.replaceWith(pane);

		const tool = tb_visibleTools().find(t => t.id === toolId) ?? null;
		if (!tool) {
			this._activeToolId = null;
			pane.innerHTML = `<div class="bbmm-tb-placeholder">${LT.toolbox.noTool()}</div>`;
			this._syncActiveNav();
			return;
		}

		this._activeToolId = toolId;
		this._syncActiveNav();

		try {
			const cleanup = await tool.mount(pane);
			this._cleanup = typeof cleanup === "function" ? cleanup : null;
			DL(`toolbox.js | mounted tool '${toolId}'`);
		} catch (err) {
			DL(3, `toolbox.js | mount('${toolId}') failed`, err);
			pane.innerHTML = `<div class="bbmm-tb-placeholder bbmm-tb-error">${LT.toolbox.mountError()}</div>`;
		}
		this._clampToViewport();
	}

	// If content growth pushes the window past the screen edge, recenter it vertically.
	_clampToViewport() {
		requestAnimationFrame(() => {
			try {
				const el = this.element;
				if (!el) return;
				const rect = el.getBoundingClientRect();
				const vh = window.innerHeight;
				const margin = 10;
				if (rect.height + margin * 2 >= vh) {
					// Taller than the viewport: pin to the top margin.
					if (Math.abs(rect.top - margin) > 1) this.setPosition({ top: margin });
				} else if (rect.bottom > vh - margin || rect.top < margin) {
					// Would run off an edge: recenter vertically.
					this.setPosition({ top: Math.max(margin, Math.round((vh - rect.height) / 2)) });
				}
			} catch (e) { DL(2, "toolbox.js | clampToViewport failed", e); }
		});
	}

	_syncActiveNav() {
		if (!this._root) return;
		for (const el of this._root.querySelectorAll(".bbmm-tb-navrow")) {
			el.classList.toggle("active", el.dataset.tool === this._activeToolId);
		}
	}

	_toggleGroup(groupId) {
		if (this._expandedGroups.has(groupId)) this._expandedGroups.delete(groupId);
		else this._expandedGroups.add(groupId);
		const nav = this._root?.querySelector("#bbmm-tb-nav");
		if (nav) nav.innerHTML = this._navHTML();
	}

	/* -----------------------------------------------------------------------
		ApplicationV2 render lifecycle
	----------------------------------------------------------------------- */

	async _renderHTML(_context, _options) {
		// Pick a sensible default tool if none requested / no longer visible.
		const visible = tb_visibleTools();
		if (!this._activeToolId || !visible.some(t => t.id === this._activeToolId)) {
			this._activeToolId = visible.find(t => !t.group)?.id ?? visible[0]?.id ?? null;
		}
		return (
			`<div class="bbmm-tb-root">` +
				`<nav class="bbmm-tb-nav" id="bbmm-tb-nav">${this._navHTML()}</nav>` +
				`<section class="bbmm-tb-pane" id="bbmm-tb-pane"></section>` +
			`</div>`
		);
	}

	async _replaceHTML(result, _options) {
		const winEl = this.element;
		try {
			winEl.style.minWidth  = this._minW + "px";
			winEl.style.maxWidth  = this._maxW + "px";
			winEl.style.minHeight = this._minH + "px";
			winEl.style.maxHeight = this._maxH + "px";
			winEl.style.overflow  = "hidden";
		} catch (e) { DL(2, "toolbox.js | size clamp failed", e); }

		const content = this.element.querySelector(".window-content") || this.element;
		content.innerHTML = result;
		this._root = content;

		// Header help button, opens the readme journal
		try {
			hlp_injectHeaderHelpButton(this, {
				uuid: BBMM_README_UUID,
				iconClass: "fas fa-circle-question",
				title: LT.buttons.help?.() ?? "Help"
			});
		} catch (e) { DL(2, "toolbox.js | help inject failed", e); }

		// One delegated click handler for the whole nav.
		if (!this._delegated) {
			this._delegated = true;
			content.addEventListener("click", (ev) => {
				const groupBtn = ev.target.closest?.(".bbmm-tb-group");
				if (groupBtn) { this._toggleGroup(groupBtn.dataset.group); return; }
				const row = ev.target.closest?.(".bbmm-tb-navrow");
				if (row && row.dataset.tool && row.dataset.tool !== this._activeToolId) {
					this._mountTool(row.dataset.tool);
				}
			});
		}

		// Mount the active tool fresh.
		await this._mountTool(this._activeToolId);
	}

	async close(options) {
		if (this._cleanup) {
			try { this._cleanup(); } catch (err) { DL(2, "toolbox.js | cleanup on close threw", err); }
			this._cleanup = null;
		}
		return super.close(options);
	}
}

/* =========================================================================
	Opener + API registration
========================================================================= */

let _bbmmToolboxInstance = null;

export async function openBBMMToolbox({ tool = null } = {}) {
	try {
		// Reopen-focuses-existing rather than duplicating.
		if (_bbmmToolboxInstance?.rendered) {
			if (tool) await _bbmmToolboxInstance._mountTool(tool);
			_bbmmToolboxInstance.bringToFront?.();
			return _bbmmToolboxInstance;
		}
		_bbmmToolboxInstance = new BBMMToolboxAppV2({ tool });
		await _bbmmToolboxInstance.render(true);
		return _bbmmToolboxInstance;
	} catch (err) {
		DL(3, "toolbox.js | openBBMMToolbox(): error", err);
		ui.notifications?.error(LT.toolbox.mountError());
		return null;
	}
}

Hooks.once("init", () => {
	try {
		globalThis.bbmm ??= {};
		globalThis.bbmm.openBBMMToolbox = openBBMMToolbox;
		const mod = game.modules.get(BBMM_ID);
		if (mod) { mod.api = mod.api || {}; Object.assign(mod.api, { openBBMMToolbox }); }
		DL("toolbox.js | init(): Toolbox API registered");
	} catch (err) {
		DL(3, "toolbox.js | init(): failed to register Toolbox API", err);
	}
});
