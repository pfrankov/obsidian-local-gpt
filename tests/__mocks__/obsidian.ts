import { vi } from "vitest";

export const Plugin = vi.fn();
export const Notice = vi.fn();
export const Menu = vi.fn();
export const Editor = vi.fn();
export const App = vi.fn();
export const PluginManifest = vi.fn();
export class Setting {
	nameEl: any;
	descEl: any;
	settingEl: any = {
		createDiv: vi.fn(),
	};
	
	constructor(containerEl: any) {
		this.nameEl = { textContent: '' };
		this.descEl = { textContent: '' };
	}
	
	setName(name: string) {
		this.nameEl.textContent = name;
		return this;
	}
	
	setDesc(desc: string) {
		this.descEl.textContent = desc;
		return this;
	}
	
	addText(cb: (text: any) => any) {
		const textComponent = {
			inputEl: {},
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
			onChange: vi.fn().mockReturnThis(),
		};
		cb(textComponent);
		return this;
	}
	
	addTextArea(cb: (text: any) => any) {
		const textComponent = {
			inputEl: { rows: 0, cols: 0 },
			setPlaceholder: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
			onChange: vi.fn().mockReturnThis(),
		};
		cb(textComponent);
		return this;
	}
	
	addDropdown(cb: (dropdown: any) => any) {
		const dropdownComponent = {
			addOption: vi.fn().mockReturnThis(),
			setValue: vi.fn().mockReturnThis(),
			onChange: vi.fn().mockReturnThis(),
		};
		cb(dropdownComponent);
		return this;
	}
}
export class Modal {
	app: any;
	contentEl: any = {
		empty: vi.fn(),
		createEl: vi.fn((tag: string, options?: any) => ({
			style: {},
			createDiv: vi.fn(),
			createEl: vi.fn(),
			addEventListener: vi.fn(),
		})),
		createDiv: vi.fn((options?: any) => ({
			style: {},
			createEl: vi.fn(),
		})),
	};
	
	constructor(app: any) {
		this.app = app;
	}
	
	open() {}
	close() {}
	onOpen() {}
	onClose() {}
}
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
