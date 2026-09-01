import type { ModelWorkbenchData } from './types.ts'

export type WorkbenchRecoveryReason =
  | { readonly tag: 'provider-disconnected'; readonly message: string }
  | { readonly tag: 'permission-required'; readonly message: string }
  | { readonly tag: 'load-failed'; readonly message: string }

export interface UsableProjectModel {
  readonly model: ModelWorkbenchData
  readonly selectedDefinitionId: string | null
}

export type ProjectModelState =
  | { readonly tag: 'unloaded' }
  | { readonly tag: 'loading'; readonly lastUsable: UsableProjectModel | null }
  | { readonly tag: 'ready'; readonly current: UsableProjectModel }
  | {
      readonly tag: 'failed'
      readonly failure: WorkbenchRecoveryReason
      readonly lastUsable: UsableProjectModel | null
    }

export const unloadedProjectModel = (): ProjectModelState => ({ tag: 'unloaded' })

const usableProjectModel = (state: ProjectModelState): UsableProjectModel | null => {
  switch (state.tag) {
    case 'unloaded':
      return null
    case 'loading':
    case 'failed':
      return state.lastUsable
    case 'ready':
      return state.current
  }
}

export const beginProjectModelLoad = (state: ProjectModelState): ProjectModelState => ({
  tag: 'loading',
  lastUsable: usableProjectModel(state),
})

export const completeProjectModelLoad = (
  state: ProjectModelState,
  model: ModelWorkbenchData,
): ProjectModelState => ({
  tag: 'ready',
  current: {
    model,
    selectedDefinitionId: usableProjectModel(state)?.selectedDefinitionId ?? null,
  },
})

export const failProjectModelLoad = (
  state: ProjectModelState,
  failure: WorkbenchRecoveryReason,
): ProjectModelState => ({
  tag: 'failed',
  failure,
  lastUsable: usableProjectModel(state),
})

export const selectProjectDefinition = (
  state: ProjectModelState,
  selectedDefinitionId: string | null,
): ProjectModelState => {
  switch (state.tag) {
    case 'unloaded':
      return state
    case 'loading':
      return state.lastUsable
        ? { ...state, lastUsable: { ...state.lastUsable, selectedDefinitionId } }
        : state
    case 'ready':
      return { ...state, current: { ...state.current, selectedDefinitionId } }
    case 'failed':
      return state.lastUsable
        ? { ...state, lastUsable: { ...state.lastUsable, selectedDefinitionId } }
        : state
  }
}

export const projectModelForDisplay = (state: ProjectModelState): ModelWorkbenchData | null =>
  usableProjectModel(state)?.model ?? null

export const projectModelSelection = (state: ProjectModelState): string | null =>
  usableProjectModel(state)?.selectedDefinitionId ?? null

export const recoveryActionLabel = (reason: WorkbenchRecoveryReason): string => {
  switch (reason.tag) {
    case 'provider-disconnected':
      return 'Reconnect'
    case 'permission-required':
      return 'Grant access'
    case 'load-failed':
      return 'Retry'
  }
}
