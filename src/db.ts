// Minimal IndexedDB wrapper. All files live in the browser; there is no backend.

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  addedAt: number;
  blob: Blob;
  /** Small JPEG preview for images/videos, if one could be generated. */
  thumb?: Blob;
}

const DB_NAME = "zippo";
const DB_VERSION = 1;
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("addedAt", "addedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        let result: T;
        if (req) req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
      }),
  );
}

export async function listFiles(): Promise<StoredFile[]> {
  const files = await run<StoredFile[]>("readonly", s => s.index("addedAt").getAll());
  return files ?? [];
}

export function putFile(file: StoredFile): Promise<IDBValidKey> {
  return run("readwrite", s => s.put(file));
}

export function deleteFile(id: string): Promise<undefined> {
  return run("readwrite", s => s.delete(id));
}

export function clearFiles(): Promise<undefined> {
  return run("readwrite", s => s.clear());
}
