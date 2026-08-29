import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type SecretCrypto } from '../src/main/secrets.ts'

const fakeCrypto = (available = true): SecretCrypto => ({
  isAvailable: () => available,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse()),
  decryptString: (blob) => Buffer.from([...blob].reverse()).toString('utf8'),
})

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'morphir-secrets-')), 'secrets.json')

describe('SecretStore', () => {
  test('set/get/delete round-trip through encryption', async () => {
    const store = new SecretStore(tempFile(), fakeCrypto())
    expect(await store.get('github')).toBeNull()
    await store.set('github', 'ghp_supersecretvalue1234')
    expect(await store.get('github')).toBe('ghp_supersecretvalue1234')
    await store.delete('github')
    expect(await store.get('github')).toBeNull()
  })

  test('file content never contains the plaintext', async () => {
    const file = tempFile()
    const store = new SecretStore(file, fakeCrypto())
    await store.set('github', 'ghp_supersecretvalue1234')
    const raw = await Bun.file(file).text()
    expect(raw).not.toContain('ghp_supersecretvalue1234')
  })

  test('refuses to store when encryption is unavailable', async () => {
    const store = new SecretStore(tempFile(), fakeCrypto(false))
    await expect(store.set('github', 'x')).rejects.toThrow('secure storage is not available')
  })

  test('concurrent set operations are serialized', async () => {
    const store = new SecretStore(tempFile(), fakeCrypto())
    await Promise.all([store.set('a', 'va'), store.set('b', 'vb')])
    expect(await store.get('a')).toBe('va')
    expect(await store.get('b')).toBe('vb')
  })
})
