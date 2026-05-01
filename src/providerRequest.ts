import { Notice } from "obsidian";
import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { CREATIVITY } from "defaultSettings";
import { I18n } from "./i18n";
import { logger } from "./logger";
import { preparePrompt } from "./utils";
import type { LocalGPTSettings } from "./interfaces";

interface ProviderRequestOptions {
	aiProviders: IAIProvidersService;
	provider: IAIProvider;
	settings: LocalGPTSettings;
	prompt: string;
	system?: string;
	temperature?: number;
	selectedText: string;
	context: string;
	imagesInBase64: string[];
	abortController: AbortController;
	onUpdate: (updatedString: string) => void;
}

export function selectProvider(
	aiProviders: IAIProvidersService,
	settings: LocalGPTSettings,
	hasImages: boolean,
	overrideProviderId?: string | null,
): IAIProvider {
	const visionCandidate = hasImages
		? aiProviders.providers.find(
				(p: IAIProvider) => p.id === settings.aiProviders.vision,
			)
		: undefined;
	const preferredProviderId = overrideProviderId || settings.aiProviders.main;
	const fallback = aiProviders.providers.find(
		(p) => p.id === preferredProviderId,
	);

	const provider = visionCandidate || fallback;
	if (!provider) {
		throw new Error("No AI provider found");
	}
	return provider;
}

export function overrideProviderModel(
	provider: IAIProvider,
	overrideProviderId: string | null | undefined,
	actionPaletteModel: string | null,
	actionPaletteModelProviderId: string | null,
): IAIProvider {
	if (
		actionPaletteModel &&
		overrideProviderId &&
		actionPaletteModelProviderId === overrideProviderId
	) {
		return { ...provider, model: actionPaletteModel };
	}
	return provider;
}

export async function executeProviderRequest({
	aiProviders,
	provider,
	settings,
	prompt,
	system,
	temperature,
	selectedText,
	context,
	imagesInBase64,
	abortController,
	onUpdate,
}: ProviderRequestOptions): Promise<string> {
	try {
		return await aiProviders.execute({
			provider,
			prompt: preparePrompt(prompt, selectedText, context),
			images: imagesInBase64,
			systemPrompt: system,
			options: {
				temperature:
					temperature ??
					CREATIVITY[settings.defaults.creativity].temperature,
			},
			onProgress: (_chunk: string, accumulatedText: string) => {
				onUpdate(accumulatedText);
			},
			abortController,
		});
	} catch (error) {
		if (!abortController.signal.aborted) {
			new Notice(
				I18n.t("notices.errorGenerating", {
					message: (error as any).message,
				}),
			);
		}
		logger.separator();
		return "";
	}
}
