/**
 * IndexedDB key/value store.
 * Same shape as the artifact's window.storage so the app code did not change:
 *   get(key)    -> { key, value } | null
 *   set(key, v) -> { key, value }
 *   delete(key) -> { key, deleted: true }
 *   list(prefix)-> { keys: [...] }
 *
 * localStorage would cap out around 5MB, and card photos blow through that
 * fast. IndexedDB gives you hundreds of megabytes and stays off the main
 * thread.
 */

const DB_NAME = "rolodeal";
const STORE = "kv";
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const request = fn(s);
        t.oncomplete = () => resolve(request ? request.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export const store = {
  async get(key) {
    const value = await tx("readonly", (s) => s.get(key));
    return value === undefined ? null : { key, value };
  },

  async set(key, value) {
    await tx("readwrite", (s) => s.put(value, key));
    return { key, value };
  },

  async delete(key) {
    await tx("readwrite", (s) => s.delete(key));
    return { key, deleted: true };
  },

  async list(prefix = "") {
    const keys = await tx("readonly", (s) => s.getAllKeys());
    return { keys: (keys || []).filter((k) => String(k).startsWith(prefix)) };
  },

  /** Rough sense of how much room is left. Useful before a big import. */
  async quota() {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usedMB: +(usage / 1e6).toFixed(1), quotaMB: +(quota / 1e6).toFixed(0) };
  },
};

/**
 * Ask the browser to keep this data through storage pressure.
 * Without it, a background eviction can wipe the deck. Safari is the
 * one that actually needs this.
 */
export async function persistStorage() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not fatal */
  }
  return false;
}
