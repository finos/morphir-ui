import { describe, expect, test } from 'bun:test'
import type { DiscoveryRequest, DiscoveryResponse } from '@morphir/workspace'
import { makeWorkspaceDiscoveryEngine } from '../src/index.ts'

interface CorpusCase {
  readonly name: string
  readonly request: DiscoveryRequest
  readonly expected: DiscoveryResponse
}

const loadWasmBytes = (): Promise<ArrayBuffer> =>
  Bun.file(new URL('../generated/morphir_workspace_wasm_bg.wasm', import.meta.url)).arrayBuffer()

const withEmptyCustomSection = (bytes: ArrayBuffer): Uint8Array<ArrayBuffer> => {
  const extended = new Uint8Array(bytes.byteLength + 3)
  extended.set(new Uint8Array(bytes))
  extended.set([0, 1, 0], bytes.byteLength)
  return extended
}

describe('portable workspace discovery engine', () => {
  test('retries initialization after a rejected module', async () => {
    const bytes = await loadWasmBytes()

    await expect(makeWorkspaceDiscoveryEngine(new Uint8Array([0]))).rejects.toThrow()
    expect(await makeWorkspaceDiscoveryEngine(bytes)).toBeDefined()
  })

  test('matches every Rust conformance corpus case through the actual WebAssembly module', async () => {
    const generated = new URL('../generated/', import.meta.url)
    const corpus = (await Bun.file(
      new URL('workspace-discovery-corpus.json', generated),
    ).json()) as ReadonlyArray<CorpusCase>
    const bytes = await loadWasmBytes()
    const engine = await makeWorkspaceDiscoveryEngine(bytes)

    expect(corpus.length).toBeGreaterThan(0)
    for (const testCase of corpus) {
      expect(await engine.discover(testCase.request), testCase.name).toEqual(testCase.expected)
    }
  })

  test('reuses one initialized engine for byte-identical modules', async () => {
    const bytes = await loadWasmBytes()

    expect(await makeWorkspaceDiscoveryEngine(bytes.slice(0))).toBe(
      await makeWorkspaceDiscoveryEngine(bytes.slice(0)),
    )
  })

  test('rejects a second valid WebAssembly module with different bytes', async () => {
    const bytes = await loadWasmBytes()
    await makeWorkspaceDiscoveryEngine(bytes)

    await expect(makeWorkspaceDiscoveryEngine(withEmptyCustomSection(bytes))).rejects.toThrow(
      'different WebAssembly bytes',
    )
  })
})
