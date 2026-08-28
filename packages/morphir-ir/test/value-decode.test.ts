import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  decodeMorphirIr, decodeEntryValueDef, decodeValueExpr, uncurryApply,
  nameToCamel, type RawDefEntry, type ValueExpr
} from '../src/index.ts'

const loadFixture = async () => {
  const text = await Bun.file(new URL('./fixtures/insight-ir.json', import.meta.url)).text()
  const lib = await Effect.runPromise(decodeMorphirIr(text))
  const values = new Map<string, RawDefEntry>()
  for (const entry of lib.modules[0]!.values) values.set(nameToCamel(entry.name), entry)
  return values
}

const walkForUnknown = (e: ValueExpr, found: string[]): void => {
  if (e.kind === 'unknown') { found.push(e.tag); return }
  for (const v of Object.values(e)) {
    if (Array.isArray(v)) v.forEach((x) => walkMaybe(x, found))
    else walkMaybe(v, found)
  }
}
const walkMaybe = (v: unknown, found: string[]): void => {
  if (typeof v === 'object' && v !== null && 'kind' in v) {
    const k = (v as { kind: string }).kind
    if (k === 'unknown' && 'tag' in v) found.push((v as { tag: string }).tag)
    else if (!k.startsWith('type-')) walkForUnknown(v as ValueExpr, found)
  }
}

describe('decodeValueExpr against unit snippets', () => {
  test('literal with full type attribute', () => {
    const raw = ['Literal', ['Reference', {}, [[['morphir'], ['s', 'd', 'k']], [['basics']], ['int']], []], ['WholeNumberLiteral', 0]]
    const d = decodeValueExpr(raw)
    expect(d.kind).toBe('literal')
    if (d.kind === 'literal') expect(d.literal).toEqual({ kind: 'whole-number', value: 0 })
  })
  test('record fields are name/value pairs', () => {
    const raw = ['Record', {}, [[['age'], ['Literal', {}, ['WholeNumberLiteral', 36]]]]]
    const d = decodeValueExpr(raw)
    expect(d.kind).toBe('value-record')
    if (d.kind === 'value-record') {
      expect(d.fields[0]!.name).toEqual(['age'])
      expect(d.fields[0]!.value.kind).toBe('literal')
    }
  })
  test('unknown tag degrades without throwing', () => {
    expect(decodeValueExpr(['Mystery', {}, 1]).kind).toBe('unknown')
  })
})

describe('decoding the insight fixture', () => {
  test('all 21 definitions decode with zero unknown nodes', async () => {
    const values = await loadFixture()
    expect(values.size).toBe(21)
    for (const [name, entry] of values) {
      const def = decodeEntryValueDef(entry)
      expect(def, name).not.toBeNull()
      const found: string[] = []
      walkForUnknown(def!.body, found)
      expect(found, `${name} contains unknown tags: ${found.join(',')}`).toEqual([])
    }
  })

  test('chainedArithmetic uncurries to add applied twice', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('chainedArithmetic')!)!
    const { fn, args } = uncurryApply(def.body)
    expect(fn.kind).toBe('value-reference')
    if (fn.kind === 'value-reference') expect(fn.fqn.local).toEqual(['add'])
    expect(args).toHaveLength(2)
  })

  test('gradeIf decodes as a nested if-then-else chain', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('gradeIf')!)!
    expect(def.body.kind).toBe('if-then-else')
    if (def.body.kind === 'if-then-else') expect(def.body.elseBranch.kind).toBe('if-then-else')
  })

  test('tupleCase decodes as pattern-match with tuple patterns', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('tupleCase')!)!
    expect(def.body.kind).toBe('pattern-match')
    if (def.body.kind === 'pattern-match') {
      expect(def.body.cases.length).toBe(3)
      expect(def.body.cases[0]!.pattern.kind).toBe('pattern-tuple')
    }
  })

  test('letBound decodes nested let-definitions with input metadata', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('letBound')!)!
    expect(def.inputs).toHaveLength(1)
    expect(def.inputs[0]!.name).toEqual(['x'])
    expect(def.body.kind).toBe('let-definition')
  })

  test('updatedPerson decodes update-record with pair fields', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('updatedPerson')!)!
    expect(def.body.kind).toBe('update-record')
    if (def.body.kind === 'update-record') expect(def.body.fields[0]!.name).toEqual(['age'])
  })
})
