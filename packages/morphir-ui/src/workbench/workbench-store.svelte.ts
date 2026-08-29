import type { UiConfig } from '../services/config.ts'
import type { AppServices } from '../services/services.ts'
import type { SourcePickerKind } from './services.ts'
import type {
  DevelopmentRoute,
  ModelRoute,
  WorkbenchDescriptor,
  WorkbenchEntry,
  WorkbenchId,
} from './types.ts'

const MAX_RECENT = 20

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const matchesQuery = (descriptor: WorkbenchDescriptor, query: string): boolean => {
  const normalized = query.trim().toLocaleLowerCase()
  return (
    normalized.length === 0 ||
    descriptor.name.toLocaleLowerCase().includes(normalized) ||
    descriptor.source.toLocaleLowerCase().includes(normalized)
  )
}

export class WorkbenchStore {
  openEntries = $state<ReadonlyArray<WorkbenchEntry>>([])
  recent = $state<ReadonlyArray<WorkbenchDescriptor>>([])
  activeId = $state<WorkbenchId | null>(null)
  failedRequests = $state<ReadonlyArray<{ source: string; message: string }>>([])
  query = $state('')
  recentExpanded = $state(false)

  readonly #services: AppServices
  readonly #reopenOnLaunch: boolean

  constructor(services: AppServices, initial: UiConfig['workbenches']) {
    this.#services = services
    this.#reopenOnLaunch = initial.reopenOnLaunch
    this.openEntries = initial.reopenOnLaunch
      ? initial.open.map((descriptor) => ({ descriptor, status: 'loading' as const }))
      : []
    this.recent = initial.reopenOnLaunch
      ? initial.recent
      : [...initial.open, ...initial.recent].slice(0, MAX_RECENT)
    this.activeId = initial.reopenOnLaunch ? initial.activeId : null
  }

  get active(): WorkbenchEntry | null {
    return this.openEntries.find((entry) => entry.descriptor.id === this.activeId) ?? null
  }

  get filteredOpen(): ReadonlyArray<WorkbenchEntry> {
    return this.openEntries.filter((entry) => matchesQuery(entry.descriptor, this.query))
  }

  get filteredRecent(): ReadonlyArray<WorkbenchDescriptor> {
    return this.recent.filter((descriptor) => matchesQuery(descriptor, this.query))
  }

  async open(source: string): Promise<WorkbenchId | null> {
    const requested = source.trim()
    if (requested.length === 0) return null

    const existing = this.openEntries.find((entry) => entry.descriptor.source === requested)
    if (existing) {
      this.activate(existing.descriptor.id)
      return existing.descriptor.id
    }

    try {
      const descriptor = await this.#services.inspectWorkbench(requested)
      const canonicalExisting = this.openEntries.find(
        (entry) => entry.descriptor.source === descriptor.source,
      )
      if (canonicalExisting) {
        this.activate(canonicalExisting.descriptor.id)
        return canonicalExisting.descriptor.id
      }

      this.failedRequests = this.failedRequests.filter(
        (failure) => failure.source !== requested && failure.source !== descriptor.source,
      )
      this.recent = this.recent.filter(
        (candidate) => candidate.id !== descriptor.id && candidate.source !== descriptor.source,
      )
      this.openEntries = [{ descriptor, status: 'loading' }, ...this.openEntries]
      this.activeId = descriptor.id
      this.#persist()
      await this.#load(descriptor)
      return descriptor.id
    } catch (error) {
      const failure = { source: requested, message: messageOf(error) }
      this.failedRequests = [
        failure,
        ...this.failedRequests.filter((candidate) => candidate.source !== requested),
      ]
      return null
    }
  }

  async openPicked(kind: SourcePickerKind): Promise<void> {
    const source = await this.#services.pickWorkbenchSource(kind)
    if (source) await this.open(source)
  }

