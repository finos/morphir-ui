import '@morphir/ui/theme.css'
import { Effect } from 'effect'
import { mount, unmount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { browserCore } from './layers/browser-layers.ts'
import { makeWebAppDisposer, shouldDisposeOnPageHide } from './lifecycle.ts'
import { makeConnectedWorkbenchAdapters } from './connected/connected-provider.ts'
import { makeConnectedPipeline } from './connected/pipeline.ts'
import { makeConnectedRpcClient } from './connected/rpc-client.ts'
import { discoverConnectedSession } from './connected/session.ts'

const connectedManifest = await Effect.runPromise(
  discoverConnectedSession(globalThis.fetch, new URL(globalThis.location.href)),
)
const connectedClient = connectedManifest
  ? makeConnectedRpcClient({
      manifest: connectedManifest,
      pageUrl: new URL(globalThis.location.href),
    })
  : null
const services = await makeAppServices({
  core: browserCore(
    __MORPHIR_WEB_VERSION__,
    connectedClient ? makeConnectedWorkbenchAdapters(connectedClient) : [],
  ),
  pipeline: connectedClient ? makeConnectedPipeline(connectedClient) : undefined,
})
const initialConfig = await services.loadConfig()

const app = mount(MorphirApp, {
  target: document.getElementById('app')!,
  props: {
    services,
    badge: 'WEB',
    version: __MORPHIR_WEB_VERSION__,
    initialConfig,
    initialSources: connectedManifest?.initialSources ?? [],
  },
})

const disposeApp = makeWebAppDisposer({
  unmount: () => unmount(app),
  disposeServices: () => services.dispose(),
  disposeConnections: () =>
    connectedClient ? Effect.runPromise(connectedClient.close) : Promise.resolve(),
})
const onPageHide = (event: PageTransitionEvent): void => {
  if (shouldDisposeOnPageHide(event)) void disposeApp()
}
window.addEventListener('pagehide', onPageHide)
import.meta.hot?.dispose(() => {
  window.removeEventListener('pagehide', onPageHide)
  void disposeApp()
})
