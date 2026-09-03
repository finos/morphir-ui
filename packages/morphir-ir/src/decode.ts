import { Effect } from 'effect'
import {
  InvalidIr,
  InvalidJson,
  MissingFormatVersion,
  UnsupportedFormatVersion,
  type IrError,
} from './errors.ts'
import { nameFromCanonical, pathFromCanonical } from './names.ts'

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
const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === 'object' && u !== null
const isV4Record = (u: unknown): u is Record<string, unknown> => isRecord(u) && !Array.isArray(u)

const readCanonicalName = (value: unknown, label: string): Name => {
  const name = nameFromCanonical(value)
  if (name === null) throw fail(`malformed ${label}`)
  return name
}

const readCanonicalPath = (value: unknown, label: string): Path => {
  const path = pathFromCanonical(value)
  if (path === null) throw fail(`malformed ${label}`)
  return path
}

const readDocumentation = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((line) => typeof line === 'string'))
    return value.join('\n')
  return null
}

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

interface NormalizedV4AccessControlled {
  readonly access: Access
  readonly doc: string | null
  readonly rawDefinition: Record<string, unknown>
}

function normalizeV4AccessControlled(
  entry: unknown,
  section: string,
): NormalizedV4AccessControlled {
  if (!isV4Record(entry)) throw fail(`malformed ${section} access`)

  const publicKey = Object.hasOwn(entry, 'Public')
  const privateKey = Object.hasOwn(entry, 'Private')
  const explicitAccess = Object.hasOwn(entry, 'access')
  if ((publicKey && privateKey) || ((publicKey || privateKey) && explicitAccess))
    throw fail(`malformed ${section} access`)

  let access: Access
  let payload: Record<string, unknown>
  let docSource: unknown

  if (publicKey || privateKey) {
    access = publicKey ? 'Public' : 'Private'
    const canonicalPayload = entry[access]
    if (!isV4Record(canonicalPayload)) throw fail(`malformed ${section} definition`)
    payload = canonicalPayload
    docSource = Object.hasOwn(payload, 'doc') ? payload['doc'] : undefined
  } else {
    const accessValue = explicitAccess ? entry['access'] : undefined
    if (!isAccess(accessValue)) throw fail(`malformed ${section} access`)
    access = accessValue

    if (Object.hasOwn(entry, 'value')) {
      const legacyPayload = entry['value']
      if (!isV4Record(legacyPayload)) throw fail(`malformed ${section} definition`)
      payload = legacyPayload
      docSource = Object.hasOwn(payload, 'doc') ? payload['doc'] : undefined
    } else {
      payload = Object.fromEntries(
        Object.entries(entry).filter(([key]) => key !== 'access' && key !== 'doc'),
      )
      docSource = Object.hasOwn(entry, 'doc') ? entry['doc'] : undefined
    }
  }

  if (Object.hasOwn(payload, 'doc') && Object.hasOwn(payload, 'value')) {
    const documentedValue = payload['value']
    if (!isV4Record(documentedValue)) throw fail(`malformed ${section} definition`)
    return { access, doc: readDocumentation(docSource), rawDefinition: documentedValue }
  }

  const rawDefinition = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'doc'))
  if (Object.keys(rawDefinition).length === 0) throw fail(`malformed ${section} definition`)
  return { access, doc: readDocumentation(docSource), rawDefinition }
}

function readV4DefEntry(name: string, entry: unknown, section: string): RawDefEntry {
  return {
    name: readCanonicalName(name, `${section} name`),
    ...normalizeV4AccessControlled(entry, section),
  }
}

function readV4Module(name: string, entry: unknown): RawModule {
  const { access, rawDefinition: definition } = normalizeV4AccessControlled(entry, 'module')
  const types = definition['types']
  const values = definition['values']
  if (!isRecord(types)) throw fail('malformed type definitions')
  if (!isRecord(values)) throw fail('malformed value definitions')
  return {
    path: readCanonicalPath(name, 'module name'),
    access,
    types: Object.entries(types).map(([localName, value]) =>
      readV4DefEntry(localName, value, 'type'),
    ),
    values: Object.entries(values).map(([localName, value]) =>
      readV4DefEntry(localName, value, 'value'),
    ),
  }
}

