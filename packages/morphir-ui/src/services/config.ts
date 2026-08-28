import { Either, Schema } from 'effect'
import { SHELL_DEFAULTS, type ColorScheme, type ShellSnapshot } from '../state/shell-constants.ts'

export type GitHubSource = 'none' | 'gh-cli' | 'pat'

const UiConfigSchema = Schema.Struct({
  workspace: Schema.Struct({
    recent: Schema.Array(Schema.String),
    reopenOnLaunch: Schema.Boolean,
    active: Schema.NullOr(Schema.String),
  }),
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
  workspace: { recent: [], reopenOnLaunch: true, active: null },
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
  const merged =
    typeof input === 'object' && input !== null
      ? {
          workspace: {
            ...defaultUiConfig.workspace,
            ...(input as Record<string, object>)['workspace'],
          },
          appearance: {
            ...defaultUiConfig.appearance,
            ...(input as Record<string, object>)['appearance'],
          },
          shell: { ...defaultUiConfig.shell, ...(input as Record<string, object>)['shell'] },
          github: { ...defaultUiConfig.github, ...(input as Record<string, object>)['github'] },
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
