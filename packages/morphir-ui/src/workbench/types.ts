import type { MorphirLibrary, WorkspaceIr } from '@morphir/ir'
import { sourceKey, type WorkbenchSourceRef, type WorkspaceSnapshot } from '@morphir/workspace'
import type { ProjectModelState, WorkbenchRecoveryReason } from './project-model-state.ts'

export type WorkbenchId = string
export type ModelRoute = 'overview' | 'explorer'
export type DevelopmentRoute = 'overview'

export interface WorkbenchBase {
  readonly id: WorkbenchId
  readonly source: WorkbenchSourceRef
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
  readonly snapshot: WorkspaceSnapshot
}

export interface DevelopmentProjectModelEntry {
  readonly projectId: string
  readonly modelState: ProjectModelState
}

export interface DevelopmentNavigationState {
  readonly activeProjectId: string | null
  readonly projects: ReadonlyArray<DevelopmentProjectModelEntry>
}

export type WorkbenchData = ModelWorkbenchData | DevelopmentWorkbenchData

export type WorkbenchEntry =
  | { readonly descriptor: WorkbenchDescriptor; readonly status: 'loading' }
  | {
      readonly descriptor: ModelWorkbenchDescriptor
      readonly status: 'ready'
      readonly data: ModelWorkbenchData
    }
  | {
      readonly descriptor: DevelopmentWorkbenchDescriptor
      readonly status: 'ready'
      readonly data: DevelopmentWorkbenchData
    }
  | {
      readonly descriptor: DevelopmentWorkbenchDescriptor
      readonly status: 'unavailable'
      readonly data: DevelopmentWorkbenchData
      readonly reason: WorkbenchRecoveryReason
    }
  | {
      readonly descriptor: WorkbenchDescriptor
      readonly status: 'error'
      readonly reason: WorkbenchRecoveryReason
    }

export const sourceName = (source: WorkbenchSourceRef): string => source.displayName

const sourceDisplayName = (locator: string): string =>
  locator
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .at(-1) || locator

export const legacySourceRef = (
  locator: string,
  providerId = 'legacy-local',
): WorkbenchSourceRef => ({
  providerId,
  locator,
  displayName: sourceDisplayName(locator),
})

export const legacyModelDescriptor = (
  locator: string,
  providerId?: string,
): ModelWorkbenchDescriptor => {
  const source = legacySourceRef(locator, providerId)
  return {
    id: sourceKey(source),
    source,
    name: sourceName(source),
    kind: 'model',
    distribution: 'single-file',
    route: 'overview',
    openedAt: new Date(0).toISOString(),
    lastUsedAt: new Date(0).toISOString(),
  }
}
