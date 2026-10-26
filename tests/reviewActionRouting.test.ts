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

it("preserves existing id and modelSelection when overwriting an action via Quick Add (addNewAction)", async () => {
	const { LocalGPTSettingTab } = await import("../src/LocalGPTSettingTab");
	plugin.settings.actions = [
		{
			id: "existing-action-id",
			name: "Translate",
			prompt: "Old prompt",
			modelSelection: { providerId: "cloud", model: "precise" },
		},
	];
	(plugin as any).saveSettings = vi.fn().mockResolvedValue(undefined);
	const tab = Object.assign(Object.create(LocalGPTSettingTab.prototype), { plugin }) as InstanceType<typeof LocalGPTSettingTab>;
	await tab.addNewAction({
		name: "Translate",
		prompt: "Updated prompt from Quick Add",
		system: "Updated system",
	});

	expect(plugin.settings.actions).toHaveLength(1);
	expect(plugin.settings.actions[0]).toEqual({
		id: "existing-action-id",
		name: "Translate",
		prompt: "Updated prompt from Quick Add",
		system: "Updated system",
		modelSelection: { providerId: "cloud", model: "precise" },
	});
});

it("restores freeform provider and badge when leaving a highlighted action preview to submit freeform text", async () => {
	const { showActionPalette } = await import("../src/ui/actionPalettePlugin");
	const { createComponent, typeIntoPalette } = await import(
		"./helpers/actionPalette"
	);
	plugin.settings.actions = [
		{
			id: "a",
			name: "Translate",
			prompt: "Translate {selection}",
			modelSelection: { providerId: "cloud", model: "precise" },
		},
	];
	const commands: any[] = [];
	plugin.addCommand = vi.fn((c) => {
		commands.push(c);
		return c;
	});
	registerLocalGPTCommands(plugin);
	await commands
		.find((c) => c.id === "local-gpt-action-palette")
		.editorCallback(editor);
	const options = vi.mocked(showActionPalette).mock.calls[0][2];

	const { target, component } = createComponent({
		...options,
		providerLabel: options.modelLabel,
		onSubmit: (event: any) =>
			options.onSubmit(
				event.text,
				event.selectedFiles,
				event.systemPrompt,
				event.reasoningSelection,
				event.replaceSelection,
			),
	});
	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	const footerLabel = target.querySelector<HTMLElement>(
		".local-gpt-provider-badge-label",
	)!;

	// Highlight overridden action -> previews Cloud · precise
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await vi.waitFor(() =>
		expect(footerLabel.textContent).toBe("Cloud · precise"),
	);

	// Type freeform prompt -> restores Local · fast badge and submits to local provider
	await typeIntoPalette(input, "Write a haiku");
	await vi.waitFor(() =>
		expect(footerLabel.textContent).toBe("Local · fast"),
	);
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		}),
	);
	await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
	expect(execute.mock.calls[0][0].provider).toMatchObject({
		id: "local",
		model: "fast",
	});
	component.$destroy();
});

