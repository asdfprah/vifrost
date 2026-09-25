import { Model, Registry, configure, resetClient } from '@vifrost/client'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuery } from '../src/useQuery.js'

class Product extends Model {
  static resource = 'product'
  declare id: number
  declare name: string
  declare status: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function jsonResponseWithTotal(body: unknown, total: number): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'X-Total-Count': String(total) },
  })
}

let fetchMock: ReturnType<typeof vi.fn>
let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  fetchMock = vi.fn()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  resetClient()
})

describe('useQuery (no registry configured)', () => {
  beforeEach(() => {
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch })
  })

  it('accepts a plain (not-yet-executed) QueryBuilder and fetches its results', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Gadget' }]))

    const { data, isLoading } = scope.run(() => useQuery(Product.query().where('status', 'active')))!

    expect(isLoading.value).toBe(true)
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    expect(data.value).toHaveLength(1)
    expect(data.value[0]).toBeInstanceOf(Product)
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toBe('https://api.test/product?filter[status]=active')
  })

  it('re-runs when passed as a getter reading a reactive ref', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, name: 'Active gadget' }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 2, name: 'Draft gadget' }]))

    const status = ref('active')
    const { data, isLoading } = scope.run(() => useQuery(() => Product.query().where('status', status.value)))!

    await vi.waitFor(() => expect(isLoading.value).toBe(false))
    expect(data.value[0].name).toBe('Active gadget')

    status.value = 'draft'
    await nextTick()
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    expect(data.value[0].name).toBe('Draft gadget')
  })

  it('exposes total from the X-Total-Count response header, for building a pager', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithTotal([{ id: 1, name: 'Gadget' }], 21))

    const { total, isLoading } = scope.run(() => useQuery(Product.query().limit(1)))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    expect(total.value).toBe(21)
  })

  it('falls back total to the page size when X-Total-Count is missing', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }, { id: 2 }]))

    const { total, isLoading } = scope.run(() => useQuery(Product.query()))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    expect(total.value).toBe(2)
  })

  it('resets total to 0 when the query fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponseWithTotal([{ id: 1 }], 5))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))

    const { total, refetch, isLoading } = scope.run(() => useQuery(Product.query()))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))
    expect(total.value).toBe(5)

    await refetch()

    expect(total.value).toBe(0)
  })
})

describe('useQuery (with a configured registry)', () => {
  let registry: Registry

  beforeEach(() => {
    registry = new Registry()
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry })
  })

  it('replaces a row in place when it is updated elsewhere in the app', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, name: 'Gadget' }])) // useQuery's own get()
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Gadget' })) // the test's own find(1)
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Gadget (renamed)' })) // save()'s PUT

    const { data, isLoading } = scope.run(() => useQuery(Product.query()))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))
    expect(data.value[0].name).toBe('Gadget')

    const sameProduct = await Product.find(1)
    sameProduct.name = 'Gadget (renamed)'
    await sameProduct.save()

    await vi.waitFor(() => expect(data.value[0].name).toBe('Gadget (renamed)'))
    expect(data.value).toHaveLength(1)
  })

  it('removes a row when it is deleted elsewhere in the app', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: 1, name: 'Gadget' }, { id: 2, name: 'Gizmo' }]))
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Gadget' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { data, isLoading } = scope.run(() => useQuery(Product.query()))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))
    expect(data.value).toHaveLength(2)

    const sameProduct = await Product.find(1)
    await sameProduct.delete()

    await vi.waitFor(() => expect(data.value).toHaveLength(1))
    expect(data.value[0].id).toBe(2)
  })

  it('unsubscribes every row when the scope is disposed', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: 1, name: 'Gadget' }]))

    const { isLoading } = scope.run(() => useQuery(Product.query()))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    expect(registry.isTracked('product', 1)).toBe(true)
    scope.stop()

    expect(() => registry.track('product', 1, { id: 1, name: 'irrelevant' }, async () => ({ id: 1 }))).not.toThrow()
  })
})
