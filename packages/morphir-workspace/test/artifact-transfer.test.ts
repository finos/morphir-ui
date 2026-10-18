import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import recipes from './fixtures/artifact-byte-recipes.json'
import {
  ARTIFACT_PROFILE,
  ARTIFACT_CONTRACT_VERSION,
  captureArtifactGeneration,
  selectArtifactTransferProfile,
  parseArtifactRequestId,
  decodeArtifactGenerateReply,
  captureArtifactRead,
  decodeArtifactReadReply,
  artifactChunkBytes,
  captureArtifactRelease,
  decodeArtifactReleaseReply,
  encodeArtifactReadRequest,
  encodeArtifactReleaseRequest,
} from '../src/artifact-transfer.ts'

const provider = {
  id: 'playground',
  status: 'available' as const,
  capabilities: [{ name: 'morphir/workbench/artifacts', version: '0.1.0-draft.1' }],
}
const ready = {
  status: 'ready',
  profile: 'morphir/workbench/artifacts',
  contractVersion: '0.1.0-draft.1',
  sessionId: 'session-7',
  providerId: 'playground',
  generationId: 'generation-1',
  producer: { id: 'qualified-binary-fixture', version: '0.1.0' },
  target: 'fixture',
  irVersion: '4',
  artifacts: [
    {
      id: 'artifact-1',
      path: 'empty.bin',
      kind: 'binary',
      byteLength: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
  ],
  diagnostics: [],
}

test('exact provider selection and captured context decode an immutable empty-file manifest', () => {
  expect(String(ARTIFACT_PROFILE)).toBe(ready.profile)
  expect(String(ARTIFACT_CONTRACT_VERSION)).toBe(ready.contractVersion)
  const selected = selectArtifactTransferProfile(provider)
  if (!selected.ok) throw new Error(selected.error.code)
  const captured = captureArtifactGeneration(selected.value, {
    sessionId: 'session-7',
    target: 'fixture',
    irVersion: '4',
  })
  if (!captured.ok) throw new Error(captured.error.code)
  const request = parseArtifactRequestId(7)
  if (!request.ok) throw new Error(request.error.code)
  const decoded = decodeArtifactGenerateReply(
    JSON.stringify({ jsonrpc: '2.0', id: 7, result: ready }),
    captured.value,
    request.value,
  )
  if (!decoded.ok) throw new Error(decoded.error.code)
  expect(decoded.value.status).toBe('ready')
  if (decoded.value.status !== 'ready') throw new Error('Expected ready')
  expect(Number(decoded.value.artifacts[0]?.byteLength)).toBe(0)
  expect(Object.isFrozen(decoded.value)).toBe(true)
  expect(Object.isFrozen(decoded.value.artifacts[0])).toBe(true)
})

function context() {
  const selected = selectArtifactTransferProfile(provider)
  if (!selected.ok) throw new Error(selected.error.code)
  const capture = captureArtifactGeneration(selected.value, {
    sessionId: 'session-7',
    target: 'fixture',
    irVersion: '4',
  })
  const request = parseArtifactRequestId(7)
  if (!capture.ok || !request.ok) throw new Error('Fixture capture failed')
  return { capture: capture.value, requestId: request.value }
}

test('a profile RPC error is preserved as a remote failure without legacy regeneration', () => {
  const { capture, requestId } = context()
  const result = decodeArtifactGenerateReply(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: -32602,
        message: 'Capacity exhausted.',
        data: {
          profile: ARTIFACT_PROFILE,
          contractVersion: ARTIFACT_CONTRACT_VERSION,
          code: 'artifacts.capacity',
        },
      },
    }),
    capture,
    requestId,
  )
  expect(result).toEqual({
    ok: false,
    error: {
      kind: 'remote',
      rpcCode: -32602,
      message: 'Capacity exhausted.',
      code: 'artifacts.capacity',
    },
  })
})

