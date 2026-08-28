import { describe, expect, test } from 'bun:test'
import { ghCliToken, verifyGitHubToken } from '../src/main/github.ts'

describe('verifyGitHubToken', () => {
  test('returns the login on 200', async () => {
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.github.com/user')
      expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer ghp_abc')
      return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await verifyGitHubToken('ghp_abc', fakeFetch)).toEqual({ login: 'octocat' })
  })

  test('maps failure statuses to a friendly error', async () => {
    const fakeFetch = (async () => new Response('bad', { status: 401 })) as unknown as typeof fetch
    await expect(verifyGitHubToken('ghp_abc', fakeFetch)).rejects.toThrow(
      'GitHub verification failed (401)',
    )
  })
})

describe('ghCliToken', () => {
  test('maps a missing gh binary to the friendly error', async () => {
    const failingExec = () => Promise.reject(new Error('spawn gh ENOENT'))
    await expect(ghCliToken(failingExec)).rejects.toThrow('gh CLI unavailable or not authenticated')
  })

  test('trims the token from stdout', async () => {
    const fakeExec = () => Promise.resolve({ stdout: 'gho_tok123\n', stderr: '' })
    expect(await ghCliToken(fakeExec)).toBe('gho_tok123')
  })
})
