import { startProcessing, getLinkedFiles, queryVectorStore, getFileContent, processDocumentForRAG, createVectorStore, clearContentCache, getCreatedTime, ProcessingContext } from '../src/rag';
import { Document } from 'langchain/document';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { extractTextFromPDF } from '../src/processors/pdf';
import { fileCache } from '../src/indexedDB';
import { AIProvider } from '../src/interfaces';
import LocalGPT from '../src/main';
import { CustomEmbeddings } from '../src/embeddings/CustomEmbeddings';
import { TFile, Vault, MetadataCache } from 'obsidian';
import * as ragModule from '../src/rag';

jest.mock('obsidian');
jest.mock('../src/processors/pdf');
jest.mock('../src/indexedDB');
jest.mock('langchain/vectorstores/memory');
jest.mock('../src/logger');
jest.mock('../src/embeddings/CustomEmbeddings');
jest.mock('pdfjs-dist', () => ({
  getDocument: jest.fn(),
  GlobalWorkerOptions: {
    workerPort: null
  }
}));

describe('RAG Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFileContent', () => {
    it('should read MD files using vault.cachedRead', async () => {
      const mockFile = { extension: 'md' } as TFile;
      const mockVault = { cachedRead: jest.fn().mockResolvedValue('Markdown content') } as unknown as Vault;

      const content = await getFileContent(mockFile, mockVault);

      expect(content).toBe('Markdown content');
      expect(mockVault.cachedRead).toHaveBeenCalledWith(mockFile);
    });

    it('should extract text from PDF files', async () => {
      const mockFile = { extension: 'pdf', stat: { mtime: 1000 } } as TFile;
      const mockVault = { readBinary: jest.fn().mockResolvedValue(new ArrayBuffer(8)) } as unknown as Vault;
      (extractTextFromPDF as jest.Mock).mockResolvedValue('PDF content');

      const content = await getFileContent(mockFile, mockVault);

      expect(content).toBe('PDF content');
      expect(mockVault.readBinary).toHaveBeenCalledWith(mockFile);
      expect(extractTextFromPDF).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    });

    it('should throw an error for unsupported file types', async () => {
      const mockFile = { extension: 'unsupported' } as TFile;
      const mockVault = new Vault();

      await expect(getFileContent(mockFile, mockVault)).rejects.toThrow('Unsupported file type');
    });
  });

  describe('getLinkedFiles', () => {
    it('should handle files with unsupported extensions', () => {
      const content = '[[Unsupported.txt]]';
      const mockVault = {
        getAbstractFileByPath: jest.fn().mockReturnValue({ path: 'Unsupported.txt', extension: 'txt' })
      } as unknown as Vault;
      const mockMetadataCache = {
        getFirstLinkpathDest: jest.fn().mockReturnValue({ path: 'Unsupported.txt' }),
      } as unknown as MetadataCache;
      const currentFilePath = 'current.md';

      const linkedFiles = getLinkedFiles(content, mockVault, mockMetadataCache, currentFilePath);

      expect(linkedFiles).toHaveLength(0);
    });
  });

  describe('createVectorStore', () => {
    it('should create a vector store with embeddings', async () => {
      const mockDocuments = [
        new Document({ pageContent: 'Content 1', metadata: { source: 'doc1.md', stat: { mtime: 1000 } } }),
        new Document({ pageContent: 'Content 2', metadata: { source: 'doc2.md', stat: { mtime: 2000 } } }),
      ];
      const mockPlugin = {} as LocalGPT;
      const mockAIProvider = { abortController: { signal: { aborted: false } } } as AIProvider;
      const mockAIProviders = { providers: [] };
      const mockAbortController = new AbortController();

      const mockEmbedder = {
        embedDocuments: jest.fn().mockImplementation(async (texts) => {
          texts.forEach(() => mockUpdateCompletedSteps(1));
          return [[1, 2, 3], [4, 5, 6]];
        })
      };
      (CustomEmbeddings as jest.Mock).mockImplementation(() => mockEmbedder);

      const mockVectorStore = {
        addVectors: jest.fn(),
      };
      (MemoryVectorStore as unknown as jest.Mock).mockImplementation(() => mockVectorStore);

      const mockAddTotalProgressSteps = jest.fn();
      const mockUpdateCompletedSteps = jest.fn();

      const vectorStore = await createVectorStore(
        mockDocuments, 
        mockPlugin, 
        'current.md', 
        mockAIProvider,
        mockAIProviders,
        mockAbortController,
        mockAddTotalProgressSteps,
        mockUpdateCompletedSteps
      );

      expect(vectorStore).toBe(mockVectorStore);
      expect(mockEmbedder.embedDocuments).toHaveBeenCalled();
      expect(mockVectorStore.addVectors).toHaveBeenCalledTimes(2);
      expect(mockAddTotalProgressSteps).toHaveBeenCalled();
      expect(mockUpdateCompletedSteps).toHaveBeenCalled();
    });
  });

  describe('queryVectorStore', () => {
    it('should return relevant results from vector store', async () => {
      const mockVectorStore = {
        similaritySearchWithScore: jest.fn().mockResolvedValue([
          [new Document({ pageContent: 'High score content 2', metadata: { basename: 'file2', stat: { ctime: 2000 } } }), 0.8],
          [new Document({ pageContent: 'High score content 1', metadata: { basename: 'file1', stat: { ctime: 1000 } } }), 0.9],
          [new Document({ pageContent: 'Low score content', metadata: { basename: 'file3', stat: { ctime: 3000 } } }), 0.4],
        ]),
      } as unknown as MemoryVectorStore;

      const query = 'test query';
      const result = await queryVectorStore(query, mockVectorStore);

      expect(mockVectorStore.similaritySearchWithScore).toHaveBeenCalledWith(query, 10);
      expect(result).toMatch(/^\[\[file3\]\]\nLow score content\n\n\[\[file2\]\]\nHigh score content 2\n\n\[\[file1\]\]\nHigh score content 1$/m);
    });

    it('should handle empty results', async () => {
      const mockVectorStore = {
        similaritySearchWithScore: jest.fn().mockResolvedValue([]),
      } as unknown as MemoryVectorStore;

      const query = 'empty query';
      const result = await queryVectorStore(query, mockVectorStore);

      expect(result).toBe('');
    });
  });

  describe('clearContentCache', () => {
    it('should clear the content cache', async () => {
      await clearContentCache();
      expect(fileCache.clearContent).toHaveBeenCalled();
    });
  });

  describe('getCreatedTime', () => {
    it('should extract created time from frontmatter', () => {
      const doc = new Document({
        pageContent: '---\ncreated: 2023-01-01\n---\nContent',
        metadata: { stat: { ctime: 1000 } }
      });

      const createdTime = getCreatedTime(doc);
      expect(createdTime).toBe(new Date('2023-01-01').getTime());
    });

    it('should use ctime if no frontmatter is present', () => {
      const doc = new Document({
        pageContent: 'Content without frontmatter',
        metadata: { stat: { ctime: 1000 } }
      });

      const createdTime = getCreatedTime(doc);
      expect(createdTime).toBe(1000);
    });
  });

  describe('startProcessing', () => {
    it('should process linked files and return a map of documents', async () => {
      const mockLinkedFiles = [
        { path: 'file1.md', extension: 'md' } as TFile,
        { path: 'file2.md', extension: 'md' } as TFile,
      ];
      const mockVault = new Vault();
      const mockMetadataCache = new MetadataCache();
      const mockActiveFile = { path: 'active.md' } as TFile;

      jest.clearAllMocks();

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
        currentDocumentPath: 'deep.md',
        activeFile: { path: 'active.md' } as TFile,
      };
      const processedDocs = new Map<string, Document>();

      jest.spyOn(ragModule, 'getLinkedFiles').mockImplementation(() => []);
      jest.spyOn(ragModule, 'getBacklinkFiles').mockImplementation(() => []);

      const result = await processDocumentForRAG(mockFile, mockContext, processedDocs, 11, false);

      expect(result.size).toBe(0);
    });
  });

  describe('getBacklinkFiles', () => {
    // TODO: Implement
  });

  describe('createVectorStore', () => {
    // TODO: Implement
  });

  describe('queryVectorStore', () => {
    it('should handle mixed high and low score results', async () => {
      const mockVectorStore = {
        similaritySearchWithScore: jest.fn().mockResolvedValue([
          [new Document({ pageContent: 'High score 1', metadata: { basename: 'file1', stat: { ctime: 1000 } } }), 0.9],
          [new Document({ pageContent: 'Low score 1', metadata: { basename: 'file2', stat: { ctime: 2000 } } }), 0.4],
          [new Document({ pageContent: 'High score 2', metadata: { basename: 'file1', stat: { ctime: 1000 } } }), 0.8],
          [new Document({ pageContent: 'Low score 2', metadata: { basename: 'file2', stat: { ctime: 2000 } } }), 0.3],
        ]),
      } as unknown as MemoryVectorStore;

      const result = await queryVectorStore('test query', mockVectorStore);

      expect(result).toContain('[[file2]]');
      expect(result).toContain('[[file1]]');
      expect(result.indexOf('file2')).toBeLessThan(result.indexOf('file1'));
      expect(result).toContain('High score 1');
      expect(result).toContain('High score 2');
      expect(result).toContain('Low score 1');
    });
  });
});