test('a captured bounded read accepts exact canonical bytes and EOF', () => {
  const { capture, requestId } = context()
  const result = decodeArtifactGenerateReply(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      result: {
        ...ready,
        artifacts: [
          {
            ...ready.artifacts[0],
            byteLength: 3,
            sha256: '26a66b061e8f48f39927c312f25293959729eee95978e2892d49d3512a5cc092',
          },
        ],
      },
    }),
    capture,
    requestId,
  )
  if (!result.ok || result.value.status !== 'ready') throw new Error('Fixture manifest failed')
  const manifest = result.value
  const read = captureArtifactRead(manifest, manifest.artifacts[0]!.id, 0, 65536)
  if (!read.ok) throw new Error(read.error.code)
  const decoded = decodeArtifactReadReply(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      result: {
        profile: ARTIFACT_PROFILE,
        contractVersion: ARTIFACT_CONTRACT_VERSION,
        generationId: 'generation-1',
        artifactId: 'artifact-1',
        offset: 0,
        nextOffset: 3,
        content: 'AAH/',
      },
    }),
    read.value,
    requestId,
  )
  if (!decoded.ok) throw new Error(decoded.error.code)
  expect([...artifactChunkBytes(decoded.value)]).toEqual([0, 1, 255])
  const bytes = artifactChunkBytes(decoded.value)
  bytes[0] = 99
  expect([...artifactChunkBytes(decoded.value)]).toEqual([0, 1, 255])
  const eof = captureArtifactRead(manifest, manifest.artifacts[0]!.id, 3, 1)
  if (!eof.ok) throw new Error(eof.error.code)
  const empty = decodeArtifactReadReply(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      result: {
        profile: ARTIFACT_PROFILE,
        contractVersion: ARTIFACT_CONTRACT_VERSION,
        generationId: 'generation-1',
        artifactId: 'artifact-1',
        offset: 3,
        nextOffset: 3,
        content: '',
      },
    }),
    eof.value,
    requestId,
  )
  expect(empty.ok).toBe(true)
})

test('selection rejects absent, disconnected, noncanonical and other exact drafts', () => {
  expect(selectArtifactTransferProfile({ ...provider, capabilities: [] }).ok).toBe(false)
  expect(selectArtifactTransferProfile({ ...provider, status: 'disconnected' }).ok).toBe(false)
  for (const version of ['1', '0.1.0', '0.1.0-draft.2', 'v0.1.0-draft.1', '0.1.0-draft.1+extra']) {
    expect(
      selectArtifactTransferProfile({
        ...provider,
        capabilities: [{ name: ARTIFACT_PROFILE, version }],
      }).ok,
    ).toBe(false)
  }
})

test('raw duplicate, escaped-duplicate, private-marker and malformed-string evidence is rejected', () => {
  const { capture, requestId } = context()
  const frame = JSON.stringify({ jsonrpc: '2.0', id: 7, result: ready })
  const cases = [
    frame.replace('"id":7', '"id":7,"id":7'),
    frame.replace('"byteLength":0', '"byteLength":0,"byteLength":0'),
    frame.replace('"byteLength":0', '"byteLength":0,"byte\\u004cength":0'),
    frame.replace(
      '"id":"qualified-binary-fixture"',
      '"id":"qualified-binary-fixture","id":"qualified-binary-fixture"',
    ),
    frame.replace('"byteLength":0', '"byteLength":{"$serde_json::private::Number":"0"}'),
    frame.replace('empty.bin', '\\ud800.bin'),
    frame.replace('empty.bin', '\\udfff.bin'),
    frame.replace('empty.bin', '\\x00.bin'),
    frame.replace('empty.bin', 'unescaped\n.bin'),
    frame.slice(0, -1),
    frame + '{}',
    frame.replace('"id":7', '"id":07'),
  ]
  for (const raw of cases)
    expect(decodeArtifactGenerateReply(raw, capture, requestId).ok).toBe(false)
})

test('mathematical integer spellings are checked without floating-point rounding or underflow', () => {
  const { capture, requestId } = context()
  const frame = JSON.stringify({ jsonrpc: '2.0', id: 7, result: ready })
  for (const token of ['0.0', '-0', '-0.0e999999999999999999999', '0e400']) {
    expect(
      decodeArtifactGenerateReply(
        frame.replace('"byteLength":0', `"byteLength":${token}`),
        capture,
        requestId,
      ).ok,
    ).toBe(true)
  }
  for (const token of ['1.0', '1e0', '10e-1', '0.0100e2', '167772160e-1']) {
    expect(
      decodeArtifactGenerateReply(
        frame.replace('"byteLength":0', `"byteLength":${token}`),
        capture,
        requestId,
      ).ok,
    ).toBe(true)
  }
  for (const token of [
    '1.00000000000000000001',
    '1e-400',
    '-1e-400',
    '1e400',
    '0.00000000000000000001',
    '-1',
    '16777217',
    '16777216.00000000000001',
    'null',
    'true',
    '"0"',
  ]) {
    expect(
      decodeArtifactGenerateReply(
        frame.replace('"byteLength":0', `"byteLength":${token}`),
        capture,
        requestId,
      ).ok,
    ).toBe(false)
  }
})

