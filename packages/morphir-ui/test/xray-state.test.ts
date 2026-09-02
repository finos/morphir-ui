import { describe, expect, test } from 'vitest'
import { XRayState } from '../src/views/insight/xray-state.svelte.ts'

describe('XRayState', () => {
  test('seeds manual expansion and optional selection from the constructor', () => {
    const state = new XRayState(['/body', '/body/fn'], '/body/fn')

    expect([...state.manualExpanded]).toEqual(['/body', '/body/fn'])
    expect(state.selectedPath).toBe('/body/fn')
  })

  test('manual toggle adds and removes a path', () => {
    const state = new XRayState()

    state.toggle('/body')
    expect(state.manualExpanded.has('/body')).toBe(true)

    state.toggle('/body')
    expect(state.manualExpanded.has('/body')).toBe(false)
  })

  test('unions search expansion with manual expansion without changing either source', () => {
    const state = new XRayState(['/body', '/body/fn'])
    const searchExpanded = new Set(['/body/fn/arg'])

    expect([...state.expandedWith(searchExpanded)]).toEqual(['/body', '/body/fn', '/body/fn/arg'])

    state.query = ''
    expect([...state.expandedWith(new Set())]).toEqual(['/body', '/body/fn'])
  })

  test('search union does not mutate manual or provided search sets', () => {
    const state = new XRayState(['/body'])
    const searchExpanded = new Set(['/body/fn'])

    const expanded = state.expandedWith(searchExpanded)
    expect(expanded).not.toBe(state.manualExpanded)
    expect(expanded).not.toBe(searchExpanded)
    expect([...state.manualExpanded]).toEqual(['/body'])
    expect(searchExpanded).toEqual(new Set(['/body/fn']))
  })

  test('selecting scopes replaces All, adds explicit scopes, and returns to All when toggled off', () => {
    const state = new XRayState()

    state.selectScope('types')
    expect([...state.scopes]).toEqual(['types'])

    state.selectScope('fields')
    expect([...state.scopes]).toEqual(['types', 'fields'])

    state.selectScope('types')
    state.selectScope('fields')
    expect([...state.scopes]).toEqual([])

    state.selectScope('values')
    state.selectAllScopes()
    expect([...state.scopes]).toEqual([])
  })

  test('expand all and collapse all affect only supplied visible branch paths', () => {
    const state = new XRayState(['/elsewhere'])

    state.expandAll(['/body', '/body/fn'])
    expect([...state.manualExpanded]).toEqual(['/elsewhere', '/body', '/body/fn'])

    state.collapseAll(['/body', '/body/fn'])
    expect([...state.manualExpanded]).toEqual(['/elsewhere'])
  })

  test('clearFilters resets query and scopes while preserving expansion and selection', () => {
    const state = new XRayState(['/body'], '/body')
    state.query = 'needle'
    state.selectScope('values')

    state.clearFilters()

    expect(state.query).toBe('')
    expect([...state.scopes]).toEqual([])
    expect([...state.manualExpanded]).toEqual(['/body'])
    expect(state.selectedPath).toBe('/body')
  })

  test('select changes and clears selected path', () => {
    const state = new XRayState([], '/body')

    state.select('/body/fn')
    expect(state.selectedPath).toBe('/body/fn')

    state.select(null)
    expect(state.selectedPath).toBeNull()
  })
})
