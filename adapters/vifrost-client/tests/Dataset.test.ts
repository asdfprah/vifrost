import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { configure, getDatasetCache, resetClient } from '../src/config.js'
import { Dataset, DatasetNotEnabledError, DatasetTimeoutError } from '../src/Dataset.js'
import { Model } from '../src/Model.js'
import { Registry } from '../src/Registry.js'

interface OrderDatasetShape {
  columns: { status: string; amount: string; customer_id: number | null; placed_on: string }
  joins: { customer: { columns: { name: string } }; items: { columns: { kind: string; cost: string } } }
  has: {
    items: {
      columns: { kind: string; cost: string }
      has: { refunds: { columns: { code: string }; has: {} } }
    }
  }
  aggregates: 'count' | 'sum' | 'avg' | 'min' | 'max'
}

class Order extends Model {
  static resource = 'order'
  static datasetMaxLimit = 50
  static datasetResources = { customer: 'customer', items: 'orderitem', 'items.refunds': 'refund' }
  declare static readonly datasetShape: OrderDatasetShape
}

class CountOnly extends Model {
  static resource = 'countonly'
  declare static readonly datasetShape: { columns: { status: string }; joins: {}; has: {}; aggregates: 'count' }
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} headers
 * @returns {Response}
 */
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/**
 * @param {string} path
 * @returns {Record<string, string>}
 */
function paramsOf(path: string): Record<string, string> {
  return Object.fromEntries(new URL(path, 'https://api.test/').searchParams)
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
})

afterEach(() => {
  vi.useRealTimers()
  resetClient()
})