test('manifests bind the entire context and reject unknown, unsafe or dishonest metadata', () => {
  const { capture, requestId } = context()
  const mutations = [
    { ...ready, extra: true },
    { ...ready, sessionId: 'other' },
    { ...ready, providerId: 'other' },
    { ...ready, target: 'other' },
    { ...ready, irVersion: '3' },
    { ...ready, generationId: '' },
    { ...ready, generationId: '\u007f' },
    { ...ready, generationId: 'é'.repeat(65) },
    { ...ready, profile: 'other' },
    { ...ready, contractVersion: '0.1.0-draft.2' },
    { ...ready, producer: { id: 'fixture', version: 'v1.0.0' } },
    { ...ready, artifacts: [{ ...ready.artifacts[0], sha256: 'A'.repeat(64) }] },
    { ...ready, artifacts: [{ ...ready.artifacts[0], path: '../escape.bin' }] },
    { ...ready, artifacts: [{ ...ready.artifacts[0], kind: 'base64' }] },
    { ...ready, artifacts: [ready.artifacts[0], { ...ready.artifacts[0], path: 'other.bin' }] },
    {
      ...ready,
      artifacts: [ready.artifacts[0], { ...ready.artifacts[0], id: 'other', path: 'EMPTY.bin' }],
    },
    {
      ...ready,
      artifacts: [
        { ...ready.artifacts[0], path: 'Dir/a' },
        { ...ready.artifacts[0], id: 'other', path: 'dir/b' },
      ],
    },
    {
      ...ready,
      artifacts: Array.from({ length: 257 }, (_, index) => ({
        ...ready.artifacts[0],
        id: `a-${index}`,
        path: `${index}.bin`,
      })),
    },
    {
      ...ready,
      artifacts: Array.from({ length: 5 }, (_, index) => ({
        ...ready.artifacts[0],
        id: `a-${index}`,
        path: `${index}.bin`,
        byteLength: 16777216,
      })),
    },
  ]
  for (const result of mutations)
    expect(
      decodeArtifactGenerateReply(
        JSON.stringify({ jsonrpc: '2.0', id: 7, result }),
        capture,
        requestId,
      ).ok,
    ).toBe(false)
  const fourFiles = {
    ...ready,
    artifacts: Array.from({ length: 4 }, (_, index) => ({
      ...ready.artifacts[0],
      id: `a-${index}`,
      path: `${index}.bin`,
      byteLength: 16777216,
    })),
  }
  expect(
    decodeArtifactGenerateReply(
      JSON.stringify({ jsonrpc: '2.0', id: 7, result: fourFiles }),
      capture,
      requestId,
    ).ok,
  ).toBe(true)
})

test('failed generation stays distinct from a ready inventory and requires the closed diagnostic shape', () => {
  const { capture, requestId } = context()
  const failed = {
    status: 'failed',
    profile: ARTIFACT_PROFILE,
    contractVersion: ARTIFACT_CONTRACT_VERSION,
    diagnostics: [
      { severity: 'error', code: 'artifacts.capacity', message: 'No capacity.', location: null },
    ],
  }
  const result = decodeArtifactGenerateReply(
    JSON.stringify({ jsonrpc: '2.0', id: 7, result: failed }),
    capture,
    requestId,
  )
  expect(result.ok && result.value.status === 'failed').toBe(true)
  for (const mutation of [
    { ...failed, artifacts: [] },
    { ...failed, diagnostics: [{ severity: 'error', message: 'No capacity.' }] },
    { ...failed, diagnostics: [{ ...failed.diagnostics[0], severity: 'fatal' }] },
  ])
    expect(
      decodeArtifactGenerateReply(
        JSON.stringify({ jsonrpc: '2.0', id: 7, result: mutation }),
        capture,
        requestId,
      ).ok,
    ).toBe(false)
})

