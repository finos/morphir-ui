import type {
  DevelopmentWorkbenchDescriptor,
  ModelWorkbenchDescriptor,
  WorkbenchDescriptor,
} from '@morphir/ui/workbench'
import { WorkbenchError } from '@morphir/ui/workbench'
import { sourceKey } from '@morphir/workspace'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { requireDesktopSourceRef } from '../shared/workbench-source.ts'

const PRIMARY_CONFIGS = [
  'morphir.toml',
  'morphir.yaml',
  'morphir.yml',
  'morphir.json',
  join('.morphir', 'morphir.toml'),
  join('.morphir', 'morphir.yaml'),
  join('.morphir', 'morphir.yml'),
  join('.morphir', 'morphir.json'),
  join('.config', 'morphir', 'config.toml'),
  join('.config', 'morphir', 'config.yaml'),
  join('.config', 'morphir', 'config.yml'),
  join('.config', 'morphir', 'config.json'),
] as const

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

const workbenchError = (
  source: string,
  error: unknown,
  fallback: 'detection-failed' | 'read-failed',
): WorkbenchError => {
  if (error instanceof WorkbenchError) return error
  const code = (error as NodeJS.ErrnoException | null)?.code
  const workbenchCode =
    code === 'ENOENT'
      ? 'not-found'
      : code === 'EACCES' || code === 'EPERM'
        ? 'permission-denied'
        : fallback
  return new WorkbenchError({
    code: workbenchCode,
    source,
    message:
      workbenchCode === 'not-found'
        ? `Workbench source not found: ${source}`
        : error instanceof Error
          ? error.message
          : String(error),
  })
}

const configAnchor = async (root: string): Promise<string | null> => {
  for (const relative of PRIMARY_CONFIGS) {
    const candidate = join(root, relative)
    if (await exists(candidate)) return candidate
  }
  return null
}

const documentTreeManifest = async (root: string): Promise<string | null> => {
  const candidate =
    basename(root) === '.morphir-dist'
      ? join(root, 'manifest.json')
      : join(root, '.morphir-dist', 'manifest.json')
  return (await exists(candidate)) ? candidate : null
}

export const assertDesktopWorkbenchProvider = (
  descriptor: ModelWorkbenchDescriptor | DevelopmentWorkbenchDescriptor,
): void => {
  requireDesktopSourceRef(descriptor.source)
}

export const inspectWorkbenchSource = async (
  source: string,
  now: () => Date = () => new Date(),
): Promise<WorkbenchDescriptor> => {
  try {
    const canonical = await realpath(source)
    const info = await stat(canonical)
    const timestamp = now().toISOString()
    const sourceRef = {
      providerId: 'desktop-local',
      locator: canonical,
      displayName: basename(canonical),
    }
    const base = {
      id: sourceKey(sourceRef),
      source: sourceRef,
      name: sourceRef.displayName,
      openedAt: timestamp,
      lastUsedAt: timestamp,
    }

    if (info.isFile()) {
      if (!canonical.toLocaleLowerCase().endsWith('.json')) {
        throw new WorkbenchError({
          code: 'unsupported-file',
          source: canonical,
          message: `Unsupported Workbench file: ${canonical}`,
        })
      }
      const parsed = JSON.parse(await readFile(canonical, 'utf8')) as unknown
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { formatVersion?: unknown }).formatVersion !== 'number' ||
        !('distribution' in parsed)
      ) {
        throw new WorkbenchError({
          code: 'detection-failed',
          source: canonical,
          message: `File is not a Morphir distribution: ${canonical}`,
        })
      }
      return {
        ...base,
        kind: 'model',
        distribution: 'single-file',
        route: 'overview',
      }
    }

    if (!info.isDirectory()) {
      throw new WorkbenchError({
        code: 'detection-failed',
        source: canonical,
        message: `Workbench source is neither a file nor a directory: ${canonical}`,
      })
    }

    if (await configAnchor(canonical)) {
      return { ...base, kind: 'development', route: 'overview' }
    }
    if (await documentTreeManifest(canonical)) {
      return {
        ...base,
        kind: 'model',
        distribution: 'document-tree',
        route: 'overview',
      }
    }
    return { ...base, kind: 'development', route: 'overview' }
  } catch (error) {
    throw workbenchError(source, error, 'detection-failed')
  }
}

export const readModelSource = async (
  descriptor: ModelWorkbenchDescriptor,
): Promise<{
  readonly content: string | null
  readonly manifest: Readonly<Record<string, unknown>> | null
}> => {
  assertDesktopWorkbenchProvider(descriptor)
  const source = descriptor.source.locator
  try {
    if (descriptor.distribution === 'single-file') {
      return { content: await readFile(source, 'utf8'), manifest: null }
    }
    const manifestPath = await documentTreeManifest(source)
    if (!manifestPath) {
      throw new WorkbenchError({
        code: 'not-found',
        source,
        message: `Document Tree manifest not found: ${source}`,
      })
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new WorkbenchError({
        code: 'invalid-distribution',
        source,
        message: `Invalid Document Tree manifest: ${manifestPath}`,
      })
    }
    return { content: null, manifest: manifest as Readonly<Record<string, unknown>> }
  } catch (error) {
    throw workbenchError(source, error, 'read-failed')
  }
}

export const inspectDevelopmentRoot = async (
  descriptor: DevelopmentWorkbenchDescriptor,
): Promise<{
  readonly configAnchor: string | null
  readonly modelSources: ReadonlyArray<string>
  readonly knowledgeBaseSources: ReadonlyArray<string>
}> => {
  assertDesktopWorkbenchProvider(descriptor)
  const source = descriptor.source.locator
  try {
    const entries = await readdir(source, { withFileTypes: true })
    const directories = entries.filter((entry) => entry.isDirectory())
    const modelSources: string[] = []
    const knowledgeBaseSources: string[] = []

    for (const entry of directories) {
      const child = join(source, entry.name)
      if (entry.name !== '.morphir-dist' && (await documentTreeManifest(child))) {
        modelSources.push(child)
      }
      if (/^(kb|knowledge|knowledge-base)$/i.test(entry.name)) {
        knowledgeBaseSources.push(child)
      }
    }

    return {
      configAnchor: await configAnchor(source),
      modelSources,
      knowledgeBaseSources,
    }
  } catch (error) {
    throw workbenchError(source, error, 'read-failed')
  }
}
