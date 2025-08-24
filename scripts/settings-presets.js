import { debugLog } from './settings.js';
const BBMM_ID = "bbmm";
const SETTING_SETTINGS_PRESETS = "settingsPresets"; 
const PRESET_MANAGER_ID = "bbmm-settings-preset-manager"; // Stable window id for the Settings Preset Manager
// Do not export these settings
const EXPORT_SKIP = new Map([
	["bbmm", new Set(["settingsPresets", "module-presets"])]
]);
const AppV2 = foundry?.applications?.api?.ApplicationV2;
if (!AppV2) {
	// Comment
	debugLog("error", "BBMM: ApplicationV2 base class not found.");
}

Hooks.once("init", () => {
	game.settings.register(BBMM_ID, SETTING_SETTINGS_PRESETS, {
		name: "Settings Presets",
		hint: "Stored Settings presets (world/client).",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});
});

// ===== Helpers =====

// JSON (de)hydration helpers so Sets/Maps survive JSON.stringify
	function toJsonSafe(value, seen = new WeakSet(), path = "", depth = 0) {
		const here = path || "<root>";
		const ROOT = depth === 0;
		if (ROOT) debugLog(`toJsonSafe IN ${here}`, value);

		let out;

		// primitives / null
		if (value == null || (typeof value !== "object" && typeof value !== "function")) {
			out = value;
			if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
			return out;
		}

		// cycle guard
		if (seen.has(value)) {
			out = "[[Circular]]";
			if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
			return out;
		}
		seen.add(value);

		// Sets / Maps
		if (value instanceof Set) {
			out = { __type: "Set", value: [...value] };
			if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
			return out;
		}
		if (value instanceof Map) {
			out = { __type: "Map", value: Object.fromEntries(value) };
			if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
			return out;
		}

		// Foundry Collection → plain object
		try {
			if (typeof foundry !== "undefined" && foundry.utils?.Collection && value instanceof foundry.utils.Collection) {
				const obj = Object.fromEntries(value.entries());
				out = {};
				for (const [k, v] of Object.entries(obj)) out[k] = toJsonSafe(v, seen, `${here}.${k}`, depth + 1);
				if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
				return out;
			}
		} catch {}

		// Arrays
		if (Array.isArray(value)) {
			out = value.map((v, i) => toJsonSafe(v, seen, `${here}[${i}]`, depth + 1));
			if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
			return out;
		}

		// Generic objects: prefer Foundry duplicate, then fallback to safe enumerate
		try {
			if (foundry?.utils?.duplicate) {
				const dup = foundry.utils.duplicate(value);
				if (dup && dup !== value) {
					if (Array.isArray(dup)) out = dup.map((v, i) => toJsonSafe(v, seen, `${here}[${i}]`, depth + 1));
					else {
						out = {};
						for (const [k, v] of Object.entries(dup)) out[k] = toJsonSafe(v, seen, `${here}.${k}`, depth + 1);
					}
					if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
					return out;
				}
			}
		} catch {}

		// Fallback: shallow enumerate safely
		out = {};
		for (const k of Object.keys(value)) {
			let v;
			try { v = value[k]; } catch { v = "[[GetterError]]"; }
			out[k] = toJsonSafe(v, seen, `${here}.${k}`, depth + 1);
		}

		if (ROOT) debugLog(`toJsonSafe OUT ${here}`, out);
		return out;
	}
	
	function fromJsonSafe(value) {
		if (Array.isArray(value)) return value.map(v => fromJsonSafe(v));
		if (value && typeof value === "object") {
			if (value.__type === "Set") return new Set((value.value ?? []).map(v => fromJsonSafe(v)));
			if (value.__type === "Map") return new Map(Object.entries(value.value ?? {}).map(([k, v]) => [k, fromJsonSafe(v)]));
			const out = {};
			for (const [k, v] of Object.entries(value)) out[k] = fromJsonSafe(v);
			return out;
		}
		return value;
	}

	function isPlainEmptyObject(v) {
		return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;
	}
	
	function schemaCorrectNonPlainTypes(out) {
		for (const [fullKey, cfg] of game.settings.settings.entries()) {
			const [namespace, key] = fullKey.split(".");
			const scope = cfg?.scope === "client" ? "client" : "world";
			const bucket = out?.[scope]?.[namespace];
			if (!bucket) continue;

			const current = bucket[key];

			// Fix Sets/Maps that flattened
			if (cfg?.type === Set || cfg?.type === Map) {
				const flattened = !current || (typeof current === "object" && !Array.isArray(current) && Object.keys(current).length === 0);
				const wrongSet = cfg.type === Set && !(current && (current.__type === "Set" || Array.isArray(current)));
				const wrongMap = cfg.type === Map && !(current && (current.__type === "Map" || (current && typeof current === "object" && !Array.isArray(current))));
				if (flattened || wrongSet || wrongMap) {
					try { bucket[key] = toJsonSafe(game.settings.get(namespace, key)); } catch { bucket[key] = cfg.type === Set ? { __type:"Set", value:[] } : { __type:"Map", value:{} }; }
				}
			}

			// If schema expects Object and we captured {}, but live has data, re-pull it
			if ((cfg?.type === Object || !cfg?.type) && current && typeof current === "object" && !Array.isArray(current) && Object.keys(current).length === 0) {
				try {
					const live = game.settings.get(namespace, key);
					if (live && typeof live === "object" && Object.keys(live).length > 0) {
						bucket[key] = toJsonSafe(live);
					}
				} catch {}
			}
		}
	}
	
