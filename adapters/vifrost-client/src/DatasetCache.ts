import type { DatasetBuilder } from './Dataset.js'
import { DatasetEntry } from './DatasetEntry.js'
import { PendingResources } from './PendingResources.js'
import type { DatasetCacheOptions, DatasetHandle, DatasetSnapshot } from './types.js'
import { WatchedEntries } from './WatchedEntries.js'

/**
 * Holds the datasets reactive bindings (such as `@vifrost/vue`'s `useDataset`) watch, sharing
 * one request between identical datasets. With a {@link Registry}, a dataset is requested again
 * whenever a record of its resource, or of a relation it joins or filters by, is reported
 * created, updated or deleted.
 *
 * @remarks
 * A dataset's rows are not records: they are never tracked by the Registry and never take part
 * in a sync request, which is why datasets have a cache of their own beside the
 * {@link QueryCache}.
 */
export class DatasetCache {
  private readonly entries = new WatchedEntries<DatasetSnapshot<unknown>, DatasetEntry<unknown>>()
  private readonly pending: PendingResources
  private readonly stopListening: () => void

  /**
   * @param {DatasetCacheOptions} options
   */
  constructor(options: DatasetCacheOptions) {
    this.pending = new PendingResources((resources) => this.refetchResources(resources), options.debounceMs)
    const unsubscribe = options.registry?.subscribeResources((resourceType) => this.pending.add(resourceType))
    this.stopListening = unsubscribe ?? (() => undefined)
  }

  /**
   * Starts watching a dataset, fetching it when no one else watches the same path.
   *
   * @param {DatasetBuilder<any, any, any, Row>} builder
   * @returns {DatasetHandle<Row>}
   */
  watch<Row extends object>(builder: DatasetBuilder<any, any, any, Row>): DatasetHandle<Row> {
    const key = builder.toPath()
    return this.entries.watch(key, () => new DatasetEntry<Row>(key, builder) as DatasetEntry<unknown>) as DatasetHandle<Row>
  }

  /**
   * Requests again, now, the datasets of the resources whose records changed.
   *
   * @returns {Promise<void>}
   */
  flush(): Promise<void> {
    return this.pending.flush()
  }

  /**
   * Drops every dataset and any pending refresh, and stops listening to the Registry.
   *
   * @returns {void}
   */
  dispose(): void {
    this.pending.dispose()
    this.entries.dispose()
    this.stopListening()
  }

  /**
   * @param {Set<string>} resources
   * @returns {Promise<void>}
   */
  private async refetchResources(resources: Set<string>): Promise<void> {
    const datasets = this.entries.values().filter((entry) => entry.resources.some((resource) => resources.has(resource)))
    await Promise.all(datasets.map((entry) => entry.refetch()))
  }
}
