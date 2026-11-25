/** Mods the player installed: the files as they came, by path. */
export interface StoredMod {
  id: string
  files: Record<string, Uint8Array>
}

export interface ModStore {
  all(): Promise<StoredMod[]>
  put(mod: StoredMod): Promise<void>
  remove(id: string): Promise<void>
}

export class MemoryModStore implements ModStore {
  private mods = new Map<string, StoredMod>()
  async all() {
    return [...this.mods.values()].map((m) => structuredClone(m))
  }
  async put(mod: StoredMod) {
    this.mods.set(mod.id, structuredClone(mod))
  }
  async remove(id: string) {
    this.mods.delete(id)
  }
}

export class IndexedDbModStore implements ModStore {
  private db?: Promise<IDBDatabase>

  constructor(private name = 'compulsive-living-mods') {}

  all(): Promise<StoredMod[]> {
    return this.run<StoredMod[]>('readonly', (s) => s.getAll())
  }

  async put(mod: StoredMod): Promise<void> {
    await this.run('readwrite', (s) => s.put(mod))
  }

  async remove(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id))
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('mods', { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.db
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('mods', mode)
      const req = fn(tx.objectStore('mods'))
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
}
