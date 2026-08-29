import type { WorkspaceIr } from '@morphir/ir'
import { describe, expect, test, vi } from 'vitest'
import {
  TREE_PANE_BOUNDS,
  TREE_PANE_DEFAULT_WIDTH,
  clampTreePaneWidth,
  defaultExpandedIds,
  effectiveExpandedIds,
  filterModelTree,
  flattenVisibleTree,
  projectModelTree,
} from '../src/views/model-tree/model-tree.ts'

const IR: WorkspaceIr = {
  package: { name: 'Morphir', moduleCount: 2 },
  modules: [
    { packageName: 'Morphir', name: 'Dependency.DAG', typeCount: 1, valueCount: 2 },
    { packageName: 'Morphir', name: 'IR.Distribution', typeCount: 1, valueCount: 1 },
  ],
  definitions: [
    {
      ref: { packageName: 'Morphir', moduleName: 'Dependency.DAG', localName: 'DAG' },
      kind: 'type',
      access: 'Public',
      doc: 'Directed acyclic graph.',
    },
    {
      ref: {
        packageName: 'Morphir',
        moduleName: 'Dependency.DAG',
        localName: 'incomingEdges',
      },
      kind: 'value',
      access: 'Public',
      doc: null,
    },
    {
      ref: {
        packageName: 'Morphir',
        moduleName: 'Dependency.DAG',
        localName: 'insertEdge',
      },
      kind: 'value',
      access: 'Public',
      doc: null,
    },
    {
      ref: {
        packageName: 'Morphir',
        moduleName: 'IR.Distribution',
        localName: 'Distribution',
      },
      kind: 'type',
      access: 'Public',
      doc: null,
    },
    {
      ref: {
        packageName: 'Morphir',
        moduleName: 'IR.Distribution',
        localName: 'dependencyEdges',
      },
      kind: 'value',
      access: 'Private',
      doc: null,
    },
  ],
}

describe('model tree projection', () => {
  test('projects package, module, type and value nodes with stable ids and order', () => {
    const [pkg] = projectModelTree(IR)

    expect(pkg).toMatchObject({
      id: 'package:Morphir',
      kind: 'package',
      label: 'Morphir',
      parentId: null,
      moduleCount: 2,
    })
    expect(pkg!.children.map((node) => node.id)).toEqual([
      'module:Morphir:Dependency.DAG',
      'module:Morphir:IR.Distribution',
    ])
    expect(pkg!.children[0]).toMatchObject({
      parentId: 'package:Morphir',
      typeCount: 1,
      valueCount: 2,
    })
    expect(pkg!.children[0]!.children.map((node) => [node.kind, node.label, node.id])).toEqual([
      ['type', 'DAG', 'definition:type:Morphir:Dependency.DAG:DAG'],
      ['value', 'incomingEdges', 'definition:value:Morphir:Dependency.DAG:incomingEdges'],
      ['value', 'insertEdge', 'definition:value:Morphir:Dependency.DAG:insertEdge'],
    ])
    expect(pkg!.children[0]!.children[0]).toMatchObject({
      parentId: 'module:Morphir:Dependency.DAG',
      info: IR.definitions[0],
      children: [],
    })
  })

  test('indexes definitions once without rescanning them for each module', () => {
    const definitionsFilter = vi.spyOn(IR.definitions, 'filter')

    try {
      const [pkg] = projectModelTree(IR)

      expect(
        pkg!.children.map((module) => module.children.map((definition) => definition.label)),
      ).toEqual([
        ['DAG', 'incomingEdges', 'insertEdge'],
        ['Distribution', 'dependencyEdges'],
      ])
      expect(definitionsFilter).not.toHaveBeenCalled()
    } finally {
      definitionsFilter.mockRestore()
    }
  })

  test('expands every package and its first module in pre-order with one-based levels', () => {
    const roots = projectModelTree(IR)
    const expanded = defaultExpandedIds(roots)

    expect([...expanded]).toEqual(['package:Morphir', 'module:Morphir:Dependency.DAG'])
    expect(flattenVisibleTree(roots, expanded).map((row) => [row.level, row.node.label])).toEqual([
      [1, 'Morphir'],
      [2, 'Dependency.DAG'],
      [3, 'DAG'],
      [3, 'incomingEdges'],
      [3, 'insertEdge'],
      [2, 'IR.Distribution'],
    ])
  })
})

