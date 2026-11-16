import { getQueryCache } from '@vifrost/client'
import type { Model, QueryBuilder } from '@vifrost/client'
import { ref, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { QueryResource } from './types.js'
import { useWatched } from './useWatched.js'

/**
 * Reactive wrapper around a {@link QueryBuilder}'s `get()`, backed by the
 * client's shared `QueryCache`.
 *
 * @remarks
 * Pass a getter (`() => Category.where('parent_id', props.parentId)`) rather
 * than a plain builder when the query depends on something reactive — same
 * reasoning as {@link useModel}: `setup()` runs once, so only a getter lets
 * Vue re-run the query when a dependency it reads changes.
 *
 * Components watching the same query share one request. With a `Registry`
 * configured, the query also stays in sync: an updated row is replaced in
 * place, a deleted one is removed and lowers `total`, and every record the
 * Registry reports created, updated or deleted (saved or deleted locally, or
 * reported through `events` from `@vifrost/client`) refreshes the lists of its
 * resource, which is how a new record enters a list and a changed one leaves
 * or moves.
 *
 * @param {MaybeRefOrGetter<QueryBuilder<T>>} source the query, or a getter returning it
 * @returns {QueryResource<T>}
 */
export function useQuery<T extends Model>(source: MaybeRefOrGetter<QueryBuilder<T>>): QueryResource<T> {
  return useWatched(() => getQueryCache().watch(toValue(source)), ref<T[]>([]) as Ref<T[]>)
}
