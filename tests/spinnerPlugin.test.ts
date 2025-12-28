import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("../src/i18n", () => ({
	I18n: {
		t: (key: string) => key,
	},
}));

import { SpinnerPlugin, spinnerPlugin } from "../src/spinnerPlugin";

const collectDecorationPositions = (
	plugin: SpinnerPlugin,
	max: number,
) => {
	const positions: number[] = [];
	plugin.decorations.between(0, max, (from) => {
		positions.push(from);
	});
	return positions;
};

describe("SpinnerPlugin", () => {
	let view: EditorView;

	beforeEach(() => {
		view = new EditorView({
			state: EditorState.create({
				doc: "Alpha\nBeta",
				extensions: spinnerPlugin,
			}),
			parent: document.body,
		});
	});

	afterEach(() => {
		view.destroy();
	});

	it("maps spinner positions across document edits", () => {
		const plugin = view.plugin(spinnerPlugin) as SpinnerPlugin;
		const position = view.state.doc.line(1).to;
		plugin.show(position);

		const initialPositions = collectDecorationPositions(
			plugin,
			view.state.doc.length,
		);
		expect(initialPositions).toEqual([position]);

		const insertText = "Z\n";
		view.dispatch({
			changes: { from: 0, to: 0, insert: insertText },
		});

		const mappedPositions = collectDecorationPositions(
			plugin,
			view.state.doc.length,
		);
		expect(mappedPositions).toEqual([position + insertText.length]);
	});
});
