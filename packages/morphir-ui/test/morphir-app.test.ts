import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MorphirApp from '../src/shell/MorphirApp.svelte'
import { WorkbenchError, defaultUiConfig, legacySourceRef, makeAppServices } from '../src/index.ts'
import { makeFakeCore, makeFakePipeline } from './support/fake-services.ts'
import { projectKey, sourceKey, type WorkspaceSnapshot } from '@morphir/workspace'

// See ir-explorer.test.ts: readFileSync(new URL(rel, import.meta.url)) breaks under Vite's
// import-analysis in this happy-dom environment. Resolve manually instead.
const insightFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'),
  'utf8',
)

// See ir-explorer.test.ts: this project has no vitest globals, so auto-cleanup from
// @testing-library/svelte never registers itself. Without this, DOM from each render()
// bleeds into the next test in this file.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MorphirApp', () => {
  const renderDeepLinkedApp = async (hash: string) => {
    const { core } = makeFakeCore({ workspaceContent: insightFixture })
    const services = await makeAppServices({ core })
    const source = legacySourceRef('/models/insight.json')
    const descriptor = await services.inspectWorkbench(source)
    if (descriptor.kind !== 'model') throw new Error('expected model descriptor')
    const initialConfig = {
      ...defaultUiConfig,
      workbenches: {
        ...defaultUiConfig.workbenches,
        open: [{ ...descriptor, route: 'explorer' as const }],
        activeId: descriptor.id,
      },
    }
    history.replaceState(null, '', hash)
    return render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig },
    })
  }

  test('keeps a deep link pending while its restored model is loading', async () => {
    const hash =
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody'
    const { core } = makeFakeCore({ workspaceContent: insightFixture })
    const services = await makeAppServices({ core })
    const source = legacySourceRef('/models/insight.json')
    const descriptor = await services.inspectWorkbench(source)
    if (descriptor.kind !== 'model') throw new Error('expected model descriptor')
    let releaseModel!: () => void
    const delayedServices: typeof services = {
      ...services,
      loadModelWorkbench: (requested) =>
        new Promise((resolve, reject) => {
          releaseModel = () => void services.loadModelWorkbench(requested).then(resolve, reject)
        }),
    }
    const initialConfig = {
      ...defaultUiConfig,
      workbenches: {
        ...defaultUiConfig.workbenches,
        open: [{ ...descriptor, route: 'explorer' as const }],
        activeId: descriptor.id,
      },
    }
    history.replaceState(null, '', hash)

    render(MorphirApp, {
      props: {
        services: delayedServices,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig,
      },
    })

    expect(await screen.findByText('Loading insight.json…')).toBeTruthy()
    expect(location.hash).toBe(hash)
    expect(screen.queryByText(/unavailable/i)).toBeNull()

    releaseModel()
    expect(await screen.findByRole('tab', { name: 'XRay' })).toBeTruthy()
  })

  test('hydrates a definition, XRay tab, node selection, expansion, focus, and scroll', async () => {
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined)
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody%2Ffn',
    )
    const xrayTab = await screen.findByRole('tab', { name: 'XRay' })
    expect(xrayTab.getAttribute('aria-selected')).toBe('true')
    const selected = within(screen.getByRole('tree', { name: 'XRay structure' })).getByRole(
      'treeitem',
      { selected: true },
    )
    expect(selected.getAttribute('data-path')).toBe('/body/fn')
    await waitFor(() => expect(document.activeElement).toBe(selected))
    expect(scrollIntoView).toHaveBeenCalled()
  })

  test('explicit definition, tab, and node choices create history entries', async () => {
    await renderDeepLinkedApp('#/')
    const before = history.length
    await userEvent.click(await screen.findByRole('treeitem', { name: 'chainedArithmetic' }))
    await userEvent.click(screen.getByRole('tab', { name: 'XRay' }))
    await userEvent.click(screen.getByRole('treeitem', { name: /body/ }))
    expect(history.length).toBe(before + 3)
    expect(location.hash).toContain('node=%2Fbody')
  })

  test('hashchange restores a previous XRay node', async () => {
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody',
    )
    await screen.findByRole('tree', { name: 'XRay structure' })
    location.hash =
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Foutput'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() =>
      expect(
        within(screen.getByRole('tree', { name: 'XRay structure' }))
          .getByRole('treeitem', { selected: true })
          .getAttribute('data-path'),
      ).toBe('/output'),
    )
  })

  test('browser back and forward restore routed XRay selections', async () => {
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody',
    )
    const xrayTree = await screen.findByRole('tree', { name: 'XRay structure' })
    await userEvent.click(within(xrayTree).getByRole('treeitem', { name: /output/ }))
    expect(location.hash).toContain('node=%2Foutput')

    history.back()
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() =>
      expect(
        within(screen.getByRole('tree', { name: 'XRay structure' }))
          .getByRole('treeitem', { selected: true })
          .getAttribute('data-path'),
      ).toBe('/body'),
    )

    history.forward()
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() =>
      expect(
        within(screen.getByRole('tree', { name: 'XRay structure' }))
          .getByRole('treeitem', { selected: true })
          .getAttribute('data-path'),
      ).toBe('/output'),
    )
  })

  test('visiting Insight preserves the selected XRay path for the return trip', async () => {
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody',
    )
    await screen.findByRole('tree', { name: 'XRay structure' })
    await userEvent.click(screen.getByRole('tab', { name: 'Insight' }))
    expect(location.hash).toContain('view=insight')
    expect(location.hash).toContain('node=%2Fbody')
    await userEvent.click(screen.getByRole('tab', { name: 'XRay' }))
    expect(
      within(screen.getByRole('tree', { name: 'XRay structure' }))
        .getByRole('treeitem', { selected: true })
        .getAttribute('data-path'),
    ).toBe('/body')
  })

  test('an unavailable definition normalizes to the workspace and warns', async () => {
    const before = history.length
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.missing&view=xray&node=%2Fbody',
    )
    expect((await screen.findByRole('status')).textContent).toMatch(/definition.*unavailable/i)
    expect(location.hash).toBe('#/')
    expect(history.length).toBe(before)
    expect(screen.getByText('Select a definition')).toBeTruthy()
  })

  test('a stale node keeps the definition and XRay tab but removes only node', async () => {
    const before = history.length
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody%2Fmissing',
    )
    expect((await screen.findByText(/node .* unavailable/i)).getAttribute('role')).toBe('status')
    expect(location.hash).toBe(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray',
    )
    expect(history.length).toBe(before)
    expect(screen.getByRole('tab', { name: 'XRay' }).getAttribute('aria-selected')).toBe('true')
  })

  test('does not duplicate history for an already-active detail location', async () => {
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody',
    )
    await screen.findByRole('tree', { name: 'XRay structure' })
    const before = history.length

    await userEvent.click(screen.getByRole('tab', { name: 'XRay' }))
    await userEvent.click(
      within(screen.getByRole('tree', { name: 'XRay structure' })).getByRole('treeitem', {
        name: /body/,
      }),
    )

    expect(history.length).toBe(before)
  })

  test('a resolved hashchange clears a prior stale-link warning', async () => {
    await renderDeepLinkedApp(
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fmissing',
    )
    await screen.findByText(/node .* unavailable/i)

    history.replaceState(
      null,
      '',
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Foutput',
    )
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await waitFor(() => expect(screen.queryByText(/node .* unavailable/i)).toBeNull())
  })

  test('keeps each Model Workbench on its own selected route', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const { container } = render(MorphirApp, {
      props: {
        services,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig: defaultUiConfig,
        initialSources: [legacySourceRef('/models/a.json'), legacySourceRef('/models/b.json')],
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
        initialSources: [legacySourceRef('/models/a.json'), legacySourceRef('/models/b.json')],
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

  test('opens a Development Workbench project in the existing explorer', async () => {
    const source = legacySourceRef('/dev')
    const projectId = projectKey(source, 'packages/pricing')
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(source),
      root: source,
      name: 'Development',
      configAnchor: '/dev/morphir.toml',
      state: 'open',
      projects: [
        {
          id: projectId,
          name: 'Pricing',
          version: '1.0.0',
          relativePath: 'packages/pricing',
          configAnchor: 'packages/pricing/morphir.toml',
          sourceDirectory: 'src',
          state: 'unloaded',
          modelSources: [],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      ],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      workspaceContent: insightFixture,
      development: { snapshot },
    })
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: {
        services,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig: defaultUiConfig,
        initialSources: [legacySourceRef('/dev')],
      },
    })

    const project = await screen.findByRole('button', {
      name: 'Project Pricing, packages/pricing, unloaded',
    })
    await userEvent.click(project)

    expect(await screen.findByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search model' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Projects, workspace open, 1 project' })).toBeTruthy()
  })

  test('restores a routed XRay node through the sole Development project after reload', async () => {
    const source = legacySourceRef('/dev')
    const projectId = projectKey(source, 'packages/pricing')
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(source),
      root: source,
      name: 'Development',
      configAnchor: '/dev/morphir.toml',
      state: 'open',
      projects: [
        {
          id: projectId,
          name: 'Pricing',
          version: '1.0.0',
          relativePath: 'packages/pricing',
          configAnchor: 'packages/pricing/morphir.toml',
          sourceDirectory: 'src',
          state: 'unloaded',
          modelSources: [],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      ],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      workspaceContent: insightFixture,
      development: { snapshot },
    })
    const services = await makeAppServices({ core })
    const descriptor = await services.inspectWorkbench(source)
    if (descriptor.kind !== 'development') throw new Error('expected development descriptor')
    const initialConfig = {
      ...defaultUiConfig,
      workbenches: {
        ...defaultUiConfig.workbenches,
        open: [descriptor],
        activeId: descriptor.id,
      },
    }
    const hash =
      '#/?definition=Morphir.Ui.Fixtures.Insight.chainedArithmetic&view=xray&node=%2Fbody%2Ffn'
    history.replaceState(null, '', hash)

    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig },
    })

    expect((await screen.findByRole('tab', { name: 'XRay' })).getAttribute('aria-selected')).toBe(
      'true',
    )
    const selected = within(screen.getByRole('tree', { name: 'XRay structure' })).getByRole(
      'treeitem',
      { selected: true },
    )
    expect(selected.getAttribute('data-path')).toBe('/body/fn')
    await waitFor(() => expect(document.activeElement).toBe(selected))
    expect(location.hash).toBe(hash)
  })

  test('clears routed detail state when switching between loaded Development projects', async () => {
    const source = legacySourceRef('/dev')
    const pricingId = projectKey(source, 'packages/pricing')
    const riskId = projectKey(source, 'packages/risk')
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(source),
      root: source,
      name: 'Development',
      configAnchor: '/dev/morphir.toml',
      state: 'open',
      projects: [
        {
          id: pricingId,
          name: 'Pricing',
          version: '1.0.0',
          relativePath: 'packages/pricing',
          configAnchor: 'packages/pricing/morphir.toml',
          sourceDirectory: 'src',
          state: 'unloaded',
          modelSources: [],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
        {
          id: riskId,
          name: 'Risk',
          version: '1.0.0',
          relativePath: 'packages/risk',
          configAnchor: 'packages/risk/morphir.toml',
          sourceDirectory: 'src',
          state: 'unloaded',
          modelSources: [],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      ],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      workspaceContent: insightFixture,
      development: { snapshot },
    })
    const services = await makeAppServices({ core })
    history.replaceState(null, '', '#/')
    render(MorphirApp, {
      props: {
        services,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig: defaultUiConfig,
        initialSources: [source],
      },
    })

    const pricing = () =>
      screen.getByRole('button', {
        name: 'Project Pricing, packages/pricing, unloaded',
      })
    const risk = () =>
      screen.getByRole('button', {
        name: 'Project Risk, packages/risk, unloaded',
      })
    await screen.findByRole('button', {
      name: 'Project Pricing, packages/pricing, unloaded',
    })
    await userEvent.click(pricing())
    await screen.findByRole('tree', { name: 'Model hierarchy' })
    await userEvent.click(risk())
    await waitFor(() => expect(risk().getAttribute('aria-current')).toBe('page'))
    await screen.findByRole('tree', { name: 'Model hierarchy' })
    await userEvent.click(pricing())
    await waitFor(() => expect(pricing().getAttribute('aria-current')).toBe('page'))

    await userEvent.click(screen.getByRole('treeitem', { name: 'chainedArithmetic' }))
    await userEvent.click(screen.getByRole('tab', { name: 'XRay' }))
    await userEvent.click(
      within(screen.getByRole('tree', { name: 'XRay structure' })).getByRole('treeitem', {
        name: /body/,
      }),
    )
    expect(location.hash).toContain('node=%2Fbody')
    const before = history.length

    await userEvent.click(risk())

    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(history.length).toBe(before)
    expect(await screen.findByText('Select a definition')).toBeTruthy()
    expect(screen.queryByText(/unavailable/i)).toBeNull()
  })

  test('offers access recovery when the initial Development load loses permission', async () => {
    const source = legacySourceRef('/dev')
    const { core } = makeFakeCore()
    const base = await makeAppServices({ core })
    const services = {
      ...base,
      loadDevelopmentWorkbench: async () => {
        throw new WorkbenchError({
          code: 'permission-denied',
          source,
          message: 'Directory access was revoked',
        })
      },
    }

    render(MorphirApp, {
      props: {
        services,
        badge: 'WEB',
        version: '0.0.1',
        initialConfig: defaultUiConfig,
        initialSources: [source],
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Directory access was revoked')
    expect(alert.querySelector('button')?.textContent).toBe('Grant access')
  })

  test('limits a Document Tree model to its available overview', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const descriptor = {
      ...(await services.inspectWorkbench(legacySourceRef('/model.json'))),
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
    const inspected = await services.inspectWorkbench(legacySourceRef('/bad.json'))
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

  // The rail footer already hosts the global Settings action, so the Playground — the
  // other route that is about the session rather than about an open Workbench — belongs
  // beside it.
  test('the Workbench rail opens the Playground', async () => {
    const { core } = makeFakeCore()
    const { pipeline } = makeFakePipeline()
    const services = await makeAppServices({ core, pipeline })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Playground' }))

    expect(await screen.findByLabelText('Source language')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Compile' })).toBeTruthy()
    expect(location.hash).toBe('#/playground')
  })

  test('leaving the Playground returns to the Workbench chrome', async () => {
    const { core } = makeFakeCore()
    const { pipeline } = makeFakePipeline()
    const services = await makeAppServices({ core, pipeline })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Playground' }))
    await screen.findByLabelText('Source language')

    await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }))

    expect(screen.queryByLabelText('Source language')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Open model file' }).length).toBeGreaterThan(0)
  })

  test('a session with no pipeline still reaches the Playground and is told why it is inert', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Playground' }))

    expect((await screen.findByRole('status')).textContent).toMatch(/no compilation pipeline/i)
    expect(screen.getByRole('button', { name: 'Compile' }).hasAttribute('disabled')).toBe(true)
  })
})
