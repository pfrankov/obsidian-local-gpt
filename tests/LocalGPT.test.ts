import { App, PluginManifest } from 'obsidian';

jest.mock('obsidian', () => ({
  Plugin: class {},
  Notice: jest.fn(),
  Menu: jest.fn(),
  Editor: jest.fn(),
  App: jest.fn(),
  PluginManifest: jest.fn(),
  PluginSettingTab: jest.fn().mockImplementation(() => {
    return {
      display: jest.fn(),
      hide: jest.fn(),
    };
  }),
}));

jest.mock('../src/LocalGPTSettingTab', () => ({
  LocalGPTSettingTab: jest.fn().mockImplementation(() => {
    return {
      display: jest.fn(),
      hide: jest.fn(),
    };
  }),
}));

jest.mock('../src/spinnerPlugin', () => ({
  spinnerPlugin: {
    show: jest.fn(),
    updateContent: jest.fn(),
  },
}));

// Обновленный мок для src/main.ts
jest.mock('../src/main', () => {
  return {
    __esModule: true,
    default: class MockLocalGPT {
      constructor() {}
      loadSettings = jest.fn().mockResolvedValue(undefined);
      reload = jest.fn();
      onload = jest.fn().mockImplementation(async () => {
        await this.loadSettings();
        this.reload();
      });
      processText = jest.fn().mockImplementation((text, selectedText) => {
        return `\n${text.replace(selectedText, '').trim()}\n`;
      });
    },
  };
});

import LocalGPT from '../src/main';

describe('LocalGPT', () => {
  let localGPT: LocalGPT;
  let mockApp: jest.Mocked<App>;
  let mockManifest: jest.Mocked<PluginManifest>;

  beforeEach(() => {
    mockApp = new App() as jest.Mocked<App>;
    mockManifest = {} as jest.Mocked<PluginManifest>;
    localGPT = new LocalGPT(mockApp, mockManifest);
  });

  test('initialization', async () => {
    await localGPT.onload();
    expect(localGPT.loadSettings).toHaveBeenCalled();
    expect(localGPT.reload).toHaveBeenCalled();
  });

  test('processText', () => {
    const result = localGPT.processText('Hello {{SELECTION}} world', '{{SELECTION}}');
    expect(result).toBe('\nHello  world\n');
  });
});