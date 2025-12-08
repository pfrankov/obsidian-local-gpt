import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addToPromptHistory,
	getPromptHistoryEntry,
	getPromptHistoryLength,
	resetPromptHistory,
} from "../src/ui/actionPaletteHistory";

const STORAGE_KEY = "local-gpt-action-palette-history";
const importFreshHistoryModule = async () => {
	vi.resetModules();
	return import("../src/ui/actionPaletteHistory");
};

afterEach(() => {
	vi.restoreAllMocks();
});

beforeEach(() => {
	localStorage.clear();
	resetPromptHistory();
});

describe("actionPaletteHistory", () => {
	it("persists normalized, non-duplicate entries", () => {
		addToPromptHistory("  first  ");
		addToPromptHistory("first");
		addToPromptHistory("second");

		expect(getPromptHistoryLength()).toBe(2);
		expect(getPromptHistoryEntry(0)).toBe("  first  ");
		expect(getPromptHistoryEntry(1)).toBe("second");
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
		expect(stored).toEqual(["  first  ", "second"]);
	});

	it("keeps only the newest 50 records", () => {
		for (let i = 0; i < 55; i += 1) {
			addToPromptHistory(`entry-${i}`);
		}

		expect(getPromptHistoryLength()).toBe(50);
		expect(getPromptHistoryEntry(0)).toBe("entry-5");
		expect(getPromptHistoryEntry(49)).toBe("entry-54");
	});

	it("resets history and storage", () => {
		addToPromptHistory("temp");
		resetPromptHistory();

		expect(getPromptHistoryLength()).toBe(0);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("restores stored string history and filters non-string entries", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(["first", 123, "second"]));
		const historyModule = await importFreshHistoryModule();

		expect(historyModule.getPromptHistoryLength()).toBe(2);
		expect(historyModule.getPromptHistoryEntry(0)).toBe("first");
		expect(historyModule.getPromptHistoryEntry(1)).toBe("second");
	});

	it("ignores non-array payloads in storage", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
		const historyModule = await importFreshHistoryModule();

		expect(historyModule.getPromptHistoryLength()).toBe(0);
	});

	it("returns empty history when storage is missing", async () => {
		const originalStorage = (globalThis as any).localStorage;
		// @ts-ignore
		delete (globalThis as any).localStorage;
		const historyModule = await importFreshHistoryModule();

		expect(historyModule.getPromptHistoryLength()).toBe(0);

		(globalThis as any).localStorage = originalStorage;
	});

	it("ignores malformed history payloads", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		localStorage.setItem(STORAGE_KEY, "{{broken json}}");
		const historyModule = await importFreshHistoryModule();

		expect(historyModule.getPromptHistoryLength()).toBe(0);
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
	});

	it("continues when persisting history fails", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const setItemSpy = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("persist failed");
			});

		addToPromptHistory("failsave");

		expect(setItemSpy).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
		setItemSpy.mockRestore();
	});

	it("handles reset errors", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const removeSpy = vi
			.spyOn(Storage.prototype, "removeItem")
			.mockImplementation(() => {
				throw new Error("reset failed");
			});

		resetPromptHistory();

		expect(removeSpy).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
		removeSpy.mockRestore();
	});

	it("skips persistence when storage is unavailable", () => {
		const originalStorage = (globalThis as any).localStorage;
		// @ts-ignore
		delete (globalThis as any).localStorage;

		expect(() => addToPromptHistory("no-storage")).not.toThrow();
		resetPromptHistory();

		(globalThis as any).localStorage = originalStorage;
	});

	it("clears history without storage present", () => {
		addToPromptHistory("temp");
		const originalStorage = (globalThis as any).localStorage;
		// @ts-ignore
		delete (globalThis as any).localStorage;

		expect(() => resetPromptHistory()).not.toThrow();
		expect(getPromptHistoryLength()).toBe(0);

		(globalThis as any).localStorage = originalStorage;
	});
});
