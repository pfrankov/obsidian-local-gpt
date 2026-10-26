import { test, expect, vi } from "vitest";
import { tick } from "svelte";
import { createComponent, typeIntoPalette } from "./helpers/actionPalette";
const initial = [{ id: "a", name: "Translate", modelLabel: "Local · old" }];
const props = {
	savedActions: initial,
	onRunSavedAction: vi.fn(),
	getActionModels: async () => [
		{
			label: "Cloud · new",
			selection: { providerId: "cloud", model: "new" },
		},
	],
	onActionModelChange: async () => [
		{
			id: "a",
			name: "Translate",
			modelLabel: "Cloud · new",
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
	(
		target.querySelector(
			".local-gpt-saved-action-model",
		) as HTMLButtonElement
	).click();
	await settle();
	const select = target.querySelector("select") as HTMLSelectElement;
	select.value = "1";
	select.dispatchEvent(new Event("change", { bubbles: true }));
	await settle();
	expect(
		target.querySelector(".local-gpt-saved-action-model")?.textContent,
	).toContain("Cloud · new");
	const input = target.querySelector(
		".local-gpt-action-palette",
	) as HTMLDivElement;
	await typeIntoPalette(input, "hello");
	await typeIntoPalette(input, "");
	await settle();
	expect(
		target.querySelector(".local-gpt-saved-action-model")?.textContent,
	).toContain("Cloud · new");
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
		target.querySelector(".local-gpt-saved-action-model"),
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
	(
		target.querySelector(
			".local-gpt-saved-action-model",
		) as HTMLButtonElement
	).click();
	await settle();
	const select = target.querySelector("select") as HTMLSelectElement;
	select.value = "1";
	select.dispatchEvent(new Event("change", { bubbles: true }));
	await settle();
	const input = target.querySelector(
		".local-gpt-action-palette",
	) as HTMLDivElement;
	await typeIntoPalette(input, "draft");
	finish([
		{
			id: "a",
			name: "Translate",
			modelLabel: "Cloud · new",
			selection: { providerId: "cloud", model: "new" },
		},
	]);
	await settle();
	await typeIntoPalette(input, "");
	await settle();
	expect(
		target.querySelector(".local-gpt-saved-action-model")?.textContent,
	).toContain("Cloud · new");
	component.$destroy();
});
