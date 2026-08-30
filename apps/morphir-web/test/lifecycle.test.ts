import { describe, expect, test } from 'vitest'
import { shouldDisposeOnPageHide } from '../src/lifecycle.ts'

describe('web app lifecycle', () => {
  test('keeps services alive when pagehide enters the back-forward cache', () => {
    expect(shouldDisposeOnPageHide({ persisted: true })).toBe(false)
    expect(shouldDisposeOnPageHide({ persisted: false })).toBe(true)
  })
})
