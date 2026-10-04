import { describe, expect, it, vi } from "vitest";
import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { DEFAULT_SETTINGS } from "../src/defaultSettings";
import type { LocalGPTAction, LocalGPTSettings } from "../src/interfaces";
import {
	executeProviderRequest,
	overrideProviderModel,
	selectProvider,
} from "../src/providerRequest";
import { resolveReasoningEffort } from "../src/reasoningEffort";
import { syncCommunityActions } from "../src/settingsCommunityActionsSync";
import {
	buildCommunityActionRef,
	buildSharingString,
} from "../src/settingsTabUtils";
import type { CommunityAction } from "../src/CommunityActionsService";

const provider: IAIProvider = {
	id: "zai-1",
	name: "Z.AI",
	type: "zai",
	model: "glm-5.3-flash",
	modelCapabilities: {
		"glm-5.3-flash": {
			text: true,
			tools: true,
			embedding: false,
			vision: false,
			reasoningModes: ["low", "high", "max"],
		},
	},
};
const settings = (): LocalGPTSettings => structuredClone(DEFAULT_SETTINGS);

describe("reasoning effort", () => {
	it.each(["low", "high", "max"] as const)(
		"uses the provider's %s preference and an action override",
		(effort) => {
			const config = settings();
			config.providerReasoningEffort = { [provider.id]: effort };
			expect(resolveReasoningEffort(provider, config)).toBe(effort);
			expect(resolveReasoningEffort(provider, config, "high")).toBe(
				"high",
			);
			expect(
				resolveReasoningEffort(provider, config, "default"),
			).toBeUndefined();
		},
	);

	it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"])(
		"passes the declared native %s mode unchanged, with inheritance distinct from API default",
		async (mode) => {
			const model = "manual-deployment";
			const native: IAIProvider = {
				...provider,
				type: "openai",
				model,
				modelCapabilities: {
					[model]: {
						...provider.modelCapabilities!["glm-5.3-flash"],
						reasoningModes: [
							"none",
							"minimal",
							"low",
							"medium",
							"high",
							"xhigh",
							"max",
						],
					},
				},
			};
			const config = settings();
			config.providerReasoningEffort = { [native.id]: mode };
			expect(resolveReasoningEffort(native, config)).toBe(mode);
			expect(
				resolveReasoningEffort(native, config, "default"),
			).toBeUndefined();
			const execute = vi.fn().mockResolvedValue("answer");
			const params = {
				aiProviders: { execute, checkCompatibility: vi.fn() } as any,
				provider: native,
				settings: config,
				prompt: "Synthetic",
				selectedText: "",
				context: "",
				imagesInBase64: [],
				temperature: 0.2,
				abortController: new AbortController(),
				onUpdate: vi.fn(),
			};
			await executeProviderRequest(params);
			expect(execute.mock.calls[0][0].reasoningMode).toBe(mode);
			expect(execute.mock.calls[0][0].options).toEqual({
				temperature: 0.2,
			});
			await executeProviderRequest({
				...params,
				reasoningEffort: "default",
			});
			expect(execute.mock.calls[1][0]).not.toHaveProperty(
				"reasoningMode",
			);
		},
	);

	it("omits unset and invalid persisted values", () => {
		const config = settings();
		expect(resolveReasoningEffort(provider, config)).toBeUndefined();
		for (const value of ["none", "medium", "off", "", 1, {}]) {
			config.providerReasoningEffort = { [provider.id]: value } as any;
			expect(resolveReasoningEffort(provider, config)).toBeUndefined();
			expect(
				resolveReasoningEffort(provider, config, value as any),
			).toBeUndefined();
		}
	});

	it.each([
		{ modelCapabilities: undefined },
		{ modelCapabilities: {} },
		{
			modelCapabilities: {
				"glm-5.3-flash": {
					text: true,
					tools: true,
					embedding: false,
					vision: false,
				},
			},
		},
		{ model: "glm-4.7" },
		{ model: "glm-5.3" },
		{ model: "glm-5.3-flashx" },
		{ model: undefined },
	] as Partial<IAIProvider>[])(
		"omits effort on unsupported configuration %j",
		(change) => {
			const config = settings();
			config.providerReasoningEffort = { [provider.id]: "low" };
			expect(
				resolveReasoningEffort(
					{ ...provider, ...change },
					config,
					"max",
				),
			).toBeUndefined();
		},
	);

	it("keeps defaults tied to provider identity, not name or model", () => {
		const config = settings();
		config.providerReasoningEffort = { [provider.id]: "low" };
		expect(
			resolveReasoningEffort({ ...provider, name: "Renamed" }, config),
		).toBe("low");
		expect(
			resolveReasoningEffort({ ...provider, id: "zai-2" }, config),
		).toBeUndefined();
	});

	it("resolves after model and vision routing without leaking the palette model", () => {
		const config = settings();
		config.aiProviders.main = provider.id;
		config.aiProviders.vision = "vision";
		config.providerReasoningEffort = {
			[provider.id]: "low",
			vision: "max",
		};
		const vision: IAIProvider = {
			...provider,
			id: "vision",
			model: "glm-4.5v",
		};
		const service = {
			providers: [provider, vision],
		} as IAIProvidersService;
		const routed = selectProvider(service, config, true, provider.id);
		const adjusted = overrideProviderModel(
			routed,
			provider.id,
			provider.model!,
			provider.id,
		);
		expect(adjusted).toBe(vision);
		expect(resolveReasoningEffort(adjusted, config, "low")).toBeUndefined();
		const otherModel = overrideProviderModel(
			provider,
			provider.id,
			"glm-4.7",
			provider.id,
		);
		expect(resolveReasoningEffort(otherModel, config)).toBeUndefined();
		const supportedVision = { ...vision, model: provider.model };
		expect(resolveReasoningEffort(supportedVision, config)).toBe("max");
		expect(
			overrideProviderModel(provider, "other", "glm-4.7", provider.id),
		).toBe(provider);
		expect(provider.model).toBe("glm-5.3-flash");
	});

	it.each([undefined, "low", "high", "max", "default"] as const)(
		"preserves request and streaming shape with action effort %s",
		async (effort) => {
			const config = settings();
			const execute = vi.fn(async (request) => {
				request.onProgress("part", "answer");
				return "answer";
			});
			const onUpdate = vi.fn();
			const abortController = new AbortController();
			const result = await executeProviderRequest({
				aiProviders: {
					execute,
					checkCompatibility: vi.fn(),
				} as unknown as IAIProvidersService,
				provider,
				settings: config,
				prompt: "{{=SELECTION=}} {{=CONTEXT=}}",
				selectedText: "word",
				context: "context",
				system: "system",
				temperature: 0,
				imagesInBase64: ["image"],
				abortController,
				onUpdate,
				reasoningEffort: effort,
			});
			expect(result).toBe("answer");
			expect(onUpdate).toHaveBeenCalledWith("answer");
			const request = execute.mock.calls[0][0];
			expect(request).toMatchObject({
				provider,
				prompt: "word context",
				systemPrompt: "system",
				images: ["image"],
				abortController,
			});
			expect(request.options).toEqual({ temperature: 0 });
			expect(request.reasoningMode).toBe(
				effort && effort !== "default" ? effort : undefined,
			);
			if (!effort || effort === "default")
				expect(request).not.toHaveProperty("reasoningMode");
		},
	);

	it("preserves local overrides and community links through sync, without exporting them", async () => {
		const remote: CommunityAction = {
			id: "community-1",
			name: "Translate",
			language: "en",
			prompt: "Old prompt",
			author: "test",
			score: 1,
		};
		const local: LocalGPTAction = {
			name: remote.name,
			prompt: remote.prompt!,
			reasoningEffort: "low",
			community: buildCommunityActionRef(remote),
		};
		const config = settings();
		config.actions = [local];
		const plugin = { settings: config, saveSettings: vi.fn() };
		expect(
			await syncCommunityActions(plugin as any, [
				{ ...remote, prompt: "New prompt" },
			]),
		).toEqual({ updated: 1, skipped: 0 });
		expect(local.prompt).toBe("New prompt");
		expect(local.reasoningEffort).toBe("low");
		expect(local.community?.id).toBe(remote.id);
		expect(buildSharingString(local, "en")).not.toContain("low");
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
	});
	it("binds one-request overrides to the effective provider/model and reports the exact SDK value", async () => {
		const config = settings();
		config.providerReasoningEffort = { [provider.id]: "high" };
		const execute = vi.fn().mockResolvedValue("answer");
		const onReasoningResolved = vi.fn();
		const params = {
			aiProviders: { execute, checkCompatibility: vi.fn() } as any,
			provider,
			settings: config,
			prompt: "Synthetic",
			selectedText: "",
			context: "",
			imagesInBase64: [],
			abortController: new AbortController(),
			onUpdate: vi.fn(),
			onReasoningResolved,
		};
		await executeProviderRequest({
			...params,
			reasoningSelection: {
				providerId: provider.id,
				model: provider.model,
				mode: "low",
			},
		});
		expect(execute.mock.calls[0][0].reasoningMode).toBe("low");
		expect(onReasoningResolved).toHaveBeenLastCalledWith(provider, "low");
		await executeProviderRequest({
			...params,
			reasoningSelection: {
				providerId: "other",
				model: provider.model,
				mode: "low",
			},
		});
		expect(execute.mock.calls[1][0].reasoningMode).toBe("high");
		await executeProviderRequest({
			...params,
			reasoningSelection: {
				providerId: provider.id,
				model: provider.model,
				mode: "default",
			},
		});
		expect(execute.mock.calls[2][0]).not.toHaveProperty("reasoningMode");
		expect(onReasoningResolved).toHaveBeenLastCalledWith(
			provider,
			undefined,
		);
		await executeProviderRequest(params);
		expect(execute.mock.calls[3][0].reasoningMode).toBe("high");
	});
	it("does not send after cancellation or publish late chunks, and a fresh retry inherits again", async () => {
		const config = settings();
		config.providerReasoningEffort = { [provider.id]: "high" };
		const aborted = new AbortController();
		aborted.abort();
		const execute = vi.fn(async (request) => {
			request.onProgress("first", "first");
			request.onProgress("late", "first late");
			return "first late";
		});
		const service = { execute, checkCompatibility: vi.fn() } as any;
		const base = {
			aiProviders: service,
			provider,
			settings: config,
			prompt: "Synthetic",
			selectedText: "",
			context: "",
			imagesInBase64: [],
		};
		const status = vi.fn();
		await executeProviderRequest({
			...base,
			abortController: aborted,
			onUpdate: vi.fn(),
			onReasoningResolved: status,
		});
		expect(execute).not.toHaveBeenCalled();
		expect(status).not.toHaveBeenCalled();
		const running = new AbortController();
		const onUpdate = vi.fn(() => running.abort());
		await executeProviderRequest({
			...base,
			abortController: running,
			onUpdate,
			reasoningSelection: {
				providerId: provider.id,
				model: provider.model,
				mode: "low",
			},
		});
		expect(onUpdate).toHaveBeenCalledOnce();
		expect(execute.mock.calls[0][0].reasoningMode).toBe("low");
		await executeProviderRequest({
			...base,
			abortController: new AbortController(),
			onUpdate: vi.fn(),
		});
		expect(execute.mock.calls[1][0].reasoningMode).toBe("high");
	});
	it("consumes native boolean identifiers without imposing a LocalGPT effort scale", () => {
		const native: IAIProvider = {
			...provider,
			type: "ollama",
			model: "qwen3:8b",
			modelCapabilities: {
				"qwen3:8b": {
					text: true,
					embedding: false,
					tools: false,
					vision: false,
					reasoningModes: ["true", "false"],
				},
			},
		};
		expect(resolveReasoningEffort(native, settings(), "false")).toBe(
			"false",
		);
		expect(
			resolveReasoningEffort(native, settings(), "low"),
		).toBeUndefined();
	});
});
