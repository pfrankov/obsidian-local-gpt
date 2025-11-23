import LocalGPT from "../src/main";
import { App, PluginManifest } from "obsidian";

jest.mock("obsidian");
jest.mock("../src/spinnerPlugin", () => ({
	spinnerPlugin: {},
}));
jest.mock("../src/logger");
jest.mock("../src/ui/actionPalettePlugin", () => ({
	actionPalettePlugin: [],
	showActionPalette: jest.fn(),
	hideActionPalette: jest.fn(),
}));

describe("LocalGPT", () => {
	let plugin: LocalGPT;

	beforeEach(() => {
		jest.clearAllMocks();
		const app = { workspace: { updateOptions: jest.fn() } } as unknown as App;
		plugin = new LocalGPT(app, {} as PluginManifest);
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
		const executeAction = jest
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
});
