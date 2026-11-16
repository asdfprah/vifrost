import type { HttpClient } from './HttpClient.js'
import type { Model } from './Model.js'
import type { DatasetBuilder } from './Dataset.js'
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

/** Re-fetches the current value tracked by a {@link Registry} entry, loading the given relations. */
export type ResyncFn<T> = (includes?: string[]) => Promise<T>

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
  /** Every relation a fetch of this record loaded, requested again on resync. */
  includes: Set<string>
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

/** The current state of a dataset held by {@link DatasetCache}. */
export interface DatasetSnapshot<Row> {
  rows: ReadonlyArray<Readonly<Row>>
  total: number
  error: unknown
  isLoading: boolean
}

export type DatasetListener<Row> = (snapshot: DatasetSnapshot<Row>) => void

/** What {@link DatasetCache.watch} returns: a live view of one dataset, released when no longer needed. */
export type DatasetHandle<Row> = WatchHandle<DatasetSnapshot<Row>>

/** What a {@link DatasetCache} works with. */
export interface DatasetCacheOptions {
  /** Requests datasets again when records change; without it, datasets only refresh on demand. */
  registry: Registry | null
  /** @defaultValue `50` — milliseconds to wait for more record events before requesting again. */
  debounceMs?: number
}

/** A live view of one watched query or dataset, released when no longer needed. */
export interface WatchHandle<S> {
  snapshot(): S
  subscribe(listener: (snapshot: S) => void): () => void
  refetch(): Promise<void>
  release(): void
}

/** One entry of a cache, shared by every watcher of its key. */
export interface WatchedEntry<S> {
  watchers: number
  snapshot(): S
  subscribe(listener: (snapshot: S) => void): () => void
  refetch(): Promise<void>
  dispose(): void
}

/** What {@link QueryCache.watch} returns: a live view of one query, released when no longer needed. */
export type QueryHandle<T> = WatchHandle<QuerySnapshot<T>>

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

/**
 * What every collection-returning fetch (`Model.all()`, `QueryBuilder.get()`,
 * a to-many relation loader) resolves to: a real array — `instanceof Array`,
 * `.map()`/`.length`/spread/`JSON.stringify` all behave exactly like `T[]` —
 * with one extra non-enumerable property carrying the total row count the server reports via
 * the `X-Total-Count` response header (see Controller.stub on the Laravel
 * side), independent of how many rows this particular page actually returned.
 */
export type ModelCollection<T> = T[] & { total: number }

/** A Laravel Echo channel, or anything that can listen to every event of a channel the same way. */
export interface ModelBroadcastChannel {
  listenToAll(callback: (event: string, data: unknown) => void): unknown
}

/**
 * The model classes broadcasts may name: the generated models module (`import * as models from
 * './models'`), keyed by class name, or a list of model classes.
 */
export type BroadcastModels = Record<string, unknown> | ModelConstructor[]

/** Aggregate functions a dataset can compute, when the model's controller allows them. */
export type DatasetAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'

/** A value a dataset condition compares a column to. */
export type DatasetValue = string | number | boolean

/** Comparison operators of a dataset condition. */
export type DatasetComparison = '=' | '!=' | '<' | '<=' | '>' | '>='

/** Periods {@link DatasetBuilder.groupByDate} can group a date column by. */
export type DatasetDateUnit = 'day' | 'week' | 'month' | 'year'

/** How a whereHas compares the number of related records. */
export type DatasetCountOperator = '>=' | '<=' | '>' | '<' | '=' | '!='

/** The columns, and the has levels below them, of a relation a dataset filters by. */
export interface DatasetHasShape {
  columns: Record<string, unknown>
  has: Record<string, DatasetHasShape>
}

/**
 * What the datasets of a model allow, as `@vifrost/codegen` emits it from the schema: the
 * model's columns with their types, the relations it may join with theirs, the has levels it
 * may filter by and the aggregates it may compute.
 */
export interface DatasetShape extends DatasetHasShape {
  joins: Record<string, { columns: Record<string, unknown> }>
  aggregates: DatasetAggregate
}

/** The has levels of a dataset whose shape is not known. */
export interface AnyDatasetHasShape extends DatasetHasShape {
  columns: Record<string, unknown>
  has: Record<string, AnyDatasetHasShape>
}

/** The shape of a dataset whose model was not generated, which accepts any name. */
export interface AnyDatasetShape extends DatasetShape {
  columns: Record<string, unknown>
  joins: Record<string, { columns: Record<string, unknown> }>
  has: Record<string, AnyDatasetHasShape>
  aggregates: DatasetAggregate
}

/** A model class `@vifrost/codegen` generated with datasets enabled. */
export interface DatasetModel<S extends DatasetShape = DatasetShape> {
  resource: string
  datasetShape: S
  datasetMaxLimit?: number
  datasetResources?: Record<string, string>
}

/** The rows a dataset returned, with the total number of rows it has across pages. */
export type DatasetRows<Row> = ReadonlyArray<Readonly<Row>> & { readonly total: number }

/** Flattens an intersection of row shapes into one object type. */
export type DatasetSimplify<T> = { [K in keyof T]: T[K] } & {}

/** Columns of the root model. */
export type DatasetRootField<S extends DatasetShape> = keyof S['columns'] & string

/** Columns of the joined relations, dotted with their relation name. */
export type DatasetJoinedField<S extends DatasetShape, J extends string> = J extends keyof S['joins'] & string
  ? `${J}.${keyof S['joins'][J]['columns'] & string}`
  : never

/** Any column a dataset with these joins can use. */
export type DatasetField<S extends DatasetShape, J extends string> = DatasetRootField<S> | DatasetJoinedField<S, J>

/** The type of a column's values; nullable for a left-joined relation. */
export type DatasetFieldType<S extends DatasetShape, J extends string, L extends string, F extends string> = F extends `${infer R}.${infer C}`
  ? R extends J
    ? R extends L
      ? S['joins'][R]['columns'][C] | null
      : S['joins'][R]['columns'][C]
    : F extends keyof S['columns']
      ? S['columns'][F]
      : never
  : F extends keyof S['columns']
    ? S['columns'][F]
    : never

/** What min and max return: numbers for a numeric column, otherwise the value or a number. */
export type DatasetExtreme<T> = [T] extends [number | null] ? number | null : Exclude<T, null> | number | null

/** The builder itself when its shape allows an aggregate function, so calling it otherwise fails to compile. */
export type DatasetAllowing<S extends DatasetShape, J extends string, L extends string, Row extends object, F extends DatasetAggregate> =
  F extends S['aggregates'] ? DatasetBuilder<S, J, L, Row> : never

/** One serialized condition of `where` or of a has level. */
export type DatasetCondition =
  | { column: string; op: string; value?: DatasetValue | DatasetValue[] }
  | { or: DatasetCondition[] }
  | { and: DatasetCondition[] }

/** One serialized has level. */
export interface DatasetHasLevel {
  where: DatasetCondition[]
  has: Record<string, DatasetHasLevel>
  op: DatasetCountOperator
  count: number
  negate: boolean
}

/** Options of {@link DatasetBuilder.get}. */
export interface DatasetRequestOptions {
  signal?: AbortSignal
}
