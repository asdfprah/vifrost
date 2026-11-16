import { withTotal } from './collection.js'
import type { ModelCollection } from './types.js'

/**
 * Decorates an existing array of records with `.total`, in place, and returns the same
 * reference typed as a {@link ModelCollection}.
 *
 * @param {T[]} items
 * @param {number} total
 * @returns {ModelCollection<T>}
 */
export function toModelCollection<T>(items: T[], total: number): ModelCollection<T> {
  return withTotal(items, total)
}
