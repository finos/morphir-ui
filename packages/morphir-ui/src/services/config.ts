import { Either, Schema } from 'effect'
import { WorkbenchSourceRefSchema, sourceKey } from '@morphir/workspace'
import { SHELL_DEFAULTS, type ColorScheme, type ShellSnapshot } from '../state/shell-constants.ts'
import {
  legacyModelDescriptor,
  legacySourceRef,
  type WorkbenchDescriptor,
} from '../workbench/types.ts'

export type GitHubSource = 'none' | 'gh-cli' | 'pat'

const WorkbenchBaseFields = {
  id: Schema.String,
  source: WorkbenchSourceRefSchema,
  name: Schema.String,
  openedAt: Schema.String,
  lastUsedAt: Schema.String,
}

export const WorkbenchDescriptorSchema = Schema.Union(
  Schema.Struct({
    ...WorkbenchBaseFields,
    kind: Schema.Literal('model'),
    distribution: Schema.Literal('single-file', 'document-tree'),
    route: Schema.Literal('overview', 'explorer'),
  }),
  Schema.Struct({
    ...WorkbenchBaseFields,
    kind: Schema.Literal('development'),
    route: Schema.Literal('overview'),
  }),
)

const WorkbenchConfigSchema = Schema.Struct({
  open: Schema.Array(WorkbenchDescriptorSchema),
  recent: Schema.Array(WorkbenchDescriptorSchema),
  activeId: Schema.NullOr(Schema.String),
  reopenOnLaunch: Schema.Boolean,
})

/** One Playground document as persisted. Mirrors `PlaygroundDocument` in
 * views/playground/playground-state.svelte.ts, restated here rather than imported: this
 * module is loaded by the desktop main process, which has no Svelte compiler and so
 * cannot load a `.svelte.ts` module. */
const PlaygroundDocumentSchema = Schema.Struct({
  id: Schema.String,
  uri: Schema.String,
  languageId: Schema.String,
  version: Schema.Number,
  text: Schema.String,
})

/** Playground work in progress. Every selection is nullable and `documents` starts
 * empty, so "this config has never held a Playground" is expressible without this
 * module having to know the Playground's default language or sample source. */
const PlaygroundConfigSchema = Schema.Struct({
  documents: Schema.Array(PlaygroundDocumentSchema),
  activeDocumentId: Schema.NullOr(Schema.String),
  languageId: Schema.NullOr(Schema.String),
  target: Schema.NullOr(Schema.String),
})

export type PlaygroundConfig = Schema.Schema.Type<typeof PlaygroundConfigSchema>

const UiConfigSchema = Schema.Struct({
  workbenches: WorkbenchConfigSchema,
  appearance: Schema.Struct({
    colorScheme: Schema.Literal('system', 'light', 'dark'),
    animations: Schema.Boolean,
  }),
  shell: Schema.Struct({
    leftWidth: Schema.Number,
    rightWidth: Schema.Number,
    bottomHeight: Schema.Number,
    leftVisible: Schema.Boolean,
    rightVisible: Schema.Boolean,
    bottomVisible: Schema.Boolean,
  }),
  github: Schema.Struct({ source: Schema.Literal('none', 'gh-cli', 'pat') }),
  playground: PlaygroundConfigSchema,
})

export type UiConfig = Schema.Schema.Type<typeof UiConfigSchema>

