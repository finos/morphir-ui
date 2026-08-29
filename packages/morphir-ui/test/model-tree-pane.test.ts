import type { WorkspaceIr } from '@morphir/ir'
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ModelTreePane from '../src/views/model-tree/ModelTreePane.svelte'

afterEach(() => cleanup())

const IR: WorkspaceIr = {
  package: { name: 'Acme', moduleCount: 2 },
  modules: [
    { packageName: 'Acme', name: 'Accounts', typeCount: 1, valueCount: 1 },
    { packageName: 'Acme', name: 'Payments', typeCount: 1, valueCount: 1 },
  ],
  definitions: [
    {
      ref: { packageName: 'Acme', moduleName: 'Accounts', localName: 'Account' },
      kind: 'type',
      access: 'Public',
      doc: null,
    },
    {
      ref: { packageName: 'Acme', moduleName: 'Accounts', localName: 'openAccount' },
      kind: 'value',
      access: 'Public',
      doc: null,
    },
    {
      ref: { packageName: 'Acme', moduleName: 'Payments', localName: 'Payment' },
      kind: 'type',
      access: 'Public',
      doc: null,
    },
    {
      ref: { packageName: 'Acme', moduleName: 'Payments', localName: 'settlePayment' },
      kind: 'value',
      access: 'Private',
      doc: null,
    },
  ],
}

const treeItem = (name: string): HTMLElement => screen.getByRole('treeitem', { name })

