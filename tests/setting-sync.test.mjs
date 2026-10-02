import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";

const source = readFileSync(new URL("../scripts/setting-sync.js", import.meta.url), "utf8")
	.replace(/^import .*;\r?\n/gm, "")
	.replace(/^(\s*)export /gm, "$1");

function setup({ scope = "client", soft = false, isGM = false, enabled = true, value = false } = {}) {
	const id = "example.selected";
	const hooks = new Map();
	const timers = [];
	const writes = [];
	const errors = [];
	const rules = { [id]: { namespace: "example", key: "selected", value, soft } };
	const values = new Map([
		["bbmm.enableUserSettingSync", enabled],
		["bbmm.userSettingSync", rules]
	]);
	const Hooks = {
		on(name, fn) {
			const list = hooks.get(name) ?? [];
			list.push(fn);
			hooks.set(name, list);
		},
		once() {},
		callAll(name, ...args) {
			for (const fn of hooks.get(name) ?? []) fn(...args);
		}
	};
	const game = {
		user: { id: "player", isGM },
		settings: {
			settings: new Map([[id, { namespace: "example", key: "selected", scope }]]),
			get(namespace, key) { return values.get(`${namespace}.${key}`); },
			async set(namespace, key, next) {
				const keyId = `${namespace}.${key}`;
				const exists = values.has(keyId);
				values.set(keyId, structuredClone(next));
				writes.push({ id: keyId, value: next });
				if (scope === "client") {
					Hooks.callAll("clientSettingChanged", keyId, next, {});
				} else {
					Hooks.callAll(exists ? "updateSetting" : "createSetting", {
						key: keyId,
						value: next,
						user: scope === "user" ? game.user.id : null
					}, {}, {}, game.user.id);
				}
				return next;
			}
		}
	};
	vm.runInNewContext(source, {
		game,
		Hooks,
		BBMM_ID: "bbmm",
		LT: { sync: { LockedByGM: () => "Locked by GM" } },
		DL: (...args) => {
			if (args[0] === 2) errors.push(args);
		},
		foundry: {
			utils: { equals: isDeepStrictEqual, duplicate: structuredClone },
			applications: { api: { ApplicationV2: class {} } }
		},
		ui: { notifications: { warn() {} } },
		setTimeout: fn => timers.push(fn)
	});
	return {
		game, rules, values, Hooks, writes, errors,
		set: value => game.settings.set("example", "selected", value),
		get: () => game.settings.get("example", "selected"),
		async flush() {
			let count = 0;
			while (timers.length) {
				assert.ok(++count < 10, "hard-lock repair did not settle");
				await timers.shift()();
			}
		}
	};
}

test("client changes restore the hard-locked value", async () => {
	const h = setup();
	await h.set(true);
	await h.flush();
	assert.equal(h.get(), false);
	assert.equal(h.writes.length, 2);
});

for (const existing of [false, true]) {
	test(`user setting ${existing ? "updates" : "creation"} restore the hard-locked value`, async () => {
		const h = setup({ scope: "user" });
		if (existing) h.values.set("example.selected", false);
		await h.set(true);
		await h.flush();
		assert.equal(h.get(), false);
		assert.equal(h.writes.length, 2);
	});
}

const exemptions = {
	GM: { isGM: true },
	soft: { soft: true },
	disabled: { enabled: false },
	world: { scope: "world" }
};
for (const [name, options] of Object.entries(exemptions)) {
	test(`${name} settings are not reverted`, async () => {
		const h = setup(options);
		await h.set(true);
		await h.flush();
		assert.equal(h.get(), true);
		assert.equal(h.writes.length, 1);
	});
}

for (const change of ["unlock", "soft", "disable", "GM", "new value"]) {
	test(`queued reverts respect ${change}`, async () => {
		const h = setup();
		await h.set(true);
		if (change === "unlock") delete h.rules["example.selected"];
		if (change === "soft") h.rules["example.selected"].soft = true;
		if (change === "disable") h.values.set("bbmm.enableUserSettingSync", false);
		if (change === "GM") h.game.user.isGM = true;
		if (change === "new value") h.rules["example.selected"].value = true;
		await h.flush();
		assert.equal(h.get(), true);
		assert.equal(h.writes.length, 1);
	});
}

test("a queued revert uses the latest lock value", async () => {
	const h = setup({ value: 1 });
	await h.set(2);
	h.rules["example.selected"].value = 3;
	await h.flush();
	assert.equal(h.get(), 3);
});

test("repeated changes produce one revert and preserve object-valued locks", async () => {
	const value = { volume: 0.5, appearance: { enabled: true } };
	const h = setup({ value });
	await h.set({ volume: 1 });
	await h.set({ volume: 0 });
	await h.flush();
	assert.deepEqual(h.get(), value);
	assert.deepEqual(h.rules["example.selected"].value, value);
	assert.equal(h.writes.length, 3);
});

test("a change made during a restore is also reverted", async () => {
	const h = setup();
	let changeAgain = true;
	h.Hooks.on("clientSettingChanged", (id, value) => {
		if (id === "example.selected" && value === false && changeAgain) {
			changeAgain = false;
			h.set(true);
		}
	});
	await h.set(true);
	await h.flush();
	assert.equal(h.get(), false);
});

test("setting updates for other users and unknown keys are ignored", async () => {
	const h = setup({ scope: "user" });
	h.values.set("example.selected", true);
	h.Hooks.callAll("updateSetting", { key: "example.selected", user: "other", value: true });
	h.Hooks.callAll("clientSettingChanged", "unknown.key", true, {});
	await h.flush();
	assert.equal(h.get(), true);
	assert.equal(h.writes.length, 0);
});

test("a failed revert can be retried by a later change", async () => {
	const h = setup();
	await h.set(true);
	const set = h.game.settings.set;
	h.game.settings.set = async () => { throw new Error("offline"); };
	await h.flush();
	assert.equal(h.errors.length, 1);
	h.game.settings.set = set;
	h.Hooks.callAll("clientSettingChanged", "example.selected", true, {});
	await h.flush();
	assert.equal(h.get(), false);
});
