import { vi } from "vitest";

export const Plugin = vi.fn();
export const Notice = vi.fn();
export const Menu = vi.fn();
export const Editor = vi.fn();
export const App = vi.fn();
export const PluginManifest = vi.fn();
export class TFile {
  path: string = 'mock/path.md';
  extension: string = 'md';
  stat: { mtime: number } = { mtime: 123456789 };
  basename: string = 'mock';
  
  constructor() {}
}
export const Vault = vi.fn().mockImplementation(() => ({
  cachedRead: vi.fn().mockImplementation((file) => {
    if (file.extension === 'unsupported') {
      throw new Error('Unsupported file type');
    }
    return Promise.resolve('Mocked content');
  }),
  getAbstractFileByPath: vi.fn().mockReturnValue(new TFile()),
  readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8))
}));
export const MetadataCache = vi.fn().mockImplementation(() => ({
  getFirstLinkpathDest: vi.fn().mockReturnValue(new TFile()),
  resolvedLinks: { 'mock/backlink.md': { 'mock/path.md': 1 } }
}));
export const requestUrl = vi.fn();
export const PluginSettingTab = vi.fn().mockImplementation(() => {
  return {
    display: vi.fn(),
    hide: vi.fn(),
  };
});
