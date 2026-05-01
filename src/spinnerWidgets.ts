import { EditorView, WidgetType } from "@codemirror/view";
import { setIcon } from "obsidian";
import { I18n } from "./i18n";
import {
	ICON_CROSSFADE_MS,
	ICON_GLINT_DURATION_MS,
	ICON_SWITCH_MAX_MS,
	ICON_SWITCH_MIN_MS,
	resolveThinkingIconPool,
} from "./spinnerIcons";

export class LoaderWidget extends WidgetType {
	static readonly element: HTMLSpanElement = document.createElement("span");

	static {
		this.element.addClasses(["local-gpt-loading", "local-gpt-dots"]);
	}

	toDOM(view: EditorView): HTMLElement {
		return LoaderWidget.element.cloneNode(true) as HTMLElement;
	}
}

export class ThinkingStreamWidget extends WidgetType {
	private dom: HTMLElement | null = null;
	private detailsEl: HTMLDetailsElement | null = null;
	private thinkingEl: HTMLElement | null = null;
	private answerEl: HTMLElement | null = null;
	private iconWrap: HTMLElement | null = null;
	private iconPrimary: HTMLElement | null = null;
	private iconSecondary: HTMLElement | null = null;
	private currentIcon: string | null = null;
	private iconQueue: string[] = [];
	private iconTimer: number | null = null;
	private iconCrossfadeTimeout: number | null = null;
	private iconCrossfadeRaf: number | null = null;
	private iconGlintStartTimeout: number | null = null;
	private iconGlintEndTimeout: number | null = null;
	private scrollRaf: number | null = null;

	constructor(
		private thinkingText: string,
		private answerText: string,
		private isThinking: boolean,
	) {
		super();
	}

	eq(other: ThinkingStreamWidget) {
		return (
			other.thinkingText === this.thinkingText &&
			other.answerText === this.answerText &&
			other.isThinking === this.isThinking
		);
	}

	update(thinkingText: string, answerText: string, isThinking: boolean) {
		const shouldUpdateDom =
			thinkingText !== this.thinkingText ||
			answerText !== this.answerText ||
			isThinking !== this.isThinking;

		this.thinkingText = thinkingText;
		this.answerText = answerText;
		this.isThinking = isThinking;

		if (!this.dom || !shouldUpdateDom) {
			return;
		}

		this.updateHeader();
		this.updateTextBlocks();
	}

	toDOM(view: EditorView): HTMLElement {
		if (!this.dom) {
			this.dom = document.createElement("div");
			this.dom.addClass("local-gpt-thinking-stream");
			this.dom.appendChild(document.createElement("br"));

			const details = document.createElement("details");
			details.addClass("local-gpt-think-details");
			details.open = true;
			this.detailsEl = details;

			const summary = document.createElement("summary");
			summary.addClass("local-gpt-think-summary");

			const iconWrap = document.createElement("span");
			iconWrap.addClass("local-gpt-thinking-icon");
			iconWrap.setAttribute("aria-hidden", "true");
			const iconPrimary = document.createElement("span");
			iconPrimary.addClasses([
				"local-gpt-thinking-icon-svg",
				"local-gpt-is-active",
			]);
			const iconSecondary = document.createElement("span");
			iconSecondary.addClass("local-gpt-thinking-icon-svg");
			iconWrap.appendChild(iconPrimary);
			iconWrap.appendChild(iconSecondary);
			summary.appendChild(iconWrap);
			this.iconWrap = iconWrap;
			this.iconPrimary = iconPrimary;
			this.iconSecondary = iconSecondary;

			const titleEl = document.createElement("span");
			titleEl.addClass("local-gpt-think-title");
			const thinkingLabel = I18n.t("thinking.label");
			titleEl.textContent = thinkingLabel;
			titleEl.addClass("local-gpt-thinking");
			summary.appendChild(titleEl);

			details.appendChild(summary);

			const body = document.createElement("div");
			body.addClass("local-gpt-think-body");

			this.thinkingEl = document.createElement("div");
			this.thinkingEl.addClass("local-gpt-think-content");
			this.thinkingEl.setAttribute(
				"data-empty",
				I18n.t("thinking.placeholder"),
			);
			body.appendChild(this.thinkingEl);

			details.appendChild(body);
			this.dom.appendChild(details);

			this.answerEl = document.createElement("div");
			this.answerEl.addClasses([
				"local-gpt-content",
				"local-gpt-think-answer",
			]);
			this.dom.appendChild(this.answerEl);

			this.updateHeader();
			this.updateTextBlocks();
		}
		return this.dom;
	}

