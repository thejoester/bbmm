import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPack } from "@foundryvtt/foundryvtt-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const packs = Array.isArray(moduleJson.packs) ? moduleJson.packs : [];

if (!packs.length) {
	process.stdout.write("No packs declared in module.json\n");
	process.exit(0);
}

for (const p of packs) {
	const packDir = path.resolve(ROOT, p.path);
	if (!fs.existsSync(packDir)) {
		process.stdout.write(`Skip (missing): ${packDir}\n`);
		continue;
	}
	const outDir = path.join(packDir, "_source");
	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });

	process.stdout.write(`Extracting -> ${outDir}\n`);
	// LevelDB: no nedb option needed
	await extractPack(packDir, outDir, { log: true });
}

process.stdout.write("Done.\n");