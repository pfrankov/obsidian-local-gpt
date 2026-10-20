import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { getIcon, getIconIds, setIcon } from "obsidian";
import {
	createComponent,
	requireElement,
	typeIntoPalette,
} from "./helpers/actionPalette";
import {
	REPLACE_SELECTION_FALLBACK_ICON,
	REPLACE_SELECTION_ICON,
	getReplaceSelectionIconId,
} from "../src/ui/actionPaletteIcons";
import { isReplaceSelectionHotkey } from "../src/ui/actionPaletteNavigation";

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
	vi.mocked(getIcon).mockClear();
});

const TOGGLE = "button.local-gpt-replace-toggle";

const altR = (init: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", {
		key: "r",
		code: "KeyR",
		altKey: true,
		bubbles: true,
		cancelable: true,
		...init,
	});

const pressEnter = (textbox: HTMLElement) =>
	textbox.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);

const mountPalette = async (props: Record<string, unknown> = {}) => {
	const submitSpy = vi.fn();
	const changeSpy = vi.fn();
	const { target, component } = createComponent({
		onSubmit: submitSpy,
		onReplaceSelectionChange: changeSpy,
		...props,
	});
	await tick();
	const textbox = requireElement<HTMLDivElement>(
		target,
		".local-gpt-action-palette",
	);
	return { target, component, textbox, submitSpy, changeSpy };
};

describe("Action Palette replace-selection toggle", () => {
	it("is hidden without a selection; Alt+R is ignored and no replace flag is sent", async () => {
		const { target, component, textbox, submitSpy, changeSpy } =
			await mountPalette();
		expect(target.querySelector(TOGGLE)).toBeNull();

		const event = altR();
		textbox.dispatchEvent(event);
		await tick();
		expect(event.defaultPrevented).toBe(false);
		expect(changeSpy).not.toHaveBeenCalled();
		expect(target.querySelector(TOGGLE)).toBeNull();

		await typeIntoPalette(textbox, "Rewrite");
		pressEnter(textbox);
		await tick();
		expect(submitSpy).toHaveBeenCalledTimes(1);
		expect(submitSpy.mock.calls[0][0]).not.toHaveProperty(
			"replaceSelection",
		);
		component.$destroy();
	});

	it("shows an icon-only, borderless toggle (off by default) when there is a selection", async () => {
		const { target, component } = await mountPalette({
			canReplaceSelection: true,
		});
		const toggle = requireElement<HTMLButtonElement>(target, TOGGLE);
		// Lives in the footer meta next to the Creativity/Reasoning chips.
		expect(toggle.closest(".local-gpt-provider-badge-meta")).not.toBeNull();
		expect(toggle.textContent?.trim()).toBe("");
		expect(toggle.classList.contains("is-active")).toBe(false);
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		expect(toggle.getAttribute("title")).toBe(
			"Replace selection: off (Alt+R)",
		);
		expect(toggle.getAttribute("style")).toBeNull();
		// No aria-label: Obsidian would attach a body-level tooltip to it that
		// survives the palette being closed with Esc (no pointerout fires).
		expect(toggle.hasAttribute("aria-label")).toBe(false);
		// Icon comes from Obsidian's setIcon (mock writes data-icon).
		expect(setIcon).toHaveBeenCalledWith(toggle, expect.any(String));
		expect(toggle.dataset.icon).toBe(getReplaceSelectionIconId());
		component.$destroy();
	});

	it("click toggles the state, notifies the plugin and keeps focus in the prompt", async () => {
		const { target, component, textbox, submitSpy, changeSpy } =
			await mountPalette({ canReplaceSelection: true });
		await typeIntoPalette(textbox, "Fix grammar");
		const toggle = requireElement<HTMLButtonElement>(target, TOGGLE);

		toggle.focus();
		toggle.click();
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(toggle.classList.contains("is-active")).toBe(true);
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		expect(toggle.getAttribute("title")).toBe(
			"Replace selection: on (Alt+R)",
		);
		expect(changeSpy).toHaveBeenLastCalledWith(true);
		expect(document.activeElement).toBe(textbox);

		pressEnter(textbox);
		await tick();
		expect(submitSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				text: "Fix grammar",
				replaceSelection: true,
			}),
		);

		toggle.click();
		await tick();
		expect(toggle.classList.contains("is-active")).toBe(false);
		expect(changeSpy).toHaveBeenLastCalledWith(false);
		component.$destroy();
	});

	it("Alt+R toggles while the palette is open, on any layout, and submits the flag", async () => {
		const { target, component, textbox, submitSpy, changeSpy } =
			await mountPalette({ canReplaceSelection: true });
		const toggle = requireElement<HTMLButtonElement>(target, TOGGLE);

		const first = altR();
		textbox.dispatchEvent(first);
		await tick();
		expect(first.defaultPrevented).toBe(true);
		expect(toggle.classList.contains("is-active")).toBe(true);
		expect(changeSpy).toHaveBeenLastCalledWith(true);

		// Russian layout / macOS Option+R report another `key`, same `code`.
		textbox.dispatchEvent(altR({ key: "к" }));
		await tick();
		expect(toggle.classList.contains("is-active")).toBe(false);
		textbox.dispatchEvent(altR({ key: "®" }));
		await tick();
		expect(toggle.classList.contains("is-active")).toBe(true);

		await typeIntoPalette(textbox, "Shorter");
		pressEnter(textbox);
		await tick();
		expect(submitSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({ replaceSelection: true }),
		);
		component.$destroy();
	});

	it("submits replaceSelection=false when available but off", async () => {
		const { component, textbox, submitSpy } = await mountPalette({
			canReplaceSelection: true,
		});
		await typeIntoPalette(textbox, "Explain");
		pressEnter(textbox);
		await tick();
		expect(submitSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({ replaceSelection: false }),
		);
		component.$destroy();
	});

	it("restores the session state passed by the plugin", async () => {
		const { target, component } = await mountPalette({
			canReplaceSelection: true,
			replaceSelection: true,
		});
		const toggle = requireElement<HTMLButtonElement>(target, TOGGLE);
		expect(toggle.classList.contains("is-active")).toBe(true);
		component.$destroy();

		// Without a selection the remembered state is not applied.
		const second = await mountPalette({
			canReplaceSelection: false,
			replaceSelection: true,
		});
		expect(second.target.querySelector(TOGGLE)).toBeNull();
		await typeIntoPalette(second.textbox, "x");
		pressEnter(second.textbox);
		await tick();
		expect(second.submitSpy.mock.calls[0][0]).not.toHaveProperty(
			"replaceSelection",
		);
		second.component.$destroy();
	});
});

