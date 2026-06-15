import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const packs = Array.isArray(moduleJson.packs) ? moduleJson.packs : [];

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

// remove everything inside dir EXCEPT the _source folder
function cleanPackDirButKeepSource(dir) {
	ensureDir(dir);
	for (const entry of fs.readdirSync(dir)) {
		if (entry === "_source") continue;
		const full = path.join(dir, entry);
		fs.rmSync(full, { recursive: true, force: true });
	}
}

if (!packs.length) {
	process.stdout.write("No packs declared in module.json\n");
	process.exit(0);
}

for (const p of packs) {
	const packDir = path.resolve(ROOT, p.path);			// e.g., packs/alchemist-duct-tape-items
	const srcDir = path.join(packDir, "_source");		// packs/.../_source

	if (!fs.existsSync(srcDir)) {
		throw new Error(`Missing _source for pack: ${srcDir}. Run 'npm run extract' and commit the JSON.`);
	}
	const hasJson = fs.readdirSync(srcDir).some(f => f.endsWith(".json") && f !== "index.json");
	if (!hasJson) {
		throw new Error(`Empty _source for pack: ${srcDir}. Extract from your W: install and commit.`);
	}

	// clean LevelDB outputs but keep _source intact
	cleanPackDirButKeepSource(packDir);

	process.stdout.write(`Compiling ${srcDir} -> ${packDir}\n`);
	await compilePack(srcDir, packDir, { log: true });

	// sanity check: must have a MANIFEST and at least one .ldb
	const files = fs.readdirSync(packDir);
	const hasManifest = files.some(n => /^MANIFEST-\d+$/i.test(n));
	const hasLdb = files.some(n => /\.ldb$/i.test(n));
	if (!hasManifest || !hasLdb) {
		throw new Error(`Pack looks incomplete: ${packDir} (manifest=${hasManifest}, ldb=${hasLdb})`);
	}
}

process.stdout.write("Done.\n");
