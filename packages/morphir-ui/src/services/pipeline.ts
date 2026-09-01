import { Context, Effect } from 'effect'
import type {
  CapabilityCatalog,
  PlaygroundCompileResult,
  PlaygroundGenerateResult,
} from '@morphir/workspace'
import type { WorkbenchError } from '../workbench/services.ts'

export interface PlaygroundCompileInput {
  readonly languageId: string
  readonly documents: ReadonlyArray<{
    uri: string
    languageId: string
    version: number
    text: string
  }>
  readonly package: { name: string; exposedModules: ReadonlyArray<string> }
  readonly irVersion: string
  readonly options: Record<string, unknown>
}

export interface PlaygroundGenerateInput {
  readonly ir: unknown
  readonly irVersion: string
  readonly target: string
  readonly options: Record<string, unknown>
}

export interface PipelineServiceApi {
  readonly catalog: Effect.Effect<CapabilityCatalog, WorkbenchError>
  readonly compile: (
    input: PlaygroundCompileInput,
  ) => Effect.Effect<PlaygroundCompileResult, WorkbenchError>
  readonly generate: (
    input: PlaygroundGenerateInput,
  ) => Effect.Effect<PlaygroundGenerateResult, WorkbenchError>
}

export class PipelineService extends Context.Tag('@morphir/ui/PipelineService')<
  PipelineService,
  PipelineServiceApi
>() {}

export type {
  CapabilityCatalog,
  PlaygroundCompileResult,
  PlaygroundGenerateResult,
} from '@morphir/workspace'
