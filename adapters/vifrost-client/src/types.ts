import type { HttpClient } from './HttpClient.js'
import type { Model } from './Model.js'
import type { QueryBuilder } from './QueryBuilder.js'
import type { Registry } from './Registry.js'

/**
 * Configuration accepted by {@link HttpClient}.
 */
export interface HttpClientOptions {
  baseUrl: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

/** What every {@link HttpClient} method resolves — the parsed body alongside the raw response headers. */
export interface HttpResponse<ResponseBody> {
  body: ResponseBody
  headers: Headers
}

/**
 * What happens when code reads a property off a relation-loader method that
 * hasn't been loaded (e.g. `product.category.name` when the row wasn't
 * fetched with `.with('category')`) — see {@link Model.relations}.
 *
 * - `'warn'` (default): `console.warn` and return `undefined`.
 * - `'error'`: throw, right at the offending property access.
 * - `'off'`: skip the check entirely — zero overhead, same as before this existed.
 */
export type UnloadedRelationAccess = 'off' | 'warn' | 'error'

/**
 * Configuration accepted by {@link configure}.
 *
 * @remarks
 * `registry` is optional and opt-in by design: a consumer who only wants the
 * plain query API (no identity map, no `save`/`delete` publishing) never
 * constructs a {@link Registry}, and none of that code path ever runs.
 */
export interface ConfigureOptions extends HttpClientOptions {
  registry?: Registry
  /** @defaultValue `'warn'` */
  unloadedRelationAccess?: UnloadedRelationAccess
  sync?: SyncOptions
}

/**
 * How {@link QueryCache} refreshes the lists it holds when records change.
 *
 * @remarks
 * Without `path`, each affected list is refetched. With it, the lists are refreshed in
 * one request to the Laravel package's sync endpoint (`vifrost.sync_route`), falling back
 * to refetching when the endpoint is missing or a list's controller cannot be synced.
 */
export interface SyncOptions {
  /** Path of the sync endpoint, relative to `baseUrl`, e.g. `'_vifrost/sync'`. */
  path?: string
  /** @defaultValue `50` — milliseconds to wait for more record events before refreshing. */
  debounceMs?: number
  /** @defaultValue `20` — lists per sync request; must not exceed `vifrost.sync_route.max_queries`. */
  maxQueries?: number
}

/**
 * Mutable state accumulated by {@link QueryBuilder} before being serialized
 * into a query string.
 */
export interface QueryState {
  wheres: Record<string, string>
  sorts: string[]
  includes: string[]
  fields: Record<string, string[]>
  limit?: number
  offset?: number
  extraParams: Record<string, string>
}

/** A primary key column name, or the column names of a composite key in URL order. */
export type PrimaryKey = string | readonly string[]

/** A record id: a single key value, or the values of a composite key in the order of its columns. */
export type ModelId = string | number | ReadonlyArray<string | number>

/**
 * The static side of a {@link Model} subclass, as emitted by
 * `@vifrost/codegen`.
 */
export interface ModelConstructor<T extends Model = Model> {
  new (attributes?: Record<string, unknown>): T
  resource: string
  primaryKey: PrimaryKey
  keySeparator: string
  /**
   * Max rows a collection query for this model may request — mirrors
   * `Vifrost\Laravel\Pagination::maxLimitFor()` on the Laravel side. `null`
   * means the model is exempt from pagination entirely. Codegen'd classes always
   * set this precisely; hand-written subclasses default to `null` (no enforcement)
   * via the base `Model` class unless they opt in.
   */
  maxLimit: number | null
  /**
   * Names of the relation-loader methods `@vifrost/codegen` generated for
   * this model (e.g. `["category", "comments"]`) — used to detect, on each
   * fetched row, which of them weren't eager-loaded via `.with(...)`. See
   * {@link UnloadedRelationAccess}. Hand-written subclasses default to `[]`
   * (no enforcement) via the base `Model` class unless they opt in.
   */
  relations: string[]
  instantiate<R extends Model>(this: ModelConstructor<R>, data: Record<string, unknown>, includes?: string[]): R
  keyOf(attributes: Record<string, unknown>): string | number | null
  encodeId(id: ModelId): string | number
  find<R extends Model>(this: ModelConstructor<R>, id: ModelId): Promise<R>
  query<R extends Model>(this: ModelConstructor<R>): QueryBuilder<R>
}

/** Re-fetches the current value tracked by a {@link Registry} entry. */
export type ResyncFn<T> = () => Promise<T>

export interface RegistryUpdatedEvent<T> {
  type: 'updated'
  value: T
}

export interface RegistryDeletedEvent {
  type: 'deleted'
}

/** What a {@link Registry} subscriber receives — never a bare value. */
export type RegistryEvent<T> = RegistryUpdatedEvent<T> | RegistryDeletedEvent

export type RegistryListener<T> = (event: RegistryEvent<T>) => void

/**
 * A change to some record of a resource, published by the {@link Registry} whether or not
 * that record is tracked — what lists of the resource listen to, since a created or
 * changed record can enter or leave them.
 */
export interface RegistryResourceEvent {
  type: 'created' | 'updated' | 'deleted'
  id: string | number
}

export type RegistryResourceListener = (resourceType: string, event: RegistryResourceEvent) => void

/** One {@link Registry} bookkeeping entry. */
export interface RegistryEntry<T> {
  value: T
  resync: ResyncFn<T>
  listeners: Set<RegistryListener<T>>
}

/** The current state of a query held by {@link QueryCache}. */
export interface QuerySnapshot<T> {
  rows: T[]
  total: number
  error: unknown
  isLoading: boolean
}

export type QueryListener<T> = (snapshot: QuerySnapshot<T>) => void

/** What {@link QueryCache.watch} returns: a live view of one query, released when no longer needed. */
export interface QueryHandle<T> {
  snapshot(): QuerySnapshot<T>
  subscribe(listener: QueryListener<T>): () => void
  refetch(): Promise<void>
  release(): void
}

/** What a {@link QueryCache} works with. */
export interface QueryCacheOptions {
  /** Keeps rows in sync and reports record changes; without it, lists only refresh on demand. */
  registry: Registry | null
  sync: SyncOptions
  /** The HTTP client to call the sync endpoint with, resolved when a sync is made. */
  http: () => HttpClient
}

/** One query's result in a response of the Laravel sync endpoint. */
export interface SyncResult {
  status: number
  ids?: unknown[]
  total?: number
  rows?: Record<string, unknown>[]
}
