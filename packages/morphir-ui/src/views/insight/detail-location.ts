import type { DefinitionInfo } from '@morphir/ir'
import type { DetailView } from '../../state/shell-constants.ts'

export interface DetailLocation {
  readonly definition: string
  readonly view?: DetailView
  readonly node?: string
}

export type DetailResolution =
  | { readonly kind: 'pending' }
  | { readonly kind: 'resolved' }
  | { readonly kind: 'invalid-definition'; readonly definition: string }
  | {
      readonly kind: 'invalid-node'
      readonly definition: string
      readonly node: string
    }

export const definitionFqn = (info: DefinitionInfo): string =>
  `${info.ref.packageName}.${info.ref.moduleName}.${info.ref.localName}`

export const definitionForFqn = (
  definitions: readonly DefinitionInfo[],
  fqn: string,
): DefinitionInfo | null => {
  const matches = definitions.filter((info) => definitionFqn(info) === fqn)
  return matches.length === 1 ? matches[0]! : null
}
