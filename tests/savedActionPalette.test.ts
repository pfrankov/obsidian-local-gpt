import { afterEach, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { createComponent, requireElement } from "./helpers/actionPalette";

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

it("runs the saved Action by id, hides the row model badge when default, and passes a one-off model override from the bottom badge", async () => {
	const onRun = vi.fn();
	const onSubmit = vi.fn();
	const selection = { providerId: "local", model: "precise" };
	const { target, component } = createComponent({
		providerId: "local",
		providerDetails: { providerName: "Local", modelName: "fast" },
		getModels: async () => [
			{ id: "fast", name: "fast" },
			{ id: "precise", name: "precise" },
		],
		savedActions: [
			{
				id: "translate",
				name: "Translate",
				modelLabel: "Use default · Local · fast",
			},
		],
		onRunSavedAction: onRun,
		onSubmit,
	});
	await tick();

	// Default actions do not render an inline model badge or select
	expect(target.querySelector(".local-gpt-saved-action-model")).toBeNull();
	expect(target.querySelector("select")).toBeNull();

	// Highlight the saved action with ArrowDown and open the model picker from the bottom badge
	const input = requireElement<HTMLDivElement>(
		target,
		".local-gpt-action-palette",
	);
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		}),
	);
	await tick();

	requireElement<HTMLButtonElement>(
		target,
		".local-gpt-model-badge-button",
	).click();
	await vi.waitFor(() =>
		expect(
			target.querySelectorAll(".local-gpt-dropdown-item").length,
		).toBe(2),
	);
	const items = target.querySelectorAll<HTMLElement>(
		".local-gpt-dropdown-item",
	);
	items[1].click();

	await vi.waitFor(() =>
		expect(
			requireElement(target, ".local-gpt-provider-badge-label")
				.textContent,
		).toContain("Local · precise"),
	);
	// Row remains without a persistent badge
	expect(target.querySelector(".local-gpt-saved-action-model")).toBeNull();

	requireElement<HTMLButtonElement>(
		target,
		".local-gpt-saved-action-run",
	).click();
	expect(onRun).toHaveBeenCalledWith("translate", [], selection);
	expect(onSubmit).not.toHaveBeenCalled();
	component.$destroy();
});
