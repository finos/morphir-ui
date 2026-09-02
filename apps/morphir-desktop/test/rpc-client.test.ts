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
  test('sends plain JSON values when a project descriptor comes from reactive state', async () => {
    const wire = fakeIpc()
    // Electron IPC uses structured clone, which rejects Svelte's reactive proxies.
    wire.ipc.postMessage = (message) => wire.sent.push(structuredClone(message))
    const client = new RpcClient(wire.ipc)
    const source = new Proxy({ providerId: 'desktop-local', locator: '/sample' }, {})
    const descriptor = new Proxy({ kind: 'development', source }, {})
    const pending = client.call('morphir/workbench/readProjectModel', {
      descriptor,
      projectId: 'project-1',
    })
    const expected = {
      id: 1,
      method: 'morphir/workbench/readProjectModel',
      params: {
        descriptor: {
          kind: 'development',
          source: { providerId: 'desktop-local', locator: '/sample' },
        },
        projectId: 'project-1',
      },
    }
    // Attach a rejection handler before assertions so a failed send stays test-local.
    const outcome = pending.catch((error: unknown) => error)
    expect(wire.sent).toEqual([expected])
    wire.emit({ id: 1, result: { content: 'model' } })
    expect(await outcome).toEqual({ content: 'model' })
    expect(client.pendingRequestCount).toBe(0)
    client.dispose()
  })

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

  test('JSON serialization failure clears the pending request without sending it', async () => {
    const wire = fakeIpc()
    const client = new RpcClient(wire.ipc)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    await expect(client.call('morphir/invalid', cyclic)).rejects.toThrow()
    expect(client.pendingRequestCount).toBe(0)
    expect(wire.sent).toHaveLength(0)
    client.dispose()
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
