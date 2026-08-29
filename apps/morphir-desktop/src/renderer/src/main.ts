import '@morphir/ui/theme.css'
import { mount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { desktopCore, desktopGitHub } from './layers/desktop-layers.ts'
import { RpcClient } from './layers/rpc-client.ts'

const rpc = new RpcClient()
const services = await makeAppServices({ core: desktopCore(rpc), github: desktopGitHub(rpc) })
const version = await services.version()
const initialConfig = await services.loadConfig()
const pendingOpenBatches: ReadonlyArray<string>[] = []
let openSourcesHandler: ((sources: ReadonlyArray<string>) => void) | null = null
rpc.onNotification('morphir/workbench/openSources', (params) => {
  const sources =
    typeof params === 'object' &&
    params !== null &&
    Array.isArray((params as { sources?: unknown }).sources)
      ? (params as { sources: unknown[] }).sources.filter(
          (source): source is string => typeof source === 'string',
        )
      : []
  if (sources.length === 0) return
  if (openSourcesHandler) openSourcesHandler(sources)
  else pendingOpenBatches.push(sources)
})
const initialResult = (await rpc.call('morphir/workbench/initialSources')) as { sources?: unknown }
const initialSources = Array.isArray(initialResult.sources)
  ? initialResult.sources.filter((source): source is string => typeof source === 'string')
  : []
const registerOpenSources = (handler: (sources: ReadonlyArray<string>) => void): (() => void) => {
  openSourcesHandler = handler
  for (const batch of pendingOpenBatches.splice(0)) handler(batch)
  return () => {
    if (openSourcesHandler === handler) openSourcesHandler = null
  }
}

mount(MorphirApp, {
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

if (new URLSearchParams(location.search).get('smoke') === '1') {
  void rpc.call('morphir/shell/smokeReport', { ok: true })
}
