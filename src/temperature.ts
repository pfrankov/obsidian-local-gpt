import { CREATIVITY } from "./defaultSettings";
import type { LocalGPTSettings } from "./interfaces";

/** UI / runtime key for "omit temperature" (API default). Never persist this in `defaults.creativity`. */
export const API_DEFAULT_CREATIVITY_KEY = "default";

/** Values old Local GPT (main) understands in `defaults.creativity`. */
export const LEGACY_CREATIVITY_VALUES = ["", "low", "medium", "high"] as const;

/** Old Local GPT DEFAULT_SETTINGS.defaults.creativity — safe fallback when storing API default. */
export const LEGACY_FALLBACK_CREATIVITY = "low";

export type LegacyCreativityValue = (typeof LEGACY_CREATIVITY_VALUES)[number];

export function isLegacyCreativityValue(
	value: string | undefined | null,
): value is LegacyCreativityValue {
	return (
		value === "" ||
		value === "low" ||
		value === "medium" ||
		value === "high"
	);
}

/**
 * Effective creativity key for UI / palette (includes "default").
 * `omitTemperature` or legacy-stored `"default"` both map to API default.
 */
export function getEffectiveCreativityKey(
	settings: Pick<LocalGPTSettings, "defaults">,
): string {
	if (settings.defaults?.omitTemperature) {
		return API_DEFAULT_CREATIVITY_KEY;
	}
	const stored = settings.defaults?.creativity;
	if (stored === API_DEFAULT_CREATIVITY_KEY) {
		return API_DEFAULT_CREATIVITY_KEY;
	}
	if (stored !== undefined) {
		return stored;
	}
	return API_DEFAULT_CREATIVITY_KEY;
}

/**
 * Persist a creativity UI key in a form old Local GPT can read:
 * - API default → `omitTemperature: true` + legacy `creativity: "low"` (or keep existing legacy value)
 * - "", low, medium, high → clear `omitTemperature`, set `creativity`
 */
export function applyCreativityKey(
	settings: LocalGPTSettings,
	key: string,
): void {
	if (!settings.defaults) {
		settings.defaults = {};
	}
	if (key === API_DEFAULT_CREATIVITY_KEY) {
		settings.defaults.omitTemperature = true;
		if (!isLegacyCreativityValue(settings.defaults.creativity)) {
			settings.defaults.creativity = LEGACY_FALLBACK_CREATIVITY;
		}
		return;
	}
	delete settings.defaults.omitTemperature;
	settings.defaults.creativity = key;
}

/**
 * Rewrite `creativity: "default"` (and incomplete dual-field state) into the
 * legacy-safe shape. Idempotent; safe to run on every load.
 */
export function normalizeCreativityForLegacy(
	settings: LocalGPTSettings,
): boolean {
	if (!settings.defaults) {
		settings.defaults = {};
	}
	const defaults = settings.defaults;
	let changed = false;

	if (defaults.creativity === API_DEFAULT_CREATIVITY_KEY) {
		defaults.omitTemperature = true;
		defaults.creativity = LEGACY_FALLBACK_CREATIVITY;
		changed = true;
	}

	if (
		defaults.omitTemperature &&
		!isLegacyCreativityValue(defaults.creativity)
	) {
		defaults.creativity = LEGACY_FALLBACK_CREATIVITY;
		changed = true;
	}

	return changed;
}

export function resolveTemperature(
	settings: LocalGPTSettings,
	override?: number | null,
): number | undefined {
	if (override === null) return undefined;
	if (override !== undefined) {
		return typeof override === "number" && Number.isFinite(override)
			? override
			: undefined;
	}
	if (
		settings.defaults?.omitTemperature ||
		settings.defaults?.creativity === API_DEFAULT_CREATIVITY_KEY
	) {
		return undefined;
	}
	const value =
		CREATIVITY[settings.defaults?.creativity ?? API_DEFAULT_CREATIVITY_KEY]
			?.temperature;
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}
