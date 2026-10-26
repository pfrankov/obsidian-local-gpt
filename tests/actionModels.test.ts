import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionModelLabel, resolveActionModel } from "../src/actionModels";
import { rememberActionModel } from "../src/localGptCommands";
import LocalGPT from "../src/main";
import type { IAIProvidersService } from "@obsidian-ai-providers/sdk";
import type { LocalGPTSettings } from "../src/interfaces";

vi.mock("obsidian");
vi.mock("../src/ui/actionPalettePlugin", () => ({
	actionPalettePlugin: [],
	showActionPalette: vi.fn(),
	hideActionPalette: vi.fn(),
}));
vi.mock("../src/spinnerPlugin", () => ({ spinnerPlugin: {} }));
const settings: LocalGPTSettings = {
	aiProviders: { main: "main", embedding: "embed", vision: "vision" },
	defaults: {},
	actions: [],
	_version: 11,
};
const main = {
	id: "main",
	name: "Local",
	model: "fast",
	availableModels: ["fast"],
};
const other = {
	id: "other",
	name: "Other",
	model: "default",
	modelCapabilities: { text: { vision: false } },
};
const service = { providers: [main, other] } as unknown as IAIProvidersService;

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
});
describe("saved action models", () => {
	it("resolves a request-local clone without changing any provider or global setting", () => {
		const selected = resolveActionModel(service, {
			providerId: "main",
			model: "manual",
		});
		expect(selected).toEqual({ ...main, model: "manual" });
		expect(selected).not.toBe(main);
		expect(main.model).toBe("fast");
		expect(settings.aiProviders).toEqual({
			main: "main",
			embedding: "embed",
			vision: "vision",
		});
	});
	it("does not reject manually entered models because a cached catalog omits them", () => {
		expect(
			resolveActionModel(service, { providerId: "main", model: "manual" })
				.model,
		).toBe("manual");
	});
	it("fails closed for a deleted provider or invalid model instead of using the default", () => {
		expect(() =>
			resolveActionModel(service, {
				providerId: "deleted",
				model: "fast",
			}),
		).toThrow();
		expect(() =>
			resolveActionModel(service, { providerId: "main", model: " " }),
		).toThrow();
	});
	it("keeps explicit routing for images and rejects a known text-only model", () => {
		expect(() =>
			resolveActionModel(
				service,
				{ providerId: "other", model: "text" },
				true,
			),
		).toThrow();
		expect(
			resolveActionModel(
				service,
				{ providerId: "main", model: "manual" },
				true,
			).id,
		).toBe("main");
	});
	it("labels inherited choices and disambiguates providers", () => {
		expect(
			actionModelLabel(
				{ name: "A", prompt: "" },
				service.providers,
				settings,
			),
		).toContain("Use default · Local · fast");
		expect(
			actionModelLabel(
				{
					name: "A",
					prompt: "",
					modelSelection: { providerId: "other", model: "fast" },
				},
				service.providers,
				settings,
			),
		).toBe("Other · fast");
	});
	it("persists a choice on the same Action and resets without reloading or changing freeform", async () => {
		const action = {
			id: "a",
			name: "Translate",
			prompt: "Translate",
			temperature: 0,
			replace: true,
		};
		const plugin = {
			settings: { ...settings, actions: [action] },
			saveData: vi.fn(),
			reload: vi.fn(),
			actionPaletteModel: "freeform",
		} as unknown as LocalGPT;
		await rememberActionModel(plugin, "a", {
			providerId: "main",
			model: "precise",
		});
		expect(plugin.settings.actions[0]).toBe(action);
		expect(plugin.settings.actions[0].modelSelection).toEqual({
			providerId: "main",
			model: "precise",
		});
		expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		expect(plugin.reload).not.toHaveBeenCalled();
		expect(plugin.actionPaletteModel).toBe("freeform");
		await rememberActionModel(plugin, "a");
		expect(plugin.settings.actions[0]).not.toHaveProperty("modelSelection");
		expect(action.temperature).toBe(0);
	});
	it("rolls back the in-memory choice if persistence fails", async () => {
		const previous = { providerId: "main", model: "fast" };
		const action = {
			id: "a",
			name: "A",
			prompt: "",
			modelSelection: previous,
		};
		const plugin = {
			settings: { ...settings, actions: [action] },
			saveData: vi.fn().mockRejectedValue(new Error("disk")),
		} as unknown as LocalGPT;
		await expect(
			rememberActionModel(plugin, "a", {
				providerId: "other",
				model: "slow",
			}),
		).rejects.toThrow("disk");
		expect(action.modelSelection).toBe(previous);
	});
});
