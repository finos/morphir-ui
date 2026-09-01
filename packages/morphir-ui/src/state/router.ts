import { SETTINGS_SECTIONS, type Route, type SettingsSection } from './shell-constants.ts'
import type { ShellState } from './shell-state.svelte.ts'

const KNOWN_SECTIONS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS)

const isSettingsSection = (value: string): value is SettingsSection => KNOWN_SECTIONS.has(value)

/** The canonical hash for a route. The inverse of {@link hashToRoute}. */
export const routeToHash = (route: Route): string =>
  route.kind === 'workspace' ? '#/' : `#/settings/${route.section}`

/**
 * Parses a `location.hash` into a Route. Returns `null` for anything that isn't a
 * recognized route (including an unknown settings section), so a caller can leave the
 * current route in place rather than guess.
 */
export const hashToRoute = (hash: string): Route | null => {
  const path = hash.replace(/^#\/?/, '')
  if (path === '') return { kind: 'workspace' }

  const [first, section] = path.split('/')
  if (first !== 'settings') return null
  if (section === undefined) return { kind: 'settings', section: 'general' }
  return isSettingsSection(section) ? { kind: 'settings', section } : null
}

/**
 * Hydrates `shell.route` from the current `location.hash`, keeps the hash in step as
 * the route changes, and follows back/forward navigation via `hashchange`. Returns a
 * teardown that undoes both.
 *
 * This module stays a plain `.ts` file (not `.svelte.ts`) so its pure functions can be
 * unit tested without a Svelte-aware loader. That means it cannot use `$effect` itself
 * to watch `shell.route` — runes only compile in `.svelte`/`.svelte.ts` files. Instead
 * it subscribes through `ShellState.onRouteChange`, which does the watching from
 * shell-state.svelte.ts, where runes are available.
 */
export const bindRouteToLocation = (shell: ShellState): (() => void) => {
  const applyHash = (hash: string) => {
    const route = hashToRoute(hash)
    if (route) shell.route = route
  }

  applyHash(location.hash)

  const onHashChange = () => applyHash(location.hash)
  window.addEventListener('hashchange', onHashChange)

  // A route change that isn't user navigation (e.g. clicking a settings section)
  // uses replaceState rather than assigning location.hash, so it doesn't push a new
  // history entry for every click.
  const unsubscribe = shell.onRouteChange((route) => {
    const hash = routeToHash(route)
    if (location.hash !== hash) history.replaceState(null, '', hash)
  })

  return () => {
    window.removeEventListener('hashchange', onHashChange)
    unsubscribe()
  }
}
