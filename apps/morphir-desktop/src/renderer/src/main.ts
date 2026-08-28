import '@morphir/ui/theme.css'
import { mount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { desktopCore } from './layers/desktop-layers.ts'
import { RpcClient } from './layers/rpc-client.ts'

const rpc = new RpcClient()
const services = await makeAppServices({ core: desktopCore(rpc) })
const version = await services.version()
const initialConfig = await services.loadConfig()

mount(MorphirApp, {
  target: document.getElementById('app')!,
  props: {
    services,
    badge: 'DESKTOP',
    version,
    initialConfig,
    macChrome: window.morphirIpc.platform === 'darwin',
  },
})

if (new URLSearchParams(location.search).get('smoke') === '1') {
  void rpc.call('morphir/shell/smokeReport', { ok: true })
}
