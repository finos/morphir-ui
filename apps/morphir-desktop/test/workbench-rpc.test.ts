import { describe, expect, test } from 'bun:test'
import type { WorkbenchDescriptor } from '@morphir/ui/workbench'
import { sourceKey, type WorkbenchSourceRef, type WorkspaceSnapshot } from '@morphir/workspace'
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
const developmentSource = {
  providerId: 'desktop-local',
  locator: '/workspace',
  displayName: 'workspace',
}
const developmentDescriptor = {
  id: sourceKey(developmentSource),
  source: developmentSource,
  name: 'workspace',
  kind: 'development' as const,
  route: 'overview' as const,
  openedAt: timestamp,
  lastUsedAt: timestamp,
}
const developmentSnapshot: WorkspaceSnapshot = {
  id: sourceKey(developmentSource),
  root: developmentSource,
  name: 'Payments workspace',
  configAnchor: '.config/morphir/config.toml',
  state: 'error',
  projects: [
    {
      id: JSON.stringify(['desktop-local', '/workspace', '.']),
      name: 'payments',
      version: '2.0.0',
      relativePath: '.',
      configAnchor: 'morphir.toml',
      sourceDirectory: 'src',
      state: 'unloaded',
      modelSources: [
        {
          providerId: 'desktop-local',
          locator: '/workspace/.morphir-dist',
          displayName: '.morphir-dist',
        },
      ],
      knowledgeBaseSources: [],
      diagnostics: [
        {
          severity: 'warning',
          code: 'workspace.project.warning',
          message: 'Project warning',
          path: 'morphir.toml',
          projectId: JSON.stringify(['desktop-local', '/workspace', '.']),
        },
      ],
    },
    {
      id: JSON.stringify(['desktop-local', '/workspace', 'packages/risk']),
      name: 'risk',
      version: null,
      relativePath: 'packages/risk',
      configAnchor: 'packages/risk/morphir.yaml',
      sourceDirectory: 'packages/risk/src',
      state: 'error',
      modelSources: [],
      knowledgeBaseSources: [
        {
          providerId: 'desktop-local',
          locator: '/workspace/packages/risk/knowledge',
          displayName: 'knowledge',
        },
      ],
      diagnostics: [],
    },
  ],
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: [
    {
      severity: 'error',
      code: 'workspace.project.invalid',
      message: 'A project is invalid',
      path: 'packages/risk/morphir.yaml',
      projectId: JSON.stringify(['desktop-local', '/workspace', 'packages/risk']),
    },
  ],
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
      inspectDevelopment: async () => developmentSnapshot,
      readProjectModel: async () => ({ descriptor, content: '{"formatVersion":3}' }),
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
          id: 6,
          method: 'morphir/workbench/inspectDevelopment',
          params: { descriptor: developmentDescriptor },
        })
      ).result,
    ).toEqual(developmentSnapshot)
    expect(
      (
        await registry.dispatch({
          id: 7,
          method: 'morphir/workbench/readProjectModel',
          params: { descriptor: developmentDescriptor, projectId: developmentSnapshot.projects[0]!.id },
        })
      ).result,
    ).toEqual({ descriptor, content: '{"formatVersion":3}' })
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
      inspectDevelopment: async () => developmentSnapshot,
      readProjectModel: async () => ({ descriptor, content: '{"formatVersion":3}' }),
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

  test('rejects a foreign source returned by the desktop picker', async () => {
    const registry = new RpcRegistry()
    registerWorkbenchHandlers(registry, {
      inspect: async () => descriptor,
      pick: async () => ({ ...descriptor.source, providerId: 'cli:session-1' }),
      readModel: async () => ({ content: null, manifest: null }),
      inspectDevelopment: async () => developmentSnapshot,
      readProjectModel: async () => ({ descriptor, content: '{"formatVersion":3}' }),
      reveal: async () => undefined,
      takeInitialSources: () => [],
    })

    const response = await registry.dispatch({
      id: 1,
      method: 'morphir/workbench/pick',
      params: { kind: 'model-file' },
    })

    expect(response.error?.data).toBe(
      'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    )
  })

  test('rejects foreign descriptors before invoking desktop host loaders', async () => {
    const registry = new RpcRegistry()
    let readCalls = 0
    let developmentCalls = 0
    let projectCalls = 0
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
        return developmentSnapshot
      },
      readProjectModel: async () => {
        projectCalls += 1
        return { descriptor, content: '{"formatVersion":3}' }
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
    const projectResponse = await registry.dispatch({
      id: 5,
      method: 'morphir/workbench/readProjectModel',
      params: {
        descriptor: {
          ...developmentDescriptor,
          id: sourceKey(foreignSource),
          source: foreignSource,
        },
        projectId: developmentSnapshot.projects[0]!.id,
      },
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
    expect(projectResponse.error?.data).toBe(
      'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    )
    expect(readCalls).toBe(0)
    expect(developmentCalls).toBe(0)
    expect(projectCalls).toBe(0)
    expect(inspectCalls).toBe(0)
    expect(revealCalls).toBe(0)
  })
})