// Tiny esc
function esc(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	}[m]));
}

function slugify(s) {
	return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function timestampStr(d = new Date()) {
	const p = (n, l=2) => String(n).padStart(l, "0");
	return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function formatDateD_Mon_YYYY(d = new Date()) {
	const dd = String(d.getDate()).padStart(2, "0");
	const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
	const yyyy = d.getFullYear();
	return `${dd}-${MON}-${yyyy}`;
}

function normalizeName(s) {
	return String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

// Normalize incoming settings export (BBMM format or fallback map).
function normalizeImportedSettings(data) {
	// Preferred BBMM shape
	if (data && typeof data === "object" && data.type === "bbmm-settings" && Array.isArray(data.entries)) {
		// entries: [{ namespace, key, scope, value, config? }, ...]
		return data.entries
			.filter(e => e && typeof e.namespace === "string" && typeof e.key === "string")
			.map(e => ({
				namespace: e.namespace,
				key: e.key,
				scope: e.scope ?? "client",
				config: !!e.config,
				value: e.value
			}));
	}

	// Accept { [namespace]: { [key]: value } } fallback
	if (data && typeof data === "object") {
		const entries = [];
		for (const [ns, obj] of Object.entries(data)) {
			if (!obj || typeof obj !== "object") continue;
			for (const [key, val] of Object.entries(obj)) {
				// Try to discover scope from registry; default client
				const reg = game.settings.settings.get(`${ns}.${key}`);
				const scope = reg?.scope ?? "client";
				entries.push({ namespace: ns, key, scope, config: !!reg?.config, value: val });
			}
		}
		return entries;
	}

	return [];
}

function getWindowById(id) {
	// ui.windows is a map of window apps keyed by numeric ids
	return Object.values(ui.windows ?? {}).find(w => w?.id === id) ?? null;
}

// Group entries by namespace with counts
function groupByNamespace(entries) {
	const map = new Map();
	for (const e of entries) {
		if (!map.has(e.namespace)) map.set(e.namespace, []);
		map.get(e.namespace).push(e);
	}
	return map;
}

// Open the import wizard. `data` is the parsed JSON object from file.
export async function openSettingsImportWizard(data) {
	try {
		// If no data was passed in, prompt the user to pick a JSON file
		const json = data || await pickJsonFile();
		if (!json) {
			debugLog("BBMM", "Import Wizard: no JSON provided/selected");
			return;
		}

		// Normalize (your existing compat function is fine to keep, or inline it here)
		const normalizeToEntriesCompat = (jsonIn) => {
			/** @type {{namespace:string,key:string,value:any,scope:'world'|'client',config:boolean}[]} */
			const entries = [];

			// Push all settings in a bucket into the flat entries array
			const pushBucket = (bucket, scope) => {
				if (!bucket || typeof bucket !== "object") return;
				for (const [ns, settings] of Object.entries(bucket)) {
					if (!settings || typeof settings !== "object") continue;
					for (const [key, val] of Object.entries(settings)) {
						const isObj = val && typeof val === "object";
						const value = (isObj && "value" in val) ? val.value : val;
						const cfg = (isObj && "config" in val) ? !!val.config : true;
						const scp = (isObj && (val.scope === "world" || val.scope === "client")) ? val.scope : scope;
						entries.push({ namespace: ns, key, value, scope: scp, config: cfg });
					}
				}
			};

			if (jsonIn?.world || jsonIn?.client) { // Current BBMM export shape with world/client
				pushBucket(jsonIn.world, "world");
				pushBucket(jsonIn.client, "client");
			} else if (jsonIn?.settings && typeof jsonIn.settings === "object") { // Legacy “Module Management+” shape with .settings
				pushBucket(jsonIn.settings, "client");
			}

			const moduleList = [...new Set(entries.map(e => e.namespace))].sort();
			return { entries, moduleList };
		};

		const normalized = normalizeToEntriesCompat(json);

		if (!normalized.entries.length) {
			ui.notifications.warn("No settings found in JSON.");
			debugLog("BBMM", "Import Wizard: 0 entries after normalization", { json });
			return;
		}

		debugLog("BBMM", `Import Wizard: normalized ${normalized.entries.length} entries from ${normalized.moduleList.length} namespaces`);

		// Guard: verify base class is available before we construct
		if (!AppV2) {
			ui.notifications.error("BBMM Import Wizard: ApplicationV2 is unavailable.");
			debugLog("error", "openSettingsImportWizard(): AppV2 base missing", { AppV2 });
			return;
		}

		// Construct with a try/catch to isolate ctor failures
		let app;
		try {
			app = new BBMMImportWizard({ json, normalized });
			app.render(true);	
		} catch (ctorErr) {
			debugLog("error", "BBMM Import Wizard: constructor failed", ctorErr);
			ui.notifications.error(`Import Wizard failed during construction: ${ctorErr?.message ?? ctorErr}`);
			return;
		}

		// Render with a try/catch to isolate render failures
		try {
			await app.render(true);
		} catch (renderErr) {
			debugLog("error", "BBMM Import Wizard: render failed", renderErr);
			ui.notifications.error(`Import Wizard failed during render: ${renderErr?.message ?? renderErr}`);
			return;
		}
	} catch (err) {
		// If anything else goes wrong, log and notify
		debugLog("error", "openSettingsImportWizard: failed to open", err);
		ui.notifications.error("Failed to open Import Wizard (see console).");
	}
}

/*
	Normalize input JSON → flat entries:
		{ namespace, key, value, scope, config }
	Accepts either:
	- { type:"bbmm-settings", settings:{ ns:{ key:{value,scope,config} } } }
	- Nested raw { ns:{ key:value } }
	- Flat raw { "ns.key": value }
*/
function normalizeToEntries(json) {
	/** @type {{namespace:string,key:string,value:any,scope:'world'|'client',config:boolean}[]} */
	const entries = [];

	// Case 1: Official BBMM shape
	if (json?.type === "bbmm-settings" && json?.settings && typeof json.settings === "object") {
		for (const [ns, group] of Object.entries(json.settings)) {
			if (!group || typeof group !== "object") continue;
			for (const [key, payload] of Object.entries(group)) {
				const rec = (payload && typeof payload === "object" && "value" in payload)
					? payload
					: { value: payload, scope: "client", config: true };
				entries.push({
					namespace: ns,
					key,
					value: rec.value,
					scope: rec.scope === "world" ? "world" : "client",
					config: !!rec.config
				});
			}
		}
	}

	// Case 2: Nested raw { ns:{ key:value } }
	else if (json && typeof json === "object" && Object.values(json).every(v => v && typeof v === "object")) {
		for (const [ns, group] of Object.entries(json)) {
			if (!group || typeof group !== "object") continue;
			for (const [key, value] of Object.entries(group)) {
				entries.push({ namespace: ns, key, value, scope: "client", config: true });
			}
		}
	}

	// Case 3: Flat raw { "ns.key": value }
	else if (json && typeof json === "object" && Object.keys(json).some(k => k.includes("."))) {
		for (const [fullKey, value] of Object.entries(json)) {
			const dot = fullKey.indexOf(".");
			if (dot <= 0) continue;
			const ns = fullKey.slice(0, dot);
			const key = fullKey.slice(dot + 1);
			entries.push({ namespace: ns, key, value, scope: "client", config: true });
		}
	}

	// Build module grouping & setting labels
	const byNs = new Map();
	for (const e of entries) {
		if (!byNs.has(e.namespace)) byNs.set(e.namespace, []);
		byNs.get(e.namespace).push(e);
	}
	const moduleList = [...byNs.keys()].sort();

	return { entries, moduleList };
}

/*
	Preset persistence
	- Registers bbmm.presets (world, hidden) if needed
	- Saves/updates presets[name] = { created, updated, items:[entry...] }
*/
async function savePresetToSettings(presetName, selectedEntries) {
	try {
		const current = foundry.utils.duplicate(
			game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS)
		) || {};
		const now = Date.now();

		current[presetName] ??= { created: now, updated: now, items: [] };
		current[presetName].updated = now;
		current[presetName].items = selectedEntries;

		await game.settings.set(BBMM_ID, SETTING_SETTINGS_PRESETS, current);

		debugLog("BBMM", `savePresetToSettings(): saved preset "${presetName}" with ${selectedEntries.length} entries`);
		return current[presetName];
	} catch (e) {
		debugLog("error", "savePresetToSettings(): failed", { message: e?.message, stack: e?.stack });
		throw e;
	}
}

/*
	ApplicationV2: BBMMImportWizard
*/
class BBMMImportWizard extends AppV2 {
	constructor(state) {
		super({
			id: "bbmm-import-wizard",
			title: "BBMM — Import Settings to Preset",
			width: 700,
			height: "auto",          // don’t force tall window
			resizable: true
		});
		this.bbmmState = state;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			tag: "section",
			class: ["bbmm-import-app"],
			position: { width: 700, height: 600, top: 100, left: 100 },
			window: { title: "BBMM — Import Settings to Preset" }
		}, { inplace: false });
	}

	// Return a string, not an element, so there’s nothing to “move” in the DOM
	async _renderHTML() {
		// {Render the BBMM Import Wizard form}
		return `
			<form class="bbmm-import" style="display:flex;flex-direction:column;gap:.5rem;height:100%;">
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:12rem;">What would you like to import?</label>
					<select name="mode">
						<option value="all" selected>All Settings</option>
						<option value="modules">Select Modules</option>
						<option value="settings">Select Settings</option>
					</select>
					
				</div>

				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:12rem;">Preset Name</label>
					<input type="text" name="presetName" placeholder="My Preset" required>
				</div>

				<div id="bbmm-list" style="
					flex: 1;
					overflow: auto;
					max-height: 60vh;  /* prevents going off screen */
					border: 1px solid var(--color-border-dark-5);
					border-radius: 6px;
					padding: .5rem;">
				</div>

				<footer style="display:flex;justify-content:flex-end;gap:.5rem;">
					<button type="button" data-action="cancel">Cancel</button>
					<button type="button" data-action="import" class="default">Import to Preset</button>
				</footer>
			</form>
		`;
	}

	// Inject HTML via innerHTML (never replaceChildren), then cache refs and wire listeners
	async _replaceHTML(result, _options) {
		try {
			const win = this.element;
			const contentRegion = win.querySelector(".window-content") || win;

			// Make the content flex so the center panel can scroll
			contentRegion.style.display = "flex";
			contentRegion.style.flexDirection = "column";
			contentRegion.style.height = "100%";
			contentRegion.style.minHeight = "0";

			// Inject: result is expected to be a STRING here (like your macro)
			const htmlStr = (result instanceof HTMLElement) ? result.innerHTML : String(result ?? "");
			contentRegion.innerHTML = htmlStr;

			// Cache handles we'll use later
			this._root = contentRegion;
			this._form = /** @type {HTMLFormElement|null} */ (contentRegion.querySelector("form.bbmm-import"));
			this._list = /** @type {HTMLElement|null} */ (contentRegion.querySelector("#bbmm-list"));

			// Deep debug so we can see what exists right now
			debugLog("BBMM", "Import Wizard _replaceHTML(): after inject", {
				hasWindowContent: !!win.querySelector(".window-content"),
				rootTag: this._root?.tagName,
				htmlLen: this._root?.innerHTML?.length ?? 0,
				formExists: !!this._form,
				listExists: !!this._list,
				sampleInner: (this._root?.innerHTML ?? "").slice(0, 180)
			});

			// Wire listeners on next tick
			setTimeout(() => this.activateListeners(), 0);
		} catch (e) {
			debugLog("error", "Import Wizard: _replaceHTML failed", e);
			throw e;
		}
	}

	/** Called once the form is in the DOM. Wires listeners and paints initial list. */
	activateListeners() {
		// Prevent double‑wiring if AppV2 rerenders or we get called twice
		if (this._wired) {
			debugLog("BBMM", "activateListeners skipped (already wired)");
			return;
		}
		this._wired = true;

		// Root + cached refs from _replaceHTML
		const root = this._root || this.element;
		const form = this._form || /** @type {HTMLFormElement|null} */ (root?.querySelector("form.bbmm-import"));
		const list = this._list || /** @type {HTMLElement|null} */ (root?.querySelector("#bbmm-list"));

		debugLog("BBMM", "activateListeners called", {
			hasRoot: !!root,
			hasForm: !!form,
			hasList: !!list
		});

		if (!root || !form || !list) {
			debugLog("error", "BBMM Import Wizard: form or #bbmm-list not found (post-activate)");
			return;
		}

		// Ensure our buttons are non-submitting buttons (defensive in case HTML changes later)
		form.querySelectorAll('button[data-action]').forEach(b => b.setAttribute("type", "button"));

		// Field handles
		/** @type {HTMLSelectElement} */
		const modeSel = /** @type any */ (form.elements.namedItem("mode"));
		/** @type {HTMLInputElement} */
		const presetName = /** @type any */ (form.elements.namedItem("presetName"));

		// Set a friendly default name if empty
		if (!presetName.value) presetName.value = defaultPresetName();

		/*
			Paint the center panel based on mode and then recenter the window.
			setPosition({ left:null, top:null }) tells Foundry to fully recenter.
		*/
		const paint = () => {
			const mode = modeSel.value;
			if (mode === "all") this.#paintAll(list);
			else if (mode === "modules") this.#paintModules(list);
			else this.#paintSettings(list);

			// Recalculate height and recenter so window never grows off-screen
			this.setPosition({ height: "auto", left: null, top: null });
			debugLog("BBMM", "paint() done and window re-centered", { mode });
		};

		// Prevent default form submission (which could cause double events)
		form.addEventListener("submit", (ev) => {
			ev.preventDefault();
			debugLog("BBMM", "blocked default form submit");
		});

		// Mode changes repaint and recenter
		modeSel.addEventListener("change", paint);

		// Cancel button closes the wizard
		form.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
			debugLog("BBMM", "Import Wizard: cancel clicked — closing");
			this.close();
		});

		// Import button: overwrite check (DialogV2), save, refresh, close
		form.querySelector('[data-action="import"]')?.addEventListener("click", async (ev) => {
			try {
				ev.preventDefault();
				if (this._inFlight) return; // Already processing; ignore further clicks
				this._inFlight = true;

				const name = presetName.value.trim();
				if (!name) {
					ui.notifications.warn("Please enter a Preset Name.");
					this._inFlight = false;
					return;
				}

				// Duplicate name check (single prompt)
				const allPresets = game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS) || {};
				if (allPresets[name]) {
					const confirmed = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Preset Exists" },
						content: `<p>A preset named <b>${name}</b> already exists. Overwrite it?</p>`,
						defaultYes: false,
						ok: { label: "Overwrite" },
						cancel: { label: "Cancel" }
					});
					if (!confirmed) { this._inFlight = false; return; }
				}

				const selected = this.#collectSelected(modeSel.value, list);
				if (!selected.length) {
					ui.notifications.warn("No entries selected.");
					this._inFlight = false;
					return;
				}

				// Disable UI to prevent double‑clicks
				const importBtn = form.querySelector('[data-action="import"]');
				const cancelBtn = form.querySelector('[data-action="cancel"]');
				importBtn?.setAttribute("disabled", "true");
				cancelBtn?.setAttribute("disabled", "true");
				form.setAttribute("aria-busy", "true");

				// Lightweight feedback + close immediately so it feels responsive
				ui.notifications.info(`Importing ${selected.length} setting(s) into preset "${name}"…`);
				debugLog("BBMM", `Import Wizard: starting import of ${selected.length} entries to "${name}"`);

				// Close the window first; the async save continues in the background
				this.close();

				// Perform the save
				const preset = await savePresetToSettings(name, selected);
				debugLog("BBMM", "Import Wizard: savePresetToSettings OK", { name, count: selected.length });
				
				debugLog("BBMM", "Reopening Settings Preset Manager after import");
				openSettingsPresetManager();
				Hooks.callAll("bbmm:importPreset", { name, items: preset.items });

				// Final toast after completion
				ui.notifications.info(`Imported ${selected.length} setting(s) into preset "${name}".`);
			} catch (e) {
				debugLog("error", "Import Wizard: failed to save preset", { message: e?.message, stack: e?.stack });
				ui.notifications.error(`Failed to save preset: ${e?.message ?? "see console"}`);
			} finally {
				this._inFlight = false;
			}
		});

		// Initial paint when dialog opens
		paint();
	}

	/** All Settings mode: simple message with count */
	#paintAll(list) {
		const total = this.bbmmState.normalized.entries.length;
		list.innerHTML = `
			<div style="padding:.25rem;">
				<em>All ${total} settings in the file will be imported into the preset.</em>
			</div>
		`;
	}

	/** Modules mode: checkbox per namespace, with counts */
	#paintModules(list) {
		const { moduleList, entries } = this.bbmmState.normalized;
		const counts = new Map();
		for (const e of entries) counts.set(e.namespace, (counts.get(e.namespace) || 0) + 1);

		const rows = moduleList.map(ns => `
			<label style="display:flex;align-items:center;gap:.5rem;padding:.25rem .5rem;border-radius:4px;">
				<input type="checkbox" class="bbmm-ns" data-ns="${ns}" checked>
				<span style="flex:1;"><b>${ns}</b> <span class="notes">(${counts.get(ns) || 0} settings)</span></span>
			</label>
		`).join("");

		list.innerHTML = rows || `<em>No modules detected.</em>`;
	}

	/** Settings mode: all keys grouped by namespace, with per-namespace master toggles */
	#paintSettings(list) {
		const { entries } = this.bbmmState.normalized;
		const sorted = [...entries].sort((a, b) =>
			(a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key))
		);

		const blocks = [];
		let currentNs = null;
		for (const e of sorted) {
			// Start a new fieldset whenever the namespace changes
			if (e.namespace !== currentNs) {
				if (currentNs !== null) blocks.push(`</div></fieldset>`);
				currentNs = e.namespace;
				blocks.push(`
					<fieldset style="border:1px solid var(--color-border-dark-5);border-radius:6px;padding:.25rem .5rem;margin-bottom:.25rem;">
						<legend style="font-weight:600;">
							<label style="display:inline-flex;gap:.5rem;align-items:center;">
								<input type="checkbox" class="bbmm-ns-master" data-ns="${currentNs}" checked>
								${currentNs}
							</label>
						</legend>
						<div style="display:flex;flex-direction:column;gap:.125rem;">
				`);
			}
			blocks.push(`
				<label style="display:flex;gap:.5rem;align-items:center;padding:.125rem .25rem;">
					<input type="checkbox" class="bbmm-setting" data-ns="${e.namespace}" data-key="${e.key}" checked>
					<span style="flex:1;"><code>${e.key}</code> <span class="notes">[${e.scope}${e.config ? "" : ", hidden"}]</span></span>
				</label>
			`);
		}
		if (currentNs !== null) blocks.push(`</div></fieldset>`);

		list.innerHTML = blocks.join("") || `<em>No settings detected.</em>`;

		// Master checkbox toggles all child settings for that namespace
		list.querySelectorAll(".bbmm-ns-master").forEach(el => {
			el.addEventListener("change", ev => {
				const ns = ev.currentTarget.dataset.ns;
				list.querySelectorAll(`.bbmm-setting[data-ns="${ns}"]`)
					.forEach(cb => { cb.checked = ev.currentTarget.checked; });
			});
		});
	}

	/** Collect entries based on the current mode and which checkboxes are ticked */
	#collectSelected(mode, list) {
		const all = this.bbmmState.normalized.entries;

		if (mode === "all") return all;

		if (mode === "modules") {
			const chosen = new Set(
				[...list.querySelectorAll(".bbmm-ns:checked")].map(el => el.dataset.ns)
			);
			return all.filter(e => chosen.has(e.namespace));
		}

		// Settings mode: only include checked ns/key pairs
		const wanted = new Set(
			[...list.querySelectorAll(".bbmm-setting:checked")]
				.map(el => `${el.dataset.ns}::${el.dataset.key}`)
		);
		return all.filter(e => wanted.has(`${e.namespace}::${e.key}`));
	}
}

