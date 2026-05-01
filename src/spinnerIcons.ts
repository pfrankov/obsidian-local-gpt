import { getIcon, getIconIds } from "obsidian";

const THINKING_ICON_CANDIDATES = [
	"atom",
	"beaker",
	"book",
	"book-open",
	"bookmark",
	"bot",
	"brain",
	"coffee",
	"compass",
	"flask-conical",
	"lightbulb",
	"map",
	"map-pin",
	"microscope",
	"palette",
	"pen-tool",
	"pencil",
	"sparkles",
	"telescope",
];

let thinkingIconPool: string[] | null = null;

export const resolveThinkingIconPool = () => {
	if (thinkingIconPool) {
		return thinkingIconPool;
	}

	let pool: string[] = [];
	try {
		if (typeof getIconIds === "function") {
			const available = new Set(getIconIds());
			pool = THINKING_ICON_CANDIDATES.filter((icon) =>
				available.has(icon),
			);
		}

		if (typeof getIcon === "function") {
			const candidates = pool.length ? pool : THINKING_ICON_CANDIDATES;
			pool = candidates.filter((icon) => Boolean(getIcon(icon)));
		}
	} catch {
		pool = [];
	}

	if (pool.length) {
		thinkingIconPool = pool;
	}

	return pool;
};

export const ICON_SWITCH_MIN_MS = 1100;
export const ICON_SWITCH_MAX_MS = 2000;
export const ICON_CROSSFADE_MS = 560;
export const ICON_GLINT_DURATION_MS = 280;
