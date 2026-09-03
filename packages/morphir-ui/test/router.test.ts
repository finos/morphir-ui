import { describe, expect, test } from 'vitest'
import { flushSync } from 'svelte'
import {
  bindRouteToLocation,
  hashToRoute,
  pushRouteToLocation,
  replaceRouteInLocation,
  routeToHash,
} from '../src/state/router.ts'
import { SETTINGS_SECTIONS, ShellState, type Route } from '../src/state/shell-state.svelte.ts'

const xrayRoute: Route = {
  kind: 'workspace',
  definition: 'Morphir.Ui.Fixtures.Insight.mixedPrecedence',
  view: 'xray',
  node: '/body/fn/arg',
}

describe('route parsing', () => {
  test('workspace route types require a definition before detail fields', () => {
    const acceptsRoute = (route: Route): Route => route

    expect(acceptsRoute({ kind: 'workspace' })).toEqual({ kind: 'workspace' })
    expect(
      acceptsRoute({ kind: 'workspace', definition: 'A.B.c', view: 'xray', node: '/body' }),
    ).toEqual({ kind: 'workspace', definition: 'A.B.c', view: 'xray', node: '/body' })
    // @ts-expect-error A node is invalid without a selected definition.
    acceptsRoute({ kind: 'workspace', node: '/body' })
    // @ts-expect-error A detail view is invalid without a selected definition.
    acceptsRoute({ kind: 'workspace', view: 'xray' })
  })

  test('an empty hash is the workspace', () => {
    for (const hash of ['', '#', '#/']) {
      expect(hashToRoute(hash)).toEqual({ kind: 'workspace' })
    }
  })

  test('settings carries its section', () => {
    expect(hashToRoute('#/settings/appearance')).toEqual({
      kind: 'settings',
      section: 'appearance',
    })
  })

  test('bare settings defaults to general', () => {
    expect(hashToRoute('#/settings')).toEqual({ kind: 'settings', section: 'general' })
  })

  test('an unknown settings section is not a route', () => {
    expect(hashToRoute('#/settings/nonsense')).toBeNull()
  })

  test('an unknown hash is not a route', () => {
    expect(hashToRoute('#/nope')).toBeNull()
  })

  test('the playground is a route', () => {
    expect(hashToRoute('#/playground')).toEqual({ kind: 'playground' })
    expect(routeToHash({ kind: 'playground' })).toBe('#/playground')
  })

  test('a playground sub-path is not a route', () => {
    expect(hashToRoute('#/playground/elm')).toBeNull()
  })

  // Enumerating the sections by hand here let a new SettingsSection ship without any
  // round-trip coverage. Deriving them from SETTINGS_SECTIONS forces every future
  // section through this test the moment it is added to the union.
  test('every route round-trips through its hash', () => {
    const routes: Route[] = [
      { kind: 'workspace' },
      { kind: 'playground' },
      ...SETTINGS_SECTIONS.map((section) => ({ kind: 'settings', section }) as const),
    ]
    expect(routes.length).toBe(SETTINGS_SECTIONS.length + 2)
    for (const route of routes) {
      expect(hashToRoute(routeToHash(route))).toEqual(route)
    }
  })

  test('parsing tolerates a leading slash either way', () => {
    expect(hashToRoute('#settings/about')).toEqual({ kind: 'settings', section: 'about' })
  })

  test('round-trips an XRay deep link in stable field order', () => {
    expect(routeToHash(xrayRoute)).toBe(
      '#/?definition=Morphir.Ui.Fixtures.Insight.mixedPrecedence&view=xray&node=%2Fbody%2Ffn%2Farg',
    )
    expect(hashToRoute(routeToHash(xrayRoute))).toEqual(xrayRoute)
  })

  test('round-trips Unicode definitions and escaped JSON pointer segments', () => {
    const route: Route = {
      kind: 'workspace',
      definition: '资料.雪.値',
      view: 'xray',
      node: '/body/a~1b/~0tilde/雪',
    }

    expect(hashToRoute(routeToHash(route))).toEqual(route)
  })

  test('keeps an XRay node path while another definition tab is active', () => {
    const route: Route = {
      kind: 'workspace',
      definition: 'A.B.c',
      view: 'insight',
      node: '/body',
    }

    expect(hashToRoute(routeToHash(route))).toEqual(route)
  })

  test.each([
    '#/?definition=',
    '#/?view=xray',
    '#/?node=%2Fbody',
    '#/?definition=A.B.c&view=unknown',
    '#/?definition=A.B.c&node=body',
    '#/?definition=A.B.c&node=',
  ])('rejects the invalid workspace location %s', (hash) => {
    expect(hashToRoute(hash)).toBeNull()
  })

  test.each([
    '#/?definition=A.B.c&definition=X.Y.z',
    '#/?definition=X.Y.z&definition=A.B.c',
    '#/?definition=A.B.c&view=xray&view=unknown',
    '#/?definition=A.B.c&view=unknown&view=xray',
    '#/?definition=A.B.c&node=%2Fbody&node=%2Foutput',
    '#/?definition=A.B.c&node=%2Foutput&node=%2Fbody',
  ])('rejects duplicate workspace fields regardless of value order: %s', (hash) => {
    expect(hashToRoute(hash)).toBeNull()
  })

  test('ignores unrelated workspace query keys', () => {
    expect(hashToRoute('#/?future=enabled&definition=A.B.c&another=value')).toEqual({
      kind: 'workspace',
      definition: 'A.B.c',
    })
  })

  test.each([
    '#/playground?definition=A.B.c',
    '#/settings/about?node=%2Fbody',
    '#/settings?view=xray',
  ])('rejects workspace-only fields on a non-workspace route: %s', (hash) => {
    expect(hashToRoute(hash)).toBeNull()
  })

  test('ignores unrelated future keys on non-workspace routes', () => {
    expect(hashToRoute('#/playground?future=enabled')).toEqual({ kind: 'playground' })
    expect(hashToRoute('#/settings/about?future=enabled')).toEqual({
      kind: 'settings',
      section: 'about',
    })
  })
})

