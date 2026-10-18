import { expect, test } from 'bun:test'
import {
  parseRelativeArtifactPath,
  portableArtifactKey,
  validateArtifactPathSet,
} from '../src/artifact-path.ts'
import cases from './fixtures/artifact-paths.json'
import independent from './fixtures/artifact-independent-paths.json'

test('the exact transfer profile supplements Rust paths with DEL and C1 refusal', () => {
  for (const code of [127, 128, 133, 159]) {
    expect(parseRelativeArtifactPath(`a/${String.fromCharCode(code)}.bin`).ok).toBe(false)
  }
})

test('a validated portable path retains its spelling and has the Rust portable key', () => {
  const result = parseRelativeArtifactPath('Sources/Example.elm')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(String(result.value)).toBe('Sources/Example.elm')
  expect(String(portableArtifactKey(result.value))).toBe('sources/example.elm')
})

test('a complete path set rejects folded collisions and file/directory prefixes', () => {
  const paths = (values: readonly string[]) =>
    values.map((value) => {
      const result = parseRelativeArtifactPath(value)
      if (!result.ok) throw new Error(result.error)
      return result.value
    })
  expect(validateArtifactPathSet(paths(['Straße.txt', 'STRASSE.txt']))).toEqual({
    ok: false,
    error: 'artifact.path_collision',
  })
  expect(validateArtifactPathSet(paths(['Output', 'output/A.elm']))).toEqual({
    ok: false,
    error: 'artifact.path_prefix',
  })
  expect(validateArtifactPathSet(paths(['output/A.elm', 'Output']))).toEqual({
    ok: false,
    error: 'artifact.path_prefix',
  })
  const valid = validateArtifactPathSet(paths(['a.txt', 'a.txt-extra', 'dir/b.txt']))
  expect(valid.ok).toBe(true)
})

test('different spellings of the same parent directory are refused', () => {
  const paths = ['Dir/a.txt', 'dir/b.txt'].map((path) => {
    const result = parseRelativeArtifactPath(path)
    if (!result.ok) throw new Error(result.error)
    return result.value
  })
  expect(validateArtifactPathSet(paths)).toEqual({ ok: false, error: 'artifact.path_collision' })
})

test('portable keys use compatibility normalization and full default folding', () => {
  const result = parseRelativeArtifactPath('Straße/K-ﬃ-İ-\u{1e030}.txt')
  if (!result.ok) throw new Error(result.error)
  expect(String(portableArtifactKey(result.value))).toBe('strasse/k-ffi-i\u0307-а.txt')
})

test('fixed cross-language paths follow the published Unicode mappings and Rust rules', () => {
  for (const [input, expected] of cases.keys) {
    const result = parseRelativeArtifactPath(input)
    if (!result.ok) throw new Error(`Fixed valid path rejected: ${input}`)
    expect(String(portableArtifactKey(result.value))).toBe(expected!)
  }
  for (const input of [...cases.invalid, null, {}, 42]) {
    expect(parseRelativeArtifactPath(input)).toEqual({ ok: false, error: 'artifact.invalid_path' })
  }
  for (const [inventories, error] of [
    [cases.collisions, 'artifact.path_collision'],
    [cases.prefixConflicts, 'artifact.path_prefix'],
  ] as const) {
    for (const inventory of inventories) {
      const paths = inventory.map((input) => {
        const result = parseRelativeArtifactPath(input)
        if (!result.ok) throw new Error(`Fixed conflict path rejected individually: ${input}`)
        return result.value
      })
      expect(validateArtifactPathSet(paths)).toEqual({ ok: false, error })
    }
  }
})

test('byte/unit component and whole-path limits match the Rust constructors', () => {
  expect(parseRelativeArtifactPath('é'.repeat(127) + 'a').ok).toBe(true)
  expect(parseRelativeArtifactPath('é'.repeat(128)).ok).toBe(false)
  expect(parseRelativeArtifactPath('界'.repeat(85)).ok).toBe(true)
  expect(parseRelativeArtifactPath('界'.repeat(86)).ok).toBe(false)
  expect(parseRelativeArtifactPath('a'.repeat(255)).ok).toBe(true)
  expect(parseRelativeArtifactPath('a'.repeat(256)).ok).toBe(false)
  const exact = [255, 255, 255, 254, 1].map((length) => 'a'.repeat(length)).join('/')
  expect(exact.length).toBe(1024)
  expect(parseRelativeArtifactPath(exact).ok).toBe(true)
  expect(parseRelativeArtifactPath(exact + 'a').ok).toBe(false)
  expect(parseRelativeArtifactPath('😀'.repeat(63)).ok).toBe(true)
  expect(parseRelativeArtifactPath('😀'.repeat(64)).ok).toBe(false)
})

test('the accepted complete inventory is bounded and immutable', () => {
  const paths = Array.from({ length: 256 }, (_, index) => {
    const result = parseRelativeArtifactPath(`file-${index}.bin`)
    if (!result.ok) throw new Error(result.error)
    return result.value
  })
  const accepted = validateArtifactPathSet(paths)
  if (!accepted.ok) throw new Error(accepted.error)
  expect(accepted.value.length).toBe(256)
  expect(Object.isFrozen(accepted.value)).toBe(true)
  expect(validateArtifactPathSet([...paths, paths[0]!])).toEqual({
    ok: false,
    error: 'artifact.path_limit',
  })
  paths.pop()
  expect(accepted.value.length).toBe(256)
})

test('independently authored cross-language path cases agree with this exact profile', () => {
  for (const entry of independent.cases) {
    const paths = entry.paths ?? [
      entry
        .pathRecipe!.components.map((component) => component.repeat.repeat(component.count))
        .join('/'),
    ]
    const parsed = paths.map(parseRelativeArtifactPath)
    const validated = parsed.flatMap((result) => (result.ok ? [result.value] : []))
    const accepted = validated.length === paths.length && validateArtifactPathSet(validated).ok
    expect({ id: entry.id, accepted }).toEqual({ id: entry.id, accepted: entry.accept })
    if (entry.portableKeys)
      expect(validated.map((path) => String(portableArtifactKey(path)))).toEqual(entry.portableKeys)
  }
})
