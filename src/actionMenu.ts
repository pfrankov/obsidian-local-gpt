import { LocalGPTAction } from "./interfaces";
import { isSeparatorAction } from "./actionUtils";

export interface MenuItemLike {
	setTitle: (title: string) => MenuItemLike;
	onClick: (callback: () => void) => MenuItemLike;
}

export interface MenuLike {
	addItem: (callback: (item: MenuItemLike) => void) => void;
	addSeparator: () => void;
}

export const populateActionContextMenu = (
	menu: MenuLike,
	actions: LocalGPTAction[],
	onAction: (action: LocalGPTAction) => void,
) => {
	actions.forEach((action) => {
		if (isSeparatorAction(action)) {
			menu.addSeparator();
			return;
		}

		menu.addItem((item) => {
			item.setTitle(action.name).onClick(() => onAction(action));
		});
	});
};
