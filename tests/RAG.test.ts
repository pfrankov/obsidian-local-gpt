import { TFile } from 'obsidian';

jest.mock('obsidian', () => ({
  TFile: jest.fn().mockImplementation(() => ({
    extension: 'md'
  })),
  Vault: jest.fn(),
  MetadataCache: jest.fn(),
}));

describe('RAG Functions', () => {
  test('Mock test to ensure setup is correct', () => {
    const mockFile = new TFile();
    expect(mockFile.extension).toBe('md');
  });
});