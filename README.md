# Local GPT plugin for Obsidian

![demo](https://github.com/pfrankov/obsidian-local-gpt/assets/584632/724d4399-cb6c-4531-9f04-a1e5df2e3dad)
_Real-time demo. MacBook Pro 13, M1, 16GB, Ollama, orca-mini._

The plugin allows you to open a context menu on selected text to pick an AI assistant's action.

**(🎉 Recent Updates by [xvishon](https://github.com/xvishon)!)** This plugin has been significantly enhanced with features like Action Groups, per-action overrides, improved context menu navigation, better visual feedback, and more!

**Key Features:**

*   **Context Menu Actions:** Right-click (or use a hotkey) on selected text (or the whole note) to trigger AI actions.
*   **(New!) Action Groups:** Organize your actions into logical groups (e.g., "Writing", "Summarization", "Coding"). Easily switch between groups directly within the context menu.
*   **Customizable Actions:** Define your own actions with custom prompts, system messages, and behaviors (replace selection or insert below).
*   **(New!) Provider & Creativity Overrides:**
    *   Set global default providers (Main, Embedding, Vision) and a default creativity level.
    *   Override the provider or creativity (temperature) for specific actions in the settings.
*   **(New!) Modal Overrides:** Press `Shift` while clicking an action, or enable settings toggles, to temporarily override the AI provider or creativity level for that *single run* via a pop-up modal.
*   **RAG Context (Experimental):** Automatically includes relevant context from linked notes, backlinks, and even PDF files (powered by an embedding model) to enhance AI responses.
*   **Image Support:** Works with multimodal models to understand images embedded in your notes (using `![[image.png]]` syntax). Requires a Vision provider selected.
*   **(Improved!) Visual Feedback:** See distinct "Thinking..." or "Generating..." indicators with smoother streaming output directly in your editor.
*   **(New!) Thinking Output:** If the AI model outputs its reasoning within `<think>...</think>` tags, this will be displayed in a collapsible ` ```thoughts ``` ` block above the main response.

<img width="400" src="https://github.com/pfrankov/obsidian-local-gpt/assets/584632/a05d68fa-5419-4386-ac43-82b9513999ad">
_Image support using Ollama + bakllava._

<img width="450" alt="Enhanced Actions with RAG context" src="https://github.com/user-attachments/assets/5fa2ed36-0ef5-43b0-8f16-07588f76d780">
_RAG context from linked files enhances AI understanding._

<details>
  <summary>How to use RAG Context (Ollama Example)</summary>
  <p>
    1. Install an Embedding model via Ollama (choose one):
  </p>
  <ul>
    <li>Fastest (English/Code): <code>ollama pull nomic-embed-text</code></li>
    <li>Multilingual (Slower, Accurate): <code>ollama pull mxbai-embed-large</code></li>
    <li>General Purpose: <code>ollama pull all-minilm</code></li>
    <li>Other options available at <a href="https://ollama.com/library?q=embed">Ollama Library</a>.</li>
  </ul>
  <p>
    2. <strong>Important:</strong> Go to Local GPT plugin settings.
  </p>
  <p>
    3. Select your Ollama instance and the <strong>exact embedding model name</strong> (e.g., <code>nomic-embed-text</code>) in the "Default Embedding Provider" dropdown.
  </p>
    <p>
    4. Now, when you run actions, the plugin will attempt to find relevant text from linked notes, backlinks, and PDFs, providing it as context to the main AI. An animated status bar item ✨ will show progress during embedding.
  </p>
</details>

### Default Actions
The plugin comes with a default "General" group containing:

*   🪄 **General help:** Use selected text as a general prompt.
*   ✍️ **Continue writing:** Expand on the selected text.
*   🍭 **Summarize:** Create a concise summary.
*   📖 **Fix spelling and grammar:** Proofread and corrects the selection (replaces text).
*   ✅ **Find action items:** Extract tasks in checkbox format.
*   🧠 **New System Prompt:** Generate a system prompt based on your description.

### Customization
**(New!)** Manage your actions within groups:

*   Add, rename, and delete Action Groups.
*   Add new actions to specific groups.
*   Reorder actions *within* their group using the "Reorder" button in settings.
*   Edit actions to customize prompts, system messages, replace behavior, and set **Provider/Creativity overrides**.
*   Use the "Quick Add" feature in settings to easily import actions shared as text strings (actions are added to the *first* group).
*   Share your best actions or get inspiration [from the community](https://github.com/pfrankov/obsidian-local-gpt/discussions/2).

<img width="479" alt="Settings showing Action Groups and Overrides" src="https://github.com/user-attachments/assets/5337e74c-864b-45cb-82e0-2c32bbbfa3ed" />
_Local GPT settings allow detailed configuration of groups, actions, and overrides._

## Installation

### 1. Install Required Plugins
You need **two** plugins:

1.  **Local GPT (This Plugin):**
    *   **Community Plugins (Recommended):** Search for "Local GPT" in Obsidian's community plugin browser and install.
    *   **BRAT:** Add `pfrankov/obsidian-local-gpt` via the [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) plugin.
2.  **AI Providers:**
    *   **Community Plugins:** Search for "AI Providers" in Obsidian's community plugin browser and install.

### 2. Configure AI Providers Plugin
*   Follow the instructions in the [AI Providers plugin README](https://github.com/pfrankov/obsidian-ai-providers#create-ai-provider) to set up connections to your desired AI services (like Ollama, LM Studio, OpenAI-compatible APIs, etc.). **Make sure your providers are working correctly here first.**

### 3. Configure Local GPT Plugin Settings
*   Open Local GPT settings in Obsidian.
*   **Crucially, select your providers:**
    *   Choose a **Default Main Provider** for standard text tasks.
    *   Choose a **Default Embedding Provider** for RAG context features (must be an embedding model).
    *   Choose a **Default Vision Provider** if using image features (must be a multimodal model).
*   Adjust the **Default Creativity** level (temperature).
*   **(New!)** Decide if you want to **"Show Provider/Creativity Choice in Context Menu"** to always be prompted for overrides (equivalent to Shift+Clicking).
*   Explore and customize the **Action Groups** and **Actions**. Add your own!

### 4. Configure Hotkeys (Optional)
1.  Open Obsidian Settings -> Hotkeys.
2.  Filter for "Local GPT".
3.  Assign a hotkey to **"Local GPT: Show Actions..."** to open the context menu for the currently selected group.
4.  **(Updated!)** You will also see commands listed for each action **within your currently selected Action Group** (e.g., `Local GPT: General - Summarize`). You can assign specific hotkeys to these actions.
    *   **Note:** These action-specific hotkeys **only work for the group currently active** in the Local GPT settings (the group shown in the context menu by default). They do *not* work for actions in other groups.

## My other Obsidian plugins
*   [Colored Tags](https://github.com/pfrankov/obsidian-colored-tags): Colorizes tags in distinguishable colors.
*   [Obsidian AI Providers](https://github.com/pfrankov/obsidian-ai-providers): The hub for connecting Obsidian to various AI providers.

## Inspired by
*   [Obsidian Ollama](https://github.com/hinterdupfinger/obsidian-ollama).

---
*Recent feature updates contributed by [xvishon](https://github.com/xvishon).*