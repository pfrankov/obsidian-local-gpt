import { Notice } from "obsidian";
import {
	supportsVersion,
	type IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import { I18n } from "./i18n";

/** Soft floor for loading Local GPT against older AI Providers. */
export const MINIMUM_AI_PROVIDERS_API_VERSION = 4;
/** Service API that exposes reasoningMode / modelCapabilities.reasoningModes. */
export const REASONING_AI_PROVIDERS_API_VERSION = 5;
/** Shown in upgrade copy; matches AI Providers 1.12.0 (API v5). */
export const REQUIRED_AI_PROVIDERS_PLUGIN_VERSION = "1.12.0";

const NOTICE_STORAGE_KEY = "local-gpt:noticed-ai-providers-reasoning-upgrade";

export function supportsReasoningApi(
	service: Pick<IAIProvidersService, "version"> | null | undefined,
): boolean {
	return supportsVersion(service, REASONING_AI_PROVIDERS_API_VERSION);
}

/** Settings callout / notice body. */
export function aiProvidersUpgradeMessage(): string {
	return I18n.t("notices.aiProvidersUpdateForReasoning", {
		version: REQUIRED_AI_PROVIDERS_PLUGIN_VERSION,
	});
}

/**
 * One-time Notice when AI Providers is too old for reasoning.
 * Safe to call repeatedly; only shows once per vault profile (localStorage).
 */
export function maybeNoticeAiProvidersUpgrade(
	service: Pick<IAIProvidersService, "version"> | null | undefined,
): void {
	if (supportsReasoningApi(service)) return;
	try {
		if (window.localStorage.getItem(NOTICE_STORAGE_KEY) === "1") return;
		window.localStorage.setItem(NOTICE_STORAGE_KEY, "1");
	} catch {
		// Storage unavailable — still show the notice once this session.
	}
	new Notice(aiProvidersUpgradeMessage());
}

/** Test helper to clear the one-time notice flag. */
export function resetAiProvidersUpgradeNoticeForTests(): void {
	try {
		window.localStorage.removeItem(NOTICE_STORAGE_KEY);
	} catch {
		// ignore
	}
}
