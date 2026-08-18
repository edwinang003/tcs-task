/**
 * Vitest environment. SPEC §11.3 rule 2: `localStorage` is eleven lines we own
 * rather than jsdom or happy-dom, which exist to provide a DOM that none of
 * these tests need — they exercise `lib/`, not components.
 */
import 'fake-indexeddb/auto'

class MemoryStorage {
  #items = new Map<string, string>()
  get length() {
    return this.#items.size
  }
  getItem(key: string): string | null {
    return this.#items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.#items.set(key, String(value))
  }
  removeItem(key: string): void {
    this.#items.delete(key)
  }
  clear(): void {
    this.#items.clear()
  }
  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null
  }
}

globalThis.localStorage = new MemoryStorage() as unknown as Storage
