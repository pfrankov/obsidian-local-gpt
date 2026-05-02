export type ScrollAlign = "start" | "center";

export interface PendingScrollRestore {
	top: number;
	height: number;
}

export function getScrollableParent(el: HTMLElement): HTMLElement {
	let node: HTMLElement | null = el.parentElement;
	while (node) {
		const style = getComputedStyle(node);
		const overflowY = style.overflowY;
		if (
			node.scrollHeight > node.clientHeight &&
			(overflowY === "auto" || overflowY === "scroll")
		) {
			return node;
		}
		node = node.parentElement;
	}
	return (document.scrollingElement ||
		document.documentElement) as HTMLElement;
}

export function captureScrollPosition(
	anchor: HTMLElement,
): PendingScrollRestore {
	const scrollEl = getScrollableParent(anchor);
	return {
		top: scrollEl.scrollTop,
		height: scrollEl.scrollHeight,
	};
}

export function restoreScrollPosition(
	anchor: HTMLElement,
	pendingRestore?: PendingScrollRestore,
): undefined {
	if (!pendingRestore) return undefined;

	const scrollEl = getScrollableParent(anchor);
	const heightDelta = scrollEl.scrollHeight - pendingRestore.height;
	let desiredTop = pendingRestore.top;
	if (pendingRestore.top > 0) {
		desiredTop += heightDelta;
	}
	const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
	scrollEl.scrollTop = Math.min(
		Math.max(desiredTop, 0),
		Math.max(0, maxScroll),
	);

	return undefined;
}

export function smoothScrollToTarget(
	target: HTMLElement,
	align: ScrollAlign,
	offset = 0,
	onComplete?: () => void,
) {
	const scrollEl = getScrollableParent(target);
	const parentRect = scrollEl.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	const currentTop = scrollEl.scrollTop;
	const targetTop = targetRect.top - parentRect.top + currentTop;
	let desiredTop = targetTop;

	if (align === "start") {
		desiredTop = targetTop - offset;
	} else {
		const available = parentRect.height - targetRect.height;
		desiredTop = targetTop - Math.max(0, available / 2);
	}

	const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
	const clampedTop = Math.min(
		Math.max(desiredTop, 0),
		Math.max(0, maxScroll),
	);

	const prefersReducedMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	const distance = clampedTop - currentTop;
	const minDistance = 1;

	if (prefersReducedMotion || Math.abs(distance) < minDistance) {
		scrollEl.scrollTop = clampedTop;
		onComplete?.();
		return;
	}

	const duration = Math.min(600, Math.max(240, Math.abs(distance) * 0.5));
	const startTime = performance.now();
	const easeInOut = (t: number) =>
		t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

	const step = (now: number) => {
		const progress = Math.min((now - startTime) / duration, 1);
		const eased = easeInOut(progress);
		scrollEl.scrollTop = currentTop + distance * eased;
		if (progress < 1) {
			requestAnimationFrame(step);
			return;
		}
		onComplete?.();
	};

	requestAnimationFrame(step);
}

export function triggerHighlight(element: HTMLElement) {
	element.classList.remove("local-gpt-action-highlight");
	// Force reflow so the highlight animation restarts on repeat triggers.
	void element.offsetWidth;
	element.classList.add("local-gpt-action-highlight");
	element.addEventListener(
		"animationend",
		() => element.classList.remove("local-gpt-action-highlight"),
		{ once: true },
	);
}
