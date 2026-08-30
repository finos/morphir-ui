import { cleanup, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { sourceKey } from '@morphir/workspace'
import WorkbenchRail from '../src/shell/WorkbenchRail.svelte'
import { WorkbenchStore, defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

afterEach(() => cleanup())

const renderRail = async () => {
  const { core } = makeFakeCore()
  const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)
  await store.open('/models/acme.json')
  await store.open('/knowledge')
  render(WorkbenchRail, { props: { store, onOpenSettings: () => undefined } })
  return store
}

describe('WorkbenchRail', () => {
  test('selects an open Workbench and filters names and paths', async () => {
    const store = await renderRail()

    await userEvent.click(
      screen.getByRole('button', {
        name: 'acme.json, model Workbench, acme.json (legacy-local)',
      }),
    )
    expect(store.activeId).toBe(
      sourceKey({
        providerId: 'legacy-local',
        locator: '/models/acme.json',
        displayName: 'acme.json',
      }),
    )

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search Workbenches' }), 'knowledge')
    expect(screen.queryByText('acme.json')).toBeNull()
    expect(screen.getByText('knowledge')).toBeTruthy()
  })

  test('closes to a collapsed Recent group and reopens from it', async () => {
    const store = await renderRail()

    await userEvent.click(screen.getByRole('button', { name: 'Close knowledge' }))
    expect(store.recent.map((item) => item.source.locator)).toEqual(['/knowledge'])
    expect(screen.queryByRole('button', { name: /knowledge/i })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Recent, 1 Workbench/ }))
    await userEvent.click(screen.getByRole('button', { name: /Reopen knowledge/ }))
    expect(store.activeId).toBe(
      sourceKey({ providerId: 'legacy-local', locator: '/knowledge', displayName: 'knowledge' }),
    )
    expect(store.recent).toHaveLength(0)
  })

  test('offers model-file and folder opening actions', async () => {
    await renderRail()

    expect(screen.getByRole('button', { name: 'Open model file' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
  })

  test('offers retry and reveal actions for a failed Workbench', async () => {
    const { core } = makeFakeCore({ failingLoads: ['/bad.json'] })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)
    await store.open('/bad.json')
    render(WorkbenchRail, { props: { store, onOpenSettings: () => undefined } })

    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry bad.json' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reveal bad.json' })).toBeTruthy()
  })
})
