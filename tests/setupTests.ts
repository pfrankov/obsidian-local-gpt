import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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
