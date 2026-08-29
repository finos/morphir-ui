import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import SettingsView from '../src/views/settings/SettingsView.svelte'
import { ShellState, WorkbenchStore, defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore, makeFakeGitHub } from './support/fake-services.ts'

// This project imports test primitives explicitly rather than using Vitest globals, so
// `@testing-library/svelte`'s auto-cleanup never self-registers. Without an explicit
// afterEach, the DOM from each render() accumulates across tests in this file — later
// getByText/getByRole lookups would then see stale nodes from earlier tests.
afterEach(() => cleanup())

const setup = async (opts?: { github?: boolean }) => {
  const { core, store } = makeFakeCore()
  const github = opts?.github ? makeFakeGitHub({ login: 'octocat' }).github : undefined
  const services = await makeAppServices(github ? { core, github } : { core })
  const shell = new ShellState()
  const workbenches = new WorkbenchStore(services, defaultUiConfig.workbenches)
  shell.openSettings()
  render(SettingsView, {
    props: { services, shell, store: workbenches, version: '1.2.3' },
  })
  return { services, shell, store }
}

describe('SettingsView', () => {
  test('lists sections; GitHub hidden without the capability', async () => {
    await setup()
    expect(screen.getByText('General')).toBeTruthy()
    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.queryByText('GitHub')).toBeNull()
  })

  test('GitHub section appears with the capability', async () => {
    await setup({ github: true })
    expect(screen.getByText('GitHub')).toBeTruthy()
  })

  test('scheme picker updates the shell', async () => {
    const { shell } = await setup()
    shell.selectSettingsSection('appearance')
    await userEvent.click(await screen.findByRole('button', { name: /Light/ }))
    expect(shell.colorScheme).toBe('light')
  })

  test('reopen-on-launch toggle persists to config', async () => {
    const { shell, store } = await setup()
    shell.selectSettingsSection('general')
    await userEvent.click(await screen.findByRole('switch', { name: /Reopen Workbenches/ }))
    // Ruling 2: GeneralSection.setReopen flips the local toggle state synchronously but
    // only writes to the (fake) config store after `await services.loadConfig()` /
    // `await services.saveConfig(...)` resolve. userEvent.click awaits event dispatch, not
    // that unrelated promise chain, so a bare synchronous assertion here races the save.
    // waitFor polls the persisted Workbench setting until the asynchronous save resolves.
    // === false — until it's true, which happens once saveConfig() actually resolves.
    await waitFor(() => expect(store.config.workbenches.reopenOnLaunch).toBe(false))
  })

  test('PAT capture: save shows redacted token, verify shows login, remove clears', async () => {
    const { shell } = await setup({ github: true })
    shell.selectSettingsSection('github')
    await userEvent.click(await screen.findByLabelText('Personal access token'))
    const input = await screen.findByPlaceholderText(/github_pat_/)
    await userEvent.type(input, 'ghp_' + 'k'.repeat(36) + 'TAIL')
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
    expect(await screen.findByText('Token(ghp_...TAIL)')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/Authenticated as octocat/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    // Ruling 2: remove() awaits github.clearPat() then refresh() before the "Stored token"
    // row (and its redacted text) disappears; a synchronous queryByText right after the
    // click can race that. waitFor polls the exact same assertion the brief made — the
    // redacted token text is gone — until the async removal has actually landed.
    await waitFor(() => expect(screen.queryByText('Token(ghp_...TAIL)')).toBeNull())
  })

  test('PAT capture: saving a new token after a successful verify clears the stale result', async () => {
    const { shell } = await setup({ github: true })
    shell.selectSettingsSection('github')
    await userEvent.click(await screen.findByLabelText('Personal access token'))
    const input = await screen.findByPlaceholderText(/github_pat_/)
    await userEvent.type(input, 'ghp_' + 'k'.repeat(36) + 'TAIL')
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
    await screen.findByText('Token(ghp_...TAIL)')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/Authenticated as octocat/)).toBeTruthy()

    // Source is still 'pat', so the token input row stays mounted — type and save a second
    // token without re-selecting the radio.
    await userEvent.type(input, 'ghp_' + 'j'.repeat(36) + 'TAIL')
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
    await waitFor(() => expect(screen.queryByText(/Authenticated as octocat/)).toBeNull())
  })

  test('about shows the version', async () => {
    const { shell } = await setup()
    shell.selectSettingsSection('about')
    expect(await screen.findByText('v1.2.3')).toBeTruthy()
  })
})
