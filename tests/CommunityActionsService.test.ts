import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestUrl = vi.fn();

vi.mock("obsidian", () => ({
	requestUrl: mockRequestUrl,
}));

let CommunityActionsService: typeof import("../src/CommunityActionsService").CommunityActionsService;

const baseComment = {
	id: 15532029,
	html_url:
		"https://github.com/pfrankov/obsidian-local-gpt/discussions/89#discussioncomment-15532029",
	user: {
		login: "pfrankov",
		html_url: "https://github.com/pfrankov",
	},
	reactions: {
		"+1": 2,
		"-1": 1,
		laugh: 0,
		hooray: 0,
		confused: 0,
		heart: 0,
		rocket: 0,
		eyes: 0,
	},
};

const sampleBodyFields =
	"Name: ✍️ Continue writing ✂️\r\n" +
	"System: You are an AI assistant that follows instruction extremely well. Help as much as you can. ✂️\r\n" +
	"Prompt: Act as a professional editor with many years of experience as a writer. Carefully finalize the following text. ✂️\r\n" +
	"Language: en";
const sampleBody = `---\r\n${sampleBodyFields}`;
const sampleBodyWithoutSeparator = sampleBodyFields;
const sampleDescription =
	"Finalizes and expands text as a professional editor while preserving the original tone.";
const sampleBodyWithDescription =
	`${sampleDescription}\r\n${sampleBody}`;
const htmlBody =
	"---\n" +
	"Name: <b>Safe name</b> ✂️\n" +
	"System: <script>alert('x')</script> ✂️\n" +
	"Prompt: Use <img src=x onerror=alert(1)> text ✂️\n" +
	"Language: en";

describe("CommunityActionsService", () => {
	beforeEach(async () => {
		({ CommunityActionsService } = await import(
			"../src/CommunityActionsService"
		));
		CommunityActionsService.clearCache();
		localStorage.clear();
		mockRequestUrl.mockReset();
	});

	it("parses actions from discussion comments", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					body: sampleBodyWithDescription,
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(1);
		expect(actions[0].name).toBe("✍️ Continue writing");
		expect(actions[0].language).toBe("en");
		expect(actions[0].description).toBe(sampleDescription);
		expect(actions[0].system).toContain("You are an AI assistant");
		expect(actions[0].prompt).toContain("Act as a professional editor");
		expect(actions[0].score).toBe(1);
	});

	it("falls back when description is missing", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					body: sampleBody,
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(1);
		expect(actions[0].description).toBeUndefined();
	});

	it("drops actions without the --- separator", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					body: sampleBodyWithoutSeparator,
				},
				{
					...baseComment,
					id: 99,
					body: sampleBody,
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(1);
		expect(actions[0].name).toBe("✍️ Continue writing");
	});
	it("splits description from fields using the --- separator", async () => {
		const body =
			"Name: This is description, not a field\n" +
			"Another description line.\n" +
			"---\n" +
			"Name: Parsed action ✂️\n" +
			"System: System prompt ✂️\n" +
			"Prompt: Prompt text ✂️\n" +
			"Language: en";

		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					id: 4,
					body,
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(1);
		expect(actions[0].name).toBe("Parsed action");
		expect(actions[0].description).toBe(
			"Name: This is description, not a field\nAnother description line.",
		);
	});

	it("keeps only the first action per language and name", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					id: 1,
					body: sampleBody,
				},
				{
					...baseComment,
					id: 2,
					body: sampleBody.replace(
						"Act as a professional editor",
						"Second prompt",
					),
				},
				{
					...baseComment,
					id: 3,
					body: sampleBody.replace("Language: en", "Language: ru"),
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(2);
		const englishAction = actions.find(
			(action) => action.language === "en",
		);
		const russianAction = actions.find(
			(action) => action.language === "ru",
		);
		expect(englishAction?.prompt).toContain("Act as a professional editor");
		expect(russianAction?.name).toBe("✍️ Continue writing");
	});

	it("ignores comments without required fields", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					id: 10,
					body: "---\nName: Missing language ✂️ Prompt: Test",
				},
				{
					...baseComment,
					id: 11,
					body: "---\nLanguage: en ✂️ Prompt: Missing name",
				},
				{
					...baseComment,
					id: 12,
					body: "---\nName: Missing prompt ✂️ Language: en",
				},
				{
					...baseComment,
					id: 13,
					body: sampleBody,
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(1);
		expect(actions[0].name).toBe("✍️ Continue writing");
	});

	it("sanitizes HTML tags from fields", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					id: 20,
					body: htmlBody,
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(1);
		expect(actions[0].name).toBe("Safe name");
		expect(actions[0].system).toBe("alert('x')");
		expect(actions[0].prompt).toBe("Use  text");
	});

	it("drops actions when required fields are empty after sanitization", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					id: 21,
					body: "---\nName: <img src=x> ✂️ Prompt: Test ✂️ Language: en",
				},
				{
					...baseComment,
					id: 22,
					body: sampleBody,
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(1);
		expect(actions[0].name).toBe("✍️ Continue writing");
	});

	it("deduplicates near-identical actions by prompt+system per language", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: [
				{
					...baseComment,
					id: 30,
					body: sampleBody,
				},
				{
					...baseComment,
					id: 31,
					body: sampleBody
						.replace("✍️ Continue writing", "Another name")
						.replace(
							"Act as a professional editor",
							"Act as a professional editor!!!",
						),
				},
				{
					...baseComment,
					id: 32,
					body: sampleBody
						.replace("✍️ Continue writing", "Another unique name")
						.replace(
							"Act as a professional editor",
							"Summarize the following text",
						),
				},
			],
		});

		const actions = await CommunityActionsService.getCommunityActions({
			forceRefresh: true,
		});

		expect(actions).toHaveLength(2);
		expect(actions[0].name).toBe("✍️ Continue writing");
		expect(actions[1].prompt).toContain("Summarize the following text");
	});
});
