# Workspace provider contracts implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Morphir UI provider-qualified Workbench sources, immutable multi-project workspace snapshots, and Effect contracts that local and connected hosts can implement without changing the shared UI.

**Architecture:** Add a pure `@morphir/workspace` package for serializable provider, workspace, project, diagnostic, and event types. Migrate existing Workbench descriptors from string sources to `WorkbenchSourceRef`, then extend the Effect services with provider enumeration, project-model loading, and workspace event streams. Existing desktop and browser implementations receive temporary single-root adapters so this contract can land before full discovery.

**Tech Stack:** TypeScript 7, Effect Schema and Stream, Svelte 5 runes, bun test, Vitest, moonrepo, Electron RPC.

**Spec:** `docs/specs/2026-08-29-multi-project-workspace-design.md`

**Bead:** `morphir-ui-irf.2`

---

## Scope and constraints

This plan changes `finos/morphir-ui` only. It does not implement member globbing, WebAssembly, the CLI loopback server, or the final project tree.

- Run every command from the `finos/morphir-ui` checkout.
- Write a failing test before each implementation change.
- Every commit uses `git commit -s`, names Damian Reeves only, and contains no AI attribution.
- Keep `@morphir/workspace` free of Svelte and DOM dependencies.

## End-state files

```text
packages/morphir-workspace/
├── package.json
├── moon.yml
├── tsconfig.json
├── src/index.ts
├── src/model.ts
└── test/model.test.ts
```

Existing `@morphir/ui`, desktop, and web files are changed only enough to consume the contract.

### Task 1: Add the pure workspace model package

**Files:**

- Create: `packages/morphir-workspace/package.json`
- Create: `packages/morphir-workspace/moon.yml`
- Create: `packages/morphir-workspace/tsconfig.json`
- Create: `packages/morphir-workspace/src/model.ts`
- Create: `packages/morphir-workspace/src/index.ts`
- Create: `packages/morphir-workspace/test/model.test.ts`

- [ ] **Step 1: Write the failing model tests**

Create `packages/morphir-workspace/test/model.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { WorkspaceSnapshotSchema, sourceKey, type WorkbenchSourceRef } from '../src/index.ts'

const browser: WorkbenchSourceRef = {
  providerId: 'browser-local',
  locator: 'directory:orders',
  displayName: 'orders',
}

test('provider identity participates in source identity', () => {
  expect(sourceKey(browser)).not.toBe(sourceKey({ ...browser, providerId: 'cli:session-1' }))
})

describe('WorkspaceSnapshotSchema', () => {
  test('decodes independently identified projects', () => {
    const snapshot = Schema.decodeUnknownSync(WorkspaceSnapshotSchema)({
      id: sourceKey(browser),
      root: browser,
      name: 'orders-workspace',
      configAnchor: 'morphir.toml',
      state: 'open',
      projects: [
        {
          id: 'packages/orders',
          name: 'acme/orders',
          version: '1.0.0',
          relativePath: 'packages/orders',
          configAnchor: 'packages/orders/morphir.toml',
          sourceDirectory: 'src',
          state: 'unloaded',
          modelSources: [],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      ],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    })
    expect(snapshot.projects[0]?.id).toBe('packages/orders')
    expect(snapshot.root).toEqual(browser)
  })

  test('rejects an unknown lifecycle state', () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkspaceSnapshotSchema)({
        id: 'bad',
        root: browser,
        name: null,
        configAnchor: null,
        state: 'running',
        projects: [],
        modelSources: [],
        knowledgeBaseSources: [],
        diagnostics: [],
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Confirm RED**

Run `bun test packages/morphir-workspace/test/model.test.ts`.

Expected: failure because `src/index.ts` does not exist.

- [ ] **Step 3: Add package metadata**

Create `packages/morphir-workspace/package.json`:

```json
{
  "name": "@morphir/workspace",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "build": "tsc --noEmit"
  },
  "dependencies": { "effect": "^3.22.1" },
  "devDependencies": { "bun-types": "^1.4.0", "typescript": "7.0.2" }
}
```

Create `packages/morphir-workspace/moon.yml`:

```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'
layer: 'library'
language: 'typescript'
```

Create `packages/morphir-workspace/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["bun-types"], "allowImportingTsExtensions": true },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Implement the model**

Create `packages/morphir-workspace/src/model.ts`:

