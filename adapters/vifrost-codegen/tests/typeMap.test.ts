import { describe, expect, it } from 'vitest'
import { resolveTsType } from '../src/typeMap.js'

describe('resolveTsType', () => {
  it('maps integer families (including Postgres aliases) to number', () => {
    for (const type of ['bigint', 'int', 'integer', 'mediumint', 'smallint', 'year', 'int2', 'int4', 'int8']) {
      expect(resolveTsType({ type, rawType: type })).toBe('number')
    }
  })

  it('maps decimal/numeric to string, to avoid float precision loss', () => {
    expect(resolveTsType({ type: 'decimal', rawType: 'decimal(8,2)' })).toBe('string')
    expect(resolveTsType({ type: 'numeric', rawType: 'numeric(8,2)' })).toBe('string')
  })

  it('maps true floating point types to number', () => {
    for (const type of ['float', 'double', 'float4', 'float8']) {
      expect(resolveTsType({ type, rawType: type })).toBe('number')
    }
  })

  it('maps string-ish families to string', () => {
    for (const type of ['char', 'varchar', 'text', 'mediumtext', 'longtext', 'enum', 'set', 'uuid']) {
      expect(resolveTsType({ type, rawType: type })).toBe('string')
    }
  })

  it('maps the Postgres names for char, timezone-aware dates and network types to string', () => {
    for (const type of ['bpchar', 'timestamptz', 'timetz', 'inet', 'macaddr']) {
      expect(resolveTsType({ type, rawType: type })).toBe('string')
    }
  })

  it('maps json/jsonb to unknown, since the shape cannot be known from the schema alone', () => {
    expect(resolveTsType({ type: 'json', rawType: 'json' })).toBe('unknown')
    expect(resolveTsType({ type: 'jsonb', rawType: 'jsonb' })).toBe('unknown')
  })

  it('maps an unrecognized type to unknown rather than guessing', () => {
    expect(resolveTsType({ type: 'geometry', rawType: 'geometry' })).toBe('unknown')
  })

  it('treats tinyint(1) as boolean and any other width as number, mirroring ValidationGenerator', () => {
    expect(resolveTsType({ type: 'tinyint', rawType: 'tinyint(1)' })).toBe('boolean')
    expect(resolveTsType({ type: 'tinyint', rawType: 'tinyint(3)' })).toBe('number')
  })

  it('applies the same width rule to bit columns', () => {
    expect(resolveTsType({ type: 'bit', rawType: 'bit(1)' })).toBe('boolean')
    expect(resolveTsType({ type: 'bit', rawType: 'bit(8)' })).toBe('number')
  })

  it('lets a caller override the default mapping for a specific native type', () => {
    expect(
      resolveTsType({ type: 'decimal', rawType: 'decimal(8,2)' }, { overrides: { decimal: 'number' } })
    ).toBe('number')
  })
})
