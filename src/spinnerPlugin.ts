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
import { I18n } from "./i18n";

class LoaderWidget extends WidgetType {
	static readonly element: HTMLSpanElement = document.createElement("span");

	static {
		this.element.addClasses(["local-gpt-loading", "local-gpt-dots"]);
	}

	toDOM(view: EditorView): HTMLElement {
		return LoaderWidget.element.cloneNode(true) as HTMLElement;
	}
}

class ThinkingStreamWidget extends WidgetType {
	private dom: HTMLElement | null = null;
	private detailsEl: HTMLDetailsElement | null = null;
	private thinkingEl: HTMLElement | null = null;
	private answerEl: HTMLElement | null = null;
	private scrollRaf: number | null = null;

	constructor(
		private thinkingText: string,
		private answerText: string,
		private isThinking: boolean,
	) {
		super();
	}

	eq(other: ThinkingStreamWidget) {
		return (
			other.thinkingText === this.thinkingText &&
			other.answerText === this.answerText &&
			other.isThinking === this.isThinking
		);
	}

	update(thinkingText: string, answerText: string, isThinking: boolean) {
		const shouldUpdateDom =
			thinkingText !== this.thinkingText ||
			answerText !== this.answerText ||
			isThinking !== this.isThinking;

		this.thinkingText = thinkingText;
		this.answerText = answerText;
		this.isThinking = isThinking;

		if (!this.dom || !shouldUpdateDom) {
			return;
		}

		this.updateHeader();
		this.updateTextBlocks();
	}

	toDOM(view: EditorView): HTMLElement {
		if (!this.dom) {
			this.dom = document.createElement("div");
			this.dom.addClass("local-gpt-thinking-stream");
			this.dom.appendChild(document.createElement("br"));

			const details = document.createElement("details");
			details.addClass("local-gpt-think-details");
			details.open = true;
			this.detailsEl = details;

			const summary = document.createElement("summary");
			summary.addClass("local-gpt-think-summary");

			const titleEl = document.createElement("span");
			titleEl.addClass("local-gpt-think-title");
			const thinkingLabel = I18n.t("thinking.label");
			titleEl.textContent = thinkingLabel;
			titleEl.addClass("local-gpt-thinking");
			summary.appendChild(titleEl);

			details.appendChild(summary);

			const body = document.createElement("div");
			body.addClass("local-gpt-think-body");

			this.thinkingEl = document.createElement("div");
			this.thinkingEl.addClass("local-gpt-think-content");
			this.thinkingEl.setAttribute(
				"data-empty",
				I18n.t("thinking.placeholder"),
			);
			body.appendChild(this.thinkingEl);

			details.appendChild(body);
			this.dom.appendChild(details);

			this.answerEl = document.createElement("div");
			this.answerEl.addClasses([
				"local-gpt-content",
				"local-gpt-think-answer",
			]);
			this.dom.appendChild(this.answerEl);

			this.updateHeader();
			this.updateTextBlocks();
		}
		return this.dom;
	}

	private updateHeader() {
		this.detailsEl?.toggleClass("is-hidden", !this.isThinking);
	}

	private updateTextBlocks() {
		if (this.thinkingEl) {
			this.updateStreamingText(this.thinkingEl, this.thinkingText, true);
		}

		if (this.answerEl) {
			const hasAnswer = Boolean(this.answerText.trim());
			this.answerEl.toggleClass("is-hidden", !hasAnswer);
			if (hasAnswer) {
				this.updateStreamingText(this.answerEl, this.answerText, false);
			}
		}

		this.scheduleScrollToBottom();
	}

	private updateStreamingText(
		target: HTMLElement,
		newText: string,
		animateChunk: boolean,
	) {
		if (!newText) {
			target.textContent = "";
			return;
		}

		const previousText = target.textContent || "";

		if (!newText.startsWith(previousText)) {
			target.textContent = newText;
			return;
		}

		const addedText = newText.slice(previousText.length);
		if (!addedText) {
			target.textContent = newText;
			return;
		}

		target.textContent = newText.slice(
			0,
			newText.length - addedText.length,
		);

		if (!animateChunk) {
			target.appendChild(document.createTextNode(addedText));
			return;
		}

		const span = document.createElement("span");
		span.addClass("local-gpt-stream-chunk");
		span.textContent = addedText;
		target.appendChild(span);
	}

