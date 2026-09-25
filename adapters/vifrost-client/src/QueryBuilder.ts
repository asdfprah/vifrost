import { buildQueryString, createQueryState } from './queryString.js'
import { toModelCollection } from './ModelCollection.js'
import type { ModelCollection } from './ModelCollection.js'
import type { QueryState } from './types.js'

/**
 * Fluent query builder returned by {@link Model.query}.
 *
 * @remarks
 * Building a query (chaining `where`/`sort`/`with`/`whereId`/`limit`/`offset`)
 * never performs any I/O — only the terminal methods
 * ({@link QueryBuilder.get}, {@link QueryBuilder.first}) do. This makes a
 * `QueryBuilder` instance safe to construct inline on every render/setup call
 * of a reactive framework hook: constructing it is free, and the hook itself
 * decides when to actually call a terminal method.
 */
export class QueryBuilder<T> {
  private state: QueryState = createQueryState()
  private explicitId?: string | number

  constructor(
    private readonly path: string,
    private readonly fetchMany: (path: string, includes: string[]) => Promise<ModelCollection<T>>,
    private readonly fetchOne: (id: string | number, includes: string[]) => Promise<T>,
    private readonly maxLimit: number | null
  ) {}

  where(field: string, value: string | number | boolean): this {
    this.state.wheres[field] = String(value)
    return this
  }

  /**
   * Shorthand for looking up a single record by primary key.
   *
   * @remarks
   * Does not add a `filter[id]` query param — it routes {@link get}/
   * {@link first} to the dedicated `GET {resource}/{id}` endpoint Vifrost
   * always registers, rather than the collection endpoint. That endpoint is
   * more efficient and, unlike filtering, doesn't depend on the Laravel
   * controller having `allowedFilters` configured (Vifrost's generated
   * controller stub ships that commented out).
   */
  whereId(id: string | number): this {
    this.explicitId = id
    return this
  }

  /**
   * Mirrors Eloquent's `orderBy($column, $direction)`. Chain multiple calls
   * for a multi-column sort, same as Eloquent.
   */
  orderBy(column: string, direction: 'asc' | 'desc' | 'ASC' | 'DESC' = 'asc'): this {
    const isDescending = direction.toLowerCase() === 'desc'
    this.state.sorts.push(isDescending ? `-${column}` : column)
    return this
  }

  with(...relations: string[]): this {
    this.state.includes.push(...relations)
    return this
  }

  fields(resourceType: string, ...fieldNames: string[]): this {
    this.state.fields[resourceType] = [...(this.state.fields[resourceType] ?? []), ...fieldNames]
    return this
  }

  /** Mirrors Eloquent's `limit($count)`. */
  limit(count: number): this {
    this.state.limit = count
    return this
  }

  /** Mirrors Eloquent's `offset($count)`. */
  offset(count: number): this {
    this.state.offset = count
    return this
  }

  /** Eloquent alias for {@link limit}. */
  take(count: number): this {
    return this.limit(count)
  }

  /** Eloquent alias for {@link offset}. */
  skip(count: number): this {
    return this.offset(count)
  }

  param(key: string, value: string): this {
    this.state.extraParams[key] = value
    return this
  }

  toQueryString(): string {
    return buildQueryString(this.state)
  }

  /**
   * @throws if the model requires pagination (`maxLimit` isn't `null`) and
   * either no `.limit()` was set, or it exceeds `maxLimit` — before making any
   * request. The server would clamp an over-limit request silently anyway;
   * this surfaces that as a clear, immediate client-side error instead.
   */
  private assertWithinLimit(): void {
    if (this.maxLimit === null) {
      return
    }
    if (this.state.limit === undefined) {
      throw new Error(
        `${this.path} requires a limit (max ${this.maxLimit}). Call .limit(n) (n <= ${this.maxLimit}) before .get().`
      )
    }
    if (this.state.limit > this.maxLimit) {
      throw new Error(`.limit(${this.state.limit}) exceeds the max allowed for ${this.path} (${this.maxLimit}).`)
    }
  }

  async get(): Promise<ModelCollection<T>> {
    if (this.explicitId !== undefined) {
      const row = await this.fetchOne(this.explicitId, this.state.includes)
      return toModelCollection([row], 1)
    }
    this.assertWithinLimit()
    return this.fetchMany(`${this.path}${this.toQueryString()}`, this.state.includes)
  }

  async first(): Promise<T | null> {
    if (this.explicitId !== undefined) {
      return this.fetchOne(this.explicitId, this.state.includes)
    }
    const results = await this.limit(1).get()
    return results[0] ?? null
  }
}
