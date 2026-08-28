import { render, screen, cleanup } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import InsightView from '../src/views/insight/InsightView.svelte'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel, type MorphirLibrary } from '@morphir/ir'
import type { InspectMeta } from '../src/views/insight/insight-context.ts'

afterEach(() => cleanup())

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'), 'utf8'
)
const setup = async (name: string, onSelect?: (meta: InspectMeta) => void) => {
  const lib: MorphirLibrary = await Effect.runPromise(decodeMorphirIr(fixture))
  const entry = lib.modules[0]!.values.find((v) => nameToCamel(v.name) === name)!
  render(InsightView, { props: { def: decodeEntryValueDef(entry), library: lib, onSelect } })
  return lib
}

describe('InsightView', () => {
  test('renders an arithmetic chain with operator separators', async () => {
    await setup('chainedArithmetic')
    expect(screen.getAllByText('+')).toHaveLength(2)
    expect(screen.getByText('a')).toBeTruthy()
  })

  test('renders a decision table with wildcard cells as anything else', async () => {
    await setup('tupleCase')
    expect(screen.getAllByText('anything else').length).toBeGreaterThan(0)
    expect(screen.getByText('"zero-true"')).toBeTruthy()
  })

  // Carried finding from Task 7's review: tupleCase's column-arity fallback repeats the same
  // `pair` subject node for both headers (see TableNode.svelte), so without disambiguation the
  // two <th> cells would be visually and textually identical.
  test('disambiguates identical decision-table column headers with a positional suffix', async () => {
    await setup('tupleCase')
    expect(screen.getAllByText('pair')).toHaveLength(2)
    expect(screen.getByText('①')).toBeTruthy()
    expect(screen.getByText('②')).toBeTruthy()
  })

  test('expanding a reference embeds its definition; collapsing removes it', async () => {
    await setup('usesHelper')
    const button = screen.getByRole('button', { name: /helperFn/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(button)
    expect(screen.getAllByText('+').length).toBeGreaterThan(0) // helperFn body: x + 1
    await userEvent.click(screen.getByRole('button', { name: /helperFn/ }))
    expect(screen.queryAllByText('+')).toHaveLength(0)
  })

  test('recursive expansion shows the cycle chip', async () => {
    await setup('selfRecursive')
    await userEvent.click(screen.getByRole('button', { name: /selfRecursive/ }))
    expect(screen.getByText(/recursive/)).toBeTruthy()
  })

  // Important review finding: composite nodes (chain/fraction/if-tree/decision-table) were
  // dispatched without a selection wrapper, so clicking their own chrome (not a nested inline
  // child) reported nothing to the inspector. InsightNode now wraps all four the same way it
  // wraps v-reference, passing node.kind as the label.
  test('selecting a composite node (decision table) reports its kind to the inspector', async () => {
    let selected: InspectMeta | null = null
    await setup('tupleCase', (meta) => (selected = meta))
    await userEvent.click(screen.getByRole('button', { name: 'v-decision-table' }))
    expect(selected).toEqual({ kindLabel: 'v-decision-table' })
  })

  // Non-reference selectable nodes are real keyboard targets (role="button" + tabindex + an
  // Enter/Space onkeydown) — only v-reference's wrapper stays mouse-only, since its own
  // display name is already a real, keyboard-accessible <button> (see ReferenceNode.svelte).
  test('keyboard (Enter) activates a non-reference selectable node', async () => {
    let selected: InspectMeta | null = null
    await setup('chainedArithmetic', (meta) => (selected = meta))
    const chain = screen.getByRole('button', { name: 'v-arith-chain' })
    chain.focus()
    await userEvent.keyboard('{Enter}')
    expect(selected).toEqual({ kindLabel: 'v-arith-chain' })
  })

  // Important review finding: the Space branch of the keydown handler activated selection
  // but never called preventDefault(), so pressing Space also scrolled the page like a
  // native Space-over-focused-text would. Space must both select AND suppress the scroll.
  test('keyboard (Space) activates a non-reference selectable node and prevents page scroll', async () => {
    let selected: InspectMeta | null = null
    await setup('chainedArithmetic', (meta) => (selected = meta))
    const chain = screen.getByRole('button', { name: 'v-arith-chain' })
    chain.focus()
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    chain.dispatchEvent(event)
    expect(selected).toEqual({ kindLabel: 'v-arith-chain' })
    expect(event.defaultPrevented).toBe(true)
  })
})
