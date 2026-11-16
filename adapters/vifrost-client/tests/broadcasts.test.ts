import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleModelBroadcast, listenToModelBroadcasts } from '../src/broadcasts.js'
import { configure, resetClient } from '../src/config.js'
import { Model } from '../src/Model.js'
import { Registry } from '../src/Registry.js'

class Product extends Model {
  static resource = 'product'
}

class ProductTag extends Model {
  static resource = 'producttag'
  static primaryKey = ['product_id', 'tag_id'] as const
}

const models = { Product, ProductTag, helper: () => 1 }

let registry: Registry

beforeEach(() => {
  registry = new Registry()
  configure({ baseUrl: 'https://api.test', fetch: vi.fn() as unknown as typeof fetch, registry })
})

afterEach(() => {
  resetClient()
})

describe('handleModelBroadcast', () => {
  it('reports each Eloquent model event to the Registry', () => {
    const created = vi.spyOn(registry, 'created')
    const updated = vi.spyOn(registry, 'updated')
    const removed = vi.spyOn(registry, 'remove')

    handleModelBroadcast('.ProductCreated', { model: { id: 1 } }, models)
    handleModelBroadcast('ProductUpdated', { model: { id: 2 } }, models)
    handleModelBroadcast('.ProductRestored', { model: { id: 3 } }, models)
    handleModelBroadcast('.ProductDeleted', { model: { id: 4 } }, models)
    handleModelBroadcast('.ProductTrashed', { model: { id: 5 } }, models)

    expect(created).toHaveBeenCalledWith('product', 1)
    expect(updated.mock.calls).toEqual([['product', 2], ['product', 3]])
    expect(removed.mock.calls).toEqual([['product', 4], ['product', 5]])
  })

  it('encodes a composite key the way the Registry tracks it', () => {
    const removed = vi.spyOn(registry, 'remove')

    expect(handleModelBroadcast('.ProductTagDeleted', { model: { tag_id: 3, product_id: 5 } }, [ProductTag])).toBe(true)
    expect(removed).toHaveBeenCalledWith('producttag', '5,3')
  })

  it('ignores events that are not model events of the given models', () => {
    expect(handleModelBroadcast('.OrderShipped', { model: { id: 1 } }, models)).toBe(false)
    expect(handleModelBroadcast('.InvoiceCreated', { model: { id: 1 } }, models)).toBe(false)
    expect(handleModelBroadcast('.helperCreated', { model: { id: 1 } }, models)).toBe(false)
    expect(handleModelBroadcast('.ProductCreated', { model: { name: 'no key' } }, models)).toBe(false)
  })
})

describe('listenToModelBroadcasts', () => {
  it('listens to every event of a channel', () => {
    let listener: ((event: string, data: unknown) => void) | undefined
    const channel = { listenToAll: (callback: (event: string, data: unknown) => void) => (listener = callback) }
    const created = vi.spyOn(registry, 'created')

    expect(listenToModelBroadcasts(channel, models)).toBe(channel)
    listener?.('.ProductCreated', { model: { id: 9 } })

    expect(created).toHaveBeenCalledWith('product', 9)
  })
})
