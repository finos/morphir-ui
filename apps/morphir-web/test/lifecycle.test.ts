import { describe, expect, test } from 'vitest'
import { makeWebAppDisposer, shouldDisposeOnPageHide } from '../src/lifecycle.ts'

describe('web app lifecycle', () => {
  test('keeps services alive when pagehide enters the back-forward cache', () => {
    expect(shouldDisposeOnPageHide({ persisted: true })).toBe(false)
    expect(shouldDisposeOnPageHide({ persisted: false })).toBe(true)
  })

  test('disposes services exactly once when unmount rejects', async () => {
    let unmountCalls = 0
    let serviceDisposals = 0
    const dispose = makeWebAppDisposer({
      unmount: async () => {
        unmountCalls += 1
        throw new Error('unmount failed')
      },
      disposeServices: async () => void (serviceDisposals += 1),
    })

    const first = dispose()
    const repeated = dispose()
    await expect(first).rejects.toThrow('unmount failed')
    await expect(repeated).rejects.toThrow('unmount failed')
    expect(unmountCalls).toBe(1)
    expect(serviceDisposals).toBe(1)
  })
})
