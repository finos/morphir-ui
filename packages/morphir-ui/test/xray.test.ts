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
})
