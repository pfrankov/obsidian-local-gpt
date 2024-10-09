import { openDB, IDBPDatabase } from "idb";

interface EmbeddingsCacheItem {
	mtime: number;
	chunks: {
		content: string;
		embedding: number[];
	}[];
}

interface ContentCacheItem {
	mtime: number;
	content: string;
}

class FileCache {
	private db: IDBPDatabase | null = null;
	private vaultId: string = "";

	async init(vaultId: string) {
		this.vaultId = vaultId;
		const dbName = `LocalGPTCache/${this.vaultId}`;
		this.db = await openDB(dbName, 1, {
			upgrade(db) {
				db.createObjectStore("embeddings");
				db.createObjectStore("content");
			},
		});
	}

	async getEmbeddings(key: string): Promise<EmbeddingsCacheItem | undefined> {
		if (!this.db) throw new Error("Database not initialized");
		return this.db.get("embeddings", key);
	}

	async setEmbeddings(
		key: string,
		value: EmbeddingsCacheItem,
	): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.put("embeddings", value, key);
	}

	async getContent(key: string): Promise<ContentCacheItem | undefined> {
		if (!this.db) throw new Error("Database not initialized");
		return this.db.get("content", key);
	}

	async setContent(key: string, value: ContentCacheItem): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.put("content", value, key);
	}

	async clearEmbeddings(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.clear("embeddings");
	}

	async clearContent(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.clear("content");
	}

	async clearAll(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.clear("embeddings");
		await this.db.clear("content");
	}
}

export const fileCache = new FileCache();
