import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

describe("esbuild config", () => {
	it("uses es2020 target for inline worker builds", () => {
		const configPath = path.resolve(process.cwd(), "esbuild.config.mjs");
		const source = readFileSync(configPath, "utf8");

		expect(source).toMatch(
			/inlineWorkerPlugin\(\{[\s\S]*target:\s*["']es2020["']/,
		);
	});

	it("uses esm format for inline worker builds", () => {
		const configPath = path.resolve(process.cwd(), "esbuild.config.mjs");
		const source = readFileSync(configPath, "utf8");

		expect(source).toMatch(
			/inlineWorkerPlugin\(\{[\s\S]*format:\s*["']esm["']/,
		);
	});
});
