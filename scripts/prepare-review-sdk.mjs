// Temporary review setup for AI Providers #39. Remove after SDK publication.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "73e60d54b0a27a07e68c0ae3b2fff0f313af1653";
const root = fileURLToPath(new URL("../", import.meta.url));
const checkout = mkdtempSync(join(tmpdir(), "local-gpt-review-sdk-"));
const run = (command, args, cwd = checkout) =>
	execFileSync(command, args, { cwd, stdio: "inherit" });

try {
	// Require npm ci first; only replace its SDK, never change the lockfile.
	const target = join(root, "node_modules/@obsidian-ai-providers/sdk");
	const installed = JSON.parse(
		readFileSync(join(target, "package.json"), "utf8"),
	);
	if (installed.name !== "@obsidian-ai-providers/sdk") {
		throw new Error("Run npm ci before preparing the review SDK");
	}
	run("git", ["init", "--quiet"]);
	run("git", [
		"fetch",
		"--depth=1",
		"https://github.com/pfrankov/obsidian-ai-providers.git",
		revision,
	]);
	run("git", ["checkout", "--detach", "FETCH_HEAD"]);
	const actual = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: checkout,
		encoding: "utf8",
	}).trim();
	if (actual !== revision) throw new Error("Unexpected SDK source revision");
	// SDK build needs no dependency lifecycle hooks or Electron download.
	run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
	run("npm", ["run", "sdk:build"]);
	rmSync(target, { recursive: true });
	for (const file of ["dist", "package.json", "README.md"]) {
		cpSync(join(checkout, "packages/sdk", file), join(target, file), {
			recursive: true,
		});
	}
	console.log(
		`Prepared review SDK from ${revision}; package-lock.json is unchanged.`,
	);
} finally {
	rmSync(checkout, { recursive: true, force: true });
}
