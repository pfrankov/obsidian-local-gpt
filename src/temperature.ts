import { CREATIVITY } from "./defaultSettings";
import type { LocalGPTSettings } from "./interfaces";

export function resolveTemperature(
	settings: LocalGPTSettings,
	override?: number | null,
): number | undefined {
	if (override === null) return undefined;
	const value =
		override ??
		CREATIVITY[settings.defaults?.creativity ?? "default"]?.temperature;
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}
