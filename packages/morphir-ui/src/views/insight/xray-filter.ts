import type { XRaySearchScope, XRayTreeNode } from './xray-tree.ts'

export interface XRayFilterResult {
  readonly tree: readonly XRayTreeNode[]
  readonly matchPaths: readonly string[]
  readonly expandedPaths: ReadonlySet<string>
  readonly matchCount: number
}

const allScopes: readonly XRaySearchScope[] = ['kinds', 'fields', 'values', 'types']

const hasMatch = (node: XRayTreeNode, query: string, scopes: readonly XRaySearchScope[]): boolean =>
  scopes.some((scope) =>
    node.tokens[scope].some((token) => token.trim().toLocaleLowerCase().includes(query)),
  )

const filterNode = (
  node: XRayTreeNode,
  query: string,
  scopes: readonly XRaySearchScope[],
  matchPaths: string[],
  expandedPaths: Set<string>,
): XRayTreeNode | undefined => {
  const directMatch = hasMatch(node, query, scopes)
  if (directMatch) matchPaths.push(node.path)

  const children = node.children
    .map((child) => filterNode(child, query, scopes, matchPaths, expandedPaths))
    .filter((child): child is XRayTreeNode => child !== undefined)

  if (!directMatch && children.length === 0) return undefined

  expandedPaths.add(node.path)
  if (
    children.length === node.children.length &&
    children.every((child, index) => child === node.children[index])
  ) {
    return node
  }
  return { ...node, children }
}

export const filterXRayTree = (
  roots: readonly XRayTreeNode[],
  query: string,
  scopes: ReadonlySet<XRaySearchScope>,
): XRayFilterResult => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (normalizedQuery.length === 0) {
    return {
      tree: roots,
      matchPaths: [],
      expandedPaths: new Set(),
      matchCount: 0,
    }
  }

  const matchPaths: string[] = []
  const expandedPaths = new Set<string>()
  const selectedScopes = scopes.size === 0 ? allScopes : [...scopes]
  const tree = roots
    .map((root) => filterNode(root, normalizedQuery, selectedScopes, matchPaths, expandedPaths))
    .filter((root): root is XRayTreeNode => root !== undefined)

  return {
    tree,
    matchPaths,
    expandedPaths,
    matchCount: matchPaths.length,
  }
}
