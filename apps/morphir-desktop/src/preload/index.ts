import { contextBridge, ipcRenderer } from 'electron'

const CHANNEL = 'morphir-rpc'

contextBridge.exposeInMainWorld('morphirIpc', {
  platform: process.platform,
  postMessage: (message: unknown) => ipcRenderer.send(CHANNEL, message),
  onMessage: (handler: (message: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown): void => handler(message)
    ipcRenderer.on(CHANNEL, listener)
    return () => ipcRenderer.removeListener(CHANNEL, listener)
  },
})
