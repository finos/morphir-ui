import { decodeTypeExpr, nameToCamel, nameToTitle, type ValueDef } from '@morphir/ir'
import { typeText as formatTypeText } from '@morphir/insight'

export const XRAY_SEARCH_SCOPES = ['kinds', 'fields', 'values', 'types'] as const

export type XRaySearchScope = (typeof XRAY_SEARCH_SCOPES)[number]

export interface XRaySearchTokens {
  readonly kinds: readonly string[]
  readonly fields: readonly string[]
  readonly values: readonly string[]
  readonly types: readonly string[]
}

export interface XRayTreeNode {
  readonly path: string
  readonly label: string
  readonly kind?: string
  readonly scalar?: string
  readonly typeText?: string
  readonly warning?: string
  readonly tokens: XRaySearchTokens
  readonly children: readonly XRayTreeNode[]
}

const emptyTokens = (): XRaySearchTokens => ({ kinds: [], fields: [], values: [], types: [] })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isScalar = (value: unknown): value is string | number | boolean | null =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'

const isPrimitiveArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => isScalar(item) || isPrimitiveArray(item))

const scalarText = (value: unknown): string => JSON.stringify(value) ?? String(value)

const appendPath = (path: string, segment: string): string => `${path}/${pointerSegment(segment)}`

const fQNameText = (value: unknown): string | undefined => {
  if (!isRecord(value) || !isRecord(value['fqn'])) return undefined
  const fqn = value['fqn']
  const pkg = fqn['pkg']
  const module = fqn['module']
  const local = fqn['local']
  if (!isPrimitiveArray(pkg) || !isPrimitiveArray(module) || !isPrimitiveArray(local))
    return undefined
  if (!Array.isArray(pkg) || !Array.isArray(module) || !Array.isArray(local)) return undefined
  if (!pkg.every((part) => Array.isArray(part) && part.every((piece) => typeof piece === 'string')))
    return undefined
  if (
    !module.every((part) => Array.isArray(part) && part.every((piece) => typeof piece === 'string'))
  )
    return undefined
  if (!local.every((piece) => typeof piece === 'string')) return undefined
  const pathTitle = (parts: readonly unknown[]) =>
    parts.map((part) => nameToTitle(part as string[])).join('.')
  return [pathTitle(pkg), pathTitle(module), nameToCamel(local as string[])]
    .filter(Boolean)
    .join('.')
}

const decodedTypeText = (value: unknown): string | undefined => {
  if (!isRecord(value) || !('attr' in value)) return undefined
  const decoded = decodeTypeExpr(value['attr'])
  return decoded.kind === 'unknown' ? undefined : formatTypeText(decoded)
}

const makeNode = (
  value: unknown,
  label: string,
  path: string,
  project: (value: unknown, label: string, path: string) => XRayTreeNode,
): XRayTreeNode => {
  if (isScalar(value)) {
    const scalar = scalarText(value)
    return {
      path,
      label,
      scalar,
      tokens: { ...emptyTokens(), fields: [label], values: [scalar] },
      children: [],
    }
  }

  if (Array.isArray(value)) {
    if (isPrimitiveArray(value)) {
      const scalar = scalarText(value)
      return {
        path,
        label,
        scalar,
        tokens: { ...emptyTokens(), fields: [label], values: [scalar] },
        children: [],
      }
    }
    const children = value.map((item, index) =>
      project(item, `[${index}]`, appendPath(path, String(index))),
    )
    return { path, label, tokens: { ...emptyTokens(), fields: [label] }, children }
  }

  if (!isRecord(value)) {
    const scalar = scalarText(value)
    return {
      path,
      label,
      scalar,
      tokens: { ...emptyTokens(), fields: [label], values: [scalar] },
      children: [],
    }
  }

  const kind = typeof value['kind'] === 'string' ? value['kind'] : undefined
  const typeText = decodedTypeText(value)
  const fqn = fQNameText(value)
  const warning =
    kind === 'unknown'
      ? `Unknown node ${String(value['tag'] ?? '<unknown>')}: raw unavailable in xray`
      : undefined
  const children =
    kind === 'unknown'
      ? []
      : Object.entries(value)
          .filter(([key]) => key !== 'kind' && key !== 'attr' && key !== 'raw' && key !== 'tag')
          .map(([key, child]) => projectChild(child, key, appendPath(path, key), project))

  return {
    path,
    label,
    ...(kind ? { kind } : {}),
    ...(typeText ? { typeText } : {}),
    ...(warning ? { warning } : {}),
    tokens: {
      kinds: kind ? [kind] : [],
      fields: [label],
      values: fqn ? [fqn] : [],
      types: typeText ? [typeText] : [],
    },
    children,
  }
}

const projectChild = (
  value: unknown,
  label: string,
  path: string,
  project: (value: unknown, label: string, path: string) => XRayTreeNode,
): XRayTreeNode => project(value, label, path)

export const pointerSegment = (segment: string): string =>
  segment.replaceAll('~', '~0').replaceAll('/', '~1')

export const projectXRayValue = (value: unknown, label: string, path: string): XRayTreeNode =>
  makeNode(value, label, path, projectXRayValue)

const sectionNode = (
  label: string,
  path: string,
  children: readonly XRayTreeNode[],
): XRayTreeNode => ({
  path,
  label,
  tokens: { ...emptyTokens(), fields: [label] },
  children,
})

export const projectXRayDefinition = (def: ValueDef): readonly XRayTreeNode[] => [
  sectionNode(
    'inputs',
    '/inputs',
    def.inputs.map((input, index) =>
      projectXRayValue(input, nameToCamel(input.name), `/inputs/${index}`),
    ),
  ),
  projectXRayValue(def.output, 'output', '/output'),
  projectXRayValue(def.body, 'body', '/body'),
]

export const findXRayNode = (
  roots: readonly XRayTreeNode[],
  path: string,
): XRayTreeNode | undefined => {
  for (const root of roots) {
    if (root.path === path) return root
    const found = findXRayNode(root.children, path)
    if (found) return found
  }
  return undefined
}
