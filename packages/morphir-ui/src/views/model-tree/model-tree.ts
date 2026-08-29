import type { DefinitionInfo, WorkspaceIr } from '@morphir/ir'

export const TREE_PANE_BOUNDS = { min: 220, max: 420 } as const
export const TREE_PANE_DEFAULT_WIDTH = 280

interface TreeNodeBase {
  readonly id: string
  readonly label: string
  readonly parentId: string | null
}

export interface DefinitionTreeNode extends TreeNodeBase {
  readonly kind: 'type' | 'value'
  readonly info: DefinitionInfo
  readonly children: readonly []
}

export interface ModuleTreeNode extends TreeNodeBase {
  readonly kind: 'module'
  readonly typeCount: number
  readonly valueCount: number
  readonly children: ReadonlyArray<DefinitionTreeNode>
}

export interface PackageTreeNode extends TreeNodeBase {
  readonly kind: 'package'
  readonly moduleCount: number
  readonly children: ReadonlyArray<ModuleTreeNode>
}

export type ModelTreeNode = PackageTreeNode | ModuleTreeNode | DefinitionTreeNode
export type ModelTreeBranch = PackageTreeNode | ModuleTreeNode

export interface VisibleTreeRow {
  readonly node: ModelTreeNode
  readonly level: number
}

export const packageNodeId = (packageName: string): string => `package:${packageName}`

export const moduleNodeId = (packageName: string, moduleName: string): string =>
  `module:${packageName}:${moduleName}`

export const definitionNodeId = (info: DefinitionInfo): string =>
  `definition:${info.kind}:${info.ref.packageName}:${info.ref.moduleName}:${info.ref.localName}`

export const isTreeBranch = (node: ModelTreeNode): node is ModelTreeBranch =>
  node.kind === 'package' || node.kind === 'module'

export const projectModelTree = (ir: WorkspaceIr): ReadonlyArray<PackageTreeNode> => {
  const packageId = packageNodeId(ir.package.name)
  const modules = ir.modules.map((module): ModuleTreeNode => {
    const id = moduleNodeId(module.packageName, module.name)
    const children = ir.definitions
      .filter(
        (definition) =>
          definition.ref.packageName === module.packageName &&
          definition.ref.moduleName === module.name,
      )
      .map((info): DefinitionTreeNode => ({
        id: definitionNodeId(info),
        kind: info.kind,
        label: info.ref.localName,
        parentId: id,
        info,
        children: [],
      }))

    return {
      id,
      kind: 'module',
      label: module.name,
      parentId: packageId,
      typeCount: module.typeCount,
      valueCount: module.valueCount,
      children,
    }
  })

  return [
    {
      id: packageId,
      kind: 'package',
      label: ir.package.name,
      parentId: null,
      moduleCount: ir.package.moduleCount,
      children: modules,
    },
  ]
}

export const defaultExpandedIds = (roots: ReadonlyArray<PackageTreeNode>): ReadonlySet<string> =>
  new Set(roots.flatMap((root) => [root.id, ...(root.children[0] ? [root.children[0].id] : [])]))

export const flattenVisibleTree = (
  roots: ReadonlyArray<PackageTreeNode>,
  expandedIds: ReadonlySet<string>,
): ReadonlyArray<VisibleTreeRow> => {
  const rows: VisibleTreeRow[] = []
  const visit = (node: ModelTreeNode, level: number): void => {
    rows.push({ node, level })
    if (isTreeBranch(node) && expandedIds.has(node.id)) {
      for (const child of node.children) visit(child, level + 1)
    }
  }

  for (const root of roots) visit(root, 1)
  return rows
}

export const clampTreePaneWidth = (width: number): number =>
  Math.max(TREE_PANE_BOUNDS.min, Math.min(TREE_PANE_BOUNDS.max, Math.round(width)))

export interface ModelTreeFilter {
  readonly query: string
  readonly showTypes: boolean
  readonly showValues: boolean
}

export interface FilteredModelTree {
  readonly roots: ReadonlyArray<PackageTreeNode>
  readonly matchCount: number
  readonly moduleCount: number
  readonly matchedIds: ReadonlyArray<string>
  readonly countById: ReadonlyMap<string, number>
  readonly autoExpandedIds: ReadonlySet<string>
}

const normalizeQuery = (value: string): string => value.trim().toLowerCase()

const labelMatches = (label: string, query: string): boolean =>
  query.length > 0 && label.toLowerCase().includes(query)

export const filterModelTree = (
  roots: ReadonlyArray<PackageTreeNode>,
  filter: ModelTreeFilter,
): FilteredModelTree => {
  const query = normalizeQuery(filter.query)
  const matchedIds = new Set<string>()
  const countById = new Map<string, number>()
  const autoExpandedIds = new Set<string>()
  const matchedModuleIds = new Set<string>()

  const definitionAllowed = (node: DefinitionTreeNode): boolean =>
    node.kind === 'type' ? filter.showTypes : filter.showValues

  const filterModule = (module: ModuleTreeNode): ModuleTreeNode | null => {
    const ownMatch = labelMatches(module.label, query)
    if (ownMatch) matchedIds.add(module.id)

    const children = module.children.filter(
      (child) => definitionAllowed(child) && (!query || labelMatches(child.label, query)),
    )
    if (query) {
      for (const child of children) matchedIds.add(child.id)
    }

    if (query && !ownMatch && children.length === 0) return null
    if (query) {
      countById.set(module.id, Number(ownMatch) + children.length)
      matchedModuleIds.add(module.id)
      if (children.length > 0) autoExpandedIds.add(module.id)
    }

    return { ...module, children }
  }

  const filterPackage = (pkg: PackageTreeNode): PackageTreeNode | null => {
    const ownMatch = labelMatches(pkg.label, query)
    if (ownMatch) matchedIds.add(pkg.id)

    const children = pkg.children.flatMap((module) => {
      const filteredModule = filterModule(module)
      return filteredModule ? [filteredModule] : []
    })

    if (query && !ownMatch && children.length === 0) return null
    if (query) {
      const descendantMatchCount = children.reduce(
        (sum, module) => sum + (countById.get(module.id) ?? 0),
        0,
      )
      countById.set(pkg.id, Number(ownMatch) + descendantMatchCount)
      if (children.length > 0) autoExpandedIds.add(pkg.id)
    }

    return { ...pkg, children }
  }

  const filteredRoots = roots.flatMap((root) => {
    const filteredRoot = filterPackage(root)
    return filteredRoot ? [filteredRoot] : []
  })

  return {
    roots: filteredRoots,
    matchCount: matchedIds.size,
    moduleCount: matchedModuleIds.size,
    matchedIds: [...matchedIds],
    countById,
    autoExpandedIds,
  }
}

export const effectiveExpandedIds = (
  query: string,
  normalExpandedIds: ReadonlySet<string>,
  searchCollapsedIds: ReadonlySet<string>,
  autoExpandedIds: ReadonlySet<string>,
): ReadonlySet<string> => {
  if (!normalizeQuery(query)) return normalExpandedIds
  return new Set([...autoExpandedIds].filter((id) => !searchCollapsedIds.has(id)))
}
