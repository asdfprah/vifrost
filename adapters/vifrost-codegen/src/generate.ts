import { resolveTsType } from './typeMap.js'
import type {
  VifrostAttribute,
  VifrostDatasetColumn,
  VifrostDatasetHas,
  VifrostDatasetSchema,
  VifrostModelSchema,
  VifrostRelation,
  VifrostSchema,
  GenerateOptions,
  GeneratedFile,
  RelationMethod,
} from './types.js'

/** Eloquent relation class basenames that resolve to a single related record. */
const TO_ONE_RELATION_TYPES = new Set(['HasOne', 'BelongsTo', 'MorphOne', 'HasOneThrough'])

/** Eloquent relation class basenames that resolve to a collection. */
const TO_MANY_RELATION_TYPES = new Set([
  'HasMany',
  'BelongsToMany',
  'HasManyThrough',
  'MorphMany',
  'MorphToMany',
  'MorphedByMany',
])

function shortClassName(fullyQualifiedClassName: string): string {
  const namespaceSegments = fullyQualifiedClassName.replace(/^\\/, '').split('\\')
  return namespaceSegments[namespaceSegments.length - 1]
}

function tsPropertyType(attribute: VifrostAttribute, options: GenerateOptions): string {
  const tsType = resolveTsType(attribute, options)
  return attribute.isNullable ? `${tsType} | null` : tsType
}

function generateAttributesBlock(modelSchema: VifrostModelSchema, options: GenerateOptions): string {
  return Object.entries(modelSchema.attributes)
    .map(([columnName, attribute]) => `  declare ${columnName}: ${tsPropertyType(attribute, options)};`)
    .join('\n')
}

/**
 * @remarks
 * A relation whose related model isn't part of this generation batch (e.g.
 * `Illuminate\Notifications\DatabaseNotification`, a framework model
 * `Vifrost::models()` never discovers as an app model) is left ungenerated
 * rather than emitting an import for a file that will never exist.
 */
function generateRelationMethod(
  relationName: string,
  relation: VifrostRelation,
  currentModelFqcn: string,
  generatedModelFqcns: Set<string>
): RelationMethod {
  if (relation.polymorphic || relation.related === null) {
    return {
      code:
        `  // "${relationName}" is a MorphTo relation: it has no single fixed related model\n` +
        `  // (Eloquent resolves it per-row from a "*_type" column), so it isn't generated here.\n` +
        `  // Call this.toOne(${JSON.stringify(relationName)}, SomeModel) yourself once you know\n` +
        `  // the concrete type for a given row.`,
      importName: null,
      hasMethod: false,
    }
  }

  if (!generatedModelFqcns.has(relation.related)) {
    return {
      code:
        `  // "${relationName}" relates to ${relation.related}, which isn't part of this\n` +
        `  // generated batch, so it can't be safely imported. Call\n` +
        `  // this.${TO_MANY_RELATION_TYPES.has(relation.type) ? 'toMany' : 'toOne'}(${JSON.stringify(relationName)}, SomeModel) yourself.`,
      importName: null,
      hasMethod: false,
    }
  }

  const relatedClassName = shortClassName(relation.related)
  const isSelfReferential = relation.related === currentModelFqcn
  const importName = isSelfReferential ? null : relatedClassName

  if (TO_MANY_RELATION_TYPES.has(relation.type)) {
    return {
      code:
        `  ${relationName}(): Promise<${relatedClassName}[]> {\n` +
        `    return this.toMany(${JSON.stringify(relationName)}, ${relatedClassName});\n` +
        `  }`,
      importName,
      hasMethod: true,
    }
  }

  if (TO_ONE_RELATION_TYPES.has(relation.type)) {
    return {
      code:
        `  ${relationName}(): Promise<${relatedClassName} | null> {\n` +
        `    return this.toOne(${JSON.stringify(relationName)}, ${relatedClassName});\n` +
        `  }`,
      importName,
      hasMethod: true,
    }
  }

  return {
    code:
      `  // "${relationName}" has an unrecognized relation type (${relation.type}); skipped.\n` +
      `  // Call this.toOne(...) or this.toMany(...) yourself with the right related model.`,
    importName: null,
    hasMethod: false,
  }
}

/**
 * Emits the `static primaryKey` line, plus `static keySeparator` for a composite key with a custom separator.
 *
 * @param {string | string[]} primaryKey the key column, or the columns of a composite key
 * @param {string} keySeparator separator of composite key values
 * @returns {string}
 */
