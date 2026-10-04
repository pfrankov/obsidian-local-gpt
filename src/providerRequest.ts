import { Notice } from "obsidian";
import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { resolveTemperature } from "./temperature";
import { I18n } from "./i18n";
import { logger } from "./logger";
import { preparePrompt } from "./utils";
import { resolveReasoningEffort } from "./reasoningEffort";
import type {
	LocalGPTAction,
	LocalGPTSettings,
	ReasoningSelection,
} from "./interfaces";

interface ProviderRequestOptions {
	aiProviders: IAIProvidersService;
	provider: IAIProvider;
	settings: LocalGPTSettings;
	prompt: string;
	system?: string;
	temperature?: number | null;
	reasoningEffort?: LocalGPTAction["reasoningEffort"];
	reasoningSelection?: ReasoningSelection;
	onReasoningResolved?: (provider: IAIProvider, mode?: string) => void;
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
		provider.id === overrideProviderId &&
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
	reasoningEffort,
	reasoningSelection,
	onReasoningResolved,
	selectedText,
	context,
	imagesInBase64,
	abortController,
	onUpdate,
}: ProviderRequestOptions): Promise<string> {
	if (abortController.signal.aborted) return "";
	const resolvedTemperature = resolveTemperature(settings, temperature);
	const selectedMode =
		reasoningSelection?.providerId === provider.id &&
		reasoningSelection.model === provider.model
			? reasoningSelection.mode
			: reasoningEffort;
	const effort = resolveReasoningEffort(provider, settings, selectedMode);
	try {
		if (effort) aiProviders.checkCompatibility(5);
		onReasoningResolved?.(provider, effort);
		return await aiProviders.execute({
			...(effort ? { reasoningMode: effort } : {}),
			provider,
			prompt: preparePrompt(prompt, selectedText, context),
			images: imagesInBase64,
			systemPrompt: system,
			options: {
				...(resolvedTemperature === undefined
					? {}
					: { temperature: resolvedTemperature }),
			},
			onProgress: (_chunk: string, accumulatedText: string) => {
				if (!abortController.signal.aborted) onUpdate(accumulatedText);
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
