import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  WorkspaceError,
  WorkspaceService,
  defaultUiConfig,
  type CoreServices,
  type UiConfig,
  type WorkspaceRef,
} from '@morphir/ui'
import type { RpcClient } from './rpc-client.ts'

export const desktopCore = (rpc: RpcClient): Layer.Layer<CoreServices> =>
  Layer.mergeAll(
    Layer.succeed(AppInfoService, {
      version: rpc.effect<{ version: string }>('morphir/shell/appVersion').pipe(
        Effect.map((r) => r.version),
        Effect.orDie,
      ),
    }),
    Layer.succeed(ConfigService, {
      load: rpc
        .effect<UiConfig>('morphir/config/load')
        .pipe(Effect.orElseSucceed(() => defaultUiConfig)),
      save: (config: UiConfig) =>
        rpc.effect('morphir/config/save', { config }).pipe(Effect.asVoid, Effect.orDie),
    }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: rpc.effect<{ path: string } | null>('morphir/workspace/pick').pipe(
        Effect.mapError((e) => new WorkspaceError({ message: e.message })),
        Effect.flatMap((picked) =>
          picked === null
            ? Effect.succeed(Option.none())
            : rpc.effect<{ content: string }>('morphir/workspace/read', { path: picked.path }).pipe(
                Effect.mapError((e) => new WorkspaceError({ message: e.message })),
                Effect.map((r) => Option.some({ ref: { path: picked.path }, content: r.content })),
              ),
        ),
      ),
      read: Option.some((ref: WorkspaceRef) =>
        rpc.effect<{ content: string }>('morphir/workspace/read', { path: ref.path }).pipe(
          Effect.mapError((e) => new WorkspaceError({ message: e.message })),
          Effect.map((r) => r.content),
        ),
      ),
    }),
  )
