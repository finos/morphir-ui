import type { Name, Path } from './decode.ts'

const CANONICAL_NAME = /^([a-z0-9]+|[A-Z0-9]+)(-([a-z0-9]+|[A-Z0-9]+))*$/

export const nameFromCanonical = (value: unknown): Name | null => {
  if (typeof value !== 'string' || !CANONICAL_NAME.test(value)) return null
  return value
    .split('-')
    .flatMap((segment) => (/[A-Z]/.test(segment) ? [...segment.toLowerCase()] : [segment]))
}

export const pathFromCanonical = (value: unknown): Path | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const path = value.split('/').map(nameFromCanonical)
  return path.every((name) => name !== null) ? path : null
}

const isDigits = (part: string) => /^\d+$/.test(part)
const cap = (part: string) =>
  isDigits(part)
    ? part
    : part.length === 1
      ? part.toUpperCase()
      : part[0]!.toUpperCase() + part.slice(1)

export const nameToTitle = (name: Name): string => name.map(cap).join('')

export const nameToCamel = (name: Name): string =>
  name.map((part, i) => (i === 0 ? part : cap(part))).join('')

export const pathToTitle = (path: Path): string => path.map(nameToTitle).join('.')