function generatePrimaryKeyLines(primaryKey: string | string[], keySeparator: string): string {
  if (typeof primaryKey === 'string') {
    return `  static primaryKey = ${JSON.stringify(primaryKey)};\n`
  }
  const separatorLine = keySeparator === ',' ? '' : `  static keySeparator = ${JSON.stringify(keySeparator)};\n`
  return `  static primaryKey = ${JSON.stringify(primaryKey)} as const;\n` + separatorLine
}

/**
 * A property name as it can appear in a type literal, quoted when it is not an identifier.
 *
 * @param {string} name
 * @returns {string}
 */
function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

/**
 * The type literal of the columns a dataset may use, e.g. `{ status: string; total: number | null }`.
 *
 * @param {Record<string, VifrostDatasetColumn>} columns
 * @param {GenerateOptions} options
 * @returns {string}
 */
function datasetColumnsType(columns: Record<string, VifrostDatasetColumn>, options: GenerateOptions): string {
  const entries = Object.entries(columns).map(([name, column]) => {
    const tsType = resolveTsType(column, options)
    return `${propertyName(name)}: ${column.isNullable ? `${tsType} | null` : tsType}`
  })
  return entries.length === 0 ? '{}' : `{ ${entries.join('; ')} }`
}

/**
 * The type literal of the has levels of a dataset, each with its columns and the levels below.
 *
 * @param {Record<string, VifrostDatasetHas>} has
 * @param {GenerateOptions} options
 * @param {string} indent
 * @returns {string}
 */
function datasetHasType(has: Record<string, VifrostDatasetHas>, options: GenerateOptions, indent: string): string {
  const entries = Object.entries(has)
  if (entries.length === 0) {
    return '{}'
  }
  const inner = `${indent}  `
  const lines = entries.map(
    ([name, level]) =>
      `${inner}${propertyName(name)}: {\n` +
      `${inner}  columns: ${datasetColumnsType(level.columns, options)};\n` +
      `${inner}  has: ${datasetHasType(level.has, options, `${inner}  `)};\n` +
      `${inner}};`
  )
  return `{\n${lines.join('\n')}\n${indent}}`
}

/**
 * The `{Model}DatasetShape` interface `Dataset.for()` types a model's datasets with.
 *
 * @param {string} className
 * @param {VifrostDatasetSchema} dataset
 * @param {GenerateOptions} options
 * @returns {string}
 */
function generateDatasetShape(className: string, dataset: VifrostDatasetSchema, options: GenerateOptions): string {
  const joins = Object.entries(dataset.joins).map(
    ([name, join]) => `    ${propertyName(name)}: { columns: ${datasetColumnsType(join.columns, options)} };`
  )
  const aggregates = dataset.aggregates.length === 0 ? 'never' : dataset.aggregates.map((name) => JSON.stringify(name)).join(' | ')

  return (
    `/** What the datasets of ${className} allow, as its controller's query() declares it. */\n` +
    `export interface ${className}DatasetShape {\n` +
    `  columns: ${datasetColumnsType(dataset.columns, options)};\n` +
    `  joins: ${joins.length === 0 ? '{}' : `{\n${joins.join('\n')}\n  }`};\n` +
    `  has: ${datasetHasType(dataset.has, options, '  ')};\n` +
    `  aggregates: ${aggregates};\n` +
    `}\n\n`
  )
}

/**
 * The resources of the relations a dataset may join or filter by, by relation path, so a
 * watched dataset refreshes when their records change.
 *
 * @param {VifrostDatasetSchema} dataset
 * @param {Record<string, string>} resources resource names by model FQCN
 * @returns {Record<string, string>}
 */
function datasetResources(dataset: VifrostDatasetSchema, resources: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, join] of Object.entries(dataset.joins)) {
    if (resources[join.model]) {
      result[name] = resources[join.model]
    }
  }
  const visit = (has: Record<string, VifrostDatasetHas>, prefix: string): void => {
    for (const [name, level] of Object.entries(has)) {
      const path = prefix === '' ? name : `${prefix}.${name}`
      if (resources[level.model]) {
        result[path] = resources[level.model]
      }
      visit(level.has, path)
    }
  }
  visit(dataset.has, '')
  return result
}

/**
 * The static members of a model class with datasets enabled.
 *
 * @param {string} className
 * @param {VifrostDatasetSchema | undefined} dataset
 * @param {Record<string, string>} resources resource names by model FQCN
 * @returns {string}
 */
