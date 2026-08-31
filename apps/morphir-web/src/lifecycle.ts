export const shouldDisposeOnPageHide = (event: Pick<PageTransitionEvent, 'persisted'>): boolean =>
  !event.persisted

export interface WebAppDisposal {
  readonly unmount: () => void | Promise<void>
  readonly disposeServices: () => Promise<void>
  readonly disposeConnections?: () => Promise<void>
}

export const makeWebAppDisposer = (steps: WebAppDisposal): (() => Promise<void>) => {
  let shutdown: Promise<void> | null = null
  return () =>
    (shutdown ??= Promise.resolve().then(async () => {
      try {
        await steps.unmount()
      } finally {
        try {
          await steps.disposeServices()
        } finally {
          await steps.disposeConnections?.()
        }
      }
    }))
}
