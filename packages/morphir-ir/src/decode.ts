import { Effect } from 'effect'
import {
  InvalidIr,
  InvalidJson,
  MissingFormatVersion,
  UnsupportedFormatVersion,
  type IrError,
} from './errors.ts'

export type Name = ReadonlyArray<string>
export type Path = ReadonlyArray<Name>
export type Access = 'Public' | 'Private'
export interface RawDefEntry {
  readonly name: Name
  readonly access: Access
  readonly doc: string | null
  readonly rawDefinition: unknown
}
export interface RawModule {
  readonly path: Path
  readonly access: Access
  readonly types: ReadonlyArray<RawDefEntry>
  readonly values: ReadonlyArray<RawDefEntry>
}
export interface MorphirLibrary {
  readonly packageName: Path
  readonly modules: ReadonlyArray<RawModule>
}

const isName = (u: unknown): u is Name => Array.isArray(u) && u.every((p) => typeof p === 'string')
const isPath = (u: unknown): u is Path => Array.isArray(u) && u.every(isName)
const isAccess = (u: unknown): u is Access => u === 'Public' || u === 'Private'

const fail = (message: string) => new InvalidIr({ message })

function readDefEntry(entry: unknown, section: string): RawDefEntry {
  if (!Array.isArray(entry) || entry.length !== 2 || !isName(entry[0]))
    throw fail(`malformed ${section} entry`)
  const ac = entry[1] as Record<string, unknown>
  if (typeof ac !== 'object' || ac === null || !isAccess(ac['access']))
    throw fail(`malformed ${section} access`)
  const documented = ac['value'] as Record<string, unknown> | undefined
  const doc =
    documented && typeof documented === 'object' && typeof documented['doc'] === 'string'
      ? documented['doc']
      : null
  const rawDefinition =
    documented && typeof documented === 'object' && 'value' in documented
      ? (documented as { value: unknown }).value
      : undefined
  return { name: entry[0], access: ac['access'], doc, rawDefinition }
}

function readModule(entry: unknown): RawModule {
  if (!Array.isArray(entry) || entry.length !== 2 || !isPath(entry[0]))
    throw fail('malformed module entry')
  const ac = entry[1] as Record<string, unknown>
  if (typeof ac !== 'object' || ac === null || !isAccess(ac['access']))
    throw fail('malformed module access')
  const def = ac['value'] as Record<string, unknown>
  if (typeof def !== 'object' || def === null) throw fail('malformed module definition')
  const types = Array.isArray(def['types']) ? def['types'].map((t) => readDefEntry(t, 'type')) : []
  const values = Array.isArray(def['values'])
    ? def['values'].map((v) => readDefEntry(v, 'value'))
    : []
  return { path: entry[0], access: ac['access'], types, values }
}

/** The IR format versions this decoder accepts, as they appear in an envelope.
 *
 * Single-valued today; when a v4 decoder lands (see the Insight v4 work) adding it here
 * is what tells every caller — including the Playground, which uses this to decide what
 * IR version to ask a frontend for — that v4 became renderable. */
export const DECODABLE_FORMAT_VERSIONS: ReadonlyArray<number> = [3]

/** The exact releases this decoder accepts.
 *
 * An envelope's integer `N` denotes the baseline release `N.0.0`: that is the
 * formatVersion contract's own rule, which writes a baseline as an integer and any
 * other release as an exact `major.minor.patch` string. Deriving the releases from
 * {@link DECODABLE_FORMAT_VERSIONS} keeps one list to maintain. */
export const DECODABLE_IR_RELEASES: ReadonlyArray<string> = DECODABLE_FORMAT_VERSIONS.map(
  (major) => `${major}.0.0`,
)

/** The exact release `version` names, or null when it is not a release at all. Missing
 * components default to zero, so '3' and '3.0.0' are two spellings of one release. */
const normalizeIrRelease = (version: string): string | null => {
  const parts = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(version.trim())
  if (parts === null) return null
  return `${Number(parts[1])}.${Number(parts[2] ?? 0)}.${Number(parts[3] ?? 0)}`
}

/** Whether IR advertised as `version` is something {@link decodeMorphirIr} can read.
 *
 * Catalogs spell versions two ways at once — morphir-elm advertises '3', while
 * morphir-gleam-binding advertises '4.0.0' — so the comparison is on the normalized
 * release rather than on the text. It is the *exact* release that decides, not the
 * major family: support is defined per release (the contract separates an unsupported
 * revision from an unsupported major), and a non-baseline release such as 3.1.0 is
 * written into the envelope as the string '3.1.0', which this decoder refuses. Admitting
 * it on the strength of its major would steer a caller into requesting IR that then
 * fails to decode — the exact failure this predicate exists to prevent. */
export const canDecodeIrVersion = (version: string): boolean => {
  const release = normalizeIrRelease(version)
  return release !== null && DECODABLE_IR_RELEASES.includes(release)
}

export const decodeMorphirIr = (input: string): Effect.Effect<MorphirLibrary, IrError> =>
  Effect.try({
    try: () => JSON.parse(input) as unknown,
    catch: (e) => new InvalidJson({ message: String(e) }),
  }).pipe(
    Effect.flatMap((root) =>
      Effect.try({
        try: () => {
          if (typeof root !== 'object' || root === null) throw fail('IR root must be an object')
          const env = root as Record<string, unknown>
          if (!('formatVersion' in env)) throw MissingFormatVersion.make()
          // The type check is load-bearing, not decoration: Number() coerces '3', [3]
          // and ['3'] to a supported 3, so testing membership on a coerced value would
          // accept an envelope whose shape is already wrong.
          const formatVersion = env['formatVersion']
          if (
            typeof formatVersion !== 'number' ||
            !DECODABLE_FORMAT_VERSIONS.includes(formatVersion)
          )
            throw UnsupportedFormatVersion.make(Number(formatVersion))
          const dist = env['distribution']
          if (!Array.isArray(dist) || dist[0] !== 'Library')
            throw fail('expected a Library distribution')
          if (!isPath(dist[1])) throw fail('malformed package name')
          const pkgDef = dist[3] as Record<string, unknown>
          if (typeof pkgDef !== 'object' || pkgDef === null || !Array.isArray(pkgDef['modules']))
            throw fail('malformed package definition')
          return { packageName: dist[1], modules: pkgDef['modules'].map(readModule) }
        },
        catch: (e) =>
          e instanceof MissingFormatVersion ||
          e instanceof UnsupportedFormatVersion ||
          e instanceof InvalidIr
            ? e
            : new InvalidIr({ message: String(e) }),
      }),
    ),
  )