	private updateHeader() {
		this.detailsEl?.toggleClass("local-gpt-is-hidden", !this.isThinking);
		if (this.isThinking) {
			this.startIconCycle();
		} else {
			this.stopIconCycle();
		}
	}

	private updateTextBlocks() {
		if (this.thinkingEl) {
			this.updateStreamingText(this.thinkingEl, this.thinkingText, true);
		}

		if (this.answerEl) {
			const hasAnswer = Boolean(this.answerText.trim());
			this.answerEl.toggleClass("local-gpt-is-hidden", !hasAnswer);
			if (hasAnswer) {
				this.updateStreamingText(this.answerEl, this.answerText, false);
			}
		}

		this.scheduleScrollToBottom();
	}

	private updateStreamingText(
		target: HTMLElement,
		newText: string,
		animateChunk: boolean,
	) {
		if (!newText) {
			target.textContent = "";
			return;
		}

		const previousText = target.textContent || "";

		if (!newText.startsWith(previousText)) {
			target.textContent = newText;
			return;
		}

		const addedText = newText.slice(previousText.length);
		if (!addedText) {
			target.textContent = newText;
			return;
		}

		target.textContent = newText.slice(
			0,
			newText.length - addedText.length,
		);

		if (!animateChunk) {
			target.appendChild(document.createTextNode(addedText));
			return;
		}

		const span = document.createElement("span");
		span.addClass("local-gpt-stream-chunk");
		span.textContent = addedText;
		target.appendChild(span);
	}

	private scheduleScrollToBottom() {
		if (!this.thinkingEl || this.scrollRaf !== null) {
			return;
		}

		this.scrollRaf = requestAnimationFrame(() => {
			this.scrollRaf = null;
			if (!this.thinkingEl) {
				return;
			}

			const maxScrollTop =
				this.thinkingEl.scrollHeight - this.thinkingEl.clientHeight;
			const isOverflowing = maxScrollTop > 1;
			this.thinkingEl.toggleClass(
				"local-gpt-is-overflowing",
				isOverflowing,
			);
			if (!isOverflowing) {
				this.thinkingEl.scrollTop = 0;
				return;
			}

			this.thinkingEl.scrollTop = maxScrollTop;
		});
	}

	private startIconCycle() {
		if (!this.iconWrap || !this.iconPrimary || !this.iconSecondary) {
			return;
		}

		if (!this.currentIcon) {
			const nextIcon = this.getNextIcon();
			if (!nextIcon) {
				this.iconWrap.classList.add("local-gpt-is-hidden");
				return;
			}
			this.iconWrap.classList.remove("local-gpt-is-hidden");
			this.applyIcon(nextIcon);
		}

		if (this.iconTimer !== null) {
			return;
		}

		this.scheduleNextIcon();
	}

	private stopIconCycle() {
		this.clearIconTimers();
		this.iconQueue = [];
		this.iconWrap?.classList.remove("local-gpt-is-glint");
	}

	private clearIconTimers() {
		if (this.iconTimer !== null) {
			window.clearTimeout(this.iconTimer);
			this.iconTimer = null;
		}

		if (this.iconCrossfadeTimeout !== null) {
			window.clearTimeout(this.iconCrossfadeTimeout);
			this.iconCrossfadeTimeout = null;
		}

		if (this.iconCrossfadeRaf !== null) {
			cancelAnimationFrame(this.iconCrossfadeRaf);
			this.iconCrossfadeRaf = null;
		}

		if (this.iconGlintStartTimeout !== null) {
			window.clearTimeout(this.iconGlintStartTimeout);
			this.iconGlintStartTimeout = null;
		}

		if (this.iconGlintEndTimeout !== null) {
			window.clearTimeout(this.iconGlintEndTimeout);
			this.iconGlintEndTimeout = null;
		}
	}

	private scheduleNextIcon() {
		if (!this.isThinking || !this.iconWrap) {
			return;
		}

		const delay = this.randomBetween(
			ICON_SWITCH_MIN_MS,
			ICON_SWITCH_MAX_MS,
		);
		this.iconTimer = window.setTimeout(() => {
			this.iconTimer = null;
			if (!this.isThinking) {
				return;
			}
			this.swapIcon();
			this.scheduleNextIcon();
		}, delay);
	}

