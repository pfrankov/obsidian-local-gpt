import { openDB, IDBPDatabase } from "idb";

interface ContentCacheItem {
	mtime: number;
	content: string;
}

class FileCache {
	private db: IDBPDatabase | null = null;
	private vaultId = "";
	async init(vaultId: string) {
		this.vaultId = vaultId;
		const dbName = `LocalGPTCache/${this.vaultId}`;
		this.db = await openDB(dbName, 3, {
			upgrade(db, oldVersion, newVersion) {
				// Version 1: embeddings store (deprecated)
				if (oldVersion < 1) {
					// Create embeddings store for old versions, but it will be removed in version 3
					if (!db.objectStoreNames.contains("embeddings")) {
						db.createObjectStore("embeddings");
					}
				}
				// Version 2: content store
				if (oldVersion < 2) {
					if (!db.objectStoreNames.contains("content")) {
						db.createObjectStore("content");
					}
				}
				// Version 3: remove embeddings store as caching moved to AI providers
				if (oldVersion < 3) {
					if (db.objectStoreNames.contains("embeddings")) {
						db.deleteObjectStore("embeddings");
					}
				}
			},
		});
	}

	async getContent(key: string): Promise<ContentCacheItem | undefined> {
		if (!this.db) throw new Error("Database not initialized");
		return this.db.get("content", key);
	}

	async setContent(key: string, value: ContentCacheItem): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.put("content", value, key);
	}

	async clearContent(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.clear("content");
	}

	async clearAll(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.clear("content");
	}
}

export const fileCache = new FileCache();
