import { LocalGPTAction } from "./interfaces";

export const isSeparatorAction = (action: LocalGPTAction): boolean =>
	Boolean(action.separator);

export const getRunnableActions = (
	actions: LocalGPTAction[],
): LocalGPTAction[] => actions.filter((action) => !isSeparatorAction(action));

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
