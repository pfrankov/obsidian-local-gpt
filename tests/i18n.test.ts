import { readFileSync, readdirSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/logger", () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		table: vi.fn(),
		time: vi.fn(),
		timeEnd: vi.fn(),
		separator: vi.fn(),
		setLogLevel: vi.fn(),
	},
}));

import { I18n } from "../src/i18n";
import { logger } from "../src/logger";
import en from "../src/i18n/en.json";
import ru from "../src/i18n/ru.json";

type LocaleKeys = {
	file: string;
	keys: Set<string>;
};

const localeDir = path.join(process.cwd(), "src", "i18n");

const collectKeys = (value: unknown, prefix = ""): string[] => {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return Object.entries(value).flatMap(([key, nestedValue]) => {
			const nextPrefix = prefix ? `${prefix}.${key}` : key;
			return collectKeys(nestedValue, nextPrefix);
		});
	}

	return prefix ? [prefix] : [];
};

const loadLocales = (): LocaleKeys[] =>
	readdirSync(localeDir)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => {
			const raw = readFileSync(path.join(localeDir, file), "utf8");
			return {
				file,
				keys: new Set(collectKeys(JSON.parse(raw))),
			};
		});

const diffLocaleKeys = (reference: Set<string>, locale: Set<string>) => ({
	missing: [...reference].filter((key) => !locale.has(key)).sort(),
	extra: [...locale].filter((key) => !reference.has(key)).sort(),
});

const formatMismatch = (
	file: string,
	diff: ReturnType<typeof diffLocaleKeys>,
): string | null => {
	const details: string[] = [];
	if (diff.missing.length) {
		details.push(`missing: ${diff.missing.join(", ")}`);
	}
	if (diff.extra.length) {
		details.push(`extra: ${diff.extra.join(", ")}`);
	}

	return details.length ? `${file}: ${details.join(" | ")}` : null;
};

const collectMismatches = (
	locales: LocaleKeys[],
	referenceKeys: Set<string>,
): string[] =>
	locales
		.filter((locale) => locale.file !== "en.json")
		.map((locale) =>
			formatMismatch(
				locale.file,
				diffLocaleKeys(referenceKeys, locale.keys),
			),
		)
		.filter((value): value is string => Boolean(value));

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
});

describe("I18n", () => {
	it("keeps translation keys aligned across locales", () => {
		const locales = loadLocales();
		const reference = locales.find((locale) => locale.file === "en.json");
		expect(reference).toBeDefined();
		const referenceKeys = reference?.keys ?? new Set<string>();

		const mismatches = collectMismatches(locales, referenceKeys);

		if (mismatches.length) {
			throw new Error(
				`Translation keys are out of sync:\\n${mismatches.join("\\n")}`,
			);
		}
	});

	it("falls back to english by default", () => {
		localStorage.removeItem("language");

		expect(I18n.t("commands.actionPalette.placeholder")).toBe(
			en.commands.actionPalette.placeholder,
		);
	});

	it("uses selected language when available", () => {
		localStorage.setItem("language", "ru");

		expect(I18n.t("commands.actionPalette.placeholder")).toBe(
			ru.commands.actionPalette.placeholder,
		);
	});

	it("falls back to english for unsupported languages", () => {
		localStorage.setItem("language", "xx");

		expect(I18n.t("commands.actionPalette.placeholder")).toBe(
			en.commands.actionPalette.placeholder,
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("warns and returns key when translation is missing", () => {
		localStorage.setItem("language", "ru");
		const missingKey = "missing.translation.key";

		const result = I18n.t(missingKey);

		expect(result).toBe(missingKey);
		expect(logger.warn).toHaveBeenCalledWith(
			`Translation missing: ${missingKey}`,
		);
	});

	it("replaces template params", () => {
		localStorage.setItem("language", "en");

		expect(
			I18n.t("notices.errorGenerating", { message: "oops" }),
		).toBe("Error while generating text: oops");
	});
});
