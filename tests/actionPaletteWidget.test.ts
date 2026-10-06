import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
	actionPalettePlugin,
	showActionPalette,
	hideActionPalette,
} from "../src/ui/actionPalettePlugin";
import { isCompleteMention } from "../src/ui/actionPaletteText";

function createPaletteView(
	doc = "hello\nworld",
	extra: Parameters<typeof EditorState.create>[0]["extensions"] = [],
) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	let updates = 0;
	let docChanges = 0;
	const view = new EditorView({
		parent: host,
		state: EditorState.create({
			doc,
			extensions: [
				actionPalettePlugin,
				EditorView.updateListener.of((update) => {
					updates++;
					if (update.docChanged) docChanges++;
				}),
				...(Array.isArray(extra) ? extra : extra ? [extra] : []),
			],
		}),
	});
	return {
		host,
		view,
		counts: () => ({ updates, docChanges }),
		resetCounts: () => {
			updates = 0;
			docChanges = 0;
		},
	};
}

describe("Action Palette CM widget identity", () => {
	it("reuses the same widget DOM across document edits (eq/updateDOM)", () => {
		const { host, view } = createPaletteView();
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

	it("second show at the same position uses the latest onSubmit", async () => {
		const { host, view } = createPaletteView();
		let first = 0;
		let second = 0;
		showActionPalette(view, 0, {
			onSubmit: () => {
				first++;
			},
		});
		showActionPalette(view, 0, {
			onSubmit: () => {
				second++;
			},
		});

		const input = host.querySelector(
			".local-gpt-action-palette",
		) as HTMLDivElement;
		expect(input).toBeTruthy();
		expect(
			host.querySelectorAll(".local-gpt-action-palette-container").length,
		).toBe(1);

		input.focus();
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		await Promise.resolve();
		await Promise.resolve();

		expect(first).toBe(0);
		expect(second).toBe(1);

		hideActionPalette(view);
		view.destroy();
		host.remove();
	});

	it("keeps the host non-editable while the nested palette input stays editable", () => {
		const { host, view } = createPaletteView("note");
		showActionPalette(view, 0, {
			onSubmit: () => undefined,
		});
		const container = host.querySelector(
			".local-gpt-action-palette-container",
		) as HTMLElement;
		expect(container).toBeTruthy();
		// CM sets contentEditable=false on non-editable widgets (correct — avoids
		// treating Svelte mutations as doc edits). Nested input stays editable.
		expect(container.contentEditable).toBe("false");
		const input = container.querySelector(
			".local-gpt-action-palette",
		) as HTMLDivElement;
		expect(input.getAttribute("contenteditable")).toBe("true");
		hideActionPalette(view);
		view.destroy();
		host.remove();
	});

	it("does not treat Svelte mutations inside the widget as document changes", async () => {
		const { host, view, counts, resetCounts } = createPaletteView("stable");
		const startDoc = view.state.doc.toString();

		showActionPalette(view, 0, {
			onSubmit: () => undefined,
			getFiles: () => [{ path: "a.md", basename: "a", extension: "md" }],
		});

		// Let the initial show/update settle.
		await Promise.resolve();
		await Promise.resolve();
		resetCounts();

		const container = host.querySelector(
			".local-gpt-action-palette-container",
		) as HTMLElement;
		const input = container.querySelector(
			".local-gpt-action-palette",
		) as HTMLDivElement;

		// Simulate the kind of DOM churn Svelte does on open / badge refresh.
		for (let i = 0; i < 40; i++) {
			input.textContent = `prompt-${i}`;
			input.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType: "insertText",
					data: String(i),
				}),
			);
			const badge = document.createElement("div");
			badge.className = "local-gpt-reasoning-badge";
			badge.textContent = `Reasoning: ${i}`;
			container.appendChild(badge);
			badge.remove();
		}

		// Allow MutationObserver microtasks to flush.
		await Promise.resolve();
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));

		expect(view.state.doc.toString()).toBe(startDoc);
		expect(counts().docChanges).toBe(0);
		// Updates may include measures; they must not explode into a livelock.
		expect(counts().updates).toBeLessThan(20);

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
		expect(isCompleteMention("@Alpha.md", files, ["Notes/Alpha.md"])).toBe(
			true,
		);
		expect(
			isCompleteMention("@Alpha.md hello", files, ["Notes/Alpha.md"]),
		).toBe(true);
		expect(isCompleteMention("@Alpha", files, ["Notes/Alpha.md"])).toBe(
			false,
		);
	});
});
