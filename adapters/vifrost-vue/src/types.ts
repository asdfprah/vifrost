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

/**
 * What {@link useDataset} returns — {@link AsyncResource} of the dataset's rows, plus `total`,
 * the number of rows the dataset has across pages.
 */
export interface DatasetResource<Row> extends AsyncResource<ReadonlyArray<Readonly<Row>>> {
  total: Ref<number>
}

/** The state every watched query or dataset reports. */
export interface WatchedSnapshot<Rows> {
  rows: Rows
  total: number
  error: unknown
  isLoading: boolean
}

/** What `useWatched` exposes: the refs behind {@link QueryResource} and {@link DatasetResource}. */
export interface WatchedResource<Rows> {
  data: Ref<Rows>
  error: Ref<unknown>
  isLoading: Ref<boolean>
  total: Ref<number>
  refetch: () => Promise<void>
}
