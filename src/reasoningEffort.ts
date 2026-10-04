import type { IAIProvider } from "@obsidian-ai-providers/sdk";
import type {
	LocalGPTAction,
	LocalGPTSettings,
	ReasoningEffort,
} from "./interfaces";
import { I18n } from "./i18n";

// Native identifiers come from the SDK model declaration, never a LocalGPT
// provider table. The service validates the adapter contract again before HTTP.
export function getReasoningModes(provider: IAIProvider): string[] {
	const modes =
		provider.modelCapabilities?.[provider.model || ""]?.reasoningModes;
	return Array.isArray(modes) ? modes.filter(isReasoningEffort) : [];
}

export function supportsReasoningEffort(provider: IAIProvider): boolean {
	return getReasoningModes(provider).length > 0;
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && value.length > 0 && value !== "default";
}

export function resolveReasoningEffort(
	provider: IAIProvider,
	settings: LocalGPTSettings,
	actionEffort?: LocalGPTAction["reasoningEffort"],
): ReasoningEffort | undefined {
	const value =
		actionEffort ?? settings.providerReasoningEffort?.[provider.id];
	return isReasoningEffort(value) &&
		getReasoningModes(provider).includes(value)
		? value
		: undefined;
}

export function reasoningEffortLabel(mode?: string): string {
	if (!mode || mode === "default")
		return I18n.t("settings.reasoningEffortDefault");
	return mode;
}

export function reasoningEffortOptions(
	modes: string[] = [],
): Record<string, string> {
	return Object.fromEntries([
		["default", I18n.t("settings.reasoningEffortDefault")],
		...modes.map((mode) => [mode, reasoningEffortLabel(mode)]),
	]);
}
