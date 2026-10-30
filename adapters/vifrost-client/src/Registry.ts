import type {
  RegistryEntry,
  RegistryEvent,
  RegistryListener,
  RegistryResourceEvent,
  RegistryResourceListener,
  ResyncFn,
} from './types.js'

/**
 * Identity map keyed by `${resourceType}:${id}`, tracking every {@link Model}
 * instance a `find`/`all`/`query`/relation call has fetched.
 *
 * @remarks
 * Built so a future real-time transport (a WebSocket "this record changed"
 * event, an SSE stream, polling — anything) can drive
 * {@link Registry.resync} without this package needing to know about
 * Vue/React/Svelte reactivity at all. Turning a notified update into a
 * re-render is a thin per-framework binding layer built on top of this, not
 * this class's concern.
 */
export class Registry {
  private readonly entries = new Map<string, RegistryEntry<unknown>>()
  private readonly resourceListeners = new Set<RegistryResourceListener>()

  private keyFor(resourceType: string, id: string | number): string {
    return `${resourceType}:${id}`
  }

  private notify<T>(entry: RegistryEntry<T>, event: RegistryEvent<T>): void {
    for (const listener of entry.listeners) {
      listener(event)
    }
  }

  /**
   * Registers a fresh value under `${resourceType}:${id}`.
   *
   * @remarks
   * Notifies existing subscribers when it updates an entry that was already
   * tracked (a re-fetch, or `Model#save()` on a record obtained earlier)
   * but not on first registration — nothing could be subscribed to an id
   * that wasn't tracked yet. This is what makes `Model#save()` participate
   * in the same identity map as `find`/`all`/`query` without a separate
   * "publish" concept: any code path that hands the registry a fresh value
   * for a tracked record propagates it the same way.
   */
  track<T>(resourceType: string, id: string | number, value: T, resync: ResyncFn<T>): void {
    const key = this.keyFor(resourceType, id)
    const existingEntry = this.entries.get(key) as RegistryEntry<T> | undefined
    if (existingEntry) {
      existingEntry.value = value
      existingEntry.resync = resync
      this.notify(existingEntry, { type: 'updated', value })
      return
    }
    this.entries.set(key, { value, resync, listeners: new Set() } as RegistryEntry<unknown>)
  }

  /**
   * @returns an unsubscribe function
   * @throws if `resourceType`/`id` hasn't been {@link Registry.track}ed yet
   */
  subscribe<T>(resourceType: string, id: string | number, listener: RegistryListener<T>): () => void {
    const key = this.keyFor(resourceType, id)
    const entry = this.entries.get(key)
    if (!entry) {
      throw new Error(`Cannot subscribe to ${key}: it has not been tracked yet. Fetch it first.`)
    }
    const typedListener = listener as RegistryListener<unknown>
    entry.listeners.add(typedListener)
    return () => entry.listeners.delete(typedListener)
  }

  /**
   * Listens to changes of every record of every resource, tracked or not.
   *
   * @param {RegistryResourceListener} listener
   * @returns {() => void} an unsubscribe function
   */
  subscribeResources(listener: RegistryResourceListener): () => void {
    this.resourceListeners.add(listener)
    return () => this.resourceListeners.delete(listener)
  }

  /**
   * Tells resource listeners a record changed, without fetching anything — for a change whose
   * fresh value is already known, such as the response of `Model#save()`.
   *
   * @param {string} resourceType
   * @param {RegistryResourceEvent} event
   * @returns {void}
   */
  publish(resourceType: string, event: RegistryResourceEvent): void {
    for (const listener of this.resourceListeners) {
      listener(resourceType, event)
    }
  }

  /**
   * Reports a record created elsewhere (another tab, another user, a real-time broadcast).
   *
   * @param {string} resourceType
   * @param {string | number} id the record's id as `Model.keyOf()` returns it
   * @returns {void}
   */
  created(resourceType: string, id: string | number): void {
    this.publish(resourceType, { type: 'created', id })
  }

  /**
   * Reports a record updated elsewhere: re-fetches it when tracked, which also tells resource
   * listeners, or only tells them otherwise.
   *
   * @param {string} resourceType
   * @param {string | number} id the record's id as `Model.keyOf()` returns it
   * @returns {Promise<void>}
   */
  async updated(resourceType: string, id: string | number): Promise<void> {
    if (this.isTracked(resourceType, id)) {
      await this.resync(resourceType, id)
      return
    }
    this.publish(resourceType, { type: 'updated', id })
  }

  /**
   * Re-fetches a tracked record, publishes the fresh value to its subscribers and tells
   * resource listeners it changed. A no-op if the record isn't currently tracked.
   *
   * @param {string} resourceType
   * @param {string | number} id
   * @returns {Promise<void>}
   */
  async resync(resourceType: string, id: string | number): Promise<void> {
    const entry = this.entries.get(this.keyFor(resourceType, id))
    if (!entry) {
      return
    }
    const value = await entry.resync()
    entry.value = value
    this.notify(entry, { type: 'updated', value })
    this.publish(resourceType, { type: 'updated', id })
  }

  /**
   * Notifies subscribers the record was deleted (e.g. by `Model#delete()`, or a real-time
   * broadcast), stops tracking it, and tells resource listeners — also when it wasn't tracked,
   * since lists of the resource may still have held it on a page this client never loaded.
   *
   * @param {string} resourceType
   * @param {string | number} id
   * @returns {void}
   */
  remove(resourceType: string, id: string | number): void {
    const key = this.keyFor(resourceType, id)
    const entry = this.entries.get(key)
    if (entry) {
      this.notify(entry, { type: 'deleted' })
    }
    this.entries.delete(key)
    this.publish(resourceType, { type: 'deleted', id })
  }

  isTracked(resourceType: string, id: string | number): boolean {
    return this.entries.has(this.keyFor(resourceType, id))
  }
}
