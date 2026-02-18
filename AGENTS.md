# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Core plugin code. Entry is `src/main.ts`; RAG logic in `src/rag.ts`; settings UI in `src/LocalGPTSettingTab.ts`; helpers in `utils.ts`, `indexedDB.ts`, `request-handler.ts`, `i18n/`.
- `tests/`: Jest unit tests (`**/*.test.ts`) and mocks in `tests/__mocks__/`.
- `dist/`: Build output produced by esbuild; `manifest.json` and `styles.css` are copied/bundled here.
- `obsidian-ai-providers/`: SDK and test utilities used by this repo; not bundled into the plugin.
- Root assets: `manifest.json`, `styles.css`, `esbuild.config.mjs`, `jest.config.js`.

## Build, Test, and Development Commands
- `npm run dev`: Start esbuild in watch mode and rebuild on changes.
- `npm run build`: Type-check (tsc) and produce production bundle in `dist/`.
- `npm test`: Run Jest test suite.
- `npm run format`: Format TS/JSON with Prettier.
- `npm run check`: Required validation (lint, typecheck, tests) before sharing changes.
- `npm run full-check`: Format, build, then test.
- `npm run version`: Bump plugin version and stage `manifest.json`/`versions.json` (maintainers).

## Coding Style & Naming Conventions
- TypeScript, tabs for indentation (width 4), LF line endings (`.editorconfig`).
- Prettier for formatting; ESLint with `@typescript-eslint` (see `.eslintrc`). Unused args allowed, `// @ts-` comments permitted where needed.
- Naming: use descriptive file/module names; PascalCase for classes/interfaces; tests mirror source names with `.test.ts`.

## Localization
- When adding or changing strings in `src/i18n/*.json`, update all language files with context-appropriate translations.

## Testing Guidelines
- Framework: Jest + `ts-jest`; tests in `tests/**/*.test.ts`.
- Mocks: use `tests/__mocks__/` and provider mocks under `obsidian-ai-providers/` (mapped in `jest.config.js`).
- Examples: run a single test `npm test -- -t "RAG Functions"`; watch `npm test -- --watch`.
- Required: run `npm run check` after every change before responding; if it cannot be run, state the reason explicitly.
- Aim to cover new logic (RAG selection, request handling, utils). No coverage threshold enforced.

## Commit & Pull Request Guidelines
- Commits: concise, imperative, scoped when helpful (e.g., `rag: improve ranking`). Reference issues (`#123`).
- PRs: include summary, rationale, test plan, and screenshots/GIFs for UI changes. Update docs (`README.md`, `docs/`) when behavior changes. Keep diffs focused.
- Releases are versioned via `npm run version`; maintainers will publish.

## Security & Configuration Tips
- Do not commit secrets or API keys. Configure providers via the “AI Providers” plugin settings, not hardcoded URLs.
- Network calls should flow through existing helpers (`request-handler.ts`) and Obsidian APIs. Prefer mocks in tests.
