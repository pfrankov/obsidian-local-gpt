import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	PluginSpec,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";

class Spinner extends WidgetType {
	constructor(readonly text: string) {
		super();
	}

	eq(other: Spinner) {
		return other.text == this.text;
	}

	toDOM() {
		let wrap = document.createElement("div");
		wrap.innerHTML = this.text;
		wrap.addClass("local-gpt-streaming-text");

		const span = document.createElement("span");
		span.addClasses(["local-gpt-loading", "local-gpt-dots"]);

		if (!this.text.trim()) {
			return span;
		}

		wrap.innerHTML = wrap.innerHTML.trimEnd() + span.outerHTML.trim();
		return wrap;
	}

	ignoreEvent() {
		return false;
	}
}

export class SpinnerPlugin implements PluginValue {
	decorations: DecorationSet;
	listOfPositions: number[];
	editorView: EditorView;

	constructor(view: EditorView) {
		this.editorView = view;
		this.listOfPositions = [];
		this.decorations = this.buildDecorations();
	}

	show(position: number): Function {
		this.listOfPositions.push(position);
		this.decorations = this.buildDecorations();

		return () => {
			this.hide(position);
		};
	}

	hide(position: number) {
		this.listOfPositions = this.listOfPositions.filter(
			(pos) => pos !== position,
		);
		this.decorations = this.buildDecorations();
	}

	updateContent(text: string) {
		this.decorations = this.buildDecorations(text);
	}
	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) {
			this.decorations = this.buildDecorations();
		}
	}

	destroy() {}

	buildDecorations(text = ""): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		this.listOfPositions.forEach((pos) => {
			const indentationWidget = Decoration.widget({
				widget: new Spinner(text),
				side: 1,
			});

			builder.add(pos, pos, indentationWidget);
		});
		return builder.finish();
	}
}

const pluginSpec: PluginSpec<SpinnerPlugin> = {
	decorations: (value: SpinnerPlugin) => value.decorations,
};

export const spinnerPlugin = ViewPlugin.fromClass(SpinnerPlugin, pluginSpec);
