import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('pure artifact entries load in Node strip-only mode without Effect or browser globals', () => {
  const entry = new URL('../src/artifact-transfer.ts', import.meta.url).href
  const schemas = new URL('../src/artifact-transfer-schemas.ts', import.meta.url).href
  const code = `
    const api = await import(${JSON.stringify(entry)});
    const schemas = await import(${JSON.stringify(schemas)});
    const id = api.parseArtifactRequestId(18446744073709551615n);
    if (!id.ok || id.value !== '18446744073709551615') throw Error('Exact ID lost');
    if (Object.keys(schemas.ARTIFACT_JSON_SCHEMAS).length !== 6) throw Error('Schemas missing');
    console.log('pure artifact entries passed');
  `
  const result = Bun.spawnSync({
    cmd: ['node', '--input-type=module', '-e', code],
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  })
  expect(new TextDecoder().decode(result.stderr)).toBe('')
  expect(new TextDecoder().decode(result.stdout).trim()).toBe('pure artifact entries passed')
  expect(result.exitCode).toBe(0)
})
