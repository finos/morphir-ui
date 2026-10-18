import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  unicode17Nfc,
  unicode17Nfkc,
  unicode9FullDefaultCaseFold,
} from '../src/artifact-unicode.ts'
import manifest from '../../../tools/unicode/manifest.json'

function source(name: string): string {
  const descriptor = manifest.sources.find((entry) => entry.file === name)!
  const bytes = gunzipSync(
    readFileSync(new URL(`../../../tools/unicode/sources/${name}.gz`, import.meta.url)),
  )
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(descriptor.sha256)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

const scalars = (field: string): string =>
  field
    .trim()
    .split(/ +/)
    .map((point) => String.fromCodePoint(Number.parseInt(point, 16)))
    .join('')

test('NFC and NFKC conform to every published Unicode 17 normalization row', () => {
  let rows = 0
  for (const line of source('NormalizationTest-17.txt').split('\n')) {
    const data = line.split('#')[0]!.trim()
    if (!data || data.startsWith('@')) continue
    const columns = data.split(';').slice(0, 5).map(scalars)
    const c2 = columns[1]!
    const c4 = columns[3]!
    const nfcExpected = [c2, c2, c2, c4, c4]
    for (let index = 0; index < 5; index++) {
      if (unicode17Nfc(columns[index]!) !== nfcExpected[index])
        throw new Error(`NFC mismatch at row ${rows + 1}, column ${index + 1}: ${data}`)
      if (unicode17Nfkc(columns[index]!) !== c4)
        throw new Error(`NFKC mismatch at row ${rows + 1}, column ${index + 1}: ${data}`)
    }
    rows++
  }
  expect(rows).toBe(20034)
}, 30000)

test('full default folding conforms to all Unicode 9 common/full mappings', () => {
  let mappings = 0
  for (const line of source('CaseFolding-9.txt').split('\n')) {
    const [point, status, mapping] = line
      .split('#')[0]!
      .split(';')
      .map((field) => field.trim())
    if (status !== 'C' && status !== 'F') continue
    expect(unicode9FullDefaultCaseFold(scalars(point!))).toBe(scalars(mapping!))
    mappings++
  }
  expect(mappings).toBe(1401)
})

test('mixed data versions differ deliberately from a modern runtime case table', () => {
  expect(unicode17Nfkc('\u{1ccd6}')).toBe('A')
  expect(unicode9FullDefaultCaseFold('\u1c90')).toBe('\u1c90')
  expect(unicode9FullDefaultCaseFold('\u13a0\uab70')).toBe('\u13a0\u13a0')
  expect(unicode9FullDefaultCaseFold('Iİıi')).toBe('ii\u0307ıi')
})

test('unlisted scalar values retain the Unicode 17 normalization identity invariant', () => {
  const partOne = new Set<number>()
  let section = ''
  for (const line of source('NormalizationTest-17.txt').split('\n')) {
    if (line.startsWith('@')) section = line.split(' ')[0]!
    if (section !== '@Part1' || !/^[0-9A-F]/.test(line)) continue
    partOne.add(Number.parseInt(line.split(';')[0]!, 16))
  }
  let checked = 0
  // Checking unassigned scalar values too is stronger than the published invariant.
  for (let point = 0; point <= 0x10ffff; point++) {
    if ((point >= 0xd800 && point <= 0xdfff) || partOne.has(point)) continue
    const text = String.fromCodePoint(point)
    if (unicode17Nfc(text) !== text || unicode17Nfkc(text) !== text)
      throw new Error(`Unlisted normalization changed: U+${point.toString(16)}`)
    checked++
  }
  expect(checked).toBeGreaterThan(1000000)
}, 30000)

test('bundled sources reproduce generated tables offline with verified provenance', () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, 'tools/unicode/generate-artifact-unicode.ts', '--check'],
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
  })
  expect(new TextDecoder().decode(result.stderr)).toBe('')
  expect(result.exitCode).toBe(0)
})

test('changed Unicode source bytes cannot be blessed by an unchanged generated table', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  mkdirSync(join(root, '.dev'), { recursive: true })
  const probe = mkdtempSync(join(root, '.dev/unicode-provenance-'))
  try {
    cpSync(join(root, 'tools/unicode'), join(probe, 'tools/unicode'), { recursive: true })
    const source = join(probe, 'tools/unicode/sources/UnicodeData-17.txt.gz')
    const altered = Buffer.concat([
      Buffer.from('# altered source\n'),
      gunzipSync(readFileSync(source)),
    ])
    writeFileSync(source, gzipSync(altered))
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(probe, 'tools/unicode/generate-artifact-unicode.ts'), '--check'],
      cwd: root,
    })
    expect(result.exitCode).not.toBe(0)
    expect(new TextDecoder().decode(result.stderr)).toContain(
      'Unicode source checksum mismatch: UnicodeData-17.txt',
    )
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})
