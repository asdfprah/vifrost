import type { Ref } from 'vue'

/** Shape returned by both {@link useModel} and {@link useQuery}. */
export interface AsyncResource<T> {
  data: Ref<T>
  error: Ref<unknown>
  isLoading: Ref<boolean>
  refetch: () => Promise<void>
}

/**
 * What {@link useQuery} returns — {@link AsyncResource} plus `total`, the
 * `X-Total-Count` of the last successful fetch (see
 * `ModelCollection.total` in `@vifrost/client`), for building a pager
 * without reaching into `data.value.total` by hand. Only reflects the last
 * `load()`/`refetch()`: a row a `Registry` subscription splices in/out of
 * `data` afterward (see `useQuery`'s remarks) does not adjust it.
 */
export interface QueryResource<T> extends AsyncResource<T[]> {
  total: Ref<number>
}
