import { client } from './config.js'
import { HttpError } from './HttpError.js'
import type { Model } from './Model.js'
import { readTotalCount, withTotal } from './collection.js'
import { QueryBuilder } from './QueryBuilder.js'
import type {
  AnyDatasetShape,
  DatasetAllowing,
  DatasetComparison,
  DatasetCondition,
  DatasetCountOperator,
  DatasetDateUnit,
  DatasetExtreme,
  DatasetField,
  DatasetFieldType,
  DatasetHasLevel,
  DatasetHasShape,
  DatasetModel,
  DatasetRequestOptions,
  DatasetRows,
  DatasetShape,
  DatasetSimplify,
  DatasetValue,
} from './types.js'

/** The model's controller does not allow datasets, or does not know them yet. */
export class DatasetNotEnabledError extends Error {
  /**
   * @param {string} resource
   */
  constructor(readonly resource: string) {
    super(`${resource} has no datasets enabled: allow columns or aggregates in its controller's query().`)
    this.name = 'DatasetNotEnabledError'
  }
}

/** The database cancelled the dataset for running longer than its timeout. */
export class DatasetTimeoutError extends Error {
  /**
   * @param {string} resource
   */
  constructor(readonly resource: string) {
    super(`The dataset of ${resource} took too long to compute. Narrow it down and try again.`)
    this.name = 'DatasetTimeoutError'
  }
}

/**
 * Conditions on the columns of a model, and on the existence of its related records: what a
 * dataset filters by, and what each of its has levels does.
 */
export class DatasetConditions<H extends DatasetHasShape, F extends string = keyof H['columns'] & string> {
  readonly conditions: DatasetCondition[] = []
  readonly has: Record<string, DatasetHasLevel> = {}

  /**
   * Compares a column to a value, matches it against a list or a range, or checks it is null.
   *
   * @param {F} column
   * @param {DatasetComparison | 'in' | 'notIn' | 'between' | 'null' | 'notNull'} op
   * @param {DatasetValue | DatasetValue[]} [value]
   * @returns {this}
   */
  where(column: F, op: DatasetComparison, value: DatasetValue): this
  where(column: F, op: 'in' | 'notIn', value: DatasetValue[]): this
  where(column: F, op: 'between', value: [DatasetValue, DatasetValue]): this
  where(column: F, op: 'null' | 'notNull'): this
  where(column: F, op: string, value?: DatasetValue | DatasetValue[]): this {
    this.conditions.push(value === undefined ? { column, op } : { column, op, value })
    return this
  }

  /**
   * @param {F} column
   * @param {DatasetValue[]} values
   * @returns {this}
   */
  whereIn(column: F, values: DatasetValue[]): this {
    return this.where(column, 'in', values)
  }

  /**
   * @param {F} column
   * @param {DatasetValue[]} values
   * @returns {this}
   */
  whereNotIn(column: F, values: DatasetValue[]): this {
    return this.where(column, 'notIn', values)
  }

  /**
   * @param {F} column
   * @param {[DatasetValue, DatasetValue]} range the lowest and highest values, inclusive
   * @returns {this}
   */
  whereBetween(column: F, range: [DatasetValue, DatasetValue]): this {
    return this.where(column, 'between', range)
  }

  /**
   * @param {F} column
   * @returns {this}
   */
  whereNull(column: F): this {
    return this.where(column, 'null')
  }

  /**
   * @param {F} column
   * @returns {this}
   */
  whereNotNull(column: F): this {
    return this.where(column, 'notNull')
  }

  /**
   * Matches when any of the conditions the callback adds matches.
   *
   * @param {(group: DatasetConditions<H, F>) => void} build
   * @returns {this}
   */
  whereAny(build: (group: DatasetConditions<H, F>) => void): this {
    this.conditions.push({ or: this.group(build) })
    return this
  }

