import { describe, expect, test } from 'vitest'
import { redactToken, Token } from '../src/services/token.ts'

describe('token redaction (morphir-scala contract)', () => {
  test('recognizes known prefixes and keeps last 4', () => {
    expect(redactToken('ghp_' + 'a'.repeat(36) + 'WXYZ')).toBe('Token(ghp_...WXYZ)')
    expect(redactToken('github_pat_' + 'b'.repeat(59) + '1234')).toBe('Token(github_pat_...1234)')
  })
  test('unknown prefix falls back to first 4 chars', () => {
    expect(redactToken('x'.repeat(40) + 'ABCD')).toBe('Token(xxxx...ABCD)')
  })
  test('short tokens collapse to Token(redacted)', () => {
    expect(redactToken('ghp_short')).toBe('Token(redacted)')
    expect(redactToken('')).toBe('Token(redacted)')
  })
  test('Token.parse trims and rejects empty; toString/toJSON never leak', () => {
    expect(Token.parse('   ')).toBeNull()
    const t = Token.parse('  ghp_' + 'c'.repeat(36) + 'TAIL  ')!
    expect(t.unsafeReveal()).toBe('ghp_' + 'c'.repeat(36) + 'TAIL')
    expect(t.toString()).toBe('Token(ghp_...TAIL)')
    expect(JSON.stringify({ t })).toBe('{"t":"Token(ghp_...TAIL)"}')
  })
})
