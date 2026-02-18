# RAG Benchmarks

This repository includes a document-graph benchmark focused on Obsidian-style links.

## What It Measures

The benchmark checks whether the current RAG document discovery logic can reach all required answer fragments based on the document graph (wiki links, embeds, backlinks, aliases, paths, etc.). It does **not** evaluate embedding quality or chunk ranking.

## How To Run

- `npm test -- -t "RAG Benchmark"`
- `npm test -- tests/RAG.benchmark.test.ts`

## Data Set

- `benchmarks/rag-vault/` contains 61 isolated cases.
- Each case has a `case.json` plus minimal markdown (and PDF fixture) files.
- `case.json` supports `expected` (markers that must be present) and `forbidden`
  (markers that must be absent). Omitted `forbidden` means no exclusions.
- PDF fixtures are plain-text placeholders to keep the focus on graph traversal rather than PDF extraction.

## Test Categories

### Basic Links (c01-c05)
Direct wiki links, aliases, headings, blocks, embeds.

### Chains & Depth (c06, c09, c32, c54)
Forward-link chains, multi-root chains, and exact depth-boundary behavior (MAX_DEPTH=10).

### Backlinks (c07, c08, c26, c27, c49, c59, c61, c63)
Backlink discovery, depth limits for backlinks, alias backlinks, mutual backlinks, and markdown-link backlinks.

### PDFs (c13-c15, c25, c34, c40, c55, c60)
PDF links, chains, extension-precedence collisions, and mixed alias+PDF traversal.

### Mixed Selection/Traversal (c11, c20, c35, c36, c46, c58, c60, c62)
Combinations of wiki + markdown syntax, selected-files injection, embed/backlink interplay, and active-file skip behavior.

### Negative & Parser Limits (c12, c18, c30, c38, c39, c56, c64)
No-link controls, unsupported syntax, markdown-only links, and parser leakage checks for code/comment contexts.

### Structural Edge Cases (c33, c41-c44, c47, c48, c52, c53, c57)
Self-links, nonexistent targets, unicode paths, diamond graphs, deep folders, whitespace links, processed-backlink dedupe, and alias/basename collisions.

## Scoring

The runner prints:

- Case score: percent of cases where **all** expectations are satisfied.
- Piece score: percent of all expectations satisfied.