```ts
import { Schema } from 'effect'

export const WorkbenchSourceRefSchema = Schema.Struct({
  providerId: Schema.String,
  locator: Schema.String,
  displayName: Schema.String,
})
export type WorkbenchSourceRef = Schema.Schema.Type<typeof WorkbenchSourceRefSchema>

export const WorkspaceStateSchema = Schema.Literal('closed', 'initializing', 'open', 'error')
export type WorkspaceState = Schema.Schema.Type<typeof WorkspaceStateSchema>
export const ProjectStateSchema = Schema.Literal('unloaded', 'loading', 'ready', 'stale', 'error')
export type ProjectState = Schema.Schema.Type<typeof ProjectStateSchema>

export const WorkspaceDiagnosticSchema = Schema.Struct({
  severity: Schema.Literal('info', 'warning', 'error'),
  code: Schema.NullOr(Schema.String),
  message: Schema.String,
  path: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
})
export type WorkspaceDiagnostic = Schema.Schema.Type<typeof WorkspaceDiagnosticSchema>

export const ProjectSnapshotSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.NullOr(Schema.String),
  relativePath: Schema.String,
  configAnchor: Schema.NullOr(Schema.String),
  sourceDirectory: Schema.String,
  state: ProjectStateSchema,
  modelSources: Schema.Array(WorkbenchSourceRefSchema),
  knowledgeBaseSources: Schema.Array(WorkbenchSourceRefSchema),
  diagnostics: Schema.Array(WorkspaceDiagnosticSchema),
})
export type ProjectSnapshot = Schema.Schema.Type<typeof ProjectSnapshotSchema>

export const WorkspaceSnapshotSchema = Schema.Struct({
  id: Schema.String,
  root: WorkbenchSourceRefSchema,
  name: Schema.NullOr(Schema.String),
  configAnchor: Schema.NullOr(Schema.String),
  state: WorkspaceStateSchema,
  projects: Schema.Array(ProjectSnapshotSchema),
  modelSources: Schema.Array(WorkbenchSourceRefSchema),
  knowledgeBaseSources: Schema.Array(WorkbenchSourceRefSchema),
  diagnostics: Schema.Array(WorkspaceDiagnosticSchema),
})
export type WorkspaceSnapshot = Schema.Schema.Type<typeof WorkspaceSnapshotSchema>

export const WorkbenchCapabilitySchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
})
export type WorkbenchCapability = Schema.Schema.Type<typeof WorkbenchCapabilitySchema>
export const WorkbenchProviderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literal('local', 'connected'),
  status: Schema.Literal('available', 'disconnected'),
  capabilities: Schema.Array(WorkbenchCapabilitySchema),
})
export type WorkbenchProvider = Schema.Schema.Type<typeof WorkbenchProviderSchema>

export const WorkspaceEventSchema = Schema.Union(
  Schema.Struct({ tag: Schema.Literal('snapshot'), snapshot: WorkspaceSnapshotSchema }),
  Schema.Struct({
    tag: Schema.Literal('provider-disconnected'),
    providerId: Schema.String,
    message: Schema.String,
  }),
)
export type WorkspaceEvent = Schema.Schema.Type<typeof WorkspaceEventSchema>

export const WORKBENCH_CAPABILITIES = {
  modelOpen: 'morphir/model/open',
  developmentInspect: 'morphir/development/inspect',
  workspaceOpen: 'morphir/workspace/open',
  workspaceWatch: 'morphir/workspace/watch',
} as const

export const sourceKey = (source: WorkbenchSourceRef): string =>
  JSON.stringify([source.providerId, source.locator])
```

Create `packages/morphir-workspace/src/index.ts`:

```ts
export * from './model.ts'
```

- [ ] **Step 5: Confirm GREEN and commit**

```bash
bun test packages/morphir-workspace/test/model.test.ts
moon run morphir-workspace:lint morphir-workspace:typecheck morphir-workspace:build
git add packages/morphir-workspace
git commit -s -m "feat(workspace): define provider snapshot model"
```

Expected: all checks pass before the commit.

### Task 2: Migrate persisted descriptors to source references

**Files:**

- Modify: `packages/morphir-ui/package.json`
- Modify: `packages/morphir-ui/src/workbench/types.ts`
- Modify: `packages/morphir-ui/src/services/config.ts`
- Modify: `packages/morphir-ui/test/workbench-config.test.ts`
- Modify: `packages/morphir-ui/test/workbench-store.test.ts`

- [ ] **Step 1: Write failing migration tests**

Add a test that calls:

```ts
const migrated = decodeUiConfig(
  {
    workbenches: {
      open: [
        {
          id: '/dev/morphir',
          source: '/dev/morphir',
          name: 'morphir',
          kind: 'development',
          route: 'overview',
          openedAt: '2026-08-29T12:00:00.000Z',
          lastUsedAt: '2026-08-29T12:00:00.000Z',
        },
      ],
      recent: [],
      activeId: '/dev/morphir',
      reopenOnLaunch: true,
    },
  },
  { legacyProviderId: 'desktop-local' },
)
```

