export const Plugin = jest.fn();
export const Notice = jest.fn();
export const Menu = jest.fn();
export const Editor = jest.fn();
export const App = jest.fn();
export const PluginManifest = jest.fn();
export const TFile = jest.fn();
export const Vault = jest.fn();
export const MetadataCache = jest.fn();
export const requestUrl = jest.fn();
export const PluginSettingTab = jest.fn().mockImplementation(() => {
  return {
    display: jest.fn(),
    hide: jest.fn(),
  };
});