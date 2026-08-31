import { Effect, Fiber, Stream } from 'effect'
import { SvelteMap } from 'svelte/reactivity'
import type { UiConfig } from '../services/config.ts'
import type { AppServices } from '../services/services.ts'
import { sourceKey, type WorkbenchSourceRef, type WorkspaceEvent } from '@morphir/workspace'
import type { SourcePickerKind } from './services.ts'
import { legacySourceRef } from './types.ts'
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
    descriptor.source.displayName.toLocaleLowerCase().includes(normalized) ||
    descriptor.source.locator.toLocaleLowerCase().includes(normalized)
  )
}

const withSourceKey = (descriptor: WorkbenchDescriptor): WorkbenchDescriptor => ({
  ...descriptor,
  id: sourceKey(descriptor.source),
})

const isPersistable = (descriptor: WorkbenchDescriptor): boolean =>
  descriptor.source.persistence !== 'session'

const capRecent = (
  descriptors: ReadonlyArray<WorkbenchDescriptor>,
): ReadonlyArray<WorkbenchDescriptor> => {
  let durable = 0
  let session = 0
  return descriptors.filter((descriptor) => {
    if (isPersistable(descriptor)) {
      durable += 1
      return durable <= MAX_RECENT
    }
    session += 1
    return session <= MAX_RECENT
  })
}

export type FailedWorkbenchRequest =
  | {
      readonly kind: 'source'
      readonly key: string
      readonly source: WorkbenchSourceRef
      readonly message: string
    }
  | {
      readonly kind: 'picker'
      readonly key: string
      readonly source: string
      readonly message: string
    }

export class WorkbenchStore {
  openEntries = $state<ReadonlyArray<WorkbenchEntry>>([])
  recent = $state<ReadonlyArray<WorkbenchDescriptor>>([])
  activeId = $state<WorkbenchId | null>(null)
  failedRequests = $state<ReadonlyArray<FailedWorkbenchRequest>>([])
  query = $state('')
  recentExpanded = $state(false)

  readonly #services: AppServices
  readonly #reopenOnLaunch: boolean
  readonly #workspaceWatches = new SvelteMap<WorkbenchId, Fiber.RuntimeFiber<void, never>>()
  readonly #loadTokens = new SvelteMap<WorkbenchId, object>()

  constructor(services: AppServices, initial: UiConfig['workbenches']) {
    this.#services = services
    this.#reopenOnLaunch = initial.reopenOnLaunch
    const persistedOpen = initial.open.filter(isPersistable)
    const persistedRecent = initial.recent.filter(isPersistable)
    this.openEntries = initial.reopenOnLaunch
      ? persistedOpen.map((descriptor) => ({ descriptor, status: 'loading' as const }))
      : []
    this.recent = initial.reopenOnLaunch
      ? persistedRecent
      : [...persistedOpen, ...persistedRecent].slice(0, MAX_RECENT)
    this.activeId =
      initial.reopenOnLaunch && persistedOpen.some(({ id }) => id === initial.activeId)
        ? initial.activeId
        : null
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

  async open(source: WorkbenchSourceRef | string): Promise<WorkbenchId | null> {
    const requested = typeof source === 'string' ? legacySourceRef(source.trim()) : source
    if (requested.locator.length === 0) return null

    try {
      const descriptor = withSourceKey(await this.#services.inspectWorkbench(requested))
      const canonicalExisting = this.openEntries.find(
        (entry) => entry.descriptor.id === descriptor.id,
      )
      if (canonicalExisting) {
        if (sourceKey(requested) !== sourceKey(canonicalExisting.descriptor.source)) {
          await this.#release(requested)
        }
        this.activate(canonicalExisting.descriptor.id)
        if (canonicalExisting.status === 'error') {
          this.#replace(canonicalExisting.descriptor.id, {
            descriptor: canonicalExisting.descriptor,
            status: 'loading',
          })
          await this.#load(canonicalExisting.descriptor)
        }
        return canonicalExisting.descriptor.id
      }

      const requestedKey = sourceKey(requested)
      const descriptorKey = sourceKey(descriptor.source)
      this.failedRequests = this.failedRequests.filter(
        (failure) => failure.key !== requestedKey && failure.key !== descriptorKey,
      )
      this.recent = this.recent.filter((candidate) => candidate.id !== descriptor.id)
      this.openEntries = [{ descriptor, status: 'loading' }, ...this.openEntries]
      this.activeId = descriptor.id
      this.#persist()
      await this.#load(descriptor)
      return descriptor.id
    } catch (error) {
      await this.#release(requested)
      const failure: FailedWorkbenchRequest = {
        kind: 'source',
        key: sourceKey(requested),
        source: requested,
        message: messageOf(error),
      }
      this.failedRequests = [
        failure,
        ...this.failedRequests.filter((candidate) => candidate.key !== failure.key),
      ]
      return null
    }
  }

  async openPicked(kind: SourcePickerKind): Promise<void> {
    try {
      const source = await this.#services.pickWorkbenchSource(kind)
      if (source) await this.open(source)
    } catch (error) {
      const source = kind === 'folder' ? 'Open folder' : 'Open model file'
      const failure: FailedWorkbenchRequest = {
        kind: 'picker',
        key: `picker:${kind}`,
        source,
        message: messageOf(error),
      }
      this.failedRequests = [
        failure,
        ...this.failedRequests.filter((candidate) => candidate.key !== failure.key),
      ]
    }
  }

