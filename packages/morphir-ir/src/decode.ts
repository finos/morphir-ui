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

/** The IR format versions this decoder accepts. Single-valued today; when a v4
 * decoder lands (see the Insight v4 work) adding it here is what tells every caller
 * — including the Playground, which uses this to decide what IR version to ask a
 * frontend for — that v4 became renderable. */
export const DECODABLE_FORMAT_VERSIONS: ReadonlyArray<number> = [3]

/** Whether IR advertised as `version` is something {@link decodeMorphirIr} can read.
 *
 * Catalogs spell an IR version two ways at once: morphir-elm advertises a bare major
 * ("3") while morphir-gleam-binding advertises a full triplet ("4.0.0"). Both name a
 * format version, so the major component is what decides — and anything that does not
 * parse as one is not decodable, since claiming otherwise would send a caller off to
 * request IR that then fails the format check. */
export const canDecodeIrVersion = (version: string): boolean => {
  const major = /^(\d+)(?:\.\d+)*$/.exec(version.trim())?.[1]
  return major !== undefined && DECODABLE_FORMAT_VERSIONS.includes(Number(major))
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
