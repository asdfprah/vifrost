import { Model, Registry, configure, events, resetClient } from '@vifrost/client'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuery } from '../src/useQuery.js'

class Product extends Model {
  static resource = 'product'
  declare id: number
  declare name: string
  declare status: string
}

class StaffMemberRole extends Model {
  static resource = 'staffmemberrole'
  static primaryKey = ['staff_member_id', 'role_id'] as const
  declare staff_member_id: number
  declare role_id: number
  declare level: number
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

describe('useQuery with a composite primary key', () => {
  let registry: Registry

  beforeEach(() => {
    registry = new Registry()
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry })
  })

  it('keeps rows in sync through the registry by their joined key', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { staff_member_id: 5, role_id: 3, level: 1 },
        { staff_member_id: 5, role_id: 4, level: 2 },
      ])
    )

    const { data, isLoading } = scope.run(() => useQuery(StaffMemberRole.query()))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    fetchMock.mockResolvedValue(jsonResponse({ staff_member_id: 5, role_id: 4, level: 9 }))
    await registry.resync('staffmemberrole', '5,4')
    registry.remove('staffmemberrole', '5,3')

    expect(data.value.map((row) => row.level)).toEqual([9])
  })
})

describe('useQuery keeping lists in sync (issues #28 and #29)', () => {
  let registry: Registry

  beforeEach(() => {
    registry = new Registry()
    configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry })
  })

  it('lowers total when the registry removes a row', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithTotal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], 57))
    const { data, total, isLoading } = scope.run(() => useQuery(Product.query().limit(20)))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    registry.remove('product', 1)

    expect(data.value.map((row) => row.id)).toEqual([2])
    expect(total.value).toBe(56)
  })

  it('shows a record created elsewhere once events reports it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponseWithTotal([{ id: 1, name: 'a' }], 1))
    const { data, total, isLoading } = scope.run(() => useQuery(Product.query().limit(20)))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))

    fetchMock.mockResolvedValueOnce(jsonResponseWithTotal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], 2))
    events.created(Product, 2)

    await vi.waitFor(() => expect(data.value.map((row) => row.id)).toEqual([1, 2]))
    expect(total.value).toBe(2)
  })

  it('shares one request between components watching the same query', async () => {
    fetchMock.mockResolvedValue(jsonResponseWithTotal([{ id: 1, name: 'a' }], 1))

    const first = scope.run(() => useQuery(Product.query().limit(5)))!
    const second = scope.run(() => useQuery(Product.query().limit(5)))!
    await vi.waitFor(() => expect(first.isLoading.value).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.data.value.map((row) => row.id)).toEqual([1])
  })
})
