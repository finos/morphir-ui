import {
  DETAIL_VIEWS,
  SETTINGS_SECTIONS,
  type DetailView,
  type Route,
  type SettingsSection,
  type WorkspaceRoute,
} from './shell-constants.ts'
import type { ShellState } from './shell-state.svelte.ts'

const KNOWN_SECTIONS: ReadonlySet<string> = new Set(SETTINGS_SECTIONS)
const KNOWN_DETAIL_VIEWS: ReadonlySet<string> = new Set(DETAIL_VIEWS)
const WORKSPACE_QUERY_FIELDS = ['definition', 'view', 'node'] as const

const isSettingsSection = (value: string): value is SettingsSection => KNOWN_SECTIONS.has(value)
const isDetailView = (value: string): value is DetailView => KNOWN_DETAIL_VIEWS.has(value)

const hasWorkspaceQueryField = (params: URLSearchParams): boolean =>
  WORKSPACE_QUERY_FIELDS.some((field) => params.has(field))

const parseWorkspaceRoute = (params: URLSearchParams): WorkspaceRoute | null => {
  if (WORKSPACE_QUERY_FIELDS.some((field) => params.getAll(field).length > 1)) return null

  const hasDefinition = params.has('definition')
  const hasView = params.has('view')
  const hasNode = params.has('node')

  if (!hasDefinition) return hasView || hasNode ? null : { kind: 'workspace' }

  const definition = params.get('definition') ?? ''
  if (definition.length === 0) return null

  const viewValue = params.get('view')
  if (viewValue !== null && !isDetailView(viewValue)) return null

  const nodeValue = params.get('node')
  if (nodeValue !== null && !nodeValue.startsWith('/')) return null

  return {
    kind: 'workspace',
    definition,
    ...(viewValue === null ? {} : { view: viewValue }),
    ...(nodeValue === null ? {} : { node: nodeValue }),
  }
}

/** The canonical hash for a route. The inverse of {@link hashToRoute}. */
export const routeToHash = (route: Route): string => {
  switch (route.kind) {
    case 'workspace': {
      if (route.definition === undefined) return '#/'

      const params = new URLSearchParams()
      params.set('definition', route.definition)
      if (route.view !== undefined) params.set('view', route.view)
      if (route.node !== undefined) params.set('node', route.node)
      return `#/?${params.toString()}`
    }
    case 'playground':
      return '#/playground'
    case 'settings':
      return `#/settings/${route.section}`
  }
}

/**
 * Parses a `location.hash` into a Route. Returns `null` for anything that isn't a
 * recognized route (including an unknown settings section), so a caller can leave the
 * current route in place rather than guess.
 */
export const hashToRoute = (hash: string): Route | null => {
  const fragment = hash.replace(/^#\/?/, '')
  const queryStart = fragment.indexOf('?')
  const path = queryStart === -1 ? fragment : fragment.slice(0, queryStart)
  const search = queryStart === -1 ? '' : fragment.slice(queryStart + 1)
  const params = new URLSearchParams(search)
  if (path === '') return parseWorkspaceRoute(params)
  if (hasWorkspaceQueryField(params)) return null

  const [first, section] = path.split('/')
  if (first === 'playground') {
    // The Playground has no sub-routes; a trailing segment is a typo, not a
    // deep link, so it parses as nothing rather than silently as the Playground.
    return section === undefined ? { kind: 'playground' } : null
  }
  if (first !== 'settings') return null
  if (section === undefined) return { kind: 'settings', section: 'general' }
  return isSettingsSection(section) ? { kind: 'settings', section } : null
}

/** Pushes a user-selected route so browser back and forward can revisit it. */
export const pushRouteToLocation = (route: Route): void => {
  history.pushState(null, '', routeToHash(route))
}

/** Replaces the current location for normalization and invalid-state recovery. */
export const replaceRouteInLocation = (route: Route): void => {
  history.replaceState(null, '', routeToHash(route))
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
    if (route) {
      shell.route = route
    } else {
      replaceRouteInLocation(shell.route)
    }
  }

  applyHash(location.hash)

  const onHashChange = () => applyHash(location.hash)
  window.addEventListener('hashchange', onHashChange)

  // A route change that isn't user navigation (e.g. clicking a settings section)
  // uses replaceState rather than assigning location.hash, so it doesn't push a new
  // history entry for every click.
  const unsubscribe = shell.onRouteChange((route) => {
    const hash = routeToHash(route)
    if (location.hash !== hash) replaceRouteInLocation(route)
  })

  return () => {
    window.removeEventListener('hashchange', onHashChange)
    unsubscribe()
  }
}