test('exact reply budgets and u64 correlation refuse rounded, extra or mismatched framing', () => {
  const { capture, requestId } = context()
  const frame = JSON.stringify({ jsonrpc: '2.0', id: 7, result: ready })
  expect(
    decodeArtifactGenerateReply(frame + ' '.repeat(131072 - frame.length), capture, requestId).ok,
  ).toBe(true)
  const over = decodeArtifactGenerateReply(
    frame + ' '.repeat(131073 - frame.length),
    capture,
    requestId,
  )
  expect(over.ok ? null : over.error.code).toBe('artifacts.reply_limit')
  for (const id of ['8', '7.0', '7e0', '-0', 'null', '"7"'])
    expect(
      decodeArtifactGenerateReply(frame.replace('"id":7', `"id":${id}`), capture, requestId).ok,
    ).toBe(false)
  const largest = parseArtifactRequestId(18446744073709551615n)
  if (!largest.ok) throw new Error(largest.error.code)
  expect(
    decodeArtifactGenerateReply(
      frame.replace('"id":7', '"id":18446744073709551615'),
      capture,
      largest.value,
    ).ok,
  ).toBe(true)
  for (const input of [18446744073709551616n, Number.MAX_SAFE_INTEGER + 1, -1, 1.5, '01', '1e0'])
    expect(parseArtifactRequestId(input).ok).toBe(false)
})

test('release acknowledges only the captured request and preserves its generation identity', () => {
  const { capture, requestId } = context()
  const result = decodeArtifactGenerateReply(
    JSON.stringify({ jsonrpc: '2.0', id: 7, result: ready }),
    capture,
    requestId,
  )
  if (!result.ok || result.value.status !== 'ready') throw new Error('Fixture manifest failed')
  const release = captureArtifactRelease(result.value)
  const decoded = decodeArtifactReleaseReply(
    '{"jsonrpc":"2.0","id":7,"result":{}}',
    release,
    requestId,
  )
  if (!decoded.ok) throw new Error(decoded.error.code)
  expect(String(decoded.value.generationId)).toBe('generation-1')
  const request = encodeArtifactReleaseRequest(release, requestId)
  if (!request.ok) throw new Error(request.error.code)
  expect(JSON.parse(request.value)).toEqual({
    jsonrpc: '2.0',
    id: 7,
    method: 'morphir.artifacts.release',
    params: {
      contractVersion: ARTIFACT_CONTRACT_VERSION,
      generationId: 'generation-1',
    },
  })
  const read = captureArtifactRead(result.value, result.value.artifacts[0]!.id, 0, 1)
  if (!read.ok) throw new Error(read.error.code)
  expect(encodeArtifactReadRequest(read.value, requestId).ok).toBe(true)
})

test('raw chunk decoding preserves independent fixed byte recipes across exact chunk boundaries', () => {
  const { capture, requestId } = context()
  for (const fixture of recipes.recipes) {
    const recipe = fixture.recipe
    const bytes =
      recipe.kind === 'hex'
        ? new Uint8Array(Buffer.from(recipe.hex!, 'hex'))
        : Uint8Array.from(
            { length: recipe.length! },
            (_, index) =>
              (index % 256) ^
              (recipe.kind === 'chunk-indexed-u8'
                ? (Math.floor(index / 65536) + recipe.seed!) % 256
                : 0),
          )
    const result = decodeArtifactGenerateReply(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        result: {
          ...ready,
          artifacts: [
            {
              ...ready.artifacts[0],
              kind: fixture.kind,
              byteLength: fixture.byteLength,
              sha256: fixture.sha256,
            },
          ],
        },
      }),
      capture,
      requestId,
    )
    if (!result.ok || result.value.status !== 'ready')
      throw new Error(`Recipe manifest failed: ${fixture.id}`)
    const manifest = result.value
    const actual = new Uint8Array(fixture.byteLength)
    for (const window of fixture.sequentialReads) {
      const read = captureArtifactRead(
        manifest,
        manifest.artifacts[0]!.id,
        window.offset,
        window.maxBytes,
      )
      if (!read.ok) throw new Error(read.error.code)
      const reply = decodeArtifactReadReply(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          result: {
            profile: ARTIFACT_PROFILE,
            contractVersion: ARTIFACT_CONTRACT_VERSION,
            generationId: 'generation-1',
            artifactId: 'artifact-1',
            offset: window.offset,
            nextOffset: window.nextOffset,
            content: Buffer.from(bytes.subarray(window.offset, window.nextOffset)).toString(
              'base64',
            ),
          },
        }),
        read.value,
        requestId,
      )
      if (!reply.ok) throw new Error(`Recipe chunk failed: ${fixture.id} ${reply.error.code}`)
      const decoded = artifactChunkBytes(reply.value)
      expect(decoded.length).toBe(window.decodedLength)
      expect(createHash('sha256').update(decoded).digest('hex')).toBe(window.sha256)
      actual.set(decoded, window.offset)
    }
    expect(actual).toEqual(bytes)
    expect(createHash('sha256').update(actual).digest('hex')).toBe(fixture.sha256)
  }
})

