import { describe, expect, test } from 'vitest'
import type { XRayTreeNode } from '../src/views/insight/xray-tree.ts'
import {
  visibleXRayRows,
  xrayAncestorPaths,
  xrayKeyAction,
} from '../src/views/insight/xray-navigation.ts'

const leaf = (path: string, label: string): XRayTreeNode => ({
  path,
  label,
  tokens: { kinds: [], fields: [label], values: [], types: [] },
  children: [],
})

const navigationTree = (): readonly XRayTreeNode[] => [
  leaf('/inputs', 'inputs'),
  leaf('/output', 'output'),
  {
    path: '/body',
    label: 'body',
    kind: 'apply',
    tokens: { kinds: ['apply'], fields: ['body'], values: [], types: [] },
    children: [leaf('/body/fn', 'fn'), leaf('/body/arg', 'arg')],
  },
]

describe('visibleXRayRows', () => {
  test('flattens only visible rows in render order', () => {
    expect(
      visibleXRayRows(navigationTree(), new Set(['/body'])).map((row) => ({
        path: row.path,
        parentPath: row.parentPath,
        level: row.level,
      })),
    ).toEqual([
      { path: '/inputs', parentPath: null, level: 1 },
      { path: '/output', parentPath: null, level: 1 },
      { path: '/body', parentPath: null, level: 1 },
      { path: '/body/fn', parentPath: '/body', level: 2 },
      { path: '/body/arg', parentPath: '/body', level: 2 },
    ])
  })

  test('handles a deeply nested visible tree without recursive traversal', () => {
    let node = leaf('/root', 'root')
    const expanded = new Set<string>()
    for (let depth = 5_000; depth > 0; depth -= 1) {
      const path = `/node-${depth}`
      expanded.add(path)
      node = {
        path,
        label: `node-${depth}`,
        tokens: { kinds: [], fields: [`node-${depth}`], values: [], types: [] },
        children: [node],
      }
    }

    const rows = visibleXRayRows([node], expanded)

    expect(rows).toHaveLength(5_001)
    expect(rows.at(-1)).toMatchObject({ path: '/root', level: 5_001 })
  })
})

describe('xrayAncestorPaths', () => {
  test('returns ordered ancestors only when the selected node exists', () => {
    expect(xrayAncestorPaths(navigationTree(), '/body/fn')).toEqual(['/body'])
    expect(xrayAncestorPaths(navigationTree(), '/body')).toEqual([])
    expect(xrayAncestorPaths(navigationTree(), '/missing')).toBeUndefined()
  })

  test('resolves deep ancestors without recursive traversal', () => {
    let node = leaf('/root', 'root')
    for (let depth = 5_000; depth > 0; depth -= 1) {
      node = {
        path: `/node-${depth}`,
        label: `node-${depth}`,
        tokens: { kinds: [], fields: [`node-${depth}`], values: [], types: [] },
        children: [node],
      }
    }

    const ancestors = xrayAncestorPaths([node], '/root')

    expect(ancestors).toHaveLength(5_000)
    expect(ancestors?.at(0)).toBe('/node-1')
    expect(ancestors?.at(-1)).toBe('/node-5000')
  })
})

describe('xrayKeyAction', () => {
  const rows = visibleXRayRows(navigationTree(), new Set(['/body']))

  test.each([
    ['ArrowDown', '/body/fn'],
    ['ArrowUp', '/output'],
    ['Home', '/inputs'],
    ['End', '/body/arg'],
  ] as const)('%s moves to the expected visible row', (key, expected) => {
    expect(xrayKeyAction(rows, '/body', key, new Set(['/body']))).toEqual({
      kind: 'focus',
      path: expected,
    })
  })

  test('Right opens a branch, then enters its first child', () => {
    expect(xrayKeyAction(rows, '/body', 'ArrowRight', new Set())).toEqual({
      kind: 'expand',
      path: '/body',
    })
    expect(xrayKeyAction(rows, '/body', 'ArrowRight', new Set(['/body']))).toEqual({
      kind: 'focus',
      path: '/body/fn',
    })
  })

  test('Left closes a branch, then moves to its parent', () => {
    expect(xrayKeyAction(rows, '/body', 'ArrowLeft', new Set(['/body']))).toEqual({
      kind: 'collapse',
      path: '/body',
    })
    expect(xrayKeyAction(rows, '/body/fn', 'ArrowLeft', new Set(['/body']))).toEqual({
      kind: 'focus',
      path: '/body',
    })
  })

  test.each(['Enter', ' '] as const)('%s selects the current row', (key) => {
    expect(xrayKeyAction(rows, '/body/fn', key, new Set(['/body']))).toEqual({
      kind: 'select',
      path: '/body/fn',
    })
  })

  test('handles navigation keys at boundaries without changing state', () => {
    expect(xrayKeyAction(rows, '/inputs', 'ArrowUp', new Set(['/body']))).toEqual({
      kind: 'handled',
    })
    expect(xrayKeyAction(rows, '/body/arg', 'ArrowDown', new Set(['/body']))).toEqual({
      kind: 'handled',
    })
    expect(xrayKeyAction(rows, '/inputs', 'ArrowLeft', new Set(['/body']))).toEqual({
      kind: 'handled',
    })
    expect(xrayKeyAction(rows, '/body/arg', 'ArrowRight', new Set(['/body']))).toEqual({
      kind: 'handled',
    })
  })

  test('leaves unrelated keys and paths outside the visible tree unhandled', () => {
    expect(xrayKeyAction(rows, '/body', 'Escape', new Set(['/body']))).toEqual({
      kind: 'none',
    })
    expect(xrayKeyAction(rows, '/missing', 'Home', new Set(['/body']))).toEqual({
      kind: 'none',
    })
  })
})