  async restore(commandLineSources: ReadonlyArray<string> = []): Promise<void> {
    if (this.#reopenOnLaunch) {
      for (const entry of this.openEntries) await this.#load(entry.descriptor)
    }

    let firstCommandLineId: WorkbenchId | null = null
    for (const source of commandLineSources) {
      const openedId = await this.open(source)
      firstCommandLineId ??= openedId
    }
    if (firstCommandLineId) this.activate(firstCommandLineId)
  }

  activate(id: WorkbenchId): void {
    if (!this.openEntries.some((entry) => entry.descriptor.id === id)) return
    this.activeId = id
    this.#persist()
  }

  close(id: WorkbenchId): void {
    const closing = this.openEntries.find((entry) => entry.descriptor.id === id)
    if (!closing) return
    this.openEntries = this.openEntries.filter((entry) => entry.descriptor.id !== id)
    this.recent = [
      closing.descriptor,
      ...this.recent.filter((descriptor) => descriptor.id !== id),
    ].slice(0, MAX_RECENT)
    if (this.activeId === id) this.activeId = this.openEntries[0]?.descriptor.id ?? null
    this.#persist()
  }

  async reopen(id: WorkbenchId): Promise<void> {
    const descriptor = this.recent.find((candidate) => candidate.id === id)
    if (!descriptor) return
    this.recent = this.recent.filter((candidate) => candidate.id !== id)
    this.openEntries = [{ descriptor, status: 'loading' }, ...this.openEntries]
    this.activeId = descriptor.id
    this.#persist()
    await this.#load(descriptor)
  }

  async retry(id: WorkbenchId): Promise<void> {
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    if (!entry) return
    this.#replace(id, { descriptor: entry.descriptor, status: 'loading' })
    await this.#load(entry.descriptor)
  }

  async reveal(id: WorkbenchId): Promise<void> {
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    if (entry) await this.#services.revealWorkbenchSource(entry.descriptor.source)
  }

  removeFailedRequest(source: string): void {
    this.failedRequests = this.failedRequests.filter((failure) => failure.source !== source)
  }

  selectRoute(id: WorkbenchId, route: ModelRoute | DevelopmentRoute): void {
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    if (!entry) return
    const descriptor =
      entry.descriptor.kind === 'model'
        ? { ...entry.descriptor, route: route === 'explorer' ? 'explorer' : 'overview' }
        : { ...entry.descriptor, route: 'overview' as const }
    this.#replace(id, { ...entry, descriptor } as WorkbenchEntry)
    this.#persist()
  }

  clearRecent(): void {
    this.recent = []
    this.#persist()
  }

  async #load(descriptor: WorkbenchDescriptor): Promise<void> {
    try {
      const data =
        descriptor.kind === 'model'
          ? await this.#services.loadModelWorkbench(descriptor)
          : await this.#services.loadDevelopmentWorkbench(descriptor)
      const currentDescriptor =
        this.openEntries.find((entry) => entry.descriptor.id === descriptor.id)?.descriptor ??
        descriptor
      this.#replace(descriptor.id, {
        descriptor: currentDescriptor,
        status: 'ready',
        data: { ...data, descriptor: currentDescriptor } as typeof data,
      })
    } catch (error) {
      const currentDescriptor =
        this.openEntries.find((entry) => entry.descriptor.id === descriptor.id)?.descriptor ??
        descriptor
      this.#replace(descriptor.id, {
        descriptor: currentDescriptor,
        status: 'error',
        message: messageOf(error),
      })
    }
  }

  #replace(id: WorkbenchId, entry: WorkbenchEntry): void {
    this.openEntries = this.openEntries.map((candidate) =>
      candidate.descriptor.id === id ? entry : candidate,
    )
  }

  #persist(): void {
    const open = this.openEntries.map((entry) => entry.descriptor)
    const recent = this.recent
    const activeId = this.activeId
    void this.#services.updateConfig((config) => ({
      ...config,
      workbenches: {
        ...config.workbenches,
        open,
        recent,
        activeId,
      },
    }))
  }
}
