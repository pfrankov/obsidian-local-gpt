# Local GPT plugin for Obsidian

![demo](https://github.com/pfrankov/obsidian-local-gpt/assets/584632/724d4399-cb6c-4531-9f04-a1e5df2e3dad)  
_No speedup. MacBook Pro 13, M1, 16GB, Ollama, orca-mini._ 

The plugin allows you to open a context menu on selected text to pick an AI-assistant's action.  
The most casual AI-assistant for Obsidian.

Also works with images  
<img width="400" src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/a05d68fa-5419-4386-ac43-82b9513999ad">  
_No speedup. MacBook Pro 13, M1, 16GB, Ollama, bakllava._

Also it can use context from links, backlinks and even PDF files (RAG)  
<img width="450" alt="Enhanced Actions" src="https://github.com/user-attachments/assets/5fa2ed36-0ef5-43b0-8f16-07588f76d780">
<details>
  <summary>How to use (Ollama)</summary>
  <p>
    1. Install Embedding model:
  </p>
  <ul>
    <li>For English: <code>ollama pull nomic-embed-text</code> (fastest)</li>
    <li>For other languages: <code>ollama pull bge-m3</code> (slower, but more accurate)</li>
  </ul>
  <p>
    2. Select Embedding provider in plugin's settings and try to use the largest model with largest context window.
  </p>
</details>

### Default actions
- Continue writing
- Summarize text
- Fix spelling and grammar
- Find action items in text
- General help (just use selected text as a prompt for any purpose)
- New System Prompt to create actions for your needs 

You can also add yours, share the best actions or get one [from the community](https://github.com/pfrankov/obsidian-local-gpt/discussions/2).

<img width="479" alt="Settings" src="https://github.com/user-attachments/assets/5337e74c-864b-45cb-82e0-2c32bbbfa3ed" />

## Installation
### 1. Install Plugin
#### Obsidian plugin store (recommended)
This plugin is available in the Obsidian community plugin store https://obsidian.md/plugins?id=local-gpt

#### BRAT
You can also install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-local-gpt`

### 2. Install AI Providers Plugin
You also need to install AI Providers plugin to configure AI providers from plugin store https://obsidian.md/plugins?id=ai-providers

### 3. Configure AI Providers
Follow the instructions in [AI Providers](https://github.com/pfrankov/obsidian-ai-providers) plugin.

### Configure Obsidian hotkey
1. Open Obsidian Settings
2. Go to Hotkeys
3. Filter "Local" and you should see "Local GPT: Show context menu"
4. Click on `+` icon and press hotkey (e.g. `⌘ + M`)

## My other Obsidian plugins
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors. 
- [Obsidian AI Providers](https://github.com/pfrankov/obsidian-ai-providers) is a hub for AI providers.

## Inspired by
- [Obsidian Ollama](https://github.com/hinterdupfinger/obsidian-ollama).
