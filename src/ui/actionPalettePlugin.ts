import { EditorSelection, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import ActionPalette from "./ActionPalette.svelte";

export interface ActionPaletteOptions {
	onSubmit: (text: string) => void;
	onCancel?: () => void;
	placeholder?: string;
	/**
	 * Optional label showing currently selected provider/model
	 */
	modelLabel?: string;
}

class SvelteActionPaletteWidget extends WidgetType {
	private container: HTMLElement | null = null;
	private app: ActionPalette | null = null;

	constructor(private options: ActionPaletteOptions) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		this.container = document.createElement("div");
		this.container.addClass("local-gpt-action-palette-container");
		const mountTarget = document.createElement("div");
		mountTarget.style.width = "100%";
		this.container.appendChild(mountTarget);

		this.app = new ActionPalette({
			target: mountTarget,
			props: {
				placeholder: this.options.placeholder || "Type…",
				modelLabel: this.options.modelLabel || "",
			},
		});

		this.app.$on("submit", (e: CustomEvent<string>) => {
			this.options.onSubmit?.(e.detail);
		});
		this.app.$on("cancel", () => {
			this.options.onCancel?.();
		});

		return this.container;
	}

	destroy(dom: HTMLElement): void {
		this.app?.$destroy();
		this.app = null;
		this.container = null;
	}
}

class ActionPalettePlugin implements PluginValue {
	decorations = Decoration.none;
	private widgetPos: number | null = null;
	private widget: SvelteActionPaletteWidget | null = null;
	private fakeSelections: { from: number; to: number }[] | null = null;
	private previousSelectionRanges: { from: number; to: number }[] | null =
		null;
	private previousCursor: number | null = null;

	constructor(private view: EditorView) {}

	update(update: ViewUpdate): void {
		if (update.docChanged && this.fakeSelections) {
			this.fakeSelections = this.fakeSelections.map((r) => ({
				from: update.changes.mapPos(r.from),
				to: update.changes.mapPos(r.to),
			}));
		}
		if (update.docChanged && this.previousSelectionRanges) {
			this.previousSelectionRanges = this.previousSelectionRanges.map(
				(r) => ({
					from: update.changes.mapPos(r.from),
					to: update.changes.mapPos(r.to),
				}),
			);
		}
		if (update.docChanged && this.previousCursor !== null) {
			this.previousCursor = update.changes.mapPos(this.previousCursor);
		}
		if (update.docChanged || update.viewportChanged) {
			this.rebuildDecorations();
		}
	}

	showAt(pos: number, options: ActionPaletteOptions) {
		this.widgetPos = pos;
		this.widget = new SvelteActionPaletteWidget(options);
		// Capture current selection ranges (both for rendering and accurate restore)
		const rangesAll = this.view.state.selection.ranges.map((r) => ({
			from: r.from,
			to: r.to,
		}));
		const nonEmpty = rangesAll.filter((r) => r.from !== r.to);
		this.fakeSelections = nonEmpty.length ? nonEmpty : null;
		this.previousSelectionRanges = rangesAll.length ? rangesAll : null;
		this.previousCursor = this.view.state.selection.main.head;
		this.rebuildDecorations();
	}

	hide() {
		// Restore previous selection/caret (mapped across edits)
		if (
			this.previousSelectionRanges &&
			this.previousSelectionRanges.length
		) {
			const selection = EditorSelection.create(
				this.previousSelectionRanges.map((r) =>
					EditorSelection.range(r.from, r.to),
				),
			);
			this.view.dispatch({ selection });
			this.view.focus();
		} else if (this.previousCursor !== null) {
			this.view.dispatch({ selection: { anchor: this.previousCursor } });
			this.view.focus();
		}
		this.widgetPos = null;
		this.widget = null;
		this.fakeSelections = null;
		this.previousSelectionRanges = null;
		this.previousCursor = null;
		this.rebuildDecorations();
	}

	private rebuildDecorations() {
		const builder = new RangeSetBuilder<Decoration>();
		if (this.widgetPos !== null && this.widget) {
			builder.add(
				this.widgetPos,
				this.widgetPos,
				Decoration.widget({ widget: this.widget, side: -1 }),
			);
		}
		if (this.fakeSelections) {
			for (const r of this.fakeSelections) {
				builder.add(
					r.from,
					r.to,
					Decoration.mark({ class: "local-gpt-fake-selection" }),
				);
			}
		}
		this.decorations = builder.finish();
	}
}

export const actionPalettePlugin = ViewPlugin.fromClass(ActionPalettePlugin, {
	decorations: (v) => v.decorations,
});

export function showActionPalette(
	view: EditorView,
	pos: number,
	options: ActionPaletteOptions,
) {
	const plugin = view.plugin(
		actionPalettePlugin as unknown as ViewPlugin<ActionPalettePlugin>,
	) as ActionPalettePlugin | null;
	if (!plugin) return;
	plugin.showAt(pos, options);
}

export function hideActionPalette(view: EditorView) {
	const plugin = view.plugin(
		actionPalettePlugin as unknown as ViewPlugin<ActionPalettePlugin>,
	) as ActionPalettePlugin | null;
	if (!plugin) return;
	plugin.hide();
}
