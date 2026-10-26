import { test, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { createComponent, typeIntoPalette } from "./helpers/actionPalette";

const selection = { providerId: "cloud", model: "precise" };
const actions = [
	{
		id: "a",
		name: "Translate",
		modelLabel: "Cloud · precise",
		shortModelLabel: "precise",
		selection,
	},
];
const props = {
	savedActions: actions,
	onRunSavedAction: vi.fn(),
	getActionModels: async () => [{ label: "Cloud · precise", selection }],
	onActionModelChange: async () => actions,
	providerLabel: "Local · fast",
};
const settle = async () => {
	await tick();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
};
afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

test("compact action model has short text and full provider identity in title; freeform footer is distinct", async () => {
	const { target, component } = createComponent(props);
	await settle();
	const button = target.querySelector<HTMLButtonElement>(
		".local-gpt-saved-action-model",
	)!;
	expect(button.textContent).toContain("precise");
	expect(button.textContent).not.toContain("Cloud");
	expect(button.title).toContain("Cloud · precise");
	expect(target.querySelector(".local-gpt-provider-badge")).toBeNull();
	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	await typeIntoPalette(input, "freeform");
	await settle();
	expect(target.querySelector(".local-gpt-provider-badge")).not.toBeNull();
	component.$destroy();
});

test("Escape restores focus to model button without closing palette or running action", async () => {
	const { target, component } = createComponent(props);
	await settle();
	target
		.querySelector<HTMLButtonElement>(".local-gpt-saved-action-model")!
		.click();
	await settle();
	const select = target.querySelector<HTMLSelectElement>("select")!;
	expect(document.activeElement).toBe(select);
	select.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(target.querySelector("select")).toBeNull();
	expect(document.activeElement).toBe(
		target.querySelector(".local-gpt-saved-action-model"),
	);
	component.$destroy();
});

test("successful model save returns keyboard focus", async () => {
	const { target, component } = createComponent(props);
	await settle();
	target
		.querySelector<HTMLButtonElement>(".local-gpt-saved-action-model")!
		.click();
	await settle();
	const select = target.querySelector<HTMLSelectElement>("select")!;
	select.value = "1";
	select.dispatchEvent(new Event("change", { bubbles: true }));
	await settle();
	expect(document.activeElement).toBe(
		target.querySelector(".local-gpt-saved-action-model"),
	);
	component.$destroy();
});

test("late model catalog response does not steal focus from prompt", async () => {
	let finish!: (models: any[]) => void;
	const pending = new Promise<any[]>((resolve) => {
		finish = resolve;
	});
	const { target, component } = createComponent({
		...props,
		getActionModels: () => pending,
	});
	await settle();
	target
		.querySelector<HTMLButtonElement>(".local-gpt-saved-action-model")!
		.click();
	await settle();
	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	input.focus();
	finish([{ label: "Cloud · precise", selection }]);
	await settle();
	expect(document.activeElement).toBe(input);
	expect(target.querySelector("select")).toBeNull();
	component.$destroy();
});

test("context menu exposes remembered model and executes original Action without altering it", async () => {
	const { populateActionContextMenu } = await import("../src/actionMenu");
	const action = {
		name: "Translate",
		prompt: "Translate to English",
		modelSelection: selection,
		temperature: 0,
	};
	let title = "";
	let run: (() => void) | undefined;
	const item = {
		setTitle: (value: string) => {
			title = value;
			return item;
		},
		onClick: (callback: () => void) => {
			run = callback;
			return item;
		},
	};
	const onAction = vi.fn();
	populateActionContextMenu(
		{ addSeparator: vi.fn(), addItem: (callback) => callback(item) },
		[action],
		onAction,
	);
	expect(title).toBe("Translate · precise");
	run?.();
	expect(onAction).toHaveBeenCalledWith(action);
	expect(action.modelSelection).toEqual(selection);
	expect(action.temperature).toBe(0);
});
