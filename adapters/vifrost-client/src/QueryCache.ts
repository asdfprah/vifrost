import { HttpError } from './HttpError.js'
import type { Model } from './Model.js'
import type { QueryBuilder } from './QueryBuilder.js'
import { QueryEntry } from './QueryEntry.js'
import type { QueryCacheOptions, QueryHandle, SyncResult } from './types.js'

const DEFAULT_DEBOUNCE_MS = 50
const DEFAULT_MAX_QUERIES = 20

/**
 * Holds the queries reactive bindings (such as `@vifrost/vue`'s `useQuery`) watch, sharing one
 * request between identical queries. With a {@link Registry}, it also keeps them in sync: rows
 * follow the Registry, and the lists of a resource refresh when the Registry reports one of its
 * records created, updated or deleted.
 *
 * @remarks
 * Changes that arrive close together are refreshed at once: in one request to the sync endpoint
 * when {@link SyncOptions.path} is set, or by refetching each affected list otherwise. A query
 * nobody watches is dropped, so it is fetched fresh when watched again.
 */
export class QueryCache {
  private readonly entries = new Map<string, QueryEntry<Model>>()
  private pendingResources = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private syncUnavailable = false
  private readonly stopListening: () => void

  /**
   * @param {QueryCacheOptions} options
   */
  constructor(private readonly options: QueryCacheOptions) {
    const unsubscribe = options.registry?.subscribeResources((resourceType) => this.schedule(resourceType))
    this.stopListening = unsubscribe ?? (() => undefined)
  }

  /**
   * Starts watching a query, fetching it when no one else watches the same path.
   *
   * @param {QueryBuilder<T>} builder
   * @returns {QueryHandle<T>}
   */
  watch<T extends Model>(builder: QueryBuilder<T>): QueryHandle<T> {
    const key = builder.toPath()
    let entry = this.entries.get(key) as QueryEntry<T> | undefined
    const isNew = entry === undefined
    if (!entry) {
      entry = new QueryEntry<T>(key, builder, this.options.registry)
      this.entries.set(key, entry as unknown as QueryEntry<Model>)
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
        if (watched.watchers === 0 && this.entries.get(key) === (watched as unknown as QueryEntry<Model>)) {
          watched.dispose()
          this.entries.delete(key)
        }
      },
    }
  }

  /**
   * Queues a refresh of every watched list of a resource.
   *
   * @param {string} resource
   * @returns {void}
   */
  schedule(resource: string): void {
    this.pendingResources.add(resource)
    if (this.timer !== null) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.options.sync.debounceMs ?? DEFAULT_DEBOUNCE_MS)
  }

  /**
   * Refreshes the queued resources now instead of waiting for the debounce.
   *
   * @returns {Promise<void>}
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const resources = this.pendingResources
    this.pendingResources = new Set()

    const lists = [...this.entries.values()].filter((entry) => entry.isCollection && resources.has(entry.resource))
    await this.refresh(lists)
  }

  /**
   * Drops every query and any pending refresh, and stops listening to the Registry.
   *
   * @returns {void}
   */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const entry of this.entries.values()) {
      entry.dispose()
    }
    this.entries.clear()
    this.stopListening()
  }

  /**
   * Refreshes lists through the sync endpoint, or by refetching each one when there is none.
   *
   * @param {QueryEntry<Model>[]} lists
   * @returns {Promise<void>}
   */
  private async refresh(lists: QueryEntry<Model>[]): Promise<void> {
    const { path, maxQueries } = this.options.sync
    if (!path || this.syncUnavailable) {
      await Promise.all(lists.map((entry) => entry.refetch()))
      return
    }

    for (const batch of this.chunk(lists, maxQueries ?? DEFAULT_MAX_QUERIES)) {
      try {
        const { body } = await this.options.http().post<{ results: SyncResult[] }>(path, {
          queries: batch.map((entry) => ({ path: entry.key, known: entry.knownKeys() })),
        })
        batch.forEach((entry, index) => {
          const result = body.results[index]
          if (result?.status === 200) {
            entry.applySync(result)
          } else {
            void entry.refetch()
          }
        })
      } catch (caught) {
        if (caught instanceof HttpError && (caught.status === 404 || caught.status === 405)) {
          this.syncUnavailable = true
        }
        await Promise.all(batch.map((entry) => entry.refetch()))
      }
    }
  }

  /**
   * Splits a list into chunks of at most `size` items.
   *
   * @param {T[]} items
   * @param {number} size
   * @returns {T[][]}
   */
  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let start = 0; start < items.length; start += size) {
      chunks.push(items.slice(start, start + size))
    }
    return chunks
  }
}
