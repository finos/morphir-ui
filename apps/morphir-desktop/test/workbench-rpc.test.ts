import { describe, expect, test } from 'bun:test'
import type { WorkbenchDescriptor } from '@morphir/ui/workbench'
import { sourceKey, type WorkbenchSourceRef } from '@morphir/workspace'
import { RpcRegistry } from '../src/main/rpc.ts'
import { registerWorkbenchHandlers } from '../src/main/workbench-rpc.ts'

const timestamp = '2026-08-29T12:00:00.000Z'
const descriptor: WorkbenchDescriptor = {
  id: sourceKey({ providerId: 'desktop-local', locator: '/model.json', displayName: 'model.json' }),
  source: { providerId: 'desktop-local', locator: '/model.json', displayName: 'model.json' },
  name: 'model.json',
  kind: 'model',
  distribution: 'single-file',
  route: 'overview',
  openedAt: timestamp,
  lastUsedAt: timestamp,
}

describe('Workbench RPC handlers', () => {
  test('dispatches inspection, picker, loading, reveal, and initial sources', async () => {
    const registry = new RpcRegistry()
    const revealed: WorkbenchSourceRef[] = []
    registerWorkbenchHandlers(registry, {
      inspect: async () => descriptor,
      pick: async () => ({
        providerId: 'desktop-local',
        locator: '/picked.json',
        displayName: 'picked.json',
      }),
      readModel: async () => ({ content: '{"formatVersion":3}', manifest: null }),
      inspectDevelopment: async () => ({
        configAnchor: null,
        modelSources: [],
        knowledgeBaseSources: [],
      }),
      reveal: async (source) => void revealed.push(source),
      takeInitialSources: () => [
        {
          providerId: 'desktop-local',
          locator: '/initial.json',
          displayName: 'initial.json',
        },
      ],
    })

    expect(
      (
        await registry.dispatch({
          id: 1,
          method: 'morphir/workbench/inspect',
          params: { source: descriptor.source },
        })
      ).result,
    ).toEqual(descriptor)
    expect(
      (
        await registry.dispatch({
          id: 2,
          method: 'morphir/workbench/pick',
          params: { kind: 'model-file' },
        })
      ).result,
    ).toEqual({
      source: {
        providerId: 'desktop-local',
        locator: '/picked.json',
        displayName: 'picked.json',
      },
    })
    expect(
      (
        await registry.dispatch({
          id: 3,
          method: 'morphir/workbench/readModel',
          params: { descriptor },
        })
      ).result,
    ).toEqual({ content: '{"formatVersion":3}', manifest: null })
    expect(
      (
        await registry.dispatch({
          id: 4,
          method: 'morphir/workbench/initialSources',
        })
      ).result,
    ).toEqual({
      sources: [
        {
          providerId: 'desktop-local',
          locator: '/initial.json',
          displayName: 'initial.json',
        },
      ],
    })
    await registry.dispatch({
      id: 5,
      method: 'morphir/workbench/reveal',
      params: { source: descriptor.source },
    })
    expect(revealed).toEqual([descriptor.source])
  })

  test('rejects malformed params through the existing wire error contract', async () => {
    const registry = new RpcRegistry()
    registerWorkbenchHandlers(registry, {
      inspect: async () => descriptor,
      pick: async () => null,
      readModel: async () => ({ content: null, manifest: null }),
      inspectDevelopment: async () => ({
        configAnchor: null,
        modelSources: [],
        knowledgeBaseSources: [],
      }),
      reveal: async () => undefined,
      takeInitialSources: () => [],
    })

    const response = await registry.dispatch({
      id: 1,
      method: 'morphir/workbench/inspect',
      params: {},
    })
    expect(response.error?.data).toBe('Qualified Workbench source is required')
  })

  test('rejects foreign descriptors before invoking desktop host loaders', async () => {
    const registry = new RpcRegistry()
    let readCalls = 0
    let developmentCalls = 0
    let inspectCalls = 0
    let revealCalls = 0
    registerWorkbenchHandlers(registry, {
      inspect: async () => {
        inspectCalls += 1
        return descriptor
      },
      pick: async () => null,
      readModel: async () => {
        readCalls += 1
        return { content: null, manifest: null }
      },
      inspectDevelopment: async () => {
        developmentCalls += 1
        return { configAnchor: null, modelSources: [], knowledgeBaseSources: [] }
      },
      reveal: async () => void (revealCalls += 1),
      takeInitialSources: () => [],
    })
    const foreignSource = { ...descriptor.source, providerId: 'cli:session-1' }
    const modelResponse = await registry.dispatch({
      id: 1,
      method: 'morphir/workbench/readModel',
      params: {
        descriptor: { ...descriptor, id: sourceKey(foreignSource), source: foreignSource },
      },
    })
    const developmentResponse = await registry.dispatch({
      id: 2,
      method: 'morphir/workbench/inspectDevelopment',
      params: {
        descriptor: {
          ...descriptor,
          id: sourceKey(foreignSource),
          source: foreignSource,
          kind: 'development',
          route: 'overview',
        },
      },
    })
    const inspectResponse = await registry.dispatch({
      id: 3,
      method: 'morphir/workbench/inspect',
      params: { source: foreignSource },
    })
    const revealResponse = await registry.dispatch({
      id: 4,
      method: 'morphir/workbench/reveal',
      params: { source: foreignSource },
    })

    expect(modelResponse.error?.data).toBe(
      'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    )
    expect(developmentResponse.error?.data).toBe(
      'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    )
    expect(inspectResponse.error?.data).toBe(
      'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    )
    expect(revealResponse.error?.data).toBe(
      'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    )
    expect(readCalls).toBe(0)
    expect(developmentCalls).toBe(0)
    expect(inspectCalls).toBe(0)
    expect(revealCalls).toBe(0)
  })
})
