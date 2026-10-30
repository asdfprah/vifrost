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
 * `X-Total-Count` the server reported for the query (see
 * `ModelCollection.total` in `@vifrost/client`), for building a pager
 * without reaching into `data.value.total` by hand. It goes down when the
 * `Registry` reports a row of the list deleted, and follows every refresh.
 */
export interface QueryResource<T> extends AsyncResource<T[]> {
  total: Ref<number>
}
