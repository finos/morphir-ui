import { Layer } from 'effect'
import {
  CONNECTED_METHODS,
  CapabilityCatalogSchema,
  PlaygroundCompileResultSchema,
  PlaygroundGenerateResultSchema,
} from '@morphir/workspace'
import { PipelineService } from '@morphir/ui'
import type { ConnectedRpcClient } from './rpc-client.ts'

export const makeConnectedPipeline = (client: ConnectedRpcClient): Layer.Layer<PipelineService> =>
  Layer.succeed(PipelineService, {
    catalog: client.call(CONNECTED_METHODS.playgroundCatalog, {}, CapabilityCatalogSchema),
    compile: (input) =>
      client.call(CONNECTED_METHODS.playgroundCompile, input, PlaygroundCompileResultSchema),
    generate: (input) =>
      client.call(CONNECTED_METHODS.playgroundGenerate, input, PlaygroundGenerateResultSchema),
  })