	private swapIcon() {
		if (!this.iconWrap || !this.iconPrimary || !this.iconSecondary) {
			return;
		}

		const nextIcon = this.getNextIcon();
		if (!nextIcon || nextIcon === this.currentIcon) {
			return;
		}

		if (this.iconCrossfadeTimeout !== null) {
			window.clearTimeout(this.iconCrossfadeTimeout);
			this.iconCrossfadeTimeout = null;
		}

		if (this.iconCrossfadeRaf !== null) {
			cancelAnimationFrame(this.iconCrossfadeRaf);
			this.iconCrossfadeRaf = null;
		}

		const incoming = this.iconSecondary;
		const outgoing = this.iconPrimary;

		incoming.textContent = "";
		setIcon(incoming, nextIcon);

		this.iconCrossfadeRaf = requestAnimationFrame(() => {
			this.iconCrossfadeRaf = null;
			outgoing.classList.remove("local-gpt-is-active");
			incoming.classList.add("local-gpt-is-active");
			const glintDelay = Math.max(0, Math.round(ICON_CROSSFADE_MS * 0.1));
			this.scheduleGlint(glintDelay);
		});

		this.iconPrimary = incoming;
		this.iconSecondary = outgoing;
		this.currentIcon = nextIcon;

		this.iconCrossfadeTimeout = window.setTimeout(() => {
			this.iconCrossfadeTimeout = null;
			if (this.iconSecondary) {
				this.iconSecondary.textContent = "";
			}
		}, ICON_CROSSFADE_MS);
	}

	private applyIcon(iconId: string) {
		if (!this.iconPrimary || !this.iconSecondary) {
			return;
		}

		this.iconPrimary.textContent = "";
		setIcon(this.iconPrimary, iconId);
		this.iconPrimary.classList.add("local-gpt-is-active");
		this.iconSecondary.classList.remove("local-gpt-is-active");
		this.iconSecondary.textContent = "";
		this.currentIcon = iconId;
	}

	private randomBetween(min: number, max: number) {
		return Math.round(min + Math.random() * (max - min));
	}

	private triggerGlint() {
		if (!this.iconWrap) {
			return;
		}

		if (this.iconGlintEndTimeout !== null) {
			window.clearTimeout(this.iconGlintEndTimeout);
			this.iconGlintEndTimeout = null;
		}

		this.iconWrap.classList.remove("local-gpt-is-glint");
		void this.iconWrap.offsetWidth;
		this.iconWrap.classList.add("local-gpt-is-glint");
		this.iconGlintEndTimeout = window.setTimeout(() => {
			this.iconGlintEndTimeout = null;
			this.iconWrap?.classList.remove("local-gpt-is-glint");
		}, ICON_GLINT_DURATION_MS);
	}

	private scheduleGlint(delayMs: number) {
		if (!this.iconWrap) {
			return;
		}

		if (this.iconGlintStartTimeout !== null) {
			window.clearTimeout(this.iconGlintStartTimeout);
			this.iconGlintStartTimeout = null;
		}

		if (this.iconGlintEndTimeout !== null) {
			window.clearTimeout(this.iconGlintEndTimeout);
			this.iconGlintEndTimeout = null;
		}

		this.iconWrap.classList.remove("local-gpt-is-glint");

		if (delayMs <= 0) {
			this.triggerGlint();
			return;
		}

		this.iconGlintStartTimeout = window.setTimeout(() => {
			this.iconGlintStartTimeout = null;
			this.triggerGlint();
		}, delayMs);
	}

	private getNextIcon(): string | null {
		const pool = resolveThinkingIconPool();
		if (!pool.length) {
			return null;
		}

		if (!this.iconQueue.length) {
			this.iconQueue = this.buildIconQueue(pool, this.currentIcon);
		}

		return this.iconQueue.shift() || null;
	}

	private buildIconQueue(pool: string[], avoid?: string | null) {
		const shuffled = [...pool];
		for (let i = shuffled.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		if (avoid && shuffled.length > 1 && shuffled[0] === avoid) {
			const swapIndex = shuffled.findIndex((icon) => icon !== avoid);
			if (swapIndex > 0) {
				[shuffled[0], shuffled[swapIndex]] = [
					shuffled[swapIndex],
					shuffled[0],
				];
			}
		}

		return shuffled;
	}

	destroy() {
		this.stopIconCycle();
	}
}
