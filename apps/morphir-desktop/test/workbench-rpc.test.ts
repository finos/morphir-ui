import { describe, expect, test } from 'bun:test'
import type { WorkbenchDescriptor } from '@morphir/ui/workbench'
import { sourceKey } from '@morphir/workspace'
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
    const revealed: string[] = []
    registerWorkbenchHandlers(registry, {
      inspect: async () => descriptor,
      pick: async () => '/picked.json',
      readModel: async () => ({ content: '{"formatVersion":3}', manifest: null }),
      inspectDevelopment: async () => ({
        configAnchor: null,
        modelSources: [],
        knowledgeBaseSources: [],
      }),
      reveal: async (source) => void revealed.push(source),
      takeInitialSources: () => ['/initial.json'],
    })

    expect(
      (
        await registry.dispatch({
          id: 1,
          method: 'morphir/workbench/inspect',
          params: { source: '/model.json' },
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
    ).toEqual({ source: '/picked.json' })
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
    ).toEqual({ sources: ['/initial.json'] })
    await registry.dispatch({
      id: 5,
      method: 'morphir/workbench/reveal',
      params: { source: '/model.json' },
    })
    expect(revealed).toEqual(['/model.json'])
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
    expect(response.error?.data).toBe('Workbench source is required')
  })
})
