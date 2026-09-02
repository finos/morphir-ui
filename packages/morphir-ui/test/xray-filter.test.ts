import { describe, expect, test } from 'vitest'
import type { XRaySearchScope, XRayTreeNode } from '../src/views/insight/xray-tree.ts'
import { filterXRayTree } from '../src/views/insight/xray-filter.ts'

const node = (
  path: string,
  label: string,
  tokens: Partial<XRayTreeNode['tokens']> = {},
  children: readonly XRayTreeNode[] = [],
): XRayTreeNode => ({
  path,
  label,
  tokens: {
    kinds: tokens.kinds ?? [],
    fields: tokens.fields ?? [],
    values: tokens.values ?? [],
    types: tokens.types ?? [],
  },
  children,
})

const scoped = (scope: XRaySearchScope): ReadonlySet<XRaySearchScope> => new Set([scope])

const valueBody = () => {
  const fn = node('/body/fn', 'fn', { values: ['Basics.add'] }, [
    node('/body/fn/child', 'child', { values: ['unrelated'] }),
  ])
  const arg = node('/body/arg', 'arg', { values: ['Basics.subtract'] })
  return node('/body', 'body', {}, [fn, arg])
}

describe('filterXRayTree', () => {
  test('finds a value case-insensitively and retains only its ancestor context', () => {
    const body = valueBody()

    const result = filterXRayTree([body], ' BASICS.ADD ', scoped('values'))

    expect(result.tree.map((root) => root.path)).toEqual(['/body'])
    expect(result.tree[0]?.children.map((child) => child.path)).toEqual(['/body/fn'])
    expect(result.tree[0]?.children[0]).not.toBe(body.children[0])
    expect(result.matchPaths).toEqual(['/body/fn'])
    expect(result.expandedPaths).toEqual(new Set(['/body', '/body/fn']))
    expect(result.matchCount).toBe(1)
  })

  test.each([
    ['kinds', 'Apply', '/kind-match'],
    ['fields', 'needleField', '/field-match'],
    ['values', 'needleValue', '/value-match'],
    ['types', 'NeedleType', '/type-match'],
  ] as const)('scope %s searches only its intended token class', (scope, query, expectedPath) => {
    const roots = [
      node('/kind-match', 'kind', { kinds: ['Apply'] }),
      node('/field-match', 'field', { fields: ['needleField'] }),
      node('/value-match', 'value', { values: ['needleValue'] }),
      node('/type-match', 'type', { types: ['NeedleType'] }),
    ]

    const result = filterXRayTree(roots, query, scoped(scope))

    expect(result.matchPaths).toEqual([expectedPath])
    expect(result.matchCount).toBe(1)
  })

  test('treats an empty scope set as All', () => {
    const roots = [
      node('/kind-match', 'kind', { kinds: ['needle-kind'] }),
      node('/field-match', 'field', { fields: ['needle-field'] }),
      node('/value-match', 'value', { values: ['needle-value'] }),
      node('/type-match', 'type', { types: ['needle-type'] }),
    ]

    const result = filterXRayTree(roots, 'needle', new Set())

    expect(result.matchPaths).toEqual([
      '/kind-match',
      '/field-match',
      '/value-match',
      '/type-match',
    ])
    expect(result.matchCount).toBe(4)
  })

  test('ORs selected scopes while counting each directly matching node once', () => {
    const both = node('/both', 'both', {
      kinds: ['needle-kind'],
      fields: ['needle-field'],
    })
    const value = node('/value', 'value', { values: ['needle-value'] })

    const result = filterXRayTree([both, value], 'needle', new Set(['kinds', 'fields']))

    expect(result.matchPaths).toEqual(['/both'])
    expect(result.matchCount).toBe(1)
  })

  test('returns original roots by identity for an empty or whitespace query', () => {
    const roots = [valueBody()]

    expect(filterXRayTree(roots, '', scoped('values'))).toEqual({
      tree: roots,
      matchPaths: [],
      expandedPaths: new Set(),
      matchCount: 0,
    })
    expect(filterXRayTree(roots, '  \t\n ', scoped('values')).tree).toBe(roots)
  })

  test('returns no tree for a query with no results', () => {
    const result = filterXRayTree([valueBody()], 'missing', scoped('values'))

    expect(result.tree).toEqual([])
    expect(result.matchPaths).toEqual([])
    expect(result.expandedPaths).toEqual(new Set())
    expect(result.matchCount).toBe(0)
  })

  test('retains two matching descendants under one common ancestor in source order', () => {
    const left = node('/root/left', 'left', { values: ['needle-left'] })
    const unrelated = node('/root/unrelated', 'unrelated', { values: ['other'] })
    const right = node('/root/right', 'right', { values: ['needle-right'] })
    const root = node('/root', 'root', {}, [left, unrelated, right])

    const result = filterXRayTree([root], 'needle', scoped('values'))

    expect(result.tree).toHaveLength(1)
    expect(result.tree[0]?.path).toBe('/root')
    expect(result.tree[0]?.children.map((child) => child.path)).toEqual([
      '/root/left',
      '/root/right',
    ])
    expect(result.matchPaths).toEqual(['/root/left', '/root/right'])
    expect(result.expandedPaths).toEqual(new Set(['/root', '/root/left', '/root/right']))
  })

  test('does not mutate the source tree', () => {
    const roots = [valueBody()]
    const before = structuredClone(roots)

    filterXRayTree(roots, 'basics.add', scoped('values'))

    expect(roots).toEqual(before)
  })
})
