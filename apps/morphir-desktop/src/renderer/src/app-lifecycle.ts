export interface DesktopAppDisposal {
  readonly unsubscribeNotifications: () => void
  readonly unmount: () => void | Promise<void>
  readonly disposeServices: () => Promise<void>
  readonly disposeRpc: () => void
}

export const makeDesktopAppDisposer = (steps: DesktopAppDisposal): (() => Promise<void>) => {
  let shutdown: Promise<void> | null = null
  return () => {
    if (shutdown) return shutdown
    steps.unsubscribeNotifications()
    shutdown = Promise.resolve().then(async () => {
      try {
        try {
          await steps.unmount()
        } finally {
          await steps.disposeServices()
        }
      } finally {
        steps.disposeRpc()
      }
    })
    return shutdown
  }
}
