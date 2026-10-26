import type { LocalGPTAction } from "./interfaces";
import { isSeparatorAction } from "./actionUtils";

export interface MenuItemLike {
	setTitle: (title: string) => MenuItemLike;
	onClick: (callback: () => void) => MenuItemLike;
}

export interface MenuLike {
	addItem: (callback: (item: MenuItemLike) => void) => void;
	addSeparator: () => void;
}

export interface ContextMenuProviderLike {
	id: string;
	name?: string;
	model?: string;
	availableModels?: string[];
}

function collectProviderIdsForModel(
	model: string,
	actions: LocalGPTAction[],
	providers?: ContextMenuProviderLike[],
): Set<string> {
	const providerIds = new Set<string>();
	for (const action of actions) {
		if (
			!isSeparatorAction(action) &&
			action.modelSelection?.model === model &&
			action.modelSelection.providerId
		) {
			providerIds.add(action.modelSelection.providerId);
		}
	}
	for (const provider of providers ?? []) {
		if (
			provider.model === model ||
			provider.availableModels?.includes(model)
		) {
			providerIds.add(provider.id);
		}
	}
	return providerIds;
}

export function formatActionModelBadge(
	action: LocalGPTAction,
	actions: LocalGPTAction[],
	providers?: ContextMenuProviderLike[],
): string | undefined {
	const selection = action.modelSelection;
	if (!selection) {
		return undefined;
	}
	const providerIds = collectProviderIdsForModel(
		selection.model,
		actions,
		providers,
	);
	if (providerIds.size > 1) {
		const providerName =
			providers
				?.find((provider) => provider.id === selection.providerId)
				?.name?.trim() || selection.providerId;
		return `${providerName} · ${selection.model}`;
	}
	return selection.model;
}

function formatContextMenuActionTitle(
	action: LocalGPTAction,
	actions: LocalGPTAction[],
	providers?: ContextMenuProviderLike[],
): string {
	const badge = formatActionModelBadge(action, actions, providers);
	return badge ? `${action.name} · ${badge}` : action.name;
}

export const populateActionContextMenu = (
	menu: MenuLike,
	actions: LocalGPTAction[],
	onAction: (action: LocalGPTAction) => void,
	providers?: ContextMenuProviderLike[],
) => {
	actions.forEach((action) => {
		if (isSeparatorAction(action)) {
			menu.addSeparator();
			return;
		}

		menu.addItem((item) => {
			const title = formatContextMenuActionTitle(
				action,
				actions,
				providers,
			);
			item.setTitle(title).onClick(() => onAction(action));
		});
	});
};
