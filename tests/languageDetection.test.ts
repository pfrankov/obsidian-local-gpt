import { describe, expect, test } from "vitest";
import { detectDominantLanguage } from "../src/languageDetection";

describe("detectDominantLanguage", () => {
	// Script-based languages
	test("returns ru for Cyrillic text", () => {
		expect(detectDominantLanguage("Привет мир")).toBe("ru");
	});

	test("returns ru when Cyrillic dominates mixed text", () => {
		expect(detectDominantLanguage("Hello привет как дела")).toBe("ru");
	});

	test("returns zh for Chinese text", () => {
		expect(detectDominantLanguage("你好世界")).toBe("zh");
	});

	test("returns ja when Hiragana is present", () => {
		expect(detectDominantLanguage("こんにちは世界")).toBe("ja");
	});

	test("returns ko for Korean text", () => {
		expect(detectDominantLanguage("안녕하세요 세계")).toBe("ko");
	});

	test("returns ar for Arabic text", () => {
		expect(detectDominantLanguage("مرحبا بالعالم")).toBe("ar");
	});

	test("returns he for Hebrew text", () => {
		expect(detectDominantLanguage("שלום עולם")).toBe("he");
	});

	test("returns el for Greek text", () => {
		expect(detectDominantLanguage("Γειά σου κόσμε")).toBe("el");
	});

	test("returns hi for Hindi text", () => {
		expect(detectDominantLanguage("नमस्ते दुनिया")).toBe("hi");
	});

	// Latin-based languages
	test("returns en for English text with marker words", () => {
		expect(
			detectDominantLanguage("Hello world, this is a test with the text"),
		).toBe("en");
	});

	test("returns de for German text", () => {
		expect(detectDominantLanguage("Das ist eine Straße")).toBe("de");
	});

	test("returns es for Spanish text", () => {
		expect(detectDominantLanguage("¿Cómo estás? ¡Muy bien!")).toBe("es");
	});

	test("returns fr for French text", () => {
		expect(detectDominantLanguage("C'est une œuvre française.")).toBe("fr");
	});

	test("returns pt for Portuguese text", () => {
		expect(detectDominantLanguage("Não sei. Ação rápida.")).toBe("pt");
	});

	test("returns id for Indonesian text", () => {
		expect(detectDominantLanguage("Saya tidak tahu apa yang terjadi")).toBe(
			"id",
		);
	});

	// Edge cases
	test("returns unknown for empty string", () => {
		expect(detectDominantLanguage("")).toBe("unknown");
	});

	test("returns unknown when no letters are present", () => {
		expect(detectDominantLanguage("1234 !!!")).toBe("unknown");
	});

	test("returns unknown for very short Latin text without markers", () => {
		expect(detectDominantLanguage("Hi")).toBe("unknown");
	});

	test("returns unknown for short ambiguous Latin text", () => {
		expect(detectDominantLanguage("Test xyz")).toBe("unknown");
	});

	test("returns en for Latin text above minimum threshold", () => {
		expect(detectDominantLanguage("abcdefghijk")).toBe("en");
	});

	test("handles long text by truncating for performance", () => {
		const longText = "Hello world ".repeat(200);
		expect(detectDominantLanguage(longText)).toBe("en");
	});

	test("returns unknown when script languages tie", () => {
		// Equal amounts of Chinese and Korean characters
		expect(detectDominantLanguage("你好안녕")).toBe("unknown");
	});

	test("prefers script language over Latin when script dominates", () => {
		// More Cyrillic characters than Latin
		expect(detectDominantLanguage("Привет мир hello")).toBe("ru");
	});

	test("prefers Latin language when Latin dominates", () => {
		expect(
			detectDominantLanguage("Hello world this is English with one 你"),
		).toBe("en");
	});
});
