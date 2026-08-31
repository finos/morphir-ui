import { Effect, Schema } from 'effect'
import { ConnectedSessionManifestSchema, type ConnectedSessionManifest } from '@morphir/workspace'
import { WorkbenchError } from '@morphir/ui'

const BROWSER_PROVIDER_ID = 'browser-local'

const discoveryError = (message: string): WorkbenchError =>
  new WorkbenchError({
    code: 'provider-disconnected',
    source: '<connected-host>',
    message,
  })

export const discoverConnectedSession = (
  fetcher: typeof fetch,
  pageUrl: URL,
): Effect.Effect<ConnectedSessionManifest | null, WorkbenchError> =>
  Effect.tryPromise({
    try: () => fetcher(new URL('/api/session', pageUrl)),
    catch: () =>
      discoveryError('Unable to contact the same-origin connected host session endpoint'),
  }).pipe(
    Effect.flatMap((response) => {
      if (response.status === 404) return Effect.succeed(null)
      if (!response.ok) {
        return Effect.fail(
          discoveryError(`Connected host session endpoint returned HTTP ${response.status}`),
        )
      }
      if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
        return Effect.succeed(null)
      }
      return Effect.tryPromise({
        try: () => response.json(),
        catch: () => discoveryError('Connected host session endpoint returned invalid JSON'),
      }).pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => {
              const manifest = Schema.decodeUnknownSync(ConnectedSessionManifestSchema)(value)
              if (manifest.providers.some(({ id }) => id === BROWSER_PROVIDER_ID)) {
                throw new TypeError('Connected provider ID is reserved: ' + BROWSER_PROVIDER_ID)
              }
              return manifest
            },
            catch: () =>
              discoveryError('Connected host session manifest is invalid or incompatible'),
          }),
        ),
      )
    }),
  )
