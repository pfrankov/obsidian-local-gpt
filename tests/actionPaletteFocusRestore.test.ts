import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
	actionPalettePlugin,
	hideActionPalette,
	showActionPalette,
} from "../src/ui/actionPalettePlugin";
import {
	beginHoldingPromptFocus,
	restorePromptFocus,
	shouldReclaimPromptFocus,
} from "../src/ui/actionPaletteDom";

const DOC = "Alpha beta. Gamma delta.\nLine two";

const settle = async () => {
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await tick();
};

function openPalette(
	selection: { anchor: number; head: number },
	opts: { submitHides?: boolean } = {},
) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const view = new EditorView({
		parent: host,
		state: EditorState.create({
			doc: DOC,
			extensions: [actionPalettePlugin],
		}),
	});
	view.focus();
	view.dispatch({ selection });
	showActionPalette(view, 0, {
		onSubmit: () => {
			if (opts.submitHides) hideActionPalette(view);
		},
		onCancel: () => hideActionPalette(view),
	});
	const input = host.querySelector(
		".local-gpt-action-palette",
	) as HTMLDivElement;
	return { host, view, input };
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("hideActionPalette focus/selection restore", () => {
	it("releases the prompt focus hold and removes the palette before focusing the editor", async () => {
		const { view, input } = openPalette({ anchor: 12, head: 24 });
		await settle();
		expect(document.activeElement).toBe(input);
		expect(shouldReclaimPromptFocus(input)).toBe(true);

		// In Chromium the palette's focusout handler reclaims focus while the
		// hold is active; jsdom doesn't, so assert the ordering directly.
		const originalFocus = view.focus.bind(view);
		let holdAtFocus: boolean | undefined;
		let connectedAtFocus: boolean | undefined;
		vi.spyOn(view, "focus").mockImplementation(() => {
			holdAtFocus = shouldReclaimPromptFocus(input);
			connectedAtFocus = input.isConnected;
			originalFocus();
		});

		hideActionPalette(view);

		expect(view.focus).toHaveBeenCalledTimes(1);
		expect(holdAtFocus).toBe(false);
		expect(connectedAtFocus).toBe(false);
		expect(view.state.selection.main.from).toBe(12);
		expect(view.state.selection.main.to).toBe(24);
		expect(document.activeElement).toBe(view.contentDOM);
		view.destroy();
	});

	it("Esc keeps the selection and leaves focus in the editor (no late reclaim)", async () => {
		const { host, view, input } = openPalette({ anchor: 12, head: 24 });
		await settle();
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
		await settle();
		expect(host.querySelector(".local-gpt-action-palette")).toBeNull();
		expect(document.activeElement).toBe(view.contentDOM);
		expect(view.hasFocus).toBe(true);
		expect(view.state.selection.main.from).toBe(12);
		expect(view.state.selection.main.to).toBe(24);
		view.destroy();
	});

	it("submit (Enter) returns focus to the editor so Ctrl+Z reaches it at once", async () => {
		const { host, view, input } = openPalette(
			{ anchor: 0, head: 11 },
			{ submitHides: true },
		);
		await settle();
		input.textContent = "Rewrite";
		input.dispatchEvent(new InputEvent("input", { bubbles: true }));
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		await settle();
		expect(host.querySelector(".local-gpt-action-palette")).toBeNull();
		expect(document.activeElement).toBe(view.contentDOM);
		expect(view.state.selection.main.from).toBe(0);
		expect(view.state.selection.main.to).toBe(11);
		view.destroy();
	});

	it("restores a collapsed caret when nothing was selected", async () => {
		const { view } = openPalette({ anchor: 30, head: 30 });
		await settle();
		hideActionPalette(view);
		expect(view.state.selection.main.empty).toBe(true);
		expect(view.state.selection.main.head).toBe(30);
		expect(document.activeElement).toBe(view.contentDOM);
		view.destroy();
	});

	it("is a no-op for focus when no palette was shown", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const view = new EditorView({
			parent: host,
			state: EditorState.create({ doc: DOC }),
		});
		const focus = vi.spyOn(view, "focus");
		hideActionPalette(view);
		expect(focus).not.toHaveBeenCalled();
		view.destroy();
	});
});

describe("restorePromptFocus", () => {
	it("never re-arms or focuses a detached prompt (closed palette)", async () => {
		const el = document.createElement("div");
		el.contentEditable = "true";
		el.tabIndex = 0;
		const other = document.createElement("input");
		document.body.appendChild(other);
		other.focus();
		restorePromptFocus(() => el, 0);
		await settle();
		expect(shouldReclaimPromptFocus(el)).toBe(false);
		expect(document.activeElement).toBe(other);

		document.body.appendChild(el);
		beginHoldingPromptFocus(el);
		restorePromptFocus(() => el, 0);
		expect(document.activeElement).toBe(el);
	});
});
