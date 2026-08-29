import { describe, expect, test } from 'bun:test'
import { RpcClient, type MorphirIpc } from '../src/renderer/src/layers/rpc-client.ts'

const fakeIpc = () => {
  const handlers: Array<(message: unknown) => void> = []
  const sent: unknown[] = []
  const ipc: MorphirIpc = {
    platform: 'darwin',
    postMessage: (message) => sent.push(message),
    onMessage: (handler) => void handlers.push(handler),
  }
  return { ipc, sent, emit: (message: unknown) => handlers.forEach((handler) => handler(message)) }
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
})
