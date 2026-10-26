import { test, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { createComponent, typeIntoPalette } from "./helpers/actionPalette";
import { renderActionEditor } from "../src/settingsActionEditor";
import { collectActionModelChoices } from "../src/actionModels";
import type { LocalGPTAction } from "../src/interfaces";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return {
		...actual,
	Notice: vi.fn(),
	Setting: class {
		descEl = document.createElement("div");
		constructor(private container: HTMLElement) {}
		setName() {
			return this;
		}
		setDesc() {
			return this;
		}
		addText() {
			return this;
		}
		addTextArea() {
			return this;
		}
		addToggle() {
			return this;
		}
		addButton() {
			return this;
		}
		addDropdown(callback: (component: any) => void) {
			const select = document.createElement("select");
			this.container.append(select);
			const component = {
				addOption(value: string, label: string) {
					select.add(new Option(label, value));
					return component;
				},
				addOptions(options: Record<string, string>) {
					for (const [value, label] of Object.entries(options))
						component.addOption(value, label);
					return component;
				},
				setValue(value: string) {
					select.value = value;
					return component;
				},
				onChange(handler: (value: string) => void) {
					select.onchange = () => handler(select.value);
					return component;
				},
			};
			callback(component);
			return this;
		}
	},
	};
});

const initial = [
	{
		id: "a",
		name: "Translate",
		modelLabel: "Use default · Local · old",
	},
];
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

test("one-off provider override in Action Palette survives freeform text entry and clearing", async () => {
	const onRunSavedAction = vi.fn();
	const { target, component } = createComponent({
		...props,
		onRunSavedAction,
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
	expect(
		target.querySelector(".local-gpt-provider-badge-label")?.textContent,
	).toBe("Cloud · new");
	await typeIntoPalette(input, "hello");
	await typeIntoPalette(input, "");
	await settle();
	expect(
		target.querySelector(".local-gpt-provider-badge-label")?.textContent,
	).toBe("Cloud · new");
	(
		target.querySelector(".local-gpt-saved-action-run") as HTMLButtonElement
	).click();
	expect(onRunSavedAction).toHaveBeenCalledWith("a", [], {
		providerId: "cloud",
		model: "new",
	});
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

test("Settings → Actions → Edit binds a persistent model or resets to Inherit", () => {
	const container = document.createElement("div");
	const actionToEdit: LocalGPTAction = {
		id: "translate",
		name: "Translate",
		prompt: "Translate text",
	};
	const choices = collectActionModelChoices([
		{
			id: "local",
			name: "Local",
			model: "fast",
			availableModels: ["fast", "precise"],
		} as any,
		{
			id: "cloud",
			name: "Cloud",
			model: "gpt-5.4",
			availableModels: ["gpt-5.4"],
		} as any,
	]);

	renderActionEditor({
		container,
		actionModelChoices: choices,
		plugin: {
			settings: { actions: [actionToEdit] },
			saveSettings: vi.fn(),
		} as any,
		actionToEdit,
		isExistingAction: true,
		closeActionEditor: vi.fn(),
		addNewAction: vi.fn(),
		dropCommunityLinkIfModified: vi.fn(),
	});

	const selects = container.querySelectorAll("select");
	const modelSelect = selects[2];
	expect(modelSelect).toBeDefined();
	expect(modelSelect.value).toBe("");

	modelSelect.value = "cloud::gpt-5.4";
	modelSelect.dispatchEvent(new Event("change"));
	expect(actionToEdit.modelSelection).toEqual({
		providerId: "cloud",
		model: "gpt-5.4",
	});

	modelSelect.value = "";
	modelSelect.dispatchEvent(new Event("change"));
	expect(actionToEdit.modelSelection).toBeUndefined();
});
