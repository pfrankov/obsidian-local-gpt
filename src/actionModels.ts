import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import type {
	ActionModelChoice,
	ActionModelSelection,
	LocalGPTAction,
	LocalGPTSettings,
} from "./interfaces";
import { I18n } from "./i18n";

const ACTION_MODEL_SEPARATOR = "::";

export function collectActionModelChoices(
	providers: IAIProvider[],
): ActionModelChoice[] {
	return providers
		.filter((provider) => Boolean(provider.id))
		.map((provider) => ({
			selection: {
				providerId: provider.id,
				model: provider.model ?? "",
			},
			label: provider.model
				? [provider.name, provider.model].join(" ~ ")
				: provider.name,
		}));
}

export function encodeActionModelSelection(
	selection?: ActionModelSelection,
): string {
	if (!selection?.providerId || !selection.model) {
		return "";
	}
	return `${selection.providerId}${ACTION_MODEL_SEPARATOR}${selection.model}`;
}

export function decodeActionModelSelection(
	value: string,
): ActionModelSelection | undefined {
	const separatorIndex = value.indexOf(ACTION_MODEL_SEPARATOR);
	if (separatorIndex <= 0) {
		return undefined;
	}
	const providerId = value.slice(0, separatorIndex);
	const model = value.slice(separatorIndex + ACTION_MODEL_SEPARATOR.length);
	if (!providerId || !model) {
		return undefined;
	}
	return { providerId, model };
}

/** Resolve before embeddings or generation: an explicit choice never falls back. */
export function resolveActionModel(
	service: IAIProvidersService,
	selection: ActionModelSelection,
	hasImages = false,
): IAIProvider {
	const provider = service.providers.find(
		(item) => item.id === selection.providerId,
	);
	if (!provider || !selection.model?.trim()) {
		throw new Error(
			I18n.t("commands.actionPalette.actionModelUnavailable"),
		);
	}
	if (
		hasImages &&
		provider.modelCapabilities?.[selection.model]?.vision === false
	) {
		throw new Error(I18n.t("commands.actionPalette.actionModelNoVision"));
	}
	// A cached model list is not an authoritative availability check. In
	// particular, AI Providers supports manually entered model identifiers.
	return { ...provider, model: selection.model };
}

export function actionModelLabel(
	action: LocalGPTAction,
	providers: IAIProvider[],
	settings: LocalGPTSettings,
): string {
	const selection = action.modelSelection;
	const provider = providers.find(
		(item) =>
			item.id === (selection?.providerId ?? settings.aiProviders.main),
	);
	const model = selection?.model ?? provider?.model;
	const label =
		provider && model
			? `${provider.name} · ${model}`
			: I18n.t("commands.actionPalette.actionModelUnavailable");
	return selection
		? label
		: `${I18n.t("commands.actionPalette.actionModelDefault")} · ${label}`;
}
