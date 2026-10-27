/** Mirrors `Vifrost\Laravel\SchemaExporter::foreignFor()` in the Laravel package. */
export interface VifrostForeignKey {
  table: string
  column: string | null
}

/** Mirrors `Vifrost\Laravel\SchemaExporter::attributesFor()` in the Laravel package. */
export interface VifrostAttribute {
  type: string
  rawType: string
  length: number | null
  isNullable: boolean
  isPrimaryKey: boolean
  hasAutoIncrement: boolean
  hasDefaultValue: boolean
  defaultValue: unknown
  isForeign: boolean
  foreign: VifrostForeignKey | null
}

/**
 * `type` is the Eloquent relation class basename (`HasMany`, `BelongsTo`,
 * `HasOne`, `BelongsToMany`, `HasOneThrough`, `HasManyThrough`, `MorphOne`,
 * `MorphMany`, `MorphTo`, `MorphToMany`, `MorphedByMany`) — see
 * `Vifrost\Laravel\Relation::getRelationType()`.
 */
export interface VifrostRelation {
  type: string
  related: string | null
  polymorphic: boolean
}

export interface VifrostModelSchema {
  table: string
  /** The key column, the columns of a composite key in URL order, or `null` for a table without a primary key. */
  primaryKey: string | string[] | null
  resource: string
  /**
   * The effective max row count a collection query for this model is allowed to
   * request, from `config('vifrost.max_limit_per_model')` or the global
   * `config('vifrost.max_limit')` — see `Vifrost\Laravel\Pagination::maxLimitFor()`.
   * `null` means the model is exempt from pagination entirely.
   */
  maxLimit: number | null
  attributes: Record<string, VifrostAttribute>
  relations: Record<string, VifrostRelation>
}

export interface VifrostSchema {
  schemaVersion: number
  /** Joins the values of a composite key in URLs — `config('vifrost.composite_key_separator')`. Defaults to `","`. */
  compositeKeySeparator?: string
  models: Record<string, VifrostModelSchema>
}

/** A generated TypeScript type expression, e.g. `"string"`, `"number | null"`. */
export type TsTypeName = string

export interface TypeMapOptions {
  /** Per-native-type-name overrides, merged on top of `DEFAULT_TYPE_MAP`. */
  overrides?: Record<string, TsTypeName>
}

export interface GenerateOptions extends TypeMapOptions {
  /** Import specifier used for the runtime client. Defaults to `"@vifrost/client"`. */
  clientImport?: string
  /** Separator of composite key values, emitted as `static keySeparator` when it is not `","`. */
  keySeparator?: string
  /** Receives a message for each model left out of the generated files. */
  onWarning?: (message: string) => void
}

export interface GeneratedFile {
  fileName: string
  content: string
}

export interface RelationMethod {
  code: string
  /** The related class to import, or `null` if none is generated. */
  importName: string | null
  /**
   * Whether `code` is a real, callable relation-loader method rather than an
   * explanatory comment (MorphTo, a relation outside this generation batch,
   * or an unrecognized relation type) — see `generateRelationMethod`. Feeds
   * `static relations` in the generated class, which `@vifrost/client`'s
   * `Model.instantiate()` uses to warn/error when code reads a relation as
   * data before it's been eager-loaded.
   */
  hasMethod: boolean
}