  /**
   * Matches when every condition the callback adds matches, e.g. as one alternative of
   * {@link DatasetConditions.whereAny}.
   *
   * @param {(group: DatasetConditions<H, F>) => void} build
   * @returns {this}
   */
  whereAll(build: (group: DatasetConditions<H, F>) => void): this {
    this.conditions.push({ and: this.group(build) })
    return this
  }

  /**
   * Keeps the records with related records, optionally matching conditions of their own and
   * in a given number.
   *
   * @param {R} relation
   * @param {(related: DatasetConditions<H['has'][R]>) => void} [build] conditions on the related records
   * @param {DatasetCountOperator} [op]
   * @param {number} [count]
   * @returns {this}
   */
  whereHas<R extends keyof H['has'] & string>(
    relation: R,
    build?: (related: DatasetConditions<H['has'][R]>) => void,
    op: DatasetCountOperator = '>=',
    count = 1
  ): this {
    this.has[relation] = { ...this.level(build), op, count, negate: false }
    return this
  }

  /**
   * Keeps the records without related records, or without any matching the conditions.
   *
   * @param {R} relation
   * @param {(related: DatasetConditions<H['has'][R]>) => void} [build] conditions on the related records
   * @returns {this}
   */
  whereDoesntHave<R extends keyof H['has'] & string>(
    relation: R,
    build?: (related: DatasetConditions<H['has'][R]>) => void
  ): this {
    this.has[relation] = { ...this.level(build), op: '>=', count: 1, negate: true }
    return this
  }

  /**
   * @param {(group: DatasetConditions<H, F>) => void} build
   * @returns {DatasetCondition[]}
   */
  private group(build: (group: DatasetConditions<H, F>) => void): DatasetCondition[] {
    const group = new DatasetConditions<H, F>()
    build(group)
    return group.conditions
  }

  /**
   * @param {(related: DatasetConditions<any>) => void} [build]
   * @returns {{ where: DatasetCondition[], has: Record<string, DatasetHasLevel> }}
   */
  private level(build?: (related: DatasetConditions<any>) => void): { where: DatasetCondition[]; has: Record<string, DatasetHasLevel> } {
    const related = new DatasetConditions<DatasetHasShape, string>()
    build?.(related)
    return { where: related.conditions, has: related.has }
  }
}

/**
 * A dataset of a model: rows of the columns, joined columns and aggregates it selects, filtered,
 * grouped and sorted as asked, read through the model's index route.
 *
 * @remarks
 * Its rows are plain objects keyed by the requested column paths and aggregate names, not
 * {@link Model} instances, and they are never tracked by the {@link Registry}. Building it
 * performs no request; {@link DatasetBuilder.get} does. A dataset always needs a
 * {@link DatasetBuilder.limit}, up to the model's `datasetMaxLimit`.
 */
export class DatasetBuilder<
  S extends DatasetShape = AnyDatasetShape,
  J extends string = never,
  L extends string = never,
  Row extends object = {},
