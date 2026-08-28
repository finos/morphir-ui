import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel } from '@morphir/ir'
import { makeContext, toViewTree } from '../src/index.ts'

const NAMES = process.argv.slice(2)
const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
const lib = await Effect.runPromise(decodeMorphirIr(text))
const entries = new Map(lib.modules[0]!.values.map((e) => [nameToCamel(e.name), e]))
const targets = NAMES.length ? NAMES : [...entries.keys()]
for (const name of targets) {
  const entry = entries.get(name)
  if (!entry) { console.error(`no such definition: ${name}`); process.exit(1) }
  const tree = toViewTree(decodeEntryValueDef(entry)!, makeContext(lib))
  await Bun.write(new URL(`../test/goldens/${name}.json`, import.meta.url), JSON.stringify(tree, null, 2) + '\n')
  console.log(`wrote ${name}.json`)
}
