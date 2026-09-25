import { client, getRegistry, getUnloadedRelationAccess } from './config.js'
import { guardUnloadedRelations } from './RelationGuard.js'
import { QueryBuilder } from './QueryBuilder.js'
import { toModelCollection } from './ModelCollection.js'
import { buildQueryString, createQueryState } from './queryString.js'
import type { ModelCollection } from './ModelCollection.js'
import type { ModelConstructor } from './types.js'

const NO_INCLUDES: string[] = []

/**
 * Base class generated `@vifrost/codegen` subclasses extend.
 *
 * @remarks
 * Every constructor argument is copied directly onto the instance, so a
 * generated subclass can declare its columns as typed fields
 * (`declare name: string`) and get correct property access without any
 * getter/setter boilerplate.
 */
export class Model {
  static resource = ''
  static primaryKey = 'id'
  /**
   * Permissive default for hand-written subclasses that don't set this — no
   * enforcement unless opted into. `@vifrost/codegen`-generated classes
   * always set this precisely from the schema.
   */
  static maxLimit: number | null = null;
  /**
   * Names of the relation-loader methods this class declares (e.g.
   * `["category", "comments"]`) — `@vifrost/codegen`-generated classes always
   * set this precisely; hand-written subclasses default to `[]` (no
   * enforcement) unless they opt in. See {@link Model.instantiate}.
   */
  static relations: string[] = [];

  [attributeName: string]: unknown

  constructor(attributes: Record<string, unknown> = {}) {
    Object.assign(this, attributes)
  }

  private primaryKeyValue(): string | number {
    const modelConstructor = this.constructor as ModelConstructor
    const value = this[modelConstructor.primaryKey]
    if (value === undefined || value === null) {
      throw new Error(`${modelConstructor.name} instance has no "${modelConstructor.primaryKey}" set.`)
    }
    return value as string | number
  }

  /**
   * Reads `X-Total-Count` off a collection response's headers — how many rows
   * match the request in total, independent of how many this page returned.
   * Falls back to the page size itself if the header is missing (an older
   * backend, or a response mocked without it in a test), so `.total` is
   * always a valid number rather than `NaN`.
   */
  private static readTotalCount(headers: Headers, pageSize: number): number {
    return Number(headers.get('X-Total-Count') ?? pageSize)
  }

  /**
   * Wraps raw JSON in a Model instance and, if a {@link Registry} was passed
   * to {@link configure}, registers it so a future "this record changed"
   * event can find and refresh it. Every fetch path (find/all/query/
   * relations) goes through this, so tracking is automatic whenever the
   * registry is in use, and entirely skipped otherwise.
   *
   * @param includes the `.with(...)` relations this row was originally
   *   fetched with, if any — threaded through so the registered resync
   *   function re-requests the same relations later, via the same
   *   `query().with(...).whereId(id).first()` chain a caller would use
   *   directly. Without this, a `Registry.resync()` triggered by a
   *   real-time event would silently drop any eager-loaded relation.
   */
  static instantiate<T extends Model>(
    this: ModelConstructor<T>,
    attributes: Record<string, unknown>,
    includes: string[] = NO_INCLUDES
  ): T {
    const instance = new this(attributes)
    const registry = getRegistry()
    const primaryKeyValue = attributes[this.primaryKey]
    if (registry && primaryKeyValue !== undefined && primaryKeyValue !== null) {
      registry.track(this.resource, primaryKeyValue as string | number, instance, () =>
        this.query()
          .with(...includes)
          .whereId(primaryKeyValue as string | number)
          .first() as Promise<T>
      )
    }

    const mode = getUnloadedRelationAccess()
    if (mode === 'off' || this.relations.length === 0) {
      return instance
    }
    const unloadedRelationNames = this.relations.filter((name) => !(name in attributes))
    return guardUnloadedRelations(instance, unloadedRelationNames, mode)
  }

  /** Shorthand for `query().get()` — goes through the same `maxLimit` guard as any other collection fetch. */
  static async all<T extends Model>(this: ModelConstructor<T>): Promise<ModelCollection<T>> {
    return this.query().get()
  }

  static async find<T extends Model>(this: ModelConstructor<T>, id: string | number): Promise<T> {
    const { body: row } = await client().get<Record<string, unknown>>(`${this.resource}/${id}`)
    return this.instantiate(row)
  }

  static query<T extends Model>(this: ModelConstructor<T>): QueryBuilder<T> {
    return new QueryBuilder<T>(
      this.resource,
      async (path, includes) => {
        const { body: rows, headers } = await client().get<Record<string, unknown>[]>(path)
        return toModelCollection(
          rows.map((row) => this.instantiate(row, includes)),
          Model.readTotalCount(headers, rows.length)
        )
      },
      async (id, includes) => {
        const state = createQueryState()
        state.includes = includes
        const { body: row } = await client().get<Record<string, unknown>>(
          `${this.resource}/${id}${buildQueryString(state)}`
        )
        return this.instantiate(row, includes)
      },
      this.maxLimit
    )
  }

