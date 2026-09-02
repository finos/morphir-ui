import { XRAY_SEARCH_SCOPES, type XRaySearchScope, type XRayTreeNode } from './xray-tree.ts'

export interface XRayFilterResult {
  readonly tree: readonly XRayTreeNode[]
  /** Direct matches in deterministic depth-first pre-order. */
  readonly matchPaths: readonly string[]
  /** Retained paths: direct matches and the ancestor context needed to locate them. */
  readonly expandedPaths: ReadonlySet<string>
  readonly matchCount: number
}

const hasMatch = (node: XRayTreeNode, query: string, scopes: readonly XRaySearchScope[]): boolean =>
  scopes.some((scope) =>
    node.tokens[scope].some((token) => token.trim().toLowerCase().includes(query)),
  )

interface FilterFrame {
  readonly node: XRayTreeNode
  readonly directMatch: boolean
  readonly retainedChildren: XRayTreeNode[]
  childIndex: number
}

const filterRoot = (
  node: XRayTreeNode,
  query: string,
  scopes: readonly XRaySearchScope[],
  matchPaths: string[],
  expandedPaths: Set<string>,
): XRayTreeNode | undefined => {
  const stack: FilterFrame[] = []
  let result: XRayTreeNode | undefined
  const enter = (child: XRayTreeNode): void => {
    const directMatch = hasMatch(child, query, scopes)
    if (directMatch) matchPaths.push(child.path)
    stack.push({ node: child, directMatch, retainedChildren: [], childIndex: 0 })
  }

  enter(node)
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    if (frame === undefined) break
    const child = frame.node.children[frame.childIndex]
    if (child !== undefined) {
      frame.childIndex += 1
      enter(child)
      continue
    }

    stack.pop()
    if (!frame.directMatch && frame.retainedChildren.length === 0) continue

    expandedPaths.add(frame.node.path)
    const children = frame.retainedChildren
    const retainedAllChildren =
      children.length === frame.node.children.length &&
      children.every((retainedChild, index) => retainedChild === frame.node.children[index])
    const filteredNode = retainedAllChildren ? frame.node : { ...frame.node, children }

    const parent = stack[stack.length - 1]
    if (parent === undefined) result = filteredNode
    else parent.retainedChildren.push(filteredNode)
  }

  return result
}

export const filterXRayTree = (
  roots: readonly XRayTreeNode[],
  query: string,
  scopes: ReadonlySet<XRaySearchScope>,
): XRayFilterResult => {
  const normalizedQuery = query.trim().toLowerCase()
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
  const selectedScopes = scopes.size === 0 ? XRAY_SEARCH_SCOPES : [...scopes]
  const tree = roots
    .map((root) => filterRoot(root, normalizedQuery, selectedScopes, matchPaths, expandedPaths))
    .filter((root): root is XRayTreeNode => root !== undefined)

  return {
    tree,
    matchPaths,
    expandedPaths,
    matchCount: matchPaths.length,
  }
}
