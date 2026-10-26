import { beforeEach, it, expect, vi } from "vitest";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import LocalGPT from "../src/main";
import {
	registerLocalGPTCommands,
	rememberActionModel,
} from "../src/localGptCommands";
vi.mock("obsidian");
vi.mock("../src/spinnerPlugin", () => ({ spinnerPlugin: {} }));
vi.mock("../src/logger");
vi.mock("../src/ui/actionPalettePlugin", () => ({
	actionPalettePlugin: [],
	showActionPalette: vi.fn(),
	hideActionPalette: vi.fn(),
}));
let plugin: LocalGPT, execute: any, editor: any;
beforeEach(() => {
	vi.clearAllMocks();
	const app = {
		workspace: { updateOptions: vi.fn() },
		vault: { getName: () => "review" },
	};
	plugin = new LocalGPT(app as any, {} as any);
	(plugin as any).app = app;
	plugin.settings = {
		aiProviders: {
			main: "local",
			embedding: "embedding",
			vision: "vision",
		},
		defaults: {},
		actions: [
			{
				id: "a",
				name: "Translate",
				prompt: "Translate {selection}",
				system: "system",
				temperature: 0,
				replace: true,
			},
		],
		_version: 11,
	};
	execute = vi.fn().mockResolvedValue("answer");
	vi.mocked(waitForAI).mockResolvedValue({
		promise: Promise.resolve({
			providers: [
				{ id: "local", name: "Local", model: "fast" },
				{ id: "cloud", name: "Cloud", model: "default" },
				{ id: "embedding", name: "Emb", model: "embed" },
			],
			execute,
			version: 5,
			checkCompatibility: vi.fn(),
		}),
		cancel: vi.fn(),
	} as any);
	vi.spyOn(plugin, "enhanceWithContext").mockResolvedValue("context");
	vi.spyOn(plugin as any, "applyTextResult").mockImplementation(() => {});
	editor = {
		cm: { state: { field: vi.fn() }, plugin: vi.fn() },
		getSelection: () => "word",
		getCursor: () => ({ line: 0, ch: 0 }),
		posToOffset: () => 0,
	};
	(plugin as any).saveData = vi.fn();
});
it("registered command sees model changed after registration, retains action parameters", async () => {
	const commands: any[] = [];
	plugin.addCommand = vi.fn((c) => {
		commands.push(c);
		return c;
	});
	registerLocalGPTCommands(plugin);
	await rememberActionModel(plugin, "a", {
		providerId: "cloud",
		model: "precise",
	});
	commands.find((c) => c.id === "quick-access-1").editorCallback(editor);
	await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
	expect(execute.mock.calls[0][0].provider).toMatchObject({
		id: "cloud",
		model: "precise",
	});
	expect(execute.mock.calls[0][0].systemPrompt).toBe("system");
	expect(execute.mock.calls[0][0].options).toEqual({ temperature: 0 });
	expect(plugin.enhanceWithContext).toHaveBeenCalledWith(
		"word",
		expect.anything(),
		expect.objectContaining({ id: "embedding" }),
		expect.anything(),
		undefined,
		"word",
	);
});
it("missing bound provider stops before embeddings and generation", async () => {
	plugin.settings.actions[0].modelSelection = {
		providerId: "deleted",
		model: "precise",
	};
	await plugin.runAction(plugin.settings.actions[0], editor);
	expect(execute).not.toHaveBeenCalled();
	expect(plugin.enhanceWithContext).not.toHaveBeenCalled();
});
it("freeform provider/model remains separate after saved action selection", async () => {
	plugin.actionPaletteModel = "freeform";
	plugin.actionPaletteModelProviderId = "local";
	await rememberActionModel(plugin, "a", {
		providerId: "cloud",
		model: "precise",
	});
	await plugin.runAction(plugin.settings.actions[0], editor);
	await plugin.runFreeform(editor, "test", [], "local");
	expect(
		execute.mock.calls.map((c: any) => [
			c[0].provider.id,
			c[0].provider.model,
		]),
	).toEqual([
		["cloud", "precise"],
		["local", "freeform"],
	]);
});
