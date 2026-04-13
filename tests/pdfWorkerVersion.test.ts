import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

describe("PDF Worker Version Sync", () => {
	it("keeps checked-in worker version in sync with installed pdfjs-dist", () => {
		const workerPath = path.resolve(
			process.cwd(),
			"src/processors/pdf.worker.js",
		);
		const installedPdfPath = path.resolve(
			process.cwd(),
			"node_modules/pdfjs-dist/package.json",
		);

		const workerSource = readFileSync(workerPath, "utf8");
		const installedPdf = JSON.parse(readFileSync(installedPdfPath, "utf8")) as {
			version: string;
		};

		const match = workerSource.match(/pdfjsVersion\s*=\s*([0-9.]+)/);
		expect(match?.[1]).toBe(installedPdf.version);
	});

	it("uses pdfjs legacy entrypoint for Node-compatible test/runtime behavior", () => {
		const pdfProcessorPath = path.resolve(process.cwd(), "src/processors/pdf.ts");
		const pdfProcessorSource = readFileSync(pdfProcessorPath, "utf8");

		expect(pdfProcessorSource).toContain("pdfjs-dist/legacy/build/pdf.mjs");
	});
});
