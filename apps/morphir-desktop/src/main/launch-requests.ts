const unique = (sources: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(sources.filter((source) => source.length > 0)),
]

export const parseOpenSources = (
  argv: ReadonlyArray<string>,
  isPackaged: boolean,
): ReadonlyArray<string> => {
  const appArguments = argv.slice(isPackaged ? 1 : 2)
  const separator = appArguments.indexOf('--')
  const regular = separator >= 0 ? appArguments.slice(0, separator) : appArguments
  const escaped = separator >= 0 ? appArguments.slice(separator + 1) : []
  return unique([...regular.filter((argument) => !argument.startsWith('-')), ...escaped])
}

export class LaunchRequestQueue {
  #initial: ReadonlyArray<string>
  #initialTaken = false

  constructor(initial: ReadonlyArray<string>) {
    this.#initial = unique(initial)
  }

  takeInitial(): ReadonlyArray<string> {
    if (this.#initialTaken) return []
    const initial = this.#initial
    this.#initial = []
    this.#initialTaken = true
    return initial
  }

  push(sources: ReadonlyArray<string>): ReadonlyArray<string> {
    const batch = unique(sources)
    if (!this.#initialTaken) {
      this.#initial = unique([...this.#initial, ...batch])
      return []
    }
    return batch
  }
}
