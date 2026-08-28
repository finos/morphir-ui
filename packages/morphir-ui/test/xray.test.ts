import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import XRayView from '../src/views/insight/XRayView.svelte'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel } from '@morphir/ir'

afterEach(() => cleanup())

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'),
  'utf8'
)

const defByName = async (name: string) => {
  const lib = await Effect.runPromise(decodeMorphirIr(fixture))
  const entry = lib.modules[0]!.values.find((v) => nameToCamel(v.name) === name)!
  return decodeEntryValueDef(entry)!
}

describe('XRayView', () => {
  test('renders the node kinds of a simple arithmetic body', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    expect(screen.getAllByText('apply').length).toBeGreaterThan(0)
    expect(screen.getAllByText('value-reference').length).toBeGreaterThan(0)
    expect(screen.getAllByText('variable').length).toBeGreaterThan(0)
  })

  test('renders inputs and output sections', async () => {
    render(XRayView, { props: { def: await defByName('gradeIf') } })
    expect(screen.getByText('inputs')).toBeTruthy()
    expect(screen.getByText('output')).toBeTruthy()
    expect(screen.getAllByText('if-then-else').length).toBeGreaterThan(0)
  })

  test('unknown nodes render the fallback marker', async () => {
    render(XRayView, {
      props: { def: { inputs: [], output: { kind: 'type-unit' }, body: { kind: 'unknown', tag: 'Mystery', raw: null } } }
    })
    expect(screen.getByText(/Mystery/)).toBeTruthy()
  })

  test('null def renders an empty state', () => {
    render(XRayView, { props: { def: null } })
    expect(screen.getByText(/could not be decoded/i)).toBeTruthy()
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
})
