# Local GPT plugin for Obsidian

![demo](https://github.com/pfrankov/obsidian-local-gpt/assets/584632/724d4399-cb6c-4531-9f04-a1e5df2e3dad)  
_No speedup. MacBook Pro 13, M1, 16GB, Ollama, orca-mini._ 

Local GPT assistance for maximum privacy and offline access.  
The plugin allows you to open a context menu on selected text to pick an AI-assistant's action.

Default actions:
- Continue writing
- Summarize text
- Fix spelling and grammar
- Find action items in text
- General help (just use selected text as a prompt for any purpose)

You can also add yours, share the best actions or get one [from the community](https://github.com/pfrankov/obsidian-local-gpt/discussions/2)  
![Settings](https://github.com/pfrankov/obsidian-local-gpt/assets/584632/2384c4f7-3b5b-4f79-ba23-95addef2f4e0)

Supported AI Providers:
- Ollama
- OpenAI compatible server

>**Limitations:**
>- No mobile support.

## Installation
### 1. Install Plugin
#### Obsidian plugin store (recommended)
This plugin is available in the Obsidian community plugin store https://obsidian.md/plugins?id=local-gpt

#### BRAT
You can also install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-local-gpt`

### 2. Install LLM
#### Ollama (recommended)
1. Install [Ollama](https://ollama.ai/). No Windows support yet.
2. Install orca-mini (default) `ollama pull orca-mini` or any preferred model [from the library](https://ollama.ai/library).

Additional: if you want to enable streaming completion with Ollama you should run it in API-mode: `OLLAMA_ORIGINS='*' ollama serve`. 

#### OpenAI compatible server
There are several options to run local OpenAI-like server:  
- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [llama-cpp-python](https://github.com/abetlen/llama-cpp-python#openai-compatible-web-server)
- [LocalAI](https://localai.io/model-compatibility/llama-cpp/#setup)
- ...maybe more

Here is an example for llama.cpp:  
1. Install [llama.cpp](https://github.com/ggerganov/llama.cpp) and follow build instructions for your OS
2. Download a model trained on the ChatML dialog format. For example, [Mixtral 8X7B](https://huggingface.co/TheBloke/dolphin-2.5-mixtral-8x7b-GGUF/blob/main/dolphin-2.5-mixtral-8x7b.Q4_K_M.gguf) (Dolphin 2.5 version)
3. Run the server by calling `./server -c 4096 --host 0.0.0.0 -t 16 --mlock -m models/dolphin-2.5-mixtral-8x7b.Q4_K_M.gguf` or as described [in the documentation](https://github.com/ggerganov/llama.cpp/blob/master/examples/server/README.md).

### Configure Obsidian hotkey (optional)
1. Open Obsidian Settings
2. Go to Hotkeys
3. Filter "Local" and you should see "Local GPT: Show context menu"
4. Click on `+` icon and press hotkey (e.g. `⌘ + M`)

## Roadmap
- [x] Ability to select models from the list instead of typing their names
- [x] Ability to share and apply presets (system prompt + prompt + model)
- [x] Additional AI providers (OpenAI, etc...)
- [x] Streaming completions
- [x] Changing order of the actions
- [x] Editing actions
- [ ] Optional settings for prompts (top_p, top_k, temperature, repeat_penalty)
- [ ] Fallback for action if first URL is unavailable (remote GPU)
- [ ] Accounting your local documents in results as described here https://ollama.ai/blog/llms-in-obsidian

## Other AI providers
If you would like to use other providers, please let me know [in the discussions](https://github.com/pfrankov/obsidian-local-gpt/discussions/1).

## My other Obsidian plugins
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors. 

## Inspired by
- [Obsidian Ollama](https://github.com/hinterdupfinger/obsidian-ollama).
