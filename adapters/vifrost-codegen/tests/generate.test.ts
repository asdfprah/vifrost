import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { generateModelFile, generateSchema } from '../src/generate.js'
import type { VifrostModelSchema, VifrostSchema } from '../src/types.js'

const FIXTURE_PATH = new URL('./fixtures/schema.json', import.meta.url).pathname

async function loadFixture(): Promise<VifrostSchema> {
  return JSON.parse(await readFile(FIXTURE_PATH, 'utf-8')) as VifrostSchema
}

function knownModelsOf(schema: VifrostSchema): Set<string> {
  return new Set(Object.keys(schema.models))
}

describe('generateModelFile — real testbed schema (Category hasMany Product, Product belongsTo Category)', () => {
  it('emits declare fields with the right nullable unions', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Product',
      schema.models['App\\Models\\Product'],
      knownModelsOf(schema)
    )

    expect(content).toContain('declare id: number;')
    expect(content).toContain('declare name: string;')
    expect(content).toContain('declare price: string;') // decimal -> string
    expect(content).toContain('declare description: string | null;') // nullable text column
  })

  it('sets static resource/primaryKey/maxLimit from the schema, not the DB table name', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Product',
      schema.models['App\\Models\\Product'],
      knownModelsOf(schema)
    )

    expect(content).toContain(`static resource = "product";`)
    expect(content).toContain(`static primaryKey = "id";`)
    expect(content).toContain(`static maxLimit = 100;`)
  })

  it('emits static maxLimit = null for a model exempt from pagination', async () => {
    const schema = await loadFixture()
    const exemptSchema = { ...schema.models['App\\Models\\Product'], maxLimit: null }
    const { content } = generateModelFile('App\\Models\\Product', exemptSchema, knownModelsOf(schema))

    expect(content).toContain(`static maxLimit = null;`)
  })

  it('generates a toMany() method for a HasMany relation and imports the related class', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Category',
      schema.models['App\\Models\\Category'],
      knownModelsOf(schema)
    )

    expect(content).toContain("import { Product } from './Product.js';")
    expect(content).toContain('products(): Promise<Product[]> {')
    expect(content).toContain('return this.toMany("products", Product);')
  })

  it('generates a toOne() method for a BelongsTo relation', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Product',
      schema.models['App\\Models\\Product'],
      knownModelsOf(schema)
    )

    expect(content).toContain("import { Category } from './Category.js';")
    expect(content).toContain('category(): Promise<Category | null> {')
    expect(content).toContain('return this.toOne("category", Category);')
  })

  it('skips generating a method for a MorphTo relation, leaving an explanatory comment', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Comment',
      schema.models['App\\Models\\Comment'],
      knownModelsOf(schema)
    )

    expect(content).not.toMatch(/commentable\(\)/)
    expect(content).toContain('MorphTo relation')
  })

  it('lists every relation that got a real loader method in static relations', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Product',
      schema.models['App\\Models\\Product'],
      knownModelsOf(schema)
    )

    expect(content).toContain('static relations = ["category","comments"];')
  })

  it('excludes a MorphTo relation from static relations — there is no method to guard', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Comment',
      schema.models['App\\Models\\Comment'],
      knownModelsOf(schema)
    )

    expect(content).toContain('static relations = [];')
  })

  it('excludes a relation outside the generation batch from static relations', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile('App\\Models\\User', schema.models['App\\Models\\User'], knownModelsOf(schema))

    expect(content).toContain('static relations = [];')
  })

  it('skips a relation whose related model is outside this generation batch, without a broken import', async () => {
    // User.notifications -> Illuminate\Notifications\DatabaseNotification, a
    // framework class that Vifrost::models() never discovers as an app model
    // and therefore never generates a file for.
    const schema = await loadFixture()
    const { content } = generateModelFile('App\\Models\\User', schema.models['App\\Models\\User'], knownModelsOf(schema))

    expect(content).not.toContain("import { DatabaseNotification }")
    expect(content).not.toMatch(/notifications\(\):/)
    // The comment naming the skipped class is intentional and helpful — it's
    // only the import/typed method that must not be generated.
    expect(content).toContain('DatabaseNotification')
    expect(content).toContain("isn't part of this")
  })

  it('extends Model from the configurable client import specifier', async () => {
    const schema = await loadFixture()
    const { content } = generateModelFile(
      'App\\Models\\Product',
      schema.models['App\\Models\\Product'],
      knownModelsOf(schema),
      { clientImport: '@acme/vifrost-client' }
    )

    expect(content).toContain("import { Model } from '@acme/vifrost-client';")
  })
})

