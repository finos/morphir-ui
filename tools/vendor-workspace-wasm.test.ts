import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GENERATED_FILES,
  readGeneratedPackage,
  replaceGenerated,
  validateProvenance,
} from './vendor-workspace-wasm.ts'

const temporaryDirectories: Array<string> = []
const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'morphir-workspace-vendor-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const commit = 'a'.repeat(40)
const sha = 'b'.repeat(64)
const validProvenance = {
  crateVersion: '0.2.0',
  protocolVersion: 1 as const,
  rustSourceCommit: commit,
  wasmSha256: sha,
}

describe('workspace WASM provenance', () => {
  test('accepts a complete compatible provenance record', () => {
    expect(validateProvenance(validProvenance, commit, sha)).toEqual(validProvenance)
  })

  test('rejects an incompatible protocol before publication', () => {
    expect(() =>
      validateProvenance({ ...validProvenance, protocolVersion: 2 }, commit, sha),
    ).toThrow('protocolVersion')
  })

  test('rejects malformed fields and mismatches', () => {
    for (const [label, provenance, expectedCommit, expectedSha] of [
      ['object', null, commit, sha],
      ['crateVersion', { ...validProvenance, crateVersion: 'latest' }, commit, sha],
      ['rustSourceCommit', { ...validProvenance, rustSourceCommit: 'b2bffa8' }, commit, sha],
      ['wasmSha256', { ...validProvenance, wasmSha256: '265669d' }, commit, sha],
      ['Rust HEAD', validProvenance, '1111111111111111111111111111111111111111', sha],
      [
        'binary SHA-256',
        validProvenance,
        commit,
        '1111111111111111111111111111111111111111111111111111111111111111',
      ],
    ] as const) {
      expect(() => validateProvenance(provenance, expectedCommit, expectedSha), label).toThrow(
        label,
      )
    }
  })
})

describe('workspace WASM publication', () => {
  test('installs the exact buffers that were verified even if the source later changes', async () => {
    const root = await makeTemporaryDirectory()
    const sourcePackage = join(root, 'source')
    const packageDirectory = join(root, 'package')
    const generatedDirectory = join(packageDirectory, 'generated')

    for (const file of GENERATED_FILES) {
      await Bun.write(join(sourcePackage, file), `verified:${file}`)
    }
    const verifiedArtifacts = await readGeneratedPackage(sourcePackage)
    await Bun.write(join(sourcePackage, 'provenance.json'), 'changed after verification')

    await replaceGenerated(packageDirectory, generatedDirectory, verifiedArtifacts)

    expect(await Bun.file(join(generatedDirectory, 'provenance.json')).text()).toBe(
      'verified:provenance.json',
    )
  })
})
