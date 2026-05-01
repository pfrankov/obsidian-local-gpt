import { Editor, Menu } from "obsidian";
import { CREATIVITY } from "defaultSettings";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import type LocalGPT from "./main";
import { I18n } from "./i18n";
import { populateActionContextMenu } from "./actionMenu";
import { getActionIdentifier, getRunnableActions } from "./actionUtils";
import { hideActionPalette, showActionPalette } from "./ui/actionPalettePlugin";

export function registerLocalGPTCommands(plugin: LocalGPT) {
	registerContextMenuCommand(plugin);
	registerQuickAccessCommands(plugin);
	registerActionPaletteCommand(plugin);
}

function registerContextMenuCommand(plugin: LocalGPT) {
	plugin.addCommand({
		id: "context-menu",
		name: I18n.t("commands.showContextMenu"),
		editorCallback: (editor: Editor) => {
			// @ts-expect-error, not typed
			const editorView = editor.cm;

			const cursorPositionFrom = editor.getCursor("from");
			const cursorPositionTo = editor.getCursor("to");

			const contextMenu = new Menu();

			populateActionContextMenu(
				contextMenu,
				plugin.settings.actions,
				(action) => plugin.runAction(action, editor),
			);

			const fromRect = editorView.coordsAtPos(
				editor.posToOffset(cursorPositionFrom),
			);
			const toRect = editorView.coordsAtPos(
				editor.posToOffset(cursorPositionTo),
			);
			contextMenu.showAtPosition({
				x: fromRect.left,
				y: toRect.top + (editorView.defaultLineHeight || 0),
			});
		},
	});
}

function registerQuickAccessCommands(plugin: LocalGPT) {
	getRunnableActions(plugin.settings.actions).forEach((action, index) => {
		plugin.addCommand({
			id: `quick-access-${index + 1}`,
			name: `${index + 1} | ${action.name}`,
			editorCallback: (editor: Editor) => {
				plugin.runAction(action, editor);
			},
		});
	});
}

function registerActionPaletteCommand(plugin: LocalGPT) {
	plugin.addCommand({
		id: "local-gpt-action-palette",
		name: I18n.t("commands.actionPalette.name"),
		editorCallback: async (editor: Editor) => {
			// @ts-expect-error, not typed
			const editorView = editor.cm;
			const cursorPositionFrom = editor.getCursor("from");
			const insertPos = editor.posToOffset({
				line: cursorPositionFrom.line,
				ch: 0,
			});
			const initialSelectedFiles = getActionPaletteInitialSelectedFiles(
				plugin,
				editor,
			);
			const paletteLabel = await getActionPaletteLabel(plugin);

			showActionPalette(editorView, insertPos, {
				onSubmit: (
					text: string,
					selectedFiles: string[] = [],
					systemPrompt?: string,
				) => {
					const overrideProviderId =
						plugin.actionPaletteProviderId ||
						plugin.settings.aiProviders.main;
					const creativityKey =
						plugin.actionPaletteCreativityKey ??
						plugin.settings.defaults.creativity ??
						"";
					const temperatureOverride = (CREATIVITY as any)[
						creativityKey
					]?.temperature as number | undefined;

					plugin
						.runFreeform(
							editor,
							text,
							selectedFiles,
							overrideProviderId,
							temperatureOverride,
							systemPrompt,
						)
						.finally(() => {});

					hideActionPalette(editorView);
					plugin.app.workspace.updateOptions();
				},
				onCancel: () => {
					hideActionPalette(editorView);
					plugin.app.workspace.updateOptions();
				},
				placeholder: I18n.t("commands.actionPalette.placeholder"),
				modelLabel: paletteLabel.modelLabel,
				providerId: paletteLabel.currentProviderId,
				getFiles: () => getActionPaletteFiles(plugin),
				getProviders: () => getActionPaletteProviders(),
				getModels: (providerId) => getActionPaletteModels(providerId),
				onProviderChange: async (providerId: string) => {
					plugin.actionPaletteProviderId = providerId;
					plugin.actionPaletteModel = null;
					plugin.actionPaletteModelProviderId = null;
				},
				onModelChange: async (model: string) => {
					const providerId =
						plugin.actionPaletteProviderId ||
						plugin.settings.aiProviders.main;
					plugin.actionPaletteModel = model;
					plugin.actionPaletteModelProviderId = providerId;
				},
				onCreativityChange: async (creativityKey: string) => {
					plugin.actionPaletteCreativityKey = creativityKey;
				},
				getSystemPrompts: () => getSystemPrompts(plugin),
				selectedSystemPromptId:
					plugin.settings.actionPalette?.systemPromptActionId ?? null,
				onSystemPromptChange: async (systemPromptId) => {
					plugin.settings.actionPalette = {
						...(plugin.settings.actionPalette || {}),
						systemPromptActionId: systemPromptId,
					};
					await plugin.saveData(plugin.settings);
				},
				initialSelectedFiles,
			});
			plugin.app.workspace.updateOptions();
		},
	});
}

