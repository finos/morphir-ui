import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('web content security policy', () => {
  test('permits WebAssembly compilation without permitting JavaScript eval', async () => {
    const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8')
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
    const scriptSources = policy
      ?.split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .find(([name]) => name === 'script-src')
      ?.slice(1)

    expect(scriptSources).toContain("'wasm-unsafe-eval'")
    expect(scriptSources).not.toContain("'unsafe-eval'")
  })
})