describe('generateModelFile — edge cases', () => {
  const baseModel: VifrostModelSchema = {
    table: 'categories',
    primaryKey: 'id',
    resource: 'category',
    maxLimit: 100,
    attributes: {
      id: {
        type: 'bigint',
        rawType: 'bigint unsigned',
        length: null,
        isNullable: false,
        isPrimaryKey: true,
        hasAutoIncrement: true,
        hasDefaultValue: false,
        defaultValue: null,
        isForeign: false,
        foreign: null,
      },
    },
    relations: {},
  }

  it('does not self-import when a relation points back at the same model (e.g. a tree)', () => {
    const schema: VifrostModelSchema = {
      ...baseModel,
      relations: {
        children: { type: 'HasMany', related: 'App\\Models\\Category', polymorphic: false },
      },
    }

    const { content } = generateModelFile('App\\Models\\Category', schema, new Set(['App\\Models\\Category']))

    expect(content).not.toContain("import { Category } from './Category.js';")
    expect(content).toContain('children(): Promise<Category[]> {')
  })

  it('does not duplicate an import when two relations point at the same related model', () => {
    const schema: VifrostModelSchema = {
      ...baseModel,
      relations: {
        products: { type: 'HasMany', related: 'App\\Models\\Product', polymorphic: false },
        featuredProduct: { type: 'HasOne', related: 'App\\Models\\Product', polymorphic: false },
      },
    }

    const { content } = generateModelFile(
      'App\\Models\\Category',
      schema,
      new Set(['App\\Models\\Category', 'App\\Models\\Product'])
    )

    expect(content.match(/import \{ Product \}/g)).toHaveLength(1)
  })

  it('applies type map overrides to attribute types', () => {
    const schema: VifrostModelSchema = {
      ...baseModel,
      attributes: {
        ...baseModel.attributes,
        meta: {
          type: 'json',
          rawType: 'json',
          length: null,
          isNullable: true,
          isPrimaryKey: false,
          hasAutoIncrement: false,
          hasDefaultValue: false,
          defaultValue: null,
          isForeign: false,
          foreign: null,
        },
      },
    }

    const { content } = generateModelFile('App\\Models\\Category', schema, new Set(['App\\Models\\Category']), {
      overrides: { json: 'Record<string, unknown>' },
    })

    expect(content).toContain('declare meta: Record<string, unknown> | null;')
  })
})

describe('generateSchema', () => {
  it('generates one file per model plus an index.ts barrel re-exporting all of them — no file for models outside the batch', async () => {
    const schema = await loadFixture()
    const files = generateSchema(schema)

    const fileNames = files.map((f) => f.fileName).sort()
    expect(fileNames).toEqual(['Category.ts', 'Comment.ts', 'Product.ts', 'User.ts', 'index.ts'])

    const index = files.find((f) => f.fileName === 'index.ts')!
    expect(index.content).toContain("export * from './Product.js';")
    expect(index.content).toContain("export * from './Category.js';")
  })
})

describe('composite and missing primary keys', () => {
  const roleModel: VifrostModelSchema = {
    table: 'staff_member_roles',
    primaryKey: ['staff_member_id', 'role_id'],
    resource: 'staffmemberrole',
    maxLimit: 100,
    attributes: {},
    relations: {},
  }

  it('emits a composite primary key as a readonly tuple, without a separator line for the default one', () => {
    const { content } = generateModelFile('App\\Models\\StaffMemberRole', roleModel)

    expect(content).toContain('static primaryKey = ["staff_member_id","role_id"] as const;')
    expect(content).not.toContain('keySeparator')
  })

  it('emits the schema separator when it is not the default', () => {
    const files = generateSchema({
      schemaVersion: 1,
      compositeKeySeparator: '|',
      models: { 'App\\Models\\StaffMemberRole': roleModel },
    })

    expect(files[0].content).toContain('static keySeparator = "|";')
  })

  it('skips a model without a primary key, warns, and leaves relations to it ungenerated', () => {
    const warnings: string[] = []
    const files = generateSchema(
      {
        schemaVersion: 1,
        models: {
          'App\\Models\\StaffMember': {
            ...roleModel,
            primaryKey: 'id',
            resource: 'staffmember',
            relations: { logs: { type: 'HasMany', related: 'App\\Models\\AuditLog', polymorphic: false } },
          },
          'App\\Models\\AuditLog': { ...roleModel, primaryKey: null, resource: 'auditlog' },
        },
      },
      { onWarning: (message) => warnings.push(message) }
    )

    expect(files.map((file) => file.fileName)).toEqual(['StaffMember.ts', 'index.ts'])
    expect(files[0].content).not.toContain("import { AuditLog }")
    expect(warnings).toEqual(['Skipped App\\Models\\AuditLog: its table has no primary key.'])
  })
})
