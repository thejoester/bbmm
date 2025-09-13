import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const packs = Array.isArray(moduleJson.packs) ? moduleJson.packs : [];

function fail(msg) {
	process.stderr.write(msg + "\n");
	process.exit(1);
}

if (!packs.length) {
	console.log("No packs declared in module.json");
	process.exit(0);
}

const dupName = new Map();
const dupSlug = new Map();

let total = 0;

for (const p of packs) {
	const coll = `${moduleJson.id}.${p.name}`; 
	const srcDir = path.resolve(ROOT, p.path, "_source");
	if (!fs.existsSync(srcDir)) {
		console.log(`Skip verify (no _source): ${srcDir}`);
		continue;
	}

	const files = fs.readdirSync(srcDir).filter(f => f.endsWith(".json") && f !== "index.json");
	for (const file of files) {
		const data = JSON.parse(fs.readFileSync(path.join(srcDir, file), "utf8"));
		total++;

		const name = String((data.name ?? "").trim().toLowerCase());
		const slug = String((data.system?.slug ?? "").trim().toLowerCase());

		if (name) {
			const key = `${coll}::${name}`;
			dupName.set(key, (dupName.get(key) ?? 0) + 1);
		}
		if (slug) {
			const key = `${coll}::${slug}`;
			dupSlug.set(key, (dupSlug.get(key) ?? 0) + 1);
		}
	}
}

const badNames = [...dupName.entries()].filter(([, c]) => c > 1);
const badSlugs = [...dupSlug.entries()].filter(([, c]) => c > 1);

if (!badNames.length && !badSlugs.length) {
	console.log(`OK: scanned ${total} docs — no duplicate names or slugs detected.`);
	process.exit(0);
}

let msg = `Duplicate entries detected in extracted packs (scanned ${total} docs):\n`;
if (badNames.length) {
	msg += "\nBy name:\n";
	for (const [k, c] of badNames) msg += `  ${k} => ${c}\n`;
}
if (badSlugs.length) {
	msg += "\nBy slug:\n";
	for (const [k, c] of badSlugs) msg += `  ${k} => ${c}\n`;
}
fail(msg);
