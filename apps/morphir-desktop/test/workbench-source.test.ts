import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sourceKey } from '@morphir/workspace'
import {
  inspectDevelopmentRoot,
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

  test('summarizes a Development root without recursively crawling it', async () => {
    const root = fixtureRoot()
    const development = fixtureDirectory(root, 'dev')
    fixtureFile(root, 'dev/morphir.toml', '[project]\nname = "dev"')
    fixtureFile(root, 'dev/model/.morphir-dist/manifest.json', '{"formatVersion":4}')
    fixtureFile(root, 'dev/knowledge/bundle.json', '{}')

    const descriptor = await inspectWorkbenchSource(development, () => timestamp)
    if (descriptor.kind !== 'development') throw new Error('Expected Development descriptor')
    const canonical = realpathSync(development)

    expect(await inspectDevelopmentRoot(descriptor)).toEqual({
      configAnchor: join(canonical, 'morphir.toml'),
      modelSources: [join(canonical, 'model')],
      knowledgeBaseSources: [join(canonical, 'knowledge')],
    })
  })
})
