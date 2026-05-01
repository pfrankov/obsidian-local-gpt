import { beforeEach, describe, expect, it, vi } from "vitest";
import LocalGPT from "../src/main";
import { App, PluginManifest, TFile } from "obsidian";
import type { LocalGPTSettings } from "../src/interfaces";
import { showActionPalette } from "../src/ui/actionPalettePlugin";

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
				selectionContextMode: "selection",
			}),
			editor,
		);
	});

	it("extracts only the selected text unless document context mode is enabled", () => {
		const editor = {
			cm: {},
			getSelection: vi.fn().mockReturnValue(""),
			getValue: vi.fn().mockReturnValue("Full document"),
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
			posToOffset: vi.fn().mockReturnValue(0),
		};

		const selectedOnly = (plugin as any).extractSelectionContext(
			editor,
			"selection",
		);

		expect(selectedOnly.selectedTextRef.value).toBe("");
		expect(editor.getValue).not.toHaveBeenCalled();

		const documentMode = (plugin as any).extractSelectionContext(
			editor,
			"selection-or-document",
		);

		expect(documentMode.selectedTextRef.value).toBe("Full document");
	});

	it("preselects the active document only when nothing is selected", () => {
		const editorWithoutSelection = {
			getSelection: vi.fn().mockReturnValue(""),
		};
		const editorWithSelection = {
			getSelection: vi.fn().mockReturnValue("Selected text"),
		};
		(plugin as any).app.workspace.getActiveFile = vi
			.fn()
			.mockReturnValue({ path: "notes/active.md" });

		expect(
			(plugin as any).getActionPaletteInitialSelectedFiles(
				editorWithoutSelection,
			),
		).toEqual(["notes/active.md"]);
		expect(
			(plugin as any).getActionPaletteInitialSelectedFiles(
				editorWithSelection,
			),
		).toEqual([]);
	});

	it("opens the action palette with the active document selected and submits without direct document fallback", async () => {
		const addCommand = vi.fn();
		const runFreeform = vi
			.spyOn(plugin as any, "runFreeform")
			.mockResolvedValue(undefined);
		(plugin as any).addCommand = addCommand;
		(plugin as any).app.workspace.getActiveFile = vi
			.fn()
			.mockReturnValue({ path: "notes/active.md" });
		(plugin as any).settings = {
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
			actionPalette: {
				systemPromptActionId: null,
			},
			_version: 10,
		};

		(plugin as any).addCommands();

		const paletteCommand = addCommand.mock.calls
			.map(([command]) => command)
			.find(
				(command: { id: string }) =>
					command.id === "local-gpt-action-palette",
			);
		expect(paletteCommand).toBeTruthy();

		const editor = {
			cm: {},
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
			posToOffset: vi.fn().mockReturnValue(0),
			getSelection: vi.fn().mockReturnValue(""),
		};

		await paletteCommand.editorCallback(editor);

		expect(showActionPalette).toHaveBeenCalledTimes(1);
		const [, , options] = (showActionPalette as any).mock.calls[0];
		expect(options.initialSelectedFiles).toEqual(["notes/active.md"]);

		options.onSubmit("Summarize this note", ["notes/active.md"]);

		expect(runFreeform).toHaveBeenCalledTimes(1);
		expect(runFreeform.mock.calls[0][0]).toBe(editor);
		expect(runFreeform.mock.calls[0][1]).toBe("Summarize this note");
		expect(runFreeform.mock.calls[0][2]).toEqual(["notes/active.md"]);
		expect(runFreeform.mock.calls[0]).toHaveLength(6);
	});

	it("uses the user prompt as the retrieval query when only file context is selected", async () => {
		const activeFile = new TFile();
		activeFile.path = "notes/active.md";
		activeFile.basename = "active";
		activeFile.extension = "md";

		const contextFile = new TFile();
		contextFile.path = "notes/context.md";
		contextFile.basename = "context";
		contextFile.extension = "md";

		const retrieve = vi.fn().mockResolvedValue([]);
		(plugin as any).app = {
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(activeFile),
			},
			vault: {
				getAbstractFileByPath: vi
					.fn()
					.mockImplementation((path: string) =>
						path === contextFile.path ? contextFile : null,
					),
				cachedRead: vi.fn().mockResolvedValue("Context document"),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn(),
				resolvedLinks: {},
			},
		} as any;
		(plugin as any).statusBarItem = {
			show: vi.fn(),
			hide: vi.fn(),
			setAttr: vi.fn(),
			setText: vi.fn(),
		};

		await (plugin as any).enhanceWithContext(
			"",
			{ retrieve },
			{} as any,
			new AbortController(),
			[contextFile.path],
			"Summarize the context file",
		);

		expect(retrieve).toHaveBeenCalledWith(
			expect.objectContaining({ query: "Summarize the context file" }),
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
		expect(
			new Set(result.settings.actions.map((action: any) => action.id))
				.size,
		).toBe(2);
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
		expect(
			plugin.settings.actions.every((action) => Boolean(action.id)),
		).toBe(true);
		expect(plugin.settings.actionPalette?.systemPromptActionId).toBeNull();
		expect(saveData).toHaveBeenCalled();
	});
});
