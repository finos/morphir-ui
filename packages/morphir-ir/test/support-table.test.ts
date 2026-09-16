import { describe, expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { decodeMorphirIr } from '../src/index.ts'
import {
  SUPPORTED_IR_FORMAT_VERSIONS,
  parseCanonicalSupportTable,
  parseRelease,
  renderProse,
  supportsRelease,
} from '../src/support-table.ts'

const table = parseCanonicalSupportTable(SUPPORTED_IR_FORMAT_VERSIONS)
const at = (version: string) => parseRelease(version)!

describe('parseCanonicalSupportTable', () => {
  test('reads the reference table as two half-open intervals', () => {
    expect(table).toEqual([
      {
        lower: { major: 3, minor: 0, patch: 0 },
        lowerInclusive: true,
        upper: { major: 3, minor: 1, patch: 0 },
        upperInclusive: false,
      },
      {
        lower: { major: 4, minor: 0, patch: 0 },
        lowerInclusive: true,
        upper: { major: 4, minor: 1, patch: 0 },
        upperInclusive: false,
      },
    ])
  })

  test('reads absent bounds as open ends', () => {
    expect(parseCanonicalSupportTable('(,4.1.0)')[0]!.lower).toBeNull()
    expect(parseCanonicalSupportTable('[4.0.0,)')[0]!.upper).toBeNull()
  })

  test('rejects text that holds no interval', () => {
    expect(() => parseCanonicalSupportTable('')).toThrow()
    expect(() => parseCanonicalSupportTable('3 and 4')).toThrow()
  })

  // A bound that is not an exact release triplet must throw, not silently become an
  // interval nobody can compare: routing every bound through parseRelease means a
  // malformed component fails loudly instead of making compare() return NaN and every
  // membership test fall through as satisfied.
  test('rejects a bound that is not a canonical release triplet', () => {
    expect(() => parseCanonicalSupportTable('[3.0,4.0)')).toThrow()
  })

  // The whole string must be nothing but canonical intervals: trailing text after the
  // last interval must not be silently dropped.
  test('rejects trailing text after the last interval', () => {
    expect(() => parseCanonicalSupportTable('[3.0.0,4.0.0)junk')).toThrow()
  })

  // §2.2 declares an interval with both bounds absent invalid; the parser is the right
  // place to reject it so that renderProse's non-null assertions stay sound.
  test('rejects an interval with both bounds absent', () => {
    expect(() => parseCanonicalSupportTable('(,)')).toThrow()
  })

  test('still parses the reference table to two intervals', () => {
    expect(parseCanonicalSupportTable(SUPPORTED_IR_FORMAT_VERSIONS)).toHaveLength(2)
  })
})

describe('supportsRelease', () => {
  // The point of the interval table: a later patch of a supported minor is readable,
  // while a later minor is not. The IR promises patches add nothing a reader must know.
  test('admits any patch of a supported minor and refuses a later minor', () => {
    expect(supportsRelease(table, at('4.0.7'))).toBe(true)
    expect(supportsRelease(table, at('4.1.0'))).toBe(false)
    expect(supportsRelease(table, at('5.0.0'))).toBe(false)
  })

  // An absent lower bound reaches down to the domain floor, not to zero: the release
  // grammar has no major below 3, so no table can hold 2.0.0.
  test('nothing below the domain floor is inside any table', () => {
    const open = parseCanonicalSupportTable('(,4.1.0)')
    expect(supportsRelease(open, at('3.9.9'))).toBe(true)
    expect(supportsRelease(open, at('2.0.0'))).toBe(false)
  })
})

describe('renderProse', () => {
  test('says the reference table the way the spec says it', () => {
    expect(renderProse(table)).toBe(
      '3.0.0 up to but not including 3.1.0, or 4.0.0 up to but not including 4.1.0',
    )
  })
})

// The shared corpus is the contract itself. morphir-ui runs it rather than keeping a
// private restatement of the rules that can drift from the other implementations.
const corpusPath = path.resolve(
  import.meta.dir,
  '../../../../../docs/spec/ir/fixtures/format-version-conformance.json',
)

interface MembershipCase {
  readonly table: string
  readonly release: string
  readonly compatibility: string
}
interface RenderCase {
  readonly table: string
  readonly prose: string
}
interface ScalarCase {
  readonly name: string
  readonly value: unknown
  readonly normalization: { readonly normalized?: string; readonly diagnostic?: string }
  readonly compatibility: string | null
}
interface Corpus {
  readonly supportTable: string
  readonly scalarCases: ReadonlyArray<ScalarCase>
  readonly supportTableCases: {
    readonly membership: ReadonlyArray<MembershipCase>
    readonly render: ReadonlyArray<RenderCase>
  }
}

const corpusIsOptional = process.env['MORPHIR_FIXTURES_OPTIONAL'] === '1'
const corpusExists = existsSync(corpusPath)
if (!corpusExists && !corpusIsOptional)
  throw new Error(
    `the shared format-version corpus is missing at ${corpusPath}; set MORPHIR_FIXTURES_OPTIONAL=1 when the parent worktree is not checked out`,
  )

const V3_DISTRIBUTION = ['Library', [['morphir'], ['example'], ['app']], [], { modules: [] }]
const V4_DISTRIBUTION = {
  Library: { packageName: 'morphir/example/app', dependencies: {}, def: { modules: {} } },
}

const describeCorpus = corpusExists ? describe : describe.skip
const corpus: Corpus = corpusExists
  ? (JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus)
  : { supportTable: '', scalarCases: [], supportTableCases: { membership: [], render: [] } }

describeCorpus('the shared format-version corpus', () => {
  test('declares the table this client declares', () => {
    expect(corpus.supportTable).toBe(SUPPORTED_IR_FORMAT_VERSIONS)
  })

  test('agrees on membership for every case', () => {
    const cases = corpus.supportTableCases.membership
    expect(cases.length).toBeGreaterThan(0)
    for (const c of cases) {
      const release = parseRelease(c.release)
      expect(release, c.release).not.toBeNull()
      expect(
        supportsRelease(parseCanonicalSupportTable(c.table), release!),
        `${c.table} ∋ ${c.release}`,
      ).toBe(c.compatibility === 'supported')
    }
  })

  test('renders every table as the corpus spells it', () => {
    const cases = corpus.supportTableCases.render
    expect(cases.length).toBeGreaterThan(0)
    for (const c of cases) {
      expect(renderProse(parseCanonicalSupportTable(c.table)), c.table).toBe(c.prose)
    }
  })

  // Every version failure reaches the UI as UnsupportedFormatVersion: the view has one
  // thing to say to a person holding IR it cannot read, whatever kind of wrong it is.
  test('decodes exactly the scalar format versions the corpus calls supported', async () => {
    const cases = corpus.scalarCases
    expect(cases.length).toBeGreaterThan(0)
    for (const c of cases) {
      const normalized = c.normalization.normalized
      const major = normalized === undefined ? 3 : Number(normalized.split('.')[0])
      const document = JSON.stringify({
        formatVersion: c.value,
        distribution: major === 4 ? V4_DISTRIBUTION : V3_DISTRIBUTION,
      })
      const exit = await Effect.runPromiseExit(decodeMorphirIr(document))
      const supported = c.compatibility === 'supported'
      expect(Exit.isSuccess(exit), c.name).toBe(supported)
      if (!supported) {
        const error = await Effect.runPromise(Effect.flip(decodeMorphirIr(document)))
        expect(error._tag, c.name).toBe('UnsupportedFormatVersion')
      }
    }
  })
})
