import { ButtonComponent, setIcon } from "obsidian";
import type { LocalGPTAction } from "./interfaces";
import { I18n } from "./i18n";
import type { CommunityAction } from "./CommunityActionsService";
import type { CommunityActionState } from "./settingsTabUtils";

type InstallCommunityAction = (
	action: CommunityAction,
	existingAction?: LocalGPTAction,
) => Promise<void>;

interface RenderCommunityActionRowOptions {
	listEl: HTMLElement;
	action: CommunityAction;
	state: CommunityActionState;
	installCommunityAction: InstallCommunityAction;
}

export function renderCommunityActionRow({
	listEl,
	action,
	state,
	installCommunityAction,
}: RenderCommunityActionRowOptions) {
	const actionRow = listEl.createDiv("local-gpt-community-actions-row");
	if (state.type === "installed") {
		actionRow.addClass("local-gpt-is-installed");
	}
	const infoEl = actionRow.createDiv("local-gpt-community-actions-info");

	const content = infoEl.createDiv("local-gpt-community-actions-content");
	const header = content.createDiv("local-gpt-community-actions-header");
	header.createSpan({
		text: action.name,
		cls: "local-gpt-community-actions-title",
	});

	const statusPill = getCommunityActionStatusPill(state);
	if (statusPill) {
		const pill = header.createSpan("local-gpt-community-actions-status");
		pill.setText(statusPill.label);
		pill.addClass(`local-gpt-is-${statusPill.variant}`);
	}

	const score = header.createSpan("local-gpt-community-actions-score");
	score.setText(String(action.score));
	score.setAttr(
		"aria-label",
		`${I18n.t("settings.communityActionsScoreLabel")} ${action.score}`,
	);

	const metaRow = content.createDiv("local-gpt-community-actions-meta");
	if (action.author) {
		const author = metaRow.createSpan(
			"local-gpt-community-actions-meta-item",
		);
		author.setText(
			I18n.t("settings.communityActionsByAuthor", {
				author: `@${action.author}`,
			}),
		);
		author.addClass("local-gpt-community-actions-author");
	}
	if (action.replace) {
		const replaceTag = metaRow.createSpan(
			"local-gpt-community-actions-meta-pill",
		);
		replaceTag.setText(I18n.t("settings.communityActionsReplaceTag"));
	}

	const footer = content.createDiv("local-gpt-community-actions-footer");
	const preview = footer.createDiv("local-gpt-community-actions-preview");
	const description = action.description?.trim();
	if (description) {
		const descriptionLine = preview.createDiv(
			"local-gpt-community-actions-description",
		);
		descriptionLine.setText(description);
		descriptionLine.setAttr("title", description);
	} else {
		addPreviewLine(preview, I18n.t("settings.systemPrompt"), action.system);
		addPreviewLine(preview, I18n.t("settings.prompt"), action.prompt);
	}

	const noteText = getCommunityActionNote(state);
	if (noteText) {
		const note = content.createDiv("local-gpt-community-actions-note");
		note.setText(noteText);
	}

	const actions = footer.createDiv("local-gpt-community-actions-actions");
	const controlEl = actions.createDiv("local-gpt-community-actions-control");
	const button = new ButtonComponent(controlEl);
	configureCommunityActionButton(
		button,
		action,
		state,
		installCommunityAction,
	);
}

function getCommunityActionStatusPill(state: CommunityActionState): {
	label: string;
	variant: "installed" | "modified" | "conflict";
} | null {
	if (state.type === "installed") {
		return {
			label: I18n.t("settings.communityActionsInstalled"),
			variant: "installed",
		};
	}
	if (state.type === "modified") {
		return {
			label: I18n.t("settings.communityActionsModified"),
			variant: "modified",
		};
	}
	if (state.type === "conflict") {
		return {
			label: I18n.t("settings.communityActionsInList"),
			variant: "conflict",
		};
	}
	return null;
}

function getCommunityActionNote(state: CommunityActionState) {
	if (state.type === "modified") {
		return I18n.t("settings.communityActionsModifiedNote");
	}
	if (state.type === "conflict") {
		return I18n.t("settings.communityActionsConflictNote");
	}
	return null;
}

function configureCommunityActionButton(
	button: ButtonComponent,
	action: CommunityAction,
	state: CommunityActionState,
	installCommunityAction: InstallCommunityAction,
) {
	if (state.type === "installed") {
		button
			.setButtonText(I18n.t("settings.communityActionsInstalled"))
			.setDisabled(true);
		button.buttonEl.addClass(
			"local-gpt-community-actions-installed-button",
		);
		return;
	}

	if (state.type === "modified") {
		button
			.setButtonText(I18n.t("settings.communityActionsUpdate"))
			.setClass("mod-warning")
			.onClick(async () =>
				installCommunityAction(action, state.localAction),
			);
		return;
	}

	if (state.type === "conflict") {
		button
			.setButtonText(I18n.t("settings.communityActionsReplace"))
			.setClass("mod-warning")
			.onClick(async () =>
				installCommunityAction(action, state.localAction),
			);
		return;
	}

	button
		.setCta()
		.setButtonText(I18n.t("settings.communityActionsInstall"))
		.onClick(async () => installCommunityAction(action));
	button.buttonEl.addClass("local-gpt-community-actions-install-button");
	const icon = button.buttonEl.createSpan(
		"local-gpt-community-actions-install-icon",
	);
	setIcon(icon, "plus");
	button.buttonEl.prepend(icon);
}

function addPreviewLine(preview: HTMLElement, label: string, value?: string) {
	if (!value) {
		return;
	}
	const line = preview.createDiv("local-gpt-community-actions-preview-line");
	line.createSpan({
		text: `${label}: `,
		cls: "local-gpt-community-actions-preview-label",
	});
	line.createSpan({ text: value });
}
