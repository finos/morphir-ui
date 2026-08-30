import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import corpusJson from '@morphir/workspace-engine/corpus'
import type { DiscoveryRequest, FileEntry, FileTree } from '@morphir/workspace'
import { NodeFileTreeError, fileTreeFromNodeRoot } from '../src/main/workspace/node-file-tree.ts'

interface CorpusCase {
  readonly name: string
  readonly request: DiscoveryRequest
}

const corpus = corpusJson as unknown as ReadonlyArray<CorpusCase>
const temporaryDirectories: Array<string> = []

const temporaryDirectory = async (name: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), `morphir-${name}-`))
  temporaryDirectories.push(directory)
  return directory
}

const materializeTree = async (root: string, tree: FileTree): Promise<void> => {
  const entries = Object.entries(tree.entries).sort(([left], [right]) => left.localeCompare(right))
  for (const [path, entry] of entries) {
    if (path === '.') continue
    const absolute = join(root, ...path.split('/'))
    if (entry.kind === 'directory') {
      await mkdir(absolute, { recursive: true })
    } else if (entry.kind === 'file') {
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, entry.text, 'utf8')
    }
  }
}

const expectedMaterializedTree = (tree: FileTree): FileTree => ({
  entries: Object.fromEntries(
    (
      [
        ['.', { kind: 'directory' } as const],
        ...Object.entries(tree.entries).filter(
          ([path, entry]) =>
            path !== '.' &&
            (entry.kind === 'directory' ||
              !path.endsWith('.yml') ||
              !path.split('/').at(-1)?.startsWith('morphir')),
        ),
      ] as Array<readonly [string, FileEntry]>
    ).sort(([left], [right]) => left.localeCompare(right)),
  ),
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('confined Node FileTree adapter', () => {
  test.each([...corpus])(
    'materializes the generated corpus case: $name',
    async ({ name, request }) => {
      const root = await temporaryDirectory(name)
      await materializeTree(root, request.developmentRoot)

      expect(await fileTreeFromNodeRoot(root)).toEqual(
        expectedMaterializedTree(request.developmentRoot),
      )
    },
  )

  test('reads only recognized configuration files and safely preserves __proto__ paths', async () => {
    const root = await temporaryDirectory('recognized')
    await mkdir(join(root, '__proto__'), { recursive: true })
    await writeFile(join(root, '__proto__', 'morphir.toml'), '[project]\nname = "safe"\n')
    await writeFile(join(root, '__proto__', 'secrets.txt'), 'do not read')

    const tree = await fileTreeFromNodeRoot(root)

    expect(Object.getPrototypeOf(tree.entries)).toBe(Object.prototype)
    expect(tree.entries['__proto__/morphir.toml']).toEqual({
      kind: 'file',
      text: '[project]\nname = "safe"\n',
    })
    expect(tree.entries['__proto__/secrets.txt']).toBeUndefined()
  })

  test.skipIf(process.platform === 'win32')(
    'traverses an internal directory symlink once and terminates a cycle deterministically',
    async () => {
      const root = await temporaryDirectory('internal-symlink')
      const project = join(root, 'packages', 'orders')
      await mkdir(project, { recursive: true })
      await writeFile(join(project, 'morphir.toml'), '[project]\nname = "acme/orders"\n')
      await symlink(project, join(root, 'orders-alias'))
      await symlink(join(root, 'packages'), join(project, 'cycle'))

      const first = await fileTreeFromNodeRoot(root)
      const second = await fileTreeFromNodeRoot(root)

      expect(second).toEqual(first)
      expect(Object.keys(first.entries).filter((path) => path.endsWith('/morphir.toml'))).toEqual([
        'orders-alias/morphir.toml',
        'packages/orders/cycle/orders/morphir.toml',
        'packages/orders/morphir.toml',
      ])
      expect(Object.keys(first.entries).some((path) => path.includes('/cycle/orders/cycle/'))).toBe(
        false,
      )
    },
  )

  test.skipIf(process.platform === 'win32')(
    'rejects a symlink that resolves outside the granted root',
    async () => {
      const root = await temporaryDirectory('root')
      const outside = await temporaryDirectory('outside')
      await writeFile(join(outside, 'morphir.toml'), '[project]\nname = "outside"\n')
      await symlink(outside, join(root, 'escape'))

      await expect(fileTreeFromNodeRoot(root)).rejects.toMatchObject({
        code: 'workspace.path.not-confined',
      } satisfies Partial<NodeFileTreeError>)
    },
  )

  test.skipIf(process.platform === 'win32')(
    'rejects a native name that cannot be represented as a confined portable path',
    async () => {
      const root = await temporaryDirectory('invalid-segment')
      await mkdir(join(root, String.raw`unsafe\segment`))

      await expect(fileTreeFromNodeRoot(root)).rejects.toMatchObject({
        code: 'workspace.path.not-confined',
      } satisfies Partial<NodeFileTreeError>)
    },
  )
})
