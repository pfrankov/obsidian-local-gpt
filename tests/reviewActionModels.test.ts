import { test, expect, vi } from "vitest";
import { tick } from "svelte";
import { createComponent, typeIntoPalette } from "./helpers/actionPalette";

const initial = [{ id: "a", name: "Translate", modelLabel: "Local · old" }];
const props = {
	providerId: "local",
	providerDetails: { providerName: "Local", modelName: "old" },
	getProviders: async () => [
		{ id: "local", name: "old", providerName: "Local", providerUrl: "" },
		{ id: "cloud", name: "new", providerName: "Cloud", providerUrl: "" },
	],
	getModels: async () => [
		{ id: "old", name: "old" },
		{ id: "new", name: "new" },
	],
	savedActions: initial,
	onRunSavedAction: vi.fn(),
	onActionModelChange: async () => [
		{
			id: "a",
			name: "Translate",
			modelLabel: "Cloud · new",
			shortModelLabel: "new",
			selection: { providerId: "cloud", model: "new" },
		},
	],
};

const settle = async () => {
	await tick();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
};

test("saved action label survives freeform text entry and clearing", async () => {
	const { target, component } = createComponent(props);
	await settle();
	const input = target.querySelector(
		".local-gpt-action-palette",
	) as HTMLDivElement;
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	(
		target.querySelector(
			".local-gpt-provider-badge-button",
		) as HTMLButtonElement
	).click();
	await settle();
	const items = target.querySelectorAll<HTMLElement>(
		".local-gpt-dropdown-item",
	);
	items[1].click();
	await settle();
	expect(
		target.querySelector(".local-gpt-saved-action-model")?.textContent,
	).toContain("new");
	await typeIntoPalette(input, "hello");
	await typeIntoPalette(input, "");
	await settle();
	expect(
		target.querySelector(".local-gpt-saved-action-model")?.textContent,
	).toContain("new");
	component.$destroy();
});

test("saved actions are available when initial document is attached", async () => {
	const { target, component } = createComponent({
		...props,
		initialSelectedFiles: ["note.md"],
		getFiles: () => [
			{ path: "note.md", basename: "note", extension: "md" },
		],
	});
	await settle();
	expect(
		target.querySelector(".local-gpt-saved-action-run"),
	).not.toBeNull();
	component.$destroy();
});

test("saved label stays accurate when prompt edited during pending save", async () => {
	let finish!: (a: any) => void;
	const saving = new Promise<any>((r) => (finish = r));
	const { target, component } = createComponent({
		...props,
		onActionModelChange: () => saving,
	});
	await settle();
	const input = target.querySelector(
		".local-gpt-action-palette",
	) as HTMLDivElement;
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle();
	(
		target.querySelector(
			".local-gpt-provider-badge-button",
		) as HTMLButtonElement
	).click();
	await settle();
	const items = target.querySelectorAll<HTMLElement>(
		".local-gpt-dropdown-item",
	);
	items[1].click();
	await settle();
	await typeIntoPalette(input, "draft");
	finish([
		{
			id: "a",
			name: "Translate",
			modelLabel: "Cloud · new",
			shortModelLabel: "new",
			selection: { providerId: "cloud", model: "new" },
		},
	]);
	await settle();
	await typeIntoPalette(input, "");
	await settle();
	expect(
		target.querySelector(".local-gpt-saved-action-model")?.textContent,
	).toContain("new");
	component.$destroy();
});
