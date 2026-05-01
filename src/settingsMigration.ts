import { Notice } from "obsidian";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import type { LocalGPTSettings } from "./interfaces";
import { ensureActionIds } from "./actionUtils";
import { I18n } from "./i18n";

const legacyDefaultProviders = {
	ollama: {
		url: "http://localhost:11434",
		defaultModel: "gemma2",
		embeddingModel: "",
		type: "ollama",
	},
	ollama_fallback: {
		url: "http://localhost:11434",
		defaultModel: "gemma2",
		embeddingModel: "",
		type: "ollama",
	},
	openaiCompatible: {
		url: "http://localhost:8080/v1",
		apiKey: "",
		embeddingModel: "",
		type: "openaiCompatible",
	},
	openaiCompatible_fallback: {
		url: "http://localhost:8080/v1",
		apiKey: "",
		embeddingModel: "",
		type: "openaiCompatible",
	},
} as const;

export async function migrateSettings(
	loadedData: LocalGPTSettings | undefined,
	legacyActionPaletteSystemPromptStorageKey: string,
): Promise<{ settings?: LocalGPTSettings; changed: boolean }> {
	if (!loadedData) {
		return { settings: loadedData, changed: false };
	}

	const preAsyncMigrations = [
		migrateToVersion2,
		migrateToVersion3,
		migrateToVersion4,
		migrateToVersion5,
		migrateToVersion6,
	];
	const postAsyncMigrations = [
		migrateToVersion8,
		migrateToVersion9,
		(settings: LocalGPTSettings) =>
			migrateToVersion10(
				settings,
				legacyActionPaletteSystemPromptStorageKey,
			),
	];
	const changed = preAsyncMigrations.reduce(
		(hasChanged, migrate) => migrate(loadedData) || hasChanged,
		false,
	);
	const changedAsync = await migrateToVersion7(loadedData);
	const changedPostAsync = postAsyncMigrations.reduce(
		(hasChanged, migrate) => migrate(loadedData) || hasChanged,
		false,
	);

	return {
		settings: loadedData,
		changed: changed || changedAsync || changedPostAsync,
	};
}

function migrateToVersion2(settings: LocalGPTSettings): boolean {
	if (settings._version && settings._version >= 1) {
		return false;
	}

	const providers: Record<string, any> = JSON.parse(
		JSON.stringify(legacyDefaultProviders),
	);

	(settings as any).providers = providers;
	(settings as any).providers.ollama.ollamaUrl = (settings as any).ollamaUrl;
	delete (settings as any).ollamaUrl;
	(settings as any).providers.ollama.defaultModel = (
		settings as any
	).defaultModel;
	delete (settings as any).defaultModel;
	(settings as any).providers.openaiCompatible &&
		((settings as any).providers.openaiCompatible.apiKey = "");

	settings._version = 2;
	return true;
}

function migrateToVersion3(settings: LocalGPTSettings): boolean {
	if (settings._version && settings._version >= 3) {
		return false;
	}
	(settings as any).defaultProvider =
		(settings as any).selectedProvider || "ollama";
	delete (settings as any).selectedProvider;

	const providers = (settings as any).providers;
	if (providers) {
		Object.keys(providers).forEach((key) => {
			providers[key].type = key;
		});
	}

	settings._version = 3;
	return true;
}

function migrateToVersion4(settings: LocalGPTSettings): boolean {
	if (settings._version && settings._version >= 4) {
		return false;
	}

	(settings as any).defaults = {
		provider: (settings as any).defaultProvider || "ollama",
		fallbackProvider: (settings as any).fallbackProvider || "",
		creativity: "low",
	};
	delete (settings as any).defaultProvider;
	delete (settings as any).fallbackProvider;

	settings._version = 4;
	return true;
}

function migrateToVersion5(settings: LocalGPTSettings): boolean {
	if (settings._version && settings._version >= 5) {
		return false;
	}

	const providers = (settings as any).providers;
	if (providers) {
		Object.keys(legacyDefaultProviders).forEach((provider) => {
			if (providers[provider]) {
				providers[provider].embeddingModel = (
					legacyDefaultProviders as any
				)[provider].embeddingModel;
			}
		});
	}

	settings._version = 5;
	setTimeout(() => {
		new Notice(
			`🎉 LocalGPT can finally use\ncontext from links!\nCheck the Settings!`,
			0,
		);
	}, 10000);
	return true;
}

function migrateToVersion6(settings: LocalGPTSettings): boolean {
	if (settings._version && settings._version >= 6) {
		return false;
	}

	const providers = (settings as any).providers;
	if (providers) {
		Object.keys(legacyDefaultProviders).forEach((provider) => {
			if (providers[provider]?.type === "ollama") {
				providers[provider].url = providers[provider].ollamaUrl;
				delete providers[provider].ollamaUrl;
			}
			if (providers[provider]?.type === "openaiCompatible") {
				providers[provider].url =
					providers[provider].url.replace(/\/+$/i, "") + "/v1";
			}
		});
	}

	settings._version = 6;
	return true;
}