describe('model tree filtering', () => {
  const roots = projectModelTree(IR)

  test('uses locale-independent lowercase normalization for search', () => {
    const localeLowerCase = vi.spyOn(String.prototype, 'toLocaleLowerCase')

    try {
      const result = filterModelTree(roots, {
        query: 'EDGE',
        showTypes: true,
        showValues: true,
      })

      expect(result.matchCount).toBe(3)
      expect(localeLowerCase).not.toHaveBeenCalled()
    } finally {
      localeLowerCase.mockRestore()
    }
  })

  test('search retains direct matches and contextual ancestors across modules', () => {
    const result = filterModelTree(roots, {
      query: '  EdGe  ',
      showTypes: true,
      showValues: true,
    })

    expect(
      flattenVisibleTree(result.roots, result.autoExpandedIds).map((row) => row.node.label),
    ).toEqual([
      'Morphir',
      'Dependency.DAG',
      'incomingEdges',
      'insertEdge',
      'IR.Distribution',
      'dependencyEdges',
    ])
    expect(result.matchedIds).toEqual([
      'definition:value:Morphir:Dependency.DAG:incomingEdges',
      'definition:value:Morphir:Dependency.DAG:insertEdge',
      'definition:value:Morphir:IR.Distribution:dependencyEdges',
    ])
    expect(result.matchCount).toBe(3)
    expect(result.moduleCount).toBe(2)
    expect([...result.autoExpandedIds]).toEqual([
      'module:Morphir:Dependency.DAG',
      'module:Morphir:IR.Distribution',
      'package:Morphir',
    ])
    expect(result.countById.get('package:Morphir')).toBe(3)
    expect(result.countById.get('module:Morphir:Dependency.DAG')).toBe(2)
    expect(result.countById.get('module:Morphir:IR.Distribution')).toBe(1)
  })

  test('type and value filters are independent and preserve direct branch matches', () => {
    const allExpanded = new Set([
      'package:Morphir',
      'module:Morphir:Dependency.DAG',
      'module:Morphir:IR.Distribution',
    ])
    const types = filterModelTree(roots, { query: '', showTypes: true, showValues: false })
    const values = filterModelTree(roots, { query: '', showTypes: false, showValues: true })

    expect(flattenVisibleTree(types.roots, allExpanded).map((row) => row.node.label)).toEqual([
      'Morphir',
      'Dependency.DAG',
      'DAG',
      'IR.Distribution',
      'Distribution',
    ])
    expect(flattenVisibleTree(values.roots, allExpanded).map((row) => row.node.label)).toEqual([
      'Morphir',
      'Dependency.DAG',
      'incomingEdges',
      'insertEdge',
      'IR.Distribution',
      'dependencyEdges',
    ])
    expect(types.matchedIds).toEqual([])
    expect(values.matchedIds).toEqual([])

    const moduleOnly = filterModelTree(roots, {
      query: 'distribution',
      showTypes: false,
      showValues: false,
    })
    expect(
      flattenVisibleTree(moduleOnly.roots, moduleOnly.autoExpandedIds).map((row) => row.node.label),
    ).toEqual(['Morphir', 'IR.Distribution'])
    expect(moduleOnly.matchedIds).toEqual(['module:Morphir:IR.Distribution'])
    expect(moduleOnly.moduleCount).toBe(1)
  })

  test('search expansion is derived without changing normal expansion', () => {
    const normal = defaultExpandedIds(roots)
    const searchCollapsed = new Set<string>()
    const result = filterModelTree(roots, {
      query: 'dependencyEdges',
      showTypes: true,
      showValues: true,
    })

    const expanded = effectiveExpandedIds(
      'dependencyEdges',
      normal,
      searchCollapsed,
      result.autoExpandedIds,
    )
    expect(expanded.has('module:Morphir:IR.Distribution')).toBe(true)
    expect(normal.has('module:Morphir:IR.Distribution')).toBe(false)
    expect([...searchCollapsed]).toEqual([])

    const temporaryCollapse = new Set(['module:Morphir:IR.Distribution'])
    const temporarilyCollapsed = effectiveExpandedIds(
      'dependencyEdges',
      normal,
      temporaryCollapse,
      result.autoExpandedIds,
    )
    expect(temporarilyCollapsed.has('module:Morphir:IR.Distribution')).toBe(false)
    expect([...temporaryCollapse]).toEqual(['module:Morphir:IR.Distribution'])
    expect(effectiveExpandedIds('   ', normal, searchCollapsed, result.autoExpandedIds)).toBe(
      normal,
    )
  })

  test('rounds and clamps tree pane width to its declared bounds', () => {
    expect(TREE_PANE_BOUNDS).toEqual({ min: 220, max: 420 })
    expect(TREE_PANE_DEFAULT_WIDTH).toBe(280)
    expect(clampTreePaneWidth(100)).toBe(220)
    expect(clampTreePaneWidth(319.6)).toBe(320)
    expect(clampTreePaneWidth(900)).toBe(420)
  })
})
