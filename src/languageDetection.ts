/**
 * Script-based languages detected by Unicode ranges.
 * Note: "ru" represents Cyrillic script, which is used by multiple languages
 * (Russian, Ukrainian, Bulgarian, Serbian, etc.). The code identifies the script,
 * not the specific language.
 */
type ScriptLanguage = "ja" | "zh" | "ko" | "ru" | "ar" | "he" | "el" | "hi";
type LatinLanguage = "en" | "de" | "fr" | "es" | "pt" | "id";
type LanguageCode = ScriptLanguage | LatinLanguage | "unknown";
type CodeRange = readonly [number, number];

/** Maximum characters to analyze for performance optimization */
const MAX_ANALYSIS_LENGTH = 1000;

/** Minimum letter count required for Latin language detection (prevents guessing on short text) */
const MIN_LATIN_LETTERS_THRESHOLD = 10;

const SCRIPT_RANGES: Record<ScriptLanguage, CodeRange[]> = {
	ja: [
		[0x3040, 0x309f], // Hiragana
		[0x30a0, 0x30ff], // Katakana
		[0x31f0, 0x31ff], // Katakana Phonetic Extensions
		[0xff65, 0xff9f], // Halfwidth Katakana
	],
	zh: [
		[0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
		[0x4e00, 0x9fff], // CJK Unified Ideographs
	],
	ko: [
		[0x1100, 0x11ff], // Hangul Jamo
		[0x3130, 0x318f], // Hangul Compatibility Jamo
		[0xac00, 0xd7af], // Hangul Syllables
	],
	ru: [
		[0x0400, 0x04ff], // Cyrillic
		[0x0500, 0x052f], // Cyrillic Supplement
		[0x2de0, 0x2dff], // Cyrillic Extended-A
		[0xa640, 0xa69f], // Cyrillic Extended-B
	],
	ar: [
		[0x0600, 0x06ff], // Arabic
		[0x0750, 0x077f], // Arabic Supplement
		[0x08a0, 0x08ff], // Arabic Extended-A
	],
	he: [[0x0590, 0x05ff]], // Hebrew
	el: [
		[0x0370, 0x03ff], // Greek and Coptic
		[0x1f00, 0x1fff], // Greek Extended
	],
	hi: [[0x0900, 0x097f]], // Devanagari
};

const LATIN_RANGES: CodeRange[] = [
	[0x0041, 0x005a], // Basic Latin uppercase
	[0x0061, 0x007a], // Basic Latin lowercase
	[0x00c0, 0x024f], // Latin-1 Supplement + Extended-A/B
	[0x1e00, 0x1eff], // Latin Extended Additional
];

const SCRIPT_KEYS: ScriptLanguage[] = [
	"ja",
	"zh",
	"ko",
	"ru",
	"ar",
	"he",
	"el",
	"hi",
];

const LATIN_KEYS: LatinLanguage[] = ["en", "de", "fr", "es", "pt", "id"];

const WORD_WEIGHT = 2;
const CHAR_WEIGHT = 3;

const LATIN_LANGUAGE_PROFILES: Record<
	LatinLanguage,
	{ words: readonly string[]; chars: readonly string[] }
> = {
	en: {
		words: [
			"the",
			"and",
			"you",
			"that",
			"with",
			"this",
			"from",
			"your",
			"have",
			"will",
			"can",
			"hello",
			"world",
		],
		chars: [],
	},
	de: {
		words: [
			"der",
			"die",
			"das",
			"und",
			"ist",
			"nicht",
			"mit",
			"auf",
			"f\u00fcr",
			"eine",
			"ein",
			"ich",
			"sie",
		],
		chars: ["\u00df", "\u00e4", "\u00f6", "\u00fc"],
	},
	fr: {
		words: [
			"le",
			"la",
			"les",
			"des",
			"est",
			"une",
			"un",
			"pour",
			"que",
			"dans",
			"avec",
			"pas",
			"vous",
			"sur",
			"ce",
		],
		chars: [
			"\u0153",
			"\u00e6",
			"\u00e7",
			"\u00e9",
			"\u00e8",
			"\u00ea",
			"\u00eb",
			"\u00e0",
			"\u00e2",
			"\u00ee",
			"\u00ef",
			"\u00f4",
			"\u00f9",
			"\u00fb",
			"\u00fc",
			"\u00ff",
		],
	},
	es: {
		words: [
			"el",
			"la",
			"los",
			"las",
			"que",
			"para",
			"con",
			"una",
			"un",
			"por",
			"pero",
			"como",
			"muy",
			"estas",
			"est\u00e1s",
		],
		chars: [
			"\u00f1",
			"\u00e1",
			"\u00e9",
			"\u00ed",
			"\u00f3",
			"\u00fa",
			"\u00fc",
			"\u00bf",
			"\u00a1",
		],
	},
	pt: {
		words: [
			"o",
			"a",
			"os",
			"as",
			"que",
			"para",
			"com",
			"uma",
			"um",
			"n\u00e3o",
			"por",
			"mais",
			"como",
			"estou",
			"est\u00e1",
			"de",
			"e",
		],
		chars: [
			"\u00e3",
			"\u00f5",
			"\u00e7",
			"\u00e1",
			"\u00e0",
			"\u00e2",
			"\u00ea",
			"\u00ed",
			"\u00f3",
			"\u00f4",
			"\u00fa",
			"\u00fc",
		],
	},
	id: {
		words: [
			"yang",
			"dan",
			"tidak",
			"saya",
			"kamu",
			"ini",
			"itu",
			"untuk",
			"dengan",
			"ada",
			"dari",
			"di",
			"ke",
			"apa",
			"bagaimana",
			"bisa",
			"terjadi",
			"tahu",
		],
		chars: [],
	},
};

const LATIN_WORD_SETS: Record<LatinLanguage, Set<string>> = {
	en: new Set(LATIN_LANGUAGE_PROFILES.en.words),
	de: new Set(LATIN_LANGUAGE_PROFILES.de.words),
	fr: new Set(LATIN_LANGUAGE_PROFILES.fr.words),
	es: new Set(LATIN_LANGUAGE_PROFILES.es.words),
	pt: new Set(LATIN_LANGUAGE_PROFILES.pt.words),
	id: new Set(LATIN_LANGUAGE_PROFILES.id.words),
};

const LATIN_CHAR_SETS: Record<LatinLanguage, Set<string>> = {
	en: new Set(LATIN_LANGUAGE_PROFILES.en.chars),
	de: new Set(LATIN_LANGUAGE_PROFILES.de.chars),
	fr: new Set(LATIN_LANGUAGE_PROFILES.fr.chars),
	es: new Set(LATIN_LANGUAGE_PROFILES.es.chars),
	pt: new Set(LATIN_LANGUAGE_PROFILES.pt.chars),
	id: new Set(LATIN_LANGUAGE_PROFILES.id.chars),
};

const isCodeInRanges = (code: number, ranges: CodeRange[]): boolean => {
	for (const [start, end] of ranges) {
		if (code >= start && code <= end) {
			return true;
		}
	}
	return false;
};

const detectScriptForCodePoint = (code: number): ScriptLanguage | null => {
	for (const key of SCRIPT_KEYS) {
		if (isCodeInRanges(code, SCRIPT_RANGES[key])) {
			return key;
		}
	}
	return null;
};

const isLatinCodePoint = (code: number): boolean =>
	isCodeInRanges(code, LATIN_RANGES);

const mergeJapaneseHan = (counts: Record<ScriptLanguage, number>) => {
	if (counts.ja > 0 && counts.zh > 0) {
		counts.ja += counts.zh;
		counts.zh = 0;
	}
};

const pickDominantLanguage = <T extends string>(
	counts: Record<T, number>,
	keys: readonly T[],
): T | "unknown" => {
	let topLanguage: T | "unknown" = "unknown";
	let topCount = 0;
	let isTie = false;

	for (const key of keys) {
		const count = counts[key];
		if (count > topCount) {
			topLanguage = key;
			topCount = count;
			isTie = false;
		} else if (count === topCount && count > 0) {
			isTie = true;
		}
	}

	if (topCount === 0 || isTie) {
		return "unknown";
	}

	return topLanguage;
};

const sumCounts = (counts: Record<string, number>): number =>
	Object.values(counts).reduce((total, value) => total + value, 0);

const extractWords = (text: string): string[] => text.match(/\p{L}+/gu) ?? [];

const countOccurrences = (values: Iterable<string>): Map<string, number> => {
	const counts = new Map<string, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
};

const scoreLatinLanguages = (
	charCounts: Map<string, number>,
	wordCounts: Map<string, number>,
): Record<LatinLanguage, number> => {
	const scores: Record<LatinLanguage, number> = {
		en: 0,
		de: 0,
		fr: 0,
		es: 0,
		pt: 0,
		id: 0,
	};

	for (const language of LATIN_KEYS) {
		const charSet = LATIN_CHAR_SETS[language];
		for (const char of charSet) {
			scores[language] += (charCounts.get(char) ?? 0) * CHAR_WEIGHT;
		}

		const wordSet = LATIN_WORD_SETS[language];
		for (const word of wordSet) {
			scores[language] += (wordCounts.get(word) ?? 0) * WORD_WEIGHT;
		}
	}

	return scores;
};

const countScriptAndLatinLetters = (text: string) => {
	const scriptCounts: Record<ScriptLanguage, number> = {
		ja: 0,
		zh: 0,
		ko: 0,
		ru: 0,
		ar: 0,
		he: 0,
		el: 0,
		hi: 0,
	};
	let latinLetterCount = 0;

	for (const char of text) {
		const code = char.codePointAt(0);
		if (!code) {
			continue;
		}

		const scriptLanguage = detectScriptForCodePoint(code);
		if (scriptLanguage) {
			scriptCounts[scriptLanguage] += 1;
			continue;
		}

		if (isLatinCodePoint(code)) {
			latinLetterCount += 1;
		}
	}

	return { scriptCounts, latinLetterCount };
};

export const detectDominantLanguage = (text: string): LanguageCode => {
	// Limit analysis to first N characters for performance
	const truncated =
		text.length > MAX_ANALYSIS_LENGTH
			? text.slice(0, MAX_ANALYSIS_LENGTH)
			: text;
	const normalized = truncated.normalize("NFC");
	const { scriptCounts, latinLetterCount } =
		countScriptAndLatinLetters(normalized);

	mergeJapaneseHan(scriptCounts);
	const dominantScript = pickDominantLanguage(scriptCounts, SCRIPT_KEYS);
	const scriptLetterCount = sumCounts(scriptCounts);

	if (dominantScript !== "unknown" && scriptLetterCount >= latinLetterCount) {
		return dominantScript;
	}

	const lowerText = normalized.toLowerCase();
	const words = extractWords(lowerText);
	const charCounts = countOccurrences(lowerText);
	const wordCounts = countOccurrences(words);
	const latinScores = scoreLatinLanguages(charCounts, wordCounts);
	const dominantLatin = pickDominantLanguage(latinScores, LATIN_KEYS);

	if (dominantLatin !== "unknown") {
		return dominantLatin;
	}

	// Only default to English if there's enough text to be confident
	if (latinLetterCount >= MIN_LATIN_LETTERS_THRESHOLD) {
		return "en";
	}

	return "unknown";
};

export type { LanguageCode };
