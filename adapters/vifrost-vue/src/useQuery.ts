import { getQueryCache } from '@vifrost/client'
import type { Model, QueryBuilder, QueryHandle, QuerySnapshot } from '@vifrost/client'
import { onScopeDispose, ref, toValue, watchEffect } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { QueryResource } from './types.js'

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
  const data = ref<T[]>([]) as Ref<T[]>
  const error = ref<unknown>(null)
  const isLoading = ref(false)
  const total = ref(0)

  let handle: QueryHandle<T> | null = null
  let unsubscribe: (() => void) | null = null

  /**
   * @param {QuerySnapshot<T>} snapshot
   * @returns {void}
   */
  function apply(snapshot: QuerySnapshot<T>): void {
    data.value = snapshot.rows
    error.value = snapshot.error
    isLoading.value = snapshot.isLoading
    total.value = snapshot.total
  }

  /**
   * Stops watching the current query.
   *
   * @returns {void}
   */
  function stop(): void {
    unsubscribe?.()
    handle?.release()
    unsubscribe = null
    handle = null
  }

  watchEffect(() => {
    const next = getQueryCache().watch(toValue(source))
    stop()
    handle = next
    unsubscribe = next.subscribe(apply)
    apply(next.snapshot())
  })

  onScopeDispose(stop)

  /**
   * @returns {Promise<void>}
   */
  function refetch(): Promise<void> {
    return handle ? handle.refetch() : Promise.resolve()
  }

  return { data, error, isLoading, refetch, total }
}