it("resolves inherited Actions from main provider instead of sticky freeform provider when picking a model override", async () => {
	const { showActionPalette } = await import("../src/ui/actionPalettePlugin");
	const { createComponent } = await import("./helpers/actionPalette");
	// Sticky freeform session used "cloud", while configured main provider is "local"
	plugin.actionPaletteProviderId = "cloud";
	plugin.actionPaletteModel = "default";
	plugin.actionPaletteModelProviderId = "cloud";
	plugin.settings.actions = [
		{
			id: "inherited",
			name: "Summarize",
			prompt: "Summarize {selection}",
		},
	];
	vi.mocked(waitForAI).mockResolvedValue({
		promise: Promise.resolve({
			providers: [
				{
					id: "local",
					name: "Local",
					model: "fast",
					availableModels: ["fast", "local-v2"],
				},
				{
					id: "cloud",
					name: "Cloud",
					model: "default",
					availableModels: ["default", "cloud-v2"],
				},
				{ id: "embedding", name: "Emb", model: "embed" },
			],
			execute,
			version: 5,
			checkCompatibility: vi.fn(),
		}),
		cancel: vi.fn(),
	} as any);

	const commands: any[] = [];
	plugin.addCommand = vi.fn((c) => {
		commands.push(c);
		return c;
	});
	registerLocalGPTCommands(plugin);
	await commands
		.find((c) => c.id === "local-gpt-action-palette")
		.editorCallback(editor);
	const options = vi.mocked(showActionPalette).mock.calls[0][2];

	const { target, component } = createComponent({
		...options,
		providerLabel: options.modelLabel,
	});
	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	const footerLabel = target.querySelector<HTMLElement>(
		".local-gpt-provider-badge-label",
	)!;
	expect(footerLabel.textContent).toBe("Cloud · default");

	// Highlight inherited action -> badge previews configured main provider (Local · fast)
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await vi.waitFor(() =>
		expect(footerLabel.textContent).toBe("Local · fast"),
	);

	// Open model picker from footer and pick "local-v2"
	target
		.querySelector<HTMLButtonElement>(".local-gpt-model-badge-button")!
		.click();
	await vi.waitFor(() =>
		expect(
			target.querySelectorAll(".local-gpt-dropdown-item").length,
		).toBe(2),
	);
	const items = target.querySelectorAll<HTMLElement>(
		".local-gpt-dropdown-item",
	);
	expect(items[1].textContent).toContain("local-v2");
	items[1].click();
	await vi.waitFor(() =>
		expect(footerLabel.textContent).toBe("Local · local-v2"),
	);

	// Run the highlighted inherited action -> uses local / local-v2, not cloud
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		}),
	);
	await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
	expect(execute.mock.calls[0][0].provider).toMatchObject({
		id: "local",
		model: "local-v2",
	});
	expect(plugin.actionPaletteProviderId).toBe("cloud");
	component.$destroy();
});

it("synchronizes the previewed action provider when selecting a model and then submitting a freeform prompt", async () => {
	const { showActionPalette } = await import("../src/ui/actionPalettePlugin");
	const { createComponent, typeIntoPalette } = await import(
		"./helpers/actionPalette"
	);
	plugin.settings.actions = [
		{
			id: "a",
			name: "Translate",
			prompt: "Translate {selection}",
			modelSelection: { providerId: "cloud", model: "default" },
		},
	];
	vi.mocked(waitForAI).mockResolvedValue({
		promise: Promise.resolve({
			providers: [
				{
					id: "local",
					name: "Local",
					model: "fast",
					availableModels: ["fast", "local-v2"],
				},
				{
					id: "cloud",
					name: "Cloud",
					model: "default",
					availableModels: ["default", "cloud-v2"],
				},
				{ id: "embedding", name: "Emb", model: "embed" },
			],
			execute,
			version: 5,
			checkCompatibility: vi.fn(),
		}),
		cancel: vi.fn(),
	} as any);

	const commands: any[] = [];
	plugin.addCommand = vi.fn((c) => {
		commands.push(c);
		return c;
	});
	registerLocalGPTCommands(plugin);
	await commands
		.find((c) => c.id === "local-gpt-action-palette")
		.editorCallback(editor);
	const options = vi.mocked(showActionPalette).mock.calls[0][2];

	const { target, component } = createComponent({
		...options,
		providerLabel: options.modelLabel,
		onSubmit: (event: any) =>
			options.onSubmit(
				event.text,
				event.selectedFiles,
				event.systemPrompt,
				event.reasoningSelection,
				event.replaceSelection,
			),
	});
	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	const footerLabel = target.querySelector<HTMLElement>(
		".local-gpt-provider-badge-label",
	)!;
	expect(footerLabel.textContent).toBe("Local · fast");

	// Highlight saved action bound to Cloud
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await vi.waitFor(() =>
		expect(footerLabel.textContent).toBe("Cloud · default"),
	);

	// Select "cloud-v2" from the footer model picker
	target
		.querySelector<HTMLButtonElement>(".local-gpt-model-badge-button")!
		.click();
	await vi.waitFor(() =>
		expect(
			target.querySelectorAll(".local-gpt-dropdown-item").length,
		).toBe(2),
	);
	target
		.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item")[1]
		.click();
	await vi.waitFor(() =>
		expect(footerLabel.textContent).toBe("Cloud · cloud-v2"),
	);

	// Type a freeform prompt and submit -> both footer badge and runFreeform use Cloud · cloud-v2
	await typeIntoPalette(input, "Explain this");
	expect(footerLabel.textContent).toBe("Cloud · cloud-v2");
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		}),
	);
	await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
	expect(execute.mock.calls[0][0].provider).toMatchObject({
		id: "cloud",
		model: "cloud-v2",
	});
	component.$destroy();
});
