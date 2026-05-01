import { RangeSetBuilder, EditorState } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import type { DecorationSet, PluginValue } from "@codemirror/view";
import { ContentWidget } from "./spinnerContentWidget";
import { LoaderWidget, ThinkingStreamWidget } from "./spinnerWidgets";

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
