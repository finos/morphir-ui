import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWorkspaceFile } from '../src/main/workspace.ts'

describe('readWorkspaceFile', () => {
  test('reads an existing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morphir-ws-'))
    const path = join(dir, 'morphir-ir.json')
    writeFileSync(path, '{"formatVersion":3}')
    expect(await readWorkspaceFile(path)).toBe('{"formatVersion":3}')
  })

  test('maps missing files to the workspace-not-found contract', async () => {
    await expect(readWorkspaceFile('/nope/morphir-ir.json')).rejects.toThrow(
      'workspace not found: /nope/morphir-ir.json',
    )
  })
})
