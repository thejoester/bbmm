import { DL } from './settings.js';
import { EXPORT_SKIP } from './settings.js';
/* ---------------------------------------------------------------------- */
/* General helpers										                  */
/* ---------------------------------------------------------------------- */

// Tiny safe HTML escaper for labels/values
export function hlp_esc(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;"
	}[m]));
}

// get time stamp
export function hlp_timestampStr(d = new Date()) {
	const p = (n, l=2) => String(n).padStart(l, "0");
	return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Helper to export to .json file
export async function hlp_saveJSONFile(data, filename) {
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
		} catch (e) {
			// user probably cancelled; just return
			return;
		}
	}

	// 3) Fallback: anchor download (uses browser download location / may not prompt)
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// prompt to pick .json file
export function hlp_pickLocalJSONFile() {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "application/json";
		input.style.display = "none";
		document.body.appendChild(input);
		input.addEventListener("change", () => {
			const file = input.files?.[0] ?? null;
			document.body.removeChild(input);
			resolve(file || null);
		}, { once: true });
		input.click();
	});
}

// Normalize name to compare when saving
export function hlp_normalizePresetName(s) {
	return String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/* ---------------------------------------------------------------------- */
/* Exclusion helpers (used by settings and module presets)                */
/* ---------------------------------------------------------------------- */

/* Cache the effective skip map until invalidated */
let _skipMapCache = null;

export function invalidateSkipMap() {
	// Call this if you change bbmm.userExclusions or EXPORT_SKIP at runtime
	_skipMapCache = null;
}

/*
	Build effective skip map from EXPORT_SKIP + bbmm.userExclusions.
	No DL() here; we log only when we actually skip something.
*/
export function getSkipMap() {
	if (_skipMapCache) return _skipMapCache;

	const out = new Map(EXPORT_SKIP ?? new Map());
	let ex = {};
	try { ex = game?.settings?.get?.("bbmm","userExclusions") ?? {}; } catch {}

	// Entire modules → add "*"
	for (const ns of ex.modules ?? []) {
		if (!ns) continue;
		const set = out.get(ns) ?? new Set();
		set.add("*");
		out.set(ns, set);
	}

	// Specific settings [{ namespace, key }]
	for (const ent of ex.settings ?? []) {
		if (!ent?.namespace || !ent?.key) continue;
		const set = out.get(ent.namespace) ?? new Set();
		set.add(ent.key);
		out.set(ent.namespace, set);
	}

	_skipMapCache = out;
	return _skipMapCache;
}

/* Fast predicate that uses a provided map (no rebuild/logging) */
export function isExcludedWith(skipMap, namespace, key) {
	const val = skipMap.get(namespace);
	if (!val) return false;
	if (val === "*" || (val instanceof Set && val.has("*"))) return true;
	return !!(key && val instanceof Set && val.has(key));
}

/* Back-compat helper if some call sites still use isExcluded(ns,key) */
export function isExcluded(namespace, key) {
	return isExcludedWith(getSkipMap(), namespace, key);
}

Hooks.on("setSetting", (namespace, key, value) => {
	if (namespace === "bbmm" && key === "userExclusions") {
		invalidateSkipMap();
	}
});