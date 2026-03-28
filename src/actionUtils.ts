import { LocalGPTAction } from "./interfaces";

export const isSeparatorAction = (action: LocalGPTAction): boolean =>
	Boolean(action.separator);

export const getRunnableActions = (
	actions: LocalGPTAction[],
): LocalGPTAction[] => actions.filter((action) => !isSeparatorAction(action));

export const createActionId = (): string => {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `action-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 10)}`;
};

export const ensureActionId = (action: LocalGPTAction): LocalGPTAction =>
	action.id
		? action
		: {
				...action,
				id: createActionId(),
			};

export const ensureActionIds = (
	actions: LocalGPTAction[],
): { actions: LocalGPTAction[]; changed: boolean } => {
	let changed = false;
	const actionsWithIds = actions.map((action) => {
		if (action.id) {
			return action;
		}
		changed = true;
		return ensureActionId(action);
	});

	return { actions: actionsWithIds, changed };
};

export const getActionIdentifier = (action: LocalGPTAction): string =>
	action.id ||
	(action.community?.id
		? `community:${action.community.id}`
		: `name:${action.name}`);

export const moveAction = (
	actions: LocalGPTAction[],
	fromIndex: number,
	toIndex: number,
): LocalGPTAction[] => {
	if (
		fromIndex === toIndex ||
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= actions.length ||
		toIndex >= actions.length
	) {
		return actions;
	}

	const updated = actions.slice();
	const [moved] = updated.splice(fromIndex, 1);
	if (!moved) {
		return actions;
	}
	updated.splice(toIndex, 0, moved);
	return updated;
};
