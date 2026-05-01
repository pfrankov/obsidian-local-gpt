import { describe, expect, it, vi } from "vitest";
import path from "path";
import fs from "fs";
import { getLinkedFiles, startProcessing } from "../src/rag";
import { TFile, Vault, MetadataCache } from "obsidian";
import { fileCache } from "../src/indexedDB";

vi.mock("../src/logger");

interface CaseExpected {
	marker: string;
	file: string;
}

interface CaseMeta {
	id: string;
	title: string;
	description: string;
	activeFile: string;
	selection: string;
	selectedFiles?: string[];
	expected: CaseExpected[];
	forbidden?: CaseExpected[];
}

interface CaseFile {
	path: string;
	content: string;
}

interface FileIndex {
	filesByPath: Map<string, TFile>;
	filesByBasename: Map<string, string[]>;
	aliasToPath: Map<string, string>;
}

interface CaseResult {
	missingExpected: CaseExpected[];
	unexpected: CaseExpected[];
	totalPieces: number;
	foundPieces: number;
}

interface BenchmarkTotals {
	failures: string[];
	totalPieces: number;
	foundPieces: number;
	passedCases: number;
}

const CASE_ROOT = path.join(
	process.cwd(),
	"benchmarks",
	"rag-vault",
);

const WIKI_LINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_LINK_REGEX = /\[[^\]]*\]\(([^)]+)\)/g;

function readCaseMeta(caseDir: string): CaseMeta {
	const raw = fs.readFileSync(path.join(caseDir, "case.json"), "utf8");
	return JSON.parse(raw) as CaseMeta;
}

function collectCaseFiles(caseDir: string): CaseFile[] {
	const results: CaseFile[] = [];

	const walk = (dir: string) => {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (entry.name === "case.json") continue;
			const relativePath = path
				.relative(caseDir, fullPath)
				.split(path.sep)
				.join("/");
			const content = fs.readFileSync(fullPath, "utf8");
			results.push({ path: relativePath, content });
		}
	};

	walk(caseDir);
	return results;
}

function readFrontmatter(content: string): string | null {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	return match ? match[1] : null;
}

function stripQuotes(value: string): string {
	return value.replace(/^['"]+|['"]+$/g, "").trim();
}

function parseInlineAliases(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed
			.slice(1, -1)
			.split(",")
			.map((item) => stripQuotes(item))
			.filter(Boolean);
	}
	return [stripQuotes(trimmed)].filter(Boolean);
}

function parseAliasBlock(block: string): string[] {
	return block
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => stripQuotes(line.slice(2)))
		.filter(Boolean);
}

function extractFrontmatterAliases(content: string): string[] {
	const frontmatter = readFrontmatter(content);
	if (!frontmatter) return [];

	const blockMatch = frontmatter.match(
		/^(?:aliases|alias):\s*\n((?:\s*-\s*.+\n?)+)/m,
	);
	if (blockMatch) return parseAliasBlock(blockMatch[1]);

	const inlineMatch = frontmatter.match(/^(?:aliases|alias):\s*(.+)$/m);
	if (inlineMatch) return parseInlineAliases(inlineMatch[1]);

	return [];
}

function addBasename(
	filesByBasename: Map<string, string[]>,
	basename: string,
	filePath: string,
) {
	const list = filesByBasename.get(basename) || [];
	list.push(filePath);
	filesByBasename.set(basename, list);
}

function createFileIndex(files: CaseFile[]): FileIndex {
	const filesByPath = new Map<string, TFile>();
	const filesByBasename = new Map<string, string[]>();
	const aliasToPath = new Map<string, string>();

	let counter = 1;
	for (const file of files) {
		const extension = file.path.split(".").pop() || "";
		const basename = path.posix.basename(file.path, `.${extension}`);

		const tfile = new TFile();
		tfile.path = file.path;
		tfile.extension = extension;
		tfile.basename = basename;
		tfile.stat = { ctime: counter, mtime: counter } as any;
		counter += 1;

		filesByPath.set(file.path, tfile);
		addBasename(filesByBasename, basename, file.path);

		if (extension === "md") {
			for (const alias of extractFrontmatterAliases(file.content)) {
				aliasToPath.set(alias, file.path);
			}
		}
	}

	return { filesByPath, filesByBasename, aliasToPath };
}

function buildCandidatePaths(normalized: string): string[] {
	if (normalized.endsWith(".md") || normalized.endsWith(".pdf")) {
		return [normalized];
	}
	return [`${normalized}.md`, `${normalized}.pdf`];
}

