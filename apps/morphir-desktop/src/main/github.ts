import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type Exec = (file?: string, args?: string[]) => Promise<{ stdout: string; stderr: string }>
const defaultExec: Exec = (file = 'gh', args = ['auth', 'token']) =>
  promisify(execFile)(file, args).then(({ stdout, stderr }) => ({
    stdout: String(stdout),
    stderr: String(stderr),
  }))

export async function ghCliToken(exec: Exec = defaultExec): Promise<string> {
  try {
    const { stdout } = await exec()
    const token = stdout.trim()
    if (!token) throw new Error('empty token')
    return token
  } catch {
    throw new Error('gh CLI unavailable or not authenticated')
  }
}

export async function verifyGitHubToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ login: string }> {
  const response = await fetchImpl('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'morphir-desktop',
    },
  })
  if (!response.ok) throw new Error(`GitHub verification failed (${response.status})`)
  const body = (await response.json()) as { login?: string }
  if (typeof body.login !== 'string') throw new Error('GitHub verification failed (no login)')
  return { login: body.login }
}
