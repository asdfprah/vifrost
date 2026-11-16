/**
 * Decorates an existing array with a non-enumerable `.total`, in place, and returns the same
 * reference: what every page a collection endpoint answers becomes, whether its items are
 * records or dataset rows.
 *
 * @param {T[]} items
 * @param {number} total how many items match across pages
 * @returns {T[] & { total: number }}
 */
export function withTotal<T>(items: T[], total: number): T[] & { total: number } {
  Object.defineProperty(items, 'total', {
    value: total,
    enumerable: false,
  })
  return items as T[] & { total: number }
}

/**
 * Reads `X-Total-Count` off a collection response's headers — how many items match the request
 * in total, independent of how many this page returned. Falls back to the page size itself if
 * the header is missing (an older backend, or a response mocked without it in a test), so
 * `.total` is always a valid number rather than `NaN`.
 *
 * @param {Headers} headers
 * @param {number} pageSize
 * @returns {number}
 */
export function readTotalCount(headers: Headers, pageSize: number): number {
  return Number(headers.get('X-Total-Count') ?? pageSize)
}
