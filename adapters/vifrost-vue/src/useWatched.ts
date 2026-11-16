import type { WatchHandle } from '@vifrost/client'
import { onScopeDispose, ref, watchEffect } from 'vue'
import type { Ref } from 'vue'
import type { WatchedResource, WatchedSnapshot } from './types.js'

/**
 * Watches what a cache hands out for the current source, following it into refs, and switches
 * to a new handle whenever a reactive dependency of `open` changes, releasing the previous one
 * and the last one when the scope is disposed.
 *
 * @param {() => WatchHandle<WatchedSnapshot<Rows>>} open starts watching the current source
 * @param {Ref<Rows>} data the ref the rows are written to
 * @returns {WatchedResource<Rows>}
 */
export function useWatched<Rows>(open: () => WatchHandle<WatchedSnapshot<Rows>>, data: Ref<Rows>): WatchedResource<Rows> {
  const error = ref<unknown>(null)
  const isLoading = ref(false)
  const total = ref(0)

  let handle: WatchHandle<WatchedSnapshot<Rows>> | null = null
  let unsubscribe: (() => void) | null = null

  /**
   * @param {WatchedSnapshot<Rows>} snapshot
   * @returns {void}
   */
  function apply(snapshot: WatchedSnapshot<Rows>): void {
    data.value = snapshot.rows
    error.value = snapshot.error
    isLoading.value = snapshot.isLoading
    total.value = snapshot.total
  }

  /**
   * Stops watching the current source.
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
    const next = open()
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
