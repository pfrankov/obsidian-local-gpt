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
	initAI: vi.fn(
		async (
			_app?: unknown,
			_plugin?: unknown,
			onLoad?: () => void | Promise<void>,
			_options?: { minVersion?: number; disableFallback?: boolean },
		) => {
			if (onLoad) {
				await onLoad();
			}
		},
	),
	waitForAI: vi.fn(() =>
		Promise.resolve({
			promise: Promise.resolve({
				version: 5,
				pluginVersion: "1.12.0",
				providers: [],
				execute: vi.fn(),
				retrieve: vi.fn(),
				fetchModels: vi.fn(),
				getModelCapabilities: vi.fn(() => null),
				getModels: vi.fn(() => ({})),
				checkCompatibility: vi.fn(),
			}),
		}),
	),
	supportsVersion: (
		service: { version?: number } | null | undefined,
		required: number,
	) => typeof service?.version === "number" && service.version >= required,
	recommendedPluginVersionForApi: (api: number) =>
		api >= 5 ? "1.12.0+" : "1.11.0+",
	IAIProvider: class {},
	IAIProvidersService: class {},
}));

// Ensure global AbortController exists for jsdom environments
if (!(globalThis as any).AbortController) {
	(globalThis as any).AbortController = AbortController;
}
