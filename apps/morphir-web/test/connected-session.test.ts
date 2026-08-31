import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { discoverConnectedSession } from '../src/connected/session.ts'

const validManifest = {
  protocolVersion: 1,
  webSocketPath: '/rpc',
  sessionId: 'session-1',
  providers: [
    {
      id: 'cli:session-1',
      name: 'Morphir CLI',
      kind: 'connected',
      status: 'available',
      capabilities: [
        { name: 'morphir/development/inspect', version: '1' },
        { name: 'morphir/workspace/open', version: '1' },
        { name: 'morphir/workspace/watch', version: '1' },
      ],
    },
  ],
  initialSources: [
    {
      providerId: 'cli:session-1',
      locator: 'workspace:initial',
      displayName: 'orders',
    },
  ],
}

describe('connected web session discovery', () => {
  test('uses only the same-origin session endpoint and treats 404 as standalone mode', async () => {
    const requested: Array<string> = []
    const fetcher: typeof fetch = async (input) => {
      requested.push(String(input))
      return new Response(null, { status: 404 })
    }

    await expect(
      Effect.runPromise(
        discoverConnectedSession(fetcher, new URL('http://127.0.0.1:4242/workbench')),
      ),
    ).resolves.toBeNull()
    expect(requested).toEqual(['http://127.0.0.1:4242/api/session'])
  })

  test('treats a successful HTML SPA fallback as standalone mode', async () => {
    await expect(
      Effect.runPromise(
        discoverConnectedSession(
          async () =>
            new Response('<!doctype html><title>Morphir</title>', {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
          new URL('https://morphir.example/workbench'),
        ),
      ),
    ).resolves.toBeNull()
  })

  test('still fails closed when a JSON session response is malformed', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        discoverConnectedSession(
          async () =>
            new Response('<not-json>', {
              headers: { 'content-type': 'application/json' },
            }),
          new URL('https://morphir.example/'),
        ),
      ),
    )

    expect(error.code).toBe('provider-disconnected')
    expect(error.message).toContain('invalid JSON')
  })

  test('decodes a compatible manifest and fails closed on malformed input', async () => {
    const connected = await Effect.runPromise(
      discoverConnectedSession(
        async () => Response.json(validManifest),
        new URL('http://127.0.0.1:4242/'),
      ),
    )
    expect(connected?.initialSources[0]?.providerId).toBe('cli:session-1')

    const error = await Effect.runPromise(
      Effect.flip(
        discoverConnectedSession(
          async () => Response.json({ ...validManifest, protocolVersion: 2, token: 'secret' }),
          new URL('http://127.0.0.1:4242/'),
        ),
      ),
    )
    expect(error.code).toBe('provider-disconnected')
    expect(error.message).not.toContain('secret')
  })

  test('rejects a connected provider that collides with the browser provider', async () => {
    const collidingManifest = {
      ...validManifest,
      providers: [{ ...validManifest.providers[0], id: 'browser-local' }],
      initialSources: [{ ...validManifest.initialSources[0], providerId: 'browser-local' }],
    }

    const error = await Effect.runPromise(
      Effect.flip(
        discoverConnectedSession(
          async () => Response.json(collidingManifest),
          new URL('http://127.0.0.1:4242/'),
        ),
      ),
    )

    expect(error).toMatchObject({
      code: 'provider-disconnected',
      message: expect.stringContaining('invalid or incompatible'),
    })
  })
})