function resolveByCandidate(
	candidates: string[],
	filesByPath: Map<string, TFile>,
): TFile | null {
	for (const candidate of candidates) {
		const file = filesByPath.get(candidate);
		if (file) return file;
	}
	return null;
}

function resolveByBasename(
	normalized: string,
	currentFilePath: string,
	filesByBasename: Map<string, string[]>,
	filesByPath: Map<string, TFile>,
): TFile | null {
	const basename = normalized.replace(/\.(md|pdf)$/i, "");
	const sameNamePaths = filesByBasename.get(basename);
	if (!sameNamePaths?.length) return null;

	const fromDir = path.posix.dirname(currentFilePath);
	const sameDir = sameNamePaths.find(
		(filePath) => path.posix.dirname(filePath) === fromDir,
	);
	const chosen = sameDir || sameNamePaths[0];
	return filesByPath.get(chosen) || null;
}

function resolveByAlias(
	normalized: string,
	aliasToPath: Map<string, string>,
	filesByPath: Map<string, TFile>,
): TFile | null {
	const aliasPath = aliasToPath.get(normalized);
	return aliasPath ? filesByPath.get(aliasPath) || null : null;
}

function createLinkResolver(index: FileIndex) {
	return (linkText: string, currentFilePath: string) => {
		const normalized = linkText.trim();
		if (!normalized) return null;

		const candidate = resolveByCandidate(
			buildCandidatePaths(normalized),
			index.filesByPath,
		);
		if (candidate) return candidate;

		const byBasename = resolveByBasename(
			normalized,
			currentFilePath,
			index.filesByBasename,
			index.filesByPath,
		);
		if (byBasename) return byBasename;

		return resolveByAlias(normalized, index.aliasToPath, index.filesByPath);
	};
}

function addResolvedLink(
	links: Record<string, number>,
	linked: TFile | null,
) {
	if (!linked) return;
	links[linked.path] = (links[linked.path] || 0) + 1;
}

function collectLinks(
	content: string,
	filePath: string,
	resolveLink: (linkText: string, currentFilePath: string) => TFile | null,
) {
	const links: Record<string, number> = {};
	for (const match of content.matchAll(WIKI_LINK_REGEX)) {
		addResolvedLink(links, resolveLink(match[1], filePath));
	}

	for (const match of content.matchAll(MARKDOWN_LINK_REGEX)) {
		const raw = match[1].split("#")[0].trim();
		if (!raw) continue;
		addResolvedLink(links, resolveLink(raw, filePath));
	}

	return links;
}

function buildResolvedLinks(
	files: CaseFile[],
	resolveLink: (linkText: string, currentFilePath: string) => TFile | null,
) {
	const resolvedLinks: Record<string, Record<string, number>> = {};
	for (const file of files) {
		const extension = file.path.split(".").pop() || "";
		if (extension !== "md") continue;

		const links = collectLinks(file.content, file.path, resolveLink);
		if (Object.keys(links).length) {
			resolvedLinks[file.path] = links;
		}
	}
	return resolvedLinks;
}

function createVault(files: CaseFile[], filesByPath: Map<string, TFile>) {
	return {
		cachedRead: vi.fn(async (file: TFile) => {
			const found = files.find((entry) => entry.path === file.path);
			return found?.content || "";
		}),
		getAbstractFileByPath: vi.fn((filePath: string) =>
			filesByPath.get(filePath) || null,
		),
	} as unknown as Vault;
}

function createMetadataCache(
	resolveLink: (linkText: string, currentFilePath: string) => TFile | null,
	resolvedLinks: Record<string, Record<string, number>>,
) {
	return {
		getFirstLinkpathDest: (linkText: string, currentFilePath: string) => {
			const resolved = resolveLink(linkText, currentFilePath);
			return resolved ? { path: resolved.path } : null;
		},
		resolvedLinks,
	} as unknown as MetadataCache;
}

function buildCaseVault(files: CaseFile[]) {
	const index = createFileIndex(files);
	const resolveLink = createLinkResolver(index);
	const resolvedLinks = buildResolvedLinks(files, resolveLink);
	const vault = createVault(files, index.filesByPath);
	const metadataCache = createMetadataCache(resolveLink, resolvedLinks);

	return { vault, metadataCache, filesByPath: index.filesByPath };
}