> {
  private readonly selects: string[] = []
  private readonly aggregates: Array<[string, string]> = []
  private readonly periods: Array<[string, string]> = []
  private readonly joins = new Map<string, 'inner' | 'left'>()
  private readonly groups: string[] = []
  private readonly sorts: string[] = []
  private readonly root = new DatasetConditions<S, string>()
  private limitCount?: number
  private timezoneName?: string
  private offsetCount?: number

  /**
   * @param {string} path the collection path the dataset reads, relative to the API root
   * @param {string} resource the resource whose rows the dataset reads
   * @param {number | null} maxLimit the most rows one request may ask for, when known
   * @param {Record<string, string>} relatedResources resources of the joined and has relations, by relation path
   */
  constructor(
    private readonly path: string,
    private readonly resource: string,
    private readonly maxLimit: number | null,
    private readonly relatedResources: Record<string, string> = {}
  ) {}

  /**
   * Joins a relation, keeping only the rows that have a related record.
   *
   * @param {R} relation
   * @returns {DatasetBuilder<S, J | R, L, Row>}
   */
  join<R extends keyof S['joins'] & string>(relation: R): DatasetBuilder<S, J | R, L, Row> {
    this.joins.set(relation, 'inner')
    return this as unknown as DatasetBuilder<S, J | R, L, Row>
  }

  /**
   * Joins a relation, keeping the rows without a related record, whose joined columns are null.
   *
   * @param {R} relation
   * @returns {DatasetBuilder<S, J | R, L | R, Row>}
   */
  leftJoin<R extends keyof S['joins'] & string>(relation: R): DatasetBuilder<S, J | R, L | R, Row> {
    this.joins.set(relation, 'left')
    return this as unknown as DatasetBuilder<S, J | R, L | R, Row>
  }

  /**
   * Selects columns of the model, or of a joined relation as `relation.column`. Each one is a
   * key of the rows.
   *
   * @param {...F} columns
   * @returns {DatasetBuilder<S, J, L, Row & { [K in F]: DatasetFieldType<S, J, L, K> }>}
   */
  select<F extends DatasetField<S, J>>(...columns: F[]): DatasetBuilder<S, J, L, Row & { [K in F]: DatasetFieldType<S, J, L, K> }> {
    this.selects.push(...columns)
    return this as unknown as DatasetBuilder<S, J, L, Row & { [K in F]: DatasetFieldType<S, J, L, K> }>
  }

  /**
   * Counts the rows, or the non-null values of a column, under a key of the rows.
   *
   * @param {DatasetAllowing<S, J, L, Row, 'count'>} this the builder, when its shape allows the aggregate
   * @param {A} key
   * @param {DatasetField<S, J>} [column]
   * @returns {DatasetBuilder<S, J, L, Row & Record<A, number>>}
   */
  count<A extends string>(
    this: DatasetAllowing<S, J, L, Row, 'count'>,
    key: A,
    column?: DatasetField<S, J>
  ): DatasetBuilder<S, J, L, Row & Record<A, number>> {
    return this.aggregate(key, column === undefined ? 'count' : `count:${column}`)
  }

  /**
   * Sums a column, under a key of the rows.
   *
   * @param {DatasetAllowing<S, J, L, Row, 'sum'>} this the builder, when its shape allows the aggregate
   * @param {DatasetField<S, J>} column
   * @param {A} key
   * @returns {DatasetBuilder<S, J, L, Row & Record<A, number | null>>}
   */
  sum<A extends string>(
    this: DatasetAllowing<S, J, L, Row, 'sum'>,
    column: DatasetField<S, J>,
    key: A
  ): DatasetBuilder<S, J, L, Row & Record<A, number | null>> {
    return this.aggregate(key, `sum:${column}`)
  }

  /**
   * Averages a column, under a key of the rows.
   *
   * @param {DatasetAllowing<S, J, L, Row, 'avg'>} this the builder, when its shape allows the aggregate
   * @param {DatasetField<S, J>} column
   * @param {A} key
   * @returns {DatasetBuilder<S, J, L, Row & Record<A, number | null>>}
   */
  avg<A extends string>(
    this: DatasetAllowing<S, J, L, Row, 'avg'>,
    column: DatasetField<S, J>,
    key: A
  ): DatasetBuilder<S, J, L, Row & Record<A, number | null>> {
    return this.aggregate(key, `avg:${column}`)
  }

  /**
   * The lowest value of a column, under a key of the rows.
   *
   * @param {DatasetAllowing<S, J, L, Row, 'min'>} this the builder, when its shape allows the aggregate
   * @param {F} column
   * @param {A} key
   * @returns {DatasetBuilder<S, J, L, Row & Record<A, DatasetExtreme<DatasetFieldType<S, J, L, F>>>>}
   */
  min<F extends DatasetField<S, J>, A extends string>(
    this: DatasetAllowing<S, J, L, Row, 'min'>,
    column: F,
    key: A
  ): DatasetBuilder<S, J, L, Row & Record<A, DatasetExtreme<DatasetFieldType<S, J, L, F>>>> {
    return this.aggregate(key, `min:${column}`)
  }

  /**
   * The highest value of a column, under a key of the rows.
   *
   * @param {DatasetAllowing<S, J, L, Row, 'max'>} this the builder, when its shape allows the aggregate
   * @param {F} column
   * @param {A} key
   * @returns {DatasetBuilder<S, J, L, Row & Record<A, DatasetExtreme<DatasetFieldType<S, J, L, F>>>>}
   */
  max<F extends DatasetField<S, J>, A extends string>(
    this: DatasetAllowing<S, J, L, Row, 'max'>,
    column: F,
    key: A
  ): DatasetBuilder<S, J, L, Row & Record<A, DatasetExtreme<DatasetFieldType<S, J, L, F>>>> {
    return this.aggregate(key, `max:${column}`)
  }

  /**
   * Compares a column to a value, matches it against a list or a range, or checks it is null.
   *
   * @param {DatasetField<S, J>} column
   * @param {DatasetComparison | 'in' | 'notIn' | 'between' | 'null' | 'notNull'} op
   * @param {DatasetValue | DatasetValue[]} [value]
   * @returns {this}
   */
  where(column: DatasetField<S, J>, op: DatasetComparison, value: DatasetValue): this
  where(column: DatasetField<S, J>, op: 'in' | 'notIn', value: DatasetValue[]): this
  where(column: DatasetField<S, J>, op: 'between', value: [DatasetValue, DatasetValue]): this
  where(column: DatasetField<S, J>, op: 'null' | 'notNull'): this
  where(column: DatasetField<S, J>, op: string, value?: DatasetValue | DatasetValue[]): this {
    ;(this.root as DatasetConditions<S, string>).where(column, op as DatasetComparison, value as DatasetValue)
    return this
  }

  /**
   * @param {DatasetField<S, J>} column
   * @param {DatasetValue[]} values
   * @returns {this}
   */
  whereIn(column: DatasetField<S, J>, values: DatasetValue[]): this {
    this.root.whereIn(column, values)
    return this
  }

  /**
   * @param {DatasetField<S, J>} column
   * @param {DatasetValue[]} values
   * @returns {this}
   */
  whereNotIn(column: DatasetField<S, J>, values: DatasetValue[]): this {
    this.root.whereNotIn(column, values)
    return this
  }

  /**
   * @param {DatasetField<S, J>} column
   * @param {[DatasetValue, DatasetValue]} range
   * @returns {this}
   */
  whereBetween(column: DatasetField<S, J>, range: [DatasetValue, DatasetValue]): this {
    this.root.whereBetween(column, range)
    return this
  }

  /**
   * @param {DatasetField<S, J>} column
   * @returns {this}
   */
  whereNull(column: DatasetField<S, J>): this {
    this.root.whereNull(column)
    return this
  }

  /**
   * @param {DatasetField<S, J>} column
   * @returns {this}
   */
  whereNotNull(column: DatasetField<S, J>): this {
    this.root.whereNotNull(column)
    return this
  }

  /**
   * Matches when any of the conditions the callback adds matches.
   *
   * @param {(group: DatasetConditions<S, DatasetField<S, J>>) => void} build
   * @returns {this}
   */
  whereAny(build: (group: DatasetConditions<S, DatasetField<S, J>>) => void): this {
    this.root.whereAny(build as (group: DatasetConditions<S, string>) => void)
    return this
  }

  /**
   * Matches when every condition the callback adds matches.
   *
   * @param {(group: DatasetConditions<S, DatasetField<S, J>>) => void} build
   * @returns {this}
   */
  whereAll(build: (group: DatasetConditions<S, DatasetField<S, J>>) => void): this {
    this.root.whereAll(build as (group: DatasetConditions<S, string>) => void)
    return this
  }

  /**
   * Keeps the rows with related records, optionally matching conditions of their own, on
   * columns given without the relation name, and in a given number.
   *
   * @param {R} relation
   * @param {(related: DatasetConditions<S['has'][R]>) => void} [build]
   * @param {DatasetCountOperator} [op]
   * @param {number} [count]
   * @returns {this}
   */
  whereHas<R extends keyof S['has'] & string>(
    relation: R,
    build?: (related: DatasetConditions<S['has'][R]>) => void,
    op: DatasetCountOperator = '>=',
    count = 1
  ): this {
    this.root.whereHas(relation, build, op, count)
    return this
  }

  /**
   * Keeps the rows without related records, or without any matching the conditions.
   *
   * @param {R} relation
   * @param {(related: DatasetConditions<S['has'][R]>) => void} [build]
   * @returns {this}
   */
  whereDoesntHave<R extends keyof S['has'] & string>(
    relation: R,
    build?: (related: DatasetConditions<S['has'][R]>) => void
  ): this {
    this.root.whereDoesntHave(relation, build)
    return this
  }

  /**
   * Groups the rows by columns. Once a dataset groups or aggregates, each selected column must
   * be one it groups by.
   *
   * @param {...Field<S, J>} columns
   * @returns {this}
   */
  groupBy(...columns: DatasetField<S, J>[]): this {
    this.groups.push(...columns)
    return this
  }

  /**
   * Groups by the day, week (starting on Monday), month or year of a date column, selected under
   * a key of the rows as the first date of each period, e.g. `'2026-02-01'` for February.
   *
   * @param {DatasetField<S, J>} column
   * @param {DatasetDateUnit} unit
   * @param {A} key
   * @returns {DatasetBuilder<S, J, L, Row & Record<A, string>>}
   */
  groupByDate<A extends string>(
    column: DatasetField<S, J>,
    unit: DatasetDateUnit,
    key: A
  ): DatasetBuilder<S, J, L, Row & Record<A, string>> {
    this.periods.push([key, `${column}:${unit}`])
    return this as unknown as DatasetBuilder<S, J, L, Row & Record<A, string>>
  }

  /**
   * The time zone the periods of {@link DatasetBuilder.groupByDate} start and end in, e.g.
   * `'America/New_York'`, instead of the server's default.
   *
   * @param {string} name a time zone identifier
   * @returns {this}
   */
  timezone(name: string): this {
    this.timezoneName = name
    return this
  }

  /**
   * Sorts by a key of the rows: a selected column, a date period or an aggregate.
   *
   * @param {keyof Row & string} key
   * @param {'asc' | 'desc'} [direction]
   * @returns {this}
   */
  orderBy(key: keyof Row & string, direction: 'asc' | 'desc' = 'asc'): this {
    this.sorts.push(direction === 'desc' ? `-${key}` : key)
    return this
  }

  /**
   * @param {number} count rows per request, required, up to the model's `datasetMaxLimit`
   * @returns {this}
   */
  limit(count: number): this {
    this.limitCount = count
    return this
  }

  /**
   * @param {number} count rows to skip, for reading a dataset page by page
   * @returns {this}
   */
  offset(count: number): this {
    this.offsetCount = count
    return this
  }

  /**
   * The resources whose changes can change this dataset: its own and those of the relations it
   * joins or filters by, when known.
   *
   * @returns {string[]}
   */
  getResources(): string[] {
    const paths = [...this.joins.keys(), ...hasPaths(this.root.has, '')]
    const related = paths.map((path) => this.relatedResources[path]).filter((resource): resource is string => !!resource)
    return [...new Set([this.resource, ...related])]
  }

  /**
   * The path this dataset requests, relative to the API root, including its query string.
   * Identical datasets share it.
   *
   * @returns {string}
   */
  toPath(): string {
    const params = new URLSearchParams()
    if (this.joins.size > 0) {
      params.set('join', [...this.joins].map(([name, type]) => (type === 'left' ? `${name}:left` : name)).join(','))
    }
    if (this.selects.length > 0) {
      params.set('select', this.selects.join(','))
    }
    for (const [key, spec] of this.aggregates) {
      params.set(`aggregate[${key}]`, spec)
    }
    appendConditions(params, 'where', this.root.conditions)
    appendHas(params, 'has', this.root.has)
    this.groups.forEach((column, index) => params.set(`group[${index}]`, column))
    for (const [key, spec] of this.periods) {
      params.set(`group[${key}]`, spec)
    }
    if (this.timezoneName !== undefined) {
      params.set('tz', this.timezoneName)
    }
    if (this.sorts.length > 0) {
      params.set('sort', this.sorts.join(','))
    }
    if (this.limitCount !== undefined) {
      params.set('limit', String(this.limitCount))
    }
    if (this.offsetCount !== undefined) {
      params.set('offset', String(this.offsetCount))
    }
    return `${this.path}?${params.toString()}`
  }

  /**
   * Requests the dataset.
   *
   * @param {DatasetRequestOptions} [options]
   * @returns {Promise<DatasetRows<DatasetSimplify<Row>>>}
   * @throws if no limit was set or it exceeds the model's `datasetMaxLimit`, before any request
   * @throws {DatasetNotEnabledError} when the model's controller does not allow datasets
   * @throws {DatasetTimeoutError} when the database cancelled the dataset for running too long
   */
  async get(options: DatasetRequestOptions = {}): Promise<DatasetRows<DatasetSimplify<Row>>> {
    this.assertWithinLimit()

    let body: unknown
    let headers: Headers
    try {
      ;({ body, headers } = await client().get<unknown>(this.toPath(), { signal: options.signal }))
    } catch (caught) {
      throw this.translate(caught)
    }

    if (!Array.isArray(body)) {
      throw new DatasetNotEnabledError(this.resource)
    }
    const keys = new Set([...this.selects, ...this.periods.map(([key]) => key), ...this.aggregates.map(([key]) => key)])
    const rows = body.map((row) => {
      if (typeof row !== 'object' || row === null || Object.keys(row).some((key) => !keys.has(key))) {
        throw new DatasetNotEnabledError(this.resource)
      }
      return Object.freeze(row as DatasetSimplify<Row>)
    })

    return Object.freeze(withTotal(rows, readTotalCount(headers, rows.length))) as unknown as DatasetRows<DatasetSimplify<Row>>
  }

  /**
   * @param {string} key
   * @param {string} spec
   * @returns {DatasetBuilder<S, J, L, any>}
   */
  private aggregate(key: string, spec: string): DatasetBuilder<S, J, L, any> {
    this.aggregates.push([key, spec])
    return this as DatasetBuilder<S, J, L, any>
  }

  /**
   * @returns {void}
   */
  private assertWithinLimit(): void {
    const max = this.maxLimit === null ? '' : ` (max ${this.maxLimit})`
    if (this.limitCount === undefined) {
      throw new Error(`A dataset of ${this.resource} requires a limit${max}. Call .limit(n) before .get().`)
    }
    if (this.maxLimit !== null && this.limitCount > this.maxLimit) {
      throw new Error(`.limit(${this.limitCount}) exceeds the max allowed for a dataset of ${this.resource} (${this.maxLimit}).`)
    }
  }

  /**
   * Turns the errors the server answers a dataset with into dataset errors.
   *
   * @param {unknown} caught
   * @returns {unknown}
   */
  private translate(caught: unknown): unknown {
    if (!(caught instanceof HttpError)) {
      return caught
    }
    if (caught.status === 504) {
      return new DatasetTimeoutError(this.resource)
    }
    const message = (caught.body as { message?: unknown } | null)?.message
    if (caught.status === 400 && typeof message === 'string' && message.includes('not enabled')) {
      return new DatasetNotEnabledError(this.resource)
    }
    return caught
  }
}

