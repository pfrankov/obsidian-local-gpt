# Local GPT plugin for Obsidian

![demo](https://github.com/pfrankov/obsidian-local-gpt/assets/584632/7618bed7-57e4-417e-82e4-5172fba1995b)

Local GPT assistance for maximum privacy and offline access.  
The plugin allows you to open a context menu on selected text to pick an AI-assistant's action.

Default actions:
- Continue writing
- Summarize text
- Fix spelling and grammar
- Find action items in text
- General help (just use selected text as a prompt for any purpose)

You can also add yours:  
<img width="700" alt="Settings" src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/66091fde-29b3-46ae-9321-fdd8485ad2eb">

>**Limitations:**
>- Since plugin uses [Ollama](https://ollama.ai/) it depends on it. The main limitation is "Windows coming soon".
>- No mobile support.


## Installation

### BRAT
You can install this plugin via [BRAT](https://obsidian.md/plugins?id=obsidian42-brat): `pfrankov/obsidian-local-gpt`

### Install LLM
1. Install [Ollama](https://ollama.ai/).
2. Install orca-mini (default) `ollama pull orca-mini` or any preferred model [from the library](https://ollama.ai/library).

### Configure Obsidian hotkey (optional)
1. Open Obsidian Settings
2. Go to Hotkeys
3. Filter "Local" and you should see "Local GPT: Show context menu"
4. Click on `+` icon and press hotkey (e.g. `⌘ + M`)

## Roadmap
- [x] Ability to select models from the list instead of typing their names
- [ ] Ability to share and apply presets (system prompt + prompt + model)
- [ ] Additional AI providers (OpenAI, etc...)
- [ ] Changing order of the prompts
- [ ] Accounting your local documents in results as described here https://ollama.ai/blog/llms-in-obsidian

## Other AI providers
If you would like to use other providers, please let me know [in the discussions](https://github.com/pfrankov/obsidian-local-gpt/discussions/1).

## My other Obsidian plugins
- [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags) that colorizes tags in distinguishable colors. 

## Inspired by
- [Obsidian Ollama](https://github.com/hinterdupfinger/obsidian-ollama).
