// --- START OF FILE spinnerPlugin.ts ---

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
import { logger } from "./logger";
import { setIcon } from "obsidian"; // Import setIcon for creating icons

// --- Widget Types ---

// Represents the "Generating..." state
class GeneratingWidget extends WidgetType {
	private dom: HTMLElement | null = null;

	toDOM(view: EditorView): HTMLElement {
		if (!this.dom) {
			this.dom = document.createElement("div");
			this.dom.addClass("local-gpt-generating-container");
			this.dom.appendChild(document.createElement("br")); // Line break for positioning
			const innerContainer = this.dom.createSpan({ cls: "local-gpt-generating-inner" });
			const iconEl = innerContainer.createSpan({ cls: "local-gpt-generating-icon" });
			setIcon(iconEl, "loader"); // Obsidian's built-in loader icon
			innerContainer.createSpan({
				cls: "local-gpt-generating-text",
				text: "Generating",
				attr: { "data-text": "Generating" }
			});
		}
		return this.dom;
	}
}

// Represents the "Thinking..." state
class ThinkingWidget extends WidgetType {
	private dom: HTMLElement | null = null;

	toDOM(view: EditorView): HTMLElement {
		if (!this.dom) {
			this.dom = document.createElement("div");
			this.dom.addClass("local-gpt-thinking-container");
			this.dom.appendChild(document.createElement("br")); // Line break for positioning
			const innerContainer = this.dom.createSpan({ cls: "local-gpt-thinking-inner" });
			innerContainer.createSpan({ cls: "local-gpt-thinking-icon", text: "🧠" });
			innerContainer.createSpan({
				cls: "local-gpt-thinking-text",
				text: "Thinking",
				attr: { "data-text": "Thinking" }
			});
		}
		return this.dom;
	}
}

// Represents the streaming content display
class ContentWidget extends WidgetType {
	private dom: HTMLElement | null = null;
	public currentText = "";

	constructor(initialText: string) {
		super();
		this.currentText = initialText;
	}

	eq(other: ContentWidget): boolean {
		return other.currentText === this.currentText;
	}

	updateText(newText: string, view: EditorView) {
		if (this.currentText === newText) return;
		this.currentText = newText;
		if (this.dom) {
			this.dom.textContent = this.currentText;
			this.dom.classList.remove("local-gpt-streaming-animate");
			void this.dom.offsetWidth; // Force reflow
			this.dom.classList.add("local-gpt-streaming-animate");
		}
	}

	toDOM(view: EditorView): HTMLElement {
		if (!this.dom) {
			this.dom = document.createElement("div");
			this.dom.classList.add("local-gpt-content");
			this.dom.setAttribute("role", "document");
			this.dom.textContent = this.currentText;
			this.dom.classList.add("local-gpt-streaming-animate");
		}
		return this.dom;
	}
}

// --- Plugin Logic ---
interface SpinnerPositionInfo {
	widget: WidgetType;
	isEndOfLine: boolean;
	isThinking: boolean;
}

export class SpinnerPlugin implements PluginValue {
	decorations: DecorationSet;
	private positions: Map<number, SpinnerPositionInfo>;

	constructor(private editorView: EditorView) {
		this.positions = new Map();
		this.decorations = Decoration.none;
		logger.debug("SpinnerPlugin initialized.");
	}

	show(position: number): () => void {
		if (this.positions.has(position)) {
			logger.warn(`Spinner already exists at position ${position}.`);
			return () => { };
		}
		const isEndOfLine = this.isPositionAtEndOfLine(this.editorView.state, position);
		this.positions.set(position, {
			widget: new GeneratingWidget(),
			isEndOfLine,
			isThinking: false,
		});
		logger.debug(`Showing spinner (Generating...) at position ${position}`);
		this.updateDecorations(true); // Force update
		return () => this.hide(position);
	}

	hide(position: number) {
		if (this.positions.has(position)) {
			logger.debug(`Hiding spinner at position ${position}`);
			this.positions.delete(position);
			this.updateDecorations(true); // Force update
		} else {
			logger.warn(`Attempted to hide spinner at position ${position}, but none found.`);
		}
	}

