import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("../src/i18n", () => ({
	I18n: {
		t: (key: string) => key,
	},
}));

import { ContentWidget } from "../src/spinnerContentWidget";
import { SpinnerPlugin, spinnerPlugin } from "../src/spinnerPlugin";

const collectDecorationPositions = (plugin: SpinnerPlugin, max: number) => {
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
	it("keeps per-request mode labels attached through streaming and removes them on cancellation", () => {
		const plugin = view.plugin(spinnerPlugin) as SpinnerPlugin;
		const hideFirst = plugin.show(5);
		const hideSecond = plugin.show(10);
		hideFirst.setStatus("model-a · Reasoning: low");
		hideSecond.setStatus("model-b · Reasoning: API default");
		plugin.processText("First answer", undefined, 5);
		plugin.processText(
			"<think>Visible provider text</think>Second answer",
			undefined,
			10,
		);
		const labels = () => {
			const values: string[] = [];
			plugin.decorations.between(
				0,
				view.state.doc.length,
				(_from, _to, value) => {
					const element = value.spec.widget.toDOM(view);
					if (element.className === "local-gpt-request-status")
						values.push(element.textContent);
				},
			);
			return values;
		};
		expect(labels()).toEqual([
			"model-a · Reasoning: low",
			"model-b · Reasoning: API default",
		]);
		hideFirst();
		expect(labels()).toEqual(["model-b · Reasoning: API default"]);
		hideSecond();
		expect(labels()).toEqual([]);
	});
	it.each([false, true])(
		"isolates statuses for coincident requests (converged=%s)",
		(converged) => {
			const plugin = view.plugin(spinnerPlugin) as SpinnerPlugin;
			const first = plugin.show(5);
			const second = plugin.show(converged ? 10 : 5);
			first.setStatus("first · low");
			second.setStatus("second · high");
			if (converged) view.dispatch({ changes: { from: 5, to: 10 } });
			first.setStatus("first · max");
			first.processText("Answer A");
			second.processText("Answer B");
			const contents = () => {
				const values: string[] = [];
				plugin.decorations.between(
					0,
					view.state.doc.length,
					(_from, _to, value) => {
						const widget = value.spec.widget;
						if (widget instanceof ContentWidget) {
							widget.toDOM(view);
							values.push(
								(widget as unknown as { text: string }).text,
							);
						}
					},
				);
				return values;
			};
			expect(contents()).toEqual(["Answer A", "Answer B"]);
			const labels = () => {
				const result: string[] = [];
				plugin.decorations.between(
					0,
					view.state.doc.length,
					(_from, _to, value) => {
						const element = value.spec.widget.toDOM(view);
						if (element.className === "local-gpt-request-status")
							result.push(element.textContent);
					},
				);
				return result;
			};
			expect(labels()).toEqual(["first · max", "second · high"]);
			first();
			first.setStatus("ignored after cancellation");
			first.processText("Ignored");
			second.processText("Answer B continued");
			expect(contents()).toEqual(["Answer B continued"]);
			expect(labels()).toEqual(["second · high"]);
			second();
			expect(labels()).toEqual([]);
		},
	);
});
