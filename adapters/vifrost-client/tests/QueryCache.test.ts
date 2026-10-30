import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, getQueryCache, resetClient } from '../src/config.js'
import { Model } from '../src/Model.js'
import { events } from '../src/events.js'
import { Registry } from '../src/Registry.js'
import type { ConfigureOptions } from '../src/types.js'

class Ticket extends Model {
  static resource = 'ticket'
  declare id: number
  declare title: string
}

class Board extends Model {
  static resource = 'board'
  declare id: number
}

type Handler = (url: string, init: RequestInit) => Response

let fetchMock: ReturnType<typeof vi.fn>
let registry: Registry

/**
 * @param {unknown} body
 * @param {number} [total] value of the X-Total-Count header
 * @param {number} [status]
 * @returns {Response}
 */
function json(body: unknown, total?: number, status = 200): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (total !== undefined) {
    headers['X-Total-Count'] = String(total)
  }
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * Routes every request to the handler.
 *
 * @param {Handler} handler
 */
function respondWith(handler: Handler): void {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => handler(url, init))
}

/**
 * @param {string} method
 * @returns {Array<[string, RequestInit]>} the requests made with that method
 */
function requests(method: string): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([, init]) => init.method === method)
}

/**
 * @param {Partial<ConfigureOptions>} options
 */
function setup(options: Partial<ConfigureOptions> = {}): void {
  configure({ baseUrl: 'https://api.test', fetch: fetchMock as unknown as typeof fetch, registry, ...options })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  registry = new Registry()
})

afterEach(() => {
  resetClient()
  vi.useRealTimers()
})

describe('QueryCache.watch', () => {
  beforeEach(() => setup())

  it('shares one request between watchers of the same query, and drops it once all release', async () => {
    respondWith(() => json([{ id: 1, title: 'a' }], 1))

    const first = getQueryCache().watch(Ticket.query().limit(10))
    const second = getQueryCache().watch(Ticket.query().limit(10))
    await vi.waitFor(() => expect(first.snapshot().isLoading).toBe(false))

    expect(requests('GET')).toHaveLength(1)
    expect(second.snapshot().rows.map((row) => row.title)).toEqual(['a'])

    first.release()
    second.release()
    getQueryCache().watch(Ticket.query().limit(10))

    expect(requests('GET')).toHaveLength(2)
  })

  it('notifies subscribers with each new snapshot', async () => {
    respondWith(() => json([{ id: 1, title: 'a' }], 7))
    const handle = getQueryCache().watch(Ticket.query().limit(1))
    const listener = vi.fn()
    handle.subscribe(listener)

    await vi.waitFor(() => expect(handle.snapshot().isLoading).toBe(false))

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ total: 7, isLoading: false }))
  })

  it('removes a row the Registry reports deleted, lowers total and refills a paginated page', async () => {
    respondWith(() => json([{ id: 1, title: 'a' }, { id: 2, title: 'b' }], 3))
    const handle = getQueryCache().watch(Ticket.query().limit(2))
    await vi.waitFor(() => expect(handle.snapshot().isLoading).toBe(false))

    registry.remove('ticket', 1)

    expect(handle.snapshot().rows.map((row) => row.id)).toEqual([2])
    expect(handle.snapshot().total).toBe(2)

    await vi.runAllTimersAsync()
    expect(requests('GET')).toHaveLength(2)
  })
})

describe('refreshing lists without a sync endpoint', () => {
  beforeEach(() => setup())

  it('refetches each watched list of the resource once per burst of events', async () => {
    respondWith((url) => (url.includes('/board') ? json([], 0) : json([{ id: 1, title: 'a' }], 1)))
    getQueryCache().watch(Ticket.query().limit(10))
    getQueryCache().watch(Ticket.query().where('title', 'a').limit(10))
    getQueryCache().watch(Board.query().limit(10))
    getQueryCache().watch(Ticket.query().whereId(1))
    await vi.runAllTimersAsync()
    fetchMock.mockClear()

    events.created(Ticket, 2)
    events.created(Ticket, 3)
    events.deleted(Ticket, 4)
    await vi.runAllTimersAsync()

    expect(requests('GET').map(([url]) => url).sort()).toEqual([
      'https://api.test/ticket?filter%5Btitle%5D=a&limit=10',
      'https://api.test/ticket?limit=10',
    ])
  })

  it('refreshes the lists of a resource after a local save', async () => {
    respondWith((_url, init) => (init.method === 'POST' ? json({ id: 9, title: 'new' }) : json([], 0)))
    getQueryCache().watch(Ticket.query().limit(10))
    await vi.runAllTimersAsync()
    fetchMock.mockClear()

    await new Ticket({ title: 'new' }).save()
    await vi.runAllTimersAsync()

    expect(requests('GET')).toHaveLength(1)
  })
})

