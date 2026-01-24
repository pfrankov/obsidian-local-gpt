import { requestUrl } from "obsidian";

export interface CommunityAction {
	id: string;
	name: string;
	language: string;
	description?: string;
	prompt?: string;
	system?: string;
	replace?: boolean;
	author: string;
	authorUrl?: string;
	commentUrl?: string;
	score: number;
	createdAt?: string;
	updatedAt?: string;
}

interface GitHubDiscussionComment {
	id: number;
	body?: string;
	html_url?: string;
	created_at?: string;
	updated_at?: string;
	user?: {
		login?: string;
		html_url?: string;
	};
	reactions?: Record<string, number | undefined>;
}

const DISCUSSION_COMMENTS_URL =
	"https://api.github.com/repos/pfrankov/obsidian-local-gpt/discussions/89/comments";
const PER_PAGE = 100;
const SEPARATOR = "✂️";
const POSITIVE_REACTIONS = [
	"+1",
	"heart",
	"hooray",
	"rocket",
	"eyes",
	"laugh",
] as const;
const NEGATIVE_REACTIONS = ["-1", "confused"] as const;
const FIELD_KEYS = ["name", "system", "prompt", "language", "replace"];
const FIELD_REGEX = new RegExp(
	`(?:^|\\n)\\s*(${FIELD_KEYS.join("|")}):\\s*([\\s\\S]*?)(?=\\n\\s*(?:${FIELD_KEYS.join(
		"|",
	)}):|$)`,
	"gi",
);
export const buildCommunityActionSignature = (action: {
	system?: string;
	prompt?: string;
	replace?: boolean;
}): string =>
	[action.system ?? "", action.prompt ?? "", action.replace ? "1" : "0"].join(
		"\n---\n",
	);

export const buildCommunityActionKey = (
	language: string,
	name: string,
): string => `${language.trim().toLowerCase()}::${name.trim().toLowerCase()}`;

export class CommunityActionsService {
	private static cache: CommunityAction[] | null = null;
	private static pendingRequest: Promise<CommunityAction[]> | undefined;
	private static readonly HTML_TAG_REGEX = /<[^>]*>/g;

	static async getCommunityActions(options?: {
		forceRefresh?: boolean;
	}): Promise<CommunityAction[]> {
		const forceRefresh = options?.forceRefresh ?? false;

		if (this.cache && !forceRefresh) {
			return this.cache;
		}

		if (this.pendingRequest) {
			return this.pendingRequest;
		}

		const fallback = this.cache;

		this.pendingRequest = (async () => {
			const { actions, failed } = await this.fetchCommunityActions();
			if (failed) {
				if (fallback) {
					this.cache = fallback;
					return fallback;
				}
				throw new Error("Failed to fetch community actions");
			}
			this.cache = actions;
			return actions;
		})().finally(() => {
			this.pendingRequest = undefined;
		});

		return this.pendingRequest;
	}

	static clearCache(): void {
		this.cache = null;
		this.pendingRequest = undefined;
	}

	private static async fetchCommunityActions(): Promise<{
		actions: CommunityAction[];
		failed: boolean;
	}> {
		const actions = await this.collectActions(
			1,
			[],
			new Set<string>(),
			new Map<string, Set<string>>(),
		);

		if (!actions) {
			return { actions: [], failed: true };
		}

		const sorted = actions
			.sort((a, b) => {
				if (a.score === b.score) {
					return a.order - b.order;
				}
				return b.score - a.score;
			})
			.map(({ order: _order, ...action }) => action);

		return { actions: sorted, failed: false };
	}

	private static async collectActions(
		page: number,
		actions: Array<CommunityAction & { order: number }>,
		uniqueKeys: Set<string>,
		uniqueContentKeys: Map<string, Set<string>>,
	): Promise<Array<CommunityAction & { order: number }> | null> {
		const response = await this.requestPage(page);
		if (!response) {
			return page === 1 ? null : actions;
		}

		const comments = (response.json ?? []) as GitHubDiscussionComment[];
		if (!comments.length) {
			return actions;
		}

		this.appendActionsFromComments(
			comments,
			actions,
			uniqueKeys,
			uniqueContentKeys,
		);

		if (comments.length < PER_PAGE) {
			return actions;
		}

		return this.collectActions(
			page + 1,
			actions,
			uniqueKeys,
			uniqueContentKeys,
		);
	}

	private static async requestPage(page: number) {
		try {
			const response = await requestUrl({
				url: `${DISCUSSION_COMMENTS_URL}?per_page=${PER_PAGE}&page=${page}&sort=created&direction=asc`,
				headers: {
					Accept: "application/vnd.github+json",
				},
				throw: false,
			});
			if (response.status !== 200) {
				console.error(
					`GitHub API responded with ${response.status} on page ${page}`,
				);
				return null;
			}
			return response;
		} catch (error) {
			console.error("Failed to fetch community actions", error);
			return null;
		}
	}

