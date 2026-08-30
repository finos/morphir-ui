import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MorphirApp from '../src/shell/MorphirApp.svelte'
import { defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

// See ir-explorer.test.ts: readFileSync(new URL(rel, import.meta.url)) breaks under Vite's
// import-analysis in this happy-dom environment. Resolve manually instead.
const insightFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'),
  'utf8',
)

// See ir-explorer.test.ts: this project has no vitest globals, so auto-cleanup from
// @testing-library/svelte never registers itself. Without this, DOM from each render()
// bleeds into the next test in this file.
afterEach(() => cleanup())

describe('MorphirApp', () => {
  test('keeps each Model Workbench on its own selected route', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const { container } = render(MorphirApp, {
      props: {
        services,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig: defaultUiConfig,
        initialSources: ['/models/a.json', '/models/b.json'],
      },
    })

    const aRow = await screen.findByRole('button', {
      name: 'a.json, model Workbench, a.json (legacy-local)',
    })
    const bRow = await screen.findByRole('button', {
      name: 'b.json, model Workbench, b.json (legacy-local)',
    })
    await waitFor(() => {
      expect(aRow.closest('.workbench-row')?.classList.contains('active')).toBe(true)
      expect(aRow.textContent).toContain('ready')
      expect(bRow.textContent).toContain('ready')
    })
    expect(
      container.querySelector('.workbench-view')?.classList.contains('workbench-view-explorer'),
    ).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: 'IR Explorer' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'IR Explorer' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    )
    expect(
      container.querySelector('.workbench-view')?.classList.contains('workbench-view-explorer'),
    ).toBe(true)
    expect(container.querySelector('.ir-explorer')).toBeTruthy()
    await userEvent.click(
      screen.getByRole('button', { name: 'b.json, model Workbench, b.json (legacy-local)' }),
    )
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(
      container.querySelector('.workbench-view')?.classList.contains('workbench-view-explorer'),
    ).toBe(false)
    await userEvent.click(
      screen.getByRole('button', { name: 'a.json, model Workbench, a.json (legacy-local)' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'IR Explorer' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    )
  })

  test('does not carry selected explorer detail into another Model Workbench', async () => {
    const { core } = makeFakeCore({ workspaceContent: insightFixture })
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: {
        services,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig: defaultUiConfig,
        initialSources: ['/models/a.json', '/models/b.json'],
      },
    })

    await screen.findByRole('button', {
      name: 'a.json, model Workbench, a.json (legacy-local)',
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'b.json, model Workbench, b.json (legacy-local)' })
          .textContent,
      ).toContain('ready'),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'b.json, model Workbench, b.json (legacy-local)' }),
    )
    await userEvent.click(screen.getByRole('tab', { name: 'IR Explorer' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'a.json, model Workbench, a.json (legacy-local)' }),
    )
    await userEvent.click(screen.getByRole('tab', { name: 'IR Explorer' }))
    await userEvent.click(await screen.findByRole('treeitem', { name: 'usesHelper' }))
    expect(
      screen.getByText('usesHelper', { selector: '.local' }).closest('.fqn')?.textContent,
    ).toBe('Morphir.Ui.Fixtures.Insight.usesHelper')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search model' }), 'uses')
    await userEvent.click(screen.getByRole('button', { name: 'Types' }))

    await userEvent.click(
      screen.getByRole('button', { name: 'b.json, model Workbench, b.json (legacy-local)' }),
    )

    expect(screen.getByRole('tab', { name: 'IR Explorer' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(await screen.findByText('Select a definition')).toBeTruthy()
    expect(screen.queryByText('usesHelper', { selector: '.local' })).toBeNull()
    expect(
      (screen.getByRole('searchbox', { name: 'Search model' }) as HTMLInputElement).value,
    ).toBe('')
    expect(screen.getByRole('button', { name: 'Types' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('shows a Development Workbench summary', async () => {
    const { core } = makeFakeCore({
      development: {
        configAnchor: '/dev/morphir.toml',
        modelSources: ['/dev/models/pricing'],
        knowledgeBaseSources: ['/dev/knowledge/rules'],
      },
    })
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: {
        services,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig: defaultUiConfig,
        initialSources: ['/dev'],
      },
    })

    expect(await screen.findByText('Development Workbench')).toBeTruthy()
    expect(screen.getByText('/dev/morphir.toml')).toBeTruthy()
    expect(screen.getByText('/dev/models/pricing')).toBeTruthy()
    expect(screen.getByText('/dev/knowledge/rules')).toBeTruthy()
  })

  test('limits a Document Tree model to its available overview', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const descriptor = {
      ...(await services.inspectWorkbench('/model.json')),
      distribution: 'document-tree' as const,
    }
    if (descriptor.kind !== 'model') throw new Error('expected model descriptor')
    const config = {
      ...defaultUiConfig,
      workbenches: {
        ...defaultUiConfig.workbenches,
        open: [descriptor],
        activeId: descriptor.id,
      },
    }
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: config },
    })

    expect(await screen.findByText('Document Tree Manifest')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'IR Explorer' })).toBeNull()
  })

  test('keeps a restored load failure attached to its Workbench', async () => {
    const { core } = makeFakeCore({ failingLoads: ['/bad.json'] })
    const services = await makeAppServices({ core })
    const inspected = await services.inspectWorkbench('/bad.json')
    if (inspected.kind !== 'model') throw new Error('expected model descriptor')
    const descriptor = { ...inspected, route: 'explorer' as const }
    const config = {
      ...defaultUiConfig,
      workbenches: {
        ...defaultUiConfig.workbenches,
        open: [descriptor],
        activeId: descriptor.id,
      },
    }
    const { container } = render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: config },
    })

    expect(
      container.querySelector('.workbench-view')?.classList.contains('workbench-view-explorer'),
    ).toBe(false)
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid Morphir distribution')
    expect(
      container.querySelector('.workbench-view')?.classList.contains('workbench-view-explorer'),
    ).toBe(false)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  test('empty state offers both supported opening actions', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })

    expect(screen.getAllByRole('button', { name: 'Open model file' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Open folder' }).length).toBeGreaterThan(0)
  })

  test('hydrates the shell from initial config', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const config = {
      ...defaultUiConfig,
      appearance: { colorScheme: 'light' as const, animations: false },
    }
    const { container } = render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: config },
    })
    const root = container.querySelector('.shell')!
    expect(root.classList.contains('theme-light')).toBe(true)
    expect(root.classList.contains('no-motion')).toBe(true)
    expect(screen.getByText('WEB')).toBeTruthy()
  })

  test('persists shell snapshot changes to config (debounced)', async () => {
    const { core, store } = makeFakeCore()
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })
    document
      .getElementById('right-toggle')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 350))
    expect(store.config.shell.rightVisible).toBe(false)
  })

  // Step 3b: node selection flows from InsightNode, through InsightView's onSelect and
  // IrExplorerView's onInspect, into MorphirApp's own `inspected` state, and out to the
  // AppShell inspector snippet.
  test('clicking a reference node in the Insight view populates the shell inspector', async () => {
    const { core } = makeFakeCore({ workspaceContent: insightFixture })
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })

    expect(screen.getByText('Select a node to inspect')).toBeTruthy()

    await userEvent.click(screen.getAllByText('Open model file')[0]!)
    await userEvent.click(await screen.findByRole('tab', { name: 'IR Explorer' }))
    await userEvent.click(screen.getByRole('treeitem', { name: 'usesHelper' }))

    const button = await screen.findByRole('button', { name: /helperFn/ })
    await userEvent.click(button)

    expect(screen.getByText('Morphir.Ui.Fixtures.Insight.helperFn')).toBeTruthy()
  })
})
