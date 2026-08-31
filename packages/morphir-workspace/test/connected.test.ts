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
})
