import { cleanup, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { sourceKey } from '@morphir/workspace'
import WorkbenchRail from '../src/shell/WorkbenchRail.svelte'
import {
  WorkbenchError,
  WorkbenchStore,
  defaultUiConfig,
  legacySourceRef,
  makeAppServices,
} from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

afterEach(() => cleanup())

const renderRail = async (handlers?: {
  onOpenSettings?: () => void
  onOpenPlayground?: () => void
}) => {
  const { core } = makeFakeCore()
  const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)
  await store.open('/models/acme.json')
  await store.open('/knowledge')
  render(WorkbenchRail, {
    props: {
      store,
      onOpenSettings: handlers?.onOpenSettings ?? (() => undefined),
      onOpenPlayground: handlers?.onOpenPlayground ?? (() => undefined),
    },
  })
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
    render(WorkbenchRail, {
      props: { store, onOpenSettings: () => undefined, onOpenPlayground: () => undefined },
    })

    expect(screen.getByText('load-failed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry bad.json' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reveal bad.json' })).toBeTruthy()
  })

  test('qualifies permission recovery actions with the Workbench name', async () => {
    const source = legacySourceRef('/dev')
    const { core } = makeFakeCore()
    const base = await makeAppServices({ core })
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentWorkbench: async () => {
          throw new WorkbenchError({
            code: 'permission-denied',
            source,
            message: 'Directory access was revoked',
          })
        },
      },
      defaultUiConfig.workbenches,
    )
    await store.open(source)
    render(WorkbenchRail, {
      props: { store, onOpenSettings: () => undefined, onOpenPlayground: () => undefined },
    })

    expect(screen.getByRole('button', { name: 'Grant access dev' })).toBeTruthy()
  })

  test('the footer hosts both session-wide actions', async () => {
    const opened: string[] = []
    await renderRail({
      onOpenSettings: () => opened.push('settings'),
      onOpenPlayground: () => opened.push('playground'),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Playground' }))
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(opened).toEqual(['playground', 'settings'])
  })
})
