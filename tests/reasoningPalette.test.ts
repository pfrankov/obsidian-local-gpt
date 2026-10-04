import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import {
	createComponent,
	requireElement,
	typeIntoPalette,
} from "./helpers/actionPalette";
import { createActionPaletteState } from "../src/ui/actionPaletteState";
import {
	refreshReasoning,
	resetReasoning,
	showReasoningDropdown,
} from "../src/ui/actionPaletteReasoning";
import { I18n } from "../src/i18n";

const snapshot = {
	providerId: "fixture",
	model: "glm-5.3-flash",
	modes: ["low", "high", "max"],
	effectiveMode: "high",
};
const flush = async () => {
	await Promise.resolve();
	await tick();
	await Promise.resolve();
	await tick();
};
afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("per-invocation reasoning", () => {
	it("selects a native mode via slash, displays it, strips command and resets next invocation", async () => {
		const onSubmit = vi.fn();
		const props = { getReasoningSnapshot: async () => snapshot, onSubmit };
		const { target, component } = createComponent(props);
		await flush();
		expect(
			target.querySelector(".local-gpt-reasoning-badge")?.textContent,
		).toContain("high");
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/reasoning ");
		await flush();
		const low = Array.from(
			target.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item"),
		).find((item) => item.textContent?.trim() === "low")!;
		expect(low).toBeDefined();
		low.click();
		await flush();
		expect(
			target.querySelector(".local-gpt-reasoning-badge")?.textContent,
		).toContain("low");
		await typeIntoPalette(input, "Synthetic prompt");
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "Synthetic prompt",
				reasoningSelection: {
					providerId: snapshot.providerId,
					model: snapshot.model,
					mode: "low",
				},
			}),
		);
		component.$destroy();
		const next = createComponent(props);
		await flush();
		expect(
			next.target.querySelector(".local-gpt-reasoning-badge")
				?.textContent,
		).toContain("high");
		next.component.$destroy();
	});

	it("distinguishes API default from inheritance without changing saved provider preferences", async () => {
		const onSubmit = vi.fn();
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => snapshot,
			onSubmit,
		});
		await flush();
		requireElement<HTMLButtonElement>(
			target,
			".local-gpt-reasoning-badge",
		).click();
		await flush();
		const choice = Array.from(
			target.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item"),
		).find(
			(item) =>
				item.textContent?.trim() ===
				I18n.t("settings.reasoningEffortDefault"),
		)!;
		choice.click();
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "Synthetic");
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(onSubmit.mock.calls[0][0].reasoningSelection.mode).toBe(
			"default",
		);
		expect(snapshot.effectiveMode).toBe("high");
		component.$destroy();
	});

	it("rejects stale asynchronous snapshots and clears a selection on model changes", async () => {
		const state = createActionPaletteState("", "");
		let resolve!: (value: typeof snapshot) => void;
		let getSnapshot = () =>
			new Promise<typeof snapshot>((done) => {
				resolve = done;
			});
		const context = {
			state,
			options: { getReasoningSnapshot: () => getSnapshot },
			commit: vi.fn(),
		} as any;
		const pending = refreshReasoning(context);
		resetReasoning(context);
		getSnapshot = async () => ({
			...snapshot,
			model: "other",
			modes: [],
			effectiveMode: undefined as any,
		});
		await refreshReasoning(context);
		resolve(snapshot);
		await pending;
		expect(state.reasoningSnapshot?.model).toBe("other");
		state.reasoningSelection = {
			providerId: "fixture",
			model: "other",
			mode: "low",
		};
		await refreshReasoning(context);
		expect(state.reasoningSelection).toBeUndefined();
	});
	it("does not reopen the reasoning menu after an async result when another menu is active", async () => {
		const state = createActionPaletteState("", "");
		let resolve!: (value: typeof snapshot) => void;
		const context = {
			state,
			options: {
				getReasoningSnapshot: () => () =>
					new Promise<typeof snapshot>((done) => {
						resolve = done;
					}),
			},
			commit: vi.fn(),
			updateFilteredDropdownItems: vi.fn(),
			getCommandQuery: () => "",
		} as any;
		const pending = showReasoningDropdown(context);
		state.activeDropdown = "provider";
		resolve(snapshot);
		await pending;
		expect(state.activeDropdown).toBe("provider");
		expect(context.updateFilteredDropdownItems).toHaveBeenCalledTimes(1);
	});
});
