import type { IAIProvider } from "@obsidian-ai-providers/sdk";
import type {
	LocalGPTAction,
	LocalGPTSettings,
	ReasoningEffort,
} from "./interfaces";
import { I18n } from "./i18n";

/** Preferred display order for known adapter vocabularies. */
export const REASONING_MODE_ORDER = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"true",
	"false",
] as const;

export type ReasoningModeSource = {
	mode: string;
	providerNames: string[];
};

const MODE_LABEL_KEYS: Record<string, string> = {
	none: "settings.reasoningEffortNone",
	minimal: "settings.reasoningEffortMinimal",
	low: "settings.reasoningEffortLow",
	medium: "settings.reasoningEffortMedium",
	high: "settings.reasoningEffortHigh",
	xhigh: "settings.reasoningEffortXHigh",
	max: "settings.reasoningEffortMax",
	true: "settings.reasoningEffortTrue",
	false: "settings.reasoningEffortFalse",
};

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

export function sortReasoningModes(modes: string[]): string[] {
	return [...modes].sort((a, b) => {
		const indexA = REASONING_MODE_ORDER.indexOf(
			a as (typeof REASONING_MODE_ORDER)[number],
		);
		const indexB = REASONING_MODE_ORDER.indexOf(
			b as (typeof REASONING_MODE_ORDER)[number],
		);
		const rankA = indexA === -1 ? REASONING_MODE_ORDER.length : indexA;
		const rankB = indexB === -1 ? REASONING_MODE_ORDER.length : indexB;
		if (rankA !== rankB) return rankA - rankB;
		return a.localeCompare(b);
	});
}

export function reasoningEffortLabel(mode?: string): string {
	if (!mode || mode === "default")
		return I18n.t("settings.reasoningEffortDefault");
	const key = MODE_LABEL_KEYS[mode];
	return key ? I18n.t(key) : mode;
}

export function reasoningEffortOptionLabel(
	source: ReasoningModeSource,
): string {
	const label = reasoningEffortLabel(source.mode);
	if (!source.providerNames.length) return label;
	return `${label} (${source.providerNames.join(", ")})`;
}

/** Collect declared modes across providers, sorted and annotated. */
export function collectReasoningModeSources(
	providers: IAIProvider[],
): ReasoningModeSource[] {
	const byMode = new Map<string, Set<string>>();
	for (const provider of providers) {
		const declared = new Set<string>();
		const current = getReasoningModes(provider);
		current.forEach((mode) => declared.add(mode));
		for (const caps of Object.values(provider.modelCapabilities || {})) {
			(caps?.reasoningModes || [])
				.filter(isReasoningEffort)
				.forEach((mode) => declared.add(mode));
		}
		for (const mode of declared) {
			if (!byMode.has(mode)) byMode.set(mode, new Set());
			byMode.get(mode)!.add(provider.name);
		}
	}
	return sortReasoningModes([...byMode.keys()]).map((mode) => ({
		mode,
		providerNames: [...(byMode.get(mode) || [])].sort((a, b) =>
			a.localeCompare(b),
		),
	}));
}

export function reasoningEffortOptions(
	modes: string[] = [],
): Record<string, string> {
	return Object.fromEntries([
		["default", I18n.t("settings.reasoningEffortDefault")],
		...sortReasoningModes(modes).map((mode) => [
			mode,
			reasoningEffortLabel(mode),
		]),
	]);
}

export function reasoningEffortOptionsFromSources(
	sources: ReasoningModeSource[] = [],
): Record<string, string> {
	return Object.fromEntries([
		["default", I18n.t("settings.reasoningEffortDefault")],
		...sources.map((source) => [
			source.mode,
			reasoningEffortOptionLabel(source),
		]),
	]);
}

export function formatReasoningBadgeLabel(options: {
	selected?: boolean;
	mode?: string;
}): string {
	const mode = options.mode;
	if (!mode || mode === "default") return "";
	return reasoningEffortLabel(mode);
}
