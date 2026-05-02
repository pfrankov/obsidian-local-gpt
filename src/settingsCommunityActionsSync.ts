import type LocalGPT from "./main";
import type { LocalGPTAction } from "./interfaces";
import { I18n } from "./i18n";
import {
	buildCommunityActionSignature,
	type CommunityAction,
} from "./CommunityActionsService";
import type { CommunityActionsLookup } from "./settingsTabUtils";
import {
	buildCommunityActionRef,
	buildCommunityActionsLookup,
	findCommunityActionLink,
	normalizeActionName,
} from "./settingsTabUtils";

export interface CommunityActionsSyncResult {
	updated: number;
	skipped: number;
}

export async function syncCommunityActions(
	plugin: LocalGPT,
	actions: CommunityAction[],
): Promise<CommunityActionsSyncResult> {
	const lookup = buildCommunityActionsLookup(plugin.settings.actions);
	let updated = 0;
	let skipped = 0;

	actions.forEach((action) => {
		const result = syncCommunityAction(action, lookup);
		updated += result.updated;
		skipped += result.skipped;
	});

	if (updated > 0) {
		await plugin.saveSettings();
	}

	return { updated, skipped };
}

export function buildCommunityActionsSyncMessage(
	result: CommunityActionsSyncResult,
) {
	if (result.updated > 0 && result.skipped > 0) {
		return I18n.t("settings.communityActionsSyncSummary", {
			updated: String(result.updated),
			skipped: String(result.skipped),
		});
	}
	if (result.updated > 0) {
		return I18n.t("settings.communityActionsUpdated", {
			count: String(result.updated),
		});
	}
	if (result.skipped > 0) {
		return I18n.t("settings.communityActionsSkipped", {
			count: String(result.skipped),
		});
	}
	return "";
}

function syncCommunityAction(
	action: CommunityAction,
	lookup: CommunityActionsLookup,
): CommunityActionsSyncResult {
	const localAction = findCommunityActionLink(action, lookup);
	if (!localAction) {
		return tryAdoptCommunityAction(action, lookup);
	}

	const localSignature = buildCommunityActionSignature(localAction);
	const remoteSignature = buildCommunityActionSignature(action);
	if (isCommunityActionModified(localAction, localSignature)) {
		return { updated: 0, skipped: 1 };
	}
	if (
		!shouldUpdateCommunityAction(
			localAction,
			localSignature,
			remoteSignature,
			action,
		)
	) {
		return { updated: 0, skipped: 0 };
	}
	applyCommunityActionUpdate(localAction, action);
	return { updated: 1, skipped: 0 };
}

function applyCommunityActionUpdate(
	localAction: LocalGPTAction,
	action: CommunityAction,
) {
	localAction.prompt = action.prompt ?? "";
	localAction.replace = action.replace ?? false;
	if (action.system) {
		localAction.system = action.system;
	} else {
		delete localAction.system;
	}
	localAction.community = buildCommunityActionRef(action);
}

function isCommunityActionModified(
	localAction: LocalGPTAction,
	localSignature: string,
) {
	const storedHash = localAction.community?.hash;
	return Boolean(storedHash && localSignature !== storedHash);
}

function shouldUpdateCommunityAction(
	localAction: LocalGPTAction,
	localSignature: string,
	remoteSignature: string,
	action: CommunityAction,
) {
	return (
		localSignature !== remoteSignature ||
		localAction.community?.hash !== remoteSignature ||
		localAction.community?.id !== action.id ||
		localAction.community?.description?.trim() !==
			(action.description?.trim() || undefined)
	);
}

function tryAdoptCommunityAction(
	action: CommunityAction,
	lookup: CommunityActionsLookup,
): CommunityActionsSyncResult {
	const nameMatch = lookup.byName.get(normalizeActionName(action.name));
	if (!nameMatch) {
		return { updated: 0, skipped: 0 };
	}
	const localSignature = buildCommunityActionSignature(nameMatch);
	const remoteSignature = buildCommunityActionSignature(action);
	if (localSignature !== remoteSignature) {
		return { updated: 0, skipped: 0 };
	}
	nameMatch.community = buildCommunityActionRef(action);
	return { updated: 1, skipped: 0 };
}
