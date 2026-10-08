import { afterEach, expect, it, vi } from "vitest";
import { formatCreativityBadgeLabel } from "../src/ui/actionPaletteOptions";
import { tick } from "svelte";
import { readFileSync } from "node:fs";
import {
	createComponent,
	requireElement,
	typeIntoPalette,
} from "./helpers/actionPalette";
import { highlightPreferredItem } from "../src/ui/actionPaletteDom";
import { I18n } from "../src/i18n";

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

it.each([1, 2])(
	"restores textbox focus after %i Reasoning clicks and allows keyboard selection",
	async (clicks) => {
		const onSubmit = vi.fn();
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => ({
				providerId: "fixture",
				model: "glm-5.3-flash",
				modes: ["low", "high", "max"],
				effectiveMode: "high",
			}),
			onSubmit,
		});
		try {
			await flush();
			const input = requireElement<HTMLElement>(
				target,
				".local-gpt-action-palette",
			);
			const chip = requireElement<HTMLButtonElement>(
				target,
				".local-gpt-reasoning-badge",
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
			expect(target.querySelector(".local-gpt-dropdown")).toBeNull();
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			expect(onSubmit.mock.calls[0][0].reasoningSelection?.mode).toBe(
				"max",
			);
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

const highlightedText = (target: HTMLElement) =>
	target
		.querySelector(".local-gpt-dropdown-item.local-gpt-selected")
		?.textContent?.trim();

it.each([1, 2])(
	"highlights the current creativity after %i chip clicks",
	async (clicks) => {
		const onCreativityChange = vi.fn();
		const { target, component } = createComponent({
			providerLabel: `Provider · Model · ${formatCreativityBadgeLabel("low")}`,
			onCreativityChange,
		});
		try {
			await flush();
			const chip = requireElement<HTMLButtonElement>(
				target,
				".local-gpt-creativity-badge",
			);
			for (let click = 0; click < clicks; click++) {
				chip.click();
				await flush();
			}
			expect(highlightedText(target)).toBe(
				formatCreativityBadgeLabel("low"),
			);
			document.activeElement!.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			await flush();
			expect(onCreativityChange).toHaveBeenCalledWith("low");
		} finally {
			component.$destroy();
		}
	},
);

it("keeps the navigated creativity highlight on a repeat chip click", async () => {
	const { target, component } = createComponent({
		providerLabel: `Provider · Model · ${formatCreativityBadgeLabel("low")}`,
	});
	try {
		await flush();
		const chip = requireElement<HTMLButtonElement>(
			target,
			".local-gpt-creativity-badge",
		);
		chip.click();
		await flush();
		document.activeElement!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);
		await flush();
		expect(highlightedText(target)).toBe(
			formatCreativityBadgeLabel("medium"),
		);
		chip.click();
		await flush();
		expect(highlightedText(target)).toBe(
			formatCreativityBadgeLabel("medium"),
		);
	} finally {
		component.$destroy();
	}
});

it("highlights API default when /creativity opens without a chip", async () => {
	const { target, component } = createComponent({
		providerLabel: "Provider · Model",
	});
	try {
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/creativity ");
		await flush();
		expect(highlightedText(target)).toBe(
			I18n.t("settings.creativityDefault"),
		);
	} finally {
		component.$destroy();
	}
});

it("highlights the first match when the filter excludes the current creativity", async () => {
	const { target, component } = createComponent({
		providerLabel: `Provider · Model · ${formatCreativityBadgeLabel("low")}`,
	});
	try {
		await flush();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/creativity hi");
		await flush();
		expect(highlightedText(target)).toBe(
			formatCreativityBadgeLabel("high"),
		);
	} finally {
		component.$destroy();
	}
});

const reasoningSnapshot = {
	providerId: "fixture",
	model: "glm-5.3-flash",
	modes: ["low", "high", "max"],
	effectiveMode: "high",
};

const pickReasoning = async (target: HTMLElement, label: string) => {
	const item = Array.from(
		target.querySelectorAll<HTMLElement>(".local-gpt-dropdown-item"),
	).find((entry) => entry.textContent?.trim() === label);
	expect(item).toBeDefined();
	item!.click();
	await flush();
};

it.each([1, 2])(
	"highlights the current reasoning selection after %i chip clicks",
	async (clicks) => {
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => reasoningSnapshot,
		});
		try {
			await flush();
			const chip = () =>
				requireElement<HTMLButtonElement>(
					target,
					".local-gpt-reasoning-badge",
				);
			chip().click();
			await flush();
			expect(highlightedText(target)).toBe(
				I18n.t("settings.reasoningEffortHigh"),
			);
			await pickReasoning(target, I18n.t("settings.reasoningEffortLow"));
			for (let click = 0; click < clicks; click++) {
				chip().click();
				await flush();
			}
			expect(highlightedText(target)).toBe(
				I18n.t("settings.reasoningEffortLow"),
			);
		} finally {
			component.$destroy();
		}
	},
);

it("highlights explicit API default when /reasoning reopens", async () => {
	const { target, component } = createComponent({
		getReasoningSnapshot: async () => reasoningSnapshot,
	});
	try {
		await flush();
		requireElement<HTMLButtonElement>(
			target,
			".local-gpt-reasoning-badge",
		).click();
		await flush();
		await pickReasoning(target, I18n.t("settings.reasoningEffortDefault"));
		expect(target.querySelector(".local-gpt-reasoning-badge")).toBeNull();
		const input = requireElement<HTMLDivElement>(
			target,
			".local-gpt-action-palette",
		);
		await typeIntoPalette(input, "/reasoning ");
		await flush();
		expect(highlightedText(target)).toBe(
			I18n.t("settings.reasoningEffortDefault"),
		);
	} finally {
		component.$destroy();
	}
});

it("scrolls the preferred item into view once rendered", async () => {
	const container = document.createElement("div");
	const items = ["a", "b", "c"].map((id) => {
		const item = document.createElement("div");
		item.scrollIntoView = vi.fn();
		container.appendChild(item);
		return { id, name: id };
	});
	container.getBoundingClientRect = () => ({ top: 0, bottom: 40 }) as DOMRect;
	(container.children[2] as HTMLElement).getBoundingClientRect = () =>
		({ top: 80, bottom: 100 }) as DOMRect;
	const context = {
		state: {
			activeDropdown: "creativity" as const,
			filteredItems: items,
			selectedIndex: 0,
		},
		options: { getDropdownElement: () => container },
		commit: vi.fn(),
	};
	highlightPreferredItem(context, "creativity", [undefined, "missing", "c"]);
	expect(context.state.selectedIndex).toBe(2);
	await tick();
	expect(
		(container.children[2] as HTMLElement).scrollIntoView,
	).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
	highlightPreferredItem(context, "creativity", ["missing"]);
	expect(context.state.selectedIndex).toBe(0);
});

it.each([
	[undefined, "settings.reasoningEffortInherit"],
	["default", "settings.reasoningEffortDefault"],
])(
	"highlights the inherited state when the chip is hidden (effective %s)",
	async (effectiveMode, labelKey) => {
		const { target, component } = createComponent({
			getReasoningSnapshot: async () => ({
				...reasoningSnapshot,
				effectiveMode,
			}),
		});
		try {
			await flush();
			expect(
				target.querySelector(".local-gpt-reasoning-badge"),
			).toBeNull();
			const input = requireElement<HTMLDivElement>(
				target,
				".local-gpt-action-palette",
			);
			await typeIntoPalette(input, "/reasoning ");
			await flush();
			expect(highlightedText(target)).toBe(I18n.t(labelKey));
		} finally {
			component.$destroy();
		}
	},
);
