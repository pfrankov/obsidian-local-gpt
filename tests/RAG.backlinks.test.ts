import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ProcessingContext,
	searchDocuments,
	startProcessing,
} from "../src/rag";
import { IAIDocument, IAIProvidersRetrievalResult } from "../src/interfaces";
import { MetadataCache, TFile, Vault } from "obsidian";
import * as ragModule from "../src/rag";

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

describe("getBacklinkFiles", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("should find backlink files from resolved links", () => {
		const mockFile = new TFile();
		mockFile.path = "target.md";
		mockFile.extension = "md";

		const mockBacklink1 = new TFile();
		mockBacklink1.path = "backlink1.md";
		mockBacklink1.extension = "md";
		const mockBacklink2 = new TFile();
		mockBacklink2.path = "backlink2.md";
		mockBacklink2.extension = "md";

		const getAbstractFileByPath = vi.fn().mockImplementation((path: string) => {
			if (path === "backlink1.md") return mockBacklink1;
			if (path === "backlink2.md") return mockBacklink2;
			return null;
		});
		const mockContext = {
			vault: {
				getAbstractFileByPath,
			} as unknown as Vault,
			metadataCache: Object.assign(new MetadataCache(), {
				resolvedLinks: {
					"backlink1.md": { "target.md": 1 },
					"backlink2.md": { "target.md": 1 },
					"other.md": { "different.md": 1 },
				},
			}),
			activeFile: { path: "active.md" } as TFile,
		} as ProcessingContext;

		const processedDocs = new Map<string, IAIDocument>();

		const backlinkFiles = ragModule.getBacklinkFiles(
			mockFile,
			mockContext,
			processedDocs,
		);

		expect(backlinkFiles.map((f: any) => f.path)).toEqual([
			"backlink1.md",
			"backlink2.md",
		]);
		expect(getAbstractFileByPath).toHaveBeenCalledTimes(2);
	});

	it("should exclude already processed documents", () => {
		const mockFile = new TFile();
		mockFile.path = "target.md";
		mockFile.extension = "md";

		const mockBacklink1 = new TFile();
		mockBacklink1.path = "backlink1.md";
		mockBacklink1.extension = "md";

		const getAbstractFileByPath = vi.fn().mockImplementation((path: string) => {
			if (path === "backlink1.md") return mockBacklink1;
			return null;
		});
		const mockContext = {
			vault: {
				getAbstractFileByPath,
			} as unknown as Vault,
			metadataCache: Object.assign(new MetadataCache(), {
				resolvedLinks: {
					"backlink1.md": { "target.md": 1 },
					"backlink2.md": { "target.md": 1 },
				},
			}),
			activeFile: { path: "active.md" } as TFile,
		} as ProcessingContext;

		const processedDocs = new Map();
		processedDocs.set("backlink2.md", {
			content: "Already processed",
			meta: {
				source: "backlink2.md",
				basename: "backlink2",
				stat: { ctime: 1000 },
				depth: 0,
				isBacklink: false,
			},
		});

		const backlinkFiles = ragModule.getBacklinkFiles(
			mockFile,
			mockContext,
			processedDocs,
		);

		expect(backlinkFiles.map((f: any) => f.path)).toEqual(["backlink1.md"]);
		expect(getAbstractFileByPath).toHaveBeenCalledTimes(1);
	});

	describe("Progress tracking", () => {
		it("should call updateCompletedSteps for each processed file in startProcessing", async () => {
			const mockLinkedFiles = [
				{
					path: "file1.md",
					extension: "md",
					basename: "file1",
					stat: { ctime: 1000 },
				} as TFile,
				{
					path: "file2.md",
					extension: "md",
					basename: "file2",
					stat: { ctime: 2000 },
				} as TFile,
				{
					path: "file3.md",
					extension: "md",
					basename: "file3",
					stat: { ctime: 3000 },
				} as TFile,
			];
			const mockVault = {
				cachedRead: vi.fn().mockResolvedValue("Mock content"),
			} as unknown as Vault;
			const mockMetadataCache = new MetadataCache();
			const mockActiveFile = { path: "active.md" } as TFile;
			const mockUpdateCompletedSteps = vi.fn();

			vi.spyOn(ragModule, "getLinkedFiles").mockReturnValue([]);
			vi.spyOn(ragModule, "getBacklinkFiles").mockReturnValue([]);

			await startProcessing(
				mockLinkedFiles,
				mockVault,
				mockMetadataCache,
				mockActiveFile,
				mockUpdateCompletedSteps,
				false,
			);

			expect(mockUpdateCompletedSteps).toHaveBeenCalledTimes(3);
			expect(mockUpdateCompletedSteps).toHaveBeenCalledWith(1);
		});

		it("should work without updateCompletedSteps callback in startProcessing", async () => {
			const mockLinkedFiles = [
				{
					path: "file1.md",
					extension: "md",
					basename: "file1",
					stat: { ctime: 1000 },
				} as TFile,
			];
			const mockVault = {
				cachedRead: vi.fn().mockResolvedValue("Mock content"),
			} as unknown as Vault;
			const mockMetadataCache = new MetadataCache();
			const mockActiveFile = { path: "active.md" } as TFile;

			vi.spyOn(ragModule, "getLinkedFiles").mockReturnValue([]);
			vi.spyOn(ragModule, "getBacklinkFiles").mockReturnValue([]);

			// Should not throw when callback is not provided
			const result = await startProcessing(
				mockLinkedFiles,
				mockVault,
				mockMetadataCache,
				mockActiveFile,
				undefined,
				false,
			);

			expect(result.size).toBe(1);
		});

		it("should call updateCompletedSteps once in searchDocuments", async () => {
			const query = "test query";
			const documents: IAIDocument[] = [
				{
					content: "Test content",
					meta: { basename: "file1", stat: { ctime: 1000 } },
				},
			];

			const mockResults: IAIProvidersRetrievalResult[] = [
				{
					content: "Relevant content",
					score: 0.9,
					document: documents[0],
				},
			];

			mockAIProviders.retrieve.mockResolvedValue(mockResults);
			const mockUpdateCompletedSteps = vi.fn();
			const abortController = new AbortController();

			await searchDocuments(
				query,
				documents,
				mockAIProviders,
				mockEmbeddingProvider,
				abortController,
				mockUpdateCompletedSteps,
				vi.fn(),
				10000,
			);

			expect(mockUpdateCompletedSteps).toHaveBeenCalledTimes(1);
			expect(mockUpdateCompletedSteps).toHaveBeenCalledWith(1);
		});

		it("should not call updateCompletedSteps when searchDocuments is aborted", async () => {
			const abortController = new AbortController();
			abortController.abort();
			const mockUpdateCompletedSteps = vi.fn();

			const result = await searchDocuments(
				"query",
				[],
				mockAIProviders,
				mockEmbeddingProvider,
				abortController,
				mockUpdateCompletedSteps,
				vi.fn(),
				10000,
			);

			expect(result).toBe("");
			expect(mockUpdateCompletedSteps).not.toHaveBeenCalled();
		});

		it("should not call updateCompletedSteps when searchDocuments encounters error", async () => {
			mockAIProviders.retrieve.mockRejectedValue(new Error("Retrieval failed"));
			const abortController = new AbortController();
			const mockUpdateCompletedSteps = vi.fn();
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const result = await searchDocuments(
				"query",
				[],
				mockAIProviders,
				mockEmbeddingProvider,
				abortController,
				mockUpdateCompletedSteps,
				vi.fn(),
				10000,
			);

			expect(result).toBe("");
			expect(mockUpdateCompletedSteps).not.toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});

	it("should return empty array when no backlinks exist", () => {
		const mockFile = new TFile();
		mockFile.path = "target.md";
		mockFile.extension = "md";

		const mockActiveFile = new TFile();
		mockActiveFile.path = "active.md";
		mockActiveFile.extension = "md";

		const mockContext: ProcessingContext = {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
			} as unknown as Vault,
			metadataCache: {
				resolvedLinks: {
					"other.md": { "different.md": 1 },
				},
			} as unknown as MetadataCache,
			activeFile: mockActiveFile,
			includeActiveFileContent: false,
		};
		const processedDocs = new Map<string, IAIDocument>();

		const backlinkFiles = ragModule.getBacklinkFiles(
			mockFile,
			mockContext,
			processedDocs,
		);

		expect(backlinkFiles).toHaveLength(0);
	});
});
