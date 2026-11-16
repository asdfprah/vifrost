import { describe, expect, it } from 'vitest'
import { generateSchema } from '../src/generate.js'
import type { VifrostSchema } from '../src/types.js'

const column = (type: string, isNullable = false) => ({ type, rawType: type, isNullable })

const schema: VifrostSchema = {
  schemaVersion: 1,
  models: {
    'App\\Models\\Order': {
      table: 'orders',
      primaryKey: 'id',
      resource: 'order',
      maxLimit: 100,
      attributes: {},
      relations: {},
      dataset: {
        maxLimit: 500,
        columns: { status: column('varchar'), customer_id: column('bigint', true) },
        joins: { customer: { model: 'App\\Models\\Customer', type: 'BelongsTo', columns: { name: column('varchar') } } },
        has: {
          items: {
            model: 'App\\Models\\OrderItem',
            columns: { cost: column('numeric') },
            has: { refunds: { model: 'App\\Models\\Refund', columns: { code: column('varchar') }, has: {} } },
          },
        },
        aggregates: ['count', 'sum'],
      },
    },
    'App\\Models\\Customer': { table: 'customers', primaryKey: 'id', resource: 'customer', maxLimit: 100, attributes: {}, relations: {} },
    'App\\Models\\OrderItem': { table: 'order_items', primaryKey: 'id', resource: 'orderitem', maxLimit: 100, attributes: {}, relations: {} },
    'App\\Models\\Refund': { table: 'refunds', primaryKey: 'id', resource: 'refund', maxLimit: 100, attributes: {}, relations: {} },
  },
}

describe('generateSchema — datasets', () => {
  it('emits the dataset shape and statics of a model whose controller allows datasets', () => {
    const content = generateSchema(schema).find((file) => file.fileName === 'Order.ts')!.content

    expect(content).toContain(
      'export interface OrderDatasetShape {\n' +
        '  columns: { status: string; customer_id: number | null };\n' +
        '  joins: {\n    customer: { columns: { name: string } };\n  };\n' +
        '  has: {\n' +
        '    items: {\n' +
        '      columns: { cost: string };\n' +
        '      has: {\n' +
        '        refunds: {\n' +
        '          columns: { code: string };\n' +
        '          has: {};\n' +
        '        };\n' +
        '      };\n' +
        '    };\n' +
        '  };\n' +
        '  aggregates: "count" | "sum";\n' +
        '}'
    )
    expect(content).toContain('  static datasetMaxLimit = 500;\n')
    expect(content).toContain(
      '  static datasetResources: Record<string, string> = {"customer":"customer","items":"orderitem","items.refunds":"refund"};\n'
    )
    expect(content).toContain('  declare static readonly datasetShape: OrderDatasetShape;\n')
  })

  it('emits nothing about datasets for a model without them', () => {
    const content = generateSchema(schema).find((file) => file.fileName === 'Customer.ts')!.content

    expect(content).not.toContain('dataset')
  })
})
