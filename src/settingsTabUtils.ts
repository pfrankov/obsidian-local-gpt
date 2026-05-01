import type { CommunityActionRef, LocalGPTAction } from "./interfaces";
import {
	buildCommunityActionKey,
	buildCommunityActionSignature,
} from "./CommunityActionsService";
import type { CommunityAction } from "./CommunityActionsService";
import { detectDominantLanguage } from "./languageDetection";

export const SEPARATOR = "✂️";

export const sharingFieldLabels = {
	name: "Name: ",
	system: "System: ",
	prompt: "Prompt: ",
	replace: "Replace: ",
	language: "Language: ",
} as const;

export const sharingFieldOrder: Array<keyof typeof sharingFieldLabels> = [
	"name",
	"system",
	"prompt",
	"replace",
	"language",
];

export const sharingEntries = sharingFieldOrder.map(
	(key) => [key, sharingFieldLabels[key]] as const,
);

export const quickAddHandlers: Partial<
	Record<
		keyof typeof sharingFieldLabels,
		(value: string, action: LocalGPTAction) => void
	>
> = {
	name: (value, action) => {
		action.name = value;
	},
	system: (value, action) => {
		action.system = value;
	},
	prompt: (value, action) => {
		action.prompt = value;
	},
	replace: (value, action) => {
		action.replace = value.trim().toLowerCase() === "true";
	},
};

export const normalizeLanguageCode = (value?: string | null): string => {
	if (!value) {
		return "en";
	}
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) {
		return "en";
	}
	return trimmed.split(/[-_]/)[0] || "en";
};

export function escapeTitle(title?: string) {
	if (!title) {
		return "";
	}

	return title
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export const normalizeActionName = (name: string) => name.trim().toLowerCase();

export const normalizeSearchValue = (value: string) =>
	value.toLowerCase().replace(/\s+/g, " ").trim();

export const fuzzyMatch = (target: string, query: string): boolean => {
	if (!query) {
		return true;
	}
	let ti = 0;
	for (const qc of query) {
		ti = target.indexOf(qc, ti);
		if (ti === -1) {
			return false;
		}
		ti++;
	}
	return true;
};

export type CommunityActionsLookup = {
	byId: Map<string, LocalGPTAction>;
	byKey: Map<string, LocalGPTAction>;
	byName: Map<string, LocalGPTAction>;
};

export type CommunityActionState =
	| { type: "available" }
	| { type: "installed"; localAction: LocalGPTAction }
	| { type: "modified"; localAction: LocalGPTAction }
	| { type: "conflict"; localAction: LocalGPTAction };

export type CommunityActionMatch = {
	action: CommunityAction;
	rank: number;
	index: number;
};

export function buildSharingString(
	action: LocalGPTAction,
	defaultCommunityActionsLanguage: string,
) {
	const detectedLanguage = detectDominantLanguage(
		[action.name, action.system, action.prompt]
			.filter((value): value is string => Boolean(value))
			.join("\n"),
	);
	const resolvedLanguage = normalizeLanguageCode(
		detectedLanguage === "unknown"
			? defaultCommunityActionsLanguage
			: detectedLanguage,
	);
	const replaceValue = action.replace
		? `${sharingFieldLabels.replace}${action.replace}`
		: "";

	return [
		action.name && `${sharingFieldLabels.name}${action.name}`,
		action.system && `${sharingFieldLabels.system}${action.system}`,
		action.prompt && `${sharingFieldLabels.prompt}${action.prompt}`,
		replaceValue,
		`${sharingFieldLabels.language}${resolvedLanguage}`,
	]
		.filter(Boolean)
		.join(` ${SEPARATOR}\n`);
}

export function buildActionDescription(action: LocalGPTAction) {
	const systemTitle = escapeTitle(action.system);
	const promptTitle = escapeTitle(action.prompt);
	const communityDescription = action.community?.description?.trim();
	if (communityDescription) {
		const escaped = escapeTitle(communityDescription);
		return `<div class="local-gpt-action-community-description" title="${escaped}">${escaped}</div>`;
	}

	return [
		action.system
			? `<div title="${systemTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
						<b>${sharingFieldLabels.system}</b>${action.system}</div>`
			: "",
		action.prompt
			? `<div title="${promptTitle}" style="text-overflow: ellipsis; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
						<b>${sharingFieldLabels.prompt}</b>${action.prompt}
					</div>`
			: "",
	]
		.filter(Boolean)
		.join("<br/>\n");
}

export function buildCommunityActionsLookup(
	actions: LocalGPTAction[],
): CommunityActionsLookup {
	const byId = new Map<string, LocalGPTAction>();
	const byKey = new Map<string, LocalGPTAction>();
	const byName = new Map<string, LocalGPTAction>();

	actions.forEach((action) => {
		byName.set(normalizeActionName(action.name), action);
		if (action.community?.id) {
			byId.set(action.community.id, action);
		}
		if (action.community?.language && action.community?.name) {
			byKey.set(
				buildCommunityActionKey(
					action.community.language,
					action.community.name,
				),
				action,
			);
		}
	});

	return { byId, byKey, byName };
}

export function findCommunityActionLink(
	action: CommunityAction,
	lookup: CommunityActionsLookup,
) {
	return (
		lookup.byId.get(action.id) ||
		lookup.byKey.get(buildCommunityActionKey(action.language, action.name))
	);
}

export function getCommunityActionSearchRank(
	action: CommunityAction,
	query: string,
): number | null {
	const fields = [
		action.name,
		action.description,
		action.prompt,
		action.system,
	];
	for (let i = 0; i < fields.length; i++) {
		const value = fields[i];
		if (!value) {
			continue;
		}
		const normalized = normalizeSearchValue(value);
		if (normalized && fuzzyMatch(normalized, query)) {
			return i;
		}
	}
	return null;
}

export function resolveCommunityActionState(
	action: CommunityAction,
	lookup: CommunityActionsLookup,
): CommunityActionState {
	const linkedAction = findCommunityActionLink(action, lookup);
	if (linkedAction) {
		const localSignature = buildCommunityActionSignature(linkedAction);
		const storedHash = linkedAction.community?.hash;
		if (storedHash && localSignature !== storedHash) {
			return { type: "modified", localAction: linkedAction };
		}
		return { type: "installed", localAction: linkedAction };
	}

	const nameMatch = lookup.byName.get(normalizeActionName(action.name));
	if (nameMatch) {
		return { type: "conflict", localAction: nameMatch };
	}

	return { type: "available" };
}

export function buildCommunityActionRef(
	action: CommunityAction,
): CommunityActionRef {
	return {
		id: action.id,
		language: action.language,
		name: action.name,
		hash: buildCommunityActionSignature(action),
		updatedAt: action.updatedAt ?? action.createdAt,
		description: action.description?.trim() || undefined,
	};
}
