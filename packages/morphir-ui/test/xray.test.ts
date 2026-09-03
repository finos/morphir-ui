import { render, screen, cleanup, waitFor, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import XRayView from '../src/views/insight/XRayView.svelte'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel } from '@morphir/ir'
import { XRAY_NODE_PRESENTATIONS } from '../src/views/insight/xray-presentation.ts'

afterEach(() => cleanup())

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'),
  'utf8',
)

const xrayNodeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/views/insight/XRayNode.svelte'),
  'utf8',
)

const allKindsFixture = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../morphir-ir/test/fixtures/xray-all-kinds-ir.json',
  ),
  'utf8',
)

const defByName = async (name: string) => {
  const lib = await Effect.runPromise(decodeMorphirIr(fixture))
  const entry = lib.modules[0]!.values.find((v) => nameToCamel(v.name) === name)!
  return decodeEntryValueDef(entry)!
}

const allKindsDefinition = async () => {
  const library = await Effect.runPromise(decodeMorphirIr(allKindsFixture))
  const entry = library.modules
    .flatMap((module) => module.values)
    .find((value) => nameToCamel(value.name) === 'allNodes')
  const definition = entry === undefined ? null : decodeEntryValueDef(entry)
  if (!definition) throw new Error('Missing allNodes definition from exhaustive XRay fixture')
  return definition
}

