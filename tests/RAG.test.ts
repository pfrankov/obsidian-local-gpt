import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	startProcessing,
	getLinkedFiles,
	getFileContent,
	processDocumentForRAG,
	ProcessingContext
} from '../src/rag';
import { IAIDocument } from '../src/interfaces';
import { extractTextFromPDF } from '../src/processors/pdf';
import { fileCache } from '../src/indexedDB';
import { TFile, Vault, MetadataCache } from 'obsidian';
import * as ragModule from '../src/rag';

vi.mock('obsidian');
vi.mock('../src/processors/pdf');
vi.mock('../src/indexedDB');
vi.mock('../src/logger');
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
	getDocument: vi.fn(),
	GlobalWorkerOptions: {
		workerPort: null
	}
}));

describe('RAG Functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

		it('ignores absolute and external markdown links', () => {
			const content = '[External](https://example.com) and [Absolute](/notes/File.md)';
			const mockVault = {
				getAbstractFileByPath: vi.fn(),
			} as unknown as Vault;
			const mockMetadataCache = {
				getFirstLinkpathDest: vi.fn(),
			} as unknown as MetadataCache;

			const linkedFiles = getLinkedFiles(content, mockVault, mockMetadataCache, 'current.md', true);

			expect(linkedFiles).toHaveLength(0);
			expect(mockMetadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
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

			const result = await startProcessing(mockLinkedFiles, mockVault, mockMetadataCache, mockActiveFile, undefined, false);

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
				includeActiveFileContent: false,
			};
			const processedDocs = new Map<string, IAIDocument>();

			const result = await processDocumentForRAG(mockFile, mockContext, processedDocs, 11, false);

			expect(result.size).toBe(0);
		});

		it('should not process the active file by default', async () => {
			const mockFile = { path: 'active.md', extension: 'md' } as TFile;
			const mockContext: ProcessingContext = {
				vault: new Vault(),
				metadataCache: new MetadataCache(),
				activeFile: { path: 'active.md' } as TFile,
				includeActiveFileContent: false,
			};
			const processedDocs = new Map<string, IAIDocument>();

			const result = await processDocumentForRAG(mockFile, mockContext, processedDocs, 0, false);

			expect(result.size).toBe(0);
		});

		it('should process the active file when explicitly included', async () => {
			const mockFile = {
				path: 'active.md',
				extension: 'md',
				basename: 'active',
				stat: { ctime: 0 },
			} as TFile;
			const mockContext: ProcessingContext = {
				vault: {
					cachedRead: vi.fn().mockResolvedValue('Active content'),
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
				} as unknown as Vault,
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
					resolvedLinks: {},
				} as unknown as MetadataCache,
				activeFile: mockFile,
				includeActiveFileContent: true,
			};
			const processedDocs = new Map<string, IAIDocument>();

			const result = await processDocumentForRAG(
				mockFile,
				mockContext,
				processedDocs,
				0,
				false,
			);

			expect(result.get('active.md')?.content).toBe('Active content');
		});

		it('should not process already processed files', async () => {
			const mockFile = { path: 'processed.md', extension: 'md' } as TFile;
			const mockContext: ProcessingContext = {
				vault: new Vault(),
				metadataCache: new MetadataCache(),
				activeFile: { path: 'active.md' } as TFile,
				includeActiveFileContent: false,
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
				includeActiveFileContent: false,
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
				includeActiveFileContent: false,
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
});
