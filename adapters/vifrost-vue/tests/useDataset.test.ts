import { Dataset, Model, Registry, configure, resetClient } from '@vifrost/client'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataset } from '../src/useDataset.js'

class Order extends Model {
  static resource = 'order'
  static datasetMaxLimit = 10
  declare static readonly datasetShape: {
    columns: { status: string }
    joins: {}
    has: {}
    aggregates: 'count'
  }
}

/**
 * @param {unknown} body
 * @returns {Response}
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'X-Total-Count': '1' } })
}

let fetchMock: ReturnType<typeof vi.fn>
let scope: ReturnType<typeof effectScope>
let registry: Registry

beforeEach(() => {
  fetchMock = vi.fn()
  scope = effectScope()
  registry = new Registry()
  configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry, sync: { debounceMs: 0 } })
})

afterEach(() => {
  scope.stop()
  resetClient()
})

describe('useDataset', () => {
  it('exposes the rows and total, and requests again when the dataset changes', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(jsonResponse([{ status: new URL(url).searchParams.get('where[0][value]'), total: 1 }]))
    )
    const status = ref('done')

    const { data, total, isLoading } = scope.run(() =>
      useDataset(() => Dataset.for(Order).select('status').count('total').where('status', '=', status.value).groupBy('status').limit(10))
    )!

    await vi.waitFor(() => expect(isLoading.value).toBe(false))
    expect(data.value).toEqual([{ status: 'done', total: 1 }])
    expect(total.value).toBe(1)

    status.value = 'open'
    await nextTick()
    await vi.waitFor(() => expect(data.value).toEqual([{ status: 'open', total: 1 }]))
  })

  it('requests again when the Registry reports a record of its model changed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ total: 1 }])).mockResolvedValueOnce(jsonResponse([{ total: 2 }]))

    const { data, isLoading } = scope.run(() => useDataset(Dataset.for(Order).count('total').limit(1)))!
    await vi.waitFor(() => expect(isLoading.value).toBe(false))
    registry.created('order', 3)

    await vi.waitFor(() => expect(data.value).toEqual([{ total: 2 }]))
  })

  it('exposes the error of a dataset without a limit', async () => {
    const { error, isLoading } = scope.run(() => useDataset(Dataset.for(Order).count('total')))!

    await vi.waitFor(() => expect(isLoading.value).toBe(false))
    expect(String(error.value)).toContain('requires a limit')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