	private static appendActionsFromComments(
		comments: GitHubDiscussionComment[],
		actions: Array<CommunityAction & { order: number }>,
		uniqueKeys: Set<string>,
		uniqueContentKeys: Map<string, Set<string>>,
	) {
		for (const comment of comments) {
			const parsedAction = this.extractActionFromBody(comment.body || "");
			if (!parsedAction) {
				continue;
			}

			const languageKey = parsedAction.language.trim().toLowerCase();
			const normalizedKey = buildCommunityActionKey(
				languageKey,
				parsedAction.name,
			);
			if (uniqueKeys.has(normalizedKey)) {
				continue;
			}
			const signatureKey = this.buildSimilaritySignature(parsedAction);
			const languageSignatures =
				uniqueContentKeys.get(languageKey) ?? new Set<string>();
			if (languageSignatures.has(signatureKey)) {
				continue;
			}
			uniqueKeys.add(normalizedKey);
			languageSignatures.add(signatureKey);
			uniqueContentKeys.set(languageKey, languageSignatures);

			const score = this.getReactionScore(comment.reactions);

			actions.push({
				id: `${comment.id}`,
				name: parsedAction.name,
				language: parsedAction.language,
				description: parsedAction.description,
				prompt: parsedAction.prompt,
				system: parsedAction.system,
				replace: parsedAction.replace,
				author: comment.user?.login || "unknown",
				authorUrl: comment.user?.html_url,
				commentUrl: comment.html_url,
				score,
				createdAt: comment.created_at,
				updatedAt: comment.updated_at,
				order: actions.length,
			});
		}
	}

	private static normalizeFieldValue(
		value: string | undefined,
	): string | undefined {
		if (!value) {
			return undefined;
		}
		const cleaned = value.trim();
		if (!cleaned) {
			return undefined;
		}
		return cleaned;
	}

	private static normalizeSingleLine(
		value: string | undefined,
	): string | undefined {
		if (!value) {
			return undefined;
		}
		const firstLine = value.split("\n")[0].trim();
		if (!firstLine) {
			return undefined;
		}
		return firstLine;
	}

	private static extractActionFromBody(body: string): {
		name: string;
		language: string;
		description?: string;
		prompt?: string;
		system?: string;
		replace?: boolean;
	} | null {
		if (!body) {
			return null;
		}

		const normalizedBody = this.normalizeBody(body);
		if (!normalizedBody.trim()) {
			return null;
		}
		const splitBody = this.splitBodyByDescriptionSeparator(normalizedBody);
		if (!splitBody) {
			return null;
		}
		const fields = this.extractFields(splitBody.fieldsBody);
		return this.buildActionFromFields(fields, splitBody.description);
	}

	private static normalizeBody(body: string): string {
		return this.sanitizePlainText(body)
			.split(SEPARATOR)
			.join("\n")
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n");
	}

	private static splitBodyByDescriptionSeparator(normalizedBody: string): {
		description?: string;
		fieldsBody: string;
	} | null {
		const separatorRegex = /^\s*---\s*$/m;
		const match = separatorRegex.exec(normalizedBody);
		if (!match || typeof match.index !== "number") {
			return null;
		}

		const descriptionBody = normalizedBody.slice(0, match.index).trim();
		const fieldsBody = normalizedBody
			.slice(match.index + match[0].length)
			.trim();

		return {
			description: this.normalizeFieldValue(descriptionBody),
			fieldsBody,
		};
	}

	private static extractFields(fieldsBody: string): Record<string, string> {
		const fields: Record<string, string> = {};
		let fieldMatch: RegExpExecArray | null;

		FIELD_REGEX.lastIndex = 0;
		while ((fieldMatch = FIELD_REGEX.exec(fieldsBody)) !== null) {
			const key = fieldMatch[1].toLowerCase();
			if (!FIELD_KEYS.includes(key) || fields[key]) {
				continue;
			}
			const value = this.normalizeFieldValue(fieldMatch[2]);
			if (!value) {
				continue;
			}
			fields[key] = value;
		}

		return fields;
	}

	private static buildActionFromFields(
		fields: Record<string, string>,
		description?: string,
	): {
		name: string;
		language: string;
		description?: string;
		prompt?: string;
		system?: string;
		replace?: boolean;
	} | null {
		const name = this.normalizeSingleLine(fields.name);
		const language = this.normalizeSingleLine(
			fields.language,
		)?.toLowerCase();
		const system = fields.system;
		const prompt = fields.prompt;
		const replace = fields.replace
			? fields.replace.toLowerCase() === "true"
			: undefined;

		if (!name || !language) {
			return null;
		}

		if (!system && !prompt) {
			return null;
		}

		return {
			name,
			language,
			description: description || undefined,
			system: system || undefined,
			prompt: prompt || undefined,
			replace,
		};
	}

	private static getReactionScore(
		reactions?: GitHubDiscussionComment["reactions"],
	): number {
		if (!reactions) {
			return 0;
		}
		const positive = POSITIVE_REACTIONS.reduce((total, key) => {
			return total + (reactions[key] ?? 0);
		}, 0);
		const negative = NEGATIVE_REACTIONS.reduce((total, key) => {
			return total + (reactions[key] ?? 0);
		}, 0);
		return positive - negative;
	}

	private static sanitizePlainText(value: string): string {
		const withoutTags = value
			.replace(this.HTML_TAG_REGEX, "")
			.replace(/[<>]/g, "");
		const output: string[] = [];
		for (let index = 0; index < withoutTags.length; index += 1) {
			const code = withoutTags.charCodeAt(index);
			if (code === 0x09 || code === 0x0a || code === 0x0d) {
				output.push(withoutTags[index]);
				continue;
			}
			if (code < 0x20 || code === 0x7f) {
				continue;
			}
			output.push(withoutTags[index]);
		}
		return output.join("");
	}

	private static buildSimilaritySignature(action: {
		system?: string;
		prompt?: string;
		replace?: boolean;
	}): string {
		const system = this.normalizeForSimilarity(action.system);
		const prompt = this.normalizeForSimilarity(action.prompt);
		const replace = action.replace ? "1" : "0";
		return `${system}\n---\n${prompt}\n---\n${replace}`;
	}

	private static normalizeForSimilarity(value?: string): string {
		if (!value) {
			return "";
		}
		const cleaned = this.sanitizePlainText(value);
		return cleaned
			.normalize("NFKD")
			.replace(/\p{M}/gu, "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
	}
}
