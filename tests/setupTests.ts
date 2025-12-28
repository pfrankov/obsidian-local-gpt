import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mock Obsidian's HTMLElement extensions (used by widgets in spinnerPlugin)
HTMLElement.prototype.addClass = function (cls: string) {
	this.classList.add(cls);
};
HTMLElement.prototype.addClasses = function (classes: string[]) {
	this.classList.add(...classes);
};
HTMLElement.prototype.toggleClass = function (cls: string, force?: boolean) {
	this.classList.toggle(cls, force);
};

vi.mock("@obsidian-ai-providers/sdk", () => ({
	initAI: vi.fn(async (_app?: unknown, _plugin?: unknown, onLoad?: () => void | Promise<void>) => {
		if (onLoad) {
			await onLoad();
		}
	}),
	waitForAI: vi.fn(() =>
		Promise.resolve({
			promise: Promise.resolve({
				providers: [],
				execute: vi.fn(),
				retrieve: vi.fn(),
				fetchModels: vi.fn(),
			}),
		}),
	),
	IAIProvider: class {},
	IAIProvidersService: class {},
}));

// Ensure global AbortController exists for jsdom environments
if (!(globalThis as any).AbortController) {
	(globalThis as any).AbortController = AbortController;
}
