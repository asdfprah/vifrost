import { resolveTsType } from './typeMap.js'
import type {
  VifrostAttribute,
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
    `export class ${className} extends Model {\n` +
    `  static resource = ${JSON.stringify(modelSchema.resource)};\n` +
    generatePrimaryKeyLines(modelSchema.primaryKey ?? 'id', options.keySeparator ?? ',') +
    `  static maxLimit = ${JSON.stringify(modelSchema.maxLimit)};\n` +
    `  static relations = ${JSON.stringify(relationNamesWithMethod)};\n\n` +
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
  const fileOptions = { keySeparator: schema.compositeKeySeparator, ...options }

  const modelFiles = modelEntries.map(([modelFqcn, modelSchema]) =>
    generateModelFile(modelFqcn, modelSchema, generatedModelFqcns, fileOptions)
  )

  const indexContent =
    `// Generated by @vifrost/codegen — do not edit by hand.\n\n` +
    modelFiles.map((file) => `export * from './${file.fileName.replace(/\.ts$/, '.js')}';`).join('\n') +
    '\n'

  return [...modelFiles, { fileName: 'index.ts', content: indexContent }]
}
