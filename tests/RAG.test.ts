import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	startProcessing,
	getLinkedFiles,
	getFileContent,
	processDocumentForRAG,
	ProcessingContext,
	searchDocuments
} from '../src/rag';
import { IAIDocument, IAIProvidersRetrievalResult } from '../src/interfaces';
import { extractTextFromPDF } from '../src/processors/pdf';
import { fileCache } from '../src/indexedDB';
import { TFile, Vault, MetadataCache } from 'obsidian';
import * as ragModule from '../src/rag';

vi.mock('obsidian');
vi.mock('../src/processors/pdf');
vi.mock('../src/indexedDB');
vi.mock('../src/logger');
vi.mock('pdfjs-dist', () => ({
	getDocument: vi.fn(),
	GlobalWorkerOptions: {
		workerPort: null
	}
}));

// Mock AI Providers SDK types and methods
const mockAIProviders = {
	retrieve: vi.fn()
};

const mockEmbeddingProvider = {
	id: 'test-embedding-provider',
	name: 'Test Embedding Provider'
};

describe('RAG Functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAIProviders.retrieve.mockReset();
	});

	describe('getFileContent', () => {
		it('should read MD files using vault.cachedRead', async () => {
			const mockFile = { extension: 'md' } as TFile;
			const mockVault = { cachedRead: vi.fn().mockResolvedValue('Markdown content') } as unknown as Vault;

			const content = await getFileContent(mockFile, mockVault);

			expect(content).toBe('Markdown content');
			expect(mockVault.cachedRead).toHaveBeenCalledWith(mockFile);
		});

		it('should extract text from PDF files', async () => {
			const mockFile = { extension: 'pdf', path: 'test.pdf', stat: { mtime: 1000 } } as TFile;
			const mockVault = { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)) } as unknown as Vault;
			(extractTextFromPDF as vi.Mock).mockResolvedValue('PDF content');
			(fileCache.getContent as vi.Mock).mockResolvedValue(null);

			const content = await getFileContent(mockFile, mockVault);

			expect(content).toBe('PDF content');
			expect(mockVault.readBinary).toHaveBeenCalledWith(mockFile);
			expect(extractTextFromPDF).toHaveBeenCalledWith(expect.any(ArrayBuffer));
			expect(fileCache.setContent).toHaveBeenCalledWith('test.pdf', {
				mtime: 1000,
				content: 'PDF content'
			});
		});

		it('should use cached PDF content when available and up to date', async () => {
			const mockFile = { extension: 'pdf', path: 'test.pdf', stat: { mtime: 1000 } } as TFile;
			const mockVault = { readBinary: vi.fn() } as unknown as Vault;
			(fileCache.getContent as vi.Mock).mockResolvedValue({
				mtime: 1000,
				content: 'Cached PDF content'
			});

			const content = await getFileContent(mockFile, mockVault);

			expect(content).toBe('Cached PDF content');
			expect(mockVault.readBinary).not.toHaveBeenCalled();
			expect(extractTextFromPDF).not.toHaveBeenCalled();
		});

		it('should handle default case for MD files', async () => {
			const mockFile = { extension: 'txt' } as TFile;
			const mockVault = { cachedRead: vi.fn().mockResolvedValue('Text content') } as unknown as Vault;

			const content = await getFileContent(mockFile, mockVault);

			expect(content).toBe('Text content');
			expect(mockVault.cachedRead).toHaveBeenCalledWith(mockFile);
		});
	});

	describe('getLinkedFiles', () => {
		it('should extract linked files from content', () => {
			const content = '[[File1.md]] and [[File2.pdf]] and [[File3.txt]]';
			
			// Create mock TFile instances using the new TFile class
			const mockFile1 = new TFile();
			mockFile1.path = 'File1.md';
			mockFile1.extension = 'md';
			
			const mockFile2 = new TFile();
			mockFile2.path = 'File2.pdf';
			mockFile2.extension = 'pdf';
			
			const mockFile3 = new TFile();
			mockFile3.path = 'File3.txt';
			mockFile3.extension = 'txt';
			
			const mockVault = {
				getAbstractFileByPath: vi.fn()
					.mockImplementation((path: string) => {
						if (path === 'File1.md') return mockFile1;
						if (path === 'File2.pdf') return mockFile2;
						if (path === 'File3.txt') return mockFile3;
						return null;
					})
			} as unknown as Vault;
			
			const mockMetadataCache = {
				getFirstLinkpathDest: vi.fn()
					.mockImplementation((linkText: string) => {
						if (linkText === 'File1.md') return { path: 'File1.md' };
						if (linkText === 'File2.pdf') return { path: 'File2.pdf' };
						if (linkText === 'File3.txt') return { path: 'File3.txt' };
						return null;
					})
			} as unknown as MetadataCache;
			const currentFilePath = 'current.md';

			const linkedFiles = getLinkedFiles(content, mockVault, mockMetadataCache, currentFilePath);

			expect(linkedFiles).toHaveLength(2); // Only md and pdf files
			expect(linkedFiles[0].extension).toBe('md');
			expect(linkedFiles[1].extension).toBe('pdf');
		});

		it('should handle files with unsupported extensions', () => {
			const content = '[[Unsupported.txt]]';
			const mockVault = {
				getAbstractFileByPath: vi.fn().mockReturnValue({ path: 'Unsupported.txt', extension: 'txt' })
			} as unknown as Vault;
			const mockMetadataCache = {
				getFirstLinkpathDest: vi.fn().mockReturnValue({ path: 'Unsupported.txt' }),
			} as unknown as MetadataCache;
			const currentFilePath = 'current.md';

			const linkedFiles = getLinkedFiles(content, mockVault, mockMetadataCache, currentFilePath);

			expect(linkedFiles).toHaveLength(0);
		});

		it('should handle links with sections and aliases', () => {
			const content = '[[File1.md#section|alias]]';
			
			const mockFile1 = new TFile();
			mockFile1.path = 'File1.md';
			mockFile1.extension = 'md';
			
			const mockVault = {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
					if (path === 'File1.md') return mockFile1;
					return null;
				})
			} as unknown as Vault;
			const mockMetadataCache = {
				getFirstLinkpathDest: vi.fn().mockImplementation((linkText: string) => {
					if (linkText === 'File1.md') return { path: 'File1.md' };
					return null;
				})
			} as unknown as MetadataCache;
			const currentFilePath = 'current.md';

			const linkedFiles = getLinkedFiles(content, mockVault, mockMetadataCache, currentFilePath);

			expect(linkedFiles).toHaveLength(1);
			expect(mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('File1.md', currentFilePath);
		});

		it('ignores unresolved links', () => {
			const content = '[[Missing.md]]';
			const mockVault = {
				getAbstractFileByPath: vi.fn(),
			} as unknown as Vault;
			const mockMetadataCache = {
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			} as unknown as MetadataCache;

			const linkedFiles = getLinkedFiles(content, mockVault, mockMetadataCache, 'current.md');

			expect(linkedFiles).toHaveLength(0);
			expect(mockVault.getAbstractFileByPath).not.toHaveBeenCalled();
		});
	});


	describe('startProcessing', () => {
		it('should process linked files and return a map of documents', async () => {
			const mockLinkedFiles = [
				{ path: 'file1.md', extension: 'md', basename: 'file1', stat: { ctime: 1000 } } as TFile,
				{ path: 'file2.md', extension: 'md', basename: 'file2', stat: { ctime: 2000 } } as TFile,
			];
			const mockVault = { cachedRead: vi.fn().mockResolvedValue('Mock content') } as unknown as Vault;
			const mockMetadataCache = new MetadataCache();
			const mockActiveFile = { path: 'active.md' } as TFile;

			vi.spyOn(ragModule, 'getLinkedFiles').mockReturnValue([]);
			vi.spyOn(ragModule, 'getBacklinkFiles').mockReturnValue([]);

			const result = await startProcessing(mockLinkedFiles, mockVault, mockMetadataCache, mockActiveFile);

			expect(result.size).toBe(2);
			expect(result.get('file1.md')).toBeDefined();
			expect(result.get('file2.md')).toBeDefined();
		});
	});

	describe('processDocumentForRAG', () => {
		it('should not process files beyond MAX_DEPTH', async () => {
			const mockFile = { path: 'deep.md', extension: 'md' } as TFile;
			const mockContext: ProcessingContext = {
				vault: new Vault(),
				metadataCache: new MetadataCache(),
				activeFile: { path: 'active.md' } as TFile,
			};
			const processedDocs = new Map<string, IAIDocument>();

			const result = await processDocumentForRAG(mockFile, mockContext, processedDocs, 11, false);

			expect(result.size).toBe(0);
		});

		it('should not process the active file', async () => {
			const mockFile = { path: 'active.md', extension: 'md' } as TFile;
			const mockContext: ProcessingContext = {
				vault: new Vault(),
				metadataCache: new MetadataCache(),
				activeFile: { path: 'active.md' } as TFile,
			};
			const processedDocs = new Map<string, IAIDocument>();

			const result = await processDocumentForRAG(mockFile, mockContext, processedDocs, 0, false);

			expect(result.size).toBe(0);
		});

		it('should not process already processed files', async () => {
			const mockFile = { path: 'processed.md', extension: 'md' } as TFile;
			const mockContext: ProcessingContext = {
				vault: new Vault(),
				metadataCache: new MetadataCache(),
				activeFile: { path: 'active.md' } as TFile,
			};
			const processedDocs = new Map<string, IAIDocument>();
			processedDocs.set('processed.md', {
				content: 'Already processed',
				meta: {
					source: 'processed.md',
					basename: 'processed',
					stat: { ctime: 1000 },
					depth: 0,
					isBacklink: false
				}
			});

			const result = await processDocumentForRAG(mockFile, mockContext, processedDocs, 0, false);

			expect(result.size).toBe(1); // Still has the original document
		});

		it('handles file processing errors gracefully', async () => {
			const mockFile = { path: 'error.md', extension: 'md' } as TFile;
			const mockContext: ProcessingContext = {
				vault: new Vault(),
				metadataCache: new MetadataCache(),
				activeFile: { path: 'active.md' } as TFile,
			};
			const processedDocs = new Map<string, IAIDocument>();
			const getFileContentSpy = vi
				.spyOn(ragModule, 'getFileContent')
				.mockRejectedValue(new Error('boom'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await processDocumentForRAG(
				mockFile,
				mockContext,
				processedDocs,
				0,
				false,
			);

			expect(result.size).toBe(0);
			expect(consoleSpy).toHaveBeenCalled();
			getFileContentSpy.mockRestore();
			consoleSpy.mockRestore();
		});

		it('processes linked and backlink files recursively', async () => {
			const rootFile = new TFile();
			rootFile.path = 'root.md';
			rootFile.extension = 'md';
			rootFile.basename = 'root';
			rootFile.stat = { ctime: 0 } as any;

			const linkedFile = new TFile();
			linkedFile.path = 'linked.md';
			linkedFile.extension = 'md';
			linkedFile.basename = 'linked';
			linkedFile.stat = { ctime: 1 } as any;

			const backlinkFile = new TFile();
			backlinkFile.path = 'back.md';
			backlinkFile.extension = 'md';
			backlinkFile.basename = 'back';
			backlinkFile.stat = { ctime: 2 } as any;
			const processedDocs = new Map<string, IAIDocument>();
			const mockContext: ProcessingContext = {
				vault: {
					cachedRead: vi.fn().mockResolvedValue('[[linked.md]]'),
					readBinary: vi.fn(),
					getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
						if (path === 'linked.md') return linkedFile;
						if (path === 'back.md') return backlinkFile;
						return null;
					}),
				} as unknown as Vault,
				metadataCache: {
					getFirstLinkpathDest: vi
						.fn()
						.mockImplementation((linkText: string) =>
							linkText === 'linked.md' ? { path: 'linked.md' } : null,
						),
					resolvedLinks: {
						'back.md': { 'root.md': 1 },
					},
				} as unknown as MetadataCache,
				activeFile: { path: 'active.md' } as TFile,
			};

			const result = await processDocumentForRAG(
				rootFile,
				mockContext,
				processedDocs,
				0,
				false,
			);

			expect(result.size).toBe(3);
			expect(result.get('linked.md')?.meta.isBacklink).toBe(false);
			expect(result.get('back.md')?.meta.isBacklink).toBe(true);
		});
	});


	describe('searchDocuments', () => {
		it('should call aiProviders.retrieve and format results', async () => {
			const query = 'test query';
			const documents: IAIDocument[] = [
				{
					content: 'Test content 1',
					meta: { basename: 'file1', stat: { ctime: 1000 } }
				},
				{
					content: 'Test content 2',
					meta: { basename: 'file2', stat: { ctime: 2000 } }
				}
			];

			const mockResults: IAIProvidersRetrievalResult[] = [
				{
					content: 'Relevant content 1',
					score: 0.9,
					document: documents[0]
				},
				{
					content: 'Relevant content 2',
					score: 0.7,
					document: documents[1]
				}
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
				10000
			);

			expect(mockAIProviders.retrieve).toHaveBeenCalledWith(expect.objectContaining({
				query,
				documents,
				embeddingProvider: mockEmbeddingProvider
			}));
			expect(mockUpdateCompletedSteps).toHaveBeenCalledWith(1);
			expect(result).toContain('[[file2]]');
			expect(result).toContain('[[file1]]');
			expect(result).toContain('Relevant content 1');
			expect(result).toContain('Relevant content 2');
		});

		it('should return empty string when aborted', async () => {
			const abortController = new AbortController();
			abortController.abort();

			const result = await searchDocuments(
				'query',
				[],
				mockAIProviders,
				mockEmbeddingProvider,
				abortController,
				vi.fn(),
				vi.fn(),
				10000
			);

			expect(result).toBe('');
			expect(mockAIProviders.retrieve).not.toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			mockAIProviders.retrieve.mockRejectedValue(new Error('Retrieval failed'));
			const abortController = new AbortController();
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation();

			const result = await searchDocuments(
				'query',
				[],
				mockAIProviders,
				mockEmbeddingProvider,
				abortController,
				vi.fn(),
				vi.fn(),
				10000
			);

			expect(result).toBe('');
			expect(consoleSpy).toHaveBeenCalledWith('Error in searchDocuments:', expect.any(Error));
			consoleSpy.mockRestore();
		});

		it('should return empty string when aborted during error', async () => {
			const abortController = new AbortController();
			mockAIProviders.retrieve.mockImplementation(() => {
				abortController.abort();
				return Promise.reject(new Error('Aborted'));
			});

			const result = await searchDocuments(
				'query',
				[],
				mockAIProviders,
				mockEmbeddingProvider,
				abortController,
				vi.fn(),
				vi.fn(),
				10000
			);

			expect(result).toBe('');
		});
	});

	describe('formatResults (internal function)', () => {
		// Since formatResults is not exported, we test it through searchDocuments
		it('should format results with proper grouping and sorting', async () => {
			const documents: IAIDocument[] = [
				{
					content: 'Content from file1',
					meta: { basename: 'file1', stat: { ctime: 3000 } }
				},
				{
					content: 'Content from file2',
					meta: { basename: 'file2', stat: { ctime: 1000 } }
				}
			];

			const mockResults: IAIProvidersRetrievalResult[] = [
				{
					content: 'High score content from file1',
					score: 0.9,
					document: documents[0]
				},
				{
					content: 'Low score content from file1',
					score: 0.3,
					document: documents[0]
				},
				{
					content: 'Medium score content from file2',
					score: 0.6,
					document: documents[1]
				}
			];

			mockAIProviders.retrieve.mockResolvedValue(mockResults);

			const result = await searchDocuments(
				'query',
				documents,
				mockAIProviders,
				mockEmbeddingProvider,
				new AbortController(),
				vi.fn(),
				vi.fn(),
				10000
			);

			// Should be sorted by file creation time (newer first)
			const file1Index = result.indexOf('[[file1]]');
			const file2Index = result.indexOf('[[file2]]');
			expect(file1Index).toBeLessThan(file2Index);

			// Within each file, should be sorted by score (higher first)
			const highScoreIndex = result.indexOf('High score content from file1');
			const lowScoreIndex = result.indexOf('Low score content from file1');
			expect(highScoreIndex).toBeLessThan(lowScoreIndex);
		});

		describe('Context limit presets', () => {
			const presetCases = [
				{ preset: undefined, expectedChunks: 1, label: 'default (no preset)' },
				{ preset: 'local', expectedChunks: 1, label: 'local' },
				{ preset: 'cloud', expectedChunks: 6, label: 'cloud' },
				{ preset: 'advanced', expectedChunks: 19, label: 'advanced' },
				{ preset: 'max', expectedChunks: 25, label: 'max' },
			];

			const makeResults = (doc: IAIDocument) =>
				Array.from({ length: 25 }, () => ({
					content: 'A'.repeat(5000),
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
						content: 'irrelevant',
						meta: { basename: 'fileX', stat: { ctime: 1 } },
					};

					const mocked = makeResults(doc);
					mockAIProviders.retrieve.mockResolvedValue(mocked);

					const result = await searchDocuments(
						'query',
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

		it('should handle empty results', async () => {
			mockAIProviders.retrieve.mockResolvedValue([]);

			const result = await searchDocuments(
				'query',
				[],
				mockAIProviders,
				mockEmbeddingProvider,
				new AbortController(),
				vi.fn(),
				vi.fn(),
				10000
			);

			expect(result).toBe('');
		});

		it('should respect context limit', async () => {
			const longContent = 'A'.repeat(5000);
			const documents: IAIDocument[] = [
				{
					content: longContent,
					meta: { basename: 'file1', stat: { ctime: 1000 } }
				}
			];

			const mockResults: IAIProvidersRetrievalResult[] = [
				{
					content: longContent,
					score: 0.9,
					document: documents[0]
				},
				{
					content: longContent,
					score: 0.8,
					document: documents[0]
				}
			];

			mockAIProviders.retrieve.mockResolvedValue(mockResults);

			const result = await searchDocuments(
				'query',
				documents,
				mockAIProviders,
				mockEmbeddingProvider,
				new AbortController(),
				vi.fn(),
				vi.fn(),
				10000
			);

			// Should not exceed reasonable length due to context limit
			expect(result.length).toBeLessThan(15000); // Some buffer for formatting
		});

		it('handles zero context limit with missing timestamps', async () => {
			const documents: IAIDocument[] = [
				{ content: 'Doc body', meta: { basename: 'first', stat: {} } },
				{ content: 'Other doc', meta: { basename: 'second', stat: {} } },
			];

			mockAIProviders.retrieve.mockResolvedValue([
				{ content: 'One', score: 0.9, document: documents[0] },
				{ content: 'Two', score: 0.8, document: documents[1] },
			] as unknown as IAIProvidersRetrievalResult[]);

			const result = await searchDocuments(
				'query',
				documents,
				mockAIProviders,
				mockEmbeddingProvider,
				new AbortController(),
				vi.fn(),
				vi.fn(),
				0,
			);

			expect(result).toBe('');
		});

		it('tracks progress updates during searchDocuments', async () => {
			const documents: IAIDocument[] = [
				{
					content: 'Doc body',
					meta: { basename: 'file-track', stat: { ctime: 1 } },
				},
			];
			const mockUpdate = vi.fn();
			const mockAddTotal = vi.fn();

			mockAIProviders.retrieve.mockImplementation(async ({ onProgress }) => {
				onProgress({ totalChunks: 2, processedChunks: [1] });
				onProgress({ totalChunks: 2, processedChunks: [1, 2] });
				return [
					{
						content: 'Snippet',
						score: 0.9,
						document: documents[0],
					},
				];
			});

			const result = await searchDocuments(
				'query',
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
			expect(result).toContain('[[file-track]]');
		});

		it('stops processing progress updates after abort', async () => {
			const documents: IAIDocument[] = [
				{
					content: 'Doc body',
					meta: { basename: 'file-track', stat: { ctime: 1 } },
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
						content: 'Snippet',
						score: 0.9,
						document: documents[0],
					},
				];
			});

			const result = await searchDocuments(
				'query',
				documents,
				mockAIProviders,
				mockEmbeddingProvider,
				abortController,
				mockUpdate,
				undefined as any,
				10000,
			);

			expect(mockUpdate).toHaveBeenCalledTimes(1);
			expect(result).toContain('[[file-track]]');
		});

		it('handles progress events without totals or new chunks', async () => {
			const documents: IAIDocument[] = [
				{ content: 'Doc body', meta: { basename: 'file-zero', stat: {} } },
			];
			const mockUpdate = vi.fn();
			const mockAddTotal = vi.fn();

			mockAIProviders.retrieve.mockImplementation(async ({ onProgress }) => {
				onProgress({ processedChunks: [] });
				return [
					{
						content: 'Snippet',
						score: 0.9,
						document: documents[0],
					},
				];
			});

			const result = await searchDocuments(
				'query',
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
			expect(result).toContain('[[file-zero]]');
		});
	});

	describe('getBacklinkFiles', () => {
		beforeEach(() => {
			vi.restoreAllMocks();
			vi.clearAllMocks();
			vi.resetModules();
		});

		it('should find backlink files from resolved links', () => {
			const mockFile = new TFile();
			mockFile.path = 'target.md';
			mockFile.extension = 'md';

			const mockBacklink1 = new TFile();
			mockBacklink1.path = 'backlink1.md';
			mockBacklink1.extension = 'md';
			const mockBacklink2 = new TFile();
			mockBacklink2.path = 'backlink2.md';
			mockBacklink2.extension = 'md';

			const getAbstractFileByPath = vi.fn().mockImplementation((path: string) => {
				if (path === 'backlink1.md') return mockBacklink1;
				if (path === 'backlink2.md') return mockBacklink2;
				return null;
			});
			const mockContext = {
				vault: {
					getAbstractFileByPath,
				} as unknown as Vault,
				metadataCache: Object.assign(new MetadataCache(), {
					resolvedLinks: {
						'backlink1.md': { 'target.md': 1 },
						'backlink2.md': { 'target.md': 1 },
						'other.md': { 'different.md': 1 }
					},
				}),
				activeFile: { path: 'active.md' } as TFile
			} as ProcessingContext;

			const processedDocs = new Map<string, IAIDocument>();

			const backlinkFiles = ragModule.getBacklinkFiles(
				mockFile,
				mockContext,
				processedDocs,
			);

			expect(backlinkFiles.map((f: any) => f.path)).toEqual([
				'backlink1.md',
				'backlink2.md',
			]);
			expect(getAbstractFileByPath).toHaveBeenCalledTimes(2);
		});

		it('should exclude already processed documents', () => {
			const mockFile = new TFile();
			mockFile.path = 'target.md';
			mockFile.extension = 'md';

			const mockBacklink1 = new TFile();
			mockBacklink1.path = 'backlink1.md';
			mockBacklink1.extension = 'md';

			const getAbstractFileByPath = vi.fn().mockImplementation((path: string) => {
				if (path === 'backlink1.md') return mockBacklink1;
				return null;
			});
			const mockContext = {
				vault: {
					getAbstractFileByPath,
				} as unknown as Vault,
				metadataCache: Object.assign(new MetadataCache(), {
					resolvedLinks: {
						'backlink1.md': { 'target.md': 1 },
						'backlink2.md': { 'target.md': 1 }
					},
				}),
				activeFile: { path: 'active.md' } as TFile
			} as ProcessingContext;

			const processedDocs = new Map();
			processedDocs.set('backlink2.md', {
				content: 'Already processed',
				meta: {
					source: 'backlink2.md',
					basename: 'backlink2',
					stat: { ctime: 1000 },
					depth: 0,
					isBacklink: false
				}
			});

			const backlinkFiles = ragModule.getBacklinkFiles(
				mockFile,
				mockContext,
				processedDocs,
			);

			expect(backlinkFiles.map((f: any) => f.path)).toEqual([
				'backlink1.md',
			]);
			expect(getAbstractFileByPath).toHaveBeenCalledTimes(1);
		});
	
		describe('Progress tracking', () => {
			it('should call updateCompletedSteps for each processed file in startProcessing', async () => {
				const mockLinkedFiles = [
					{ path: 'file1.md', extension: 'md', basename: 'file1', stat: { ctime: 1000 } } as TFile,
					{ path: 'file2.md', extension: 'md', basename: 'file2', stat: { ctime: 2000 } } as TFile,
					{ path: 'file3.md', extension: 'md', basename: 'file3', stat: { ctime: 3000 } } as TFile,
				];
				const mockVault = { cachedRead: vi.fn().mockResolvedValue('Mock content') } as unknown as Vault;
				const mockMetadataCache = new MetadataCache();
				const mockActiveFile = { path: 'active.md' } as TFile;
				const mockUpdateCompletedSteps = vi.fn();
	
				vi.spyOn(ragModule, 'getLinkedFiles').mockReturnValue([]);
				vi.spyOn(ragModule, 'getBacklinkFiles').mockReturnValue([]);
	
				await startProcessing(mockLinkedFiles, mockVault, mockMetadataCache, mockActiveFile, mockUpdateCompletedSteps);
	
				expect(mockUpdateCompletedSteps).toHaveBeenCalledTimes(3);
				expect(mockUpdateCompletedSteps).toHaveBeenCalledWith(1);
			});
	
			it('should work without updateCompletedSteps callback in startProcessing', async () => {
				const mockLinkedFiles = [
					{ path: 'file1.md', extension: 'md', basename: 'file1', stat: { ctime: 1000 } } as TFile,
				];
				const mockVault = { cachedRead: vi.fn().mockResolvedValue('Mock content') } as unknown as Vault;
				const mockMetadataCache = new MetadataCache();
				const mockActiveFile = { path: 'active.md' } as TFile;
	
				vi.spyOn(ragModule, 'getLinkedFiles').mockReturnValue([]);
				vi.spyOn(ragModule, 'getBacklinkFiles').mockReturnValue([]);
	
				// Should not throw when callback is not provided
				const result = await startProcessing(mockLinkedFiles, mockVault, mockMetadataCache, mockActiveFile);
	
				expect(result.size).toBe(1);
			});
	
			it('should call updateCompletedSteps once in searchDocuments', async () => {
				const query = 'test query';
				const documents: IAIDocument[] = [
					{
						content: 'Test content',
						meta: { basename: 'file1', stat: { ctime: 1000 } }
					}
				];
	
				const mockResults: IAIProvidersRetrievalResult[] = [
					{
						content: 'Relevant content',
						score: 0.9,
						document: documents[0]
					}
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
					10000
				);
	
				expect(mockUpdateCompletedSteps).toHaveBeenCalledTimes(1);
				expect(mockUpdateCompletedSteps).toHaveBeenCalledWith(1);
			});
	
			it('should not call updateCompletedSteps when searchDocuments is aborted', async () => {
				const abortController = new AbortController();
				abortController.abort();
				const mockUpdateCompletedSteps = vi.fn();
	
				const result = await searchDocuments(
					'query',
					[],
					mockAIProviders,
					mockEmbeddingProvider,
					abortController,
					mockUpdateCompletedSteps,
					vi.fn(),
					10000
				);
	
				expect(result).toBe('');
				expect(mockUpdateCompletedSteps).not.toHaveBeenCalled();
			});
	
			it('should not call updateCompletedSteps when searchDocuments encounters error', async () => {
				mockAIProviders.retrieve.mockRejectedValue(new Error('Retrieval failed'));
				const abortController = new AbortController();
				const mockUpdateCompletedSteps = vi.fn();
				const consoleSpy = vi
					.spyOn(console, 'error')
					.mockImplementation(() => {});
	
				const result = await searchDocuments(
					'query',
					[],
					mockAIProviders,
					mockEmbeddingProvider,
					abortController,
					mockUpdateCompletedSteps,
					vi.fn(),
					10000
				);
	
				expect(result).toBe('');
				expect(mockUpdateCompletedSteps).not.toHaveBeenCalled();
				consoleSpy.mockRestore();
			});
		});

		it('should return empty array when no backlinks exist', () => {
			const mockFile = new TFile();
			mockFile.path = 'target.md';
			mockFile.extension = 'md';
			
			const mockActiveFile = new TFile();
			mockActiveFile.path = 'active.md';
			mockActiveFile.extension = 'md';
			
			const mockContext: ProcessingContext = {
				vault: {
					getAbstractFileByPath: vi.fn().mockReturnValue(null)
				} as unknown as Vault,
				metadataCache: {
					resolvedLinks: {
						'other.md': { 'different.md': 1 }
					}
				} as unknown as MetadataCache,
				activeFile: mockActiveFile
			};
			const processedDocs = new Map<string, IAIDocument>();

			const backlinkFiles = ragModule.getBacklinkFiles(mockFile, mockContext, processedDocs);

			expect(backlinkFiles).toHaveLength(0);
		});
	});
});
