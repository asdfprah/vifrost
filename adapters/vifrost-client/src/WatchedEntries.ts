import type { WatchedEntry, WatchHandle } from './types.js'

/**
 * The entries of a cache, one per key, shared by everyone watching the same key: the first
 * watcher fetches it, the last one to release it drops it.
 */
export class WatchedEntries<S, E extends WatchedEntry<S>> {
  private readonly entries = new Map<string, E>()

  /**
   * Starts watching the entry of a key, creating and fetching it when no one watches it yet.
   *
   * @param {string} key
   * @param {() => E} create builds the entry when the key has none
   * @returns {WatchHandle<S>}
   */
  watch(key: string, create: () => E): WatchHandle<S> {
    let entry = this.entries.get(key)
    const isNew = entry === undefined
    if (!entry) {
      entry = create()
      this.entries.set(key, entry)
    }
    entry.watchers++
    if (isNew) {
      void entry.refetch()
    }

    const watched = entry
    let released = false
    return {
      snapshot: () => watched.snapshot(),
      subscribe: (listener) => watched.subscribe(listener),
      refetch: () => watched.refetch(),
      release: () => {
        if (released) {
          return
        }
        released = true
        watched.watchers--
        if (watched.watchers === 0 && this.entries.get(key) === watched) {
          watched.dispose()
          this.entries.delete(key)
        }
      },
    }
  }

  /**
   * @returns {E[]} every entry someone watches
   */
  values(): E[] {
    return [...this.entries.values()]
  }

  /**
   * Drops every entry.
   *
   * @returns {void}
   */
  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.dispose()
    }
    this.entries.clear()
  }
}