Assert its source is `{ providerId: 'desktop-local', locator: '/dev/morphir', displayName: 'morphir' }` and its active ID is `JSON.stringify(['desktop-local', '/dev/morphir'])`. Add a second case proving already-qualified descriptors round-trip unchanged.

- [ ] **Step 2: Confirm RED**

Run `moon run morphir-ui:test -- --run test/workbench-config.test.ts`.

Expected: failure because `source` is a string and `decodeUiConfig` accepts one argument.

- [ ] **Step 3: Implement descriptor migration**

Add `"@morphir/workspace": "workspace:*"` to `packages/morphir-ui/package.json`.

In `workbench/types.ts`, change `WorkbenchBase.source` to `WorkbenchSourceRef`. Define:

```ts
export const legacySourceRef = (
  locator: string,
  providerId = 'legacy-local',
): WorkbenchSourceRef => ({
  providerId,
  locator,
  displayName:
    locator
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || locator,
})
```

Use `sourceKey(source)` for descriptor IDs. In `config.ts`, use `WorkbenchSourceRefSchema` and add `DecodeUiConfigOptions { legacyProviderId?: string }`. Before schema decoding, map string-backed descriptors to source references and remap `activeId` to the migrated descriptor ID. Use the requested legacy provider ID or `legacy-local`.

- [ ] **Step 4: Prove provider-aware store identity**

Update store fixtures to source objects. Add one test that opens locator `/workspace` through `browser-local` and `cli:one` and expects two entries whose IDs are:

```ts
;[JSON.stringify(['cli:one', '/workspace']), JSON.stringify(['browser-local', '/workspace'])]
```

- [ ] **Step 5: Confirm GREEN and commit**

```bash
bun install
moon run morphir-ui:test morphir-ui:typecheck morphir-ui:lint
git add packages/morphir-ui bun.lock
git commit -s -m "feat(ui): qualify Workbench sources by provider"
```

Expected: all tasks pass before the commit.

### Task 3: Extend the Effect contract

**Files:**

- Modify: `packages/morphir-ui/src/workbench/services.ts`
- Modify: `packages/morphir-ui/src/workbench/types.ts`
- Modify: `packages/morphir-ui/src/workbench/workflows.ts`
- Modify: `packages/morphir-ui/src/services/services.ts`
- Modify: `packages/morphir-ui/test/workbench-services.test.ts`
- Modify: `packages/morphir-ui/test/services.test.ts`

- [ ] **Step 1: Write failing provider and event tests**

Create a `WorkbenchProviderService` test Layer whose `list` returns `browser-local`. Create a `WorkspaceSnapshot` fixture and a Development service whose `events` is `Stream.make({ tag: 'snapshot', snapshot })`. Assert `makeAppServices` lists the provider, loads the snapshot, loads a project model by ID, and exposes the first workspace event.

- [ ] **Step 2: Confirm RED**

Run `moon run morphir-ui:test -- --run test/workbench-services.test.ts test/services.test.ts`.

Expected: missing provider, event, and project-model APIs.

- [ ] **Step 3: Add the Effect APIs**

Add this tag to `workbench/services.ts`:

```ts
export class WorkbenchProviderService extends Context.Tag('@morphir/ui/WorkbenchProviderService')<
  WorkbenchProviderService,
  { readonly list: Effect.Effect<ReadonlyArray<WorkbenchProvider>> }
>() {}
```

Change `WorkbenchSourceService.inspect`, `pick`, and `reveal` to use `WorkbenchSourceRef`. Change `WorkbenchError.source` to `WorkbenchSourceRef | string`, since picker failures can occur before a provider returns a reference. Add `unsupported-capability` and `provider-disconnected` error codes. Change `DevelopmentWorkbenchData` to contain `snapshot: WorkspaceSnapshot`.

Extend `DevelopmentWorkbenchService` with:

```ts
readonly loadProjectModel: (
  descriptor: DevelopmentWorkbenchDescriptor,
  projectId: string,
) => Effect.Effect<ModelWorkbenchData, WorkbenchError>
readonly events: (
  descriptor: DevelopmentWorkbenchDescriptor,
) => Stream.Stream<WorkspaceEvent, WorkbenchError>
```

- [ ] **Step 4: Extend the promise facade and workflows**

Add `WorkbenchProviderService` to `CoreServices`. Add `listWorkbenchProviders`, `loadDevelopmentProjectModel`, and `workspaceEvents` to `AppServices`. The first two run through `ManagedRuntime`; `workspaceEvents` returns the provider's Effect Stream for later scoped subscription by the Workbench store.

