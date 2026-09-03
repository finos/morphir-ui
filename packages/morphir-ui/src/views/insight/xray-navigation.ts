import type { XRayTreeNode } from './xray-tree.ts'

export type XRayKeyAction =
  | { readonly kind: 'focus'; readonly path: string }
  | { readonly kind: 'expand'; readonly path: string }
  | { readonly kind: 'collapse'; readonly path: string }
  | { readonly kind: 'select'; readonly path: string }
  | { readonly kind: 'handled' }
  | { readonly kind: 'none' }

const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'])

export interface VisibleXRayRow {
  readonly node: XRayTreeNode
  readonly path: string
  readonly parentPath: string | null
  readonly level: number
}

interface PendingXRayRow {
  readonly node: XRayTreeNode
  readonly parentPath: string | null
  readonly level: number
}

interface XRayAncestryFrame {
  readonly node: XRayTreeNode
  readonly parent: XRayAncestryFrame | null
}

export const visibleXRayRows = (
  roots: readonly XRayTreeNode[],
  expanded: ReadonlySet<string>,
): readonly VisibleXRayRow[] => {
  const rows: VisibleXRayRow[] = []
  const stack: PendingXRayRow[] = []

  for (let index = roots.length - 1; index >= 0; index -= 1) {
    stack.push({ node: roots[index]!, parentPath: null, level: 1 })
  }

  while (stack.length > 0) {
    const current = stack.pop()!
    rows.push({
      node: current.node,
      path: current.node.path,
      parentPath: current.parentPath,
      level: current.level,
    })
    if (!expanded.has(current.node.path)) continue
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: current.node.children[index]!,
        parentPath: current.node.path,
        level: current.level + 1,
      })
    }
  }

  return rows
}

export const xrayAncestorPaths = (
  roots: readonly XRayTreeNode[],
  targetPath: string,
): readonly string[] | undefined => {
  const stack: XRayAncestryFrame[] = []
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    stack.push({ node: roots[index]!, parent: null })
  }

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.node.path === targetPath) {
      const ancestors: string[] = []
      let parent = current.parent
      while (parent) {
        ancestors.push(parent.node.path)
        parent = parent.parent
      }
      ancestors.reverse()
      return ancestors
    }
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: current.node.children[index]!, parent: current })
    }
  }

  return undefined
}

export const xrayKeyAction = (
  rows: readonly VisibleXRayRow[],
  currentPath: string,
  key: string,
  expanded: ReadonlySet<string>,
): XRayKeyAction => {
  const index = rows.findIndex((row) => row.path === currentPath)
  if (index < 0) return { kind: 'none' }
  const current = rows[index]!

  if (key === 'ArrowDown' && index < rows.length - 1)
    return { kind: 'focus', path: rows[index + 1]!.path }
  if (key === 'ArrowUp' && index > 0) return { kind: 'focus', path: rows[index - 1]!.path }
  if (key === 'Home' && rows[0]) return { kind: 'focus', path: rows[0].path }
  if (key === 'End' && rows.at(-1)) return { kind: 'focus', path: rows.at(-1)!.path }
  if (key === 'ArrowRight' && current.node.children.length > 0) {
    return expanded.has(current.path)
      ? { kind: 'focus', path: current.node.children[0]!.path }
      : { kind: 'expand', path: current.path }
  }
  if (key === 'ArrowLeft') {
    if (current.node.children.length > 0 && expanded.has(current.path))
      return { kind: 'collapse', path: current.path }
    if (current.parentPath) return { kind: 'focus', path: current.parentPath }
  }
  if (key === 'Enter' || key === ' ') return { kind: 'select', path: current.path }
  if (NAVIGATION_KEYS.has(key)) return { kind: 'handled' }
  return { kind: 'none' }
}
