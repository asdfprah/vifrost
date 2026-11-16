import { getDatasetCache } from '@vifrost/client'
import type { DatasetBuilder } from '@vifrost/client'
import { shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { DatasetResource } from './types.js'
import { useWatched } from './useWatched.js'

/**
 * Reactive wrapper around a {@link DatasetBuilder}'s `get()`, backed by the client's shared
 * `DatasetCache`.
 *
 * @remarks
 * Pass a getter (`() => Dataset.for(Order).where('status', '=', status.value)...`) when
 * the dataset depends on something reactive, so it is requested again when that changes; the
 * request it replaces is cancelled. Components watching the same dataset share one request.
 * With a `Registry` configured, the dataset is requested again whenever a record of its model,
 * or of a relation it joins or filters by, is reported created, updated or deleted.
 *
 * @param {MaybeRefOrGetter<DatasetBuilder<any, any, any, Row>>} source the dataset, or a getter returning it
 * @returns {DatasetResource<Row>}
 */
export function useDataset<Row extends object>(
  source: MaybeRefOrGetter<DatasetBuilder<any, any, any, Row>>
): DatasetResource<Row> {
  return useWatched(
    () => getDatasetCache().watch(toValue(source)),
    shallowRef<ReadonlyArray<Readonly<Row>>>([]) as Ref<ReadonlyArray<Readonly<Row>>>
  )
}
