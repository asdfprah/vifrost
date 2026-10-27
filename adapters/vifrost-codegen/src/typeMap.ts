import type { VifrostAttribute, TsTypeName, TypeMapOptions } from './types.js'

/**
 * Default native-database-type-name to TypeScript-type mapping.
 *
 * @remarks
 * Grouped by family exactly like
 * `Vifrost\Laravel\FormRequest\ValidationGenerator::addTypeRule` on the
 * PHP side — the same driver-alias groups, verified empirically against
 * real MySQL/MariaDB/Postgres/SQLite (MySQL/MariaDB's SQL-ish names like
 * `bigint`/`varchar` alongside Postgres's internal aliases like
 * `int8`/`bool`).
 *
 * Less obvious picks:
 * - `bigint`/`int8`/`int4`/`int2` → `"number"`, not `"string"`/`"bigint"`:
 *   Eloquent/Vifrost serialize these as plain JSON numbers over the wire.
 *   Override this if an id can realistically exceed JS's safe integer range
 *   (2^53).
 * - `decimal`/`numeric` → `"string"`: Eloquent's default JSON serialization
 *   of a decimal column (without an explicit `decimal:N` cast) returns a
 *   string to avoid float precision loss — `"9.99"`, not `9.99`.
 * - `json`/`jsonb` → `"unknown"`: the DB schema alone can't say what shape
 *   the JSON actually holds.
 */
export const DEFAULT_TYPE_MAP: Record<string, TsTypeName> = {
  bigint: 'number',
  int: 'number',
  integer: 'number',
  mediumint: 'number',
  smallint: 'number',
  year: 'number',
  int2: 'number',
  int4: 'number',
  int8: 'number',

  boolean: 'boolean',
  bool: 'boolean',

  decimal: 'string',
  numeric: 'string',

  float: 'number',
  double: 'number',
  float4: 'number',
  float8: 'number',

  char: 'string',
  bpchar: 'string',
  varchar: 'string',
  string: 'string',
  text: 'string',
  mediumtext: 'string',
  longtext: 'string',
  enum: 'string',
  set: 'string',
  uuid: 'string',

  date: 'string',
  datetime: 'string',
  timestamp: 'string',
  timestamptz: 'string',
  time: 'string',
  timetz: 'string',

  inet: 'string',
  macaddr: 'string',

  json: 'unknown',
  jsonb: 'unknown',

  binary: 'unknown',
  varbinary: 'unknown',
  blob: 'unknown',
  tinyblob: 'unknown',
  mediumblob: 'unknown',
  longblob: 'unknown',
}

/**
 * Resolves the TS type for a column.
 *
 * @remarks
 * Mirrors `ValidationGenerator`'s `tinyint(1)` vs `tinyint(N)` distinction: a
 * MySQL/MariaDB `tinyint(1)` column is what Laravel's `boolean()` migration
 * helper actually creates under the hood, so it maps to `"boolean"`; a wider
 * `tinyint` is a genuine small integer.
 */
export function resolveTsType(attribute: Pick<VifrostAttribute, 'type' | 'rawType'>, options: TypeMapOptions = {}): TsTypeName {
  const overriddenType = options.overrides?.[attribute.type]
  if (overriddenType) {
    return overriddenType
  }

  const isSingleBitWidth = attribute.rawType.includes('(1)')
  if (attribute.type === 'tinyint' || attribute.type === 'bit') {
    return isSingleBitWidth ? 'boolean' : 'number'
  }

  return DEFAULT_TYPE_MAP[attribute.type] ?? 'unknown'
}
