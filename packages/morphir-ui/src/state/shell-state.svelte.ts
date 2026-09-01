import {
  PANEL_BOUNDS,
  SCHEME_CLASSES,
  SHELL_DEFAULTS,
  clampPanel as clamp,
  type ColorScheme,
  type Route,
  type SettingsSection,
  type ShellSnapshot,
} from './shell-constants.ts'

export * from './shell-constants.ts'

export class ShellState {
  leftVisible = $state(true)
  rightVisible = $state(true)
  bottomVisible = $state(true)
  leftWidth = $state(SHELL_DEFAULTS.leftWidth)
  rightWidth = $state(SHELL_DEFAULTS.rightWidth)
  bottomHeight = $state(SHELL_DEFAULTS.bottomHeight)
  animations = $state(true)
  colorScheme = $state<ColorScheme>(SHELL_DEFAULTS.colorScheme)
  route = $state<Route>({ kind: 'workspace' })

  get leftExtent() {
    return this.leftVisible ? this.leftWidth : 0
  }
  get rightExtent() {
    return this.rightVisible ? this.rightWidth : 0
  }
  get bottomExtent() {
    return this.bottomVisible ? this.bottomHeight : 0
  }
  get schemeClass() {
    return SCHEME_CLASSES[this.colorScheme]
  }
  get isSettings() {
    return this.route.kind === 'settings'
  }

  toggleLeft() {
    this.leftVisible = !this.leftVisible
  }
  toggleRight() {
    this.rightVisible = !this.rightVisible
  }
  toggleBottom() {
    this.bottomVisible = !this.bottomVisible
  }
  resizeLeft(px: number) {
    this.leftWidth = clamp(px, PANEL_BOUNDS.left)
  }
  resizeRight(px: number) {
    this.rightWidth = clamp(px, PANEL_BOUNDS.right)
  }
  resizeBottom(px: number) {
    this.bottomHeight = clamp(px, PANEL_BOUNDS.bottom)
  }
  openSettings(section: SettingsSection = 'general') {
    this.route = { kind: 'settings', section }
  }
  closeSettings() {
    this.route = { kind: 'workspace' }
  }
  selectSettingsSection(section: SettingsSection) {
    this.route = { kind: 'settings', section }
  }
  // Runes only compile in .svelte/.svelte.ts files, so router.ts (a plain .ts module,
  // required for its test to import it without a Svelte-aware loader) cannot watch
  // `route` with $effect itself. It subscribes through this method instead.
  onRouteChange(listener: (route: Route) => void): () => void {
    return $effect.root(() => {
      $effect(() => {
        listener(this.route)
      })
    })
  }
  selectColorScheme(scheme: ColorScheme) {
    this.colorScheme = scheme
  }
  toggleAnimations() {
    this.animations = !this.animations
  }

  restoreDefaults() {
    this.leftVisible = this.rightVisible = this.bottomVisible = true
    this.leftWidth = SHELL_DEFAULTS.leftWidth
    this.rightWidth = SHELL_DEFAULTS.rightWidth
    this.bottomHeight = SHELL_DEFAULTS.bottomHeight
    this.animations = true
    this.colorScheme = SHELL_DEFAULTS.colorScheme
  }

  snapshot(): ShellSnapshot {
    return {
      appearance: { colorScheme: this.colorScheme, animations: this.animations },
      shell: {
        leftWidth: this.leftWidth,
        rightWidth: this.rightWidth,
        bottomHeight: this.bottomHeight,
        leftVisible: this.leftVisible,
        rightVisible: this.rightVisible,
        bottomVisible: this.bottomVisible,
      },
    }
  }

  hydrate(snap: ShellSnapshot) {
    this.colorScheme = snap.appearance.colorScheme
    this.animations = snap.appearance.animations
    this.leftWidth = clamp(snap.shell.leftWidth, PANEL_BOUNDS.left)
    this.rightWidth = clamp(snap.shell.rightWidth, PANEL_BOUNDS.right)
    this.bottomHeight = clamp(snap.shell.bottomHeight, PANEL_BOUNDS.bottom)
    this.leftVisible = snap.shell.leftVisible
    this.rightVisible = snap.shell.rightVisible
    this.bottomVisible = snap.shell.bottomVisible
  }
}
