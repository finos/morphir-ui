import type { MorphirLibrary, WorkspaceIr } from '@morphir/ir'

export type WorkbenchId = string
export type ModelRoute = 'overview' | 'explorer'
export type DevelopmentRoute = 'overview'

export interface WorkbenchBase {
  readonly id: WorkbenchId
  readonly source: string
  readonly name: string
  readonly openedAt: string
  readonly lastUsedAt: string
}

export interface ModelWorkbenchDescriptor extends WorkbenchBase {
  readonly kind: 'model'
  readonly distribution: 'single-file' | 'document-tree'
  readonly route: ModelRoute
}

export interface DevelopmentWorkbenchDescriptor extends WorkbenchBase {
  readonly kind: 'development'
  readonly route: DevelopmentRoute
}

export type WorkbenchDescriptor = ModelWorkbenchDescriptor | DevelopmentWorkbenchDescriptor

export interface ModelWorkbenchData {
  readonly kind: 'model'
  readonly descriptor: ModelWorkbenchDescriptor
  readonly library: MorphirLibrary | null
  readonly ir: WorkspaceIr | null
  readonly manifest: Readonly<Record<string, unknown>> | null
}

export interface DevelopmentWorkbenchData {
  readonly kind: 'development'
  readonly descriptor: DevelopmentWorkbenchDescriptor
  readonly configAnchor: string | null
  readonly modelSources: ReadonlyArray<string>
  readonly knowledgeBaseSources: ReadonlyArray<string>
}

export type WorkbenchData = ModelWorkbenchData | DevelopmentWorkbenchData

export type WorkbenchEntry =
  | { readonly descriptor: WorkbenchDescriptor; readonly status: 'loading' }
  | {
      readonly descriptor: WorkbenchDescriptor
      readonly status: 'ready'
      readonly data: WorkbenchData
    }
  | {
      readonly descriptor: WorkbenchDescriptor
      readonly status: 'error'
      readonly message: string
    }

export const sourceName = (source: string): string =>
  source
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .at(-1) || source

export const legacyModelDescriptor = (source: string): ModelWorkbenchDescriptor => ({
  id: source,
  source,
  name: sourceName(source),
  kind: 'model',
  distribution: 'single-file',
  route: 'overview',
  openedAt: new Date(0).toISOString(),
  lastUsedAt: new Date(0).toISOString(),
})
