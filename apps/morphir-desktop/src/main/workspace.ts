import { readFile } from 'node:fs/promises'

export async function readWorkspaceFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new Error(`workspace not found: ${path}`)
  }
}
