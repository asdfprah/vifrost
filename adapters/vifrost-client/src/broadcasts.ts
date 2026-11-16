import { events } from './events.js'
import type { BroadcastModels, ModelBroadcastChannel, ModelConstructor, ModelId } from './types.js'

const MODEL_EVENT = /^(.+)(Created|Updated|Deleted|Trashed|Restored)$/

/**
 * Reports one Eloquent model broadcast to the Registry through {@link events}: `Created` as a
 * created record, `Updated` and `Restored` as updated ones, `Deleted` and `Trashed` as deleted
 * ones. It reads the event name Eloquent gives model broadcasts (`ProductUpdated`, or
 * `.ProductUpdated` as Echo passes it) and the key the Laravel trait `BroadcastsVifrostEvents`
 * sends (`{ model: { id } }`, or every column of a composite key).
 *
 * @param {string} eventName
 * @param {unknown} payload
 * @param {BroadcastModels} models
 * @returns {boolean} whether the broadcast was a model event of one of the models
 */
export function handleModelBroadcast(eventName: string, payload: unknown, models: BroadcastModels): boolean {
  const name = eventName.split(/[.\\]/).pop() ?? ''
  const match = MODEL_EVENT.exec(name)
  if (!match) {
    return false
  }

  const model = findModel(models, match[1])
  const attributes = (payload as { model?: unknown } | null)?.model
  if (!model || typeof attributes !== 'object' || attributes === null) {
    return false
  }

  const id = keyOf(model, attributes as Record<string, unknown>)
  if (id === null) {
    return false
  }

  switch (match[2]) {
    case 'Created':
      events.created(model, id)
      break
    case 'Updated':
    case 'Restored':
      void events.updated(model, id)
      break
    default:
      events.deleted(model, id)
  }
  return true
}

/**
 * Listens to every event of a channel and reports the model broadcasts among them, e.g.
 * `listenToModelBroadcasts(Echo.private(`store.${storeId}`), models)`.
 *
 * @param {C} channel
 * @param {BroadcastModels} models
 * @returns {C} the channel, to keep chaining on it
 */
export function listenToModelBroadcasts<C extends ModelBroadcastChannel>(channel: C, models: BroadcastModels): C {
  channel.listenToAll((event, data) => {
    handleModelBroadcast(event, data, models)
  })
  return channel
}

/**
 * @param {BroadcastModels} models
 * @param {string} className
 * @returns {ModelConstructor | undefined}
 */
function findModel(models: BroadcastModels, className: string): ModelConstructor | undefined {
  const candidate = Array.isArray(models) ? models.find((model) => model.name === className) : models[className]
  return isModel(candidate) ? candidate : undefined
}

/**
 * @param {unknown} candidate
 * @returns {boolean} whether the value is a model class
 */
function isModel(candidate: unknown): candidate is ModelConstructor {
  return typeof candidate === 'function' && typeof (candidate as Partial<ModelConstructor>).resource === 'string'
}

/**
 * The key of a broadcast record: its value, or the values of a composite key in column order.
 *
 * @param {ModelConstructor} model
 * @param {Record<string, unknown>} attributes
 * @returns {ModelId | null}
 */
function keyOf(model: ModelConstructor, attributes: Record<string, unknown>): ModelId | null {
  const columns = typeof model.primaryKey === 'string' ? [model.primaryKey] : [...model.primaryKey]
  const values = columns.map((column) => attributes[column])
  if (values.some((value) => typeof value !== 'string' && typeof value !== 'number')) {
    return null
  }
  return typeof model.primaryKey === 'string' ? (values[0] as string | number) : (values as Array<string | number>)
}
