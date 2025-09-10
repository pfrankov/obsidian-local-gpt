import {
	EditorSelection,
	RangeSetBuilder,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	WidgetType,
} from "@codemirror/view";
import ActionPalette from "./ActionPalette.svelte";

export interface ActionPaletteOptions {
	onSubmit: (text: string, selectedFiles?: string[]) => void;
	onCancel?: () => void;
	placeholder?: string;
	/**
	 * Optional label showing currently selected provider/model
	 */
	modelLabel?: string; // kept for backward compatibility mapping, passed to providerLabel
	/**
	 * Function to get available files for selection
	 */
	getFiles?: () => { path: string; basename: string; extension: string }[];
	/**
	 * Function to get available providers for selection
	 */
	getProviders?: () => Promise<
		{
			id: string;
			name: string;
			providerName: string;
			providerUrl?: string;
		}[]
	>;
	/**
	 * Function to handle provider change
	 */
	onProviderChange?: (providerId: string) => Promise<void>;
	/**
	 * Currently selected provider id
	 */
	providerId?: string;
	/**
	 * Function to get models for current provider
	 */
	getModels?: (providerId: string) => Promise<{ id: string; name: string }[]>;
	/**
	 * Function to handle model change
	 */
	onModelChange?: (model: string) => Promise<void>;
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
		this.container.appendChild(mountTarget);

		this.app = new ActionPalette({
			target: mountTarget,
			props: {
				placeholder: this.options.placeholder || "Type…",
				providerLabel: this.options.modelLabel || "",
				providerId: this.options.providerId,
				getFiles: this.options.getFiles,
				getProviders: this.options.getProviders,
				onProviderChange: this.options.onProviderChange,
				getModels: this.options.getModels,
				onModelChange: this.options.onModelChange,
			},
		});

		this.app.$on(
			"submit",
			(e: CustomEvent<{ text: string; selectedFiles: string[] }>) => {
				this.options.onSubmit?.(e.detail.text, e.detail.selectedFiles);
			},
		);
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

type SelectionRange = { from: number; to: number };

const ShowActionPaletteEffect = StateEffect.define<{
	pos: number;
	options: ActionPaletteOptions;
	fakeSelections: SelectionRange[] | null;
	previousSelectionRanges: SelectionRange[] | null;
	previousCursor: number | null;
}>();

const HideActionPaletteEffect = StateEffect.define<null>();

interface SelectionSnapshot {
	fakeSelections: SelectionRange[] | null;
	previousSelectionRanges: SelectionRange[] | null;
	previousCursor: number | null;
}

interface ActionPaletteState extends SelectionSnapshot {
	deco: DecorationSet;
	pos: number | null;
}

function captureSelectionSnapshot(view: EditorView): SelectionSnapshot {
	const rangesAll = view.state.selection.ranges.map((r) => ({
		from: r.from,
		to: r.to,
	}));
	const nonEmpty = rangesAll.filter((r) => r.from !== r.to);
	return {
		fakeSelections: nonEmpty.length ? nonEmpty : null,
		previousSelectionRanges: rangesAll.length ? rangesAll : null,
		previousCursor: view.state.selection.main.head,
	};
}

function mapRanges(
	ranges: SelectionRange[] | null,
	changes: import("@codemirror/state").ChangeDesc,
): SelectionRange[] | null {
	return ranges
		? ranges.map((r) => ({
				from: changes.mapPos(r.from),
				to: changes.mapPos(r.to),
			}))
		: null;
}

function buildDecorations(
	pos: number,
	options: ActionPaletteOptions,
	fakeSelections: SelectionRange[] | null,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const widget = new SvelteActionPaletteWidget(options);
	builder.add(pos, pos, Decoration.widget({ widget, side: -1, block: true }));
	if (fakeSelections) {
		for (const r of fakeSelections) {
			builder.add(
				r.from,
				r.to,
				Decoration.mark({ class: "local-gpt-fake-selection" }),
			);
		}
	}
	return builder.finish();
}

const actionPaletteStateField = StateField.define<ActionPaletteState>({
	create() {
		return {
			deco: Decoration.none,
			pos: null,
			fakeSelections: null,
			previousSelectionRanges: null,
			previousCursor: null,
		};
	},
	update(value, tr) {
		let {
			deco,
			pos,
			fakeSelections,
			previousSelectionRanges,
			previousCursor,
		} = value;

		if (tr.docChanged) {
			deco = deco.map(tr.changes);
			if (pos !== null) pos = tr.changes.mapPos(pos);
			fakeSelections = mapRanges(fakeSelections, tr.changes);
			previousSelectionRanges = mapRanges(
				previousSelectionRanges,
				tr.changes,
			);
			if (previousCursor !== null)
				previousCursor = tr.changes.mapPos(previousCursor);
		}

		for (const e of tr.effects) {
			if (e.is(ShowActionPaletteEffect)) {
				pos = e.value.pos;
				fakeSelections = e.value.fakeSelections;
				previousSelectionRanges = e.value.previousSelectionRanges;
				previousCursor = e.value.previousCursor;
				deco = buildDecorations(pos, e.value.options, fakeSelections);
			} else if (e.is(HideActionPaletteEffect)) {
				pos = null;
				fakeSelections = null;
				previousSelectionRanges = null;
				previousCursor = null;
				deco = Decoration.none;
			}
		}

		return {
			deco,
			pos,
			fakeSelections,
			previousSelectionRanges,
			previousCursor,
		};
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export const actionPalettePlugin = [actionPaletteStateField];

export function showActionPalette(
	view: EditorView,
	pos: number,
	options: ActionPaletteOptions,
) {
	// Capture current selection ranges and cursor before showing
	const { fakeSelections, previousSelectionRanges, previousCursor } =
		captureSelectionSnapshot(view);

	view.dispatch({
		effects: ShowActionPaletteEffect.of({
			pos,
			options,
			fakeSelections,
			previousSelectionRanges,
			previousCursor,
		}),
	});
}

export function hideActionPalette(view: EditorView) {
	// Restore previous selection/caret (mapped across edits). Read from field.
	const state = view.state.field(actionPaletteStateField, false);
	if (state) {
		if (
			state.previousSelectionRanges &&
			state.previousSelectionRanges.length
		) {
			const selection = EditorSelection.create(
				state.previousSelectionRanges.map((r) =>
					EditorSelection.range(r.from, r.to),
				),
			);
			view.dispatch({ selection });
			view.focus();
		} else if (state.previousCursor !== null) {
			view.dispatch({ selection: { anchor: state.previousCursor } });
			view.focus();
		}
	}

	view.dispatch({ effects: HideActionPaletteEffect.of(null) });
}