describe('route history helpers', () => {
  test('pushRouteToLocation creates history for explicit selections', () => {
    const before = history.length

    pushRouteToLocation(xrayRoute)

    expect(location.hash).toBe(routeToHash(xrayRoute))
    expect(history.length).toBe(before + 1)
  })

  test('replaceRouteInLocation normalizes without creating history', () => {
    const before = history.length

    replaceRouteInLocation({ kind: 'workspace', definition: 'A.B.c', view: 'type' })

    expect(location.hash).toBe('#/?definition=A.B.c&view=type')
    expect(history.length).toBe(before)
  })

  test('binding does not duplicate an explicitly pushed route', () => {
    replaceRouteInLocation({ kind: 'workspace' })
    const shell = new ShellState()
    const teardown = bindRouteToLocation(shell)
    flushSync()
    const before = history.length

    pushRouteToLocation(xrayRoute)
    shell.route = xrayRoute
    flushSync()

    expect(location.hash).toBe(routeToHash(xrayRoute))
    expect(history.length).toBe(before + 1)
    teardown()
  })

  test('back and forward traversal restores explicitly pushed workspace routes', () => {
    const insightRoute: Route = {
      kind: 'workspace',
      definition: 'A.B.c',
      view: 'insight',
      node: '/body',
    }
    replaceRouteInLocation({ kind: 'workspace' })
    pushRouteToLocation(insightRoute)
    pushRouteToLocation(xrayRoute)
    const shell = new ShellState()
    const teardown = bindRouteToLocation(shell)

    expect(shell.route).toEqual(xrayRoute)

    history.back()
    // Happy DOM updates the history location but omits the browser's hashchange event.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(shell.route).toEqual(insightRoute)

    history.forward()
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(shell.route).toEqual(xrayRoute)
    teardown()
  })
})

describe('bindRouteToLocation', () => {
  test('hydrates the shell from the current hash', () => {
    const shell = new ShellState()
    location.hash = '#/settings/appearance'

    const teardown = bindRouteToLocation(shell)

    expect(shell.route).toEqual({ kind: 'settings', section: 'appearance' })
    teardown()
  })

  test('an unknown hash leaves the current route alone', () => {
    const shell = new ShellState()
    location.hash = '#/nope'

    const teardown = bindRouteToLocation(shell)

    expect(shell.route).toEqual({ kind: 'workspace' })
    teardown()
  })

  test('writes the hash back when the route changes, without adding history entries', () => {
    const shell = new ShellState()
    location.hash = ''
    const teardown = bindRouteToLocation(shell)
    const lengthBefore = history.length

    shell.openSettings('about')
    flushSync()

    expect(location.hash).toBe('#/settings/about')
    expect(history.length).toBe(lengthBefore)
    teardown()
  })

  test('launching at #/playground opens the playground', () => {
    const shell = new ShellState()
    location.hash = '#/playground'

    const teardown = bindRouteToLocation(shell)

    expect(shell.route).toEqual({ kind: 'playground' })
    teardown()
  })

  test('opening the playground writes its hash back', () => {
    const shell = new ShellState()
    location.hash = ''
    const teardown = bindRouteToLocation(shell)

    shell.openPlayground()
    flushSync()

    expect(location.hash).toBe('#/playground')
    teardown()
  })

  test('does not write the hash when it already matches the route', () => {
    const shell = new ShellState()
    location.hash = '#/settings/github'
    const teardown = bindRouteToLocation(shell)
    flushSync()
    const lengthBefore = history.length

    shell.selectSettingsSection('github')
    flushSync()

    expect(history.length).toBe(lengthBefore)
    teardown()
  })

  test('back and forward navigation (a hashchange event) updates the route', async () => {
    const shell = new ShellState()
    location.hash = ''
    const teardown = bindRouteToLocation(shell)
    flushSync()

    location.hash = '#/settings/github'
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(shell.route).toEqual({ kind: 'settings', section: 'github' })
    teardown()
  })

  test('an unparseable hashchange is ignored, keeping the current route', async () => {
    const shell = new ShellState()
    location.hash = '#/settings/about'
    const teardown = bindRouteToLocation(shell)
    expect(shell.route).toEqual({ kind: 'settings', section: 'about' })
    flushSync()

    location.hash = '#/nope'
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(shell.route).toEqual({ kind: 'settings', section: 'about' })
    expect(location.hash).toBe('#/settings/about')
    teardown()
  })

  test('teardown stops both the hashchange listener and the write-back effect', async () => {
    const shell = new ShellState()
    location.hash = ''
    const teardown = bindRouteToLocation(shell)
    teardown()

    shell.openSettings('about')
    flushSync()
    expect(location.hash).not.toBe('#/settings/about')

    location.hash = '#/settings/general'
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(shell.route).not.toEqual({ kind: 'settings', section: 'general' })
  })
})
