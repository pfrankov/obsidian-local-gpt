export const Plugin = jest.fn();
export const Notice = jest.fn();
export const Menu = jest.fn();
export const Editor = jest.fn();
export const App = jest.fn();
export const PluginManifest = jest.fn();
export const TFile = jest.fn().mockImplementation(() => ({
  path: 'mock/path.md',
  extension: 'md',
  stat: { mtime: 123456789 }
}));
export const Vault = jest.fn().mockImplementation(() => ({
  cachedRead: jest.fn().mockImplementation((file) => {
    if (file.extension === 'unsupported') {
      throw new Error('Unsupported file type');
    }
    return Promise.resolve('Mocked content');
  }),
  getAbstractFileByPath: jest.fn().mockReturnValue(new TFile()),
  readBinary: jest.fn().mockResolvedValue(new ArrayBuffer(8))
}));
export const MetadataCache = jest.fn().mockImplementation(() => ({
  getFirstLinkpathDest: jest.fn().mockReturnValue(new TFile()),
  resolvedLinks: { 'mock/backlink.md': { 'mock/path.md': 1 } }
}));
export const requestUrl = jest.fn();
export const PluginSettingTab = jest.fn().mockImplementation(() => {
  return {
    display: jest.fn(),
    hide: jest.fn(),
  };
});