test('chunks reject bad canonical spelling, wrong identity and dishonest interval metadata', () => {
  const { capture, requestId } = context()
  const generated = decodeArtifactGenerateReply(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      result: {
        ...ready,
        artifacts: [
          {
            ...ready.artifacts[0],
            byteLength: 1,
            sha256: '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
          },
        ],
      },
    }),
    capture,
    requestId,
  )
  if (!generated.ok || generated.value.status !== 'ready')
    throw new Error('Fixture manifest failed')
  const manifest = generated.value
  const read = captureArtifactRead(manifest, manifest.artifacts[0]!.id, 0, 1)
  if (!read.ok) throw new Error(read.error.code)
  const valid = {
    profile: ARTIFACT_PROFILE,
    contractVersion: ARTIFACT_CONTRACT_VERSION,
    generationId: 'generation-1',
    artifactId: 'artifact-1',
    offset: 0,
    nextOffset: 1,
    content: 'AA==',
  }
  for (const content of [
    'AB==',
    'AA',
    'AA=',
    'AA===',
    'A A==',
    'AA==\n',
    'AA-_',
    'AAB=',
    '',
    'AAA=',
  ]) {
    expect(
      decodeArtifactReadReply(
        JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ...valid, content } }),
        read.value,
        requestId,
      ).ok,
    ).toBe(false)
  }
  for (const mutation of [
    { ...valid, generationId: 'other' },
    { ...valid, artifactId: 'other' },
    { ...valid, offset: 1 },
    { ...valid, nextOffset: 0 },
    { ...valid, eof: true },
    { ...valid, content: 'AA=='.repeat(21847) },
  ])
    expect(
      decodeArtifactReadReply(
        JSON.stringify({ jsonrpc: '2.0', id: 7, result: mutation }),
        read.value,
        requestId,
      ).ok,
    ).toBe(false)
  const frame = JSON.stringify({ jsonrpc: '2.0', id: 7, result: valid })
  expect(
    decodeArtifactReadReply(
      frame.replace('"offset":0', '"offset":0.0').replace('"nextOffset":1', '"nextOffset":1e0'),
      read.value,
      requestId,
    ).ok,
  ).toBe(true)
  for (const token of ['1e-400', '0.00000000000000000001', '-1'])
    expect(
      decodeArtifactReadReply(
        frame.replace('"offset":0', `"offset":${token}`),
        read.value,
        requestId,
      ).ok,
    ).toBe(false)
  expect(
    decodeArtifactReadReply(
      frame.replace('"content":"AA=="', '"content":"AA==","co\\u006etent":"AA=="'),
      read.value,
      requestId,
    ).ok,
  ).toBe(false)
  for (const [offset, count] of [
    [-1, 1],
    [2, 1],
    [0, 0],
    [0, 65537],
    [0, 1.1],
    [0.5, 1],
  ])
    expect(captureArtifactRead(manifest, manifest.artifacts[0]!.id, offset!, count!).ok).toBe(false)
  const release = captureArtifactRelease(manifest)
  expect(
    decodeArtifactReleaseReply(
      '{"jsonrpc":"2.0","id":7,"result":{"generationId":"generation-1"}}',
      release,
      requestId,
    ).ok,
  ).toBe(false)
})
