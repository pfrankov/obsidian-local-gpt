import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sveltePreprocess from "svelte-preprocess";
import path from "path";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "tests/__mocks__/obsidian.ts"),
			electron: path.resolve(__dirname, "tests/__mocks__/electron.ts"),
			defaultSettings: path.resolve(
				__dirname,
				"src/defaultSettings.ts",
			),
			"../logger.js": path.resolve(__dirname, "src/logger.ts"),
			"./pdf.worker.js": path.resolve(
				__dirname,
				"tests/__mocks__/pdf.worker.js",
			),
		},
	},
	plugins: [
		svelte({
			preprocess: sveltePreprocess(),
		}),
	],
	test: {
		environment: "jsdom",
		include: ["tests/**/*.{test,vitest}.ts"],
		setupFiles: ["./tests/setupTests.ts"],
		coverage: {
			provider: "v8",
			all: true,
			reporter: ["text", "lcov"],
			include: [
				"src/rag.ts",
				"src/utils.ts",
				"src/ui/actionPaletteHistory.ts",
				"src/indexedDB.ts",
				"src/i18n/index.ts",
				"src/defaultSettings.ts",
			],
			exclude: ["**/*.d.ts"],
			lines: 100,
			functions: 100,
			branches: 100,
			statements: 100,
		},
	},
});
