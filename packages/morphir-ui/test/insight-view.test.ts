import { render, screen, cleanup } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import InsightView from '../src/views/insight/InsightView.svelte'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel, type MorphirLibrary } from '@morphir/ir'

afterEach(() => cleanup())

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'), 'utf8'
)
const setup = async (name: string) => {
  const lib: MorphirLibrary = await Effect.runPromise(decodeMorphirIr(fixture))
  const entry = lib.modules[0]!.values.find((v) => nameToCamel(v.name) === name)!
  render(InsightView, { props: { def: decodeEntryValueDef(entry), library: lib } })
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
})
