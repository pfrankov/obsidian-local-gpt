import { describe, expect, it, vi } from "vitest";
import { renderActionEditor } from "../src/settingsActionEditor";
import type { LocalGPTAction } from "../src/interfaces";

vi.mock("obsidian", () => ({
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
}));

describe("action Creativity control", () => {
	it.each([undefined, null, 0, 0.7])(
		"preserves %s and distinguishes inheritance, API default and zero",
		(temperature) => {
			const action: LocalGPTAction = {
				name: "Synthetic",
				prompt: "Synthetic",
				...(temperature === undefined ? {} : { temperature }),
			};
			const container = document.createElement("div");
			renderActionEditor({
				container,
				actionToEdit: action,
				plugin: {} as any,
				isExistingAction: false,
				closeActionEditor: vi.fn(),
				addNewAction: vi.fn(),
				dropCommunityLinkIfModified: vi.fn(),
			});
			const select = container.querySelectorAll("select")[1];
			expect(select.value).toBe(
				temperature === undefined
					? "inherit"
					: temperature === null
						? "default"
						: String(temperature),
			);
			expect(action.temperature).toBe(temperature);
			for (const [value, expected] of [
				["default", null],
				["0", 0],
				["1", 1],
				["inherit", undefined],
			] as const) {
				select.value = value;
				select.dispatchEvent(new Event("change"));
				expect(action.temperature).toBe(expected);
				expect(Object.hasOwn(action, "temperature")).toBe(
					value !== "inherit",
				);
			}
		},
	);
});
