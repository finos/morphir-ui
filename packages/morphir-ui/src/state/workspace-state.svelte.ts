import { Cause, Effect, Exit, Option } from 'effect'
import { decodeMorphirIr, toWorkspaceIr, type WorkspaceIr } from '@morphir/ir'
import type { AppServices, WorkspaceRef } from '../services/services.ts'

export interface OpenWorkspace {
  readonly ref: WorkspaceRef
  readonly ir: WorkspaceIr
}

const MAX_RECENTS = 8

export class WorkspaceState {
  current = $state<OpenWorkspace | null>(null)
  error = $state<string | null>(null)
  recents = $state<ReadonlyArray<string>>([])
  loading = $state(false)
  readonly #services: AppServices

  constructor(services: AppServices, initialRecents: ReadonlyArray<string> = []) {
    this.#services = services
    this.recents = initialRecents
  }

  async openPicked(): Promise<void> {
    try {
      const picked = await this.#services.pickWorkspace()
      if (picked) await this.#ingest(picked.ref, picked.content)
    } catch (e) {
      this.current = null
      this.error = e instanceof Error ? e.message : String(e)
    }
  }

  async reopen(path: string): Promise<void> {
    const read = this.#services.readWorkspace
    if (!read) return
    try {
      await this.#ingest({ path }, await read({ path }))
    } catch (e) {
      this.current = null
      this.error = e instanceof Error ? e.message : String(e)
    }
  }

  async #ingest(ref: WorkspaceRef, content: string): Promise<void> {
    this.loading = true
    const exit = await Effect.runPromiseExit(decodeMorphirIr(content))
    this.loading = false
    if (Exit.isSuccess(exit)) {
      this.current = { ref, ir: toWorkspaceIr(exit.value) }
      this.error = null
      this.recents = [ref.path, ...this.recents.filter((p) => p !== ref.path)].slice(0, MAX_RECENTS)
      const cfg = await this.#services.loadConfig()
      await this.#services.saveConfig({
        ...cfg,
        workspace: { ...cfg.workspace, recent: this.recents, active: ref.path },
      })
    } else {
      this.current = null
      const failure = Cause.failureOption(exit.cause)
      this.error = Option.isSome(failure) ? failure.value.message : 'Failed to decode workspace IR'
    }
  }
}