export function getActionPaletteInitialSelectedFiles(
	plugin: LocalGPT,
	editor: Editor,
): string[] {
	if (editor.getSelection()) {
		return [];
	}

	const activeFile = plugin.app.workspace.getActiveFile();
	return activeFile ? [activeFile.path] : [];
}

async function getActionPaletteLabel(plugin: LocalGPT) {
	let modelLabel = "";
	let currentProviderId: string | undefined;
	try {
		const aiRequestWaiter = await waitForAI();
		const aiProviders: IAIProvidersService = await aiRequestWaiter.promise;
		const selectedProviderId =
			plugin.actionPaletteProviderId || plugin.settings.aiProviders.main;
		const provider = aiProviders.providers.find(
			(p: IAIProvider) => p.id === selectedProviderId,
		);
		if (provider) {
			currentProviderId = provider.id;
			const modelToShow =
				plugin.actionPaletteModelProviderId === provider.id
					? plugin.actionPaletteModel || provider.model
					: provider.model;
			const creativityKey =
				plugin.actionPaletteCreativityKey ??
				plugin.settings.defaults.creativity ??
				"";
			const creativityLabelMap: Record<string, string> = {
				"": I18n.t("settings.creativityNone"),
				low: I18n.t("settings.creativityLow"),
				medium: I18n.t("settings.creativityMedium"),
				high: I18n.t("settings.creativityHigh"),
			};
			const creativityLabel = creativityLabelMap[creativityKey] || "";

			modelLabel = [provider.name, modelToShow, creativityLabel]
				.filter(Boolean)
				.join(" · ");
		}
	} catch (error) {
		void error;
	}

	return { modelLabel, currentProviderId };
}

function getActionPaletteFiles(plugin: LocalGPT) {
	return plugin.app.vault
		.getMarkdownFiles()
		.concat(
			plugin.app.vault.getFiles().filter((f) => f.extension === "pdf"),
		)
		.map((file) => ({
			path: file.path,
			basename: file.basename,
			extension: file.extension,
		}));
}

async function getActionPaletteProviders() {
	try {
		const aiRequestWaiter = await waitForAI();
		const aiProviders: IAIProvidersService = await aiRequestWaiter.promise;

		return aiProviders.providers
			.filter((p) => Boolean(p.model))
			.map((p) => ({
				id: p.id,
				name: p.model || I18n.t("commands.actionPalette.unknownModel"),
				providerName: p.name,
				providerUrl: (p as unknown as { url?: string }).url || "",
			}));
	} catch (error) {
		console.error("Error fetching models:", error);
		return [];
	}
}

async function getActionPaletteModels(providerId: string) {
	try {
		const aiRequestWaiter = await waitForAI();
		const aiProviders: IAIProvidersService = await aiRequestWaiter.promise;
		const provider = aiProviders.providers.find(
			(p: IAIProvider) => p.id === providerId,
		);
		if (!provider) return [];
		const models =
			provider.availableModels ||
			(await aiProviders.fetchModels(provider));
		return models.map((m) => ({ id: m, name: m }));
	} catch (error) {
		console.error("Error fetching models:", error);
		return [];
	}
}

function getSystemPrompts(plugin: LocalGPT) {
	return getRunnableActions(plugin.settings.actions)
		.filter((action) => action.system)
		.map((action) => ({
			id: getActionIdentifier(action),
			name: action.name,
			system: action.system!,
		}));
}
