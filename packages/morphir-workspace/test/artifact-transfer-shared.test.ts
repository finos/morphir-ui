import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Schema } from 'effect'
import { ARTIFACT_JSON_SCHEMAS } from '@morphir/workspace/artifact-transfer/schemas'
import {
  selectArtifactTransferProfile,
  captureArtifactGeneration,
  parseArtifactRequestId,
  decodeArtifactGenerateReply,
  captureArtifactRead,
  decodeArtifactReadReply,
  captureArtifactRelease,
  decodeArtifactReleaseReply,
  encodeArtifactReadRequest,
  encodeArtifactReleaseRequest,
  artifactChunkBytes,
} from '@morphir/workspace/artifact-transfer'
import { ConnectedSessionManifestSchema, PlaygroundGenerateResultSchema } from '../src/connected.ts'
import generated from './fixtures/artifacts/0.1.0-draft.1/generate-result.json'
import read from './fixtures/artifacts/0.1.0-draft.1/read-result.json'
import readRequest from './fixtures/artifacts/0.1.0-draft.1/read-request.json'
import released from './fixtures/artifacts/0.1.0-draft.1/release-result.json'
import releaseRequest from './fixtures/artifacts/0.1.0-draft.1/release-request.json'
import provenance from '../schemas/artifacts/0.1.0-draft.1/SOURCE.json'
import producerVersions from './fixtures/artifacts/0.1.0-draft.1/producer-version-boundaries.json'

test('exported structural schemas preserve the coordinated parent JSON values', () => {
  expect(Object.keys(ARTIFACT_JSON_SCHEMAS).length).toBe(6)
  expect(
    ARTIFACT_JSON_SCHEMAS.generateRequest.properties.generation.properties.options,
  ).toHaveProperty('type', 'object')
  for (const source of provenance.files) {
    const local = JSON.parse(
      readFileSync(
        new URL(`../schemas/artifacts/0.1.0-draft.1/${source.file}`, import.meta.url),
        'utf8',
      ),
    )
    expect(createHash('sha256').update(JSON.stringify(local)).digest('hex')).toBe(
      source.compactJsonSha256,
    )
  }
})

test('the shared empty-file request/result examples decode coherently without content conversion', () => {
  const selected = selectArtifactTransferProfile({
    id: 'playground',
    status: 'available',
    capabilities: [{ name: generated.profile, version: generated.contractVersion }],
  })
  if (!selected.ok) throw new Error(selected.error.code)
  const captured = captureArtifactGeneration(selected.value, {
    sessionId: generated.sessionId,
    target: generated.target,
    irVersion: generated.irVersion,
  })
  const id = parseArtifactRequestId(1)
  if (!captured.ok || !id.ok) throw new Error('Fixture capture failed')
  const ready = decodeArtifactGenerateReply(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: generated }),
    captured.value,
    id.value,
  )
  if (!ready.ok || ready.value.status !== 'ready') throw new Error('Shared manifest failed')
  const request = captureArtifactRead(
    ready.value,
    ready.value.artifacts[0]!.id,
    readRequest.offset,
    readRequest.maxBytes,
  )
  if (!request.ok) throw new Error(request.error.code)
  const encoded = encodeArtifactReadRequest(request.value, id.value)
  if (!encoded.ok) throw new Error(encoded.error.code)
  expect(JSON.parse(encoded.value).params).toEqual(readRequest)
  const chunk = decodeArtifactReadReply(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: read }),
    request.value,
    id.value,
  )
  if (!chunk.ok) throw new Error(chunk.error.code)
  expect(artifactChunkBytes(chunk.value).length).toBe(0)
  const release = captureArtifactRelease(ready.value)
  const encodedRelease = encodeArtifactReleaseRequest(release, id.value)
  if (!encodedRelease.ok) throw new Error(encodedRelease.error.code)
  expect(JSON.parse(encodedRelease.value).params).toEqual(releaseRequest)
  expect(
    decodeArtifactReleaseReply(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: released }),
      release,
      id.value,
    ).ok,
  ).toBe(true)
})

test('the additive profile leaves connected v1 manifests and generate schemas unchanged', () => {
  const host = {
    protocolVersion: 1,
    webSocketPath: '/rpc',
    sessionId: 'session-7',
    initialSources: [],
    providers: [
      {
        id: 'playground',
        name: 'Playground',
        kind: 'connected',
        status: 'available',
        capabilities: [
          { name: 'morphir/playground/generate', version: '1' },
          { name: generated.profile, version: generated.contractVersion },
        ],
      },
    ],
  }
  expect(Schema.decodeUnknownSync(ConnectedSessionManifestSchema)(host).protocolVersion).toBe(1)
  const old = {
    success: true,
    artifacts: [{ path: 'result.bin', content: 'AP8K', binary: true }],
    diagnostics: [],
  }
  const decoded = Schema.decodeUnknownSync(PlaygroundGenerateResultSchema)(old)
  expect(Object.keys(decoded.artifacts[0]!)).toEqual(['path', 'content', 'binary'])
  expect(decoded).toEqual(old)
  expect(
    selectArtifactTransferProfile({
      id: 'playground',
      status: 'available',
      capabilities: [host.providers[0]!.capabilities[0]!],
    }).ok,
  ).toBe(false)
})

test('shared producer-version boundaries preserve portable canonical SemVer exactly', () => {
  const fixture = provenance.semanticFixtures.find(
    (entry) => entry.file === 'producer-version-boundaries.json',
  )
  if (!fixture) throw new Error('Missing shared fixture provenance')
  expect(createHash('sha256').update(JSON.stringify(producerVersions)).digest('hex')).toBe(
    fixture.compactJsonSha256,
  )
  const selected = selectArtifactTransferProfile({
    id: 'playground',
    status: 'available',
    capabilities: [{ name: generated.profile, version: generated.contractVersion }],
  })
  if (!selected.ok) throw new Error(selected.error.code)
  const captured = captureArtifactGeneration(selected.value, {
    sessionId: generated.sessionId,
    target: generated.target,
    irVersion: generated.irVersion,
  })
  const id = parseArtifactRequestId(1)
  if (!captured.ok || !id.ok) throw new Error('Fixture capture failed')
  for (const entry of producerVersions.cases) {
    const result = decodeArtifactGenerateReply(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { ...generated, producer: { ...generated.producer, version: entry.version } },
      }),
      captured.value,
      id.value,
    )
    expect(result.ok).toBe(entry.accepted)
    if (result.ok) {
      if (result.value.status !== 'ready') throw new Error('Expected a ready manifest')
      expect<string>(result.value.producer.version).toBe(entry.version)
    } else {
      expect(result.error.kind).toBe('invalid')
    }
  }
})
