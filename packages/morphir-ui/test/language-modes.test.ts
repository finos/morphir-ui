import { describe, expect, test } from 'vitest'
import {
  type DocumentLines,
  lspPositionToOffset,
  registeredLanguageIds,
  resolveLanguageMode,
} from '../src/components/editor/language-modes.ts'

describe('language modes', () => {
  test('an unknown language resolves to no mode rather than throwing', () => {
    expect(resolveLanguageMode('not-a-language')).toBeNull()
  })

  test('every registered id resolves', () => {
    for (const id of registeredLanguageIds()) {
      expect(resolveLanguageMode(id)).not.toBeNull()
    }
  })

  test('resolution is by catalog language id, not by file extension', () => {
    expect(resolveLanguageMode('.elm')).toBeNull()
  })
})

/** A `DocumentLines` built from plain strings, with no dependency on any
 * editor library's document type — the same structural contract a Monaco
 * implementation would satisfy with its own model. */
function fakeDocument(lines: ReadonlyArray<string>): DocumentLines {
  const starts: number[] = []
  let offset = 0
  for (const text of lines) {
    starts.push(offset)
    offset += text.length + 1 // +1 for the newline separator
  }
  return {
    lines: lines.length,
    line(lineNumber: number) {
      const index = lineNumber - 1
      return { from: starts[index]!, length: lines[index]!.length }
    },
  }
}

describe('lspPositionToOffset', () => {
  const doc = fakeDocument(['module Main', 'x = 1', 'y = 2'])

  test('line 0 character 0 is the start of the document', () => {
    expect(lspPositionToOffset(doc, { line: 0, character: 0 })).toBe(0)
  })

  test('a character within a line offsets from that line start', () => {
    // line 1 ("x = 1") starts right after "module Main\n" -> offset 12
    expect(lspPositionToOffset(doc, { line: 1, character: 2 })).toBe(12 + 2)
  })

  test('a character past the end of its line clamps to the line end', () => {
    const line = doc.line(2) // "x = 1", length 5
    expect(lspPositionToOffset(doc, { line: 1, character: 999 })).toBe(line.from + line.length)
  })

  test('a line past the end of the document clamps to the last line', () => {
    const lastLine = doc.line(doc.lines)
    expect(lspPositionToOffset(doc, { line: 999, character: 0 })).toBe(lastLine.from)
  })
})
