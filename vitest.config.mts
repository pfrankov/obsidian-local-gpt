import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sveltePreprocess from "svelte-preprocess";

export default defineConfig({
	plugins: [
		svelte({
			preprocess: sveltePreprocess(),
		}),
	],
	test: {
		environment: "jsdom",
		include: ["tests/**/*.vitest.ts"],
	},
});
