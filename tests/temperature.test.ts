import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, CREATIVITY } from "../src/defaultSettings";
import {
	API_DEFAULT_CREATIVITY_KEY,
	LEGACY_FALLBACK_CREATIVITY,
	applyCreativityKey,
	getEffectiveCreativityKey,
	isLegacyCreativityValue,
	normalizeCreativityForLegacy,
	resolveTemperature,
} from "../src/temperature";
import { executeProviderRequest } from "../src/providerRequest";
import { migrateSettings } from "../src/settingsMigration";
import { syncCommunityActions } from "../src/settingsCommunityActionsSync";
import {
	buildCommunityActionRef,
	buildSharingString,
} from "../src/settingsTabUtils";
import type { LocalGPTAction, LocalGPTSettings } from "../src/interfaces";

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
				aiProviders: { execute, version: 5 } as any,
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

	it("omitTemperature resolves like API default regardless of legacy creativity", () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.defaults.omitTemperature = true;
		settings.defaults.creativity = "high";
		expect(resolveTemperature(settings)).toBeUndefined();
		expect(getEffectiveCreativityKey(settings)).toBe(
			API_DEFAULT_CREATIVITY_KEY,
		);
	});

	it.each([undefined, "", "low"] as const)(
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
			expect(settings!._version).toBe(11);
		},
	);

	it('migration rewrites creativity "default" into omitTemperature + legacy low', async () => {
		const loaded = {
			defaults: { creativity: "default" },
			actions: [{ name: "Legacy", prompt: "Synthetic" }],
			_version: 3,
		} as any;
		const { settings } = await migrateSettings(
			loaded,
			"synthetic-legacy-key",
		);
		expect(settings!.defaults.omitTemperature).toBe(true);
		expect(settings!.defaults.creativity).toBe(LEGACY_FALLBACK_CREATIVITY);
		expect(getEffectiveCreativityKey(settings!)).toBe(
			API_DEFAULT_CREATIVITY_KEY,
		);
		expect(resolveTemperature(settings!)).toBeUndefined();
	});

	it("new settings and actions do not synthesize temperature", () => {
		expect(DEFAULT_SETTINGS.defaults).not.toHaveProperty("creativity");
		expect(DEFAULT_SETTINGS.defaults).not.toHaveProperty("omitTemperature");
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

describe("legacy-readable creativity storage", () => {
	/** Mimic old Local GPT CREATIVITY lookup (no "default" key). */
	const LEGACY_CREATIVITY: Record<string, { temperature?: number }> = {
		"": { temperature: 0 },
		low: { temperature: 0.2 },
		medium: { temperature: 0.5 },
		high: { temperature: 1 },
	};

	it("applyCreativityKey stores API default without writing creativity=default", () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		applyCreativityKey(settings, API_DEFAULT_CREATIVITY_KEY);
		expect(settings.defaults.omitTemperature).toBe(true);
		expect(settings.defaults.creativity).toBe(LEGACY_FALLBACK_CREATIVITY);
		expect(settings.defaults.creativity).not.toBe(
			API_DEFAULT_CREATIVITY_KEY,
		);
		expect(isLegacyCreativityValue(settings.defaults.creativity)).toBe(
			true,
		);
	});

	it("applyCreativityKey clears omitTemperature for legacy presets", () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		applyCreativityKey(settings, API_DEFAULT_CREATIVITY_KEY);
		applyCreativityKey(settings, "medium");
		expect(settings.defaults.omitTemperature).toBeUndefined();
		expect(settings.defaults.creativity).toBe("medium");
		expect(resolveTemperature(settings)).toBe(0.5);
	});

	it("legacy schema can parse new dual-field settings as low creativity", () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		applyCreativityKey(settings, API_DEFAULT_CREATIVITY_KEY);
		const stored = JSON.parse(
			JSON.stringify(settings),
		) as LocalGPTSettings;

		// Old Local GPT only reads defaults.creativity
		const legacyKey = stored.defaults.creativity;
		expect(isLegacyCreativityValue(legacyKey)).toBe(true);
		expect(LEGACY_CREATIVITY[legacyKey!]?.temperature).toBe(0.2);
		// Old ignores unknown fields
		expect(stored.defaults.omitTemperature).toBe(true);
		expect(stored.providerReasoningEffort).toBeUndefined();
	});

	it("normalizeCreativityForLegacy rewrites in-place creativity=default", () => {
		const settings = {
			...structuredClone(DEFAULT_SETTINGS),
			defaults: { creativity: "default", contextLimit: "local" },
		};
		expect(normalizeCreativityForLegacy(settings)).toBe(true);
		expect(settings.defaults.omitTemperature).toBe(true);
		expect(settings.defaults.creativity).toBe(LEGACY_FALLBACK_CREATIVITY);
		expect(normalizeCreativityForLegacy(settings)).toBe(false);
	});

	it("action temperature null is ignored by legacy || fallback", () => {
		const actionTemp: number | null | undefined = null;
		const legacyCreativity = "low";
		const legacyResolved =
			actionTemp || LEGACY_CREATIVITY[legacyCreativity].temperature;
		expect(legacyResolved).toBe(0.2);
		expect(resolveTemperature(DEFAULT_SETTINGS, null)).toBeUndefined();
	});

	it("new CREATIVITY.default remains empty for runtime API-default key", () => {
		expect(CREATIVITY[API_DEFAULT_CREATIVITY_KEY]).toEqual({});
		expect(
			CREATIVITY[API_DEFAULT_CREATIVITY_KEY]?.temperature,
		).toBeUndefined();
	});
});

describe("reasoning status gating on old AI Providers", () => {
	it("does not call checkCompatibility or onReasoningResolved when service version < 5", async () => {
		const checkCompatibility = vi.fn();
		const onReasoningResolved = vi.fn();
		const execute = vi.fn().mockResolvedValue("ok");
		await executeProviderRequest({
			aiProviders: {
				execute,
				checkCompatibility,
				version: 4,
			} as any,
			provider: {
				id: "p",
				name: "P",
				type: "openai",
				model: "fixture-alpha",
			},
			settings: structuredClone(DEFAULT_SETTINGS),
			prompt: "hi",
			selectedText: "",
			context: "",
			imagesInBase64: [],
			abortController: new AbortController(),
			onUpdate: vi.fn(),
			onReasoningResolved,
			reasoningEffort: "high",
		});
		expect(checkCompatibility).not.toHaveBeenCalled();
		expect(onReasoningResolved).not.toHaveBeenCalled();
		expect(execute).toHaveBeenCalled();
	});
});
