import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchDocuments } from "../src/rag";
import { IAIDocument, IAIProvidersRetrievalResult } from "../src/interfaces";
import { logger } from "../src/logger";

vi.mock("obsidian");
vi.mock("../src/processors/pdf");
vi.mock("../src/indexedDB");
vi.mock("../src/logger");
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
	getDocument: vi.fn(),
	GlobalWorkerOptions: {
		workerPort: null,
	},
}));

const mockAIProviders = {
	retrieve: vi.fn(),
};

const mockEmbeddingProvider = {
	id: "test-embedding-provider",
	name: "Test Embedding Provider",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockAIProviders.retrieve.mockReset();
});

describe("searchDocuments", () => {
	it("should call aiProviders.retrieve and format results", async () => {
		const query = "test query";
		const documents: IAIDocument[] = [
			{
				content: "Test content 1",
				meta: { basename: "file1", stat: { ctime: 1000 } },
			},
			{
				content: "Test content 2",
				meta: { basename: "file2", stat: { ctime: 2000 } },
			},
		];

		const mockResults: IAIProvidersRetrievalResult[] = [
			{
				content: "Relevant content 1",
				score: 0.9,
				document: documents[0],
			},
			{
				content: "Relevant content 2",
				score: 0.7,
				document: documents[1],
			},
		];

		mockAIProviders.retrieve.mockResolvedValue(mockResults);
		const mockUpdateCompletedSteps = vi.fn();
		const abortController = new AbortController();

		const result = await searchDocuments(
			query,
			documents,
			mockAIProviders,
			mockEmbeddingProvider,
			abortController,
			mockUpdateCompletedSteps,
			vi.fn(),
			10000,
		);

		expect(mockAIProviders.retrieve).toHaveBeenCalledWith(
			expect.objectContaining({
				query,
				documents,
				embeddingProvider: mockEmbeddingProvider,
			}),
		);
		expect(mockUpdateCompletedSteps).toHaveBeenCalledWith(1);
		expect(result).toContain("[[file2]]");
		expect(result).toContain("[[file1]]");
		expect(result).toContain("Relevant content 1");
		expect(result).toContain("Relevant content 2");
	});

	it("should return empty string when aborted", async () => {
		const abortController = new AbortController();
		abortController.abort();

		const result = await searchDocuments(
			"query",
			[],
			mockAIProviders,
			mockEmbeddingProvider,
			abortController,
			vi.fn(),
			vi.fn(),
			10000,
		);

		expect(result).toBe("");
		expect(mockAIProviders.retrieve).not.toHaveBeenCalled();
	});

	it("should handle errors gracefully", async () => {
		mockAIProviders.retrieve.mockRejectedValue(new Error("Retrieval failed"));
		const abortController = new AbortController();
		const consoleSpy = vi.spyOn(console, "error").mockImplementation();

		const result = await searchDocuments(
			"query",
			[],
			mockAIProviders,
			mockEmbeddingProvider,
			abortController,
			vi.fn(),
			vi.fn(),
			10000,
		);

		expect(result).toBe("");
		expect(consoleSpy).toHaveBeenCalledWith(
			"Error in searchDocuments:",
			expect.any(Error),
		);
		consoleSpy.mockRestore();
	});

	it("should suppress console errors for not-implemented retrieval (501)", async () => {
		const notImplementedError = Object.assign(
			new Error("Request failed, status 501"),
			{ status: 501 },
		);
		mockAIProviders.retrieve.mockRejectedValue(notImplementedError);
		const abortController = new AbortController();
		const consoleSpy = vi.spyOn(console, "error").mockImplementation();

		const result = await searchDocuments(
			"query",
			[],
			mockAIProviders,
			mockEmbeddingProvider,
			abortController,
			vi.fn(),
			vi.fn(),
			10000,
		);

		expect(result).toBe("");
		expect(consoleSpy).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(
			"RAG retrieval is not supported by the selected provider; skipping context retrieval",
			notImplementedError,
		);
		consoleSpy.mockRestore();
	});

	it("should return empty string when aborted during error", async () => {
		const abortController = new AbortController();
		mockAIProviders.retrieve.mockImplementation(() => {
			abortController.abort();
			return Promise.reject(new Error("Aborted"));
		});

		const result = await searchDocuments(
			"query",
			[],
			mockAIProviders,
			mockEmbeddingProvider,
			abortController,
			vi.fn(),
			vi.fn(),
			10000,
		);

		expect(result).toBe("");
	});
});