  /**
   * Creates (no primary key set) or updates (primary key set) this record.
   *
   * @remarks
   * Registers the saved value with the {@link Registry}, if one is
   * configured, the same way `find`/`all`/`query` do — so a create is
   * discoverable by a later `subscribe`, and an update notifies whoever
   * already subscribed to this record from an earlier fetch.
   */
  async save(): Promise<this> {
    const modelConstructor = this.constructor as ModelConstructor
    const primaryKeyValue = this[modelConstructor.primaryKey]
    const attributes: Record<string, unknown> = { ...this }

    const { body: updatedRow } =
      primaryKeyValue !== undefined && primaryKeyValue !== null
        ? await client().put<Record<string, unknown>>(`${modelConstructor.resource}/${primaryKeyValue}`, attributes)
        : await client().post<Record<string, unknown>>(modelConstructor.resource, attributes)

    Object.assign(this, updatedRow)

    const registry = getRegistry()
    const savedId = this[modelConstructor.primaryKey]
    if (registry && savedId !== undefined && savedId !== null) {
      registry.track(modelConstructor.resource, savedId as string | number, this, () =>
        modelConstructor.find(savedId as string | number)
      )
    }

    return this
  }

  /**
   * Deletes this record, notifying the {@link Registry} (if one is
   * configured) that it's gone.
   */
  async delete(): Promise<void> {
    const modelConstructor = this.constructor as ModelConstructor
    const primaryKeyValue = this.primaryKeyValue()
    await client().delete(`${modelConstructor.resource}/${primaryKeyValue}`)
    getRegistry()?.remove(modelConstructor.resource, primaryKeyValue)
  }

  /**
   * Loads one or more of this model's declared relations on an
   * already-instantiated record — for filling in what a fetch didn't
   * eager-load via `.with(...)`, without re-fetching the whole row.
   *
   * @remarks
   * Validates every name against `static relations` (see
   * `@vifrost/codegen`'s generated `relations` array) *before* fetching
   * anything — a typo or an unsupported relation (MorphTo, one outside the
   * generation batch) throws immediately
   *
   * @throws if any name isn't in `static relations`
   */
  async load(relationNames: string[]): Promise<this> {
    const modelConstructor = this.constructor as ModelConstructor
    const invalidNames = relationNames.filter((name) => !modelConstructor.relations.includes(name))
    if (invalidNames.length > 0) {
      throw new Error(
        `${modelConstructor.name} has no relation(s) named: ${invalidNames.join(', ')}. ` +
          `Available: ${modelConstructor.relations.join(', ') || '(none)'}.`
      )
    }

    const values = await Promise.all(relationNames.map((name) => (this[name] as () => Promise<unknown>)()))

    relationNames.forEach((name, index) => {
      this[name] = values[index]
    })

    return this
  }

  /**
   * One-hop collection relation: `GET {resource}/{id}/{relationName}` — the
   * same generated `index()` action as a flat collection fetch (see
   * `MakeAPICommand::buildNestedRoutes()` on the Laravel side), so it carries
   * the same `X-Total-Count` header.
   */
  protected async toMany<R extends Model>(
    relationName: string,
    related: ModelConstructor<R>
  ): Promise<ModelCollection<R>> {
    const modelConstructor = this.constructor as ModelConstructor
    const { body: rows, headers } = await client().get<Record<string, unknown>[]>(
      `${modelConstructor.resource}/${this.primaryKeyValue()}/${relationName}`
    )
    return toModelCollection(
      rows.map((row) => related.instantiate(row)),
      Model.readTotalCount(headers, rows.length)
    )
  }

  /**
   * A to-one relation (BelongsTo/HasOne/MorphOne).
   */
  protected async toOne<R extends Model>(relationName: string, related: ModelConstructor<R>): Promise<R | null> {
    const relatedRows = await this.toMany(relationName, related)
    return relatedRows[0] ?? null
  }

  /**
   * One record within a collection relation, scoped by its own id:
   * `GET {resource}/{id}/{relationName}/{childId}`.
   */
  protected async toManyChild<R extends Model>(
    relationName: string,
    related: ModelConstructor<R>,
    childId: string | number
  ): Promise<R> {
    const modelConstructor = this.constructor as ModelConstructor
    const { body: row } = await client().get<Record<string, unknown>>(
      `${modelConstructor.resource}/${this.primaryKeyValue()}/${relationName}/${childId}`
    )
    return related.instantiate(row)
  }
}
