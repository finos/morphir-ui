import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { DiscoveryRequestSchema, projectKey, type WorkbenchSourceRef } from '../src/index.ts'

const root: WorkbenchSourceRef = {
  providerId: 'browser-local',
  locator: 'directory:41',
  displayName: 'orders',
}

describe('portable workspace discovery', () => {
  test('project identity includes provider, root locator, and relative path', () => {
    expect(projectKey(root, 'packages/orders')).toBe(
      JSON.stringify(['browser-local', 'directory:41', 'packages/orders']),
    )
  })

  test('wire decoder rejects a protocol version other than one', () => {
    expect(() =>
      Schema.decodeUnknownSync(DiscoveryRequestSchema)({
        protocolVersion: 2,
        developmentRoot: { entries: { '.': { kind: 'directory' } } },
        morphirHome: null,
        systemConfig: null,
        environment: {},
        cliOverlay: {},
      }),
    ).toThrow()
  })
})
