import { BrowserWindow, app, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { redactToken, Token } from '@morphir/ui/token'
import { RPC_CHANNEL, RpcRegistry } from './rpc.ts'
import { loadConfigFile, saveConfigFile } from './config.ts'
import { readWorkspaceFile } from './workspace.ts'
import { decodeUiConfig } from '@morphir/ui/config'
import { GH_SECRET_KEY, SecretStore } from './secrets.ts'
import { ghCliToken, verifyGitHubToken } from './github.ts'
import {
  inspectDevelopmentRoot,
  inspectWorkbenchSource,
  readModelSource,
} from './workbench-source.ts'
import { registerWorkbenchHandlers } from './workbench-rpc.ts'
import { LaunchRequestQueue, parseOpenSources } from './launch-requests.ts'

const smoke = process.env['MORPHIR_SMOKE'] === '1'
const registry = new RpcRegistry()
const hasSingleInstanceLock = smoke || app.requestSingleInstanceLock()
const launchRequests = new LaunchRequestQueue(parseOpenSources(process.argv, app.isPackaged))
let mainWindow: BrowserWindow | null = null

if (!hasSingleInstanceLock) app.quit()

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
  const config = decodeUiConfig((params as { config?: unknown })?.config, {
    legacyProviderId: 'desktop-local',
  })
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
registerWorkbenchHandlers(registry, {
  inspect: inspectWorkbenchSource,
  pick: async (kind) => {
    const result = await dialog.showOpenDialog({
      title: kind === 'model-file' ? 'Open Morphir model' : 'Open Morphir Workbench',
      ...(kind === 'model-file'
        ? {
            filters: [{ name: 'Morphir IR', extensions: ['json'] }],
            properties: ['openFile'] as const,
          }
        : { properties: ['openDirectory'] as const }),
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  readModel: readModelSource,
  inspectDevelopment: inspectDevelopmentRoot,
  reveal: async (source) => void shell.showItemInFolder(source),
  takeInitialSources: () => launchRequests.takeInitial(),
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !smoke,
    // Custom window controls are a follow-up; frameless win/linux returns when they land.
    frame: true,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
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

const forwardOpenSources = (sources: ReadonlyArray<string>): void => {
  const batch = launchRequests.push(sources)
  if (batch.length === 0 || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(RPC_CHANNEL, {
    method: 'morphir/workbench/openSources',
    params: { sources: batch },
  })
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    forwardOpenSources(parseOpenSources(argv, app.isPackaged))
  })
  app.on('open-file', (event, path) => {
    event.preventDefault()
    forwardOpenSources([path])
  })
}

if (hasSingleInstanceLock)
  void app.whenReady().then(() => {
    const secrets = new SecretStore(join(app.getPath('userData'), 'secrets.json'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => safeStorage.encryptString(plain),
      decryptString: (blob) => safeStorage.decryptString(blob),
    })

    registry.register('morphir/github/status', async () => {
      const config = await loadConfigFile()
      const stored = config.github.source === 'pat' ? await secrets.get(GH_SECRET_KEY) : null
      return { source: config.github.source, tokenDisplay: stored ? redactToken(stored) : null }
    })
    registry.register('morphir/github/setSource', async (params) => {
      const source = (params as { source?: string })?.source
      if (source !== 'none' && source !== 'gh-cli')
        throw new Error(`invalid source: ${String(source)}`)
      const config = await loadConfigFile()
      await saveConfigFile({ ...config, github: { source } })
      return {}
    })
    registry.register('morphir/github/setToken', async (params) => {
      const token = Token.parse(String((params as { token?: string })?.token ?? ''))
      if (!token) throw new Error('token must not be empty')
      await secrets.set(GH_SECRET_KEY, token.unsafeReveal())
      const config = await loadConfigFile()
      await saveConfigFile({ ...config, github: { source: 'pat' } })
      return {}
    })
    registry.register('morphir/github/clearToken', async () => {
      await secrets.delete(GH_SECRET_KEY)
      const config = await loadConfigFile()
      await saveConfigFile({ ...config, github: { source: 'none' } })
      return {}
    })
    registry.register('morphir/github/verify', async () => {
      const config = await loadConfigFile()
      const token =
        config.github.source === 'pat'
          ? await secrets.get(GH_SECRET_KEY)
          : config.github.source === 'gh-cli'
            ? await ghCliToken()
            : null
      if (!token) throw new Error('no token source configured')
      return verifyGitHubToken(token)
    })

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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || smoke) app.quit()
})
