import { HttpError } from './HttpError.js'
import type { HttpClientOptions, HttpResponse } from './types.js'

/**
 * Thin fetch wrapper shared by every {@link Model} request.
 *
 * @remarks
 * Depends only on the native `fetch`, available in every runtime this
 * package targets (browsers, Node 18+), so the package itself ships with
 * zero runtime dependencies.
 */
export class HttpClient {
  private readonly baseUrl: string
  private readonly defaultHeaders: Record<string, string>
  private readonly fetchImplementation: typeof fetch

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.defaultHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    }

    const fetchImplementation = options.fetch ?? globalThis.fetch?.bind(globalThis)
    if (!fetchImplementation) {
      throw new Error('No fetch implementation available. Pass one via HttpClientOptions.fetch.')
    }
    this.fetchImplementation = fetchImplementation
  }

  async request<ResponseBody>(path: string, init: RequestInit = {}): Promise<HttpResponse<ResponseBody>> {
    const isAbsoluteUrl = /^https?:\/\//.test(path)
    const url = isAbsoluteUrl ? path : `${this.baseUrl}/${path.replace(/^\/+/, '')}`

    const response = await this.fetchImplementation(url, {
      ...init,
      headers: { ...this.defaultHeaders, ...(init.headers as Record<string, string> | undefined) },
    })

    const isJsonResponse = response.headers.get('content-type')?.includes('application/json') ?? false
    const responseBody = isJsonResponse ? await response.json().catch(() => null) : await response.text()

    if (!response.ok) {
      throw new HttpError(response.status, responseBody)
    }

    return { body: responseBody as ResponseBody, headers: response.headers }
  }

  get<ResponseBody>(path: string): Promise<HttpResponse<ResponseBody>> {
    return this.request<ResponseBody>(path, { method: 'GET' })
  }

  post<ResponseBody>(path: string, requestBody?: unknown): Promise<HttpResponse<ResponseBody>> {
    return this.request<ResponseBody>(path, { method: 'POST', body: JSON.stringify(requestBody ?? {}) })
  }

  put<ResponseBody>(path: string, requestBody?: unknown): Promise<HttpResponse<ResponseBody>> {
    return this.request<ResponseBody>(path, { method: 'PUT', body: JSON.stringify(requestBody ?? {}) })
  }

  delete<ResponseBody>(path: string): Promise<HttpResponse<ResponseBody>> {
    return this.request<ResponseBody>(path, { method: 'DELETE' })
  }
}
