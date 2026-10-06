import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
	actionPalettePlugin,
	showActionPalette,
	hideActionPalette,
} from "../src/ui/actionPalettePlugin";
import { isCompleteMention } from "../src/ui/actionPaletteText";

describe("Action Palette CM widget identity", () => {
	it("reuses the same widget DOM across document edits (eq/updateDOM)", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: "hello\nworld",
				extensions: actionPalettePlugin,
			}),
		});

		showActionPalette(view, 0, {
			onSubmit: () => undefined,
			onCancel: () => undefined,
			getFiles: () => [],
		});

		const first = host.querySelector(
			".local-gpt-action-palette-container",
		) as HTMLElement | null;
		expect(first).toBeTruthy();
		const input = first!.querySelector(
			".local-gpt-action-palette",
		) as HTMLDivElement;
		input.focus();
		expect(document.activeElement).toBe(input);

		// Doc change must not remount the widget (would drop focus / fake caret).
		view.dispatch({
			changes: { from: 5, insert: "!" },
		});

		const second = host.querySelector(
			".local-gpt-action-palette-container",
		) as HTMLElement | null;
		expect(second).toBe(first);
		expect(second!.isConnected).toBe(true);
		expect(
			host.querySelectorAll(".local-gpt-action-palette-container").length,
		).toBe(1);

		hideActionPalette(view);
		view.destroy();
		host.remove();
	});

	it("marks the palette widget editable so CM does not force contentEditable=false", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: "note",
				extensions: actionPalettePlugin,
			}),
		});
		showActionPalette(view, 0, {
			onSubmit: () => undefined,
		});
		const container = host.querySelector(
			".local-gpt-action-palette-container",
		) as HTMLElement;
		expect(container).toBeTruthy();
		// CM sets contentEditable=false on non-editable widgets; we must stay editable.
		expect(container.contentEditable).not.toBe("false");
		const input = container.querySelector(
			".local-gpt-action-palette",
		) as HTMLDivElement;
		expect(input.getAttribute("contenteditable")).toBe("true");
		hideActionPalette(view);
		view.destroy();
		host.remove();
	});
});

describe("completed @ mention detection", () => {
	const files = [
		{ path: "Notes/Alpha.md", basename: "Alpha", extension: "md" },
	];

	it("treats a selected file mention plus trailing text as complete", () => {
		expect(
			isCompleteMention("@Alpha.md", files, ["Notes/Alpha.md"]),
		).toBe(true);
		expect(
			isCompleteMention("@Alpha.md hello", files, ["Notes/Alpha.md"]),
		).toBe(true);
		expect(isCompleteMention("@Alpha", files, ["Notes/Alpha.md"])).toBe(
			false,
		);
	});
});