	private scheduleScrollToBottom() {
		if (!this.thinkingEl || this.scrollRaf !== null) {
			return;
		}

		this.scrollRaf = requestAnimationFrame(() => {
			this.scrollRaf = null;
			if (!this.thinkingEl) {
				return;
			}

			const maxScrollTop =
				this.thinkingEl.scrollHeight - this.thinkingEl.clientHeight;
			const isOverflowing = maxScrollTop > 1;
			this.thinkingEl.toggleClass("is-overflowing", isOverflowing);
			if (!isOverflowing) {
				this.thinkingEl.scrollTop = 0;
				return;
			}

			this.thinkingEl.scrollTop = maxScrollTop;
		});
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

/**
 * Processed result of handling text with thinking tags
 */
interface ProcessedThinkingResult {
	// Whether there is a <think> tag at the start
	hasThinkingTags: boolean;

	// Whether we're in thinking mode
	isThinking: boolean;

	// Raw content inside <think>...</think>
	thinkingText: string;

	// The text to display (without thinking content)
	displayText: string;
}

export class SpinnerPlugin implements PluginValue {
	decorations: DecorationSet;
	private entries: Map<
		string,
		{ position: number; isEndOfLine: boolean; widget: WidgetType }
	>;
	private positionToId: Map<number, string>;
	private idCounter = 0;

	constructor(private editorView: EditorView) {
		this.entries = new Map();
		this.positionToId = new Map();
		this.decorations = Decoration.none;
	}

	/**
	 * Process text with potential <think> tags and update UI accordingly
	 *
	 * @param text Raw text that may include <think> tags
	 * @param processFunc Optional function to process the display text
	 * @param position Optional position to update specific spinner
	 * @returns void
	 */
	processText(
		text: string,
		processFunc?: (text: string) => string,
		position?: number,
	) {
		const result = this.processThinkingTags(text);

		if (result.hasThinkingTags) {
			const displayText = result.displayText.trim()
				? processFunc
					? processFunc(result.displayText)
					: result.displayText
				: "";

			this.updateThinkingStream(
				result.thinkingText,
				displayText,
				result.isThinking,
				position,
			);
			return;
		}

		if (result.displayText.trim()) {
			const displayText = processFunc
				? processFunc(result.displayText)
				: result.displayText;
			this.updateContent(displayText, position);
		}
	}

	/**
	 * Process text with potential <think> tags
	 *
	 * @param text Raw text that may contain <think> tags
	 * @returns Object with parsed thinking state and display text
	 */
	private processThinkingTags(text: string): ProcessedThinkingResult {
		// Simple case - no thinking tags at all
		if (!text.startsWith("<think>")) {
			return {
				hasThinkingTags: false,
				isThinking: false,
				thinkingText: "",
				displayText: text,
			};
		}

		// Check if we have a complete thinking tag
		const thinkingMatch = text.match(
			/^<think>([\s\S]*?)(<\/think>\s*([\s\S]*))?$/,
		);

		if (!thinkingMatch) {
			return {
				hasThinkingTags: true,
				isThinking: true,
				thinkingText: text.slice("<think>".length),
				displayText: "", // No display text while in thinking mode
			};
		}

		const thinkingText = thinkingMatch[1] || "";

		// If we have a closing tag, extract content after it
		if (thinkingMatch[2]) {
			const afterThinkTag = thinkingMatch[3] || "";
			return {
				hasThinkingTags: true,
				isThinking: false,
				thinkingText,
				displayText: afterThinkTag,
			};
		}

		// Open thinking tag without a closing tag
		return {
			hasThinkingTags: true,
			isThinking: true,
			thinkingText,
			displayText: "", // No display text while in thinking mode
		};
	}

	show(position: number): () => void {
		const isEndOfLine = this.isPositionAtEndOfLine(
			this.editorView.state,
			position,
		);
		const id = `spinner-${++this.idCounter}`;
		this.entries.set(id, {
			position,
			isEndOfLine,
			widget: new LoaderWidget(),
		});
		this.positionToId.set(position, id);
		this.updateDecorations();
		return () => this.hide(id);
	}

	hide(id: string) {
		const entry = this.entries.get(id);
		if (entry) {
			this.positionToId.delete(entry.position);
			this.entries.delete(id);
			this.updateDecorations();
		}
	}

	private updateThinkingStream(
		thinkingText: string,
		answerText: string,
		isThinking: boolean,
		originalPosition?: number,
	) {
		let updated = false;

		const updateEntry = (data: { widget: WidgetType }) => {
			if (data.widget instanceof ThinkingStreamWidget) {
				data.widget.update(thinkingText, answerText, isThinking);
				updated = true;
				return;
			}

			data.widget = new ThinkingStreamWidget(
				thinkingText,
				answerText,
				isThinking,
			);
			updated = true;
		};

		if (originalPosition !== undefined) {
			const id = this.positionToId.get(originalPosition);
			const data = id ? this.entries.get(id) : undefined;
			if (data) updateEntry(data);
		} else {
			this.entries.forEach(updateEntry);
		}

		if (updated) {
			this.updateDecorations();
		}
	}

	updateContent(text: string, originalPosition?: number) {
		let updated = false;
		const updateEntry = (data: { widget: WidgetType }) => {
			if (data.widget instanceof LoaderWidget) {
				data.widget = new ContentWidget(text);
				updated = true;
			} else if (data.widget instanceof ContentWidget) {
				data.widget.updateText(text);
				updated = true;
			}
		};

		if (originalPosition !== undefined) {
			const id = this.positionToId.get(originalPosition);
			const data = id ? this.entries.get(id) : undefined;
			if (data) updateEntry(data);
		} else {
			this.entries.forEach(updateEntry);
		}

		if (updated) {
			this.updateDecorations();
		}
	}

	update(update: ViewUpdate) {
		if (update.docChanged) {
			this.entries.forEach((data) => {
				data.position = update.changes.mapPos(data.position);
				data.isEndOfLine = this.isPositionAtEndOfLine(
					update.state,
					data.position,
				);
			});
		}

		if (update.docChanged || update.viewportChanged) {
			this.updateDecorations();
		}
	}

	private updateDecorations() {
		const builder = new RangeSetBuilder<Decoration>();
		const sorted = [...this.entries.values()].sort(
			(a, b) => a.position - b.position,
		);
		for (const data of sorted) {
			builder.add(
				data.position,
				data.position,
				Decoration.widget({
					widget: data.widget,
					side: data.isEndOfLine ? 1 : -1,
				}),
			);
		}
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
