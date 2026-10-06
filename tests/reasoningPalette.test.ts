import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import {
	createComponent,
	requireElement,
	typeIntoPalette,
} from "./helpers/actionPalette";
import { createActionPaletteState } from "../src/ui/actionPaletteState";
import {
	refreshReasoning,
	resetReasoning,
	showReasoningDropdown,
} from "../src/ui/actionPaletteReasoning";
import { I18n } from "../src/i18n";

const snapshot = {
	providerId: "fixture",
	model: "glm-5.3-flash",
	modes: ["low", "high", "max"],
	effectiveMode: "high",
};
const flush = async () => {
	await Promise.resolve();
	await tick();
	await Promise.resolve();
	await tick();
};
afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("per-invocation reasoning", () => {
	it("selects a native mode via slash, displays it, strips command and resets next invocation", async () => {
		const onSubmit = vi.fn();
		const props = { getReasoningSnapshot: async () => snapshot, onSubmit };
		const { target, component } = createComponent(props);
		await flush();
		expect(
			target.querySelector(".local-gpt-reasoning-badge")?.textContent,
		).toContain(I18n.t("settings.reasoningEffortHigh"));
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/reasoning ");
		await flush();
		const low = Array.from(
			target.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item"),
		).find(
			(item) =>
				item.textContent?.trim() ===
				I18n.t("settings.reasoningEffortLow"),
		)!;
		expect(low).toBeDefined();
		low.click();
		await flush();
		expect(
			target.querySelector(".local-gpt-reasoning-badge")?.textContent,
		).toContain(I18n.t("settings.reasoningEffortLow"));
		expect(document.activeElement).toBe(input);
		await typeIntoPalette(input, "Synthetic prompt");
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "Synthetic prompt",
				reasoningSelection: {
					providerId: snapshot.providerId,
					model: snapshot.model,
					mode: "low",
				},
			}),
		);
		component.$destroy();
		const next = createComponent(props);
		await flush();
		expect(
			next.target.querySelector(".local-gpt-reasoning-badge")
				?.textContent,
		).toContain(I18n.t("settings.reasoningEffortHigh"));
		next.component.$destroy();
	});

	it("distinguishes API default from inheritance without changing saved provider preferences", async () => {
		const onSubmit = vi.fn();
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => snapshot,
			onSubmit,
		});
		await flush();
		requireElement<HTMLButtonElement>(
			target,
			".local-gpt-reasoning-badge",
		).click();
		await flush();
		const choice = Array.from(
			target.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item"),
		).find(
			(item) =>
				item.textContent?.trim() ===
				I18n.t("settings.reasoningEffortDefault"),
		)!;
		choice.click();
		await flush();
		expect(target.querySelector(".local-gpt-reasoning-badge")).toBeNull();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "Synthetic");
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(onSubmit.mock.calls[0][0].reasoningSelection.mode).toBe(
			"default",
		);
		expect(snapshot.effectiveMode).toBe("high");
		component.$destroy();
	});

	it("rejects stale asynchronous snapshots and clears a selection on model changes", async () => {
		const state = createActionPaletteState("", "");
		let resolve!: (value: typeof snapshot) => void;
		let getSnapshot = () =>
			new Promise<typeof snapshot>((done) => {
				resolve = done;
			});
		const context = {
			state,
			options: { getReasoningSnapshot: () => getSnapshot },
			commit: vi.fn(),
		} as any;
		const pending = refreshReasoning(context);
		resetReasoning(context);
		getSnapshot = async () => ({
			...snapshot,
			model: "other",
			modes: [],
			effectiveMode: undefined as any,
		});
		await refreshReasoning(context);
		resolve(snapshot);
		await pending;
		expect(state.reasoningSnapshot?.model).toBe("other");
		state.reasoningSelection = {
			providerId: "fixture",
			model: "other",
			mode: "low",
		};
		await refreshReasoning(context);
		expect(state.reasoningSelection).toBeUndefined();
	});
	it("does not reopen the reasoning menu after an async result when another menu is active", async () => {
		const state = createActionPaletteState("", "");
		let resolve!: (value: typeof snapshot) => void;
		const context = {
			state,
			options: {
				getReasoningSnapshot: () => () =>
					new Promise<typeof snapshot>((done) => {
						resolve = done;
					}),
			},
			commit: vi.fn(),
			updateFilteredDropdownItems: vi.fn(),
			getCommandQuery: () => "",
		} as any;
		const pending = showReasoningDropdown(context);
		state.activeDropdown = "provider";
		resolve(snapshot);
		await pending;
		expect(state.activeDropdown).toBe("provider");
		expect(context.updateFilteredDropdownItems).toHaveBeenCalledTimes(1);
	});
});

