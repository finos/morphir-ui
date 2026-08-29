import { cleanup, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import WorkbenchTabs from '../src/shell/WorkbenchTabs.svelte'
import { WorkbenchStore, defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

afterEach(() => cleanup())

describe('WorkbenchTabs', () => {
  test('selects and renders the descriptor route', async () => {
    const { core } = makeFakeCore()
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)
    await store.open('/model.json')
    render(WorkbenchTabs, { props: { entry: store.active!, store } })

    await userEvent.click(screen.getByRole('tab', { name: 'IR Explorer' }))

    expect(store.active?.descriptor.route).toBe('explorer')
    expect(screen.getByRole('tab', { name: 'IR Explorer' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })
})
