import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sourceKey } from '@morphir/workspace'
import {
  inspectDevelopment,
  inspectWorkbenchSource,
  readModelSource,
} from '../src/main/workbench-source.ts'

const roots: string[] = []
const timestamp = new Date('2026-08-29T12:00:00.000Z')

const fixtureRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'morphir-workbench-'))
  roots.push(root)
  return root
}

const fixtureDirectory = (root: string, relative: string): string => {
  const path = join(root, relative)
  mkdirSync(path, { recursive: true })
  return path
}

const fixtureFile = (root: string, relative: string, content: string): string => {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('inspectWorkbenchSource', () => {
  test('detects a Morphir JSON distribution as a single-file Model Workbench', async () => {
    const root = fixtureRoot()
    const path = fixtureFile(
      root,
      'model.json',
      '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}',
    )
    const canonical = realpathSync(path)

    expect(await inspectWorkbenchSource(path, () => timestamp)).toMatchObject({
      id: sourceKey({
        providerId: 'desktop-local',
        locator: canonical,
        displayName: 'model.json',
      }),
      source: {
        providerId: 'desktop-local',
        locator: canonical,
        displayName: 'model.json',
      },
      name: 'model.json',
      kind: 'model',
      distribution: 'single-file',
    })
  })

  test('detects a .morphir-dist manifest as a Document Tree Model Workbench', async () => {
    const root = fixtureRoot()
    const distribution = fixtureDirectory(root, 'model/.morphir-dist')
    fixtureFile(
      root,
      'model/.morphir-dist/manifest.json',
      '{"formatVersion":4,"distribution":"Library"}',
    )
    const canonical = realpathSync(distribution)

    expect(await inspectWorkbenchSource(distribution, () => timestamp)).toMatchObject({
      source: { providerId: 'desktop-local', locator: canonical, displayName: '.morphir-dist' },
      kind: 'model',
      distribution: 'document-tree',
    })
  })

  test('prefers Development when a root has Morphir project configuration', async () => {
    const root = fixtureRoot()
    const development = fixtureDirectory(root, 'dev')
    fixtureFile(root, 'dev/morphir.toml', '[project]\nname = "dev"')
    fixtureFile(root, 'dev/.morphir-dist/manifest.json', '{"formatVersion":4}')
    const canonical = realpathSync(development)

    expect(await inspectWorkbenchSource(development, () => timestamp)).toMatchObject({
      source: { providerId: 'desktop-local', locator: canonical, displayName: 'dev' },
      kind: 'development',
    })
  })

  test('uses the exact modern primary candidates plus the root legacy configuration', async () => {
    const candidates = [
      'morphir.toml',
      'morphir.yaml',
      '.morphir/morphir.toml',
      '.morphir/morphir.yaml',
      '.config/morphir/config.toml',
      '.config/morphir/config.yaml',
      'morphir.json',
    ]

    for (const [index, candidate] of candidates.entries()) {
      const root = fixtureRoot()
      const development = fixtureDirectory(root, `dev-${index}`)
      fixtureFile(root, `dev-${index}/${candidate}`, '{}')
      fixtureFile(root, `dev-${index}/.morphir-dist/manifest.json`, '{"formatVersion":4}')

      expect(await inspectWorkbenchSource(development, () => timestamp)).toMatchObject({
        kind: 'development',
      })
    }
  })

  test('does not treat non-primary legacy variants as Development configurations', async () => {
    const root = fixtureRoot()
    const model = fixtureDirectory(root, 'model')
    fixtureFile(root, 'model/.morphir/morphir.json', '{}')
    fixtureFile(root, 'model/.morphir-dist/manifest.json', '{"formatVersion":4}')

    expect(await inspectWorkbenchSource(model, () => timestamp)).toMatchObject({
      kind: 'model',
      distribution: 'document-tree',
    })
  })

  test('reports ambiguous modern primary configurations before Document Tree detection', async () => {
    const root = fixtureRoot()
    const development = fixtureDirectory(root, 'ambiguous')
    fixtureFile(root, 'ambiguous/morphir.toml', '[project]\nname = "toml"')
    fixtureFile(root, 'ambiguous/.morphir/morphir.yaml', 'project:\n  name: yaml')
    fixtureFile(root, 'ambiguous/.morphir-dist/manifest.json', '{"formatVersion":4}')

    await expect(inspectWorkbenchSource(development, () => timestamp)).rejects.toMatchObject({
      code: 'detection-failed',
      message: expect.stringContaining('workspace.config.ambiguous'),
    })
  })

  test('ignores unrelated oversized descendant configuration content during detection', async () => {
    const root = fixtureRoot()
    const model = fixtureDirectory(root, 'model')
    fixtureFile(root, 'model/.morphir-dist/manifest.json', '{"formatVersion":4}')
    const unrelated = fixtureFile(root, 'model/packages/member/morphir.toml', '')
    truncateSync(unrelated, 64 * 1024 * 1024 + 1)

    expect(await inspectWorkbenchSource(model, () => timestamp)).toMatchObject({
      kind: 'model',
      distribution: 'document-tree',
    })
  })

  test.skipIf(process.platform === 'win32')(
    'ignores unrelated escaping descendant links during Document Tree detection',
    async () => {
      const root = fixtureRoot()
      const outside = fixtureDirectory(fixtureRoot(), 'outside')
      const model = fixtureDirectory(root, 'model')
      fixtureFile(root, 'model/.morphir-dist/manifest.json', '{"formatVersion":4}')
      symlinkSync(outside, join(model, 'unrelated'), 'dir')

      expect(await inspectWorkbenchSource(model, () => timestamp)).toMatchObject({
        kind: 'model',
        distribution: 'document-tree',
      })
    },
  )

  test('detects any other directory as Development', async () => {
    const root = fixtureRoot()
    const knowledgeBase = fixtureDirectory(root, 'knowledge')

    expect(await inspectWorkbenchSource(knowledgeBase, () => timestamp)).toMatchObject({
      kind: 'development',
    })
  })

  test('returns a typed unsupported-file error for text files', async () => {
    const root = fixtureRoot()
    const path = fixtureFile(root, 'notes.txt', 'hello')
    const canonical = realpathSync(path)

    await expect(inspectWorkbenchSource(path, () => timestamp)).rejects.toMatchObject({
      code: 'unsupported-file',
      source: canonical,
    })
  })

  test('returns a typed detection error for non-Morphir JSON', async () => {
    const root = fixtureRoot()
    const path = fixtureFile(root, 'other.json', '{"hello":"world"}')
    const canonical = realpathSync(path)

    await expect(inspectWorkbenchSource(path, () => timestamp)).rejects.toMatchObject({
      code: 'detection-failed',
      source: canonical,
    })
  })
})

describe('source loading', () => {
  test('reads single-file content and Document Tree manifests', async () => {
    const root = fixtureRoot()
    const model = fixtureFile(
      root,
      'model.json',
      '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}',
    )
    const distribution = fixtureDirectory(root, 'tree/.morphir-dist')
    fixtureFile(
      root,
      'tree/.morphir-dist/manifest.json',
      '{"formatVersion":4,"distribution":"Library"}',
    )

    const singleDescriptor = await inspectWorkbenchSource(model, () => timestamp)
    const treeDescriptor = await inspectWorkbenchSource(distribution, () => timestamp)
    if (singleDescriptor.kind !== 'model' || treeDescriptor.kind !== 'model') {
      throw new Error('Expected Model descriptors')
    }

    expect(await readModelSource(singleDescriptor)).toMatchObject({ content: expect.any(String) })
    expect(await readModelSource(treeDescriptor)).toEqual({
      content: null,
      manifest: { formatVersion: 4, distribution: 'Library' },
    })
  })

  test('qualifies the canonical discovery snapshot for the desktop provider', async () => {
    const root = fixtureRoot()
    const development = fixtureDirectory(root, 'dev')
    fixtureFile(root, 'dev/morphir.toml', '[project]\nname = "dev"')

    const descriptor = await inspectWorkbenchSource(development, () => timestamp)
    if (descriptor.kind !== 'development') throw new Error('Expected Development descriptor')

    expect(
      await inspectDevelopment(descriptor, async () => ({
        status: 'success',
        snapshot: {
          protocolVersion: 1,
          configAnchor: 'morphir.toml',
          name: 'Development root',
          state: 'error',
          projects: [
            {
              name: 'dev',
              version: '1.0.0',
              relativePath: '.',
              configAnchor: 'morphir.toml',
              sourceDirectory: 'src',
              state: 'unloaded',
              diagnostics: [
                {
                  severity: 'warning',
                  code: 'workspace.project.warning',
                  message: 'Project warning',
                  path: 'morphir.toml',
                  projectPath: '.',
                },
              ],
            },
          ],
          diagnostics: [],
        },
      })),
    ).toMatchObject({
      id: descriptor.id,
      root: descriptor.source,
      name: 'Development root',
      configAnchor: 'morphir.toml',
      state: 'error',
      projects: [
        {
          id: JSON.stringify(['desktop-local', descriptor.source.locator, '.']),
          relativePath: '.',
          configAnchor: 'morphir.toml',
          sourceDirectory: 'src',
          state: 'unloaded',
          diagnostics: [
            {
              path: 'morphir.toml',
              projectId: JSON.stringify(['desktop-local', descriptor.source.locator, '.']),
            },
          ],
        },
      ],
    })
  })

  test('rejects foreign descriptors before reading their locators', async () => {
    const root = fixtureRoot()
    const model = fixtureFile(
      root,
      'model.json',
      '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}',
    )
    const development = fixtureDirectory(root, 'dev')
    const modelDescriptor = await inspectWorkbenchSource(model, () => timestamp)
    const developmentDescriptor = await inspectWorkbenchSource(development, () => timestamp)
    if (modelDescriptor.kind !== 'model' || developmentDescriptor.kind !== 'development') {
      throw new Error('Expected model and development descriptors')
    }

    await expect(
      readModelSource({
        ...modelDescriptor,
        source: { ...modelDescriptor.source, providerId: 'cli:session-1' },
      }),
    ).rejects.toMatchObject({
      code: 'unsupported-capability',
      message:
        'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    })
    await expect(
      inspectDevelopment({
        ...developmentDescriptor,
        source: { ...developmentDescriptor.source, providerId: 'cli:session-1' },
      }),
    ).rejects.toMatchObject({
      code: 'unsupported-capability',
      message:
        'Workbench source belongs to provider cli:session-1; expected provider desktop-local',
    })
  })
})