/** Entry point of datasets. */
export const Dataset = {
  /**
   * Starts a dataset of a generated model, typed by the shape its controller allows; of the
   * records of a relation of one record, from `Model.related()`; or of a collection path such
   * as `'customer/5/orders'`. The last two are untyped.
   *
   * @param {M | QueryBuilder<Model> | string} source
   * @returns {DatasetBuilder}
   */
  for<M extends DatasetModel | QueryBuilder<Model> | string>(
    source: M
  ): DatasetBuilder<M extends DatasetModel<infer S> ? S : AnyDatasetShape> {
    if (typeof source === 'string') {
      const path = source.replace(/^\/+/, '')
      const segments = path.split('/')
      return new DatasetBuilder(path, segments[segments.length - 1], null) as never
    }
    if (source instanceof QueryBuilder) {
      const model = source.getModel() as Partial<DatasetModel> | undefined
      return new DatasetBuilder(
        source.getPath(),
        source.getResource(),
        model?.datasetMaxLimit ?? null,
        model?.datasetResources
      ) as never
    }
    const model = source as DatasetModel
    return new DatasetBuilder(model.resource, model.resource, model.datasetMaxLimit ?? null, model.datasetResources) as never
  },
}

/**
 * The dotted paths of every has level.
 *
 * @param {Record<string, DatasetHasLevel>} has
 * @param {string} prefix
 * @returns {string[]}
 */
