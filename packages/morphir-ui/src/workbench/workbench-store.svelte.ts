import { Effect, Fiber, Stream } from 'effect'
import { SvelteMap } from 'svelte/reactivity'
import type { UiConfig } from '../services/config.ts'
import type { AppServices } from '../services/services.ts'
import { sourceKey, type WorkbenchSourceRef, type WorkspaceEvent } from '@morphir/workspace'
import { WorkbenchError, type SourcePickerKind } from './services.ts'
import {
  beginProjectModelLoad,
  completeProjectModelLoad,
  failProjectModelLoad,
  selectProjectDefinition,
  unloadedProjectModel,
  type WorkbenchRecoveryReason,
} from './project-model-state.ts'
import { legacySourceRef } from './types.ts'
import type {
  DevelopmentNavigationState,
  DevelopmentProjectModelEntry,
  DevelopmentRoute,
  DevelopmentWorkbenchData,
  DevelopmentWorkbenchDescriptor,
  ModelRoute,
  WorkbenchDescriptor,
  WorkbenchEntry,
  WorkbenchId,
} from './types.ts'

const MAX_RECENT = 20
const EMPTY_DEVELOPMENT_NAVIGATION: DevelopmentNavigationState = {
  activeProjectId: null,
  projects: [],
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const recoveryReasonOf = (error: unknown): WorkbenchRecoveryReason => {
  const message = messageOf(error)
  if (!(error instanceof WorkbenchError)) return { tag: 'load-failed', message }
  switch (error.code) {
    case 'provider-disconnected':
      return { tag: 'provider-disconnected', message }
    case 'permission-denied':
      return { tag: 'permission-required', message }
    default:
      return { tag: 'load-failed', message }
  }
}

type DevelopmentEntryWithData =
  | Extract<WorkbenchEntry, { readonly status: 'ready'; readonly data: DevelopmentWorkbenchData }>
  | Extract<WorkbenchEntry, { readonly status: 'unavailable' }>

const isDevelopmentEntryWithData = (
  entry: WorkbenchEntry | undefined,
): entry is DevelopmentEntryWithData =>
  entry?.status === 'unavailable' ||
  (entry?.status === 'ready' &&
    entry.descriptor.kind === 'development' &&
    entry.data.kind === 'development')

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
  developmentNavigationById = $state<Readonly<Record<WorkbenchId, DevelopmentNavigationState>>>({})

  readonly #services: AppServices
  readonly #reopenOnLaunch: boolean
  readonly #workspaceWatches = new SvelteMap<WorkbenchId, Fiber.RuntimeFiber<void, never>>()
  readonly #workspaceWatchTokens = new SvelteMap<WorkbenchId, object>()
  readonly #loadTokens = new SvelteMap<WorkbenchId, object>()
  readonly #projectLoadTokens = new SvelteMap<WorkbenchId, SvelteMap<string, object>>()

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

  developmentNavigation(id: WorkbenchId): DevelopmentNavigationState {
    return this.developmentNavigationById[id] ?? EMPTY_DEVELOPMENT_NAVIGATION
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
    this.#projectLoadTokens.delete(id)
    this.#removeDevelopmentNavigation(id)
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
    if (entry.status !== 'unavailable') {
      this.#replace(id, { descriptor: entry.descriptor, status: 'loading' })
    }
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

  async selectDevelopmentProject(id: WorkbenchId, projectId: string): Promise<void> {
    const entry = this.#developmentEntryWithData(id)
    if (!entry || !entry.data.snapshot.projects.some((project) => project.id === projectId)) return

    const navigation = this.developmentNavigation(id)
    this.#setDevelopmentNavigation(id, { ...navigation, activeProjectId: projectId })
    const existing = navigation.projects.find((project) => project.projectId === projectId)
    if (entry.status === 'unavailable') return
    if (existing?.modelState.tag === 'ready' || existing?.modelState.tag === 'loading') return
    await this.#loadDevelopmentProject(id, entry.descriptor, projectId)
  }

  async retryDevelopmentProject(id: WorkbenchId, projectId: string): Promise<void> {
    const entry = this.#readyDevelopmentEntry(id)
    if (!entry || !entry.data.snapshot.projects.some((project) => project.id === projectId)) return
    await this.#loadDevelopmentProject(id, entry.descriptor, projectId)
  }

  selectDevelopmentDefinition(
    id: WorkbenchId,
    projectId: string,
    definitionId: string | null,
  ): void {
    const navigation = this.developmentNavigation(id)
    const current = navigation.projects.find((project) => project.projectId === projectId)
    if (!current) return
    this.#setDevelopmentNavigation(id, {
      ...navigation,
      projects: navigation.projects.map((project) =>
        project.projectId === projectId
          ? { ...project, modelState: selectProjectDefinition(project.modelState, definitionId) }
          : project,
      ),
    })
  }

  clearRecent(): void {
    for (const descriptor of this.recent) void this.#release(descriptor.source)
    this.recent = []
    this.#persist()
  }

  dispose(): void {
    this.#loadTokens.clear()
    this.#projectLoadTokens.clear()
    this.developmentNavigationById = {}
    for (const id of this.#workspaceWatches.keys()) this.#stopWorkspaceWatch(id)
  }

  async #release(source: WorkbenchSourceRef): Promise<void> {
    try {
      await this.#services.releaseWorkbenchSource(source)
    } catch {
      // Releasing an unreachable provider resource is best-effort and must not block UI changes.
    }
  }

  #developmentEntryWithData(id: WorkbenchId): DevelopmentEntryWithData | null {
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    return isDevelopmentEntryWithData(entry) ? entry : null
  }

  #readyDevelopmentEntry(
    id: WorkbenchId,
  ): Extract<
    WorkbenchEntry,
    { readonly status: 'ready'; readonly data: DevelopmentWorkbenchData }
  > | null {
    const entry = this.#developmentEntryWithData(id)
    return entry?.status === 'ready' ? entry : null
  }

  async #loadDevelopmentProject(
    id: WorkbenchId,
    descriptor: DevelopmentWorkbenchDescriptor,
    projectId: string,
  ): Promise<void> {
    const token = {}
    const tokens = this.#projectLoadTokens.get(id) ?? new SvelteMap<string, object>()
    tokens.set(projectId, token)
    this.#projectLoadTokens.set(id, tokens)
    const previous =
      this.developmentNavigation(id).projects.find((project) => project.projectId === projectId)
        ?.modelState ?? unloadedProjectModel()
    this.#replaceDevelopmentProject(id, {
      projectId,
      modelState: beginProjectModelLoad(previous),
    })

    try {
      const model = await this.#services.loadDevelopmentProjectModel(descriptor, projectId)
      if (!this.#isCurrentProjectLoad(id, projectId, token)) return
      const entry = this.#readyDevelopmentEntry(id)
      const current = this.developmentNavigation(id).projects.find(
        (project) => project.projectId === projectId,
      )
      if (!entry) {
        this.#replaceDevelopmentProject(id, {
          projectId,
          modelState: failProjectModelLoad(current?.modelState ?? unloadedProjectModel(), {
            tag: 'load-failed',
            message: 'Project model loading was interrupted by a Workbench reload',
          }),
        })
        return
      }
      if (!entry.data.snapshot.projects.some((project) => project.id === projectId)) return
      this.#replaceDevelopmentProject(id, {
        projectId,
        modelState: completeProjectModelLoad(current?.modelState ?? unloadedProjectModel(), model),
      })
    } catch (error) {
      if (!this.#isCurrentProjectLoad(id, projectId, token)) return
      const current = this.developmentNavigation(id).projects.find(
        (project) => project.projectId === projectId,
      )
      this.#replaceDevelopmentProject(id, {
        projectId,
        modelState: failProjectModelLoad(
          current?.modelState ?? unloadedProjectModel(),
          recoveryReasonOf(error),
        ),
      })
    } finally {
      if (this.#isCurrentProjectLoad(id, projectId, token)) {
        const currentTokens = this.#projectLoadTokens.get(id)
        currentTokens?.delete(projectId)
        if (currentTokens?.size === 0) this.#projectLoadTokens.delete(id)
      }
    }
  }

  #isCurrentProjectLoad(id: WorkbenchId, projectId: string, token: object): boolean {
    return this.#projectLoadTokens.get(id)?.get(projectId) === token
  }

  #replaceDevelopmentProject(id: WorkbenchId, entry: DevelopmentProjectModelEntry): void {
    const navigation = this.developmentNavigation(id)
    const exists = navigation.projects.some((project) => project.projectId === entry.projectId)
    this.#setDevelopmentNavigation(id, {
      ...navigation,
      projects: exists
        ? navigation.projects.map((project) =>
            project.projectId === entry.projectId ? entry : project,
          )
        : [...navigation.projects, entry],
    })
  }

  #setDevelopmentNavigation(id: WorkbenchId, state: DevelopmentNavigationState): void {
    this.developmentNavigationById = { ...this.developmentNavigationById, [id]: state }
  }

  #removeDevelopmentNavigation(id: WorkbenchId): void {
    this.developmentNavigationById = Object.fromEntries(
      Object.entries(this.developmentNavigationById).filter(([candidate]) => candidate !== id),
    )
  }

  #reconcileDevelopmentNavigation(id: WorkbenchId, projectIds: ReadonlyArray<string>): void {
    const navigation = this.developmentNavigationById[id]
    if (!navigation) return
    const projects = navigation.projects.filter((project) => projectIds.includes(project.projectId))
    const activeProjectId =
      navigation.activeProjectId && projectIds.includes(navigation.activeProjectId)
        ? navigation.activeProjectId
        : null
    this.#setDevelopmentNavigation(id, { activeProjectId, projects })
    const tokens = this.#projectLoadTokens.get(id)
    if (!tokens) return
    for (const projectId of tokens.keys()) {
      if (!projectIds.includes(projectId)) tokens.delete(projectId)
    }
    if (tokens.size === 0) this.#projectLoadTokens.delete(id)
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
      if (currentDescriptor.kind === 'model' && data.kind === 'model') {
        this.#replace(descriptor.id, {
          descriptor: currentDescriptor,
          status: 'ready',
          data: { ...data, descriptor: currentDescriptor },
        })
      } else if (currentDescriptor.kind === 'development' && data.kind === 'development') {
        this.#replace(descriptor.id, {
          descriptor: currentDescriptor,
          status: 'ready',
          data: { ...data, descriptor: currentDescriptor },
        })
        this.#reconcileDevelopmentNavigation(
          descriptor.id,
          data.snapshot.projects.map((project) => project.id),
        )
        this.#startWorkspaceWatch(currentDescriptor)
      } else {
        this.#replace(descriptor.id, {
          descriptor: currentDescriptor,
          status: 'error',
          reason: {
            tag: 'load-failed',
            message: 'Workbench provider returned data for a different Workbench kind',
          },
        })
      }
    } catch (error) {
      const current = this.openEntries.find((entry) => entry.descriptor.id === descriptor.id)
      if (this.#loadTokens.get(descriptor.id) !== token || !current) return
      if (current.status === 'unavailable') {
        this.#markWorkspaceUnavailable(descriptor.id, recoveryReasonOf(error))
        return
      }
      this.#replace(descriptor.id, {
        descriptor: current.descriptor,
        status: 'error',
        reason: recoveryReasonOf(error),
      })
    } finally {
      if (this.#loadTokens.get(descriptor.id) === token) this.#loadTokens.delete(descriptor.id)
    }
  }

  #startWorkspaceWatch(descriptor: Extract<WorkbenchDescriptor, { kind: 'development' }>): void {
    const id = descriptor.id
    const token = {}
    this.#workspaceWatchTokens.set(id, token)
    const watch = Effect.runFork(
      Stream.runForEach(this.#services.workspaceEvents(descriptor), (event) =>
        Effect.sync(() => {
          if (this.#workspaceWatchTokens.get(id) === token) {
            this.#applyWorkspaceEvent(id, event)
          }
        }),
      ).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (this.#workspaceWatchTokens.get(id) === token) {
              this.#markWorkspaceUnavailable(id, recoveryReasonOf(error))
            }
          }),
        ),
      ),
    )
    this.#workspaceWatches.set(id, watch)
    watch.addObserver(() => {
      if (this.#workspaceWatches.get(id) === watch) {
        this.#workspaceWatches.delete(id)
        if (this.#workspaceWatchTokens.get(id) === token) this.#workspaceWatchTokens.delete(id)
      }
    })
  }

  #applyWorkspaceEvent(id: WorkbenchId, event: WorkspaceEvent): void {
    if (event.tag === 'provider-disconnected') {
      this.#markWorkspaceUnavailable(id, {
        tag: 'provider-disconnected',
        message: event.message,
      })
      return
    }
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    if (!entry || entry.descriptor.kind !== 'development') return
    if (entry.status === 'error' || entry.status === 'unavailable') {
      this.#replace(id, {
        descriptor: entry.descriptor,
        status: 'ready',
        data: { kind: 'development', descriptor: entry.descriptor, snapshot: event.snapshot },
      })
      this.#reconcileDevelopmentNavigation(
        id,
        event.snapshot.projects.map((project) => project.id),
      )
      return
    }
    const ready = this.#readyDevelopmentEntry(id)
    if (!ready) return
    this.#replace(id, {
      descriptor: ready.descriptor,
      status: 'ready',
      data: { ...ready.data, snapshot: event.snapshot },
    })
    this.#reconcileDevelopmentNavigation(
      id,
      event.snapshot.projects.map((project) => project.id),
    )
  }

  #markWorkspaceUnavailable(id: WorkbenchId, reason: WorkbenchRecoveryReason): void {
    const entry = this.openEntries.find((candidate) => candidate.descriptor.id === id)
    if (!entry) return
    if (
      entry.descriptor.kind === 'development' &&
      (entry.status === 'ready' || entry.status === 'unavailable') &&
      entry.data.kind === 'development'
    ) {
      this.#replace(id, {
        descriptor: entry.descriptor,
        status: 'unavailable',
        data: entry.data,
        reason,
      })
      return
    }
    this.#replace(id, { descriptor: entry.descriptor, status: 'error', reason })
  }

  #stopWorkspaceWatch(id: WorkbenchId): void {
    this.#workspaceWatchTokens.delete(id)
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