/*
	Comment block
	Default preset name suggestion
*/
function defaultPresetName() {
	const d = new Date();
	const pad = (n) => `${n}`.padStart(2, "0");
	return `Imported ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function getSettingsPresets() {
	return foundry.utils.duplicate(game.settings.get(BBMM_ID, SETTING_SETTINGS_PRESETS) || {});
}

async function setSettingsPresets(obj) {
	await game.settings.set(BBMM_ID, SETTING_SETTINGS_PRESETS, obj);
}

function findExistingSettingsPresetKey(name) {
	const wanted = normalizeName(name);
	const presets = getSettingsPresets();
	for (const k of Object.keys(presets)) {
		if (normalizeName(k) === wanted) return k;
	}
	return null;
}

// Export helpers
async function saveJSONFile(data, filename) {
	if (typeof saveDataToFile === "function") {
		return saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
	}
	if (window.showSaveFilePicker) {
		try {
			const handle = await showSaveFilePicker({
				suggestedName: filename,
				types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
			});
			const stream = await handle.createWritable();
			await stream.write(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
			return stream.close();
		} catch {
			return;
		}
	}
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url; a.download = filename;
	document.body.appendChild(a);
	a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickLocalJSONFile() {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file"; input.accept = "application/json"; input.style.display = "none";
		document.body.appendChild(input);
		input.addEventListener("change", () => {
			const file = input.files?.[0] ?? null;
			document.body.removeChild(input);
			resolve(file || null);
		}, { once: true });
		input.click();
	});
}

/*	Collect / Apply Settings
	Collect module settings by scope, optionally restricting to active modules.
	- Skips config:false entries
	- GM: world + client, Non‑GM: client only
	- includeDisabled=false → skip modules that are not active (except core/system)
*/
function collectAllModuleSettings({ includeDisabled = false } = {}) {
	const isGM = game.user.isGM;
	const out = { type: "bbmm-settings", created: new Date().toISOString(), world: {}, client: {} };
	const sysId = game.system.id;

	for (const def of game.settings.settings.values()) {
		const { namespace, key, scope, config } = def;
		// skip hidden settings
		//if (config === false) continue;

		// scope filter by permission
		if (scope === "world" && !isGM) continue;

		// module filter (active vs disabled)
		if (!includeDisabled) {
			if (namespace !== "core" && namespace !== sysId) {
				const mod = game.modules.get(namespace);
				if (!mod || !mod.active) continue;
			}
		}

		let value;
		try {
			value = game.settings.get(namespace, key);
		} catch {
			continue;
		}
		
		// skip this module presets to reduce export size
		if (EXPORT_SKIP.get(namespace)?.has(key)) {
			debugLog(`Export: skipping ${namespace}.${key}`);
			continue;
		}
		
		const bucket = scope === "world" ? out.world : out.client;
		bucket[namespace] ??= {};
		const fullKey = `${namespace}.${key}`;
		try {
			const raw = game.settings.get(namespace, key); // keep this if you already switched to raw-get
			bucket[namespace][key] = toJsonSafe(raw);
		} catch (e) {
			debugLog(`Export: collect FAILED ${fullKey} — ${e?.message ?? e}`);
			bucket[namespace][key] = null; // or `continue;` if you prefer to skip
		}
	}

	return out;
}

/* 	Apply settings export (bbmm-settings).
	- GM applies world + client; non‑GM applies client only
	- Skips namespaces where module not installed (collects report)
	- Always reloads after apply (per your requirement)
*/
async function applySettingsExport(exportData) {
	if (!exportData || exportData.type !== "bbmm-settings") {
		ui.notifications.error("Not a BBMM settings export.");
		return { applied: [], skipped: [], missingModules: new Set() };
	}

	const isGM = game.user.isGM;
	const scopes = isGM ? ["world","client"] : ["client"];

	const applied = [];
	const skipped = [];
	const missingModules = new Set();

	for (const scope of scopes) {
		const tree = exportData[scope] || {};
		for (const [namespace, entries] of Object.entries(tree)) {
			if (namespace !== "core" && namespace !== game.system.id && !game.modules.has(namespace)) {
				missingModules.add(namespace);
				continue;
			}
			for (const [key, value] of Object.entries(entries)) {
				const def = [...game.settings.settings.values()].find(d => d.namespace === namespace && d.key === key);
				if (!def) { skipped.push(`${namespace}.${key}`); continue; }
				if (def.scope !== scope) { skipped.push(`${namespace}.${key}`); continue; }

				// permission: world requires GM
				if (def.scope === "world" && !isGM) { skipped.push(`${namespace}.${key}`); continue; }

				try {
					const cfg = game.settings.settings.get(`${namespace}.${key}`);
					let hydrated = fromJsonSafe(value);

					// Back-compat: old exports stored {} for Set/Map — treat as empty
					if (cfg?.type === Set && isPlainEmptyObject(value)) hydrated = new Set();
					if (cfg?.type === Map && isPlainEmptyObject(value)) hydrated = new Map();

					// If caller didn’t tag but type is known, coerce
					if (cfg?.type === Set && !(hydrated instanceof Set)) {
						if (Array.isArray(hydrated)) hydrated = new Set(hydrated);
						else hydrated = new Set();
					}
					if (cfg?.type === Map && !(hydrated instanceof Map)) {
						if (hydrated && typeof hydrated === "object" && !Array.isArray(hydrated)) hydrated = new Map(Object.entries(hydrated));
						else hydrated = new Map();
					}

					// ✅ NEW: if the schema expects a plain Object but we somehow have a Map, coerce to POJO
					if (cfg?.type === Object && hydrated instanceof Map) {
						hydrated = Object.fromEntries(hydrated);
					}

					await game.settings.set(namespace, key, hydrated);
					applied.push(`${namespace}.${key}`);
				} catch {
					skipped.push(`${namespace}.${key}`);
				}
			}
		}
	}

	// Always reload
	const doReload = await foundry.applications.api.DialogV2.confirm({
		window: { title: "Reload Foundry?" },
		content: `<p>Settings preset applied. Reload now to ensure everything initializes correctly?</p>`,
		ok: { label: "Reload" },
		modal: true
	});
	if (doReload) location.reload();

	return { applied, skipped, missingModules };
}

// Conflict-safe Preset Save
function askSettingsPresetConflict(existingKey) {
	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: "Preset Exists", modal: true },
			content: `
				<p>A settings preset named <b>${esc(existingKey)}</b> already exists.</p>
				<p>What would you like to do?</p>
			`,
			buttons: [
				{ action: "overwrite", label: "Overwrite", default: true, callback: () => resolve("overwrite") },
				{ action: "rename", label: "Rename", callback: () => resolve("rename") },
				{ action: "cancel", label: "Cancel", callback: () => resolve("cancel") }
			],
			submit: () => {},
			rejectClose: false
		}).render(true);
	});
}

//	Rename Prompt
function promptRenamePreset(defaultName) {
	return new Promise((resolve) => {
		new foundry.applications.api.DialogV2({
			window: { title: "Rename Settings Preset", modal: true },
			content: `
				<div style="display:flex;gap:.5rem;align-items:center;">
					<label style="min-width:7rem;">New Name</label>
					<input name="newName" type="text" value="${esc(defaultName)}" autofocus style="flex:1;">
				</div>
			`,
			buttons: [
				{ action: "ok",     label: "Save", default: true,
				  callback: (_ev, btn) => resolve(btn.form.elements.newName?.value?.trim() || "") },
				{ action: "cancel", label: "Cancel", callback: () => resolve(null) }
			],
			submit: () => {},
			rejectClose: false
		}).render(true);
	});
}

// Save Settings Preset
async function saveSettingsPreset(name, payload) {
	const rawInput = String(name).trim();
	let finalName = rawInput;

	const existingKey = findExistingSettingsPresetKey(rawInput);
	if (existingKey) {
		const choice = await askSettingsPresetConflict(existingKey);
		if (choice === "cancel") return { status: "cancel" };
		if (choice === "overwrite") finalName = existingKey;
		if (choice === "rename") {
			const newName = await promptRenamePreset(rawInput);
			if (!newName) return { status: "cancel" };
			finalName = newName;
		}
	}
	const all = getSettingsPresets();
	all[finalName] = payload;
	await setSettingsPresets(all);
	return { status: "saved", name: finalName };
}

// UI — Settings Preset Manager
export async function openSettingsPresetManager() {
	// Stable id for this manager window so we can find/close it reliably
	const PRESET_MANAGER_ID = "bbmm-settings-preset-manager";

	/*
		Find an open window by id (works for ApplicationV2/DialogV2)
	*/
	const getWindowById = (id) => {
		return Object.values(ui.windows ?? {}).find(w => w?.id === id) ?? null;
	};

	// Close any existing instance so we reopen a fresh one
	const existing = getWindowById(PRESET_MANAGER_ID);
	if (existing) {
		debugLog("BBMM", "Settings Preset Manager: closing existing instance before reopen");
		existing.close({ force: true });
	}

	// Build list of current presets
	const presets = getSettingsPresets();
	const names = Object.keys(presets).sort((a,b)=>a.localeCompare(b));
	const options = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");

	// Content markup (make central area scrollable to avoid off‑screen growth)
	const content = `
		<section class="bbmm-preset-manager-root" style="min-width:560px;display:flex;flex-direction:column;gap:.75rem;max-height:70vh;overflow:auto;">
			<div style="display:flex;gap:.5rem;align-items:center;">
				<label style="min-width:12rem;">Saved Settings Presets</label>
				<select name="presetName" style="flex:1;">${options}</select>
				<button type="button" data-action="load">Load</button>
				<button type="button" data-action="delete">Delete</button>
			</div>

			<hr>

			<div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;">
				<label><input type="checkbox" name="includeDisabled"> Include disabled modules</label>
			</div>

			<div style="display:flex;gap:.5rem;align-items:center;">
				<input name="newName" type="text" placeholder="New settings preset name…" style="flex:1;">
				<button type="button" data-action="save-current">Save Current Settings</button>
			</div>

			<hr>

			<h3 style="margin:0;">Export/Import Current Settings</h3>
			<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
				<button type="button" data-action="export">Export to .json</button>
				<button type="button" data-action="import">Import from .json</button>
			</div>

			<p class="notes">GM exports world+client settings; players export client only. Applying a settings preset will prompt to reload.</p>
		</section>
	`;

	/*
		Create DialogV2 with a stable id so we can close/refresh later.
		We’ll re-center it on render to avoid off-screen growth.
	*/
	const dlg = new foundry.applications.api.DialogV2({
		id: PRESET_MANAGER_ID,
		window: { title: "BBMM — Settings Preset Manager", resizable: true },
		position: { width: 700, height: "auto" },
		content,
		buttons: [{ action: "close", label: "Close", default: true }]
	});

	/*
		Attach listeners after the DialogV2 DOM is in place.
		Also normalize button types and re-center the window so it never sits off-screen.
	*/
	const onRender = (app) => {
		if (app !== dlg) return;
		Hooks.off("renderDialogV2", onRender);

		// Re-size and re-center the window so it fits the viewport
		try { dlg.setPosition({ height: "auto", left: null, top: null }); } catch {}

		const root = app.element;
		const form = root?.querySelector("form");			// DialogV2 wraps content in a form
		if (!form) return;

		// Ensure all action buttons are non-submitting buttons (defensive)
		form.querySelectorAll('button[data-action]').forEach(b => b.setAttribute("type", "button"));

		// Single delegated click handler for all actions
		form.addEventListener("click", async (ev) => {
			const btn = ev.target;
			if (!(btn instanceof HTMLButtonElement)) return;
			const action = btn.dataset.action || "";
			if (!["save-current","load","delete","export","import"].includes(action)) return;

			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation();

			const sel = form.elements.namedItem("presetName");
			const txt = form.elements.namedItem("newName");
			const chk = form.elements.namedItem("includeDisabled");

			const selected = (sel instanceof HTMLSelectElement) ? sel.value : "";
			const newName = (txt instanceof HTMLInputElement) ? txt.value.trim() : "";
			const includeDisabled = (chk instanceof HTMLInputElement) ? chk.checked : false;

			try {
				if (action === "save-current") {
					if (!newName) { ui.notifications.warn("Enter a name for the new settings preset."); return; }
					const payload = collectAllModuleSettings({ includeDisabled });
					schemaCorrectNonPlainTypes(payload);
					const res = await saveSettingsPreset(`${newName}`, payload);
					if (res.status !== "saved") return;
					ui.notifications.info(`Saved settings preset "${res.name}".`);

					// Close and reopen to refresh the list
					app.close();
					openSettingsPresetManager();
					return;
				}

				if (action === "load") {
					if (!selected) return ui.notifications.warn("Select a settings preset to load.");
					const preset = getSettingsPresets()[selected];
					if (!preset) return;

					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Apply Settings Preset" },
						content: `<p>Apply settings preset <b>${esc(selected)}</b>?</p>`,
						ok: { label: "Apply" },
						modal: true
					});
					if (!ok) return;

					await applySettingsExport(preset);
					return;
				}

				if (action === "delete") {
					if (!selected) return ui.notifications.warn("Select a settings preset to delete.");
					const ok = await foundry.applications.api.DialogV2.confirm({
						window: { title: "Delete Settings Preset" },
						content: `<p>Delete settings preset <b>${esc(selected)}</b>?</p>`,
						ok: { label: "Delete" }
					});
					if (!ok) return;

					const all = getSettingsPresets();
					delete all[selected];
					await setSettingsPresets(all);
					ui.notifications.info(`Deleted settings preset "${selected}".`);

					// Close and reopen to refresh the list
					app.close();
					openSettingsPresetManager();
					return;
				}

				if (action === "export") {
					try {
						debugLog("BBMM", "Export: start");
						const payload = collectAllModuleSettings({ includeDisabled });
						debugLog("BBMM", "Export: collected OK");
						schemaCorrectNonPlainTypes(payload);
						debugLog("BBMM", "Export: schema corrected OK");

						const base = game.user.isGM ? "settings-world-client" : "settings-client";
						const fname = `bbmm-${base}-${timestampStr()}.json`;

						debugLog("BBMM", `Export: saving ${fname}`);
						await saveJSONFile(payload, fname);
						ui.notifications.info("Exported current settings.");
						debugLog("BBMM", "Export: done");
					} catch (e) {
						debugLog("error", `Export: FAILED — ${e?.message ?? e}`);
						ui.notifications.error(`Export failed: ${e?.message ?? e}`);
						throw e;
					}
					return;
				}

				if (action === "import") {
					// Choose file
					const file = await pickLocalJSONFile();
					if (!file) return;

					// Parse
					let data;
					try { data = JSON.parse(await file.text()); }
					catch { ui.notifications.error("Invalid JSON file."); return; }

					// Require BBMM settings export type
					if (!data || data.type !== "bbmm-settings") {
						await new foundry.applications.api.DialogV2({
							window: { title: "Import Error" },
							content: `<p>Not a BBMM settings export (type "bbmm-settings").</p>`,
							buttons: [{ action: "ok", label: "OK", default: true }],
							submit: () => "ok"
						}).render(true);
						return;
					}

					// Hand off to the Import Wizard (selection UI + import)
					await openSettingsImportWizard(data);
					return;
				}
			} catch (err) {
				debugLog("error", "BBMM Settings Presets error", { message: err?.message, stack: err?.stack });
				ui.notifications.error("An error occurred; see console for details.");
			}
		});
	};
	Hooks.on("renderDialogV2", onRender);

	dlg.render(true);
}

// Expose API
Hooks.once("ready", () => {
	const mod = game.modules.get(BBMM_ID);
	if (!mod) return;
	mod.api ??= {};
	mod.api.openSettingsPresetManager = openSettingsPresetManager;
});
