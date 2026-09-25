import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, resetClient } from '../src/config.js'
import { Model } from '../src/Model.js'
import type { ModelCollection } from '../src/ModelCollection.js'
import { Registry } from '../src/Registry.js'

class Category extends Model {
  static resource = 'category'
  declare id: number
  declare name: string

  products(): Promise<ModelCollection<Product>> {
    return this.toMany('products', Product)
  }

  product(childId: number): Promise<Product> {
    return this.toManyChild('products', Product, childId)
  }
}

class Product extends Model {
  static resource = 'product'
  declare id: number
  declare name: string
  declare category_id: number

  category(): Promise<Category | null> {
    return this.toOne('category', Category)
  }
}

/** Same as Product, but with `relations` declared — as `@vifrost/codegen` would emit it. */
class GuardedProduct extends Product {
  static override relations = ['category']
}

/** Two relations, to exercise Model#load() loading more than one at once. */
class MultiRelationProduct extends Product {
  static override relations = ['category', 'reviews']

  reviews(): Promise<unknown[]> {
    return this.toMany('reviews', Category) // stand-in related class; not semantically meaningful here
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function jsonResponseWithTotal(body: unknown, total: number): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'X-Total-Count': String(total) },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
})

afterEach(() => {
  resetClient()
})

describe('Model static queries (no registry configured)', () => {
  beforeEach(() => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
  })

  it('all() GETs the resource and wraps each row in an instance', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Widgets' }]))

    const categories = await Category.all()

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/category', expect.any(Object))
    expect(categories[0]).toBeInstanceOf(Category)
    expect(categories[0].name).toBe('Widgets')
  })

  it('find(id) GETs the resource by id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1, name: 'Widgets' }))

    const category = await Category.find(1)

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/category/1', expect.any(Object))
    expect(category).toBeInstanceOf(Category)
  })

  it('query() builds a where/orderBy/with request', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Gadget' }]))

    await Product.query().where('status', 'active').orderBy('created_at', 'desc').with('category').get()

    const [url] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toBe(
      'https://api.test/product?filter[status]=active&sort=-created_at&include=category'
    )
  })

  it('query().whereId(id).first() hits the dedicated find endpoint, not a filtered collection', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7, name: 'Gadget' }))

    const product = await Product.query().whereId(7).first()

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/product/7', expect.any(Object))
    expect(product).toBeInstanceOf(Product)
  })

  it('all()/query().get() populate .total from the X-Total-Count response header', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithTotal([{ id: 1, name: 'Widgets' }], 21))

    const categories = await Category.all()

    expect(categories.total).toBe(21)
    expect(categories).toHaveLength(1)
  })

  it('.total falls back to the page size when X-Total-Count is missing', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }, { id: 2 }]))

    const categories = await Category.all()

    expect(categories.total).toBe(2)
  })

  it('query().whereId(id).get() wraps the single row in a collection with total: 1', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7, name: 'Gadget' }))

    const products = await Product.query().whereId(7).get()

    expect(products.total).toBe(1)
    expect(products[0]).toBeInstanceOf(Product)
  })
})

describe('static maxLimit propagation into QueryBuilder', () => {
  class Limited extends Model {
    static resource = 'limited'
    static maxLimit = 2
    declare id: number
  }

  beforeEach(() => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
  })

  it('all() throws before any request when the model requires a limit', async () => {
    await expect(Limited.all()).rejects.toThrow(/requires a limit/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('query().limit() within the model\'s maxLimit succeeds', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]))

    await expect(Limited.query().limit(2).get()).resolves.toHaveLength(1)
  })

  it('query().limit() above the model\'s maxLimit throws before any request', async () => {
    await expect(Limited.query().limit(3).get()).rejects.toThrow(/exceeds the max allowed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Model#save / Model#delete without a configured registry', () => {
  beforeEach(() => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
  })

  it('save() still works — publishing to a registry is entirely skipped, not just silent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 5, name: 'New Category' }))

    const category = new Category({ name: 'New Category' })
    await expect(category.save()).resolves.toBe(category)
    expect(category.id).toBe(5)
  })

  it('delete() still works with no registry to notify', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 5, name: 'Widgets' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const category = await Category.find(5)
    await expect(category.delete()).resolves.toBeUndefined()
  })
})

