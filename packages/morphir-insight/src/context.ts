import { pathToTitle, type FQName, type MorphirLibrary } from '@morphir/ir'

export interface InsightContext {
  readonly library: MorphirLibrary
  readonly expanded: ReadonlySet<string>
  readonly path: readonly string[]
}

export const makeContext = (library: MorphirLibrary, expanded: ReadonlySet<string> = new Set()): InsightContext => ({
  library,
  expanded,
  path: []
})

export const fqnKey = (fqn: FQName): string =>
  `${pathToTitle(fqn.pkg)}:${pathToTitle(fqn.module)}:${fqn.local.join('-')}`

export const isSdkFqn = (fqn: FQName): boolean =>
  JSON.stringify(fqn.pkg) === JSON.stringify([['morphir'], ['s', 'd', 'k']])