describe("reasoning palette keyboard UX", () => {
	it("hides reasoning controls when includeReasoning is false", async () => {
		const { target, component } = createComponent({
			includeReasoning: false,
			getReasoningSnapshot: undefined,
		});
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/rea");
		await flush();
		const names = Array.from(
			target.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item"),
		).map((item) => item.textContent?.trim() ?? "");
		expect(names.join("\n")).not.toMatch(/reasoning/i);
		expect(target.querySelector(".local-gpt-reasoning-badge")).toBeNull();
		component.$destroy();
	});

	it("keeps true focus in the input after selecting a mode so Ctrl+A stays local", async () => {
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => snapshot,
		});
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/reasoning ");
		await flush();
		const low = Array.from(
			target.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item"),
		).find(
			(item) =>
				item.textContent?.trim() ===
				I18n.t("settings.reasoningEffortLow"),
		)!;
		low.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
		);
		low.click();
		await flush();
		expect(document.activeElement).toBe(input);
		expect(input).toHaveAccessibleName(
			I18n.t("commands.actionPalette.name"),
		);
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "a",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(document.activeElement).toBe(input);
		component.$destroy();
	});

	it("models /reasoning → arrows → Enter → Ctrl+A: select-all stays in palette", async () => {
		// Nested contenteditable mimic: palette widget lives inside cm-content.
		const note = document.createElement("div");
		note.className = "cm-content";
		note.contentEditable = "true";
		note.textContent = "original note body that must not be replaced";
		document.body.appendChild(note);

		const { target, component } = createComponent({
			getReasoningSnapshot: async () => snapshot,
		});
		note.appendChild(target);
		await flush();

		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		input.focus();
		await typeIntoPalette(input, "/reasoning");
		await flush();

		// Arrow to High (inherit, default, low, high → index 3)
		for (let i = 0; i < 3; i++) {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowDown",
					bubbles: true,
					cancelable: true,
				}),
			);
			await flush();
		}
		expect(
			target.querySelector(".local-gpt-dropdown-item.local-gpt-selected")
				?.textContent,
		).toContain(I18n.t("settings.reasoningEffortHigh"));

		const enter = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		input.dispatchEvent(enter);
		await flush();
		expect(document.activeElement).toBe(input);
		expect(
			target.querySelector(".local-gpt-reasoning-badge")?.textContent,
		).toContain(I18n.t("settings.reasoningEffortHigh"));

		// Simulate Obsidian/CM capture-phase Mod+A competing for the event.
		let editorSawModA = false;
		const editorCapture = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				event.key.toLowerCase() === "a"
			) {
				if (!event.defaultPrevented) {
					editorSawModA = true;
					note.focus();
					const sel = window.getSelection();
					const range = document.createRange();
					range.selectNodeContents(note);
					sel?.removeAllRanges();
					sel?.addRange(range);
				}
			}
		};
		window.addEventListener("keydown", editorCapture, true);

		const modA = new KeyboardEvent("keydown", {
			key: "a",
			code: "KeyA",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		// Dispatch on window so capture listeners run (real browser path).
		window.dispatchEvent(modA);
		await flush();
		window.removeEventListener("keydown", editorCapture, true);

		expect(editorSawModA).toBe(false);
		expect(document.activeElement).toBe(input);
		const selection = window.getSelection();
		expect(selection?.rangeCount).toBeGreaterThan(0);
		expect(
			input.contains(selection!.getRangeAt(0).startContainer) ||
				selection!.getRangeAt(0).startContainer === input,
		).toBe(true);

		// Typing after Ctrl+A must edit the palette, not replace the note.
		input.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "insertText",
				data: "x",
			}),
		);
		// Directly model insert into palette selection
		input.textContent = "x";
		input.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: "x",
				inputType: "insertText",
			}),
		);
		await flush();
		expect(note.textContent).toContain(
			"original note body that must not be replaced",
		);
		expect(input.textContent).toContain("x");
		component.$destroy();
		note.remove();
	});

	it("moves the highlight with ArrowUp/ArrowDown in the reasoning picker", async () => {
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => snapshot,
		});
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		requireElement<HTMLButtonElement>(
			target,
			".local-gpt-reasoning-badge",
		).click();
		await flush();
		expect(document.activeElement).toBe(input);
		expect(
			target.querySelector(".local-gpt-dropdown-item.local-gpt-selected")
				?.textContent,
		).toContain(I18n.t("settings.reasoningEffortInherit"));
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowDown",
				bubbles: true,
				cancelable: true,
			}),
		);
		await flush();
		expect(
			target.querySelector(".local-gpt-dropdown-item.local-gpt-selected")
				?.textContent,
		).toContain(I18n.t("settings.reasoningEffortDefault"));
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowDown",
				bubbles: true,
				cancelable: true,
			}),
		);
		await flush();
		expect(
			target.querySelector(".local-gpt-dropdown-item.local-gpt-selected")
				?.textContent,
		).toContain(I18n.t("settings.reasoningEffortLow"));
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
		await flush();
		expect(
			target.querySelector(".local-gpt-reasoning-badge")?.textContent,
		).toContain(I18n.t("settings.reasoningEffortLow"));
		component.$destroy();
	});

	it("shows an empty-command state for unmatched / queries without hiding badges", async () => {
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => snapshot,
			providerLabel: "Fixture · model",
		});
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/summ");
		await flush();
		expect(
			target.querySelector(".local-gpt-dropdown-empty")?.textContent,
		).toContain(I18n.t("commands.actionPalette.noMatchingCommands"));
		expect(
			target.querySelector(".local-gpt-provider-badge-label")
				?.textContent,
		).toContain("Fixture");
		expect(
			target.querySelector(".local-gpt-reasoning-badge"),
		).not.toBeNull();
		component.$destroy();
	});
});

describe("keyboard selection focus restoration", () => {
	it("restores caret after ArrowDown+Enter even if the editor steals focus mid-flight", async () => {
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => snapshot,
		});
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/reasoning ");
		await flush();
		input.focus();
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowDown",
				bubbles: true,
				cancelable: true,
			}),
		);
		await flush();
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowDown",
				bubbles: true,
				cancelable: true,
			}),
		);
		await flush();
		// Simulate CodeMirror reclaiming focus during Enter handling (keyup target).
		const thief = document.createElement("textarea");
		document.body.appendChild(thief);
		const steal = () => thief.focus();
		input.addEventListener("keydown", steal);
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
		input.removeEventListener("keydown", steal);
		thief.dispatchEvent(
			new KeyboardEvent("keyup", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
		await flush();
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		await flush();
		expect(
			target.querySelector(".local-gpt-reasoning-badge")?.textContent,
		).toContain(I18n.t("settings.reasoningEffortLow"));
		expect(document.activeElement).toBe(input);
		const selection = window.getSelection();
		expect(selection?.rangeCount).toBeGreaterThan(0);
		expect(input.contains(selection!.getRangeAt(0).startContainer)).toBe(
			true,
		);
		thief.remove();
		component.$destroy();
	});
});