  async restore(
    commandLineSources: ReadonlyArray<WorkbenchSourceRef | string> = [],
  ): Promise<void> {
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
    this.#loadTokens.delete(id)
    this.#stopWorkspaceWatch(id)
    this.openEntries = this.openEntries.filter((entry) => entry.descriptor.id !== id)
    const candidates = [
      closing.descriptor,
      ...this.recent.filter((descriptor) => descriptor.id !== id),
    ]
    const nextRecent = capRecent(candidates)
    for (const descriptor of candidates) {
      if (!nextRecent.some((retained) => retained.id === descriptor.id)) {
        void this.#release(descriptor.source)
      }
    }
    this.recent = nextRecent
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

  removeFailedRequest(key: string): void {
    this.failedRequests = this.failedRequests.filter((failure) => failure.key !== key)
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
    for (const descriptor of this.recent) void this.#release(descriptor.source)
    this.recent = []
    this.#persist()
  }

  dispose(): void {
    this.#loadTokens.clear()
    for (const id of this.#workspaceWatches.keys()) this.#stopWorkspaceWatch(id)
  }

  async #release(source: WorkbenchSourceRef): Promise<void> {
    try {
      await this.#services.releaseWorkbenchSource(source)
    } catch {
      // Releasing an unreachable provider resource is best-effort and must not block UI changes.
    }
  }

  async #load(descriptor: WorkbenchDescriptor): Promise<void> {
    this.#stopWorkspaceWatch(descriptor.id)
    const token = {}
    this.#loadTokens.set(descriptor.id, token)
    try {
      const data =
        descriptor.kind === 'model'
          ? await this.#services.loadModelWorkbench(descriptor)
          : await this.#services.loadDevelopmentWorkbench(descriptor)
      const current = this.openEntries.find((entry) => entry.descriptor.id === descriptor.id)
      if (this.#loadTokens.get(descriptor.id) !== token || !current) return
      const currentDescriptor = current.descriptor
      this.#replace(descriptor.id, {
        descriptor: currentDescriptor,
        status: 'ready',
        data: { ...data, descriptor: currentDescriptor } as typeof data,
      })
      if (currentDescriptor.kind === 'development') {
        this.#startWorkspaceWatch(currentDescriptor)
      }
    } catch (error) {
      const current = this.openEntries.find((entry) => entry.descriptor.id === descriptor.id)
      if (this.#loadTokens.get(descriptor.id) !== token || !current) return
      this.#replace(descriptor.id, {
        descriptor: current.descriptor,
        status: 'error',
        message: messageOf(error),
      })
    } finally {
      if (this.#loadTokens.get(descriptor.id) === token) this.#loadTokens.delete(descriptor.id)
    }
  }

  #startWorkspaceWatch(descriptor: Extract<WorkbenchDescriptor, { kind: 'development' }>): void {
    const id = descriptor.id
    const watch = Effect.runFork(
      Stream.runForEach(this.#services.workspaceEvents(descriptor), (event) =>
        Effect.sync(() => this.#applyWorkspaceEvent(id, event)),
      ).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => this.#markWorkspaceError(id, messageOf(error))),
        ),
      ),
    )
    this.#workspaceWatches.set(id, watch)
    watch.addObserver(() => {
      if (this.#workspaceWatches.get(id) === watch) this.#workspaceWatches.delete(id)
    })
  }

  #applyWorkspaceEvent(id: WorkbenchId, event: WorkspaceEvent): void {
    if (event.tag === 'provider-disconnected') {
      this.#markWorkspaceError(id, event.message)
      return
    }
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    if (!entry || entry.descriptor.kind !== 'development') return
    if (entry.status === 'error') {
      this.#replace(id, {
        descriptor: entry.descriptor,
        status: 'ready',
        data: { kind: 'development', descriptor: entry.descriptor, snapshot: event.snapshot },
      })
      return
    }
    if (entry.status !== 'ready' || entry.data.kind !== 'development') return
    this.#replace(id, {
      ...entry,
      data: { ...entry.data, snapshot: event.snapshot },
    })
  }

  #markWorkspaceError(id: WorkbenchId, message: string): void {
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    if (!entry) return
    this.#replace(id, { descriptor: entry.descriptor, status: 'error', message })
  }

  #stopWorkspaceWatch(id: WorkbenchId): void {
    const watch = this.#workspaceWatches.get(id)
    if (!watch) return
    this.#workspaceWatches.delete(id)
    Effect.runFork(Fiber.interruptFork(watch))
  }

  #replace(id: WorkbenchId, entry: WorkbenchEntry): void {
    this.openEntries = this.openEntries.map((candidate) =>
      candidate.descriptor.id === id ? entry : candidate,
    )
  }

  #persist(): void {
    const open = this.openEntries.map((entry) => entry.descriptor).filter(isPersistable)
    const recent = this.recent.filter(isPersistable).slice(0, MAX_RECENT)
    const activeId = open.some(({ id }) => id === this.activeId) ? this.activeId : null
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