export const defaultUiConfig: UiConfig = {
  workbenches: { open: [], recent: [], activeId: null, reopenOnLaunch: true },
  appearance: { colorScheme: SHELL_DEFAULTS.colorScheme as ColorScheme, animations: true },
  shell: {
    leftWidth: SHELL_DEFAULTS.leftWidth,
    rightWidth: SHELL_DEFAULTS.rightWidth,
    bottomHeight: SHELL_DEFAULTS.bottomHeight,
    leftVisible: true,
    rightVisible: true,
    bottomVisible: true,
  },
  github: { source: 'none' },
  playground: { documents: [], activeDocumentId: null, languageId: null, target: null },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface PersistedDescriptor {
  readonly descriptor: WorkbenchDescriptor
  readonly aliases: ReadonlyArray<string>
}

const migrateDescriptor = (
  input: unknown,
  providerId: string,
): PersistedDescriptor | null => {
  if (!isRecord(input)) return null

  const sourceInput = input.source
  const source =
    typeof sourceInput === 'string'
      ? {
          ...legacySourceRef(sourceInput, providerId),
          displayName:
            typeof input.name === 'string'
              ? input.name
              : legacySourceRef(sourceInput, providerId).displayName,
        }
      : sourceInput
  const decodedSource = Either.getOrNull(
    Schema.decodeUnknownEither(WorkbenchSourceRefSchema)(source),
  )
  if (!decodedSource) return null

  const descriptor = Either.getOrNull(
    Schema.decodeUnknownEither(WorkbenchDescriptorSchema)({
      ...input,
      id: sourceKey(decodedSource),
      source: decodedSource,
    }),
  )
  if (!descriptor) return null

  const aliases = [
    typeof input.id === 'string' ? input.id : null,
    typeof sourceInput === 'string' ? sourceInput : null,
    descriptor.id,
  ].filter((id): id is string => id !== null)
  return { descriptor, aliases }
}

const deduplicateDescriptors = (
  descriptors: ReadonlyArray<PersistedDescriptor>,
): ReadonlyArray<PersistedDescriptor> => {
  const seen = new Set<string>()
  return descriptors.filter(({ descriptor }) => {
    if (seen.has(descriptor.id)) return false
    seen.add(descriptor.id)
    return true
  })
}

const migrateWorkbenchConfig = (
  input: Record<string, unknown>,
  providerId: string,
): Record<string, unknown> => {
  const migrateList = (value: unknown): ReadonlyArray<PersistedDescriptor> =>
    Array.isArray(value)
      ? value
          .map((descriptor) => migrateDescriptor(descriptor, providerId))
          .filter((descriptor): descriptor is PersistedDescriptor => descriptor !== null)
      : []
  const openCandidates = migrateList(input.open)
  const recentCandidates = migrateList(input.recent)
  const open = deduplicateDescriptors(openCandidates)
  const openIds = new Set(open.map(({ descriptor }) => descriptor.id))
  const recent = deduplicateDescriptors(recentCandidates).filter(
    ({ descriptor }) => !openIds.has(descriptor.id),
  )
  const aliases = new Map<string, string>()
  for (const { descriptor } of [...open, ...recent]) {
    aliases.set(descriptor.id, descriptor.id)
  }
  for (const candidate of [...openCandidates, ...recentCandidates]) {
    for (const oldId of candidate.aliases) {
      if (!aliases.has(oldId)) aliases.set(oldId, candidate.descriptor.id)
    }
  }
  const resolvedActiveId =
    typeof input.activeId === 'string' ? (aliases.get(input.activeId) ?? null) : null
  const activeId = resolvedActiveId !== null && openIds.has(resolvedActiveId) ? resolvedActiveId : null
  return {
    open: open.map(({ descriptor }) => descriptor),
    recent: recent.map(({ descriptor }) => descriptor),
    activeId,
    reopenOnLaunch:
      typeof input.reopenOnLaunch === 'boolean'
        ? input.reopenOnLaunch
        : defaultUiConfig.workbenches.reopenOnLaunch,
  }
}

export interface DecodeUiConfigOptions {
  readonly legacyProviderId?: string
}

/** Lenient: any invalid or partial input yields the defaults. Config files are never a crash. */
export const decodeUiConfig = (
  input: unknown,
  { legacyProviderId = 'legacy-local' }: DecodeUiConfigOptions = {},
): UiConfig => {
  const record = isRecord(input) ? input : null
  const workspaceInput = isRecord(record?.['workspace']) ? record['workspace'] : {}
  const legacyWorkspace = { recent: [], reopenOnLaunch: true, active: null, ...workspaceInput }
  const legacyActive = typeof legacyWorkspace.active === 'string' ? legacyWorkspace.active : null
  const legacyRecent: ReadonlyArray<string> = Array.isArray(legacyWorkspace.recent)
    ? (legacyWorkspace.recent as ReadonlyArray<unknown>).filter(
        (path): path is string => typeof path === 'string',
      )
    : []
  const migratedRecent = legacyRecent
    .filter((path) => path !== legacyActive)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .map((source) => legacyModelDescriptor(source, legacyProviderId))
  const legacyActiveDescriptor = legacyActive
    ? legacyModelDescriptor(legacyActive, legacyProviderId)
    : null
  const migratedWorkbenches = {
    open: legacyActiveDescriptor ? [legacyActiveDescriptor] : [],
    recent: migratedRecent,
    activeId: legacyActiveDescriptor?.id ?? null,
    reopenOnLaunch:
      typeof legacyWorkspace.reopenOnLaunch === 'boolean'
        ? legacyWorkspace.reopenOnLaunch
        : defaultUiConfig.workbenches.reopenOnLaunch,
  }
  const merged = record
    ? {
        workbenches:
          isRecord(record['workbenches'])
            ? {
                ...defaultUiConfig.workbenches,
                ...migrateWorkbenchConfig(record['workbenches'], legacyProviderId),
              }
            : migratedWorkbenches,
        appearance: {
          ...defaultUiConfig.appearance,
          ...(record['appearance'] as object),
        },
        shell: { ...defaultUiConfig.shell, ...(record['shell'] as object) },
        github: { ...defaultUiConfig.github, ...(record['github'] as object) },
        playground: { ...defaultUiConfig.playground, ...(record['playground'] as object) },
      }
    : input
  return Either.getOrElse(Schema.decodeUnknownEither(UiConfigSchema)(merged), () => defaultUiConfig)
}

export const configToSnapshot = (c: UiConfig): ShellSnapshot => ({
  appearance: { ...c.appearance },
  shell: { ...c.shell },
})

export const withSnapshot = (c: UiConfig, s: ShellSnapshot): UiConfig => ({
  ...c,
  appearance: { ...s.appearance },
  shell: { ...s.shell },
})
