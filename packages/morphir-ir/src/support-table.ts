/**
 * The IR format-version support table, in the contract's interval notation.
 *
 * A client declares what it reads as a comma-separated list of intervals over
 * releases — `[3.0.0,3.1.0),[4.0.0,4.1.0)` says "any patch of 3.0 or of 4.0".
 * The normative page is `docs/spec/ir/format-version.md` in finos/morphir, and the
 * shared corpus at `docs/spec/ir/fixtures/format-version-conformance.json` is what
 * every implementation of these rules is tested against.
 *
 * Only canonical tables are parsed here. Canonicalization (sorting, merging adjacent
 * intervals, advancing an inclusive upper bound) belongs to the contract's own tooling;
 * a reader only needs to decide membership and to say the table out loud.
 */

export interface Release {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

export interface Interval {
  readonly lower: Release | null
  readonly lowerInclusive: boolean
  readonly upper: Release | null
  readonly upperInclusive: boolean
}

/** What this client reads: any patch of 3.0 or of 4.0. */
export const SUPPORTED_IR_FORMAT_VERSIONS = '[3.0.0,3.1.0),[4.0.0,4.1.0)'

const release = (s: string): Release => {
  const [major, minor, patch] = s.split('.').map(Number) as [number, number, number]
  return { major, minor, patch }
}

/** A release is an exact triplet of decimal components without leading zeros. */
export const parseRelease = (s: string): Release | null =>
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(s) ? release(s) : null

const INTERVAL_PATTERN = /([[(])([0-9.]*),([0-9.]*)([\])])/g

/** The whole input must be one or more canonical intervals joined by single commas,
 * nothing else — no surrounding text, no extra separators. */
const CANONICAL_TABLE_PATTERN = new RegExp(
  `^${INTERVAL_PATTERN.source}(?:,${INTERVAL_PATTERN.source})*$`,
)

const parseBound = (component: string, text: string): Release | null => {
  if (component === '') return null
  const parsed = parseRelease(component)
  if (parsed === null) throw new Error(`not a canonical support table: ${text}`)
  return parsed
}

export const parseCanonicalSupportTable = (text: string): ReadonlyArray<Interval> => {
  if (!CANONICAL_TABLE_PATTERN.test(text))
    throw new Error(`not a canonical support table: ${text}`)
  const out: Interval[] = []
  for (const m of text.matchAll(INTERVAL_PATTERN)) {
    const lower = parseBound(m[2]!, text)
    const upper = parseBound(m[3]!, text)
    if (lower === null && upper === null)
      throw new Error(`not a canonical support table: an interval needs at least one bound: ${text}`)
    out.push({
      lower,
      lowerInclusive: m[1] === '[',
      upper,
      upperInclusive: m[4] === ']',
    })
  }
  if (out.length === 0) throw new Error(`not a canonical support table: ${text}`)
  return out
}

const compare = (a: Release, b: Release): number =>
  a.major !== b.major
    ? a.major - b.major
    : a.minor !== b.minor
      ? a.minor - b.minor
      : a.patch - b.patch

/**
 * The smallest release the domain has. Release strings are valid only for major 3 and
 * later, so an absent lower bound reaches down to here and no further: `(,4.1.0)` holds
 * no 2.0.0.
 */
const DOMAIN_FLOOR: Release = { major: 3, minor: 0, patch: 0 }

export const supportsRelease = (table: ReadonlyArray<Interval>, r: Release): boolean =>
  compare(r, DOMAIN_FLOOR) < 0
    ? false
    : table.some((i) => {
        if (i.lower !== null) {
          const c = compare(i.lower, r)
          if (c > 0 || (c === 0 && !i.lowerInclusive)) return false
        }
        if (i.upper !== null) {
          const c = compare(r, i.upper)
          if (c > 0 || (c === 0 && !i.upperInclusive)) return false
        }
        return true
      })

const str = (r: Release) => `${r.major}.${r.minor}.${r.patch}`

/** The table in the words the contract uses when a person has to read the error.
 * The `!` assertions below are sound because parseCanonicalSupportTable guarantees
 * every interval keeps at least one bound. */
export const renderProse = (table: ReadonlyArray<Interval>): string =>
  table
    .map((i) => {
      if (i.lower === null)
        return i.upperInclusive ? `${str(i.upper!)} and earlier` : `earlier than ${str(i.upper!)}`
      if (i.upper === null) return `${str(i.lower)} and later`
      const start = i.lowerInclusive ? str(i.lower) : `after ${str(i.lower)}`
      return i.upperInclusive
        ? `${start} through ${str(i.upper)}`
        : `${start} up to but not including ${str(i.upper)}`
    })
    .join(', or ')
