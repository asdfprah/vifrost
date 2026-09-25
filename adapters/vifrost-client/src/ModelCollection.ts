/**
 * What every collection-returning fetch (`Model.all()`, `QueryBuilder.get()`,
 * a to-many relation loader) resolves to: a real array — `instanceof Array`,
 * `.map()`/`.length`/spread/`JSON.stringify` all behave exactly like `T[]` —
 * with one extra non-enumerable property carrying the total row count the server reports via
 * the `X-Total-Count` response header (see Controller.stub on the Laravel
 * side), independent of how many rows this particular page actually returned.
 */
export type ModelCollection<T> = T[] & { total: number }

/**
 * Decorates an existing array with `.total`, in place, and returns the same
 * reference typed as a {@link ModelCollection}.
 */
export function toModelCollection<T>(items: T[], total: number): ModelCollection<T> {
  Object.defineProperty(items, 'total', {
    value: total,
    enumerable: false,
  })
  return items as ModelCollection<T>
}
