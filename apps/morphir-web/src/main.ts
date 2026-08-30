import '@morphir/ui/theme.css'
import { mount, unmount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { browserCore } from './layers/browser-layers.ts'
import { shouldDisposeOnPageHide } from './lifecycle.ts'

const services = await makeAppServices({ core: browserCore(__MORPHIR_WEB_VERSION__) })
const initialConfig = await services.loadConfig()

const app = mount(MorphirApp, {
  target: document.getElementById('app')!,
  props: { services, badge: 'WEB', version: __MORPHIR_WEB_VERSION__, initialConfig },
})

let shutdown: Promise<void> | null = null
const disposeApp = (): Promise<void> =>
  (shutdown ??= Promise.resolve(unmount(app)).then(() => services.dispose()))
const onPageHide = (event: PageTransitionEvent): void => {
  if (shouldDisposeOnPageHide(event)) void disposeApp()
}
window.addEventListener('pagehide', onPageHide)
import.meta.hot?.dispose(() => {
  window.removeEventListener('pagehide', onPageHide)
  void disposeApp()
})
