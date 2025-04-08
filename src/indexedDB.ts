// --- START OF FILE indexedDB.ts ---

// Import only the used types from 'idb'
import { openDB, IDBPDatabase, IDBPTransaction, DBSchema, StoreNames } from "idb"; // Removed unused IDBPCursor, TxMode
import { logger } from "./logger";

// Define the schema for type safety
interface LocalGPTDBSchema extends DBSchema {
	embeddings: {
		key: string;
		value: EmbeddingsCacheItem;
	};
	content: {
		key: string;
		value: ContentCacheItem;
	};
}

// Define store names type for better transaction handling
type LocalGPTStoreNames = StoreNames<LocalGPTDBSchema>;

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
	private db: IDBPDatabase<LocalGPTDBSchema> | null = null;
	// Let TypeScript infer types for simple string initializations
	private vaultId = "";
	private dbName = "";

	async init(vaultId: string): Promise<void> {
		this.vaultId = vaultId;
		this.dbName = `LocalGPTCache/${this.vaultId}`;
		logger.debug(`Initializing IndexedDB: ${this.dbName}`);
		try {
			this.db = await openDB<LocalGPTDBSchema>(this.dbName, 2, {
				upgrade(
					db: IDBPDatabase<LocalGPTDBSchema>,
					oldVersion: number,
					newVersion: number | null,
					transaction: IDBPTransaction<LocalGPTDBSchema, LocalGPTStoreNames[], "versionchange">,
					event: IDBVersionChangeEvent
				) {
					logger.info(`Upgrading IndexedDB '${db.name}' from v${oldVersion} to v${newVersion}`);
					if (oldVersion < 1) {
						logger.debug("Creating 'embeddings' object store");
						db.createObjectStore("embeddings");
					}
					if (oldVersion < 2) {
						logger.debug("Creating 'content' object store");
						if (!db.objectStoreNames.contains("content")) {
							db.createObjectStore("content");
						} else {
							logger.debug("'content' object store already exists.");
						}
					}
					logger.info(`IndexedDB upgrade to v${newVersion} complete.`);
				},
				blocked(currentVersion, blockedVersion, event) {
					logger.error(`Local GPT IndexedDB open is blocked. Current: v${currentVersion}, Attempting: v${blockedVersion}. Close other tabs/windows.`);
				},
				blocking(currentVersion, blockedVersion, event) {
					logger.warn(`Local GPT IndexedDB is blocking upgrade. Current: v${currentVersion}, Blocked: v${blockedVersion}. Consider reloading.`);
				},
				terminated() {
					logger.error("Local GPT IndexedDB: Database connection terminated unexpectedly.");
					this.db = null;
				},
			});
			logger.info(`Local GPT IndexedDB '${this.dbName}' opened successfully.`);
		} catch (error) {
			logger.error(`Local GPT: Failed to open IndexedDB '${this.dbName}':`, error);
			this.db = null;
		}
	}

	private async ensureDb(): Promise<IDBPDatabase<LocalGPTDBSchema>> {
		if (!this.db) {
			logger.warn("IndexedDB: Database not initialized or connection lost. Re-init attempt.");
			if (!this.vaultId) {
				throw new Error("IndexedDB: Vault ID not set, cannot re-initialize.");
			}
			// Use stored dbName if available, otherwise reconstruct
			// const nameToUse = this.dbName || `LocalGPTCache/${this.vaultId}`; // Removed as unused
			await this.init(this.vaultId);
			if (!this.db) {
				throw new Error("IndexedDB: Re-initialization failed.");
			}
		}
		return this.db;
	}

	async getEmbeddings(key: string): Promise<EmbeddingsCacheItem | undefined> {
		try {
			const db = await this.ensureDb();
			return await db.get("embeddings", key);
		} catch (error) {
			logger.error(`IndexedDB Get Embeddings Error (key: "${key}"):`, error);
			return undefined;
		}
	}

	async setEmbeddings(key: string, value: EmbeddingsCacheItem): Promise<void> {
		try {
			const db = await this.ensureDb();
			const tx = db.transaction("embeddings", "readwrite");
			await tx.store.put(value, key);
			await tx.done;
		} catch (error) {
			logger.error(`IndexedDB Set Embeddings Error (key: "${key}"):`, error);
		}
	}

	async getContent(key: string): Promise<ContentCacheItem | undefined> {
		try {
			const db = await this.ensureDb();
			if (!db.objectStoreNames.contains("content")) return undefined;
			return await db.get("content", key);
		} catch (error) {
			logger.error(`IndexedDB Get Content Error (key: "${key}"):`, error);
			return undefined;
		}
	}

	async setContent(key: string, value: ContentCacheItem): Promise<void> {
		try {
			const db = await this.ensureDb();
			if (!db.objectStoreNames.contains("content")) { logger.error(`IndexedDB Set Content Error: Store 'content' not found.`); return; }
			const tx = db.transaction("content", "readwrite");
			await tx.store.put(value, key);
			await tx.done;
		} catch (error) {
			logger.error(`IndexedDB Set Content Error (key: "${key}"):`, error);
		}
	}

	async clearEmbeddings(): Promise<void> {
		try {
			const db = await this.ensureDb();
			if (!db.objectStoreNames.contains("embeddings")) return;
			await db.clear("embeddings");
			logger.info("IndexedDB: Embeddings cache cleared.");
		} catch (error) {
			logger.error(`IndexedDB Clear Embeddings Error:`, error);
		}
	}

	async clearContent(): Promise<void> {
		try {
			const db = await this.ensureDb();
			if (!db.objectStoreNames.contains("content")) return;
			await db.clear("content");
			logger.info("IndexedDB: Content cache cleared.");
		} catch (error) {
			logger.error(`IndexedDB Clear Content Error:`, error);
		}
	}

	async clearAll(): Promise<void> {
		logger.warn("Clearing ALL IndexedDB caches...");
		await Promise.all([
			this.clearEmbeddings(),
			this.clearContent()
		]).catch(error => { logger.error("Error during clearAll:", error); });
		logger.info("IndexedDB: All known caches cleared.");
	}
}

export const fileCache = new FileCache();

// --- END OF FILE indexedDB.ts ---