function hasPaths(has: Record<string, DatasetHasLevel>, prefix: string): string[] {
  return Object.entries(has).flatMap(([name, level]) => {
    const path = prefix === '' ? name : `${prefix}.${name}`
    return [path, ...hasPaths(level.has, path)]
  })
}

/**
 * Serializes conditions in the bracket notation Laravel reads as nested arrays.
 *
 * @param {URLSearchParams} params
 * @param {string} prefix
 * @param {DatasetCondition[]} conditions
 * @returns {void}
 */
function appendConditions(params: URLSearchParams, prefix: string, conditions: DatasetCondition[]): void {
  conditions.forEach((condition, index) => {
    const key = `${prefix}[${index}]`
    if ('or' in condition) {
      appendConditions(params, `${key}[or]`, condition.or)
      return
    }
    if ('and' in condition) {
      appendConditions(params, `${key}[and]`, condition.and)
      return
    }
    params.set(`${key}[column]`, condition.column)
    params.set(`${key}[op]`, condition.op)
    if (Array.isArray(condition.value)) {
      condition.value.forEach((value, valueIndex) => params.set(`${key}[value][${valueIndex}]`, serializeValue(value)))
    } else if (condition.value !== undefined) {
      params.set(`${key}[value]`, serializeValue(condition.value))
    }
  })
}

/**
 * Serializes has levels: their conditions, count or negation, and the levels below them.
 *
 * @param {URLSearchParams} params
 * @param {string} prefix
 * @param {Record<string, DatasetHasLevel>} has
 * @returns {void}
 */
function appendHas(params: URLSearchParams, prefix: string, has: Record<string, DatasetHasLevel>): void {
  for (const [name, level] of Object.entries(has)) {
    const key = `${prefix}[${name}]`
    const isPlain = level.where.length === 0 && Object.keys(level.has).length === 0 && !level.negate
    if (level.negate) {
      params.set(`${key}[negate]`, '1')
    } else if (level.op !== '>=' || level.count !== 1 || isPlain) {
      params.set(`${key}[count]`, `${level.op}${level.count}`)
    }
    appendConditions(params, `${key}[where]`, level.where)
    appendHas(params, `${key}[has]`, level.has)
  }
}

/**
 * @param {DatasetValue} value
 * @returns {string}
 */
function serializeValue(value: DatasetValue): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  return String(value)
}
