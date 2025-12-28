import type { ChangeDesc } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type TrackedRange = {
	from: number;
	to: number;
	insertAfter: number;
};

const addTrackedRangeEffect = StateEffect.define<{
	id: string;
	range: TrackedRange;
}>();

const removeTrackedRangeEffect = StateEffect.define<string>();

const mapTrackedRange = (
	range: TrackedRange,
	changes: ChangeDesc,
): TrackedRange => {
	const isEmpty = range.from === range.to;
	const mappedFrom = changes.mapPos(range.from, 1);
	const mappedTo = changes.mapPos(range.to, isEmpty ? 1 : -1);
	const mappedInsertAfter = changes.mapPos(range.insertAfter, 1);
	return mappedFrom <= mappedTo
		? {
				from: mappedFrom,
				to: mappedTo,
				insertAfter: mappedInsertAfter,
			}
		: {
				from: mappedTo,
				to: mappedFrom,
				insertAfter: mappedInsertAfter,
			};
};

const mapTrackedRanges = (
	ranges: Map<string, TrackedRange>,
	changes: ChangeDesc,
): Map<string, TrackedRange> => {
	if (ranges.size === 0) {
		return ranges;
	}
	const next = new Map<string, TrackedRange>();
	ranges.forEach((range, id) => {
		next.set(id, mapTrackedRange(range, changes));
	});
	return next;
};

const applyEffects = (
	current: Map<string, TrackedRange>,
	effects: readonly StateEffect<unknown>[],
): Map<string, TrackedRange> => {
	let next = current;
	for (const effect of effects) {
		if (effect.is(addTrackedRangeEffect)) {
			if (next === current) next = new Map(current);
			next.set(effect.value.id, effect.value.range);
		} else if (effect.is(removeTrackedRangeEffect)) {
			if (next === current) next = new Map(current);
			next.delete(effect.value);
		}
	}
	return next;
};

const trackedRangeField = StateField.define<Map<string, TrackedRange>>({
	create() {
		return new Map();
	},
	update(value, tr) {
		const mapped = tr.docChanged
			? mapTrackedRanges(value, tr.changes)
			: value;
		return applyEffects(mapped, tr.effects);
	},
});

let trackedRangeCounter = 0;

export const requestPositionTracker = trackedRangeField;

export function trackSelectionRange(
	view: EditorView,
	from: number,
	to: number,
): string | null {
	if (!view.state.field(trackedRangeField, false)) {
		return null;
	}
	trackedRangeCounter += 1;
	const id = `local-gpt-range-${trackedRangeCounter}`;
	const range: TrackedRange = { from, to, insertAfter: to };
	view.dispatch({
		effects: addTrackedRangeEffect.of({ id, range }),
	});
	return id;
}

export function getTrackedRange(
	view: EditorView,
	id: string,
): TrackedRange | null {
	return view.state.field(trackedRangeField, false)?.get(id) ?? null;
}

export function releaseTrackedRange(view: EditorView, id: string) {
	if (!view.state.field(trackedRangeField, false)) return;
	view.dispatch({ effects: removeTrackedRangeEffect.of(id) });
}
