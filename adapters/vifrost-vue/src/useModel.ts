import type { Model, ModelConstructor, ModelId } from '@vifrost/client'
import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { AsyncResource } from './types.js'
import { useQuery } from './useQuery.js'

/**
 * Reactive wrapper around `modelClass.find(id)`, built on {@link useQuery}.
 *
 * @remarks
 * `modelClass.query().whereId(id)` resolves through the exact same dedicated
 * `GET {resource}/{id}` endpoint `find()` uses (see `QueryBuilder.whereId`),
 * wrapped in a single-element array by `QueryBuilder.get()` — so this reuses
 * `useQuery`'s fetching, race-condition guarding, and per-row `Registry`
 * subscription as-is instead of duplicating them for a single record.
 */
export function useModel<T extends Model>(
  modelClass: ModelConstructor<T>,
  id: MaybeRefOrGetter<ModelId>
): AsyncResource<T | null> {
  const { data: rows, error, isLoading, refetch } = useQuery(() => modelClass.query().whereId(toValue(id)))

  const data = computed(() => rows.value[0] ?? null)

  return { data, error, isLoading, refetch }
}
