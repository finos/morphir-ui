<script lang="ts">
  // The try-morphir experience with the frontend and the generation target chosen at run
  // time instead of fixed at build time: pick a source language, type source, compile it
  // to IR, inspect the IR, pick a target, take the artifacts away.
  import { onMount, untrack } from 'svelte'
  import { Effect } from 'effect'
  import {
    decodeEntryValueDef,
    decodeMorphirIr,
    nameToCamel,
    nameToTitle,
    pathToTitle,
    toWorkspaceIr,
    type DefinitionInfo,
    type MorphirLibrary,
    type RawDefEntry,
    type WorkspaceIr,
  } from '@morphir/ir'
  import type { PlaygroundArtifact, PlaygroundDiagnostic } from '@morphir/workspace'
  import CodeEditor from '../../components/editor/CodeEditor.svelte'
  import RegionPanel from '../../shell/RegionPanel.svelte'
  import ResizeHandle from '../../shell/ResizeHandle.svelte'
  import DetailTabs from '../insight/DetailTabs.svelte'
  import InsightView from '../insight/InsightView.svelte'
  import XRayView from '../insight/XRayView.svelte'
  import type { InspectMeta } from '../insight/insight-context.ts'
  import { definitionNodeId } from '../model-tree/model-tree.ts'
  import type { AppServices } from '../../services/services.ts'
  import {
    PlaygroundState,
    capabilityDetail,
    capabilityLabel,
    editorDiagnosticsFor,
    playgroundPackage,
    preferredIrVersion,
    targetRefusalReason,
  } from './playground-state.svelte.ts'

  let {
    services,
    onClose,
    onInspect,
  }: {
    services: AppServices
    onClose?: () => void
    onInspect?: (meta: InspectMeta) => void
  } = $props()

  const SOURCE_BOUNDS = { min: 320, max: 720 }
  const OUTPUT_BOUNDS = { min: 260, max: 520 }
  const SAVE_DEBOUNCE_MS = 200

  const playground = untrack(() => new PlaygroundState())
  // Derived rather than captured: `services` is a prop, and a host may hand over a
  // different facade (one that has gained or lost its pipeline) without remounting.
  const pipeline = $derived(services.pipeline)

  let sourceWidth = $state(460)
  let outputWidth = $state(320)
  let activeTab = $state('insight')
  let chosenDefinitionId = $state<string | null>(null)
  let failure = $state<string | null>(null)
  // Guards the save effect: writing before loadConfig lands would overwrite a previous
  // session's documents with the freshly constructed sample.
  let hydrated = $state(false)

  const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  /** Three classes for three answers. Unknown must not share a class — or a colour —
   * with a refusal. */
  const capabilityClassOf = (value: boolean | null): string =>
    value === null ? 'capability-unknown' : value ? 'capability-yes' : 'capability-no'

  const selectedFrontend = $derived(
    playground.catalog.frontends.find(
      (entry) => entry.languageId === playground.selectedLanguageId,
    ) ?? null,
  )
  const selectedTargetEntry = $derived(
    playground.catalog.targets.find((entry) => entry.target === playground.selectedTarget) ?? null,
  )
  const refusals = $derived(
    selectedFrontend === null
      ? []
      : playground.catalog.targets
          .map((entry) => ({ entry, reason: targetRefusalReason(selectedFrontend, entry) }))
          .filter(
            (candidate): candidate is { entry: (typeof candidate)['entry']; reason: string } =>
              candidate.reason !== null,
          ),
  )
  const refusalFor = (target: string): string | null =>
    refusals.find((refusal) => refusal.entry.target === target)?.reason ?? null

  const busy = $derived(playground.status === 'compiling' || playground.status === 'generating')
  const canCompile = $derived(pipeline !== null && selectedFrontend !== null && !busy)
  const compiledIr = $derived(playground.compileResult?.ir ?? null)
  const canGenerate = $derived(
    pipeline !== null &&
      !busy &&
      compiledIr !== null &&
      playground.compileResult?.success === true &&
      selectedTargetEntry !== null &&
      refusalFor(selectedTargetEntry.target) === null,
  )

  const diagnostics = $derived<ReadonlyArray<PlaygroundDiagnostic>>([
    ...(playground.compileResult?.diagnostics ?? []),
    ...(playground.generateResult?.diagnostics ?? []),
  ])
  const editorDiagnostics = $derived(
    playground.activeDocument
      ? editorDiagnosticsFor(diagnostics, playground.activeDocument.uri)
      : [],
  )

  // The exact sequence connected-provider.ts uses to turn wire IR into something the
  // Insight and XRay views render: decodeMorphirIr for the library, toWorkspaceIr for the
  // navigable summary. Failure is a value here rather than a defect, because a frontend
  // can legitimately emit an IR version this UI cannot read yet.
  const decoded = $derived.by(
    (): { library: MorphirLibrary; workspace: WorkspaceIr } | { error: string } | null => {
      if (compiledIr === null) return null
      return Effect.runSync(
        decodeMorphirIr(JSON.stringify(compiledIr)).pipe(
          Effect.map((library) => ({ library, workspace: toWorkspaceIr(library) })),
          Effect.catchAll((error) => Effect.succeed({ error: error.message })),
        ),
      )
    },
  )
  const library = $derived(decoded !== null && 'library' in decoded ? decoded.library : null)
  const workspace = $derived(decoded !== null && 'workspace' in decoded ? decoded.workspace : null)
  const decodeError = $derived(decoded !== null && 'error' in decoded ? decoded.error : null)
  const valueDefinitions = $derived(
    workspace?.definitions.filter((definition) => definition.kind === 'value') ?? [],
  )
  const currentDefinition = $derived(
    valueDefinitions.find((definition) => definitionNodeId(definition) === chosenDefinitionId) ??
      valueDefinitions[0] ??
      null,
  )
  const currentDef = $derived.by(() => {
    if (library === null || currentDefinition === null) return null
    const entry = findEntry(library, currentDefinition)
    return entry ? decodeEntryValueDef(entry) : null
  })
  const irJson = $derived(compiledIr === null ? '' : JSON.stringify(compiledIr, null, 2))

  function findEntry(lib: MorphirLibrary, info: DefinitionInfo): RawDefEntry | null {
    if (pathToTitle(lib.packageName) !== info.ref.packageName) return null
    for (const module of lib.modules) {
      if (pathToTitle(module.path) !== info.ref.moduleName) continue
      const entries = info.kind === 'type' ? module.types : module.values
      for (const entry of entries) {
        const display = info.kind === 'type' ? nameToTitle(entry.name) : nameToCamel(entry.name)
        if (display === info.ref.localName) return entry
      }
    }
    return null
  }

  onMount(() => {
    let cancelled = false
    void (async () => {
      // A config that cannot be read is not a reason to refuse the Playground: fall
      // through to the freshly constructed sample and let saving proceed from there.
      try {
        const config = await services.loadConfig()
        if (cancelled) return
        playground.hydrate(config.playground)
      } catch (error) {
        if (cancelled) return
        failure = messageOf(error)
      }
      hydrated = true
      if (!pipeline) return
      try {
        const catalog = await pipeline.catalog()
        if (cancelled) return
        playground.catalog = catalog
        // A persisted (or default) language the live session does not offer would leave
        // every action disabled with no explanation, so fall back to the first frontend
        // this session actually has.
        const known = catalog.frontends.some(
          (entry) => entry.languageId === playground.selectedLanguageId,
        )
        const first = catalog.frontends[0]
        if (!known && first) playground.selectFrontend(first.languageId)
      } catch (error) {
        if (!cancelled) failure = messageOf(error)
      }
    })()
    return () => {
      cancelled = true
    }
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    if (!hydrated) return
    const snap = playground.snapshot()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void services.updateConfig((config) => ({ ...config, playground: snap }))
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimer)
  })

  function chooseFrontend(languageId: string): void {
    playground.selectFrontend(languageId)
  }

  function chooseTarget(target: string): void {
    if (target === '') playground.selectedTarget = null
    else playground.selectTarget(target)
  }

  // Explicit, never on a keystroke or a debounce: a compile here may start an extension
  // process, unlike try-morphir's in-process compile. Automatic compilation only becomes
  // reasonable once session reuse lands, which is a separate change.
  async function compile(): Promise<void> {
    const frontend = selectedFrontend
    if (!pipeline || frontend === null) return
    failure = null
    playground.status = 'compiling'
    try {
      const result = await pipeline.compile({
        languageId: frontend.languageId,
        // The frontend's language id, not each document's stored one: the persisted
        // document keeps whatever language it was created under, while the wire payload
        // has to describe the frontend this compile is actually addressed to.
        documents: playground.documents.map((doc) => ({
          uri: doc.uri,
          languageId: frontend.languageId,
          version: doc.version,
          text: doc.text,
        })),
        package: playgroundPackage(playground.activeDocument?.text ?? ''),
        irVersion: preferredIrVersion(frontend, selectedTargetEntry),
        options: {},
      })
      playground.compileResult = result
      playground.generateResult = null
      playground.status = result.success ? 'idle' : 'error'
    } catch (error) {
      failure = messageOf(error)
      playground.status = 'error'
    }
  }

  async function generate(): Promise<void> {
    const target = selectedTargetEntry
    if (!pipeline || target === null || compiledIr === null) return
    failure = null
    playground.status = 'generating'
    try {
      const result = await pipeline.generate({
        ir: compiledIr,
        irVersion: playground.compileResult?.irVersion ?? '',
        target: target.target,
        options: {},
      })
      playground.generateResult = result
      playground.status = result.success ? 'idle' : 'error'
    } catch (error) {
      failure = messageOf(error)
      playground.status = 'error'
    }
  }

  function artifactBlob(artifact: PlaygroundArtifact): Blob {
    if (!artifact.binary) return new Blob([artifact.content], { type: 'text/plain' })
    const binary = atob(artifact.content)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new Blob([bytes], { type: 'application/octet-stream' })
  }

  function download(artifact: PlaygroundArtifact): void {
    if (typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(artifactBlob(artifact))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = artifact.path.split('/').at(-1) ?? artifact.path
    anchor.click()
    URL.revokeObjectURL(url)
  }
</script>

<section class="playground">
  <RegionPanel region="left" extent={sourceWidth}>
    <div class="pane source-pane">
      <header class="pane-head">
        <span class="pane-title">Source</span>
        {#if onClose}
          <button type="button" class="link" onclick={onClose}>Back to workspace</button>
        {/if}
      </header>

      {#if pipeline === null}
        <p class="notice" role="status">
          This session has no compilation pipeline, so the Playground cannot compile or generate
          here. Launch the desktop or CLI-hosted UI, which connects to a Morphir session that
          provides one.
        </p>
      {/if}

      <div class="field">
        <label for="playground-frontend">Source language</label>
        <select
          id="playground-frontend"
          value={playground.selectedLanguageId}
          disabled={pipeline === null}
          onchange={(event) => chooseFrontend(event.currentTarget.value)}
        >
          {#each playground.catalog.frontends as entry (entry.languageId)}
            <option value={entry.languageId}>{entry.languageId} — {entry.displayName}</option>
          {/each}
        </select>
      </div>

      {#if selectedFrontend}
        <dl class="capabilities">
          <div>
            <dt>Compile</dt>
            <dd
              data-testid="capability-compile"
              class="capability {capabilityClassOf(selectedFrontend.compile)}"
              title={capabilityDetail(selectedFrontend.compile)}
            >
              {capabilityLabel(selectedFrontend.compile)}
            </dd>
          </div>
          <div>
            <dt>Incremental</dt>
            <dd
              data-testid="capability-incremental"
              class="capability {capabilityClassOf(selectedFrontend.incremental)}"
              title={capabilityDetail(selectedFrontend.incremental)}
            >
              {capabilityLabel(selectedFrontend.incremental)}
            </dd>
          </div>
          <div>
            <dt>Fragments</dt>
            <dd
              data-testid="capability-fragments"
              class="capability {capabilityClassOf(selectedFrontend.fragments)}"
              title={capabilityDetail(selectedFrontend.fragments)}
            >
              {capabilityLabel(selectedFrontend.fragments)}
            </dd>
          </div>
        </dl>
      {/if}

      <div class="editor">
        <CodeEditor
          value={playground.activeDocument?.text ?? ''}
          languageId={playground.selectedLanguageId}
          diagnostics={editorDiagnostics}
          onChange={(text) => playground.updateActiveDocument(text)}
        />
      </div>

      <div class="actions">
        <button type="button" onclick={() => void compile()} disabled={!canCompile}>
          {playground.status === 'compiling' ? 'Compiling…' : 'Compile'}
        </button>
        {#if playground.compileResult}
          <span class="result-note">
            {playground.compileResult.success
              ? `Compiled ${playground.compileResult.modules.length} module(s) as IR ${playground.compileResult.irVersion ?? 'unknown'}`
              : 'Compilation failed'}
          </span>
        {/if}
      </div>

      {#if failure}
        <p class="failure" role="alert">{failure}</p>
      {/if}

      <ul class="diagnostics" data-testid="diagnostics">
        {#each diagnostics as diagnostic, index (`${index}-${diagnostic.message}`)}
          <li class="diagnostic diagnostic-{diagnostic.severity}">
            <span class="severity">{diagnostic.severity}</span>
            {#if diagnostic.code}<span class="code">{diagnostic.code}</span>{/if}
            <span class="message">{diagnostic.message}</span>
            {#if diagnostic.location}
              <span class="where"
                >{diagnostic.location.uri}:{diagnostic.location.range.start.line + 1}</span
              >
            {/if}
          </li>
        {:else}
          <li class="empty">No diagnostics</li>
        {/each}
      </ul>
    </div>
  </RegionPanel>

  <ResizeHandle
    edge="left"
    label="Resize Playground source"
    min={SOURCE_BOUNDS.min}
    max={SOURCE_BOUNDS.max}
    currentSize={sourceWidth}
    onResize={(px) => (sourceWidth = px)}
  />

  <div class="pane center-pane">
    <DetailTabs
      tabs={[
        { id: 'insight', label: 'Insight' },
        { id: 'xray', label: 'XRay' },
        { id: 'json', label: 'IR JSON' },
      ]}
      active={activeTab}
      onSelect={(id) => (activeTab = id)}
    />

    {#if compiledIr === null}
      <p class="empty">Compile to see the IR.</p>
    {:else if activeTab === 'json'}
      <pre class="ir-json" data-testid="ir-json">{irJson}</pre>
    {:else if decodeError}
      <p class="failure" role="alert">{decodeError}</p>
    {:else if library && workspace}
      <div class="field">
        <label for="playground-definition">Definition</label>
        <select
          id="playground-definition"
          value={currentDefinition ? definitionNodeId(currentDefinition) : ''}
          onchange={(event) => (chosenDefinitionId = event.currentTarget.value)}
        >
          {#each valueDefinitions as definition (definitionNodeId(definition))}
            <option value={definitionNodeId(definition)}>
              {definition.ref.moduleName}.{definition.ref.localName}
            </option>
          {/each}
        </select>
        <span class="summary">{workspace.package.name} · {workspace.modules.length} module(s)</span>
      </div>
      <div class="detail">
        {#if activeTab === 'insight'}
          <InsightView def={currentDef} {library} onSelect={onInspect} />
        {:else}
          <XRayView def={currentDef} />
        {/if}
      </div>
    {/if}
  </div>

  <ResizeHandle
    edge="right"
    label="Resize Playground output"
    min={OUTPUT_BOUNDS.min}
    max={OUTPUT_BOUNDS.max}
    currentSize={outputWidth}
    onResize={(px) => (outputWidth = px)}
  />

  <RegionPanel region="right" extent={outputWidth}>
    <div class="pane target-pane">
      <span class="pane-title">Target</span>

      <div class="field">
        <label for="playground-target">Generation target</label>
        <select
          id="playground-target"
          value={playground.selectedTarget ?? ''}
          disabled={pipeline === null}
          onchange={(event) => chooseTarget(event.currentTarget.value)}
        >
          <option value="">Choose a target…</option>
          {#each playground.catalog.targets as entry (entry.target)}
            {@const refusal = refusalFor(entry.target)}
            <!-- An incompatible target is disabled, never hidden: a vanished target
                 teaches nothing, a disabled one names the version mismatch. -->
            <option value={entry.target} disabled={refusal !== null} title={refusal ?? undefined}>
              {entry.displayName}{refusal === null ? '' : ' (unavailable)'}
            </option>
          {/each}
        </select>
      </div>

      {#if refusals.length > 0}
        <!-- Repeated in the open, because a disabled <option>'s title is not reachable by
             keyboard or screen reader in most browsers. -->
        <ul class="refusals" data-testid="target-refusals">
          {#each refusals as refusal (refusal.entry.target)}
            <li>{refusal.reason}</li>
          {/each}
        </ul>
      {/if}

      <div class="actions">
        <button type="button" onclick={() => void generate()} disabled={!canGenerate}>
          {playground.status === 'generating' ? 'Generating…' : 'Generate'}
        </button>
      </div>

      <span class="pane-title">Artifacts</span>
      <ul class="artifacts">
        {#each playground.generateResult?.artifacts ?? [] as artifact (artifact.path)}
          <li>
            <span class="artifact-path">{artifact.path}</span>
            <button
              type="button"
              class="link"
              aria-label={`Download ${artifact.path}`}
              onclick={() => download(artifact)}>Download</button
            >
          </li>
        {:else}
          <li class="empty">No artifacts yet</li>
        {/each}
      </ul>
    </div>
  </RegionPanel>
</section>

<style>
  .playground {
    display: flex;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    overflow: auto;
  }
  .center-pane {
    background: var(--bg);
  }
  .pane-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .pane-title {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field label {
    font-size: 11px;
    color: var(--muted2);
  }
  .field select {
    padding: 6px 8px;
    border: 1px solid var(--panel-edge);
    border-radius: 7px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 12.5px;
  }
  .summary {
    font-size: 11px;
    color: var(--muted2);
  }
  .capabilities {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0;
  }
  .capabilities div {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .capabilities dt {
    font-size: 11px;
    color: var(--muted2);
  }
  .capabilities dd {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
  }
  .capability-yes {
    color: var(--accent2);
  }
  .capability-no {
    color: var(--status-error);
  }
  /* Deliberately neither the "yes" nor the "no" colour: an undeterminable capability is
     a third answer, and must not read as a refusal. */
  .capability-unknown {
    color: var(--muted);
    font-style: italic;
  }
  .editor {
    flex: 1;
    min-height: 200px;
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    overflow: hidden;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions button {
    padding: 6px 12px;
    border: 1px solid var(--panel-edge);
    border-radius: 7px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .actions button:disabled {
    color: var(--muted2);
    cursor: not-allowed;
  }
  .result-note {
    font-size: 11.5px;
    color: var(--muted);
  }
  .link {
    border: 0;
    padding: 0;
    color: var(--accent-text);
    background: none;
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .notice {
    margin: 0;
    padding: 10px;
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    color: var(--muted);
    background: var(--panel);
    font-size: 12px;
  }
  .failure {
    margin: 0;
    color: var(--status-error);
    font-size: 12px;
  }
  .diagnostics,
  .refusals,
  .artifacts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .diagnostic {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 11.5px;
    color: var(--text);
  }
  .severity {
    font-family: var(--mono);
    font-size: 10px;
    text-transform: uppercase;
    color: var(--muted2);
  }
  .diagnostic-error .severity {
    color: var(--status-error);
  }
  .code {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--muted2);
  }
  .where {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--muted2);
  }
  .refusals li {
    font-size: 11.5px;
    color: var(--muted);
  }
  .artifacts li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }
  .artifact-path {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--text);
    word-break: break-all;
  }
  .ir-json {
    flex: 1;
    margin: 0;
    padding: 10px;
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    background: var(--code-bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: 11.5px;
    overflow: auto;
  }
  .detail {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .empty {
    color: var(--muted2);
    font-size: 11.5px;
  }
</style>
