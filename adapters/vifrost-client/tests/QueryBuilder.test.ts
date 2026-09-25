import { describe, expect, it } from 'vitest'
import { QueryBuilder } from '../src/QueryBuilder.js'
import { toModelCollection } from '../src/ModelCollection.js'
import { buildQueryString, createQueryState } from '../src/queryString.js'

describe('buildQueryString', () => {
  it('builds filter[field]=value, matching spatie/laravel-query-builder', () => {
    const state = createQueryState()
    state.wheres.name = 'John'

    expect(buildQueryString(state)).toBe('?filter%5Bname%5D=John')
  })

  it('joins multiple sorts with commas, keeping the "-" prefix for descending', () => {
    const state = createQueryState()
    state.sorts = ['name', '-created_at']

    expect(decodeURIComponent(buildQueryString(state))).toBe('?sort=name,-created_at')
  })

  it('joins includes with commas', () => {
    const state = createQueryState()
    state.includes = ['category', 'comments']

    expect(decodeURIComponent(buildQueryString(state))).toBe('?include=category,comments')
  })

  it('builds fields[type]=a,b per resource type', () => {
    const state = createQueryState()
    state.fields = { product: ['id', 'name'] }

    expect(decodeURIComponent(buildQueryString(state))).toBe('?fields[product]=id,name')
  })

  it('builds flat ?limit=N&offset=M params, read directly by Asdfprah\\Vifrost\\Pagination', () => {
    const state = createQueryState()
    state.limit = 10
    state.offset = 20

    expect(buildQueryString(state)).toBe('?limit=10&offset=20')
  })

  it('returns an empty string when nothing is set', () => {
    expect(buildQueryString(createQueryState())).toBe('')
  })
})

describe('QueryBuilder', () => {
  function queryBuilder(calledPaths: string[], maxLimit: number | null = null) {
    const fetchMany = async (path: string) => {
      calledPaths.push(path)
      return toModelCollection([{ id: 1 }], 1)
    }
    const fetchOne = async (id: string | number) => {
      calledPaths.push(`fetchOne:${id}`)
      return { id }
    }
    return new QueryBuilder<{ id: number | string }>('product', fetchMany, fetchOne, maxLimit)
  }

  it('chains where/orderBy/with/limit/offset and calls the fetcher with the built path', async () => {
    const calledPaths: string[] = []

    const results = await queryBuilder(calledPaths)
      .where('status', 'active')
      .orderBy('created_at', 'desc')
      .with('category')
      .limit(10)
      .offset(20)
      .get()

    expect(results).toEqual([{ id: 1 }])
    expect(decodeURIComponent(calledPaths[0])).toBe(
      'product?filter[status]=active&sort=-created_at&include=category&limit=10&offset=20'
    )
  })

  it('orderBy() defaults to ascending, matching Eloquent', async () => {
    const calledPaths: string[] = []

    await queryBuilder(calledPaths).orderBy('name').get()

    expect(decodeURIComponent(calledPaths[0])).toBe('product?sort=name')
  })

  it('orderBy() chained multiple times sorts by multiple columns, same as Eloquent', async () => {
    const calledPaths: string[] = []

    await queryBuilder(calledPaths).orderBy('name').orderBy('created_at', 'DESC').get()

    expect(decodeURIComponent(calledPaths[0])).toBe('product?sort=name,-created_at')
  })

  it('take()/skip() are Eloquent aliases for limit()/offset()', async () => {
    const calledPaths: string[] = []

    await queryBuilder(calledPaths).take(5).skip(15).get()

    expect(decodeURIComponent(calledPaths[0])).toBe('product?limit=5&offset=15')
  })

  it('first() forces limit(1) and returns the first result, or null if empty', async () => {
    const fetchMany = async () => toModelCollection([{ id: 1 }, { id: 2 }], 2)
    const fetchOne = async (id: string | number) => ({ id })
    const result = await new QueryBuilder<{ id: number }>('product', fetchMany, fetchOne, null).first()

    expect(result).toEqual({ id: 1 })

    const empty = await new QueryBuilder<{ id: number }>(
      'product',
      async () => toModelCollection([], 0),
      fetchOne,
      null
    ).first()
    expect(empty).toBeNull()
  })

  it('param() sets an arbitrary raw query param as an escape hatch', async () => {
    const calledPaths: string[] = []

    await queryBuilder(calledPaths).param('_foo', 'bar').get()

    expect(calledPaths[0]).toBe('product?_foo=bar')
  })

  it('whereId() routes get()/first() to fetchOne instead of the collection endpoint', async () => {
    const calledPaths: string[] = []

    const first = await queryBuilder(calledPaths).whereId(5).first()
    expect(first).toEqual({ id: 5 })
    expect(calledPaths).toEqual(['fetchOne:5'])

    const collection = await queryBuilder(calledPaths).whereId(5).get()
    expect(collection).toEqual([{ id: 5 }])
    expect(collection.total).toBe(1)
  })

  it('get() passes .total through from fetchMany unchanged', async () => {
    const calledPaths: string[] = []

    const results = await queryBuilder(calledPaths).get()

    expect(results.total).toBe(1)
  })

  it('whereId() bypasses where/sort/include entirely — no filter query is ever built', async () => {
    const calledPaths: string[] = []

    await queryBuilder(calledPaths).where('status', 'active').whereId(5).first()

    expect(calledPaths).toEqual(['fetchOne:5'])
  })

  describe('assertWithinLimit() (the maxLimit guard)', () => {
    it('throws before making any request when maxLimit is set but no .limit() was called', async () => {
      const calledPaths: string[] = []

      await expect(queryBuilder(calledPaths, 100).get()).rejects.toThrow(/requires a limit/)
      expect(calledPaths).toEqual([])
    })

    it('throws before making any request when .limit() exceeds maxLimit', async () => {
      const calledPaths: string[] = []

      await expect(queryBuilder(calledPaths, 100).limit(500).get()).rejects.toThrow(/exceeds the max allowed/)
      expect(calledPaths).toEqual([])
    })

    it('succeeds when .limit() is within maxLimit', async () => {
      const calledPaths: string[] = []

      await expect(queryBuilder(calledPaths, 100).limit(50).get()).resolves.toEqual([{ id: 1 }])
    })

    it('is a no-op when maxLimit is null (model exempt from pagination)', async () => {
      const calledPaths: string[] = []

      await expect(queryBuilder(calledPaths, null).get()).resolves.toEqual([{ id: 1 }])
    })

    it('is bypassed entirely by whereId(), which is already bounded to one row', async () => {
      const calledPaths: string[] = []

      await expect(queryBuilder(calledPaths, 100).whereId(5).get()).resolves.toEqual([{ id: 5 }])
    })

    it('does not block first(), which always sets limit(1) itself', async () => {
      const calledPaths: string[] = []

      await expect(queryBuilder(calledPaths, 100).first()).resolves.toEqual({ id: 1 })
    })
  })
})
