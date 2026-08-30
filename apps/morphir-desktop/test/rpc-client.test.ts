import { describe, expect, test } from 'bun:test'
import { RpcClient, type MorphirIpc } from '../src/renderer/src/layers/rpc-client.ts'

const fakeIpc = () => {
  const handlers = new Set<(message: unknown) => void>()
  const sent: unknown[] = []
  const ipc: MorphirIpc = {
    platform: 'darwin',
    postMessage: (message) => sent.push(message),
    onMessage: (handler) => {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
  }
  return {
    ipc,
    sent,
    emit: (message: unknown) => handlers.forEach((handler) => handler(message)),
    listenerCount: () => handlers.size,
  }
}

describe('RpcClient notifications', () => {
  test('dispatches matching notifications and returns an unsubscribe function', () => {
    const wire = fakeIpc()
    const client = new RpcClient(wire.ipc)
    const received: unknown[] = []
    const unsubscribe = client.onNotification('morphir/workbench/openSources', (params) =>
      received.push(params),
    )

    wire.emit({ method: 'morphir/other', params: ['ignored'] })
    wire.emit({ method: 'morphir/workbench/openSources', params: { sources: ['/a.json'] } })
    unsubscribe()
    wire.emit({ method: 'morphir/workbench/openSources', params: { sources: ['/b.json'] } })

    expect(received).toEqual([{ sources: ['/a.json'] }])
  })

  test('keeps numeric-id responses on the request path', async () => {
    const wire = fakeIpc()
    const client = new RpcClient(wire.ipc)
    const pending = client.call('morphir/test')
    const request = wire.sent[0] as { id: number }

    wire.emit({ id: request.id, result: { ok: true } })

    expect(await pending).toEqual({ ok: true })
  })

  test('dispose removes the transport listener and stops notifications', () => {
    const wire = fakeIpc()
    const client = new RpcClient(wire.ipc)
    const received: unknown[] = []
    client.onNotification('morphir/test', (params) => received.push(params))

    expect(wire.listenerCount()).toBe(1)
    client.dispose()
    client.dispose()
    wire.emit({ method: 'morphir/test', params: 'ignored' })

    expect(wire.listenerCount()).toBe(0)
    expect(received).toEqual([])
  })

  test('dispose rejects pending and future calls without sending more messages', async () => {
    const wire = fakeIpc()
    const client = new RpcClient(wire.ipc)
    const pending = client.call('morphir/pending')

    client.dispose()

    await expect(pending).rejects.toThrow('RPC client disposed')
    await expect(client.call('morphir/after-dispose')).rejects.toThrow('RPC client disposed')
    expect(wire.sent).toHaveLength(1)
  })

  test('a synchronous transport failure removes its pending request', async () => {
    const wire = fakeIpc()
    let failSend = true
    wire.ipc.postMessage = (message) => {
      if (failSend) throw new Error('transport unavailable')
      wire.sent.push(message)
    }
    const client = new RpcClient(wire.ipc)

    await expect(client.call('morphir/fails')).rejects.toThrow('transport unavailable')
    expect(client.pendingRequestCount).toBe(0)

    failSend = false
    const recovered = client.call('morphir/recovers')
    const request = wire.sent[0] as { id: number }
    wire.emit({ id: request.id, result: 'ok' })
    expect(await recovered).toBe('ok')
    client.dispose()
    expect(wire.listenerCount()).toBe(0)
  })
})
