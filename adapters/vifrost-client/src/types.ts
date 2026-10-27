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

/** One {@link Registry} bookkeeping entry. */
export interface RegistryEntry<T> {
  value: T
  resync: ResyncFn<T>
  listeners: Set<RegistryListener<T>>
}
