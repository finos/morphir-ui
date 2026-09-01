import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  CONNECTED_METHODS,
  CONNECTED_PROTOCOL_VERSION,
  ConnectedInitializeParamsSchema,
  ConnectedSessionManifestSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcNotificationSchema,
  JsonRpcRequestSchema,
  JsonRpcSuccessResponseSchema,
  ProjectModelOpenParamsSchema,
  ProjectModelOpenResultSchema,
  WorkspaceEventNotificationParamsSchema,
} from '../src/index.ts'

const manifest = {
  protocolVersion: 1,
  webSocketPath: '/rpc',
  sessionId: 'session-1',
  providers: [
    {
      id: 'cli:session-1',
      name: 'Morphir CLI',
      kind: 'connected',
      status: 'available',
      capabilities: [
        { name: 'morphir/development/inspect', version: '1' },
        { name: 'morphir/project-model/open', version: '1' },
        { name: 'morphir/workspace/open', version: '1' },
        { name: 'morphir/workspace/watch', version: '1' },
      ],
    },
  ],
  initialSources: [
    {
      providerId: 'cli:session-1',
      locator: 'workspace:initial',
      displayName: 'orders',
    },
  ],
} as const

// A Playground-style provider: it serves compile/generate over an in-memory
// scratch buffer, owns no workspace sources, and has no business
// implementing workspace operations. Unlike the CLI provider above, it
// deliberately does not carry any of the four core workbench capabilities.
const playgroundProvider = {
  id: 'playground:session-1',
  name: 'Morphir Playground',
  kind: 'connected',
  status: 'available',
  capabilities: [
    { name: 'morphir/playground/catalog', version: '1' },
    { name: 'morphir/playground/compile', version: '1' },
    { name: 'morphir/playground/generate', version: '1' },
  ],
} as const

describe('connected host protocol', () => {
  test('decodes the protocol-v1 connected session manifest', () => {
    expect(CONNECTED_PROTOCOL_VERSION).toBe(1)
    expect(Schema.decodeUnknownSync(ConnectedSessionManifestSchema)(manifest)).toEqual(manifest)
  })

  test('rejects incompatible versions and unsafe websocket locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        protocolVersion: 2,
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        webSocketPath: 'wss://attacker.example/rpc',
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        webSocketPath: '/\\localhost:9999/rpc',
      }),
    ).toThrow()
  })

  test('rejects connected providers without every protocol-v1 capability', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        providers: [{ ...manifest.providers[0], capabilities: [] }],
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        providers: [
          {
            ...manifest.providers[0],
            capabilities: manifest.providers[0].capabilities.map((capability) =>
              capability.name === 'morphir/workspace/watch'
                ? { ...capability, version: '2' }
                : capability,
            ),
          },
        ],
      }),
    ).toThrow()
  })

  test('decodes a manifest whose only provider owns no initial sources and lacks the core capabilities', () => {
    const playgroundOnlyManifest = {
      protocolVersion: 1,
      webSocketPath: '/rpc',
      sessionId: 'session-1',
      providers: [playgroundProvider],
      initialSources: [],
    } as const

    expect(Schema.decodeUnknownSync(ConnectedSessionManifestSchema)(playgroundOnlyManifest)).toEqual(
      playgroundOnlyManifest,
    )
  })

  test('decodes a manifest mixing a source-owning workspace provider with a source-less playground provider', () => {
    const mixedManifest = {
      ...manifest,
      providers: [...manifest.providers, playgroundProvider],
    } as const

    expect(Schema.decodeUnknownSync(ConnectedSessionManifestSchema)(mixedManifest)).toEqual(mixedManifest)
  })

  test('rejects an initial source owned by a provider missing a core capability', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        providers: [...manifest.providers, playgroundProvider],
        initialSources: [{ ...manifest.initialSources[0], providerId: playgroundProvider.id }],
      }),
    ).toThrow()
  })

  test('rejects duplicate provider IDs and sources owned by unknown providers', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        providers: [...manifest.providers, { ...manifest.providers[0] }],
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ConnectedSessionManifestSchema)({
        ...manifest,
        initialSources: [{ ...manifest.initialSources[0], providerId: 'cli:other' }],
      }),
    ).toThrow()
  })

  test('decodes request, success, error, and notification envelopes', () => {
    expect(
      Schema.decodeUnknownSync(JsonRpcRequestSchema)({
        jsonrpc: '2.0',
        id: 1,
        method: CONNECTED_METHODS.initialize,
        params: { protocolVersion: 1, sessionId: 'session-1' },
      }).id,
    ).toBe(1)
    expect(
      Schema.decodeUnknownSync(JsonRpcSuccessResponseSchema)({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: 1 },
      }).result,
    ).toEqual({ protocolVersion: 1 })
    expect(
      Schema.decodeUnknownSync(JsonRpcErrorResponseSchema)({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'Invalid params', data: null },
      }).error.code,
    ).toBe(-32602)
    expect(
      Schema.decodeUnknownSync(JsonRpcNotificationSchema)({
        jsonrpc: '2.0',
        method: CONNECTED_METHODS.workspaceEvent,
        params: {
          subscriptionId: 'watch-1',
          event: { tag: 'provider-disconnected', providerId: 'cli:session-1', message: 'closed' },
        },
      }).method,
    ).toBe(CONNECTED_METHODS.workspaceEvent)
  })

  test('defines typed initialization and workspace-event payloads', () => {
    expect(
      Schema.decodeUnknownSync(ConnectedInitializeParamsSchema)({
        protocolVersion: 1,
        sessionId: 'session-1',
      }),
    ).toEqual({ protocolVersion: 1, sessionId: 'session-1' })

    expect(() =>
      Schema.decodeUnknownSync(WorkspaceEventNotificationParamsSchema)({
        subscriptionId: 'watch-1',
        event: { tag: 'snapshot', snapshot: { state: 'open' } },
      }),
    ).toThrow()
  })

  test('defines strict project-model open payloads', () => {
    const source = manifest.initialSources[0]
    expect(
      Schema.decodeUnknownSync(ProjectModelOpenParamsSchema)({
        source,
        projectId: '["cli:session-1","workspace:initial","."]',
      }),
    ).toEqual({
      source,
      projectId: '["cli:session-1","workspace:initial","."]',
    })

    const result = {
      descriptor: {
        id: '["cli:session-1","model:orders"]',
        source: {
          providerId: 'cli:session-1',
          locator: 'model:orders',
          displayName: 'orders / morphir-ir.json',
        },
        name: 'orders',
        kind: 'model',
        distribution: 'single-file',
        route: 'explorer',
        openedAt: '2026-08-31T12:00:00.000Z',
        lastUsedAt: '2026-08-31T12:00:00.000Z',
      },
      content: '{"formatVersion":3}',
    } as const
    expect(Schema.decodeUnknownSync(ProjectModelOpenResultSchema)(result)).toEqual(result)
    expect(() =>
      Schema.decodeUnknownSync(ProjectModelOpenParamsSchema)({ source, projectId: '' }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ProjectModelOpenResultSchema)({
        ...result,
        descriptor: { ...result.descriptor, route: 'overview' },
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ProjectModelOpenResultSchema)({ ...result, content: '' }),
    ).toThrow()
  })
})
