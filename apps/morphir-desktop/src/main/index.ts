import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { RPC_CHANNEL, RpcRegistry } from './rpc.ts'
import { loadConfigFile, saveConfigFile } from './config.ts'
import { readWorkspaceFile } from './workspace.ts'
import { decodeUiConfig } from '@morphir/ui/config'

const smoke = process.env['MORPHIR_SMOKE'] === '1'
const registry = new RpcRegistry()

registry.register('morphir/shell/appVersion', async () => ({ version: app.getVersion() }))
registry.register('morphir/shell/smokeReport', async (params) => {
  const ok =
    typeof params === 'object' && params !== null && (params as { ok?: boolean }).ok === true
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED')
  if (smoke) app.exit(ok ? 0 : 1)
  return {}
})
registry.register('morphir/config/load', async () => loadConfigFile())
registry.register('morphir/config/save', async (params) => {
  const config = decodeUiConfig((params as { config?: unknown })?.config)
  await saveConfigFile(config)
  return {}
})
registry.register('morphir/workspace/pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Morphir workspace',
    filters: [{ name: 'Morphir IR', extensions: ['json'] }],
    properties: ['openFile'],
  })
  return result.canceled || result.filePaths.length === 0 ? null : { path: result.filePaths[0] }
})
registry.register('morphir/workspace/read', async (params) => {
  const path = (params as { path?: string })?.path
  if (typeof path !== 'string') throw new Error('workspace not found: <missing path>')
  return { content: await readWorkspaceFile(path) }
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !smoke,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(smoke ? `${rendererUrl}?smoke=1` : rendererUrl)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: smoke ? { smoke: '1' } : undefined,
    })
  }
  return win
}

void app.whenReady().then(() => {
  ipcMain.on(RPC_CHANNEL, (event, message) => {
    void registry.dispatch(message).then((response) => event.sender.send(RPC_CHANNEL, response))
  })
  createWindow()
  if (smoke) {
    setTimeout(() => {
      console.error('SMOKE TIMEOUT')
      app.exit(1)
    }, 90_000)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || smoke) app.quit()
})
