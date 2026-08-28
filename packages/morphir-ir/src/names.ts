import type { Name, Path } from './decode.ts'

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
