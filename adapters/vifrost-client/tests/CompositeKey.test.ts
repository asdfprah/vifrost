import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, resetClient } from '../src/config.js'
import { Model } from '../src/Model.js'
import { Registry } from '../src/Registry.js'

class StaffMemberRole extends Model {
  static resource = 'staffmemberrole'
  static primaryKey = ['staff_member_id', 'role_id'] as const
  declare staff_member_id: number
  declare role_id: number
  declare level: number
}

class PipeSeparatedRole extends StaffMemberRole {
  static keySeparator = '|'
}

/**
 * @param {unknown} body response body
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
  configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry })
})

afterEach(() => {
  resetClient()
})

describe('composite primary keys', () => {
  it('joins the key values with the separator', () => {
    expect(StaffMemberRole.keyOf({ staff_member_id: 5, role_id: 3 })).toBe('5,3')
    expect(PipeSeparatedRole.keyOf({ staff_member_id: 5, role_id: 3 })).toBe('5|3')
    expect(StaffMemberRole.keyOf({ staff_member_id: 5 })).toBeNull()
  })

  it('URI-encodes each key value', () => {
    expect(StaffMemberRole.keyOf({ staff_member_id: 'a/b', role_id: 3 })).toBe('a%2Fb,3')
  })

  it('find() accepts the key values in column order', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ staff_member_id: 5, role_id: 3, level: 1 }))

    const role = await StaffMemberRole.find([5, 3])

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/staffmemberrole/5,3', expect.any(Object))
    expect(role.level).toBe(1)
    expect(registry.isTracked('staffmemberrole', '5,3')).toBe(true)
  })

  it('whereId() accepts the key values in column order', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ staff_member_id: 5, role_id: 3, level: 1 }))

    await PipeSeparatedRole.query().whereId([5, 3]).first()

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/staffmemberrole/5|3', expect.any(Object))
  })

  it('save() creates a new record even though its key columns are set', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ staff_member_id: 5, role_id: 3, level: 1 }))

    await new StaffMemberRole({ staff_member_id: 5, role_id: 3, level: 1 }).save()

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/staffmemberrole', expect.objectContaining({ method: 'POST' }))
  })

  it('save() updates a fetched record, and a saved one afterwards', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ staff_member_id: 5, role_id: 3, level: 1 }))
    const fetched = await StaffMemberRole.find([5, 3])
    const created = await new StaffMemberRole({ staff_member_id: 5, role_id: 3, level: 1 }).save()
    fetchMock.mockClear()

    fetched.level = 2
    await fetched.save()
    await created.save()

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.test/staffmemberrole/5,3', expect.objectContaining({ method: 'PUT' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.test/staffmemberrole/5,3', expect.objectContaining({ method: 'PUT' }))
  })

  it('delete() uses the joined key and notifies the registry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ staff_member_id: 5, role_id: 3, level: 1 }))
    const role = await StaffMemberRole.find([5, 3])
    const listener = vi.fn()
    registry.subscribe('staffmemberrole', '5,3', listener)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await role.delete()

    expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/staffmemberrole/5,3', expect.objectContaining({ method: 'DELETE' }))
    expect(listener).toHaveBeenCalledWith({ type: 'deleted' })
  })

  it('delete() names every key column when one is missing', async () => {
    await expect(new StaffMemberRole({ staff_member_id: 5 }).delete()).rejects.toThrow('"staff_member_id", "role_id"')
  })
})
