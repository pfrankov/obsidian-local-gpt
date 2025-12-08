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

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
});

describe("I18n", () => {
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
		localStorage.setItem("language", "fr");

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
