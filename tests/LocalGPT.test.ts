import { beforeEach, describe, expect, it, vi } from "vitest";
import LocalGPT from "../src/main";
import { App, PluginManifest } from "obsidian";
import type { LocalGPTSettings } from "../src/interfaces";

vi.mock("obsidian");
vi.mock("../src/spinnerPlugin", () => ({
	spinnerPlugin: {},
}));
vi.mock("../src/logger");
vi.mock("../src/ui/actionPalettePlugin", () => ({
	actionPalettePlugin: [],
	showActionPalette: vi.fn(),
	hideActionPalette: vi.fn(),
}));

	describe("LocalGPT", () => {
		let plugin: LocalGPT;

		beforeEach(() => {
			vi.clearAllMocks();
			const app = {
				workspace: { updateOptions: vi.fn() },
				vault: { getName: vi.fn().mockReturnValue("Test Vault") },
			} as unknown as App;
			plugin = new LocalGPT(app, {} as PluginManifest);
			(plugin as any).app = app;
			(plugin as any).manifest = { id: "local-gpt" };
		});

		it("processText strips thinking tags and the selected text", () => {
		const selection = "{{SELECTION}}";
		const result = plugin.processText(
			`<think>internal</think>Final ${selection}`,
			selection,
		);

		expect(result).toBe("\nFinal\n");
		});

		it("runFreeform forwards system prompt to executeAction", async () => {
			const executeAction = vi
				.spyOn(plugin as any, "executeAction")
				.mockResolvedValue(undefined);
		const editor = {} as any;

		await (plugin as any).runFreeform(
			editor,
			"user input",
			["file.md"],
			"provider-1",
			0.7,
			"system prompt",
		);

		expect(executeAction).toHaveBeenCalledTimes(1);
		expect(executeAction).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "user input",
				system: "system prompt",
				replace: false,
				selectedFiles: ["file.md"],
				overrideProviderId: "provider-1",
				temperature: 0.7,
			}),
			editor,
		);
	});

		it("migrates legacy actions to generated ids", async () => {
			const legacySettings: LocalGPTSettings = {
				aiProviders: {
				main: null,
				embedding: null,
				vision: null,
			},
			defaults: {
				creativity: "low",
				contextLimit: "local",
			},
			actions: [
				{
					name: "Legacy one",
					prompt: "Prompt",
					system: "System",
				},
				{
					id: "existing-id",
					name: "Legacy two",
					prompt: "Prompt",
					system: "System",
				},
			],
			_version: 8,
		};

		const result = await (plugin as any).migrateSettings(legacySettings);

		expect(result.changed).toBe(true);
			expect(result.settings._version).toBe(10);
			expect(result.settings.actions[0].id).toBeTruthy();
			expect(result.settings.actions[1].id).toBe("existing-id");
			expect(new Set(result.settings.actions.map((action: any) => action.id)).size).toBe(2);
		});

		it("migrates legacy system prompt selection from localStorage into settings", async () => {
			localStorage.setItem(
				"local-gpt:action-palette-system-prompt:Test Vault",
				JSON.stringify({ id: "preset-id" }),
			);
			const legacySettings: LocalGPTSettings = {
				aiProviders: {
					main: null,
					embedding: null,
					vision: null,
				},
				defaults: {
					creativity: "low",
					contextLimit: "local",
				},
				actions: [],
				_version: 9,
			};

			const result = await (plugin as any).migrateSettings(legacySettings);

			expect(result.changed).toBe(true);
			expect(result.settings._version).toBe(10);
			expect(result.settings.actionPalette?.systemPromptActionId).toBe(
				"preset-id",
			);
			expect(
				localStorage.getItem(
					"local-gpt:action-palette-system-prompt:Test Vault",
				),
			).toBeNull();
		});

		it("assigns generated ids to default actions on fresh load", async () => {
			const loadData = vi.fn().mockResolvedValue(undefined);
		const saveData = vi.fn().mockResolvedValue(undefined);
		(plugin as any).loadData = loadData;
		(plugin as any).saveData = saveData;

			await plugin.loadSettings();

			expect(plugin.settings.actions.length).toBeGreaterThan(0);
			expect(plugin.settings.actions.every((action) => Boolean(action.id))).toBe(true);
			expect(plugin.settings.actionPalette?.systemPromptActionId).toBeNull();
			expect(saveData).toHaveBeenCalled();
		});
});
