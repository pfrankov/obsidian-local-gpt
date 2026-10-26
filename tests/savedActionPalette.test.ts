import { afterEach, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { createComponent, requireElement } from "./helpers/actionPalette";

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});
it("runs the saved Action by id and remembers an inline choice without submitting a prompt", async () => {
	const onRun = vi.fn();
	const onSubmit = vi.fn();
	const selection = { providerId: "local", model: "precise" };
	const onChange = vi.fn(async () => [
		{
			id: "translate",
			name: "Translate",
			modelLabel: "Local · precise",
			selection,
		},
	]);
	const { target, component } = createComponent({
		savedActions: [
			{
				id: "translate",
				name: "Translate",
				modelLabel: "Use default · Local · fast",
			},
		],
		onRunSavedAction: onRun,
		onSubmit,
		getActionModels: async () => [{ label: "Local · precise", selection }],
		onActionModelChange: onChange,
	});
	await tick();
	requireElement<HTMLButtonElement>(
		target,
		".local-gpt-saved-action-model",
	).click();
	await vi.waitFor(() =>
		expect(target.querySelector("select")).not.toBeNull(),
	);
	const select = requireElement<HTMLSelectElement>(target, "select");
	select.value = "1";
	select.dispatchEvent(new Event("change", { bubbles: true }));
	await vi.waitFor(() =>
		expect(onChange).toHaveBeenCalledWith("translate", selection),
	);
	await tick();
	expect(
		requireElement(target, ".local-gpt-saved-action-model").textContent,
	).toContain("Local · precise");
	requireElement<HTMLButtonElement>(
		target,
		".local-gpt-saved-action-run",
	).click();
	expect(onRun).toHaveBeenCalledWith("translate", []);
	expect(onSubmit).not.toHaveBeenCalled();
	component.$destroy();
});
