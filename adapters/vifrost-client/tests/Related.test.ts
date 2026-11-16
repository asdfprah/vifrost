import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, getQueryCache, resetClient } from '../src/config.js'
import { Model } from '../src/Model.js'
import { Registry } from '../src/Registry.js'

class Order extends Model {
  static resource = 'order'
  static maxLimit = 50
  declare id: number
  declare amount: number
}

class Customer extends Model {
  static resource = 'customer'
  declare id: number
}

/**
 * @param {unknown} body
 * @param {Record<string, string>} headers
 * @returns {Response}
 */
function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
}

let fetchMock: ReturnType<typeof vi.fn>
let registry: Registry

beforeEach(() => {
  fetchMock = vi.fn()
  registry = new Registry()
  configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry, sync: { debounceMs: 0 } })
})

afterEach(() => {
  resetClient()
})

describe('Model.related()', () => {
  it('queries the nested route of a record and returns instances of the related model', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 3, amount: 11 }], { 'X-Total-Count': '9' }))

    const orders = await Customer.related(5, 'orders', Order).where('amount', 11).orderBy('id').limit(10).get()

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.test/customer/5/orders?filter%5Bamount%5D=11&sort=id&limit=10'
    )
    expect(orders[0]).toBeInstanceOf(Order)
    expect(orders.total).toBe(9)
    expect(registry.isTracked('order', 3)).toBe(true)
  })

  it('reads one record of the relation by its key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 3, amount: 11 }))

    const order = await Customer.related(5, 'orders', Order).whereId(3).first()

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/customer/5/orders/3')
    expect(order).toBeInstanceOf(Order)
  })

  it('enforces the related model max limit', async () => {
    await expect(Customer.related(5, 'orders', Order).get()).rejects.toThrow(/requires a limit/)
  })

  it('is watched as a list of the related resource, refreshed when one of its records changes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 3, amount: 11 }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 3, amount: 11 }, { id: 4, amount: 12 }]))

    const handle = getQueryCache().watch(Customer.related(5, 'orders', Order).limit(10))
    await vi.waitFor(() => expect(handle.snapshot().isLoading).toBe(false))
    registry.created('order', 4)

    await vi.waitFor(() => expect(handle.snapshot().rows).toHaveLength(2))
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/customer/5/orders?limit=10')
  })

  it('syncs through the nested path', async () => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry, sync: { path: '_vifrost/sync', debounceMs: 0 } })
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 3, amount: 11 }]))
      .mockResolvedValueOnce(jsonResponse({ results: [{ status: 200, ids: [3], total: 1, rows: [] }] }))

    const handle = getQueryCache().watch(Customer.related(5, 'orders', Order).limit(10))
    await vi.waitFor(() => expect(handle.snapshot().isLoading).toBe(false))
    registry.created('order', 8)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).queries[0].path).toBe('customer/5/orders?limit=10')
  })

})