function generateDatasetLines(className: string, dataset: VifrostDatasetSchema | undefined, resources: Record<string, string>): string {
  if (!dataset) {
    return ''
  }
  return (
    `  static datasetMaxLimit = ${JSON.stringify(dataset.maxLimit)};\n` +
    `  static datasetResources: Record<string, string> = ${JSON.stringify(datasetResources(dataset, resources))};\n` +
    `  declare static readonly datasetShape: ${className}DatasetShape;\n`
  )
}

export function generateModelFile(
  modelFqcn: string,
  modelSchema: VifrostModelSchema,
  generatedModelFqcns: Set<string> = new Set([modelFqcn]),
  options: GenerateOptions = {}
): GeneratedFile {
  const className = shortClassName(modelFqcn)
  const clientImportSpecifier = options.clientImport ?? '@vifrost/client'

  const relationEntries = Object.entries(modelSchema.relations).map(([relationName, relation]) => ({
    relationName,
    method: generateRelationMethod(relationName, relation, modelFqcn, generatedModelFqcns),
  }))

  const relatedClassNamesToImport = Array.from(
    new Set(
      relationEntries
        .map(({ method }) => method.importName)
        .filter((importName): importName is string => importName !== null && importName !== className)
    )
  ).sort()

  const importLines = [
    `import { Model } from '${clientImportSpecifier}';`,
    ...relatedClassNamesToImport.map((relatedClassName) => `import { ${relatedClassName} } from './${relatedClassName}.js';`),
  ]

  const attributesBlock = generateAttributesBlock(modelSchema, options)
  const relationsBlock = relationEntries.map(({ method }) => method.code).join('\n\n')

  // Only relations that actually got a real loader method — never the
  // comment-only skips (MorphTo, outside this batch, unrecognized type) —
  // since @vifrost/client's Model.instantiate() uses this to detect
  // relation-shaped properties read before they're eager-loaded, and there's
  // no method there for it to guard in the first place.
  const relationNamesWithMethod = relationEntries
    .filter(({ method }) => method.hasMethod)
    .map(({ relationName }) => relationName)

  const content =
    `// Generated by @vifrost/codegen — do not edit by hand.\n` +
    `// Re-run the generator after the Laravel schema changes instead.\n\n` +
    `${importLines.join('\n')}\n\n` +
    (modelSchema.dataset ? generateDatasetShape(className, modelSchema.dataset, options) : '') +
    `export class ${className} extends Model {\n` +
    `  static resource = ${JSON.stringify(modelSchema.resource)};\n` +
    generatePrimaryKeyLines(modelSchema.primaryKey ?? 'id', options.keySeparator ?? ',') +
    `  static maxLimit = ${JSON.stringify(modelSchema.maxLimit)};\n` +
    `  static relations = ${JSON.stringify(relationNamesWithMethod)};\n` +
    generateDatasetLines(className, modelSchema.dataset, options.resources ?? {}) +
    `\n` +
    `${attributesBlock}\n` +
    (relationsBlock ? `\n${relationsBlock}\n` : '') +
    `}\n`

  return { fileName: `${className}.ts`, content }
}

/**
 * Generates one file per model plus an `index.ts` barrel. Models without a primary key are left out,
 * since the client cannot address their records, and reported through `options.onWarning`.
 *
 * @param {VifrostSchema} schema the Laravel schema export
 * @param {GenerateOptions} options
 * @returns {GeneratedFile[]}
 */
export function generateSchema(schema: VifrostSchema, options: GenerateOptions = {}): GeneratedFile[] {
  const modelEntries = Object.entries(schema.models).filter(([modelFqcn, modelSchema]) => {
    if (modelSchema.primaryKey !== null) {
      return true
    }
    options.onWarning?.(`Skipped ${modelFqcn}: its table has no primary key.`)
    return false
  })
  const generatedModelFqcns = new Set(modelEntries.map(([modelFqcn]) => modelFqcn))
  const resources = Object.fromEntries(Object.entries(schema.models).map(([modelFqcn, modelSchema]) => [modelFqcn, modelSchema.resource]))
  const fileOptions = { keySeparator: schema.compositeKeySeparator, resources, ...options }

  const modelFiles = modelEntries.map(([modelFqcn, modelSchema]) =>
    generateModelFile(modelFqcn, modelSchema, generatedModelFqcns, fileOptions)
  )

  const indexContent =
    `// Generated by @vifrost/codegen — do not edit by hand.\n\n` +
    modelFiles.map((file) => `export * from './${file.fileName.replace(/\.ts$/, '.js')}';`).join('\n') +
    '\n'

  return [...modelFiles, { fileName: 'index.ts', content: indexContent }]
}
