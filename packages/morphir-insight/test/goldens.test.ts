import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel } from '@morphir/ir'
import { makeContext, toViewTree } from '../src/index.ts'

// Golden coverage grows per task: Task 6 commits goldens for the chain/apply definitions;
// Task 7 adds branching; Task 8 regenerates the full 23 with drill-down fields present.
const GOLDEN_DIR = new URL('./goldens/', import.meta.url)

describe('display-tree goldens', () => {
  test('every committed golden matches the transform output', async () => {
    const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
    const lib = await Effect.runPromise(decodeMorphirIr(text))
    const entries = new Map(lib.modules[0]!.values.map((e) => [nameToCamel(e.name), e]))
    const goldens = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'))
    expect(goldens.length).toBeGreaterThan(0)
    for (const file of goldens) {
      const name = file.replace(/\.json$/, '')
      const expected = JSON.parse(await Bun.file(new URL(file, GOLDEN_DIR)).text())
      const actual = toViewTree(decodeEntryValueDef(entries.get(name)!)!, makeContext(lib))
      expect(actual, `golden drift: ${name} (regenerate with bun run gen:goldens and review the diff)`).toEqual(expected)
    }
  })
})
