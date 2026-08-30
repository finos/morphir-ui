import { describe, expect, test } from 'bun:test'
import { makeDesktopAppDisposer } from '../src/renderer/src/app-lifecycle.ts'

describe('desktop app lifecycle', () => {
  test('unmounts before draining services and disposes RPC last exactly once', async () => {
    const events: string[] = []
    const dispose = makeDesktopAppDisposer({
      unsubscribeNotifications: () => void events.push('notifications-unsubscribed'),
      unmount: async () => void events.push('app-unmounted'),
      disposeServices: async () => void events.push('services-disposed'),
      disposeRpc: () => void events.push('rpc-disposed'),
    })

    const firstDisposal = dispose()
    expect(events).toEqual(['notifications-unsubscribed'])
    await Promise.all([firstDisposal, dispose()])

    expect(events).toEqual([
      'notifications-unsubscribed',
      'app-unmounted',
      'services-disposed',
      'rpc-disposed',
    ])
  })

  test('disposes RPC when service disposal fails', async () => {
    const events: string[] = []
    const dispose = makeDesktopAppDisposer({
      unsubscribeNotifications: () => void events.push('notifications-unsubscribed'),
      unmount: async () => void events.push('app-unmounted'),
      disposeServices: async () => {
        events.push('services-dispose-failed')
        throw new Error('dispose failed')
      },
      disposeRpc: () => void events.push('rpc-disposed'),
    })

    await expect(dispose()).rejects.toThrow('dispose failed')
    expect(events.at(-1)).toBe('rpc-disposed')
  })
})
