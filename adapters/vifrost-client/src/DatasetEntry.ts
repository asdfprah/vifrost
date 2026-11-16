import type { DatasetBuilder } from './Dataset.js'
import type { DatasetListener, DatasetRows, DatasetSnapshot, WatchedEntry } from './types.js'

/** One dataset shared by every watcher of the same path. */
export class DatasetEntry<Row> implements WatchedEntry<DatasetSnapshot<Row>> {
  rows: ReadonlyArray<Readonly<Row>> = []
  total = 0
  error: unknown = null
  isLoading = false
  watchers = 0

  private readonly listeners = new Set<DatasetListener<Row>>()
  private controller: AbortController | null = null

  /**
   * @param {string} key the dataset's path, shared by identical datasets
   * @param {DatasetBuilder<any, any, any, any>} builder
   */
  constructor(
    readonly key: string,
    readonly builder: DatasetBuilder<any, any, any, any>
  ) {}

  /**
   * @returns {string[]} the resources whose changes refresh this dataset
   */
  get resources(): string[] {
    return this.builder.getResources()
  }

  /**
   * @returns {DatasetSnapshot<Row>}
   */
  snapshot(): DatasetSnapshot<Row> {
    return { rows: this.rows, total: this.total, error: this.error, isLoading: this.isLoading }
  }

  /**
   * @param {DatasetListener<Row>} listener called with a new snapshot whenever this dataset changes
   * @returns {() => void} an unsubscribe function
   */
  subscribe(listener: DatasetListener<Row>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Requests the dataset again, cancelling a request still in flight.
   *
   * @returns {Promise<void>}
   */
  async refetch(): Promise<void> {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.isLoading = true
    this.error = null
    this.emit()

    try {
      const rows = (await this.builder.get({ signal: controller.signal })) as DatasetRows<Row>
      if (this.controller === controller) {
        this.rows = rows
        this.total = rows.total
      }
    } catch (caught) {
      if (this.controller === controller) {
        this.error = caught
        this.rows = []
        this.total = 0
      }
    } finally {
      if (this.controller === controller) {
        this.controller = null
        this.isLoading = false
        this.emit()
      }
    }
  }

  /**
   * Cancels a request still in flight and stops notifying.
   *
   * @returns {void}
   */
  dispose(): void {
    const controller = this.controller
    this.controller = null
    controller?.abort()
    this.listeners.clear()
  }

  /**
   * @returns {void}
   */
  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}
