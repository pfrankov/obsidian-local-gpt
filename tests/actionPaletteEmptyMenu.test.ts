import { describe, expect, it, vi } from "vitest";
import {
	handleDropdownNavigation,
	handleGeneralNavigation,
} from "../src/ui/actionPaletteNavigation";
import { createActionPaletteState } from "../src/ui/actionPaletteState";

describe.each(["command", "file"] as const)("empty %s dropdown", (kind) => {
	function setup(empty = true) {
		const state = createActionPaletteState("unmatched prompt", "");
		state.activeDropdown = kind;
		state.filteredItems = empty
			? []
			: [{ name: "provider", description: "Provider" }];
		state.selectedIndex = empty ? -1 : 0;
		const context = {
			state,
			submitAction: vi.fn(),
			handleSelection: vi.fn(),
			hideDropdown: vi.fn(() => {
				state.activeDropdown = "none";
			}),
			options: { onCancel: () => undefined, dispatchCancel: vi.fn() },
		} as unknown as Parameters<typeof handleDropdownNavigation>[0];
		const press = (
			key: string,
			shiftKey = false,
			isComposing = false,
			keyCode = 0,
		) => {
			const event = new KeyboardEvent("keydown", {
				key,
				shiftKey,
				isComposing,
				keyCode,
				cancelable: true,
			});
			if (!handleDropdownNavigation(context, event))
				handleGeneralNavigation(context, event);
			return event;
		};
		return { context, press };
	}
	it("submits on Enter without requiring Escape first", () => {
		const { context, press } = setup();
		expect(press("Enter").defaultPrevented).toBe(true);
		expect(context.submitAction).toHaveBeenCalledOnce();
		expect(context.handleSelection).not.toHaveBeenCalled();
	});
	it.each([true, false])(
		"lets Enter commit IME text without submitting (isComposing=%s)",
		(isComposing) => {
			const { context, press } = setup();
			expect(
				press("Enter", false, isComposing, isComposing ? 13 : 229)
					.defaultPrevented,
			).toBe(false);
			expect(context.submitAction).not.toHaveBeenCalled();
			expect(context.handleSelection).not.toHaveBeenCalled();
		},
	);
	it("still closes the empty dropdown on Escape", () => {
		const { context, press } = setup();
		press("Escape");
		expect(context.hideDropdown).toHaveBeenCalledOnce();
		expect(context.submitAction).not.toHaveBeenCalled();
	});
	it("keeps Shift+Enter available for a newline", () => {
		const { context, press } = setup();
		expect(press("Enter", true).defaultPrevented).toBe(false);
		expect(context.submitAction).not.toHaveBeenCalled();
	});
	it("still selects an available result with Enter", () => {
		const { context, press } = setup(false);
		press("Enter");
		expect(context.handleSelection).toHaveBeenCalledWith(
			context.state.filteredItems[0],
		);
		expect(context.submitAction).not.toHaveBeenCalled();
	});
});

describe.each([
	"provider",
	"model",
	"reasoning",
	"creativity",
	"system",
] as const)("empty %s control picker", (kind) => {
	it("consumes Enter without submitting the control command", () => {
		const state = createActionPaletteState(`/${kind} unmatched`, "");
		state.activeDropdown = kind;
		state.filteredItems = [];
		const context = {
			state,
			submitAction: vi.fn(),
			handleSelection: vi.fn(),
		} as unknown as Parameters<typeof handleDropdownNavigation>[0];
		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			cancelable: true,
		});
		if (!handleDropdownNavigation(context, event))
			handleGeneralNavigation(context, event);
		expect(event.defaultPrevented).toBe(true);
		expect(context.submitAction).not.toHaveBeenCalled();
		expect(context.handleSelection).not.toHaveBeenCalled();
	});
});
