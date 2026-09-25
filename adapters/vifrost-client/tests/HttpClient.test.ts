import { describe, expect, it, vi } from 'vitest'
import { HttpClient } from '../src/HttpClient.js'
import { HttpError } from '../src/HttpError.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('HttpClient', () => {
  it('joins the base URL and path, stripping duplicate slashes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = new HttpClient({ baseUrl: 'https://api.test/', fetch: fetchMock })

    await client.get('/product/1')

    expect(fetchMock).toHaveBeenCalledWith('https://api.test/product/1', expect.any(Object))
  })

  it('sends Accept/Content-Type JSON headers by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    const client = new HttpClient({ baseUrl: 'https://api.test', fetch: fetchMock })

    await client.get('product')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
  })

  it('resolves { body, headers } — never a bare body — so headers are always reachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { 'content-type': 'application/json', 'X-Total-Count': '21' },
      })
    )
    const client = new HttpClient({ baseUrl: 'https://api.test', fetch: fetchMock })

    const { body, headers } = await client.get<{ id: number }[]>('product')

    expect(body).toEqual([{ id: 1 }])
    expect(headers.get('X-Total-Count')).toBe('21')
  })

  it('parses a JSON response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, name: 'Gadget' }))
    const client = new HttpClient({ baseUrl: 'https://api.test', fetch: fetchMock })

    const { body } = await client.get<{ id: number; name: string }>('product/1')

    expect(body).toEqual({ id: 1, name: 'Gadget' })
  })

  it('throws HttpError with the status and parsed body on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ message: 'The name field is required.', errors: { name: ['required'] } }, 422)
    )
    const client = new HttpClient({ baseUrl: 'https://api.test', fetch: fetchMock })

    await expect(client.post('product', {})).rejects.toMatchObject({
      status: 422,
      body: { message: 'The name field is required.', errors: { name: ['required'] } },
    })
  })

  it('is an instance of HttpError specifically, not a generic Error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404))
    const client = new HttpClient({ baseUrl: 'https://api.test', fetch: fetchMock })

    await expect(client.get('product/999')).rejects.toBeInstanceOf(HttpError)
  })

  it('serializes the request body as JSON for post/put', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }))
    const client = new HttpClient({ baseUrl: 'https://api.test', fetch: fetchMock })

    await client.post('product', { name: 'Gadget' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'Gadget' }))
  })

  it('calls the default globalThis.fetch bound to globalThis, not detached', async () => {
    const original = globalThis.fetch
    globalThis.fetch = function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("'fetch' called on an object that does not implement interface Window.")
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    } as typeof fetch

    try {
      const client = new HttpClient({ baseUrl: 'https://api.test' })
      await expect(client.get('product')).resolves.toMatchObject({ body: { ok: true } })
    } finally {
      globalThis.fetch = original
    }
  })

  it('throws if no fetch implementation is available anywhere', () => {
    const original = globalThis.fetch
    // @ts-expect-error deliberately removing it to test the guard
    delete globalThis.fetch

    try {
      expect(() => new HttpClient({ baseUrl: 'https://api.test' })).toThrow(/No fetch implementation/)
    } finally {
      globalThis.fetch = original
    }
  })
})