Change `openWorkbench` to accept `WorkbenchSourceRef`. Add a workflow that obtains `DevelopmentWorkbenchService` and calls `loadProjectModel`.

- [ ] **Step 5: Confirm GREEN and commit**

```bash
moon run morphir-ui:test morphir-ui:typecheck morphir-ui:lint
git add packages/morphir-ui/src packages/morphir-ui/test
git commit -s -m "feat(ui): define workspace provider capabilities"
```

Expected: all tasks pass before the commit.

### Task 4: Adapt the current hosts without adding discovery

**Files:**

- Modify: `apps/morphir-desktop/src/main/workbench-source.ts`
- Modify: `apps/morphir-desktop/src/main/workbench-rpc.ts`
- Modify: `apps/morphir-desktop/src/renderer/src/layers/desktop-layers.ts`
- Modify: `apps/morphir-desktop/test/workbench-source.test.ts`
- Modify: `apps/morphir-desktop/test/workbench-rpc.test.ts`
- Modify: `apps/morphir-web/src/layers/browser-layers.ts`
- Modify: `apps/morphir-web/test/browser-layers.test.ts`
- Modify: `packages/morphir-ui/src/workbench/workbench-store.svelte.ts`
- Modify: `packages/morphir-ui/src/views/DevelopmentWorkbenchView.svelte`
- Modify: `packages/morphir-ui/test/support/fake-services.ts`
- Modify: affected `packages/morphir-ui/test/*.test.ts`

- [ ] **Step 1: Write failing host tests**

Use `desktop-local` and `browser-local` provider IDs. Desktop tests expect source objects whose locators are canonical native paths. Browser tests expect same-named files to have distinct locators under `browser-local`. Add provider-list assertions for both hosts.

- [ ] **Step 2: Confirm RED**

Run `moon run morphir-desktop:test morphir-web:test`.

Expected: host Layers and RPC still exchange strings.

- [ ] **Step 3: Adapt the desktop boundary**

Accept and return `WorkbenchSourceRef` at RPC boundaries. Reject non-`desktop-local` sources. Use `source.locator` for native operations. Advertise:

```ts
{
  id: 'desktop-local',
  name: 'This computer',
  kind: 'local',
  status: 'available',
  capabilities: [
    { name: 'morphir/model/open', version: '1' },
    { name: 'morphir/development/inspect', version: '1' },
  ],
}
```

Convert the shallow development summary into an `open` `WorkspaceSnapshot` with no projects. Return `Stream.empty` for events and a typed `unsupported-capability` failure for project-model loading until discovery lands.

- [ ] **Step 4: Adapt browser and shared UI state**

Store browser-selected files by `sourceKey(ref)`. Generate locators as `model:<counter>` and preserve names in `displayName`. Advertise model support only. Keep folder selection as `unsupported-capability` in this slice.

Change `WorkbenchStore.open`, restore, reveal, search, failures, and deduplication to use source references. Search `displayName` and `locator`. Update the Development view and fake services to use the temporary snapshot.

- [ ] **Step 5: Confirm GREEN and commit**

```bash
moon run morphir-workspace:test morphir-workspace:typecheck morphir-ui:test morphir-ui:typecheck morphir-desktop:test morphir-desktop:typecheck morphir-web:test morphir-web:typecheck
git add apps packages bun.lock
git commit -s -m "refactor(workbench): route sources through providers"
```

Expected: all tasks pass before the commit.

### Task 5: Run repository-wide verification

**Files:** Modify only if formatters or mechanical quality tools require corrections.

- [ ] **Step 1: Format and run static checks**

```bash
bun x prettier --write packages/morphir-workspace packages/morphir-ui apps/morphir-desktop apps/morphir-web
mise exec -- moon run :lint :typecheck
```

Expected: formatting completes; every lint and typecheck task passes.

- [ ] **Step 2: Run all tests and builds**

```bash
mise exec -- moon run :test :build
```

Expected: every test and build passes.

- [ ] **Step 3: Check scope and whitespace**

```bash
git diff origin/main...HEAD --check
git status --short
```

Expected: no whitespace errors. The branch contains the new pure package and contract migration only, with no Rust/WASM discovery, CLI server, or final project navigation.

- [ ] **Step 4: Commit formatter corrections only when needed**

```bash
git add apps packages bun.lock
git commit -s -m "chore: format workspace provider contracts"
```

Skip Step 4 if Step 1 changed no files.

## Later plans

The remaining epic work consumes this contract in order:

1. Portable Rust workspace discovery and WebAssembly component.
2. Browser and Electron local providers.
3. CLI loopback host and connected web provider.
4. Project lifecycle subscriptions, navigation, and Model Workbench regression coverage.