describe("formatResults (internal function)", () => {
	// Since formatResults is not exported, we test it through searchDocuments
	it("should format results with proper grouping and sorting", async () => {
		const documents: IAIDocument[] = [
			{
				content: "Content from file1",
				meta: { basename: "file1", stat: { ctime: 3000 } },
			},
			{
				content: "Content from file2",
				meta: { basename: "file2", stat: { ctime: 1000 } },
			},
		];

		const mockResults: IAIProvidersRetrievalResult[] = [
			{
				content: "High score content from file1",
				score: 0.9,
				document: documents[0],
			},
			{
				content: "Low score content from file1",
				score: 0.3,
				document: documents[0],
			},
			{
				content: "Medium score content from file2",
				score: 0.6,
				document: documents[1],
			},
		];

		mockAIProviders.retrieve.mockResolvedValue(mockResults);

		const result = await searchDocuments(
			"query",
			documents,
			mockAIProviders,
			mockEmbeddingProvider,
			new AbortController(),
			vi.fn(),
			vi.fn(),
			10000,
		);

		// Should be sorted by file creation time (newer first)
		const file1Index = result.indexOf("[[file1]]");
		const file2Index = result.indexOf("[[file2]]");
		expect(file1Index).toBeLessThan(file2Index);

		// Within each file, should be sorted by score (higher first)
		const highScoreIndex = result.indexOf("High score content from file1");
		const lowScoreIndex = result.indexOf("Low score content from file1");
		expect(highScoreIndex).toBeLessThan(lowScoreIndex);
	});

	describe("Context limit presets", () => {
		const presetCases = [
			{ preset: undefined, expectedChunks: 1, label: "default (no preset)" },
			{ preset: "local", expectedChunks: 1, label: "local" },
			{ preset: "cloud", expectedChunks: 6, label: "cloud" },
			{ preset: "advanced", expectedChunks: 19, label: "advanced" },
			{ preset: "max", expectedChunks: 25, label: "max" },
		];

		const makeResults = (doc: IAIDocument) =>
			Array.from({ length: 25 }, () => ({
				content: "A".repeat(5000),
				score: 0.5,
				document: doc,
			})) as unknown as IAIProvidersRetrievalResult[];

		for (const { preset, expectedChunks, label } of presetCases) {
			it(`should respect preset: ${label}`, async () => {
				const map: Record<string, number> = {
					local: 10000,
					cloud: 32000,
					advanced: 100000,
					max: 3000000,
				};
				const limit = preset ? map[preset] : 10000;

				const doc: IAIDocument = {
					content: "irrelevant",
					meta: { basename: "fileX", stat: { ctime: 1 } },
				};

				const mocked = makeResults(doc);
				mockAIProviders.retrieve.mockResolvedValue(mocked);

				const result = await searchDocuments(
					"query",
					[doc],
					mockAIProviders,
					mockEmbeddingProvider,
					new AbortController(),
					vi.fn(),
					vi.fn(),
					limit,
				);

				// Count A's equals number of included chunks * 5000
				const aCount = (result.match(/A/g) || []).length;
				expect(aCount).toBe(expectedChunks * 5000);
			});
		}
	});

	it("should handle empty results", async () => {
		mockAIProviders.retrieve.mockResolvedValue([]);

		const result = await searchDocuments(
			"query",
			[],
			mockAIProviders,
			mockEmbeddingProvider,
			new AbortController(),
			vi.fn(),
			vi.fn(),
			10000,
		);

		expect(result).toBe("");
	});

	it("should respect context limit", async () => {
		const longContent = "A".repeat(5000);
		const documents: IAIDocument[] = [
			{
				content: longContent,
				meta: { basename: "file1", stat: { ctime: 1000 } },
			},
		];

		const mockResults: IAIProvidersRetrievalResult[] = [
			{
				content: longContent,
				score: 0.9,
				document: documents[0],
			},
			{
				content: longContent,
				score: 0.8,
				document: documents[0],
			},
		];

		mockAIProviders.retrieve.mockResolvedValue(mockResults);

		const result = await searchDocuments(
			"query",
			documents,
			mockAIProviders,
			mockEmbeddingProvider,
			new AbortController(),
			vi.fn(),
			vi.fn(),
			10000,
		);

		// Should not exceed reasonable length due to context limit
		expect(result.length).toBeLessThan(15000); // Some buffer for formatting
	});

	it("handles zero context limit with missing timestamps", async () => {
		const documents: IAIDocument[] = [
			{ content: "Doc body", meta: { basename: "first", stat: {} } },
			{ content: "Other doc", meta: { basename: "second", stat: {} } },
		];

		mockAIProviders.retrieve.mockResolvedValue([
			{ content: "One", score: 0.9, document: documents[0] },
			{ content: "Two", score: 0.8, document: documents[1] },
		] as unknown as IAIProvidersRetrievalResult[]);

		const result = await searchDocuments(
			"query",
			documents,
			mockAIProviders,
			mockEmbeddingProvider,
			new AbortController(),
			vi.fn(),
			vi.fn(),
			0,
		);

		expect(result).toBe("");
	});

	it("tracks progress updates during searchDocuments", async () => {
		const documents: IAIDocument[] = [
			{
				content: "Doc body",
				meta: { basename: "file-track", stat: { ctime: 1 } },
			},
		];
		const mockUpdate = vi.fn();
		const mockAddTotal = vi.fn();

		mockAIProviders.retrieve.mockImplementation(async ({ onProgress }) => {
			onProgress({ totalChunks: 2, processedChunks: [1] });
			onProgress({ totalChunks: 2, processedChunks: [1, 2] });
			return [
				{
					content: "Snippet",
					score: 0.9,
					document: documents[0],
				},
			];
		});

		const result = await searchDocuments(
			"query",
			documents,
			mockAIProviders,
			mockEmbeddingProvider,
			new AbortController(),
			mockUpdate,
			mockAddTotal,
			10000,
		);

		expect(mockAddTotal).toHaveBeenCalledWith(2);
		expect(mockUpdate).toHaveBeenCalledWith(1);
		expect(result).toContain("[[file-track]]");
	});

	it("stops processing progress updates after abort", async () => {
		const documents: IAIDocument[] = [
			{
				content: "Doc body",
				meta: { basename: "file-track", stat: { ctime: 1 } },
			},
		];
		const mockUpdate = vi.fn();
		const abortController = new AbortController();

		mockAIProviders.retrieve.mockImplementation(async ({ onProgress }) => {
			onProgress({ totalChunks: 2, processedChunks: [1] });
			onProgress({ totalChunks: 2, processedChunks: [1] });
			abortController.abort();
			onProgress({ totalChunks: 2, processedChunks: [1, 2] });
			return [
				{
					content: "Snippet",
					score: 0.9,
					document: documents[0],
				},
			];
		});

		const result = await searchDocuments(
			"query",
			documents,
			mockAIProviders,
			mockEmbeddingProvider,
			abortController,
			mockUpdate,
			undefined as any,
			10000,
		);

		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(result).toContain("[[file-track]]");
	});

	it("handles progress events without totals or new chunks", async () => {
		const documents: IAIDocument[] = [
			{ content: "Doc body", meta: { basename: "file-zero", stat: {} } },
		];
		const mockUpdate = vi.fn();
		const mockAddTotal = vi.fn();

		mockAIProviders.retrieve.mockImplementation(async ({ onProgress }) => {
			onProgress({ processedChunks: [] });
			return [
				{
					content: "Snippet",
					score: 0.9,
					document: documents[0],
				},
			];
		});

		const result = await searchDocuments(
			"query",
			documents,
			mockAIProviders,
			mockEmbeddingProvider,
			new AbortController(),
			mockUpdate,
			mockAddTotal,
			10000,
		);

		expect(mockAddTotal).toHaveBeenCalledWith(0);
		expect(mockUpdate).not.toHaveBeenCalled();
		expect(result).toContain("[[file-zero]]");
	});
});
