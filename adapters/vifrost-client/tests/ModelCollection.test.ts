import { describe, expect, it } from 'vitest'
import { toModelCollection } from '../src/ModelCollection.js'

describe('toModelCollection', () => {
  it('is a real array — instanceof, map, length, spread all behave exactly like T[]', () => {
    const collection = toModelCollection([{ id: 1 }, { id: 2 }], 21)

    expect(Array.isArray(collection)).toBe(true)
    expect(collection).toBeInstanceOf(Array)
    expect(collection.length).toBe(2)
    expect(collection.map((row) => row.id)).toEqual([1, 2])
    expect([...collection]).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('exposes .total as the decorated value, independent of how many rows are in the page', () => {
    const collection = toModelCollection([{ id: 1 }, { id: 2 }], 21)

    expect(collection.total).toBe(21)
  })

  it('keeps .total non-enumerable, invisible to Object.keys()/for...in and toEqual comparisons', () => {
    const collection = toModelCollection([{ id: 1 }], 5)

    expect(Object.keys(collection)).toEqual(['0'])
    expect(collection).toEqual([{ id: 1 }])

    const seen: string[] = []
    for (const key in collection) {
      seen.push(key)
    }
    expect(seen).toEqual(['0'])
  })

  it('serializes as a plain array, ignoring .total — same as JSON.stringify on any array', () => {
    const collection = toModelCollection([{ id: 1 }], 5)

    expect(JSON.stringify(collection)).toBe(JSON.stringify([{ id: 1 }]))
  })
})