describe('XRayView', () => {
  const branch = (path: string): HTMLButtonElement => {
    const element = document.querySelector<HTMLButtonElement>(`[data-xray-path="${path}"]`)
    if (!element) throw new Error(`Missing XRay branch ${path}`)
    return element
  }

  test('renders the node kinds of a simple arithmetic body', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    expect(screen.getAllByText('apply').length).toBeGreaterThan(0)
    expect(screen.getAllByText('value-reference').length).toBeGreaterThan(0)
    expect(screen.getAllByText('variable').length).toBeGreaterThan(0)
  })

  test('separates search actions and filters into toolbar rows', async () => {
    const { container } = render(XRayView, {
      props: { def: await defByName('chainedArithmetic') },
    })
    const primary = container.querySelector<HTMLElement>('.xray-toolbar-primary')
    const filters = container.querySelector<HTMLElement>('.xray-toolbar-filters')

    expect(primary).not.toBeNull()
    expect(filters).not.toBeNull()
    expect(within(primary!).getByRole('searchbox', { name: 'Search XRay' })).toBeTruthy()
    expect(within(primary!).getByRole('button', { name: 'Expand all' })).toBeTruthy()
    expect(within(primary!).getByRole('button', { name: 'Collapse all' })).toBeTruthy()
    expect(within(primary!).getByRole('status')).toBeTruthy()
    expect(within(filters!).getByText('Filter')).toBeTruthy()
    expect(within(filters!).getByRole('group', { name: 'XRay search scopes' })).toBeTruthy()
    expect(within(filters!).queryByText('matching paths auto-expanded')).toBeNull()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search XRay' }), 'Basics.add')

    expect(within(filters!).getByText('matching paths auto-expanded')).toBeTruthy()
  })

  test('renders every projected kind through the presentation catalog', async () => {
    const { container } = render(XRayView, { props: { def: await allKindsDefinition() } })

    await waitFor(() => {
      const renderedKinds = new Set(
        Array.from(container.querySelectorAll<HTMLElement>('[data-xray-kind]')).map(
          (element) => element.dataset.xrayKind!,
        ),
      )

      expect([...renderedKinds].sort()).toEqual(Object.keys(XRAY_NODE_PRESENTATIONS).sort())
    })
  })

  test('renders inputs and output sections', async () => {
    render(XRayView, { props: { def: await defByName('gradeIf') } })
    expect(screen.getByText('inputs')).toBeTruthy()
    expect(screen.getByText('output')).toBeTruthy()
    expect(screen.getAllByText('if-then-else').length).toBeGreaterThan(0)
  })

  test('unknown nodes render the fallback marker', async () => {
    render(XRayView, {
      props: {
        def: {
          inputs: [],
          output: { kind: 'type-unit' },
          body: { kind: 'unknown', tag: 'Mystery', raw: null },
        },
      },
    })
    expect(screen.getByText(/Mystery/)).toBeTruthy()
    expect(screen.getByText(/raw unavailable in xray/)).toBeTruthy()
  })

  test('null def renders an empty state', () => {
    render(XRayView, { props: { def: null } })
    expect(screen.getByText(/could not be decoded/i)).toBeTruthy()
  })

  test('typeRaw renders a projected standalone type root', () => {
    render(XRayView, {
      props: {
        typeRaw: ['Reference', {}, [[['morphir']], [['sdk'], ['basics']], ['int']], []],
      },
    })

    expect(screen.getByText('type-reference')).toBeTruthy()
    expect(screen.getByText('["int"]')).toBeTruthy()
  })

  // Regression for the pair-wrapper blind spot: pattern-match cases (`{pattern, body}`) have
  // no `kind` of their own, so before the fix they fell through to a single-line
  // JSON.stringify blob instead of being browsable. Each case's pattern/body should now show
  // up as its own disclosure node, with the leaf kinds visible in the rendered text.
  test('a pattern-match case renders its pattern and body as browsable nodes, not a JSON blob', async () => {
    const { container } = render(XRayView, { props: { def: await defByName('maybeCase') } })
    expect(screen.getByText('pattern-match')).toBeTruthy()
    expect(screen.getAllByText('constructor-pattern').length).toBeGreaterThan(0)
    // Just x -> x
    expect(screen.getAllByText('variable').length).toBeGreaterThan(0)
    // Nothing -> 0
    expect(screen.getAllByText('literal').length).toBeGreaterThan(0)
    expect(container.textContent).not.toMatch(/\{"kind":/)
  })

  test('value-record fields render as browsable name/value nodes, not a JSON blob', async () => {
    const { container } = render(XRayView, { props: { def: await defByName('personRecord') } })
    expect(screen.getByText('value-record')).toBeTruthy()
    expect(screen.getAllByText('literal').length).toBeGreaterThan(0)
    expect(screen.getByText('string')).toBeTruthy()
    expect(screen.getByText('whole-number')).toBeTruthy()
    expect(container.textContent).not.toMatch(/\{"kind":/)
  })

  test("letBound's nested let-definition ValueDef is browsable, not a JSON blob", async () => {
    const { container } = render(XRayView, { props: { def: await defByName('letBound') } })
    expect(screen.getAllByText('let-definition').length).toBeGreaterThan(0)
    expect(container.textContent).not.toMatch(/\{"kind":/)
  })

  test('values search retains the matching Basics.add reference and its apply ancestors', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search XRay' }), 'Basics.add')

    expect(screen.getByRole('status').textContent).toBe('2 matches')
    expect(screen.getAllByText('value-reference')).toHaveLength(2)
    expect(screen.getAllByText('apply').length).toBeGreaterThan(0)
    expect(screen.queryByText('inputs')).toBeNull()
  })

  test('type-scoped search exposes readable Int type chips', async () => {
    const { container } = render(XRayView, {
      props: { def: await defByName('chainedArithmetic') },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Types' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search XRay' }), 'Int')

    expect(
      Array.from(container.querySelectorAll('.xray-type')).map((chip) => chip.textContent),
    ).toContain('Int')
    expect(container.querySelector('.xray-type')?.classList.contains('type-badge')).toBe(true)
    expect(xrayNodeSource).toMatch(/\.type-badge\s*\{[^}]*color:\s*var\(--text\)/)
  })

  test('null and opaque attrs omit type chips without hiding their rows', () => {
    const { container, unmount } = render(XRayView, {
      props: {
        def: {
          inputs: [],
          output: { kind: 'type-unit' },
          body: {
            kind: 'literal',
            attr: null,
            literal: { kind: 'whole-number', value: 1 },
          },
        },
      },
    })

    expect(screen.getAllByText('literal').length).toBeGreaterThan(0)
    expect(container.querySelector('.xray-type')).toBeNull()

    unmount()
    const opaque = render(XRayView, {
      props: {
        def: {
          inputs: [],
          output: { kind: 'type-unit' },
          body: {
            kind: 'literal',
            attr: { opaque: true },
            literal: { kind: 'whole-number', value: 1 },
          },
        },
      },
    })
    expect(screen.getAllByText('literal').length).toBeGreaterThan(0)
    expect(opaque.container.querySelector('.xray-type')).toBeNull()
  })

  test('a no-result query keeps the toolbar and clear search restores the tree', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    const search = screen.getByRole('searchbox', { name: 'Search XRay' })

    await userEvent.click(screen.getByRole('button', { name: 'Types' }))
    await userEvent.type(search, 'not-present-in-this-definition')

    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeTruthy()
    expect(screen.getByText('No matching nodes')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Types' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByText('apply').length).toBeGreaterThan(0)
  })

  test('search scope controls accurately report pressed state', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    const scopes = within(screen.getByRole('group', { name: 'XRay search scopes' }))
    const all = scopes.getByRole('button', { name: 'All' })
    const kinds = scopes.getByRole('button', { name: 'Kinds' })
    const fields = scopes.getByRole('button', { name: 'Fields' })
    const values = scopes.getByRole('button', { name: 'Values' })
    const types = scopes.getByRole('button', { name: 'Types' })

    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(kinds.getAttribute('aria-pressed')).toBe('false')
    expect(fields.getAttribute('aria-pressed')).toBe('false')
    expect(values.getAttribute('aria-pressed')).toBe('false')
    expect(types.getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(kinds)
    await userEvent.click(values)
    expect(all.getAttribute('aria-pressed')).toBe('false')
    expect(kinds.getAttribute('aria-pressed')).toBe('true')
    expect(values.getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(kinds)
    await userEvent.click(values)
    expect(all.getAttribute('aria-pressed')).toBe('true')
  })

  test('changing the represented definition resets filters and expansion for the new tree', async () => {
    const view = render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    const search = screen.getByRole('searchbox', { name: 'Search XRay' })

    await userEvent.type(search, 'Basics.add')
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    await view.rerender({ def: await defByName('gradeIf') })

    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(branch('/body').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText('if-then-else').length).toBeGreaterThan(0)
  })

  test('expand and collapse controls preserve manual expansion across a search', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    const body = branch('/body')

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(body.getAttribute('aria-expanded')).toBe('false')
    expect(body.parentElement?.querySelector('.children')).toBeNull()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search XRay' }), 'Basics.add')
    expect(branch('/body').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText('apply').length).toBeGreaterThan(0)

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search XRay' }))
    expect(branch('/body').getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(branch('/body').getAttribute('aria-expanded')).toBe('true')
    expect(branch('/body').parentElement?.querySelector('.children')).toBeTruthy()
    expect(screen.getAllByText('apply').length).toBeGreaterThan(0)
  })

  test('branch controls expose their visible label and kind to assistive technology', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })

    const body = branch('/body')
    expect(body.getAttribute('aria-label')).toBeNull()
    expect(screen.getByRole('treeitem', { name: /body.*apply.*Int/ })).toBe(body)
  })

  test('exposes a named tree with selectable rows and one roving tab stop', async () => {
    const { container } = render(XRayView, {
      props: { def: await defByName('chainedArithmetic'), selectedPath: '/body' },
    })

    const tree = screen.getByRole('tree', { name: 'XRay structure' })
    const body = within(tree).getByRole('treeitem', { name: /body.*apply/ })
    const rows = within(tree).getAllByRole('treeitem')

    expect(body.getAttribute('aria-level')).toBe('1')
    expect(body.getAttribute('aria-expanded')).toBe('true')
    expect(body.getAttribute('aria-selected')).toBe('true')
    expect(rows.every((row) => row instanceof HTMLButtonElement)).toBe(true)
    expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
    expect(container.querySelectorAll('[role="treeitem"]:not([tabindex="-1"])')).toHaveLength(1)
  })

  test('supports visible-order arrow navigation and keyboard selection', async () => {
    const onSelectedPath = vi.fn()
    render(XRayView, {
      props: { def: await defByName('chainedArithmetic'), onSelectedPath },
    })
    const tree = screen.getByRole('tree', { name: 'XRay structure' })
    const body = within(tree).getByRole('treeitem', { name: /body.*apply/ })
    body.focus()

    await userEvent.keyboard('{ArrowRight}')
    expect((document.activeElement as HTMLElement).dataset.path).toMatch(/^\/body\//)

    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onSelectedPath).toHaveBeenCalledWith(
      (document.activeElement as HTMLElement).dataset.path,
    )
  })

  test('Left collapses an open branch before moving to its parent', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    const body = branch('/body')
    body.focus()

    await userEvent.keyboard('{ArrowLeft}')
    expect(body.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(body)

    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    const child = document.activeElement as HTMLElement
    expect(child.dataset.path).toMatch(/^\/body\//)
    await userEvent.keyboard('{ArrowLeft}')
    expect(child.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(child)
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(body)
  })

  test('Space selects a row and prevents page scrolling', async () => {
    const onSelectedPath = vi.fn()
    render(XRayView, { props: { def: await defByName('gradeIf'), onSelectedPath } })
    const body = branch('/body')
    body.focus()
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })

    body.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onSelectedPath).toHaveBeenCalledWith('/body')
  })

  test('Home and End move focus across the visible tree', async () => {
    render(XRayView, { props: { def: await defByName('gradeIf') } })
    const body = branch('/body')
    body.focus()

    await userEvent.keyboard('{Home}')
    expect((document.activeElement as HTMLElement).dataset.path).toBe('/inputs')

    await userEvent.keyboard('{End}')
    expect((document.activeElement as HTMLElement).dataset.path).toMatch(/^\/body/)
  })

  test('prevents browser scrolling for navigation keys at tree boundaries only', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    const dispatchKey = (target: HTMLElement, key: string): boolean => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }

    const leaf = document.querySelector<HTMLElement>('[data-path="/output/args"]')!
    expect(dispatchKey(leaf, 'ArrowRight')).toBe(true)
    expect(dispatchKey(leaf, 'x')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(dispatchKey(branch('/inputs'), 'ArrowUp')).toBe(true)
    expect(dispatchKey(branch('/inputs'), 'ArrowLeft')).toBe(true)
    expect(dispatchKey(branch('/body'), 'ArrowDown')).toBe(true)
  })

  test('click selects rows in uncontrolled mode and reports selection in controlled mode', async () => {
    const def = await defByName('chainedArithmetic')
    const uncontrolled = render(XRayView, { props: { def } })
    const outputLeaf = document.querySelector<HTMLButtonElement>('[data-xray-path="/output/args"]')!

    await userEvent.click(outputLeaf)
    expect(outputLeaf.getAttribute('aria-selected')).toBe('true')

    uncontrolled.unmount()
    const onSelectedPath = vi.fn()
    render(XRayView, { props: { def, selectedPath: '/body', onSelectedPath } })
    const controlledOutput = branch('/output')
    expect(controlledOutput.getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(controlledOutput)

    expect(onSelectedPath).toHaveBeenCalledWith('/output')
    expect(branch('/body').getAttribute('aria-selected')).toBe('true')
    expect(controlledOutput.getAttribute('aria-selected')).toBe('false')
    expect(controlledOutput.getAttribute('aria-expanded')).toBe('false')
  })

  test('controlled selection expands ancestors and moves focus only when the path changes', async () => {
    const def = await defByName('chainedArithmetic')
    const view = render(XRayView, { props: { def, selectedPath: null } })
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    const search = screen.getByRole('searchbox', { name: 'Search XRay' })
    search.focus()
    await userEvent.type(search, 'apply')
    expect(document.activeElement).toBe(search)

    await view.rerender({ def, selectedPath: '/body/fn' })

    await vi.waitFor(() => {
      expect(branch('/body').getAttribute('aria-expanded')).toBe('true')
      expect((document.activeElement as HTMLElement).dataset.path).toBe('/body/fn')
    })

    search.focus()
    await userEvent.clear(search)
    await userEvent.type(search, 'Basics.add')
    expect(document.activeElement).toBe(search)
  })

  test('keeps a filtered-out selection and clears filters from its notice', async () => {
    render(XRayView, {
      props: { def: await defByName('chainedArithmetic'), selectedPath: '/inputs' },
    })

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search XRay' }), 'Basics.add')

    expect(screen.getByRole('status', { name: 'Selected XRay node hidden' }).textContent).toContain(
      'The selected node is hidden by the current filters.',
    )
    expect(document.querySelector('[data-path="/inputs"]')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect((screen.getByRole('searchbox', { name: 'Search XRay' }) as HTMLInputElement).value).toBe(
      '',
    )
    expect(branch('/inputs').getAttribute('aria-selected')).toBe('true')
  })

  test('does not describe a selected descendant as filtered out when its branch is collapsed', async () => {
    render(XRayView, {
      props: { def: await defByName('chainedArithmetic'), selectedPath: '/body/fn' },
    })

    await userEvent.click(branch('/body'))

    expect(screen.queryByRole('status', { name: 'Selected XRay node hidden' })).toBeNull()
  })
})
