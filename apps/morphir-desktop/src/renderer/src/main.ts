import '@morphir/ui/theme.css'
import { mount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { desktopCore, desktopGitHub } from './layers/desktop-layers.ts'
import { RpcClient } from './layers/rpc-client.ts'
import type { WorkbenchSourceRef } from '@morphir/workspace'
import { requireDesktopSourceRef } from '../../shared/workbench-source.ts'
import { unmount } from 'svelte'
import { makeDesktopAppDisposer } from './app-lifecycle.ts'

const rpc = new RpcClient()
const services = await makeAppServices({ core: desktopCore(rpc), github: desktopGitHub(rpc) })
const version = await services.version()
const initialConfig = await services.loadConfig()
const pendingOpenBatches: ReadonlyArray<WorkbenchSourceRef>[] = []
let openSourcesHandler: ((sources: ReadonlyArray<WorkbenchSourceRef>) => void) | null = null
const unsubscribeOpenSources = rpc.onNotification('morphir/workbench/openSources', (params) => {
  const sources =
    typeof params === 'object' &&
    params !== null &&
    Array.isArray((params as { sources?: unknown }).sources)
      ? (params as { sources: unknown[] }).sources.flatMap((source) => {
          try {
            return [requireDesktopSourceRef(source)]
          } catch {
            return []
          }
        })
      : []
  if (sources.length === 0) return
  if (openSourcesHandler) openSourcesHandler(sources)
  else pendingOpenBatches.push(sources)
})
const initialResult = (await rpc.call('morphir/workbench/initialSources')) as { sources?: unknown }
const initialSources = Array.isArray(initialResult.sources)
  ? initialResult.sources.flatMap((source) => {
      try {
        return [requireDesktopSourceRef(source)]
      } catch {
        return []
      }
    })
  : []
const registerOpenSources = (
  handler: (sources: ReadonlyArray<WorkbenchSourceRef>) => void,
): (() => void) => {
  openSourcesHandler = handler
  for (const batch of pendingOpenBatches.splice(0)) handler(batch)
  return () => {
    if (openSourcesHandler === handler) openSourcesHandler = null
  }
}

const app = mount(MorphirApp, {
  target: document.getElementById('app')!,
  props: {
    services,
    badge: 'DESKTOP',
    version,
    initialConfig,
    initialSources,
    registerOpenSources,
    macChrome: window.morphirIpc.platform === 'darwin',
  },
})

const disposeApp = makeDesktopAppDisposer({
  unsubscribeNotifications: unsubscribeOpenSources,
  unmount: () => unmount(app),
  disposeServices: () => services.dispose(),
  disposeRpc: () => rpc.dispose(),
})
const onPageHide = (): void => void disposeApp()
window.addEventListener('pagehide', onPageHide, { once: true })
import.meta.hot?.dispose(() => {
  window.removeEventListener('pagehide', onPageHide)
  void disposeApp()
})

if (new URLSearchParams(location.search).get('smoke') === '1') {
  void rpc.call('morphir/shell/smokeReport', { ok: true })
}
