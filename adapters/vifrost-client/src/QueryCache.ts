import { HttpError } from './HttpError.js'
import type { Model } from './Model.js'
import { PendingResources } from './PendingResources.js'
import type { QueryBuilder } from './QueryBuilder.js'
import { QueryEntry } from './QueryEntry.js'
import type { QueryCacheOptions, QueryHandle, QuerySnapshot, SyncResult } from './types.js'
import { WatchedEntries } from './WatchedEntries.js'

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
  private readonly entries = new WatchedEntries<QuerySnapshot<Model>, QueryEntry<Model>>()
  private readonly pending: PendingResources
  private syncUnavailable = false
  private readonly stopListening: () => void

  /**
   * @param {QueryCacheOptions} options
   */
  constructor(private readonly options: QueryCacheOptions) {
    this.pending = new PendingResources((resources) => this.refreshResources(resources), options.sync.debounceMs)
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
    return this.entries.watch(
      key,
      () => new QueryEntry<T>(key, builder, this.options.registry) as unknown as QueryEntry<Model>
    ) as unknown as QueryHandle<T>
  }

  /**
   * Queues a refresh of every watched list of a resource.
   *
   * @param {string} resource
   * @returns {void}
   */
  schedule(resource: string): void {
    this.pending.add(resource)
  }

  /**
   * Refreshes the queued resources now instead of waiting for the debounce.
   *
   * @returns {Promise<void>}
   */
  flush(): Promise<void> {
    return this.pending.flush()
  }

  /**
   * Drops every query and any pending refresh, and stops listening to the Registry.
   *
   * @returns {void}
   */
  dispose(): void {
    this.pending.dispose()
    this.entries.dispose()
    this.stopListening()
  }

  /**
   * Refreshes the watched lists of the resources whose records changed.
   *
   * @param {Set<string>} resources
   * @returns {Promise<void>}
   */
  private async refreshResources(resources: Set<string>): Promise<void> {
    const lists = this.entries.values().filter((entry) => entry.isCollection && resources.has(entry.resource))
    await this.refresh(lists)
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
