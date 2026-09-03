import { cleanup, render, screen, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import IrExplorerView from '../src/views/IrExplorerView.svelte'
import { definitionForFqn, definitionFqn } from '../src/views/insight/detail-location.ts'
import { legacySourceRef, makeAppServices, type ModelWorkbenchData } from '../src/index.ts'
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

const openModel = async (): Promise<ModelWorkbenchData> => {
  const { core } = makeFakeCore({ workspaceContent: irFixture })
  const services = await makeAppServices({ core })
  const descriptor = await services.inspectWorkbench(legacySourceRef('/models/listType.json'))
  if (descriptor.kind !== 'model') throw new Error('expected model descriptor')
  return services.loadModelWorkbench(descriptor)
}

describe('IrExplorerView', () => {
  test('identifies definitions by an exact unique fully-qualified name', async () => {
    const model = await openModel()
    if (!model.ir) throw new Error('expected decoded IR')
    const listExample = model.ir.definitions.find(
      (definition) => definition.ref.localName === 'listExample',
    )
    if (!listExample) throw new Error('expected listExample')

    expect(definitionFqn(listExample)).toBe('Morphir.Example.App.Forecast.listExample')
    expect(definitionForFqn(model.ir.definitions, 'Morphir.Example.App.Forecast.listExample')).toBe(
      listExample,
    )
    expect(
      definitionForFqn(
        [...model.ir.definitions, { ...listExample }],
        'Morphir.Example.App.Forecast.listExample',
      ),
    ).toBeNull()
  })

  test('opens a controlled definition directly in XRay without reporting hydration', async () => {
    const onDetailLocation = vi.fn()
    render(IrExplorerView, {
      props: {
        model: await openModel(),
        detailLocation: {
          definition: 'Morphir.Example.App.Forecast.listExample',
          view: 'xray',
          node: '/body',
        },
        onDetailLocation,
      },
    })

    expect(screen.getByRole('tab', { name: 'XRay' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('treeitem', { name: /body/ }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(onDetailLocation).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('treeitem', { name: /output/ }))
    expect(onDetailLocation).toHaveBeenLastCalledWith({
      definition: 'Morphir.Example.App.Forecast.listExample',
      view: 'xray',
      node: '/output',
    })
  })

  test('preserves a controlled XRay node across tabs and clears it for another definition', async () => {
    const onDetailLocation = vi.fn()
    const view = render(IrExplorerView, {
      props: {
        model: await openModel(),
        detailLocation: {
          definition: 'Morphir.Example.App.Forecast.listExample',
          view: 'xray',
          node: '/body',
        },
        onDetailLocation,
      },
    })

    await userEvent.click(screen.getByRole('tab', { name: 'Insight' }))
    expect(onDetailLocation).toHaveBeenLastCalledWith({
      definition: 'Morphir.Example.App.Forecast.listExample',
      view: 'insight',
      node: '/body',
    })

    await view.rerender({
      model: await openModel(),
      detailLocation: {
        definition: 'Morphir.Example.App.Forecast.listExample',
        view: 'insight',
        node: '/body',
      },
      onDetailLocation,
    })

    await userEvent.click(screen.getByRole('treeitem', { name: 'WindDirection' }))
    expect(onDetailLocation).toHaveBeenLastCalledWith({
      definition: 'Morphir.Example.App.Forecast.WindDirection',
      view: 'type',
    })
  })

  test('reports controlled detail resolution after IR and node validation', async () => {
    const model = await openModel()
    const onDetailResolution = vi.fn()
    const view = render(IrExplorerView, {
      props: {
        model: { ...model, ir: null },
        detailLocation: {
          definition: 'Morphir.Example.App.Forecast.listExample',
          view: 'xray',
          node: '/body/missing',
        },
        onDetailResolution,
      },
    })
    expect(onDetailResolution).toHaveBeenLastCalledWith({ kind: 'pending' })

    await view.rerender({
      model,
      detailLocation: {
        definition: 'Morphir.Example.App.Forecast.listExample',
        view: 'xray',
        node: '/body/missing',
      },
      onDetailResolution,
    })
    expect(onDetailResolution).toHaveBeenLastCalledWith({
      kind: 'invalid-node',
      definition: 'Morphir.Example.App.Forecast.listExample',
      node: '/body/missing',
    })

    await view.rerender({
      model,
      detailLocation: {
        definition: 'Morphir.Example.App.Forecast.listExample',
        view: 'xray',
        node: '/body',
      },
      onDetailResolution,
    })
    expect(onDetailResolution).toHaveBeenLastCalledWith({ kind: 'resolved' })

    await view.rerender({
      model,
      detailLocation: {
        definition: 'Morphir.Example.App.Forecast.missing',
        view: 'xray',
      },
      onDetailResolution,
    })
    expect(onDetailResolution).toHaveBeenLastCalledWith({
      kind: 'invalid-definition',
      definition: 'Morphir.Example.App.Forecast.missing',
    })

    const reportCount = onDetailResolution.mock.calls.length
    await view.rerender({ model, detailLocation: undefined, onDetailResolution })
    await screen.findByText('Select a definition')
    await view.rerender({
      model,
      detailLocation: {
        definition: 'Morphir.Example.App.Forecast.missing',
        view: 'xray',
      },
      onDetailResolution,
    })
    expect(onDetailResolution).toHaveBeenCalledTimes(reportCount + 1)
  })

  test('renders the model hierarchy instead of the old explorer columns', async () => {
    render(IrExplorerView, { props: { model: await openModel() } })
    const tree = screen.getByRole('tree', { name: 'Model hierarchy' })

    expect(within(tree).getByRole('treeitem', { name: 'Morphir.Example.App' })).toBeTruthy()
    expect(within(tree).getByRole('treeitem', { name: 'Forecast' })).toBeTruthy()
    expect(within(tree).getByRole('treeitem', { name: 'listExample' })).toBeTruthy()
    expect(within(tree).getByRole('treeitem', { name: 'WindDirection' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Package' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Modules' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Definitions' })).toBeNull()
    expect(screen.getByText('Select a definition')).toBeTruthy()
    expect(screen.getByText('Choose a type or value from the model hierarchy.')).toBeTruthy()
  })

  test('keeps the hierarchy visible when a definition opens beside it', async () => {
    render(IrExplorerView, { props: { model: await openModel() } })
    await userEvent.click(screen.getByRole('treeitem', { name: 'listExample' }))

    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(screen.getByText('Insight')).toBeTruthy()
    expect(screen.getByText('XRay')).toBeTruthy()
    expect(screen.queryByText('Back')).toBeNull()
  })

  test('supports a controlled definition selection for Development Workbenches', async () => {
    const model = await openModel()
    const onSelectedDefinition = vi.fn()
    const view = render(IrExplorerView, {
      props: { model, selectedDefinitionId: null, onSelectedDefinition },
    })

    await userEvent.click(screen.getByRole('treeitem', { name: 'listExample' }))
    const selectedId = 'definition:value:Morphir.Example.App:Forecast:listExample'
    expect(onSelectedDefinition).toHaveBeenCalledWith(selectedId)

    await view.rerender({ model, selectedDefinitionId: selectedId, onSelectedDefinition })
    expect(
      screen.getByText('listExample', { selector: '.local' }).closest('.fqn')?.textContent,
    ).toBe('Morphir.Example.App.Forecast.listExample')
  })

  test('keeps selected detail when a kind filter hides its tree leaf', async () => {
    render(IrExplorerView, { props: { model: await openModel() } })
    await userEvent.click(screen.getByRole('treeitem', { name: 'WindDirection' }))
    expect(
      screen.getByText('WindDirection', { selector: '.local' }).closest('.fqn')?.textContent,
    ).toBe('Morphir.Example.App.Forecast.WindDirection')

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Definition filters' })).getByRole('button', {
        name: 'Types',
      }),
    )

    expect(screen.queryByRole('treeitem', { name: 'WindDirection' })).toBeNull()
    expect(
      screen.getByText('WindDirection', { selector: '.local' }).closest('.fqn')?.textContent,
    ).toBe('Morphir.Example.App.Forecast.WindDirection')
  })

  test('keeps selected detail when search hides its tree leaf', async () => {
    render(IrExplorerView, { props: { model: await openModel() } })
    await userEvent.click(screen.getByRole('treeitem', { name: 'WindDirection' }))

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search model' }), 'list')

    expect(screen.queryByRole('treeitem', { name: 'WindDirection' })).toBeNull()
    expect(screen.getByText('WindDirection', { selector: '.local' })).toBeTruthy()
  })

  test('reports an unresolved tree definition without disabling navigation', async () => {
    const model = await openModel()
    if (!model.ir) throw new Error('expected decoded IR')
    const firstModule = model.ir.modules[0]
    if (!firstModule) throw new Error('expected first module')
    const missing = {
      ref: {
        packageName: firstModule.packageName,
        moduleName: firstModule.name,
        localName: 'MissingDefinition',
      },
      kind: 'type' as const,
      access: 'Public' as const,
      doc: null,
    }
    const inconsistent = {
      ...model,
      ir: { ...model.ir, definitions: [...model.ir.definitions, missing] },
    }

    render(IrExplorerView, { props: { model: inconsistent } })
    await userEvent.click(screen.getByRole('treeitem', { name: 'MissingDefinition' }))

    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(
      `${firstModule.packageName}.${firstModule.name}.MissingDefinition`,
    )
    expect(screen.queryByText('Select a definition')).toBeNull()
  })

  test('does not resolve a definition from a different package', async () => {
    const model = await openModel()
    if (!model.ir) throw new Error('expected decoded IR')
    const packageName = 'Other.Package'
    const inconsistent = {
      ...model,
      ir: {
        ...model.ir,
        package: { ...model.ir.package, name: packageName },
        modules: model.ir.modules.map((module) => ({ ...module, packageName })),
        definitions: model.ir.definitions.map((definition) => ({
          ...definition,
          ref: { ...definition.ref, packageName },
        })),
      },
    }

    render(IrExplorerView, { props: { model: inconsistent } })
    await userEvent.click(screen.getByRole('treeitem', { name: 'listExample' }))

    expect(screen.getByRole('alert').textContent).toContain('Other.Package.Forecast.listExample')
    expect(screen.queryByText('Insight')).toBeNull()
  })

  test('opens the selected value in XRay', async () => {
    render(IrExplorerView, { props: { model: await openModel() } })
    await userEvent.click(screen.getByRole('treeitem', { name: 'listExample' }))
    expect(screen.getByText('Insight')).toBeTruthy()
    expect(screen.getByText('XRay')).toBeTruthy()
    await userEvent.click(screen.getByText('XRay'))
    expect(screen.getAllByText('value-list').length).toBeGreaterThan(0)
  })
})
