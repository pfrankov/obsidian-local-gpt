import type { PaletteFileSource } from "./actionPaletteFiles";
import type { ProviderLabelParts } from "./actionPaletteOptions";
import type {
	ReasoningSelection,
	ReasoningPaletteSnapshot,
} from "../interfaces";
import {
	EditorSelection,
	RangeSetBuilder,
	StateEffect,
	StateField,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { I18n } from "../i18n";
import ActionPalette from "./ActionPalette.svelte";
import { endHoldingPromptFocus } from "./actionPaletteDom";

export interface ActionPaletteOptions {
	/** Created on mount and disposed with the widget. */
	createFileSource?: () => PaletteFileSource;
	providerDetails?: ProviderLabelParts;
	getReasoningSnapshot?: () => Promise<ReasoningPaletteSnapshot>;
	includeReasoning?: boolean;
	onSubmit: (
		text: string,
		selectedFiles?: string[],
		systemPrompt?: string,
		reasoningSelection?: ReasoningSelection,
		replaceSelection?: boolean,
	) => void;
	onCancel?: () => void;
	/** Show the replace-selection toggle (palette opened over a selection). */
	canReplaceSelection?: boolean;
	/** Initial state of the replace-selection toggle. */
	replaceSelection?: boolean;
	onReplaceSelectionChange?: (replaceSelection: boolean) => void;
	placeholder?: string;
	/**
	 * Optional label showing currently selected provider/model
	 */
	modelLabel?: string; // kept for backward compat mapping, passed to providerLabel
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
	/**
	 * Function to handle creativity change (palette-only)
	 * Accepts a key: "", "low", "medium", "high"
	 */
	onCreativityChange?: (creativityKey: string) => Promise<void> | void;
	/**
	 * Function to get available system prompts
	 */
	getSystemPrompts?: () => { id: string; name: string; system: string }[];
	selectedSystemPromptId?: string | null;
	onSystemPromptChange?: (
		systemPromptId: string | null,
	) => Promise<void> | void;
	initialSelectedFiles?: string[];
}

class SvelteActionPaletteWidget extends WidgetType {
	private container: HTMLElement | null = null;
	private app: ActionPalette | null = null;
	private fileSource: PaletteFileSource | undefined;

	constructor(private options: ActionPaletteOptions) {
		super();
	}

	/**
	 * Keep the same DOM across decoration rebuilds/maps for *this* widget
	 * instance. Without eq/updateDOM, CM6 replaces the widget (default eq
	 * is false), detaching the focused contenteditable so keys go to the
	 * editor while a caret still looks present in the remounted input.
	 *
	 * Identity-only eq: a second showActionPalette() builds a new widget
	 * and must remount so onSubmit/options from that invocation win.
	 * Class-wide eq + no-op updateDOM reused the first mount's callbacks.
	 *
	 * Do NOT set `editable = true`: that leaves the host inside CM's
	 * contenteditable surface so Svelte DOM mutations are observed as
	 * editor changes and can livelock the renderer. BlockWidgetView already
	 * ignoreMutation()s; the host stays contentEditable=false (CM default)
	 * while the nested palette input remains contenteditable=true.
	 */
	eq(other: WidgetType): boolean {
		return other === this;
	}

	updateDOM(dom: HTMLElement, _view: EditorView): boolean {
		// Only reuse DOM when this instance already owns the live mount.
		// A new Show widget returns false → CM destroys the previous mount
		// (prevWidget.destroy) and calls toDOM() with fresh options.
		return this.container === dom && this.app !== null;
	}

	ignoreEvent(): boolean {
		return true;
	}

	/** Stop the prompt from reclaiming focus (palette is about to close). */
	releasePromptFocus(): void {
		const input = this.container?.querySelector<HTMLElement>(
			".local-gpt-action-palette",
		);
		endHoldingPromptFocus(input ?? null);
	}

	toDOM(_view: EditorView): HTMLElement {
		this.container = document.createElement("div");
		this.container.addClass("local-gpt-action-palette-container");
		const mountTarget = document.createElement("div");
		this.container.appendChild(mountTarget);

		this.fileSource = this.options.createFileSource?.();
		this.app = new ActionPalette({
			target: mountTarget,
			props: {
				placeholder:
					this.options.placeholder ||
					I18n.t("commands.actionPalette.placeholder"),
				providerLabel: this.options.modelLabel || "",
				providerDetails: this.options.providerDetails,
				providerId: this.options.providerId,
				getReasoningSnapshot: this.options.getReasoningSnapshot,
				includeReasoning:
					this.options.includeReasoning !== false &&
					Boolean(this.options.getReasoningSnapshot),
				getFiles: this.fileSource?.getFiles ?? this.options.getFiles,
				getProviders: this.options.getProviders,
				onProviderChange: this.options.onProviderChange,
				getModels: this.options.getModels,
				onModelChange: this.options.onModelChange,
				onCreativityChange: this.options.onCreativityChange,
				getSystemPrompts: this.options.getSystemPrompts,
				selectedSystemPromptId: this.options.selectedSystemPromptId,
				onSystemPromptChange: this.options.onSystemPromptChange,
				initialSelectedFiles: this.options.initialSelectedFiles,
				canReplaceSelection: this.options.canReplaceSelection === true,
				replaceSelection: this.options.replaceSelection === true,
				onReplaceSelectionChange: this.options.onReplaceSelectionChange,
				onSubmit: (event: {
					text: string;
					selectedFiles: string[];
					systemPrompt?: string;
					reasoningSelection?: ReasoningSelection;
					replaceSelection?: boolean;
				}) => {
					this.options.onSubmit?.(
						event.text,
						event.selectedFiles,
						event.systemPrompt,
						event.reasoningSelection,
						event.replaceSelection,
					);
				},
				onCancel: () => {
					this.options.onCancel?.();
				},
			},
		});

		return this.container;
	}

	destroy(_dom: HTMLElement): void {
		this.fileSource?.dispose();
		this.fileSource = undefined;
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
	widget: SvelteActionPaletteWidget | null;
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
	widget: SvelteActionPaletteWidget,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
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
			widget: null,
			fakeSelections: null,
			previousSelectionRanges: null,
			previousCursor: null,
		};
	},
	update(value, tr) {
		let {
			deco,
			pos,
			widget,
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
				// One widget instance per open session so doc maps / height
				// syncs reuse the same DOM (eq + updateDOM) instead of remounting.
				widget = new SvelteActionPaletteWidget(e.value.options);
				deco = buildDecorations(
					pos,
					e.value.options,
					fakeSelections,
					widget,
				);
			} else if (e.is(HideActionPaletteEffect)) {
				pos = null;
				widget = null;
				fakeSelections = null;
				previousSelectionRanges = null;
				previousCursor = null;
				deco = Decoration.none;
			}
		}

		return {
			deco,
			pos,
			widget,
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
	const state = view.state.field(actionPaletteStateField, false);
	// Release the prompt's focus hold first: otherwise view.focus() is
	// reclaimed by the still-mounted palette input (its focusout handler),
	// which is then removed while focused. Focus falls to <body>, the DOM
	// selection collapses to the widget position, and CM later adopts it —
	// the selection is lost and Ctrl+Z goes nowhere until the user clicks.
	state?.widget?.releasePromptFocus();

	// Remove the palette and restore the previous selection/caret (mapped
	// across edits) in one transaction, then give the editor focus.
	let selection: EditorSelection | undefined;
	if (state?.previousSelectionRanges?.length) {
		selection = EditorSelection.create(
			state.previousSelectionRanges.map((r) =>
				EditorSelection.range(r.from, r.to),
			),
		);
	} else if (state && state.previousCursor !== null) {
		selection = EditorSelection.single(state.previousCursor);
	}

	view.dispatch({
		...(selection ? { selection } : {}),
		effects: HideActionPaletteEffect.of(null),
	});
	if (selection) view.focus();
}
