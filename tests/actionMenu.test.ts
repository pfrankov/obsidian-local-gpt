import { describe, expect, it, vi } from "vitest";
import { populateActionContextMenu } from "../src/actionMenu";
import { getRunnableActions, moveAction } from "../src/actionUtils";
import type { LocalGPTAction } from "../src/interfaces";

describe("populateActionContextMenu", () => {
	it("adds separators and items in order", () => {
		const actions: LocalGPTAction[] = [
			{ name: "First", prompt: "A" },
			{ name: "Separator", prompt: "", separator: true },
			{ name: "Second", prompt: "B" },
		];
		const calls: string[] = [];
		const items: { title: string; onClick?: () => void }[] = [];
		const onAction = vi.fn();

		const menu = {
			addSeparator: () => calls.push("separator"),
			addItem: (callback: (item: any) => void) => {
				const item = { title: "", onClick: undefined as undefined | (() => void) };
				const menuItem = {
					setTitle: (title: string) => {
						item.title = title;
						return menuItem;
					},
					onClick: (handler: () => void) => {
						item.onClick = handler;
						return menuItem;
					},
				};
				callback(menuItem);
				items.push(item);
				calls.push(`item:${item.title}`);
			},
		};

		populateActionContextMenu(menu, actions, onAction);

		expect(calls).toEqual(["item:First", "separator", "item:Second"]);
		expect(items).toHaveLength(2);
		items[0].onClick?.();
		expect(onAction).toHaveBeenCalledWith(actions[0]);
	});
});

describe("getRunnableActions", () => {
	it("filters separators and preserves order", () => {
		const actions: LocalGPTAction[] = [
			{ name: "One", prompt: "A" },
			{ name: "Separator", prompt: "", separator: true },
			{ name: "Two", prompt: "B" },
		];

		expect(getRunnableActions(actions)).toEqual([actions[0], actions[2]]);
	});
});

describe("moveAction", () => {
	it("reorders actions without mutating the original array", () => {
		const actions: LocalGPTAction[] = [
			{ name: "First", prompt: "A" },
			{ name: "Second", prompt: "B" },
			{ name: "Third", prompt: "C" },
		];

		const moved = moveAction(actions, 0, 2);

		expect(moved).toEqual([actions[1], actions[2], actions[0]]);
		expect(actions).toEqual([
			{ name: "First", prompt: "A" },
			{ name: "Second", prompt: "B" },
			{ name: "Third", prompt: "C" },
		]);
	});

	it("returns the original array when indices are invalid", () => {
		const actions: LocalGPTAction[] = [
			{ name: "Only", prompt: "A" },
		];

		expect(moveAction(actions, 0, 0)).toBe(actions);
		expect(moveAction(actions, -1, 0)).toBe(actions);
		expect(moveAction(actions, 0, 1)).toBe(actions);
	});
});