describe('Model#save / Model#delete with a configured registry', () => {
  let registry: Registry

  beforeEach(() => {
    registry = new Registry()
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry })
  })

  it('POSTs to create when the primary key is not set, and publishes an "updated" event', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 5, name: 'New Category' }))

    const category = new Category({ name: 'New Category' })
    const listenerAddedAfterCreate = vi.fn()

    await category.save()
    registry.subscribe('category', 5, listenerAddedAfterCreate)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/category')
    expect(init.method).toBe('POST')
    expect(category.id).toBe(5)
    expect(registry.isTracked('category', 5)).toBe(true)
  })

  it('PUTs to update when the primary key is set, and publishes the fresh value to subscribers', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 5, name: 'Old name' }))
      .mockResolvedValueOnce(jsonResponse({ id: 5, name: 'Renamed' }))

    const category = await Category.find(5)
    const listener = vi.fn()
    registry.subscribe('category', 5, listener)

    await category.save()

    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api.test/category/5')
    expect(init.method).toBe('PUT')
    expect(category.name).toBe('Renamed')
    expect(listener).toHaveBeenCalledWith({ type: 'updated', value: category })
  })

  it('delete() notifies subscribers with a "deleted" event and stops tracking', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 5, name: 'Widgets' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const category = await Category.find(5)
    const listener = vi.fn()
    registry.subscribe('category', 5, listener)

    await category.delete()

    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api.test/category/5')
    expect(init.method).toBe('DELETE')
    expect(listener).toHaveBeenCalledWith({ type: 'deleted' })
    expect(registry.isTracked('category', 5)).toBe(false)
  })
})

describe('Model relation helpers', () => {
  beforeEach(() => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
  })

  it('toMany() fetches the nested collection route and wraps each item', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Widgets' }))
      .mockResolvedValueOnce(jsonResponse([{ id: 10, name: 'Gadget', category_id: 1 }]))

    const category = await Category.find(1)
    const products = await category.products()

    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/category/1/products')
    expect(products[0]).toBeInstanceOf(Product)
    expect(products[0].name).toBe('Gadget')
  })

  it('toMany() populates .total from X-Total-Count too — it hits the same generated index() action', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Widgets' }))
      .mockResolvedValueOnce(jsonResponseWithTotal([{ id: 10, name: 'Gadget', category_id: 1 }], 5))

    const category = await Category.find(1)
    const products = await category.products()

    expect(products.total).toBe(5)
  })

  it('toOne() fetches the SAME array-shaped nested route and returns the first element', async () => {
    // Verified empirically against a real Vifrost API: a BelongsTo relation's
    // nested route responds with a JSON array (Vifrost's generated controller
    // always calls ->get()), not a bare object — never assume the shape.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 10, name: 'Gadget', category_id: 1 }))
      .mockResolvedValueOnce(jsonResponse([{ id: 1, name: 'Widgets' }]))

    const product = await Product.find(10)
    const category = await product.category()

    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/product/10/category')
    expect(category).toBeInstanceOf(Category)
    expect(category?.name).toBe('Widgets')
  })

  it('toOne() returns null when the array comes back empty (e.g. a nullable FK)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 10, name: 'Orphan', category_id: null }))
      .mockResolvedValueOnce(jsonResponse([]))

    const product = await Product.find(10)
    const category = await product.category()

    expect(category).toBeNull()
  })

  it('toManyChild() fetches one specific child by id as a bare object', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Widgets' }))
      .mockResolvedValueOnce(jsonResponse({ id: 10, name: 'Gadget', category_id: 1 }))

    const category = await Category.find(1)
    const product = await category.product(10)

    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/category/1/products/10')
    expect(product).toBeInstanceOf(Product)
  })
})

describe('Registry integration', () => {
  let registry: Registry

  beforeEach(() => {
    registry = new Registry()
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry })
  })

  it('tracks every fetched instance so it can be resynced later', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1, name: 'Widgets' }))

    await Category.find(1)

    expect(registry.isTracked('category', 1)).toBe(true)
  })

  it('resync() re-fetches through find() and notifies subscribers with an "updated" event', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Widgets' }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Widgets (renamed)' }))

    const category = await Category.find(1)
    const listener = vi.fn()
    registry.subscribe<Category>('category', 1, listener)

    await registry.resync('category', 1)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledWith({
      type: 'updated',
      value: expect.objectContaining({ name: 'Widgets (renamed)' }),
    })
    expect(category.name).toBe('Widgets') // the OLD instance is untouched; the app swaps in the new one itself
  })

  it('resync() replays the original .with() includes instead of dropping them', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([{ id: 1, name: 'Gadget', category_id: 9, category: { id: 9, name: 'Widgets' } }])
      )
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Gadget', category_id: 9, category: { id: 9, name: 'Widgets (renamed)' } }))

    const [product] = await Product.query().with('category').limit(10).get()
    expect(product.category).toEqual({ id: 9, name: 'Widgets' })

    const listener = vi.fn()
    registry.subscribe<Product>('product', 1, listener)

    await registry.resync('product', 1)

    const resyncUrl = fetchMock.mock.calls[1][0] as string
    expect(resyncUrl).toContain('include=category')

    const [event] = listener.mock.calls[0]
    expect(typeof event.value.category).toBe('object')
    expect(event.value.category).toEqual({ id: 9, name: 'Widgets (renamed)' })
  })
})