describe('ModelTreePane', () => {
  test('starts with the package and first module expanded without selecting a definition', () => {
    render(ModelTreePane, { props: { ir: IR } })

    expect(treeItem('Acme').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('Accounts').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('Payments').getAttribute('aria-expanded')).toBe('false')
    expect(treeItem('Account')).toBeTruthy()
    expect(treeItem('openAccount')).toBeTruthy()
    expect(screen.queryByRole('treeitem', { name: 'Payment' })).toBeNull()
    expect(treeItem('Account').getAttribute('aria-selected')).toBe('false')
  })

  test('marks only the selected definition leaf as selected', () => {
    render(ModelTreePane, {
      props: {
        ir: IR,
        selectedId: 'definition:type:Acme:Accounts:Account',
      },
    })

    expect(treeItem('Account').getAttribute('aria-selected')).toBe('true')
    expect(treeItem('openAccount').getAttribute('aria-selected')).toBe('false')
    expect(treeItem('Accounts').hasAttribute('aria-selected')).toBe(false)
  })

  test('searches globally and restores the exact custom normal expansion when cleared', async () => {
    render(ModelTreePane, { props: { ir: IR } })
    const search = screen.getByRole('searchbox', { name: 'Search model' })

    await userEvent.click(treeItem('Accounts'))
    await userEvent.click(treeItem('Payments'))
    expect(treeItem('Accounts').getAttribute('aria-expanded')).toBe('false')
    expect(treeItem('Payments').getAttribute('aria-expanded')).toBe('true')

    await userEvent.type(search, 'settle')

    expect(treeItem('Payments').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('settlePayment')).toBeTruthy()
    expect(screen.getByText('1 result across 1 module')).toBeTruthy()

    await userEvent.click(search)
    await userEvent.keyboard('{Escape}')

    expect(treeItem('Accounts').getAttribute('aria-expanded')).toBe('false')
    expect(treeItem('Payments').getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('treeitem', { name: 'Account' })).toBeNull()
    expect(treeItem('Payment')).toBeTruthy()
  })

  test('Escape clears a whitespace-only raw query', async () => {
    render(ModelTreePane, { props: { ir: IR } })
    const search = screen.getByRole('searchbox', { name: 'Search model' }) as HTMLInputElement

    await userEvent.type(search, '   ')
    expect(search.value).toBe('   ')

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    search.dispatchEvent(escape)
    await Promise.resolve()

    expect(escape.defaultPrevented).toBe(true)
    expect(search.value).toBe('')
  })

  test('filters types and values independently', async () => {
    render(ModelTreePane, { props: { ir: IR } })
    const types = screen.getByRole('button', { name: 'Types' })

    await userEvent.click(types)

    expect(types.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('treeitem', { name: 'Account' })).toBeNull()
    expect(treeItem('openAccount')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Values' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('branch clicks only toggle while definition clicks select their DefinitionInfo', async () => {
    const onSelect = vi.fn()
    render(ModelTreePane, { props: { ir: IR, onSelect } })

    await userEvent.click(treeItem('Accounts'))
    expect(onSelect).not.toHaveBeenCalled()
    await userEvent.click(treeItem('Accounts'))
    await userEvent.click(treeItem('Account'))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(IR.definitions[0])
  })

  test('temporarily collapses and reopens auto-revealed search branches', async () => {
    render(ModelTreePane, { props: { ir: IR } })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search model' }), 'payment')

    await userEvent.click(treeItem('Payments'))
    expect(treeItem('Payments').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('treeitem', { name: 'Payment' })).toBeNull()

    const search = screen.getByRole('searchbox', { name: 'Search model' })
    await userEvent.clear(search)
    await userEvent.type(search, 'pay')
    expect(treeItem('Payments').getAttribute('aria-expanded')).toBe('true')

    await userEvent.click(treeItem('Payments'))
    await userEvent.click(treeItem('Payments'))
    expect(treeItem('Payments').getAttribute('aria-expanded')).toBe('true')
    expect(treeItem('Payment')).toBeTruthy()
  })

  test('supports roving tree keyboard navigation and activation', async () => {
    const onSelect = vi.fn()
    render(ModelTreePane, { props: { ir: IR, onSelect } })
    const search = screen.getByRole('searchbox', { name: 'Search model' })
    const acme = treeItem('Acme')

    acme.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(treeItem('Accounts'))
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(treeItem('Account'))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(treeItem('openAccount'))
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(treeItem('Account'))
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(treeItem('Accounts'))
    await userEvent.keyboard('{ArrowLeft}')
    expect(treeItem('Accounts').getAttribute('aria-expanded')).toBe('false')
    await userEvent.keyboard('{Enter}')
    expect(treeItem('Accounts').getAttribute('aria-expanded')).toBe('true')
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith(IR.definitions[0])

    await userEvent.type(search, 'settle')
    treeItem('settlePayment').focus()
    await userEvent.keyboard('{Escape}')
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('treeitem', { name: 'settlePayment' })).toBeNull()
  })

  test('Escape from a search-only row moves focus to a surviving tree item', async () => {
    render(ModelTreePane, { props: { ir: IR } })
    const search = screen.getByRole('searchbox', { name: 'Search model' }) as HTMLInputElement
    await userEvent.type(search, 'settle')
    const searchOnlyRow = treeItem('settlePayment')
    searchOnlyRow.focus()

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    searchOnlyRow.dispatchEvent(escape)

    await waitFor(() => {
      expect(search.value).toBe('')
      expect(document.activeElement).toBe(treeItem('Acme'))
    })
  })

  test('keyboard focus stays within the pane where navigation originated', async () => {
    const first = render(ModelTreePane, { props: { ir: IR } })
    const second = render(ModelTreePane, { props: { ir: IR } })
    const secondPane = within(second.container)
    secondPane.getByRole('treeitem', { name: 'Acme' }).focus()

    await userEvent.keyboard('{ArrowRight}')

    expect(document.activeElement).toBe(secondPane.getByRole('treeitem', { name: 'Accounts' }))
    expect(document.activeElement).not.toBe(
      within(first.container).getByRole('treeitem', { name: 'Accounts' }),
    )
  })

  test('prevents defaults only for handled tree keys', () => {
    render(ModelTreePane, { props: { ir: IR } })
    const account = treeItem('Account')

    for (const key of ['ArrowDown', 'Enter', ' ']) {
      const handled = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      account.dispatchEvent(handled)
      expect(handled.defaultPrevented).toBe(true)
    }

    const unhandled = new KeyboardEvent('keydown', {
      key: 'Home',
      bubbles: true,
      cancelable: true,
    })
    account.dispatchEvent(unhandled)
    expect(unhandled.defaultPrevented).toBe(false)
  })

  test('collapses to and expands from a labeled vertical rail', async () => {
    const { container } = render(ModelTreePane, { props: { ir: IR } })

    const collapse = screen.getByRole('button', { name: 'Collapse model hierarchy' })
    await userEvent.click(collapse)
    expect(screen.queryByRole('tree', { name: 'Model hierarchy' })).toBeNull()
    const rail = container.querySelector('.collapsed-rail') as HTMLElement
    const expand = screen.getByRole('button', { name: 'Expand model hierarchy' })
    const label = within(expand).getByText('Model')
    expect(rail).toBeTruthy()
    expect({
      width: rail.style.width,
      verticalLabel: label.classList.contains('vertical-label'),
    }).toEqual({ width: '32px', verticalLabel: true })
    expect(label.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(expand)

    await userEvent.click(expand)
    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Collapse model hierarchy' }),
    )
  })

  test('starts at 280px and clamps pointer resizing to 220px and 420px', async () => {
    const { container } = render(ModelTreePane, { props: { ir: IR } })
    const pane = container.querySelector('.model-tree-pane') as HTMLElement
    const separator = screen.getByRole('separator', { name: 'Resize model hierarchy' })
    let capturedPointer: number | null = null
    Object.defineProperties(separator, {
      setPointerCapture: {
        value: (pointerId: number) => (capturedPointer = pointerId),
      },
      hasPointerCapture: {
        value: (pointerId: number) => capturedPointer === pointerId,
      },
      releasePointerCapture: {
        value: () => (capturedPointer = null),
      },
    })
    const dispatchPointer = (type: string, clientX: number): void => {
      separator.dispatchEvent(
        new PointerEvent(type, { bubbles: true, clientX, pointerId: 7, cancelable: true }),
      )
    }

    expect(pane.style.width).toBe('280px')

    dispatchPointer('pointerdown', 100)
    dispatchPointer('pointermove', -1000)
    await Promise.resolve()
    expect(pane.style.width).toBe('220px')
    dispatchPointer('pointerup', -1000)

    dispatchPointer('pointerdown', 100)
    dispatchPointer('pointermove', 1000)
    await Promise.resolve()
    expect(pane.style.width).toBe('420px')
    dispatchPointer('pointerup', 1000)
  })

  test('shows a reset action when active search and filters have no matches', async () => {
    render(ModelTreePane, { props: { ir: IR } })
    const search = screen.getByRole('searchbox', { name: 'Search model' })

    await userEvent.click(screen.getByRole('button', { name: 'Types' }))
    await userEvent.click(screen.getByRole('button', { name: 'Values' }))
    await userEvent.type(search, 'missing')
    expect(screen.getByText('No matches')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Reset search and filters' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Types' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Values' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('marks the matching substring without changing the tree item accessible name', async () => {
    render(ModelTreePane, { props: { ir: IR } })
    await userEvent.type(screen.getByPlaceholderText('Search model'), 'Pay')

    const payment = treeItem('Payment')
    expect(within(payment).getByText('Pay', { selector: 'mark' })).toBeTruthy()
    expect(payment.getAttribute('aria-label')).toBe('Payment')
  })

  test('shows branch counts while definition rows retain their kind', async () => {
    render(ModelTreePane, { props: { ir: IR } })

    expect(treeItem('Acme').textContent).toContain('2 modules')
    expect(treeItem('Accounts').textContent).toContain('1 T / 1 V')
    expect(treeItem('Account').textContent).toContain('type')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search model' }), 'pay')

    expect(treeItem('Payments').textContent).toContain('3')
    expect(treeItem('Payment').textContent).toContain('type')
    expect(treeItem('settlePayment').textContent).toContain('value')
  })

  test('keeps an empty package node and explains that it has no modules', () => {
    const emptyIr: WorkspaceIr = {
      package: { name: 'Empty', moduleCount: 0 },
      modules: [],
      definitions: [],
    }

    render(ModelTreePane, { props: { ir: emptyIr } })

    expect(treeItem('Empty')).toBeTruthy()
    expect(screen.getByText('This package has no modules.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset search and filters' })).toBeNull()
  })

  test('names the model hierarchy resize separator', () => {
    render(ModelTreePane, { props: { ir: IR } })
    expect(screen.getByRole('separator', { name: 'Resize model hierarchy' })).toBeTruthy()
  })
})
