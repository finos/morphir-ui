import type { MorphirLibrary } from './decode.ts'
import { nameToCamel, nameToTitle, pathToTitle } from './names.ts'

export interface PackageInfo {
  readonly name: string
  readonly moduleCount: number
}
export interface ModuleInfo {
  readonly packageName: string
  readonly name: string
  readonly typeCount: number
  readonly valueCount: number
}
export type DefinitionKind = 'type' | 'value'
export interface DefinitionRef {
  readonly packageName: string
  readonly moduleName: string
  readonly localName: string
}
export interface DefinitionInfo {
  readonly ref: DefinitionRef
  readonly kind: DefinitionKind
  readonly access: 'Public' | 'Private'
  readonly doc: string | null
}
export interface WorkspaceIr {
  readonly package: PackageInfo
  readonly modules: ReadonlyArray<ModuleInfo>
  readonly definitions: ReadonlyArray<DefinitionInfo>
}

export const toWorkspaceIr = (lib: MorphirLibrary): WorkspaceIr => {
  const packageName = pathToTitle(lib.packageName)
  const modules = lib.modules.map((m) => ({
    packageName,
    name: pathToTitle(m.path),
    typeCount: m.types.length,
    valueCount: m.values.length,
  }))
  const definitions = lib.modules.flatMap((m) => {
    const moduleName = pathToTitle(m.path)
    const mk = (kind: DefinitionKind) => (entry: (typeof m.types)[number]) => ({
      ref: {
        packageName,
        moduleName,
        localName: kind === 'type' ? nameToTitle(entry.name) : nameToCamel(entry.name),
      },
      kind,
      access: entry.access,
      doc: entry.doc,
    })
    return [...m.types.map(mk('type')), ...m.values.map(mk('value'))]
  })
  return { package: { name: packageName, moduleCount: modules.length }, modules, definitions }
}
