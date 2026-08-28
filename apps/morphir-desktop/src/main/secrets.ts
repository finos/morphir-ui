import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretCrypto {
  isAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(blob: Buffer): string
}

export const GH_SECRET_KEY = 'github'

export class SecretStore {
  #queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly crypto: SecretCrypto,
  ) {}

  async #read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  async #write(blobs: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(blobs), 'utf8')
  }

  #serialize<T>(op: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(op, op)
    this.#queue = result.catch(() => undefined)
    return result
  }

  async get(key: string): Promise<string | null> {
    return this.#serialize(async () => {
      const blobs = await this.#read()
      const blob = blobs[key]
      if (!blob) return null
      try {
        return this.crypto.decryptString(Buffer.from(blob, 'base64'))
      } catch {
        return null
      }
    })
  }

  async set(key: string, value: string): Promise<void> {
    return this.#serialize(async () => {
      if (!this.crypto.isAvailable())
        throw new Error('secure storage is not available on this system')
      const blobs = await this.#read()
      blobs[key] = this.crypto.encryptString(value).toString('base64')
      await this.#write(blobs)
    })
  }

  async delete(key: string): Promise<void> {
    return this.#serialize(async () => {
      const blobs = await this.#read()
      delete blobs[key]
      await this.#write(blobs)
    })
  }
}