	showThinking(enabled: boolean, position?: number) {
		let updated = false;
		const updateEntry = (data: SpinnerPositionInfo, pos: number) => {
			if (!(data.widget instanceof ContentWidget)) {
				if (enabled && !data.isThinking) {
					data.widget = new ThinkingWidget();
					data.isThinking = true;
					updated = true;
				} else if (!enabled && data.isThinking) {
					data.widget = new GeneratingWidget();
					data.isThinking = false;
					updated = true;
				}
			} else {
				if (data.isThinking !== enabled) {
					data.isThinking = enabled;
				}
			}
		};

		if (position !== undefined) {
			const data = this.positions.get(position);
			if (data) updateEntry(data, position);
			else logger.warn(`showThinking called for unknown position ${position}`);
		} else {
			this.positions.forEach(updateEntry);
		}

		if (updated) {
			logger.debug(`Updating thinking state display: ${enabled}`);
			this.updateDecorations(true);
		}
	}

	updateContent(text: string, position?: number) {
		let widgetChanged = false;
		let contentChanged = false;
		const updateEntry = (data: SpinnerPositionInfo, pos: number) => {
			if (!(data.widget instanceof ContentWidget)) {
				data.widget = new ContentWidget(text);
				data.isThinking = false;
				widgetChanged = true;
				contentChanged = true;
			} else {
				const tempWidget = new ContentWidget(text);
				if (!data.widget.eq(tempWidget)) {
					data.widget.updateText(text, this.editorView);
					contentChanged = true;
				}
			}
		};

		if (position !== undefined) {
			const data = this.positions.get(position);
			if (data) updateEntry(data, position);
			else logger.warn(`updateContent called for unknown position ${position}`);
		} else {
			this.positions.forEach(updateEntry);
		}

		if (widgetChanged || contentChanged) {
			this.updateDecorations(widgetChanged || contentChanged);
		}
	}

	update(update: ViewUpdate) {
		// Only update decorations if necessary
		let needsRedraw = false;
		if (update.docChanged) {
			const updatedPositions = new Map<number, SpinnerPositionInfo>();
			this.positions.forEach((data, oldPos) => {
				const newPos = update.changes.mapPos(oldPos, -1, 1);
				if (newPos !== null) {
					updatedPositions.set(newPos, data);
				} else {
					logger.debug(`Spinner position ${oldPos} deleted due to document changes.`);
					needsRedraw = true; // Need redraw if positions removed
				}
			});
			// Check if positions actually changed after mapping
			if (updatedPositions.size !== this.positions.size || ![...updatedPositions.keys()].every(key => this.positions.has(key))) {
				needsRedraw = true;
			}
			this.positions = updatedPositions;
		}

		if (update.viewportChanged) {
			needsRedraw = true;
		}

		if (this.positions.size === 0 && this.decorations.size > 0) {
			needsRedraw = true; // Need redraw to clear decorations
		}

		if (needsRedraw) {
			this.updateDecorations(); // Let updateDecorations decide if measure needed
		}
	}

	private updateDecorations(force = false) {
		const builder = new RangeSetBuilder<Decoration>();
		this.positions.forEach((data, position) => {
			builder.add(
				position,
				position,
				Decoration.widget({
					widget: data.widget,
					side: data.isEndOfLine ? 1 : -1,
					block: !(data.widget instanceof GeneratingWidget)
				}),
			);
		});
		const newDecorations = builder.finish();

		// *** WORKAROUND: Compare sizes as a proxy for equality check ***
		// This avoids the problematic `eq` call but might redraw slightly more often.
		const changed = this.decorations.size !== newDecorations.size ||
						(this.decorations.size > 0 && newDecorations.size === 0) ||
						(this.decorations.size === 0 && newDecorations.size > 0);

		if (force || changed) {
			this.decorations = newDecorations;
			// Only request measure if decorations actually changed or forced
			this.editorView.requestMeasure();
		}
	}

	private isPositionAtEndOfLine(state: EditorState, position: number): boolean {
		try {
			const clampedPos = Math.max(0, Math.min(position, state.doc.length));
			return clampedPos === state.doc.lineAt(clampedPos).to;
		} catch (e) {
			logger.error(`Error checking endOfLine for pos ${position}:`, e);
			return false;
		}
	}

	destroy() {
		logger.debug("SpinnerPlugin destroyed.");
		this.positions.clear();
		this.decorations = Decoration.none;
	}
}

// --- Export Plugin ---
export const spinnerPlugin = ViewPlugin.fromClass(SpinnerPlugin, {
	decorations: (v: SpinnerPlugin) => v.decorations,
});

// --- END OF FILE spinnerPlugin.ts ---