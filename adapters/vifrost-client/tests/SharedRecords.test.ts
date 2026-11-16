import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, resetClient } from '../src/config.js'
import { Model } from '../src/Model.js'
import { Registry } from '../src/Registry.js'

class Address extends Model {
  static resource = 'address'
  declare id: number
  declare name: string
}

class Order extends Model {
  static resource = 'order'
  static relations = ['shippingAddress', 'courier']
  declare id: number
  declare status: string

  shippingAddress(): Promise<Address | null> {
    return this.toOne('shippingAddress', Address)
  }

  courier(): Promise<Address | null> {
    return this.toOne('courier', Address)
  }
}

/**
 * @param {unknown} body
 * @returns {Response}
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

let fetchMock: ReturnType<typeof vi.fn>
let registry: Registry

beforeEach(() => {
  fetchMock = vi.fn()
  registry = new Registry()
  configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry, unloadedRelationAccess: 'error' })
})

afterEach(() => {
  resetClient()
})

describe('loaded relations serialized in snake_case', () => {
  it('are read under their relation names', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, status: 'done', shipping_address: { id: 7, street: 'Main St' } }]))

    const [order] = await Order.query().with('shippingAddress').limit(1).get()

    expect(order.shippingAddress).toEqual({ id: 7, street: 'Main St' })
    expect('shipping_address' in order).toBe(false)
  })

  it('are renamed along nested includes, through to-many levels', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: 1, shipping_address: { id: 7, delivery_zones: [{ id: 3, zone_group: { id: 1 } }] } }])
    )

    const [order] = await Order.query().with('shippingAddress.deliveryZones.zoneGroup').limit(1).get()

    expect(order.shippingAddress).toEqual({ id: 7, deliveryZones: [{ id: 3, zoneGroup: { id: 1 } }] })
  })

  it('still guard the relations that were not loaded', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, shipping_address: { id: 7 } }]))

    const [order] = await Order.query().with('shippingAddress').limit(1).get()

    expect(() => (order.courier as unknown as { name: string }).name).toThrow(/hasn't been loaded/)
  })
})

describe('one record fetched by queries with different includes', () => {
  it('keeps the relations a later fetch did not load', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, status: 'open', shipping_address: { id: 7, street: 'Main St' } }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 1, status: 'done' }]))

    await Order.query().with('shippingAddress').limit(10).get()
    const listener = vi.fn()
    registry.subscribe('order', 1, listener)
    await Order.query().limit(10).get()

    const [event] = listener.mock.calls[0]
    expect(event.value.status).toBe('done')
    expect(event.value.shippingAddress).toEqual({ id: 7, street: 'Main St' })
  })

  it('resyncs with every relation any fetch of the record loaded', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, shipping_address: { id: 7 } }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 1, courier: { id: 2 } }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }]))
      .mockResolvedValueOnce(jsonResponse({ id: 1, shipping_address: { id: 7 }, courier: { id: 2 } }))

    await Order.query().with('shippingAddress').limit(10).get()
    await Order.query().with('courier').limit(10).get()
    await Order.query().limit(10).get()
    await registry.resync('order', 1)

    const resyncUrl = decodeURIComponent(fetchMock.mock.calls[3][0] as string)
    expect(resyncUrl).toContain('order/1?include=shippingAddress,courier')
  })
})
