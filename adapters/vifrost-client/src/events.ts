import { getRegistry } from './config.js'
import type { ModelConstructor, ModelId } from './types.js'

/**
 * Reports record changes that happened elsewhere (another tab, another user, a real-time
 * broadcast) to the configured {@link Registry}, encoding the id with the model's key the way
 * the Registry tracks it. A no-op without a Registry.
 *
 * @example
 * echo.private('clinic.1.patients')
 *   .listen('.PatientCreated', (event) => events.created(Patient, event.id))
 */
export const events = {
  /**
   * @param {ModelConstructor} model the created record's model class
   * @param {ModelId} id the record's key value, or its composite key values
   * @returns {void}
   */
  created(model: ModelConstructor, id: ModelId): void {
    getRegistry()?.created(model.resource, model.encodeId(id))
  },

  /**
   * @param {ModelConstructor} model the updated record's model class
   * @param {ModelId} id the record's key value, or its composite key values
   * @returns {Promise<void>}
   */
  updated(model: ModelConstructor, id: ModelId): Promise<void> {
    return getRegistry()?.updated(model.resource, model.encodeId(id)) ?? Promise.resolve()
  },

  /**
   * @param {ModelConstructor} model the deleted record's model class
   * @param {ModelId} id the record's key value, or its composite key values
   * @returns {void}
   */
  deleted(model: ModelConstructor, id: ModelId): void {
    getRegistry()?.remove(model.resource, model.encodeId(id))
  },
}
