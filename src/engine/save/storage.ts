import type { SaveData, SaveMeta } from './format'

/** Where saves live. IndexedDB in the browser, memory in tests. */
export interface SaveStorage {
  list(): Promise<SaveMeta[]>
  read(slot: string): Promise<SaveData | null>
  write(data: SaveData): Promise<void>
  remove(slot: string): Promise<void>
}

export class MemoryStorage implements SaveStorage {
  private saves = new Map<string, SaveData>()
  async list() {
    return [...this.saves.values()].map((s) => structuredClone(s.meta))
  }
  async read(slot: string) {
    const s = this.saves.get(slot)
    return s ? structuredClone(s) : null
  }
  async write(data: SaveData) {
    this.saves.set(data.meta.slot, structuredClone(data))
  }
  async remove(slot: string) {
    this.saves.delete(slot)
  }
}

/** Two object stores: small `meta` (for listing) and full `data`. */
export class IndexedDbStorage implements SaveStorage {
  private db?: Promise<IDBDatabase>

  constructor(private name = 'compulsive-living') {}

  async list(): Promise<SaveMeta[]> {
    const metas = await this.request<SaveMeta[]>('meta', 'readonly', (s) => s.getAll())
    return metas.sort((a, b) => b.savedAt - a.savedAt)
  }

  async read(slot: string): Promise<SaveData | null> {
    return (await this.request<SaveData | undefined>('data', 'readonly', (s) => s.get(slot))) ?? null
  }

  async write(data: SaveData): Promise<void> {
    const db = await this.open()
    await done(
      (() => {
        const tx = db.transaction(['meta', 'data'], 'readwrite')
        tx.objectStore('meta').put(data.meta)
        tx.objectStore('data').put(data)
        return tx
      })(),
    )
  }

  async remove(slot: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(['meta', 'data'], 'readwrite')
    tx.objectStore('meta').delete(slot)
    tx.objectStore('data').delete(slot)
    await done(tx)
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'slot' })
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'meta.slot' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.db
  }

  private async request<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
