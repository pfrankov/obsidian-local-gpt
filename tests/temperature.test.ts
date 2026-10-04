import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaultSettings";
import { resolveTemperature } from "../src/temperature";
import { executeProviderRequest } from "../src/providerRequest";
import { migrateSettings } from "../src/settingsMigration";
import { syncCommunityActions } from "../src/settingsCommunityActionsSync";
import {
	buildCommunityActionRef,
	buildSharingString,
} from "../src/settingsTabUtils";
import type { LocalGPTAction } from "../src/interfaces";

const cases = [
	[undefined, undefined, undefined],
	["default", undefined, undefined],
	["low", undefined, 0.2],
	["", undefined, 0],
	["high", undefined, 1],
	["high", null, undefined],
	["high", 0, 0],
	["default", 0.7, 0.7],
	[undefined, 0, 0],
	["invalid", undefined, undefined],
] as const;

describe("explicit temperature and API default", () => {
	it.each(cases)(
		"creativity %s, override %s resolves to %s without synthetic defaults",
		async (creativity, override, expected) => {
			const settings = structuredClone(DEFAULT_SETTINGS);
			if (creativity !== undefined)
				settings.defaults.creativity = creativity;
			expect(resolveTemperature(settings, override)).toBe(expected);
			const execute = vi.fn().mockResolvedValue("answer");
			await executeProviderRequest({
				aiProviders: { execute } as any,
				provider: {
					id: "synthetic",
					name: "Synthetic",
					type: "openai",
					model: "arbitrary-model",
				},
				settings,
				temperature: override,
				prompt: "Synthetic",
				selectedText: "",
				context: "",
				imagesInBase64: [],
				abortController: new AbortController(),
				onUpdate: vi.fn(),
			});
			const options = execute.mock.calls[0][0].options;
			expect(Object.hasOwn(options, "temperature")).toBe(
				expected !== undefined,
			);
			expect(options.temperature).toBe(expected);
			expect(JSON.parse(JSON.stringify(options))).toEqual(
				expected === undefined ? {} : { temperature: expected },
			);
		},
	);

	it.each([undefined, "", "low", "default"])(
		"migration preserves explicit creativity %s and never invents it",
		async (creativity) => {
			const loaded = {
				defaults: creativity === undefined ? {} : { creativity },
				actions: [{ name: "Legacy", prompt: "Synthetic" }],
				_version: 3,
			} as any;
			const { settings } = await migrateSettings(
				loaded,
				"synthetic-legacy-key",
			);
			expect(settings!.defaults.creativity).toBe(creativity);
			expect(Object.hasOwn(settings!.defaults, "creativity")).toBe(
				creativity !== undefined,
			);
			expect(settings!.actions[0]).not.toHaveProperty("temperature");
		},
	);

	it("new settings and actions do not synthesize temperature", () => {
		expect(DEFAULT_SETTINGS.defaults).not.toHaveProperty("creativity");
		for (const action of DEFAULT_SETTINGS.actions)
			expect(action).not.toHaveProperty("temperature");
	});

	it.each([undefined, null, 0, 0.7])(
		"community sync keeps local temperature %s without exporting it",
		async (temperature) => {
			const remote = {
				id: "community",
				name: "Synthetic",
				language: "en",
				prompt: "Old",
				author: "test",
				score: 1,
			};
			const local: LocalGPTAction = {
				name: remote.name,
				prompt: remote.prompt,
				community: buildCommunityActionRef(remote),
				...(temperature === undefined ? {} : { temperature }),
			};
			const plugin = {
				settings: {
					...structuredClone(DEFAULT_SETTINGS),
					actions: [local],
				},
				saveSettings: vi.fn(),
			};
			await syncCommunityActions(plugin as any, [
				{ ...remote, prompt: "New" },
			]);
			expect(local.prompt).toBe("New");
			expect(local.temperature).toBe(temperature);
			expect(Object.hasOwn(local, "temperature")).toBe(
				temperature !== undefined,
			);
			expect(buildSharingString(local, "en")).not.toContain(
				"temperature",
			);
		},
	);
});
