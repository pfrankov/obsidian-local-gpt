import { afterEach, describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import {
	aiProvidersUpgradeMessage,
	maybeNoticeAiProvidersUpgrade,
	resetAiProvidersUpgradeNoticeForTests,
	supportsReasoningApi,
	REQUIRED_AI_PROVIDERS_PLUGIN_VERSION,
} from "../src/aiProvidersCompat";
import { getAvailableCommands } from "../src/ui/actionPaletteOptions";
import { executeProviderRequest } from "../src/providerRequest";
import { DEFAULT_SETTINGS } from "../src/defaultSettings";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	return {
		...actual,
		Notice: vi.fn(),
	};
});

afterEach(() => {
	resetAiProvidersUpgradeNoticeForTests();
	vi.clearAllMocks();
});

describe("aiProvidersCompat", () => {
	it("supportsReasoningApi requires service API 5+", () => {
		expect(supportsReasoningApi({ version: 4 })).toBe(false);
		expect(supportsReasoningApi({ version: 5 })).toBe(true);
		expect(supportsReasoningApi(null)).toBe(false);
	});

	it("upgrade message names the required plugin version", () => {
		expect(aiProvidersUpgradeMessage()).toContain(
			REQUIRED_AI_PROVIDERS_PLUGIN_VERSION,
		);
	});

	it("shows a one-time Notice when API is below 5", () => {
		maybeNoticeAiProvidersUpgrade({ version: 4 });
		maybeNoticeAiProvidersUpgrade({ version: 4 });
		expect(Notice).toHaveBeenCalledTimes(1);
		expect((Notice as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
			REQUIRED_AI_PROVIDERS_PLUGIN_VERSION,
		);
	});

	it("does not Notice when API is 5+", () => {
		maybeNoticeAiProvidersUpgrade({ version: 5 });
		expect(Notice).not.toHaveBeenCalled();
	});
});

describe("palette commands vs reasoning API", () => {
	it("omits /reasoning when includeReasoning is false", () => {
		expect(
			getAvailableCommands(false).map((command) => command.name),
		).not.toContain("reasoning");
		expect(
			getAvailableCommands(true).map((command) => command.name),
		).toContain("reasoning");
	});
});

describe("executeProviderRequest vs API version", () => {
	const provider = {
		id: "p1",
		name: "P",
		type: "openai" as const,
		model: "gpt",
		modelCapabilities: {
			gpt: {
				text: true,
				tools: false,
				embedding: false,
				vision: false,
				reasoningModes: ["low"],
			},
		},
	};

	it("never sends reasoningMode when service API is v4", async () => {
		const execute = vi.fn().mockResolvedValue("ok");
		const checkCompatibility = vi.fn();
		const settings = {
			...DEFAULT_SETTINGS,
			providerReasoningEffort: { p1: "low" },
		};
		await executeProviderRequest({
			aiProviders: {
				version: 4,
				execute,
				checkCompatibility,
			} as any,
			provider: provider as any,
			settings,
			prompt: "hi",
			selectedText: "",
			context: "",
			imagesInBase64: [],
			abortController: new AbortController(),
			onUpdate: vi.fn(),
		});
		expect(checkCompatibility).not.toHaveBeenCalled();
		expect(execute.mock.calls[0][0]).not.toHaveProperty("reasoningMode");
	});

	it("sends reasoningMode and checks compatibility on API v5", async () => {
		const execute = vi.fn().mockResolvedValue("ok");
		const checkCompatibility = vi.fn();
		const settings = {
			...DEFAULT_SETTINGS,
			providerReasoningEffort: { p1: "low" },
		};
		await executeProviderRequest({
			aiProviders: {
				version: 5,
				execute,
				checkCompatibility,
			} as any,
			provider: provider as any,
			settings,
			prompt: "hi",
			selectedText: "",
			context: "",
			imagesInBase64: [],
			abortController: new AbortController(),
			onUpdate: vi.fn(),
		});
		expect(checkCompatibility).toHaveBeenCalledWith(5);
		expect(execute.mock.calls[0][0].reasoningMode).toBe("low");
	});
});
