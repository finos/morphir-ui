export type ColorScheme = 'system' | 'light' | 'dark'
export const SETTINGS_SECTIONS = ['general', 'appearance', 'github', 'about'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
export const DETAIL_VIEWS = ['insight', 'type', 'xray'] as const
export type DetailView = (typeof DETAIL_VIEWS)[number]
export type WorkspaceRoute =
  | {
      readonly kind: 'workspace'
      readonly definition?: never
      readonly view?: never
      readonly node?: never
    }
  | {
      readonly kind: 'workspace'
      readonly definition: string
      readonly view?: DetailView
      readonly node?: string
    }
export type Route =
  | WorkspaceRoute
  | { readonly kind: 'settings'; readonly section: SettingsSection }
  | { readonly kind: 'playground' }

export const SCHEME_CLASSES: Record<ColorScheme, string> = {
  system: 'theme-system',
  light: 'theme-light',
  dark: 'theme-dark',
}
export const SCHEME_LABELS: Record<ColorScheme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export interface PanelBounds {
  readonly min: number
  readonly max: number
}
export const PANEL_BOUNDS = {
  left: { min: 300, max: 420 },
  right: { min: 220, max: 560 },
  bottom: { min: 120, max: 460 },
} as const satisfies Record<string, PanelBounds>

export const SHELL_DEFAULTS = {
  leftWidth: 320,
  rightWidth: 300,
  bottomHeight: 180,
  colorScheme: 'dark' as ColorScheme,
}

export interface ShellSnapshot {
  appearance: { colorScheme: ColorScheme; animations: boolean }
  shell: {
    leftWidth: number
    rightWidth: number
    bottomHeight: number
    leftVisible: boolean
    rightVisible: boolean
    bottomVisible: boolean
  }
}

export const clampPanel = (px: number, bounds: PanelBounds): number =>
  Math.max(bounds.min, Math.min(bounds.max, Math.round(px)))