describe("replace-selection hotkey and icon helpers", () => {
	it("matches only plain Alt+R", () => {
		const make = (init: KeyboardEventInit) =>
			new KeyboardEvent("keydown", { code: "KeyR", key: "r", ...init });
		expect(isReplaceSelectionHotkey(make({ altKey: true }))).toBe(true);
		expect(
			isReplaceSelectionHotkey(make({ altKey: true, ctrlKey: true })),
		).toBe(false);
		expect(
			isReplaceSelectionHotkey(make({ altKey: true, metaKey: true })),
		).toBe(false);
		expect(
			isReplaceSelectionHotkey(make({ altKey: true, shiftKey: true })),
		).toBe(false);
		expect(isReplaceSelectionHotkey(make({}))).toBe(false);
		expect(
			isReplaceSelectionHotkey(
				new KeyboardEvent("keydown", {
					code: "KeyT",
					key: "t",
					altKey: true,
				}),
			),
		).toBe(false);
	});

	it("prefers Lucide 'list-restart' and falls back to 'refresh-cw' on older Obsidian", () => {
		expect(REPLACE_SELECTION_ICON).toBe("list-restart");
		expect(REPLACE_SELECTION_FALLBACK_ICON).toBe("refresh-cw");
		vi.mocked(getIconIds).mockReturnValueOnce([REPLACE_SELECTION_ICON]);
		expect(getReplaceSelectionIconId()).toBe(REPLACE_SELECTION_ICON);
		expect(getIcon).toHaveBeenLastCalledWith("list-restart");
		expect(getReplaceSelectionIconId()).toBe(
			REPLACE_SELECTION_FALLBACK_ICON,
		);
	});
});