describe('refreshing lists through the sync endpoint', () => {
  beforeEach(() => setup({ sync: { path: '_vifrost/sync', maxQueries: 2 } }))

  it('sends every watched list in one request and applies the page it returns', async () => {
    respondWith((url, init) => {
      if (init.method === 'POST') {
        return json({ results: [{ status: 200, ids: [3, 1], total: 9, rows: [{ id: 3, title: 'c' }] }] })
      }
      return json([{ id: 1, title: 'a' }, { id: 2, title: 'b' }], 8)
    })
    const handle = getQueryCache().watch(Ticket.query().limit(2))
    await vi.runAllTimersAsync()
    const heldRow = handle.snapshot().rows[0]

    events.created(Ticket, 3)
    await vi.runAllTimersAsync()

    const [url, init] = requests('POST')[0]
    expect(url).toBe('https://api.test/_vifrost/sync')
    expect(JSON.parse(init.body as string)).toEqual({ queries: [{ path: 'ticket?limit=2', known: [1, 2] }] })
    expect(handle.snapshot().rows.map((row) => row.title)).toEqual(['c', 'a'])
    expect(handle.snapshot().rows[1]).toBe(heldRow)
    expect(handle.snapshot().total).toBe(9)
    expect(requests('GET')).toHaveLength(1)
  })

  it('splits the lists into requests of at most maxQueries', async () => {
    respondWith((_url, init) => {
      if (init.method === 'POST') {
        const { queries } = JSON.parse(init.body as string)
        return json({ results: queries.map(() => ({ status: 200, ids: [], total: 0, rows: [] })) })
      }
      return json([], 0)
    })
    for (const limit of [1, 2, 3]) {
      getQueryCache().watch(Ticket.query().limit(limit))
    }
    await vi.runAllTimersAsync()

    events.created(Ticket, 1)
    await vi.runAllTimersAsync()

    expect(requests('POST')).toHaveLength(2)
  })

  it('refetches a list the endpoint cannot sync', async () => {
    respondWith((_url, init) => (init.method === 'POST' ? json({ results: [{ status: 501 }] }) : json([], 0)))
    getQueryCache().watch(Ticket.query().limit(2))
    await vi.runAllTimersAsync()
    fetchMock.mockClear()

    events.created(Ticket, 1)
    await vi.runAllTimersAsync()

    expect(requests('GET')).toHaveLength(1)
  })

  it('falls back to refetching for good when the endpoint does not exist', async () => {
    respondWith((_url, init) => (init.method === 'POST' ? json({ message: 'Not Found' }, undefined, 404) : json([], 0)))
    getQueryCache().watch(Ticket.query().limit(2))
    await vi.runAllTimersAsync()

    events.created(Ticket, 1)
    await vi.runAllTimersAsync()
    events.created(Ticket, 2)
    await vi.runAllTimersAsync()

    expect(requests('POST')).toHaveLength(1)
    expect(requests('GET')).toHaveLength(3)
  })

  it('re-fetches an updated tracked record once, then syncs the lists of its resource', async () => {
    respondWith((url, init) => {
      if (init.method === 'POST') {
        return json({ results: [{ status: 200, ids: [1], total: 1, rows: [] }] })
      }
      return url.includes('/ticket/5') ? json({ id: 5, title: 'fresh' }) : json([{ id: 1, title: 'a' }], 1)
    })
    getQueryCache().watch(Ticket.query().limit(2))
    await Ticket.find(5)
    await vi.runAllTimersAsync()
    fetchMock.mockClear()

    await events.updated(Ticket, 5)
    await vi.runAllTimersAsync()

    expect(requests('GET').map(([url]) => url)).toEqual(['https://api.test/ticket/5'])
    expect(requests('POST')).toHaveLength(1)
  })
})

describe('events.updated without watched lists', () => {
  beforeEach(() => setup())

  it('re-fetches the record through the Registry right away', async () => {
    respondWith(() => json({ id: 5, title: 'a' }))
    await Ticket.find(5)
    fetchMock.mockClear()

    events.updated(Ticket, 5)
    await vi.runAllTimersAsync()

    expect(requests('GET').map(([url]) => url)).toEqual(['https://api.test/ticket/5'])
  })
})

describe('without a Registry', () => {
  beforeEach(() => setup({ registry: undefined }))

  it('still shares requests, but does not refresh lists on record changes', async () => {
    respondWith((_url, init) => (init.method === 'POST' ? json({ id: 9, title: 'new' }) : json([], 0)))
    getQueryCache().watch(Ticket.query().limit(10))
    getQueryCache().watch(Ticket.query().limit(10))
    await vi.runAllTimersAsync()

    await new Ticket({ title: 'new' }).save()
    events.created(Ticket, 10)
    await vi.runAllTimersAsync()

    expect(requests('GET')).toHaveLength(1)
  })
})

describe('Registry resource events', () => {
  it('publishes every change of a resource to resource listeners, tracked or not', async () => {
    const registry = new Registry()
    const listener = vi.fn()
    registry.subscribeResources(listener)
    registry.track('ticket', 1, { id: 1 }, async () => ({ id: 1 }))

    registry.created('ticket', 2)
    await registry.updated('ticket', 3)
    await registry.resync('ticket', 1)
    registry.remove('ticket', 4)

    expect(listener.mock.calls).toEqual([
      ['ticket', { type: 'created', id: 2 }],
      ['ticket', { type: 'updated', id: 3 }],
      ['ticket', { type: 'updated', id: 1 }],
      ['ticket', { type: 'deleted', id: 4 }],
    ])
  })

  it('does not publish when rows are only fetched again', () => {
    const registry = new Registry()
    const listener = vi.fn()
    registry.subscribeResources(listener)

    registry.track('ticket', 1, { id: 1 }, async () => ({ id: 1 }))
    registry.track('ticket', 1, { id: 1 }, async () => ({ id: 1 }))

    expect(listener).not.toHaveBeenCalled()
  })
})