function readV3Library(env: Record<string, unknown>): MorphirLibrary {
  const dist = env['distribution']
  if (!Array.isArray(dist) || dist[0] !== 'Library') throw fail('expected a Library distribution')
  if (!isPath(dist[1])) throw fail('malformed package name')
  const pkgDef = dist[3] as Record<string, unknown>
  if (typeof pkgDef !== 'object' || pkgDef === null || !Array.isArray(pkgDef['modules']))
    throw fail('malformed package definition')
  return { packageName: dist[1], modules: pkgDef['modules'].map(readModule) }
}

function readV4Library(env: Record<string, unknown>): MorphirLibrary {
  const dist = env['distribution']
  if (!isRecord(dist) || !isRecord(dist['Library'])) throw fail('expected a Library distribution')
  const library = dist['Library']
  const definition = library['def']
  if (!isRecord(definition) || !isRecord(definition['modules']))
    throw fail('malformed package definition')
  return {
    packageName: readCanonicalPath(library['packageName'], 'package name'),
    modules: Object.entries(definition['modules']).map(([name, value]) =>
      readV4Module(name, value),
    ),
  }
}

type IrDecoder = (env: Record<string, unknown>) => MorphirLibrary

const DECODER_BY_IR_RELEASE: Readonly<Record<string, IrDecoder | undefined>> = Object.freeze({
  '3.0.0': readV3Library,
  '4.0.0': readV4Library,
})

/** The exact releases this decoder accepts. */
export const DECODABLE_IR_RELEASES: ReadonlyArray<string> = Object.freeze(
  Object.keys(DECODER_BY_IR_RELEASE),
)

/** The IR format versions this decoder accepts, as they appear in baseline envelopes. */
export const DECODABLE_FORMAT_VERSIONS: ReadonlyArray<number> = Object.freeze([
  ...new Set(
    DECODABLE_IR_RELEASES.flatMap((release) => {
      const [major, minor, patch] = release.split('.')
      return minor === '0' && patch === '0' ? [Number(major)] : []
    }),
  ),
])

const MAX_FORMAT_VERSION_COMPONENT = 4_294_967_295

interface EnvelopeIrRelease {
  readonly release: string
  readonly found: number | string
}

const parseFormatVersionComponent = (component: string): number | null => {
  if (!/^(0|[1-9]\d*)$/.test(component) || component.length > 10) return null
  const parsed = Number(component)
  return parsed <= MAX_FORMAT_VERSION_COMPONENT ? parsed : null
}

const normalizeReleaseTriplet = (version: string): string | null => {
  const parts = version.split('.')
  if (parts.length !== 3) return null
  const components = parts.map(parseFormatVersionComponent)
  if (components.some((component) => component === null)) return null
  const [major] = components
  return typeof major === 'number' && major >= 3 ? version : null
}

const displayFormatVersion = (version: unknown): number | string =>
  typeof version === 'number' || typeof version === 'string' ? version : String(version)

/** Recognize the strict JSON envelope spelling before checking decoder support. */
const normalizeEnvelopeIrRelease = (version: unknown): EnvelopeIrRelease | null => {
  if (typeof version === 'number') {
    if (!Number.isInteger(version) || version < 1 || version > MAX_FORMAT_VERSION_COMPONENT)
      return null
    return { release: `${version}.0.0`, found: version }
  }

  if (typeof version !== 'string') return null
  const release = normalizeReleaseTriplet(version)
  return release === null ? null : { release, found: version }
}

/** Normalize strict catalog triplets plus the catalog's explicit bare-major spelling. */
const normalizeCatalogIrRelease = (version: string): string | null => {
  const release = normalizeReleaseTriplet(version)
  if (release !== null) return release
  const major = parseFormatVersionComponent(version)
  return major !== null && major >= 3 ? `${major}.0.0` : null
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
  const release = normalizeCatalogIrRelease(version)
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
          const formatVersion = env['formatVersion']
          const normalized = normalizeEnvelopeIrRelease(formatVersion)
          if (normalized === null)
            throw UnsupportedFormatVersion.make(displayFormatVersion(formatVersion))
          const decoder = DECODER_BY_IR_RELEASE[normalized.release]
          if (decoder === undefined) throw UnsupportedFormatVersion.make(normalized.found)
          return decoder(env)
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
