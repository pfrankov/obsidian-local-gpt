# Local GPT architecture

How the plugin is put together — at the level you'd need to recreate it,
without binding to specific names. Module names, field names, and constants
are intentionally omitted; the shape and the rules are what matter.

## What it is

Local GPT runs an AI request against something in your note and writes the
answer back. Two surfaces start a request, four pieces go into one, and an
optional retrieval layer fetches relevant material from the vault before the
model runs.

## What a request is

```
┌─ Request ─────────────────────────────────────┐
│  System prompt    action setting               │
│  Task             stored or typed instruction  │
│  Working text     selection / whole note / —   │
│  Context          top-K relevant chunks        │
│  Images           base64-encoded attachments   │
│  AI settings      provider, model, temperature │
└────────────────────────────────────────────────┘
```

The most important line is between **working text** (the subject of the task —
what the model edits, summarizes, continues) and **context** (background reading
the model may consult). They live in different slots and are filled by
different rules.

## Two surfaces

**Saved actions** are pre-configured commands in the context menu and Obsidian's
command palette. Each carries a fixed task, an optional system prompt, and a
rule for where the answer lands relative to the original selection.

**Action Palette** is a one-off prompt box. You type the task, optionally pick
a provider, attach files as chips, and submit. The answer is inserted at the
cursor.

Working text comes from different places on each surface:

| Situation    | Saved action  | Action Palette                        |
| ---          | ---           | ---                                   |
| Selection    | selected text | selected text                         |
| No selection | whole note    | none — the typed prompt is the input  |

The split is intentional. A saved action means "do this thing to my work" — so
the whole note is a sensible fallback. The palette means "answer this
question" — without a selection there's no work to operate on, only a question.

## Prompt assembly

The task and the gathered material are merged into a single prompt string
before the request goes out. A small template language exposes three
placeholders:

- `{{=SELECTION=}}` — replaced with the working text.
- `{{=CONTEXT=}}` — replaced with the formatted context block.
- `{{=CONTEXT_START=}}` … `{{=CONTEXT_END=}}` — a conditional block kept as-is
  when context is non-empty, dropped entirely when empty.

If a placeholder isn't used, the corresponding piece is appended to the prompt
in a sensible default order. A prompt with no placeholders still works. See
[prompt-templating.md](prompt-templating.md) for examples.

## Context pipeline

```
sources                       pool          chunks            injected
─────────────────             ────          ──────            ────────
links from text     ─┐
backlinks           ─┤
PDFs                ─┼─►   documents  ─►   embedded     ─►    top-K
file chips (palette)─┘     (deduped)        + scored          chunks
                                            against query
```

Documents come from several sources, get deduplicated into one pool, are split
into chunks, and each chunk is embedded and scored for similarity against a
query. Only the top chunks travel along with the request, capped by a budget
sized to the target model's context window.

**Source resolution.** Forward links are extracted from the active note's text
by parsing wiki-link and markdown-link syntax. Code blocks, inline code, and
HTML comments are stripped before parsing so links inside code aren't followed.
Backlinks are found by scanning notes whose link graph points at the current
file. Both are walked recursively, with a depth cap to keep traversal bounded.
Only markdown notes and PDFs are eligible; PDF text is extracted once and
cached by file identity and modification time so subsequent runs are free. The
active note's own *content* is included as a document only when it isn't
already serving as the working text — but its outgoing links are followed
regardless.

**Query selection.** Retrieval runs against a query string:

- Saved action — the working text (or the prompt, if working text is empty).
- Action Palette — the typed prompt.

In Action Palette without a selection this matters: your prompt is the only
signal. If it doesn't mention the topic clearly, the wrong chunks come back.

**Result formatting.** Returned chunks are grouped by their source document.
Groups are ordered by document creation time (newest first); within a group,
chunks are ordered by similarity score (highest first). The final string
labels each group with its document's name and packs chunks until the budget
is hit.

## Providers

```
┌──────────────────────────────────────────────┐
│  Local GPT                                    │
│  prompts, actions, retrieval orchestration   │
└──────────┬───────────────────────────────────┘
           │ execute / embed
           ▼
┌──────────────────────────────────────────────┐
│  Provider abstraction (separate plugin)       │
│  provider list, credentials, streaming        │
└──────────┬───────────────────────────────────┘
           │
           ▼
   Ollama, OpenAI-compatible, …
```

Local GPT does not talk to model APIs directly. It delegates to a provider
abstraction (in this codebase, a separate plugin) that exposes three
capabilities: streaming text completion, vision, and embedding-based retrieval.

Three independent provider slots are configured: a default text model, an
embedding model used for retrieval, and a vision model used when a request
carries images.

**Provider routing per request:**

1. If the working text references images, they're read from the vault,
   base64-encoded, and the vision provider is preferred.
2. Otherwise the default text provider is used. Action Palette can override
   with a per-request choice of provider and model.
3. The embedding provider runs chunk scoring independently. If it doesn't
   implement retrieval, the step is skipped silently and the request goes
   through with no context.

## Streaming and result placement

The model returns the answer as a stream of chunks. The UI keeps an
accumulated buffer and renders it inline at the insertion point as the buffer
grows, so the user sees the answer materialize in the editor.

Because the document can be edited or scrolled while streaming, the original
selection range is tracked through document edits, so the final placement
lands in the right spot even if surrounding text changed. Each saved action
declares whether the answer should replace the selection or be inserted after
it; Action Palette always inserts.

Once streaming finishes the answer is just text in the note. No side panel, no
chat history.

## Why context visibility differs

In a **saved action** the retrieval pipeline runs in the background. You don't
see which links and backlinks got pulled in.

In **Action Palette** every file that will be used appears as a removable chip.
If the palette opened without a selection, the current note appears as a chip
too — included if you keep it, excluded if you remove it.

The trade-off: ad-hoc requests are more sensitive to wrong context (a stray
PDF can produce confident nonsense), so they get a checkpoint before submit.
Repeated saved actions skip the checkpoint for speed.

## Design invariant

In Action Palette, anything that will be sent to the model must be visible
before submit. Working text is the selection (already visible). Context is
shown as removable chips. There is no hidden context in Action Palette.

Saved actions intentionally don't follow this rule — they're meant to run
without a checkpoint.
