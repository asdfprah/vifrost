import type { Model } from './Model.js'
import type { QueryBuilder } from './QueryBuilder.js'
import type { Registry } from './Registry.js'
import type { ModelConstructor, ModelId, QueryListener, QuerySnapshot, RegistryEvent, SyncResult } from './types.js'

/** One query shared by every watcher of the same path. */
export class QueryEntry<T extends Model> {
  rows: T[] = []
  total = 0
  error: unknown = null
  isLoading = false
  watchers = 0

  private readonly listeners = new Set<QueryListener<T>>()
  private rowSubscriptions: Array<() => void> = []
  private requestId = 0

  /**
   * @param {string} key the query's path, shared by identical queries
   * @param {QueryBuilder<T>} builder
   * @param {Registry | null} registry the Registry whose rows this query follows
   */
  constructor(
    readonly key: string,
    readonly builder: QueryBuilder<T>,
    private readonly registry: Registry | null
  ) {}

  /**
   * @returns {string} the resource this query reads
   */
  get resource(): string {
    return this.builder.getResource()
  }

  /**
   * @returns {boolean} whether this query reads a collection rather than one record
   */
  get isCollection(): boolean {
    return !this.builder.isSingle()
  }

  /**
   * @returns {QuerySnapshot<T>}
   */
  snapshot(): QuerySnapshot<T> {
    return { rows: this.rows, total: this.total, error: this.error, isLoading: this.isLoading }
  }

  /**
   * @param {QueryListener<T>} listener called with a new snapshot whenever this query changes
   * @returns {() => void} an unsubscribe function
   */
  subscribe(listener: QueryListener<T>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Requests the query again. A response that arrives after a newer request was made, or after
   * the entry was disposed, is ignored.
   *
   * @returns {Promise<void>}
   */
  async refetch(): Promise<void> {
    const requestId = ++this.requestId
    this.isLoading = true
    this.error = null
    this.emit()

    try {
      const rows = await this.builder.get()
      if (requestId === this.requestId) {
        this.setRows(rows, rows.total)
      }
    } catch (caught) {
      if (requestId === this.requestId) {
        this.error = caught
        this.setRows([], 0)
      }
    } finally {
      if (requestId === this.requestId) {
        this.isLoading = false
        this.emit()
      }
    }
  }

  /**
   * The raw keys of the rows this query currently holds, as the sync endpoint expects them.
   *
   * @returns {unknown[]}
   */
  knownKeys(): unknown[] {
    return this.rows.map((row) => this.rawKeyOf(row.constructor as ModelConstructor, row))
  }

  /**
   * The raw primary key of a row: its value, or the list of values of a composite key.
   *
   * @param {ModelConstructor} model the row's model class
   * @param {Record<string, unknown>} row
   * @returns {unknown}
   */
  private rawKeyOf(model: ModelConstructor, row: Record<string, unknown>): unknown {
    const primaryKey = model.primaryKey
    return typeof primaryKey === 'string' ? row[primaryKey] : primaryKey.map((column) => row[column])
  }

  /**
   * Replaces the rows with the page a sync response reports, reusing the rows already held and
   * instantiating the ones it sent. Falls back to refetching when a key has no row.
   *
   * @param {SyncResult} result
   * @returns {void}
   */
  applySync(result: SyncResult): void {
    const model = this.builder.getModel() as ModelConstructor<T> | undefined
    if (!model) {
      void this.refetch()
      return
    }

    const includes = this.builder.getIncludes()
    const sentRows = new Map<string, T>()
    for (const attributes of result.rows ?? []) {
      const row = model.instantiate(attributes, includes)
      sentRows.set(String(model.keyOf(row)), row)
    }
    const heldRows = new Map(this.rows.map((row) => [String(model.keyOf(row)), row]))

    const rows: T[] = []
    for (const id of result.ids ?? []) {
      const key = String(model.encodeId(id as ModelId))
      const row = sentRows.get(key) ?? heldRows.get(key)
      if (!row) {
        void this.refetch()
        return
      }
      rows.push(row)
    }

    this.requestId++
    this.isLoading = false
    this.error = null
    this.setRows(rows, result.total ?? rows.length)
  }

  /**
   * Stops listening to the Registry and ignores any response still in flight.
   *
   * @returns {void}
   */
  dispose(): void {
    this.requestId++
    this.stopWatchingRows()
    this.listeners.clear()
  }

  /**
   * @param {T[]} rows
   * @param {number} total
   * @returns {void}
   */
  private setRows(rows: T[], total: number): void {
    this.rows = [...rows]
    this.total = total
    this.watchRows()
    this.emit()
  }

  /**
   * Subscribes to every held row the Registry tracks, so updates and deletions reach this query.
   *
   * @returns {void}
   */
  private watchRows(): void {
    this.stopWatchingRows()
    const registry = this.registry
    if (!registry) {
      return
    }

    for (const row of this.rows) {
      const model = row.constructor as ModelConstructor<T>
      const id = model.keyOf(row)
      if (id === null || !registry.isTracked(model.resource, id)) {
        continue
      }
      this.rowSubscriptions.push(
        registry.subscribe<T>(model.resource, id, (event) => this.onRowEvent(model, id, event))
      )
    }
  }

  /**
   * Drops this query's Registry subscriptions.
   *
   * @returns {void}
   */
  private stopWatchingRows(): void {
    for (const unsubscribe of this.rowSubscriptions) {
      unsubscribe()
    }
    this.rowSubscriptions = []
  }

  /**
   * Replaces an updated row in place, or removes a deleted one and lowers the total. The Registry
   * also reports the deletion to the cache, which refreshes the page so the next row moves in.
   *
   * @param {ModelConstructor<T>} model
   * @param {string | number} id
   * @param {RegistryEvent<T>} event
   * @returns {void}
   */
  private onRowEvent(model: ModelConstructor<T>, id: string | number, event: RegistryEvent<T>): void {
    const index = this.rows.findIndex((row) => model.keyOf(row) === id)
    if (index === -1) {
      return
    }

    const rows = [...this.rows]
    if (event.type === 'updated') {
      rows.splice(index, 1, event.value)
    } else {
      rows.splice(index, 1)
      this.total = Math.max(0, this.total - 1)
    }
    this.rows = rows
    this.emit()
  }

  /**
   * Sends the current snapshot to every subscriber.
   *
   * @returns {void}
   */
  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}
