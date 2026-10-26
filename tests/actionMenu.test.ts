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

	it("disambiguates provider name in context menu when multiple providers share the same model id", () => {
		const actions: LocalGPTAction[] = [
			{
				name: "Summarize",
				prompt: "A",
				modelSelection: { providerId: "zai", model: "GLM-4.7" },
			},
			{
				name: "Translate",
				prompt: "B",
				modelSelection: { providerId: "openai", model: "gpt-5.4-mini" },
			},
		];
		const providers = [
			{
				id: "zai",
				name: "Z.AI",
				model: "GLM-4.7",
				availableModels: ["GLM-4.7", "GLM-4.5-Air"],
			},
			{
				id: "openrouter",
				name: "OpenRouter",
				model: "GLM-4.7",
				availableModels: ["GLM-4.7"],
			},
			{
				id: "openai",
				name: "OpenAI",
				model: "gpt-5.4",
				availableModels: ["gpt-5.4", "gpt-5.4-mini"],
			},
		];
		const titles: string[] = [];
		const menu = {
			addSeparator: vi.fn(),
			addItem: (cb: (item: any) => void) => {
				const item = {
					setTitle: (title: string) => {
						titles.push(title);
						return item;
					},
					onClick: () => item,
				};
				cb(item);
			},
		};

		populateActionContextMenu(menu, actions, vi.fn(), providers);

		expect(titles).toEqual([
			"Summarize · Z.AI · GLM-4.7",
			"Translate · gpt-5.4-mini",
		]);
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
