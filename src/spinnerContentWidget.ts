import { EditorView, WidgetType } from "@codemirror/view";

export class ContentWidget extends WidgetType {
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