describe('Dataset.for()', () => {
  it('serializes every part in the parameters the Laravel query builder reads', () => {
    const path = Dataset.for(Order)
      .leftJoin('customer')
      .join('items')
      .select('customer.name')
      .count('total')
      .sum('items.cost', 'revenue')
      .where('status', '=', 'done')
      .whereIn('customer_id', [1, 2])
      .whereAny((any) => any.where('amount', '>', 100).whereAll((all) => all.whereNull('customer_id').where('status', '!=', 'open')))
      .whereHas('items', (t) => t.where('kind', '=', 'crown').whereHas('refunds', (p) => p.where('code', 'in', ['X1'])), '>=', 2)
      .whereDoesntHave('items', (t) => t.whereBetween('cost', [0, 10]))
      .groupBy('customer.name')
      .orderBy('total', 'desc')
      .limit(20)
      .offset(40)
      .toPath()

    expect(path.startsWith('order?')).toBe(true)
    expect(paramsOf(path)).toEqual({
      join: 'customer:left,items',
      select: 'customer.name',
      'aggregate[total]': 'count',
      'aggregate[revenue]': 'sum:items.cost',
      'where[0][column]': 'status',
      'where[0][op]': '=',
      'where[0][value]': 'done',
      'where[1][column]': 'customer_id',
      'where[1][op]': 'in',
      'where[1][value][0]': '1',
      'where[1][value][1]': '2',
      'where[2][or][0][column]': 'amount',
      'where[2][or][0][op]': '>',
      'where[2][or][0][value]': '100',
      'where[2][or][1][and][0][column]': 'customer_id',
      'where[2][or][1][and][0][op]': 'null',
      'where[2][or][1][and][1][column]': 'status',
      'where[2][or][1][and][1][op]': '!=',
      'where[2][or][1][and][1][value]': 'open',
      'has[items][negate]': '1',
      'has[items][where][0][column]': 'cost',
      'has[items][where][0][op]': 'between',
      'has[items][where][0][value][0]': '0',
      'has[items][where][0][value][1]': '10',
      'group[0]': 'customer.name',
      sort: '-total',
      limit: '20',
      offset: '40',
    })
  })

  it('serializes a nested whereHas with a count, and a plain one', () => {
    const params = paramsOf(
      Dataset.for(Order)
        .count('total')
        .whereHas('items', (t) => t.where('kind', '=', 'crown').whereHas('refunds'), '>=', 2)
        .limit(1)
        .toPath()
    )

    expect(params).toMatchObject({
      'has[items][count]': '>=2',
      'has[items][where][0][column]': 'kind',
      'has[items][has][refunds][count]': '>=1',
    })
  })

  it('groups by columns and date periods in one parameter', () => {
    const params = paramsOf(
      Dataset.for(Order).select('status').groupByDate('placed_on', 'week', 'week').count('total').groupBy('status').limit(10).toPath()
    )

    expect(params).toMatchObject({ 'group[0]': 'status', 'group[week]': 'placed_on:week' })
  })

  it('groups by date periods', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ month: '2026-02-01', total: 3 }]))

    const builder = Dataset.for(Order).groupByDate('placed_on', 'month', 'month').count('total').orderBy('month').limit(12)
    const rows = await builder.get()

    expect(paramsOf(builder.toPath())).toEqual({ 'aggregate[total]': 'count', 'group[month]': 'placed_on:month', sort: 'month', limit: '12' })
    expectTypeOf(rows[0]).toEqualTypeOf<Readonly<{ month: string; total: number }>>()
    expect(rows).toEqual([{ month: '2026-02-01', total: 3 }])
  })

  it('types each row by the selected columns and aggregates', () => {
    const builder = Dataset.for(Order)
      .leftJoin('customer')
      .select('status', 'customer.name')
      .count('total')
      .sum('amount', 'revenue')
      .min('amount', 'lowest')
      .groupBy('status', 'customer.name')
      .limit(10)

    type Row = Awaited<ReturnType<typeof builder.get>>[number]
    expectTypeOf<Row>().toEqualTypeOf<
      Readonly<{ status: string; 'customer.name': string | null; total: number; revenue: number | null; lowest: string | number | null }>
    >()
  })

  it('accepts only the columns and relations the shape allows', () => {
    const builder = Dataset.for(Order)
    // @ts-expect-error a column of a relation that was not joined
    builder.select('customer.name')
    // @ts-expect-error a column the shape does not have
    builder.select('secret')
    // @ts-expect-error a relation that cannot be joined
    builder.join('watchers')
    // @ts-expect-error a column of a has level given with its relation name
    builder.whereHas('items', (t) => t.where('items.kind', '=', 'x'))
    // @ts-expect-error an aggregate the model does not allow
    Dataset.for(CountOnly).sum('status', 'x')
    Dataset.for(CountOnly).count('total')
    expect(true).toBe(true)
  })

  it('returns frozen plain rows with the total, without tracking them', async () => {
    const registry = new Registry()
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry })
    fetchMock.mockResolvedValue(jsonResponse([{ status: 'done', total: 4 }], 200, { 'X-Total-Count': '7' }))

    const rows = await Dataset.for(Order).select('status').count('total').groupBy('status').limit(10).get()

    expect(rows).toEqual([{ status: 'done', total: 4 }])
    expect(rows.total).toBe(7)
    expect(Object.isFrozen(rows[0])).toBe(true)
    expect(rows[0]).not.toBeInstanceOf(Model)
    expect(registry.isTracked('order', 4)).toBe(false)
  })

  it('requires a limit within the dataset max before any request', async () => {
    await expect(Dataset.for(Order).count('total').get()).rejects.toThrow(/requires a limit \(max 50\)/)
    await expect(Dataset.for(Order).count('total').limit(51).get()).rejects.toThrow(/exceeds the max/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a controller that does not allow datasets', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, status: 'done', amount: '1.00' }]))
      .mockResolvedValueOnce(jsonResponse({ message: 'Datasets are not enabled for Order.' }, 400))

    await expect(Dataset.for(Order).select('status').limit(1).get()).rejects.toBeInstanceOf(DatasetNotEnabledError)
    await expect(Dataset.for(Order).select('status').limit(1).get()).rejects.toBeInstanceOf(DatasetNotEnabledError)
  })

  it('reports a dataset the database cancelled', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'The dataset took too long to compute.' }, 504))

    await expect(Dataset.for(Order).count('total').limit(1).get()).rejects.toBeInstanceOf(DatasetTimeoutError)
  })

  it('reads a collection path, untyped', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ total: 2 }]))

    const rows = await Dataset.for('customer/1/orders').count('total').limit(1).get()

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/customer/1/orders?aggregate%5Btotal%5D=count&limit=1')
    expectTypeOf(rows[0].total).toEqualTypeOf<number>()
    expect(rows[0].total).toBe(2)
  })

  it('lists its resource and those of the relations it joins or filters by', () => {
    const builder = Dataset.for(Order)
      .join('customer')
      .count('total')
      .whereHas('items', (t) => t.whereHas('refunds'))

    expect(builder.getResources().sort()).toEqual(['customer', 'order', 'orderitem', 'refund'])
  })
})

describe('DatasetCache.watch()', () => {
  it('shares one request between identical datasets', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ total: 3 }]))
    const cache = getDatasetCache()

    const first = cache.watch(Dataset.for(Order).count('total').limit(1))
    const second = cache.watch(Dataset.for(Order).count('total').limit(1))
    await vi.waitFor(() => expect(first.snapshot().isLoading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.snapshot().rows).toEqual([{ total: 3 }])
  })

  it('refetches when a record of a resource it reads changes, and never syncs', async () => {
    const registry = new Registry()
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry, sync: { path: '_vifrost/sync', debounceMs: 0 } })
    fetchMock.mockResolvedValueOnce(jsonResponse([{ total: 3 }])).mockResolvedValueOnce(jsonResponse([{ total: 4 }]))

    const handle = getDatasetCache().watch(Dataset.for(Order).join('customer').count('total').limit(1))
    await vi.waitFor(() => expect(handle.snapshot().isLoading).toBe(false))
    registry.created('invoice', 1)
    registry.created('customer', 9)

    await vi.waitFor(() => expect(handle.snapshot().rows).toEqual([{ total: 4 }]))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('_vifrost/sync'))).toBe(true)
  })

  it('cancels the request of a dataset nobody watches anymore', async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return new Promise(() => undefined)
    })

    const handle = getDatasetCache().watch(Dataset.for(Order).count('total').limit(1))
    handle.release()

    expect(signal?.aborted).toBe(true)
  })
})