async function runCase(
	meta: CaseMeta,
	caseDir: string,
): Promise<CaseResult | { error: string }> {
	const files = collectCaseFiles(caseDir);
	const { vault, metadataCache, filesByPath } = buildCaseVault(files);
	const activeFile = filesByPath.get(meta.activeFile);

	if (!activeFile) {
		return { error: `${meta.id}: active file not found` };
	}

	const linkedFiles = getLinkedFiles(
		meta.selection,
		vault,
		metadataCache,
		activeFile.path,
	);
	const extraFiles = (meta.selectedFiles || [])
		.map((filePath) => vault.getAbstractFileByPath(filePath))
		.filter((file): file is TFile =>
			Boolean(
				file &&
				file instanceof TFile &&
				(file.extension === "md" || file.extension === "pdf"),
			),
		);

	const initialFiles = [...linkedFiles, ...extraFiles];

	const pdfCache = new Map<string, { mtime: number; content: string }>();
	for (const entry of files) {
		if (!entry.path.endsWith(".pdf")) continue;
		const tfile = filesByPath.get(entry.path);
		if (!tfile) continue;
		pdfCache.set(entry.path, {
			mtime: tfile.stat.mtime,
			content: entry.content,
		});
	}

	const getContentSpy = vi
		.spyOn(fileCache, "getContent")
		.mockImplementation(async (key) => pdfCache.get(key));
	const setContentSpy = vi
		.spyOn(fileCache, "setContent")
		.mockResolvedValue();

	let processedDocs: Map<string, { content: string }>;
	try {
		processedDocs = (await startProcessing(
			initialFiles,
			vault,
			metadataCache,
			activeFile,
			undefined,
			false,
		)) as unknown as Map<string, { content: string }>;
	} finally {
		getContentSpy.mockRestore();
		setContentSpy.mockRestore();
	}

	const docByPath = new Map(
		Array.from(processedDocs.entries()).map(([key, doc]) => [
			key,
			doc.content,
		]),
	);

	const missingExpected = meta.expected.filter((expected) => {
		const content = docByPath.get(expected.file);
		return !content || !content.includes(expected.marker);
	});

	const forbidden = meta.forbidden || [];
	const unexpected = forbidden.filter((item) => {
		const content = docByPath.get(item.file);
		return content?.includes(item.marker);
	});

	const totalPieces = meta.expected.length + forbidden.length;
	const foundPieces = totalPieces - missingExpected.length - unexpected.length;

	return { missingExpected, unexpected, totalPieces, foundPieces };
}

function listCaseDirs(): string[] {
	return fs
		.readdirSync(CASE_ROOT)
		.filter((entry) => entry.startsWith("c"))
		.sort();
}

function formatMarkerList(items: CaseExpected[]): string {
	return items.map((item) => `${item.marker} (${item.file})`).join(", ");
}

function buildFailureLine(
	meta: CaseMeta,
	result: CaseResult,
): string | null {
	const failureParts: string[] = [];
	if (result.missingExpected.length) {
		failureParts.push(`missing ${formatMarkerList(result.missingExpected)}`);
	}
	if (result.unexpected.length) {
		failureParts.push(`unexpected ${formatMarkerList(result.unexpected)}`);
	}
	if (failureParts.length === 0) return null;
	return `${meta.id}: ${failureParts.join("; ")}`;
}

function applyCaseResult(
	totals: BenchmarkTotals,
	meta: CaseMeta,
	result: CaseResult | { error: string },
) {
	if ("error" in result) {
		totals.failures.push(result.error);
		return;
	}

	totals.totalPieces += result.totalPieces;
	totals.foundPieces += result.foundPieces;

	const failureLine = buildFailureLine(meta, result);
	if (failureLine) {
		totals.failures.push(failureLine);
	} else {
		totals.passedCases += 1;
	}
}

describe("RAG Benchmark", () => {
	it("measures document graph coverage", async () => {
		const caseDirs = listCaseDirs();
		const totals: BenchmarkTotals = {
			failures: [],
			totalPieces: 0,
			foundPieces: 0,
			passedCases: 0,
		};

		for (const dir of caseDirs) {
			const caseDir = path.join(CASE_ROOT, dir);
			const meta = readCaseMeta(caseDir);
			const result = await runCase(meta, caseDir);
			applyCaseResult(totals, meta, result);
		}

		const totalCases = caseDirs.length;
		const { failures, totalPieces, foundPieces, passedCases } = totals;
		const caseScore = totalCases
			? (passedCases / totalCases) * 100
			: 0;
		const pieceScore = totalPieces
			? (foundPieces / totalPieces) * 100
			: 0;

		console.log("RAG benchmark summary");
		console.log(`Cases: ${passedCases}/${totalCases} (${caseScore.toFixed(1)}%)`);
		console.log(
			`Pieces: ${foundPieces}/${totalPieces} (${pieceScore.toFixed(1)}%)`,
		);
		if (failures.length) {
			console.log("Failures:");
			for (const line of failures) {
				console.log(`- ${line}`);
			}
		}

		expect(failures).toHaveLength(0);
	});
});
