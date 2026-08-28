import { cleanup, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import IrExplorerView from '../src/views/IrExplorerView.svelte'
import { WorkspaceState, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

// This project imports test primitives explicitly rather than using Vitest globals, so
// `@testing-library/svelte`'s auto-cleanup never self-registers. Without an explicit
// afterEach, the DOM from each render() accumulates across tests in this file — later
// getByText lookups would then see stale nodes from earlier tests.
afterEach(() => cleanup())

// See workspace-state.test.ts: `readFileSync(new URL(rel, import.meta.url))` breaks under
// this file's happy-dom environment because Vite's import-analysis plugin statically
// rewrites that literal pattern into a browser dev-server asset URL. Resolve manually instead.
const irFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/listType-ir.json'),
  'utf8',
)

const openWorkspace = async () => {
  const { core } = makeFakeCore({ workspaceContent: irFixture })
  const ws = new WorkspaceState(await makeAppServices({ core }))
  await ws.openPicked()
  return ws
}

describe('IrExplorerView', () => {
  test('empty state prompts to open a workspace', () => {
    render(IrExplorerView, { props: { workspace: new WorkspaceState(null as never) } })
    expect(screen.getByText(/Open a workspace/)).toBeTruthy()
  })

  test('renders package, modules and definitions', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    expect(screen.getByText('Morphir.Example.App')).toBeTruthy()
    expect(screen.getByText('Forecast')).toBeTruthy()
    expect(screen.getByText('listExample')).toBeTruthy()
    expect(screen.getByText('WindDirection')).toBeTruthy()
  })

  test('search filter narrows definitions', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    await userEvent.type(screen.getByPlaceholderText('Filter definitions'), 'listEx')
    expect(screen.queryByText('WindDirection')).toBeNull()
    expect(screen.getByText('listExample')).toBeTruthy()
  })

  test('kind toggles hide types or values', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    await userEvent.click(screen.getByRole('button', { name: 'Types' }))
    expect(screen.queryByText('WindDirection')).toBeNull()
    expect(screen.getByText('listExample')).toBeTruthy()
  })

  test('clicking a definition opens the detail surface with an XRay tab', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    await userEvent.click(screen.getByText('listExample'))
    expect(screen.getByText('XRay')).toBeTruthy()
    expect(screen.getAllByText('value-list').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByText('Back'))
    expect(screen.getByPlaceholderText('Filter definitions')).toBeTruthy()
  })
})
