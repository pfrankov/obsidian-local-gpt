# Local GPT plugin for Obsidian

![demo](https://github.com/pfrankov/obsidian-local-gpt/assets/584632/724d4399-cb6c-4531-9f04-a1e5df2e3dad)  
_No speedup. MacBook Pro 13, M1, 16GB, Ollama, orca-mini._ 

Local GPT assistance for maximum privacy and offline access.  
The plugin allows you to open a context menu on selected text to pick an AI-assistant's action.

Also works with images  
<img width="400" src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/a05d68fa-5419-4386-ac43-82b9513999ad">  
_No speedup. MacBook Pro 13, M1, 16GB, Ollama, bakllava._

Default actions:
- Continue writing
- Summarize text
- Fix spelling and grammar
- Find action items in text
- General help (just use selected text as a prompt for any purpose)

You can also add yours, share the best actions or get one [from the community](https://github.com/pfrankov/obsidian-local-gpt/discussions/2).

Supported AI Providers:
- Ollama
- OpenAI compatible server (also OpenAI)

<img width="598" alt="Settings" src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/6ab2d802-13ed-42be-aab1-6a3f689b18a0">

## Installation
### 1. Install Plugin
#### Obsidian plugin store (recommended)
This plugin is available in the Obsidian community plugin store https://obsidian.md/plugins?id=local-gpt

#### BRAT
You can also install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-local-gpt`

### 2. Install LLM
#### Ollama (recommended)
1. Install [Ollama](https://ollama.ai/).
2. Install Qwen2 (default) `ollama pull qwen2` or any preferred model [from the library](https://ollama.ai/library).

Additional: if you want to enable streaming completion with Ollama you should set environment variable `OLLAMA_ORIGINS` to `*`:  
- For MacOS run `launchctl setenv OLLAMA_ORIGINS "*"`.
- For Linux and Windows [check the docs](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server).

#### OpenAI compatible server
There are several options to run local OpenAI-like server:  
- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [llama-cpp-python](https://github.com/abetlen/llama-cpp-python#openai-compatible-web-server)
- [LocalAI](https://localai.io/model-compatibility/llama-cpp/#setup)
- Obabooga [Text generation web UI](https://github.com/pfrankov/obsidian-local-gpt/discussions/8)
- [LM Studio](https://lmstudio.ai/)
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

### "Use fallback" option
It is also possible to specify a fallback to handle requests — this allows you to use larger models when you are online and smaller ones when offline.  
<img width="570" alt="image" src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/97df59b0-1e51-40b8-b543-8825f66d23c2">
<details>
  <summary>Example video</summary>
  <video src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/b851e9d2-52cb-4174-be42-add82c7af206"></video>
</details>

### Using with OpenAI
Since you can provide any OpenAI-like server, it is possible to use OpenAI servers themselves.  
_Despite the ease of configuration, I do not recommend this method, since the main purpose of the plugin is to work with private LLMs._ 

1. Select `OpenAI compatible server` in `Selected AI provider`
2. Set `OpenAI compatible server URL` to `https://api.openai.com`
3. Retrieve and paste your `API key` from the [API keys page](https://platform.openai.com/api-keys)
4. Click "refresh" button and select the model that suits your needs (e.g. `gpt-3.5-turbo`)
<details>
  <summary>Example screenshot</summary>
  <img width="577" alt="image" src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/f267afd2-4d3e-4cf1-a3ab-4e2f3fd2db77">
</details>


## Roadmap
- [x] Ability to select models from the list instead of typing their names
- [x] Ability to share and apply presets (system prompt + prompt + model)
- [x] Additional AI providers (OpenAI, etc...)
- [x] Streaming completions
- [x] Changing order of the actions
- [x] Editing actions
- [x] Fallback for action if first URL is unavailable (remote GPU)
- [x] Support multimodal models like Llava
- [x] Optional settings for prompts (top_p, top_k, temperature, repeat_penalty)
- [ ] Accounting your local documents in results as described here https://ollama.ai/blog/llms-in-obsidian

## Other AI providers
If you would like to use other providers, please let me know [in the discussions](https://github.com/pfrankov/obsidian-local-gpt/discussions/1).

## My other Obsidian plugins
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors. 

## Inspired by
- [Obsidian Ollama](https://github.com/hinterdupfinger/obsidian-ollama).
