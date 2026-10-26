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

test("first click on model chip calls showPicker and blur closes select without stealing focus", async () => {
	const showPickerSpy = vi.fn();
	(HTMLSelectElement.prototype as any).showPicker = showPickerSpy;
	try {
		const { target, component } = createComponent(props);
		await settle();
		target
			.querySelector<HTMLButtonElement>(".local-gpt-saved-action-model")!
			.click();
		await settle();
		const select = target.querySelector<HTMLSelectElement>("select")!;
		expect(select).not.toBeNull();
		expect(showPickerSpy).toHaveBeenCalledTimes(1);

		const input = target.querySelector<HTMLDivElement>(
			".local-gpt-action-palette",
		)!;
		input.focus();
		select.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
		await settle();
		expect(target.querySelector("select")).toBeNull();
		expect(target.querySelector(".local-gpt-saved-action-model")).not.toBeNull();
		expect(document.activeElement).toBe(input);
		component.$destroy();
	} finally {
		delete (HTMLSelectElement.prototype as any).showPicker;
	}
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
		},
		{
			id: "second",
			name: "Summarize",
			modelLabel: "OpenAI · gpt-5.4-mini",
			shortModelLabel: "gpt-5.4-mini",
		},
		{
			id: "third",
			name: "Fix spelling",
			modelLabel: "Z.AI · GLM-4.5-Air",
			shortModelLabel: "GLM-4.5-Air",
		},
	];
	const { target, component } = createComponent({
		...props,
		savedActions: multiActions,
		onRunSavedAction,
		onSubmit,
		initialSelectedFiles: ["note.md"],
		getFiles: () => [
			{ path: "note.md", basename: "note", extension: "md" },
		],
	});
	await settle();

	const input = target.querySelector<HTMLDivElement>(
		".local-gpt-action-palette",
	)!;
	const rows = () =>
		Array.from(
			target.querySelectorAll<HTMLElement>(".local-gpt-saved-action"),
		);

	// Initially no row is highlighted
	expect(rows().some((row) => row.classList.contains("is-selected"))).toBe(
		false,
	);

	// ArrowDown highlights the first saved action
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	await settle();
	expect(rows()[0].classList.contains("is-selected")).toBe(true);

	// ArrowDown again highlights the second saved action
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	await settle();
	expect(rows()[1].classList.contains("is-selected")).toBe(true);

	// ArrowUp moves back to the first saved action, and ArrowUp again wraps to the last
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
	);
	await settle();
	expect(rows()[0].classList.contains("is-selected")).toBe(true);

	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
	);
	await settle();
	expect(rows()[2].classList.contains("is-selected")).toBe(true);

	// Enter executes the highlighted saved action with selectedFiles and does not submit freeform
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	await settle();
	expect(onRunSavedAction).toHaveBeenCalledWith("third", ["note.md"]);
	expect(onSubmit).not.toHaveBeenCalled();

	// Arrow keys also navigate when focus is on a saved action button itself
	const runButtons = () =>
		Array.from(
			target.querySelectorAll<HTMLButtonElement>(
				".local-gpt-saved-action-run",
			),
		);
	runButtons()[0].focus();
	await settle();
	runButtons()[0].dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	await settle();
	expect(document.activeElement).toBe(runButtons()[1]);
	expect(rows()[1].classList.contains("is-selected")).toBe(true);

	component.$destroy();
});
