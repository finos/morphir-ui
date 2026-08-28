import { contextBridge, ipcRenderer } from 'electron'

const CHANNEL = 'morphir-rpc'

contextBridge.exposeInMainWorld('morphirIpc', {
  platform: process.platform,
  postMessage: (message: unknown) => ipcRenderer.send(CHANNEL, message),
  onMessage: (handler: (message: unknown) => void) =>
    ipcRenderer.on(CHANNEL, (_event, message) => handler(message)),
})
