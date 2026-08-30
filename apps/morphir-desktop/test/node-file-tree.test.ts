import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import corpusJson from '@morphir/workspace-engine/corpus'
import type { DiscoveryRequest, FileEntry, FileTree } from '@morphir/workspace'
import {
  NodeFileTreeError,
  fileTreeFromNodeRoot,
  sameFileIdentity,
  type NodeFileTreeOptions,
} from '../src/main/workspace/node-file-tree.ts'

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
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
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
        'orders-alias/cycle/orders/morphir.toml',
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

  test.skipIf(process.platform === 'win32')(
    'materializes nested aliases transitively without repeating a cycle',
    async () => {
      const root = await temporaryDirectory('nested-alias')
      const first = join(root, 'real', 'a')
      const second = join(root, 'real', 'b')
      await mkdir(first, { recursive: true })
      await mkdir(second, { recursive: true })
      await writeFile(join(second, 'morphir.toml'), '[project]\nname = "nested"\n')
      await symlink(second, join(first, 'nested'))
      await symlink(first, join(root, 'alias'))

      const tree = await fileTreeFromNodeRoot(root)

      expect(tree.entries['alias/nested/morphir.toml']).toEqual({
        kind: 'file',
        text: '[project]\nname = "nested"\n',
      })
    },
  )

  test('enforces traversal budgets before descent and config allocation', async () => {
    const root = await temporaryDirectory('traversal-budget')
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'morphir.toml'), 'abc')

    await expect(
      fileTreeFromNodeRoot(root, { budgets: { realDirectories: 1 } }),
    ).rejects.toMatchObject({ code: 'workspace.traversal.resource-limit' })
    await expect(fileTreeFromNodeRoot(root, { budgets: { configBytes: 2 } })).rejects.toMatchObject(
      { code: 'workspace.traversal.resource-limit' },
    )
    expect(await fileTreeFromNodeRoot(root, { budgets: { configBytes: 3 } })).toBeDefined()
    await expect(fileTreeFromNodeRoot(root, { budgets: { realEntries: 1 } })).rejects.toMatchObject(
      { code: 'workspace.traversal.resource-limit' },
    )
    await expect(fileTreeFromNodeRoot(root, { budgets: { maxDepth: 0 } })).rejects.toMatchObject({
      code: 'workspace.traversal.resource-limit',
    })
  })

  test.skipIf(process.platform === 'win32')(
    'enforces every alias budget before allocation',
    async () => {
      const root = await temporaryDirectory('alias-budgets')
      const target = join(root, 'real')
      await mkdir(target)
      await writeFile(join(target, 'morphir.toml'), 'config')
      await symlink(target, join(root, 'alias'))

      for (const budgets of [
        { aliasEdges: 0 },
        { queuedExpansions: 0 },
        { processedExpansions: 0 },
        { generatedEntries: 0 },
        { totalWork: 0 },
      ]) {
        await expect(fileTreeFromNodeRoot(root, { budgets })).rejects.toMatchObject({
          code: 'workspace.alias.resource-limit',
        })
      }
    },
  )

  test.skipIf(process.platform === 'win32')(
    'binds root, descendant directories, and config files before deterministic replacement',
    async () => {
      const base = await temporaryDirectory('replacement')
      const outside = await temporaryDirectory('replacement-outside')
      const root = join(base, 'root')
      await mkdir(join(root, 'packages'), { recursive: true })
      await writeFile(join(root, 'packages', 'morphir.toml'), 'inside')
      await mkdir(join(outside, 'packages'))
      await writeFile(join(outside, 'morphir.toml'), 'outside-root')
      await writeFile(join(outside, 'packages', 'morphir.toml'), 'outside-directory')
      const swaps = new Set<string>()
      const hooks: NodeFileTreeOptions['hooks'] = {
        afterDirectoryBound: async (path) => {
          if (swaps.has(path)) return
          swaps.add(path)
          if (path === '.') {
            const held = join(base, 'held-root')
            await rename(root, held)
            await symlink(outside, root)
            await unlink(root)
            await rename(held, root)
          } else if (path === 'packages') {
            const directory = join(root, 'packages')
            const held = join(root, 'held-packages')
            await rename(directory, held)
            await symlink(join(outside, 'packages'), directory)
            await unlink(directory)
            await rename(held, directory)
          }
        },
        afterConfigBound: async (path) => {
          if (path !== 'packages/morphir.toml' || swaps.has(path)) return
          swaps.add(path)
          const config = join(root, 'packages', 'morphir.toml')
          const held = join(root, 'packages', 'held.toml')
          await rename(config, held)
          await symlink(join(outside, 'packages', 'morphir.toml'), config)
          await unlink(config)
          await rename(held, config)
        },
      }

      const tree = await fileTreeFromNodeRoot(root, { hooks })

      expect(tree.entries['packages/morphir.toml']).toEqual({ kind: 'file', text: 'inside' })
      expect(JSON.stringify(tree)).not.toContain('outside-')
      expect(swaps).toEqual(new Set(['.', 'packages', 'packages/morphir.toml']))
    },
  )

  test('normalizes missing and unreadable roots to stable typed errors', async () => {
    const root = await temporaryDirectory('missing-root')
    await rm(root, { recursive: true })

    await expect(fileTreeFromNodeRoot(root)).rejects.toMatchObject({
      code: 'workspace.traversal.unreadable',
    })
  })

  test.skipIf(process.platform === 'win32')(
    'rejects drive-like child names at any depth',
    async () => {
      const root = await temporaryDirectory('drive-segment')
      await mkdir(join(root, 'nested', 'C:escape'), { recursive: true })

      await expect(fileTreeFromNodeRoot(root)).rejects.toMatchObject({
        code: 'workspace.path.not-confined',
      })
    },
  )

  test('uses one scanner process for 100 directories and reaps it', async () => {
    const root = await temporaryDirectory('one-worker')
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        mkdir(join(root, `dir-${index.toString().padStart(3, '0')}`)),
      ),
    )
    const started = new Set<number>()
    const exited = new Set<number>()
    const began = performance.now()

    await fileTreeFromNodeRoot(root, {
      lifecycle: { started: (pid) => started.add(pid), exited: (pid) => exited.add(pid) },
    })

    expect(started.size).toBe(1)
    expect(exited).toEqual(started)
    expect(performance.now() - began).toBeLessThan(5_000)
    for (const pid of exited) expect(() => process.kill(pid, 0)).toThrow()
  })

  test('uses one scanner process for 1000 directories within a practical bound', async () => {
    const root = await temporaryDirectory('one-worker-large')
    await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        mkdir(join(root, `dir-${index.toString().padStart(4, '0')}`)),
      ),
    )
    const started = new Set<number>()
    const exited = new Set<number>()
    const began = performance.now()

    await fileTreeFromNodeRoot(root, {
      lifecycle: { started: (pid) => started.add(pid), exited: (pid) => exited.add(pid) },
    })

    expect(started.size).toBe(1)
    expect(exited).toEqual(started)
    expect(performance.now() - began).toBeLessThan(10_000)
  })

  test.skipIf(process.platform === 'win32')(
    'reaps the scanner after a confinement error',
    async () => {
      const root = await temporaryDirectory('worker-error')
      const outside = await temporaryDirectory('worker-error-outside')
      await symlink(outside, join(root, 'escape'))
      const started = new Set<number>()
      const exited = new Set<number>()

      await expect(
        fileTreeFromNodeRoot(root, {
          lifecycle: { started: (pid) => started.add(pid), exited: (pid) => exited.add(pid) },
        }),
      ).rejects.toMatchObject({ code: 'workspace.path.not-confined' })
      expect(started.size).toBe(1)
      expect(exited).toEqual(started)
      for (const pid of exited) expect(() => process.kill(pid, 0)).toThrow()
    },
  )

  test('kills and reaps a timed-out scanner process', async () => {
    const root = await temporaryDirectory('worker-timeout')
    const started = new Set<number>()
    const exited = new Set<number>()

    await expect(
      fileTreeFromNodeRoot(root, {
        timeoutMs: 20,
        hooks: { afterDirectoryBound: () => new Promise(() => undefined) },
        lifecycle: { started: (pid) => started.add(pid), exited: (pid) => exited.add(pid) },
      }),
    ).rejects.toMatchObject({ code: 'workspace.traversal.unreadable' })
    expect(started.size).toBe(1)
    expect(exited).toEqual(started)
  })

  test.skipIf(process.platform === 'win32')(
    'charges alias-generated configuration text to the payload budget',
    async () => {
      const root = await temporaryDirectory('alias-payload')
      const real = join(root, 'real')
      await mkdir(real)
      await writeFile(join(real, 'morphir.toml'), 'abc')
      await symlink(real, join(root, 'alias'))

      await expect(
        fileTreeFromNodeRoot(root, { budgets: { configBytes: 3 } }),
      ).rejects.toMatchObject({ code: 'workspace.traversal.resource-limit' })
      expect(await fileTreeFromNodeRoot(root, { budgets: { configBytes: 6 } })).toBeDefined()
    },
  )

  test('compares bigint file identities without precision loss', () => {
    expect(
      sameFileIdentity(
        { dev: '9007199254740992', ino: '9007199254740993' },
        { dev: '9007199254740992', ino: '9007199254740994' },
      ),
    ).toBe(false)
  })

  test.skipIf(process.platform === 'win32')(
    'materializes 100 root aliases with one bounded scanner process',
    async () => {
      const root = await temporaryDirectory('many-aliases')
      const real = join(root, 'real')
      await mkdir(real)
      await writeFile(join(real, 'morphir.toml'), 'x')
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          symlink(real, join(root, `alias-${index.toString().padStart(3, '0')}`)),
        ),
      )
      const started = new Set<number>()
      const began = performance.now()

      const tree = await fileTreeFromNodeRoot(root, {
        budgets: { configBytes: 101 },
        lifecycle: { started: (pid) => started.add(pid) },
      })

      expect(started.size).toBe(1)
      expect(
        Object.keys(tree.entries).filter((path) => path.endsWith('morphir.toml')),
      ).toHaveLength(101)
      expect(performance.now() - began).toBeLessThan(5_000)
      await expect(
        fileTreeFromNodeRoot(root, { budgets: { configBytes: 100 } }),
      ).rejects.toMatchObject({ code: 'workspace.traversal.resource-limit' })
    },
  )

  test.skipIf(process.platform !== 'win32')(
    'accepts a Windows root and file while rejecting an external junction',
    async () => {
      const root = await temporaryDirectory('windows-junction-root')
      const outside = await temporaryDirectory('windows-junction-outside')
      await writeFile(join(root, 'morphir.toml'), 'inside')
      expect((await fileTreeFromNodeRoot(root)).entries['morphir.toml']).toEqual({
        kind: 'file',
        text: 'inside',
      })
      await symlink(outside, join(root, 'escape'), 'junction')
      await expect(fileTreeFromNodeRoot(root)).rejects.toMatchObject({
        code: 'workspace.path.not-confined',
      })
    },
  )
})