async function migrateToVersion7(settings: LocalGPTSettings): Promise<boolean> {
	if (settings._version && settings._version >= 7) {
		return false;
	}

	new Notice(I18n.t("notices.importantUpdate"), 0);
	const aiRequestWaiter = await waitForAI();
	const aiProviders = await aiRequestWaiter.promise;

	settings.aiProviders = {
		main: null,
		embedding: null,
		vision: null,
	};

	const oldProviders = (settings as any).providers;
	const oldDefaults = (settings as any).defaults;

	if (oldProviders && oldDefaults?.provider) {
		await migrateLegacyProviderConfig(
			settings,
			aiProviders,
			oldProviders,
			oldDefaults,
		);
	}

	delete (settings as any).defaults;
	delete (settings as any).providers;

	settings._version = 7;
	return true;
}

async function migrateLegacyProviderConfig(
	settings: LocalGPTSettings,
	aiProviders: any,
	oldProviders: Record<string, any>,
	oldDefaults: Record<string, any>,
) {
	const provider = oldDefaults.provider;
	const typesMap: { [key: string]: string } = {
		ollama: "ollama",
		openaiCompatible: "openai",
	};

	const providerConfig = oldProviders[provider];
	if (!providerConfig) {
		return;
	}
	const type = typesMap[providerConfig.type];
	await createMigratedProvider(
		settings,
		aiProviders,
		provider,
		providerConfig,
		type,
		"main",
		providerConfig.defaultModel,
	);
	await createMigratedProvider(
		settings,
		aiProviders,
		provider,
		providerConfig,
		type,
		"embedding",
		providerConfig.embeddingModel,
	);
}

async function createMigratedProvider(
	settings: LocalGPTSettings,
	aiProviders: any,
	provider: string,
	providerConfig: any,
	type: string,
	targetKey: "main" | "embedding",
	model?: string,
) {
	if (!model) {
		return;
	}
	let adjustedModel = model;
	if (type === "ollama" && !adjustedModel.endsWith(":latest")) {
		adjustedModel = `${adjustedModel}:latest`;
	}
	const id = `id-${Date.now().toString()}`;
	const newProvider = await (aiProviders as any).migrateProvider({
		id,
		name:
			targetKey === "main"
				? `Local GPT ${provider}`
				: `Local GPT ${provider} embeddings`,
		apiKey: providerConfig.apiKey,
		url: providerConfig.url,
		type,
		model: adjustedModel,
	});

	if (newProvider) {
		settings.aiProviders[targetKey] = newProvider.id;
	}
}

function migrateToVersion8(settings: LocalGPTSettings): boolean {
	if (settings._version && settings._version >= 8) {
		return false;
	}

	(settings as any).defaults = (settings as any).defaults || {};
	(settings as any).defaults.contextLimit =
		(settings as any).defaults.contextLimit || "local";

	settings._version = 8;
	return true;
}

function migrateToVersion9(settings: LocalGPTSettings): boolean {
	if (settings._version && settings._version >= 9) {
		return false;
	}

	const { actions } = ensureActionIds(settings.actions || []);
	settings.actions = actions;
	settings._version = 9;
	return true;
}

function migrateToVersion10(
	settings: LocalGPTSettings,
	legacyActionPaletteSystemPromptStorageKey: string,
): boolean {
	if (settings._version && settings._version >= 10) {
		return false;
	}

	(settings as any).actionPalette = (settings as any).actionPalette || {};
	if ((settings as any).actionPalette.systemPromptActionId == null) {
		(settings as any).actionPalette.systemPromptActionId =
			readLegacyActionPaletteSystemPromptId(
				legacyActionPaletteSystemPromptStorageKey,
			);
	}
	clearLegacyActionPaletteSystemPromptId(
		legacyActionPaletteSystemPromptStorageKey,
	);

	settings._version = 10;
	return true;
}

function readLegacyActionPaletteSystemPromptId(
	storageKey: string,
): string | null {
	try {
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed.id === "string" ? parsed.id : null;
	} catch (error) {
		console.error(
			"Failed to migrate Action Palette system prompt selection:",
			error,
		);
		return null;
	}
}

function clearLegacyActionPaletteSystemPromptId(storageKey: string) {
	try {
		window.localStorage.removeItem(storageKey);
	} catch (error) {
		console.error(
			"Failed to clean up legacy Action Palette system prompt selection:",
			error,
		);
	}
}
