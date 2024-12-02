# Local GPT plugin for Obsidian

![demo](https://github.com/pfrankov/obsidian-local-gpt/assets/584632/724d4399-cb6c-4531-9f04-a1e5df2e3dad)  
_No speedup. MacBook Pro 13, M1, 16GB, Ollama, orca-mini._ 

Local GPT assistance for maximum privacy and offline access.  
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
    2. Select Embedding model in plugin's settings and try to use the largest model with largest context window.
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

### Supported AI Providers
- Ollama
- OpenAI compatible server (also OpenAI)

<img width="613" alt="Settings" src="https://github.com/user-attachments/assets/f849bb6e-6f99-4de3-9cc4-155bea199bc6">

## Installation
### 1. Install Plugin
#### Obsidian plugin store (recommended)
This plugin is available in the Obsidian community plugin store https://obsidian.md/plugins?id=local-gpt

#### BRAT
You can also install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-local-gpt`

### 2. Install LLM
#### Ollama (recommended)
1. Install [Ollama](https://ollama.com/).
2. Install Gemma 2 (default) `ollama pull gemma2` or any preferred model [from the library](https://ollama.com/library).

Additional: if you want to enable streaming completion with Ollama you should set environment variable `OLLAMA_ORIGINS` to `*`:  
- For MacOS run `launchctl setenv OLLAMA_ORIGINS "*"`.
- For Linux and Windows [check the docs](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server).


#### OpenAI compatible server
There are several options to run local OpenAI-like server:  
- [Open WebUI](https://docs.openwebui.com/tutorials/integrations/continue-dev/)
- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [llama-cpp-python](https://github.com/abetlen/llama-cpp-python#openai-compatible-web-server)
- [LocalAI](https://localai.io/model-compatibility/llama-cpp/#setup)
- Obabooga [Text generation web UI](https://github.com/pfrankov/obsidian-local-gpt/discussions/8)
- [LM Studio](https://lmstudio.ai/)
- ...maybe more

### Configure Obsidian hotkey
1. Open Obsidian Settings
2. Go to Hotkeys
3. Filter "Local" and you should see "Local GPT: Show context menu"
4. Click on `+` icon and press hotkey (e.g. `⌘ + M`)

### "Use fallback" option
It is also possible to specify a fallback to handle requests — this allows you to use larger models when you are online and smaller ones when offline.  
<img width="626" alt="image" src="https://github.com/user-attachments/assets/5f6855c7-ed10-4d83-91e3-891b99b5a605">
<details>
  <summary>Example video</summary>
  <video src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/b851e9d2-52cb-4174-be42-add82c7af206"></video>
</details>

### Using with OpenAI
Since you can provide any OpenAI-like server, it is possible to use OpenAI servers themselves.  
_Despite the ease of configuration, I do not recommend this method, since the main purpose of the plugin is to work with private LLMs._ 

1. Select `OpenAI compatible server` in `Selected AI provider`
2. Set `OpenAI compatible server URL` to `https://api.openai.com/v1`
3. Retrieve and paste your `API key` from the [API keys page](https://platform.openai.com/api-keys)
4. Click "refresh" button and select the model that suits your needs (e.g. `gpt-4o`)
<details>
  <summary>Example screenshot</summary>
  <img width="578" alt="image" src="https://github.com/user-attachments/assets/3dcfac3d-814f-413c-b393-06bf4d8ccb87">
</details>

## My other Obsidian plugins
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors. 

## Inspired by
- [Obsidian Ollama](https://github.com/hinterdupfinger/obsidian-ollama).
