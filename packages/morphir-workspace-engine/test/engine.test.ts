import { describe, expect, test } from 'bun:test'
import type { DiscoveryRequest, DiscoveryResponse } from '@morphir/workspace'
import { makeWorkspaceDiscoveryEngine } from '../src/index.ts'

interface CorpusCase {
  readonly name: string
  readonly request: DiscoveryRequest
  readonly expected: DiscoveryResponse
}

describe('portable workspace discovery engine', () => {
  test('matches every Rust conformance corpus case through the actual WebAssembly module', async () => {
    const generated = new URL('../generated/', import.meta.url)
    const corpus = (await Bun.file(
      new URL('workspace-discovery-corpus.json', generated),
    ).json()) as ReadonlyArray<CorpusCase>
    const bytes = await Bun.file(new URL('morphir_workspace_wasm_bg.wasm', generated)).arrayBuffer()
    const engine = await makeWorkspaceDiscoveryEngine(bytes)

    expect(corpus.length).toBeGreaterThan(0)
    for (const testCase of corpus) {
      expect(await engine.discover(testCase.request), testCase.name).toEqual(testCase.expected)
    }
  })
})
