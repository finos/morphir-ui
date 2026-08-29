import { Either, Schema } from 'effect'
import { SHELL_DEFAULTS, type ColorScheme, type ShellSnapshot } from '../state/shell-constants.ts'
import { legacyModelDescriptor, type WorkbenchDescriptor } from '../workbench/types.ts'

export type GitHubSource = 'none' | 'gh-cli' | 'pat'

const WorkbenchBaseFields = {
  id: Schema.String,
  source: Schema.String,
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
}

/** Lenient: any invalid or partial input yields the defaults. Config files are never a crash. */
export const decodeUiConfig = (input: unknown): UiConfig => {
  const record =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null
  const workspaceInput =
    typeof record?.['workspace'] === 'object' && record['workspace'] !== null
      ? (record['workspace'] as Record<string, unknown>)
      : {}
  const legacyWorkspace = { recent: [], reopenOnLaunch: true, active: null, ...workspaceInput }
  const legacyActive = typeof legacyWorkspace.active === 'string' ? legacyWorkspace.active : null
  const legacyRecent: ReadonlyArray<string> = Array.isArray(legacyWorkspace.recent)
    ? (legacyWorkspace.recent as ReadonlyArray<unknown>).filter(
        (path): path is string => typeof path === 'string',
      )
    : []
  const migratedOpen: ReadonlyArray<WorkbenchDescriptor> = legacyActive
    ? [legacyModelDescriptor(legacyActive)]
    : []
  const migratedRecent = legacyRecent
    .filter((path) => path !== legacyActive)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .map(legacyModelDescriptor)
  const migratedWorkbenches = {
    open: migratedOpen,
    recent: migratedRecent,
    activeId: legacyActive,
    reopenOnLaunch:
      typeof legacyWorkspace.reopenOnLaunch === 'boolean'
        ? legacyWorkspace.reopenOnLaunch
        : defaultUiConfig.workbenches.reopenOnLaunch,
  }
  const merged = record
    ? {
        workbenches:
          typeof record['workbenches'] === 'object' && record['workbenches'] !== null
            ? { ...defaultUiConfig.workbenches, ...(record['workbenches'] as object) }
            : migratedWorkbenches,
        appearance: {
          ...defaultUiConfig.appearance,
          ...(record['appearance'] as object),
        },
        shell: { ...defaultUiConfig.shell, ...(record['shell'] as object) },
        github: { ...defaultUiConfig.github, ...(record['github'] as object) },
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
