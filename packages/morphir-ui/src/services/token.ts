const KNOWN_PREFIXES = ['github_pat_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'ghp_']
const MIN_HIDDEN = 16
const SUFFIX_LEN = 4
const DEFAULT_PREFIX_LEN = 4

export const redactToken = (raw: string): string => {
  const prefix = KNOWN_PREFIXES.find((p) => raw.startsWith(p)) ?? raw.slice(0, DEFAULT_PREFIX_LEN)
  const hidden = raw.length - prefix.length - SUFFIX_LEN
  if (hidden < MIN_HIDDEN) return 'Token(redacted)'
  return `Token(${prefix}...${raw.slice(-SUFFIX_LEN)})`
}

export class Token {
  readonly #raw: string
  private constructor(raw: string) {
    this.#raw = raw
  }
  static parse(input: string): Token | null {
    const trimmed = input.trim()
    return trimmed.length === 0 ? null : new Token(trimmed)
  }
  toString(): string {
    return redactToken(this.#raw)
  }
  toJSON(): string {
    return this.toString()
  }
  /** The only way to the raw value. Callers: transport to safeStorage / Authorization header ONLY. */
  unsafeReveal(): string {
    return this.#raw
  }
}
