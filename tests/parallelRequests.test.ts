import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import LocalGPT from "../src/main";
import {
	getTrackedRange,
	requestPositionTracker,
	trackSelectionRange,
} from "../src/requestPositionTracker";
import { App, PluginManifest } from "obsidian";

vi.mock("obsidian");
vi.mock("../src/spinnerPlugin", () => ({
	spinnerPlugin: {},
}));
vi.mock("../src/ui/actionPalettePlugin", () => ({
	actionPalettePlugin: [],
	showActionPalette: vi.fn(),
	hideActionPalette: vi.fn(),
}));

class TestEditor {
	constructor(private view: EditorView) {}

	getValue() {
		return this.view.state.doc.toString();
	}

	lastLine() {
		return this.view.state.doc.lines - 1;
	}

	posToOffset(pos: { line: number; ch: number }) {
		const line = this.view.state.doc.line(pos.line + 1);
		return line.from + pos.ch;
	}

	offsetToPos(offset: number) {
		const line = this.view.state.doc.lineAt(offset);
		return { line: line.number - 1, ch: offset - line.from };
	}

	replaceRange(
		text: string,
		from: { line: number; ch: number },
		to?: { line: number; ch: number },
	) {
		const start = this.posToOffset(from);
		const end = this.posToOffset(to ?? from);
		this.view.dispatch({
			changes: { from: start, to: end, insert: text },
		});
	}
}

describe("Parallel requests", () => {
	let plugin: LocalGPT;
	let view: EditorView;
	let editor: TestEditor;

	beforeEach(() => {
		const app = { workspace: { updateOptions: vi.fn() } } as unknown as App;
		plugin = new LocalGPT(app, {} as PluginManifest);
		view = new EditorView({
			state: EditorState.create({
				doc: "Alpha\nBeta\nGamma",
				extensions: requestPositionTracker,
			}),
			parent: document.body,
		});
		editor = new TestEditor(view);
	});

	afterEach(() => {
		view.destroy();
	});

	it("inserts after the mapped position when another request finishes first", () => {
		const firstLine = view.state.doc.line(1);
		const secondLine = view.state.doc.line(2);
		const idFirst = trackSelectionRange(view, firstLine.to, firstLine.to);
		const idSecond = trackSelectionRange(
			view,
			secondLine.to,
			secondLine.to,
		);

		const firstRange = getTrackedRange(view, idFirst!);
		expect(firstRange).toBeTruthy();
		(plugin as any).applyTextResult(
			editor,
			false,
			"A1",
			"",
			firstRange!.from,
			firstRange!.insertAfter,
		);

		const secondRange = getTrackedRange(view, idSecond!);
		expect(secondRange).toBeTruthy();
		expect(secondRange!.insertAfter).toBe(
			secondLine.to + "\nA1\n".length,
		);
		(plugin as any).applyTextResult(
			editor,
			false,
			"B1",
			"",
			secondRange!.from,
			secondRange!.insertAfter,
		);

		expect(editor.getValue()).toBe("Alpha\n\nA1\nBeta\n\nB1\nGamma");
	});

	it("maps replace ranges across parallel edits", () => {
		const firstLine = view.state.doc.line(1);
		const secondLine = view.state.doc.line(2);
		const idSecond = trackSelectionRange(
			view,
			secondLine.from,
			secondLine.to,
		);

		(plugin as any).applyTextResult(
			editor,
			true,
			"A1",
			"Alpha",
			firstLine.from,
			firstLine.to,
		);

		const mappedRange = getTrackedRange(view, idSecond!);
		expect(mappedRange).toBeTruthy();
		expect(mappedRange!.from).toBe(secondLine.from - 3);
		expect(mappedRange!.to).toBe(secondLine.to - 3);
		(plugin as any).applyTextResult(
			editor,
			true,
			"B1",
			"Beta",
			mappedRange!.from,
			mappedRange!.to,
		);

		expect(editor.getValue()).toBe("A1\nB1\nGamma");
	});
});
