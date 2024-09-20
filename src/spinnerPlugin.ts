import { RangeSetBuilder, EditorState } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";

class LoaderWidget extends WidgetType {
	static readonly element: HTMLSpanElement = document.createElement("span");

	static {
		this.element.addClasses(["local-gpt-loading", "local-gpt-dots"]);
	}

	toDOM(view: EditorView): HTMLElement {
		return LoaderWidget.element.cloneNode(true) as HTMLElement;
	}
}

class ContentWidget extends WidgetType {
	private dom: HTMLElement | null = null;

	constructor(private text: string) {
		super();
	}

	eq(other: ContentWidget) {
		return other.text === this.text;
	}

	updateText(newText: string) {
		if (this.dom && this.text !== newText) {
			const addedText = newText.slice(this.text.length);

			this.dom.textContent = newText.slice(0, -addedText.length);
			let lastSpan = this.dom.querySelector("span:last-child");
			if (!lastSpan) {
				lastSpan = document.createElement("span");
				this.dom.appendChild(lastSpan);
			}
			lastSpan.textContent = addedText;

			this.text = newText;
		}
	}

	toDOM(view: EditorView): HTMLElement {
		if (!this.dom) {
			this.dom = document.createElement("div");
			this.dom.addClass("local-gpt-content");
			this.updateText(this.text);
		}
		return this.dom;
	}
}

export class SpinnerPlugin implements PluginValue {
	decorations: DecorationSet;
	private positions: Map<
		number,
		{ isEndOfLine: boolean; widget: WidgetType }
	>;

	constructor(private editorView: EditorView) {
		this.positions = new Map();
		this.decorations = Decoration.none;
	}

	show(position: number): () => void {
		const isEndOfLine = this.isPositionAtEndOfLine(
			this.editorView.state,
			position,
		);
		this.positions.set(position, {
			isEndOfLine,
			widget: new LoaderWidget(),
		});
		this.updateDecorations();
		return () => this.hide(position);
	}

	hide(position: number) {
		this.positions.delete(position);
		this.updateDecorations();
	}

	updateContent(text: string, position?: number) {
		let updated = false;
		const updatePosition = (data: { widget: WidgetType }) => {
			if (data.widget instanceof LoaderWidget) {
				data.widget = new ContentWidget(text);
				updated = true;
			} else if (data.widget instanceof ContentWidget) {
				data.widget.updateText(text);
				updated = true;
			}
		};

		if (position !== undefined) {
			const data = this.positions.get(position);
			if (data) updatePosition(data);
		} else {
			this.positions.forEach(updatePosition);
		}

		if (updated) {
			this.updateDecorations();
		}
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) {
			this.updateDecorations();
		}
	}

	private updateDecorations() {
		const builder = new RangeSetBuilder<Decoration>();
		this.positions.forEach((data, position) => {
			builder.add(
				position,
				position,
				Decoration.widget({
					widget: data.widget,
					side: data.isEndOfLine ? 1 : -1,
				}),
			);
		});
		this.decorations = builder.finish();
		this.editorView.requestMeasure();
	}

	private isPositionAtEndOfLine(
		state: EditorState,
		position: number,
	): boolean {
		return position === state.doc.lineAt(position).to;
	}
}

export const spinnerPlugin = ViewPlugin.fromClass(SpinnerPlugin, {
	decorations: (v) => v.decorations,
});
