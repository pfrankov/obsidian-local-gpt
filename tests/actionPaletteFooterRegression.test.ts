import { afterEach, expect, it, vi } from "vitest";
import { formatCreativityBadgeLabel } from "../src/ui/actionPaletteOptions";
import { tick } from "svelte";
import { readFileSync } from "node:fs";
import { createComponent, requireElement } from "./helpers/actionPalette";

const flush = async () => {
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 40));
	await tick();
};
afterEach(() => {
	document.body.innerHTML = "";
});

it.each([1, 2])(
	"restores textbox focus after %i Creativity clicks and allows keyboard selection",
	async (clicks) => {
		const onCreativityChange = vi.fn();
		const { target, component } = createComponent({
			providerLabel: `Provider · Model · ${formatCreativityBadgeLabel("low")}`,
			onCreativityChange,
		});
		try {
			await flush();
			const input = requireElement<HTMLElement>(
				target,
				".local-gpt-action-palette",
			);
			const chip = requireElement<HTMLButtonElement>(
				target,
				".local-gpt-creativity-badge",
			);
			for (let click = 0; click < clicks; click++) {
				chip.focus();
				chip.click();
				await flush();
			}
			expect(document.activeElement).toBe(input);
			document.activeElement!.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowDown",
					bubbles: true,
				}),
			);
			document.activeElement!.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await flush();
			expect(onCreativityChange).toHaveBeenCalledOnce();
		} finally {
			component.$destroy();
		}
	},
);

it("preserves delimiter-containing model names without inventing a creativity chip", async () => {
	const { target, component } = createComponent({
		providerLabel: "Provider · foo · bar",
	});
	try {
		await tick();
		expect(
			target
				.querySelector(".local-gpt-provider-badge-label")
				?.textContent?.trim(),
		).toBe("Provider · foo · bar");
		expect(target.querySelector(".local-gpt-creativity-badge")).toBeNull();
	} finally {
		component.$destroy();
	}
});

it("applies the highlight color directly to the nested provider label", () => {
	const style = document.createElement("style");
	style.textContent = readFileSync("styles.css", "utf8");
	document.head.appendChild(style);
	try {
		const host = document.createElement("div");
		host.className = "cm-editor";
		host.innerHTML =
			'<div class="local-gpt-provider-badge-meta local-gpt-badge-highlight"><div class="local-gpt-provider-badge-label">Provider · Model</div></div>';
		document.body.appendChild(host);
		const label = host.querySelector(".local-gpt-provider-badge-label")!;
		const matching = Array.from(style.sheet!.cssRules).filter(
			(rule) =>
				rule instanceof CSSStyleRule &&
				label.matches(rule.selectorText),
		) as CSSStyleRule[];
		expect(
			matching.filter((rule) => rule.style.color).at(-1)?.style.color,
		).toBe("var(--text-accent)");
	} finally {
		style.remove();
	}
});

it.each(["default", "low"])(
	"preserves structured names containing separators with %s creativity",
	async (key) => {
		const providerDetails = {
			providerName: "Provider · East",
			modelName: "foo · bar · ⚪ None",
			creativityBadge: formatCreativityBadgeLabel(key),
		};
		const { target, component } = createComponent({ providerDetails });
		try {
			await tick();
			expect(
				target
					.querySelector(".local-gpt-provider-badge-label")
					?.textContent?.trim(),
			).toBe(
				`${providerDetails.providerName} · ${providerDetails.modelName}`,
			);
			expect(
				target
					.querySelector(".local-gpt-creativity-badge")
					?.textContent?.trim() || "",
			).toBe(providerDetails.creativityBadge);
		} finally {
			component.$destroy();
		}
	},
);
