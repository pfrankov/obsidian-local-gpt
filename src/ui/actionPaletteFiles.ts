import type { Vault } from "obsidian";
import type { FileReference } from "../interfaces";

export interface PaletteFileSource {
	getFiles(): FileReference[];
	dispose(): void;
}

/** One lazy snapshot per mounted palette, refreshed after structural vault changes. */
export function createPaletteFileSource(
	vault: Pick<Vault, "getMarkdownFiles" | "getFiles" | "on" | "offref">,
): PaletteFileSource {
	let files: FileReference[] | undefined;
	const invalidate = () => {
		files = undefined;
	};
	// Folder events also invalidate paths of their descendants.
	const refs = [
		vault.on("create", invalidate),
		vault.on("delete", invalidate),
		vault.on("rename", invalidate),
	];
	return {
		getFiles() {
			return (files ??= vault
				.getMarkdownFiles()
				.concat(
					vault.getFiles().filter((file) => file.extension === "pdf"),
				)
				.map(({ path, basename, extension }) => ({
					path,
					basename,
					extension,
				})));
		},
		dispose() {
			refs.forEach((ref) => vault.offref(ref));
			files = undefined;
		},
	};
}
