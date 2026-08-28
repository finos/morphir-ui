import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  WorkspaceService,
  defaultUiConfig,
  type CoreServices,
  type UiConfig,
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
    // INTERIM no-op workspace — replaced by native dialogs over RPC in Task 12.
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.succeed(Option.none()),
      read: Option.none(),
    }),
  )
