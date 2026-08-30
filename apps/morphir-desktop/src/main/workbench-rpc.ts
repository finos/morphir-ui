import type {
  DevelopmentWorkbenchDescriptor,
  ModelWorkbenchDescriptor,
  SourcePickerKind,
  WorkbenchDescriptor,
} from '@morphir/ui/workbench'
import type { RpcRegistry } from './rpc.ts'
import { assertDesktopWorkbenchProvider } from './workbench-source.ts'
import { requireDesktopSourceRef } from '../shared/workbench-source.ts'
import type { WorkbenchSourceRef } from '@morphir/workspace'

interface WorkbenchHost {
  readonly inspect: (source: WorkbenchSourceRef) => Promise<WorkbenchDescriptor>
  readonly pick: (kind: SourcePickerKind) => Promise<WorkbenchSourceRef | null>
  readonly readModel: (descriptor: ModelWorkbenchDescriptor) => Promise<{
    readonly content: string | null
    readonly manifest: Readonly<Record<string, unknown>> | null
  }>
  readonly inspectDevelopment: (descriptor: DevelopmentWorkbenchDescriptor) => Promise<{
    readonly configAnchor: string | null
    readonly modelSources: ReadonlyArray<string>
    readonly knowledgeBaseSources: ReadonlyArray<string>
  }>
  readonly reveal: (source: WorkbenchSourceRef) => Promise<void>
  readonly takeInitialSources: () => ReadonlyArray<WorkbenchSourceRef>
}

const record = (params: unknown): Record<string, unknown> =>
  typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}

const requiredSource = (params: unknown): WorkbenchSourceRef => {
  const source = record(params)['source']
  return requireDesktopSourceRef(source)
}

export const registerWorkbenchHandlers = (registry: RpcRegistry, host: WorkbenchHost): void => {
  registry.register('morphir/workbench/inspect', (params) => host.inspect(requiredSource(params)))
  registry.register('morphir/workbench/pick', async (params) => {
    const kind = record(params)['kind']
    if (kind !== 'model-file' && kind !== 'folder') {
      throw new Error('Workbench picker kind must be model-file or folder')
    }
    const source = await host.pick(kind)
    return source === null ? null : { source }
  })
  registry.register('morphir/workbench/readModel', (params) => {
    const descriptor = record(params)['descriptor'] as ModelWorkbenchDescriptor | undefined
    if (descriptor?.kind !== 'model') throw new Error('Model Workbench descriptor is required')
    assertDesktopWorkbenchProvider(descriptor)
    return host.readModel(descriptor)
  })
  registry.register('morphir/workbench/inspectDevelopment', (params) => {
    const descriptor = record(params)['descriptor'] as DevelopmentWorkbenchDescriptor | undefined
    if (descriptor?.kind !== 'development') {
      throw new Error('Development Workbench descriptor is required')
    }
    assertDesktopWorkbenchProvider(descriptor)
    return host.inspectDevelopment(descriptor)
  })
  registry.register('morphir/workbench/reveal', async (params) => {
    await host.reveal(requiredSource(params))
    return {}
  })
  registry.register('morphir/workbench/initialSources', async () => ({
    sources: host.takeInitialSources(),
  }))
}
