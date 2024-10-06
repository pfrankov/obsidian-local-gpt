import { openDB, IDBPDatabase } from "idb";

interface CacheItem {
	mtime: number;
	chunks: {
		content: string;
		embedding: number[];
	}[];
}

class EmbeddingsCache {
	private db: IDBPDatabase | null = null;
	private vaultId: string = "";

	async init(vaultId: string) {
		this.vaultId = vaultId;
		const dbName = `LocalGPTCache/${this.vaultId}`;
		this.db = await openDB(dbName, 1, {
			upgrade(db) {
				db.createObjectStore("embeddings");
			},
		});
	}

	async get(key: string): Promise<CacheItem | undefined> {
		if (!this.db) throw new Error("Database not initialized");
		return this.db.get("embeddings", key);
	}

	async set(key: string, value: CacheItem): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.put("embeddings", value, key);
	}

	async clear(): Promise<void> {
		if (!this.db) throw new Error("Database not initialized");
		await this.db.clear("embeddings");
	}
}

export const embeddingsCache = new EmbeddingsCache();
