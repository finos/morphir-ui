import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  DiscoveryRequestSchema,
  FileTreeSchema,
  projectKey,
  type DiscoveryRequest,
  type WorkbenchSourceRef,
} from '../src/index.ts'

const root: WorkbenchSourceRef = {
  providerId: 'browser-local',
  locator: 'directory:41',
  displayName: 'orders',
}

const typeLevelRequestBoundary = (): void => {
  const minimal: DiscoveryRequest = {
    protocolVersion: 1,
    developmentRoot: { entries: { '.': { kind: 'directory' } } },
  }
  void minimal

  const nonJson: DiscoveryRequest = {
    protocolVersion: 1,
    developmentRoot: { entries: { '.': { kind: 'directory' } } },
    // @ts-expect-error functions are not valid JSON request values
    cliOverlay: () => undefined,
  }
  void nonJson
}
void typeLevelRequestBoundary

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

  test('file-tree decoder rejects every non-confined entry key instead of dropping it', () => {
    for (const path of ['../x', 'a//b', 'C:/x', String.raw`a\b`]) {
      expect(
        () =>
          Schema.decodeUnknownSync(FileTreeSchema)({
            entries: { [path]: { kind: 'directory' } },
          }),
        path,
      ).toThrow()
    }
  })

  test('file-tree decoder preserves root and normalized confined paths', () => {
    const tree = Schema.decodeUnknownSync(FileTreeSchema)({
      entries: {
        '.': { kind: 'directory' },
        'packages/orders': { kind: 'directory' },
        'packages/orders/morphir.toml': { kind: 'file', text: '[project]' },
      },
    })

    expect(Object.keys(tree.entries)).toEqual([
      '.',
      'packages/orders',
      'packages/orders/morphir.toml',
    ])
  })

  test('omitted optional request fields decode to the Rust serde defaults', () => {
    const minimalRequest: DiscoveryRequest = {
      protocolVersion: 1,
      developmentRoot: { entries: { '.': { kind: 'directory' } } },
    }

    expect(Schema.decodeUnknownSync(DiscoveryRequestSchema)(minimalRequest)).toEqual({
      ...minimalRequest,
      morphirHome: null,
      systemConfig: null,
      environment: {},
      cliOverlay: null,
    })
  })

  test('CLI overlay accepts JSON values and rejects non-JSON data', () => {
    const request = {
      protocolVersion: 1,
      developmentRoot: { entries: { '.': { kind: 'directory' } } },
    }
    for (const cliOverlay of [
      null,
      true,
      42,
      'text',
      ['nested', { enabled: false }],
      { project: { name: 'orders' } },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(DiscoveryRequestSchema)({ ...request, cliOverlay }),
      ).not.toThrow()
    }

    for (const cliOverlay of [() => undefined, Symbol('overlay'), { invalid: undefined }, NaN]) {
      expect(
        () => Schema.decodeUnknownSync(DiscoveryRequestSchema)({ ...request, cliOverlay }),
        String(cliOverlay),
      ).toThrow()
    }
  })
})
