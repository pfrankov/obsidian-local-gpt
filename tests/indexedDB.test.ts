import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileCache } from "../src/indexedDB";

// eslint-disable-next-line no-var -- var avoids TDZ when vi.mock is hoisted
var openDBMock: ReturnType<typeof vi.fn>;

vi.mock("idb", () => {
	const createDbStub = () => {
		const storeData = new Map<string, Map<string, unknown>>();
		const storeNames = new Set<string>();
		const db = {
			objectStoreNames: {
				contains: (name: string) => storeNames.has(name),
			},
			createObjectStore: vi.fn((name: string) => {
				storeNames.add(name);
				if (!storeData.has(name)) {
					storeData.set(name, new Map());
				}
			}),
			deleteObjectStore: vi.fn((name: string) => {
				storeNames.delete(name);
				storeData.delete(name);
			}),
			get: vi.fn((store: string, key: string) => {
				return storeData.get(store)?.get(key);
			}),
			put: vi.fn((store: string, value: unknown, key: string) => {
				if (!storeData.has(store)) {
					storeData.set(store, new Map());
				}
				storeData.get(store)!.set(key, value);
			}),
			clear: vi.fn((store: string) => {
				storeData.get(store)?.clear();
			}),
		};

		return { db, storeData, storeNames };
	};

	openDBMock = vi.fn(
		async (
			_dbName: string,
			_version: number,
			options?: {
				upgrade?: (db: ReturnType<typeof createDbStub>["db"], oldVersion: number, newVersion?: number) => void;
			},
		) => {
			const stub = createDbStub();
			options?.upgrade?.(stub.db as any, 0, 3);
			return stub.db as any;
		},
	);

	return { openDB: openDBMock };
});

beforeEach(() => {
	openDBMock?.mockClear();
	(fileCache as any).db = null;
	(fileCache as any).vaultId = "";
});

describe("fileCache", () => {
	it("throws when database is not initialized", async () => {
		await expect(fileCache.getContent("missing")).rejects.toThrow(
			"Database not initialized",
		);
		await expect(
			fileCache.setContent("missing", { mtime: 0, content: "" }),
		).rejects.toThrow("Database not initialized");
		await expect(fileCache.clearContent()).rejects.toThrow(
			"Database not initialized",
		);
		await expect(fileCache.clearAll()).rejects.toThrow(
			"Database not initialized",
		);
	});

	it("initializes storage with migrations", async () => {
		await fileCache.init("vault-1");

		expect(openDBMock).toHaveBeenCalledWith(
			"LocalGPTCache/vault-1",
			3,
			expect.objectContaining({ upgrade: expect.any(Function) }),
		);

		const db = await openDBMock.mock.results[0]!.value;
		expect(db.createObjectStore).toHaveBeenCalledWith("embeddings");
		expect(db.createObjectStore).toHaveBeenCalledWith("content");
		expect(db.deleteObjectStore).toHaveBeenCalledWith("embeddings");
	});

	it("stores, reads and clears cached content", async () => {
		await fileCache.init("vault-2");
		await fileCache.setContent("a", { mtime: 1, content: "hello" });
		await fileCache.setContent("b", { mtime: 2, content: "world" });

		expect(await fileCache.getContent("a")).toEqual({
			mtime: 1,
			content: "hello",
		});

		await fileCache.clearContent();
		expect(await fileCache.getContent("a")).toBeUndefined();

		await fileCache.setContent("c", { mtime: 3, content: "!" });
		await fileCache.clearAll();
		expect(await fileCache.getContent("c")).toBeUndefined();
	});
});
