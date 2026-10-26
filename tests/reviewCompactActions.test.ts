import { test, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { createComponent } from "./helpers/actionPalette";

const selection = { providerId: "cloud", model: "precise" };
const actions = [
	{
		id: "a",
		name: "Translate",
		modelLabel: "Cloud · precise",
		shortModelLabel: "precise",
		selection,
	},
	{
		id: "b",
		name: "Summarize",
		modelLabel: "Local · fast",
	},
];
const props = {
	savedActions: actions,
	onRunSavedAction: vi.fn(),
	onActionModelChange: async () => actions,
	providerId: "local",
	providerLabel: "Local · fast",
	providerDetails: { providerName: "Local", modelName: "fast" },
	getProviders: async () => [
		{ id: "local", name: "fast", providerName: "Local", providerUrl: "" },
		{ id: "cloud", name: "precise", providerName: "Cloud", providerUrl: "" },
	],
	getModels: async () => [
		{ id: "fast", name: "fast" },
		{ id: "precise", name: "precise" },
	],
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

test("row shows model badge only when overridden, without inline select; bottom badge is always visible", async () => {
	const { target, component } = createComponent(props);
	await settle();
	const rows = target.querySelectorAll<HTMLElement>(".local-gpt-saved-action");
	expect(rows.length).toBe(2);

	const overriddenBadge = rows[0].querySelector<HTMLElement>(
		".local-gpt-saved-action-model",
	)!;
	expect(overriddenBadge).not.toBeNull();
	expect(overriddenBadge.textContent).toBe("precise");
	expect(overriddenBadge.title).toContain("Cloud · precise");

	// Non-overridden action row has no redundant model badge
	expect(rows[1].querySelector(".local-gpt-saved-action-model")).toBeNull();
	expect(target.querySelector("select")).toBeNull();

	// Bottom provider/model badge is always visible even when saved actions are shown
	const footerLabel = target.querySelector<HTMLElement>(
		".local-gpt-provider-badge-label",
	)!;
	expect(footerLabel).not.toBeNull();
	expect(footerLabel.textContent).toBe("Local · fast");
	component.$destroy();
});

test("highlighting a saved action syncs the bottom badge and picking a model from the bottom badge updates that action", async () => {
	const onActionModelChange = vi.fn(async (_id, nextSelection) => [
		actions[0],
		{
			id: "b",
			name: "Summarize",
			modelLabel: "Local · precise",
			shortModelLabel: "precise",
			selection: nextSelection,
		},
	]);
	const { target, component } = createComponent({
		...props,
		onActionModelChange,
	});
	await settle();
	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	const footerLabel = target.querySelector<HTMLElement>(
		".local-gpt-provider-badge-label",
	)!;

	// ArrowDown highlights first action (Cloud · precise)
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(footerLabel.textContent).toBe("Cloud · precise");

	// ArrowDown highlights second action (Local · fast)
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(footerLabel.textContent).toBe("Local · fast");

	// Click model button in bottom badge and pick "precise"
	target
		.querySelector<HTMLButtonElement>(".local-gpt-model-badge-button")!
		.click();
	await settle();
	const items = target.querySelectorAll<HTMLElement>(
		".local-gpt-dropdown-item",
	);
	expect(items.length).toBe(2);
	items[1].click();
	await settle();

	expect(onActionModelChange).toHaveBeenCalledWith("b", {
		providerId: "local",
		model: "precise",
	});
	const rows = target.querySelectorAll<HTMLElement>(".local-gpt-saved-action");
	expect(
		rows[1].querySelector(".local-gpt-saved-action-model")?.textContent,
	).toBe("precise");
	component.$destroy();
});

test("changing model via bottom badge before clicking a saved action remembers that model for the clicked action", async () => {
	const onRunSavedAction = vi.fn();
	const onActionModelChange = vi.fn(async () => actions);
	const { target, component } = createComponent({
		...props,
		onRunSavedAction,
		onActionModelChange,
	});
	await settle();

	// Without highlighting an action first, change model via bottom badge
	target
		.querySelector<HTMLButtonElement>(".local-gpt-model-badge-button")!
		.click();
	await settle();
	const items = target.querySelectorAll<HTMLElement>(
		".local-gpt-dropdown-item",
	);
	items[1].click();
	await settle();

	// Now click the second saved action ("Summarize")
	const runButtons = target.querySelectorAll<HTMLButtonElement>(
		".local-gpt-saved-action-run",
	);
	runButtons[1].click();
	await settle();

	expect(onActionModelChange).toHaveBeenCalledWith("b", {
		providerId: "local",
		model: "precise",
	});
	expect(onRunSavedAction).toHaveBeenCalledWith("b", []);
	component.$destroy();
});

test("context menu exposes remembered model only when overridden and disambiguates duplicate model names across providers", async () => {
	const { populateActionContextMenu } = await import("../src/actionMenu");
	const overriddenAction = {
		name: "Translate",
		prompt: "Translate to English",
		modelSelection: selection,
		temperature: 0,
	};
	const defaultAction = {
		name: "Summarize",
		prompt: "Summarize text",
	};
	const titles: string[] = [];
	let runFirst: (() => void) | undefined;
	populateActionContextMenu(
		{
			addSeparator: vi.fn(),
			addItem: (callback) => {
				const item = {
					setTitle: (value: string) => {
						titles.push(value);
						return item;
					},
					onClick: (cb: () => void) => {
						if (!runFirst) runFirst = cb;
						return item;
					},
				};
				callback(item);
			},
		},
		[overriddenAction, defaultAction],
		vi.fn(),
	);
	expect(titles).toEqual(["Translate · precise", "Summarize"]);

	// Disambiguates when two providers share the same model name
	const duplicateTitles: string[] = [];
	populateActionContextMenu(
		{
			addSeparator: vi.fn(),
			addItem: (callback) => {
				const item = {
					setTitle: (value: string) => {
						duplicateTitles.push(value);
						return item;
					},
					onClick: () => item,
				};
				callback(item);
			},
		},
		[overriddenAction],
		vi.fn(),
		[
			{ id: "cloud", name: "Cloud", model: "precise" } as any,
			{ id: "local", name: "Local", model: "precise" } as any,
		],
	);
	expect(duplicateTitles).toEqual(["Translate · Cloud · precise"]);
});

test("ArrowDown, ArrowUp, and Enter navigate and execute saved actions when prompt input is empty", async () => {
	const onRunSavedAction = vi.fn();
	const onSubmit = vi.fn();
	const multiActions = [
		{
			id: "first",
			name: "Continue writing",
			modelLabel: "Z.AI · GLM-4.7",
			shortModelLabel: "GLM-4.7",
			selection: { providerId: "zai", model: "GLM-4.7" },
		},
		{
			id: "second",
			name: "Summarize",
			modelLabel: "OpenAI · gpt-5.4-mini",
		},
		{
			id: "third",
			name: "Fix spelling",
			modelLabel: "Z.AI · GLM-4.5-Air",
		},
	];
	const { target, component } = createComponent({
		...props,
		savedActions: multiActions,
		onRunSavedAction,
		onSubmit,
	});
	await settle();

	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	const rows = target.querySelectorAll<HTMLElement>(
		".local-gpt-saved-action",
	);
	expect(rows.length).toBe(3);
	expect(
		target.querySelector(".local-gpt-saved-action.local-gpt-selected"),
	).toBeNull();

	// ArrowDown highlights first action
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(rows[0].classList.contains("local-gpt-selected")).toBe(true);

	// ArrowDown moves to second action
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(rows[0].classList.contains("local-gpt-selected")).toBe(false);
	expect(rows[1].classList.contains("local-gpt-selected")).toBe(true);

	// ArrowUp moves back to first action, then wraps to last action
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowUp",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(rows[0].classList.contains("local-gpt-selected")).toBe(true);

	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowUp",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(rows[2].classList.contains("local-gpt-selected")).toBe(true);

	// Enter runs the highlighted saved action without submitting freeform prompt
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	expect(onRunSavedAction).toHaveBeenCalledWith("third", []);
	expect(onSubmit).not.toHaveBeenCalled();

	component.$destroy();
});
