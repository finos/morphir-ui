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

/**
 * An interval over releases, in the three shapes the canonical grammar allows. The
 * notation permits an absent lower bound, an absent upper bound, or neither absent —
 * never both absent — so the type names those three shapes instead of carrying two
 * independent nullable bounds. A caller cannot build `(,)`, and membership and prose
 * need no non-null assertion to rule it out.
 */
export type Interval = BoundedInterval | UpperBoundedInterval | LowerBoundedInterval

/** `[a,b]` and its exclusive variants: both ends named. */
export interface BoundedInterval {
  readonly kind: 'between'
  readonly lower: Release
  readonly lowerInclusive: boolean
  readonly upper: Release
  readonly upperInclusive: boolean
}

/** `(,b)`: everything from the domain floor up to an upper bound. */
export interface UpperBoundedInterval {
  readonly kind: 'until'
  readonly upper: Release
  readonly upperInclusive: boolean
}

/** `[a,)`: everything from a lower bound onwards. */
export interface LowerBoundedInterval {
  readonly kind: 'from'
  readonly lower: Release
  readonly lowerInclusive: boolean
}

/** What this client reads: any patch of 3.0 or of 4.0. */
export const SUPPORTED_IR_FORMAT_VERSIONS = '[3.0.0,3.1.0),[4.0.0,4.1.0)'

/** The largest value a release component may take: the contract bounds every component
 * to an unsigned 32-bit integer, so a component stays an exact JavaScript number and
 * comparisons never degrade to imprecise arithmetic or `Infinity`. */
export const MAX_FORMAT_VERSION_COMPONENT = 4_294_967_295

const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** A release is an exact triplet of decimal components without leading zeros, each
 * within the contract's unsigned 32-bit domain. */
export const parseRelease = (s: string): Release | null => {
  const m = RELEASE_PATTERN.exec(s)
  if (m === null) return null
  const components = [m[1]!, m[2]!, m[3]!].map((component) =>
    component.length > 10 ? null : Number(component),
  )
  if (components.some((c) => c === null || c > MAX_FORMAT_VERSION_COMPONENT)) return null
  const [major, minor, patch] = components as [number, number, number]
  return { major, minor, patch }
}

const str = (r: Release) => `${r.major}.${r.minor}.${r.patch}`

/**
 * The smallest release the domain has. Release strings are valid only for major 3 and
 * later, so an absent lower bound reaches down to here and no further: `(,4.1.0)` holds
 * no 2.0.0, and a bound below it is not a release this contract can name.
 */
const DOMAIN_FLOOR: Release = { major: 3, minor: 0, patch: 0 }

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
  if (parsed.major < DOMAIN_FLOOR.major)
    throw new Error(
      `not a canonical support table: a bound below ${str(DOMAIN_FLOOR)} names no release: ${text}`,
    )
  return parsed
}

export const parseCanonicalSupportTable = (text: string): ReadonlyArray<Interval> => {
  if (!CANONICAL_TABLE_PATTERN.test(text))
    throw new Error(`not a canonical support table: ${text}`)
  const out: Interval[] = []
  for (const m of text.matchAll(INTERVAL_PATTERN)) {
    const lower = parseBound(m[2]!, text)
    const upper = parseBound(m[3]!, text)
    const lowerInclusive = m[1] === '['
    const upperInclusive = m[4] === ']'
    if (lower === null) {
      // `(,)` is rejected here and unrepresentable in Interval: the anchored grammar
      // needs at least one bound, and neither variant below can carry none.
      if (upper === null)
        throw new Error(
          `not a canonical support table: an interval needs at least one bound: ${text}`,
        )
      out.push({ kind: 'until', upper, upperInclusive })
    } else if (upper === null) {
      out.push({ kind: 'from', lower, lowerInclusive })
    } else {
      out.push({ kind: 'between', lower, lowerInclusive, upper, upperInclusive })
    }
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

/** A kind the union does not have: reaching here means a variant was added without
 * teaching this function about it, which TypeScript catches at the assignment. */
const unknownKind = (i: never): never => {
  throw new Error(`unknown interval kind: ${JSON.stringify(i)}`)
}

const atOrAfter = (lower: Release, inclusive: boolean, r: Release): boolean => {
  const c = compare(lower, r)
  return c < 0 || (c === 0 && inclusive)
}

const atOrBefore = (upper: Release, inclusive: boolean, r: Release): boolean => {
  const c = compare(r, upper)
  return c < 0 || (c === 0 && inclusive)
}

const holds = (i: Interval, r: Release): boolean => {
  switch (i.kind) {
    case 'between':
      return atOrAfter(i.lower, i.lowerInclusive, r) && atOrBefore(i.upper, i.upperInclusive, r)
    case 'until':
      return atOrBefore(i.upper, i.upperInclusive, r)
    case 'from':
      return atOrAfter(i.lower, i.lowerInclusive, r)
    default:
      return unknownKind(i)
  }
}

export const supportsRelease = (table: ReadonlyArray<Interval>, r: Release): boolean =>
  compare(r, DOMAIN_FLOOR) < 0 ? false : table.some((i) => holds(i, r))

const proseFor = (i: Interval): string => {
  switch (i.kind) {
    case 'between': {
      const start = i.lowerInclusive ? str(i.lower) : `after ${str(i.lower)}`
      return i.upperInclusive
        ? `${start} through ${str(i.upper)}`
        : `${start} up to but not including ${str(i.upper)}`
    }
    case 'until':
      return i.upperInclusive ? `${str(i.upper)} and earlier` : `earlier than ${str(i.upper)}`
    case 'from':
      return i.lowerInclusive ? `${str(i.lower)} and later` : `after ${str(i.lower)}`
    default:
      return unknownKind(i)
  }
}

/** The table in the words the contract uses when a person has to read the error. Each
 * variant of the union has its own sentence, so the function is total without asserting
 * that any bound is present. */
export const renderProse = (table: ReadonlyArray<Interval>): string =>
  table.map(proseFor).join(', or ')
