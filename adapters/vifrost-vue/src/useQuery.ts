import { getRegistry } from '@vifrost/client'
import type { Model, ModelConstructor, QueryBuilder } from '@vifrost/client'
import { onScopeDispose, ref, toValue, watchEffect } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { QueryResource } from './types.js'

/**
 * Reactive wrapper around a {@link QueryBuilder}'s `get()`.
 *
 * @remarks
 * Pass a getter (`() => Category.where('parent_id', props.parentId)`) rather
 * than a plain builder when the query depends on something reactive — same
 * reasoning as {@link useModel}: `setup()` runs once, so only a getter lets
 * Vue re-run the query when a dependency it reads changes.
 *
 * If a `Registry` was passed to `configure()`, each row is already tracked
 * individually by `Model.instantiate()` (the same one `find`/`all` use), so
 * this subscribes to every row in the current result and keeps the array in
 * sync: an "updated" event replaces that row in place, a "deleted" event
 * removes it — no extra network calls beyond the query itself.
 */
export function useQuery<T extends Model>(source: MaybeRefOrGetter<QueryBuilder<T>>): QueryResource<T> {
  const data = ref<T[]>([]) as Ref<T[]>
  const error = ref<unknown>(null)
  const isLoading = ref(false)
  const total = ref(0)

  let unsubscribes: Array<() => void> = []
  let latestRequestId = 0

  function stopSubscriptions(): void {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
    unsubscribes = []
  }

  function subscribeToResults(rows: T[]): void {
    const registry = getRegistry()
    if (!registry) {
      return
    }

    unsubscribes = rows.flatMap((row) => {
      const rowConstructor = row.constructor as ModelConstructor<T>
      const rowId = row[rowConstructor.primaryKey] as string | number | undefined
      if (rowId === undefined || rowId === null) {
        return []
      }

      const unsubscribe = registry.subscribe<T>(rowConstructor.resource, rowId, (event) => {
        const index = data.value.findIndex((item) => item[rowConstructor.primaryKey] === rowId)
        if (index === -1) {
          return
        }
        if (event.type === 'updated') {
          data.value.splice(index, 1, event.value)
        } else {
          data.value.splice(index, 1)
        }
      })
      return [unsubscribe]
    })
  }

  async function load(): Promise<void> {
    const requestId = ++latestRequestId
    stopSubscriptions()

    const builder = toValue(source)
    isLoading.value = true
    error.value = null

    try {
      const rows = await builder.get()
      if (requestId !== latestRequestId) {
        return
      }
      data.value = rows
      total.value = rows.total
      subscribeToResults(rows)
    } catch (caught) {
      if (requestId !== latestRequestId) {
        return
      }
      error.value = caught
      data.value = []
      total.value = 0
    } finally {
      if (requestId === latestRequestId) {
        isLoading.value = false
      }
    }
  }

  watchEffect(() => {
    toValue(source)
    load()
  })

  onScopeDispose(stopSubscriptions)

  return { data, error, isLoading, refetch: load, total }
}