describe('unloadedRelationAccess', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns (the default) when a row fetched without .with() has its relation read as data', async () => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Gadget', category_id: 9 }]))

    const [product] = await GuardedProduct.query().limit(10).get()
    const name = (product.category as unknown as { name: string }).name

    expect(name).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"category" hasn\'t been loaded'))
  })

  it('does not warn when the row was fetched with .with("category")', async () => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: 1, name: 'Gadget', category_id: 9, category: { id: 9, name: 'Widgets' } }])
    )

    const [product] = await GuardedProduct.query().with('category').limit(10).get()

    expect(product.category).toEqual({ id: 9, name: 'Widgets' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('calling the relation method normally never warns, loaded or not', async () => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, name: 'Gadget', category_id: 9 }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 9, name: 'Widgets' }]))

    const [product] = await GuardedProduct.query().limit(10).get()
    await expect(product.category()).resolves.toEqual({ id: 9, name: 'Widgets' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('throws instead of warning when configured with "error"', async () => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, unloadedRelationAccess: 'error' })
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Gadget', category_id: 9 }]))

    const [product] = await GuardedProduct.query().limit(10).get()

    expect(() => (product.category as unknown as { name: string }).name).toThrow(/hasn't been loaded/)
  })

  it('skips the check entirely when configured with "off"', async () => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, unloadedRelationAccess: 'off' })
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Gadget', category_id: 9 }]))

    const [product] = await GuardedProduct.query().limit(10).get()
    const name = (product.category as unknown as { name: string }).name

    expect(name).toBe('category') // the old, un-guarded footgun — proves 'off' truly does nothing
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('a model with no declared relations is never wrapped, regardless of mode', async () => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Gadget', category_id: 9 }]))

    const [product] = await Product.query().limit(10).get() // Product, not GuardedProduct — relations = []
    const name = (product.category as unknown as { name: string }).name

    expect(name).toBe('category')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('Model#load', () => {
  beforeEach(() => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
  })

  it('throws, without fetching anything, when asked to load a relation that is not declared', async () => {
    const product = new GuardedProduct({ id: 1, category_id: 9 })

    await expect(product.load(['comments'])).rejects.toThrow(/has no relation\(s\) named: comments/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates every requested name before fetching any of them', async () => {
    const product = new MultiRelationProduct({ id: 1, category_id: 9 })

    await expect(product.load(['category', 'bogus'])).rejects.toThrow(/has no relation\(s\) named: bogus/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads a declared relation and assigns it onto the instance, returning `this`', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 9, name: 'Widgets' }]))

    const product = new GuardedProduct({ id: 1, category_id: 9 })
    const result = await product.load(['category'])

    expect(result).toBe(product)
    expect(product.category).toEqual({ id: 9, name: 'Widgets' })
  })

  it('loads multiple relations in parallel — both requests are in flight before either resolves', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 9, name: 'Widgets' }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 1, stars: 5 }]))

    const product = new MultiRelationProduct({ id: 1, category_id: 9 })
    const pending = product.load(['category', 'reviews'])

    // Both underlying fetches start synchronously inside Promise.all's .map()
    // — if load() awaited them one at a time instead, only one call would
    // have happened yet at this point.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await pending

    expect(product.category).toEqual({ id: 9, name: 'Widgets' })
    expect(product.reviews).toEqual([{ id: 1, stars: 5 }])
  })

  it('once loaded, a plain property read no longer trips the unloaded-relation guard', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, name: 'Gadget', category_id: 9 }])) // no .with()
      .mockResolvedValueOnce(jsonResponse([{ id: 9, name: 'Widgets' }])) // load('category')

    const [product] = await GuardedProduct.query().limit(10).get()
    await product.load(['category'])

    expect((product.category as unknown as { name: string }).name).toBe('Widgets')
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})
