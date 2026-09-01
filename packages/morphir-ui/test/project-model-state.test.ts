import { describe, expect, test } from 'vitest'
import {
  beginProjectModelLoad,
  completeProjectModelLoad,
  failProjectModelLoad,
  projectModelForDisplay,
  projectModelSelection,
  recoveryActionLabel,
  selectProjectDefinition,
  unloadedProjectModel,
} from '../src/workbench/project-model-state.ts'
import { legacyModelDescriptor, type ModelWorkbenchData } from '../src/workbench/types.ts'

const model: ModelWorkbenchData = {
  kind: 'model',
  descriptor: legacyModelDescriptor('/development/packages/orders/morphir-ir.json'),
  library: null,
  ir: null,
  manifest: null,
}

describe('project model state', () => {
  test('starts loading without inventing usable model data', () => {
    expect(beginProjectModelLoad(unloadedProjectModel())).toEqual({
      tag: 'loading',
      lastUsable: null,
    })
  })

  test('retains the last usable model through loading and failure', () => {
    const ready = completeProjectModelLoad(beginProjectModelLoad(unloadedProjectModel()), model)
    const refreshing = beginProjectModelLoad(ready)
    const failed = failProjectModelLoad(refreshing, {
      tag: 'permission-required',
      message: 'Read permission was revoked',
    })

    expect(projectModelForDisplay(ready)).toBe(model)
    expect(projectModelForDisplay(refreshing)).toBe(model)
    expect(projectModelForDisplay(failed)).toBe(model)
    expect(failed).toMatchObject({
      tag: 'failed',
      failure: { tag: 'permission-required' },
    })
  })

  test('keeps definition selection with every usable retained model', () => {
    const ready = completeProjectModelLoad(unloadedProjectModel(), model)
    const selected = selectProjectDefinition(ready, 'definition:orders')
    const loading = beginProjectModelLoad(selected)
    const failed = failProjectModelLoad(loading, {
      tag: 'load-failed',
      message: 'Compilation failed',
    })

    expect(projectModelSelection(selected)).toBe('definition:orders')
    expect(projectModelSelection(loading)).toBe('definition:orders')
    expect(projectModelSelection(failed)).toBe('definition:orders')
  })

  test('ignores definition selection until a usable model exists', () => {
    const unloaded = selectProjectDefinition(unloadedProjectModel(), 'definition:orders')

    expect(unloaded).toEqual({ tag: 'unloaded' })
    expect(projectModelSelection(unloaded)).toBeNull()
  })

  test('an initial failure has no displayable model', () => {
    const failed = failProjectModelLoad(beginProjectModelLoad(unloadedProjectModel()), {
      tag: 'load-failed',
      message: 'morphir-ir.json was not found',
    })

    expect(projectModelForDisplay(failed)).toBeNull()
    expect(projectModelSelection(failed)).toBeNull()
  })

  test('derives recovery actions from tags instead of message text', () => {
    expect(recoveryActionLabel({ tag: 'provider-disconnected', message: 'anything' })).toBe(
      'Reconnect',
    )
    expect(recoveryActionLabel({ tag: 'permission-required', message: 'anything' })).toBe(
      'Grant access',
    )
    expect(recoveryActionLabel({ tag: 'load-failed', message: 'anything' })).toBe('Retry')
  })
})
