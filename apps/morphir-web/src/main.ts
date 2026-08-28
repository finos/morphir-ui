import '@morphir/ui/theme.css'
import { mount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { browserCore } from './layers/browser-layers.ts'

const services = await makeAppServices({ core: browserCore(__MORPHIR_WEB_VERSION__) })
const initialConfig = await services.loadConfig()

mount(MorphirApp, {
  target: document.getElementById('app')!,
  props: { services, badge: 'WEB', version: __MORPHIR_WEB_VERSION__, initialConfig },
})
