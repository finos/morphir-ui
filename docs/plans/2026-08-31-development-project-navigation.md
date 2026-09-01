# Development Project Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every Development Workbench select one of its discovered projects and browse that project's existing `morphir-ir.json` through the current package/module/definition explorer, while retaining independent project and definition selections per open Workbench.

**Architecture:** Keep navigation state in `WorkbenchStore`, keyed first by Development Workbench ID and then by stable provider-owned project ID. Project model loads continue through `DevelopmentWorkbenchService`, so browser, Electron, and connected providers resolve the artifact without the shared view interpreting opaque locators. The UI repository adds the connected protocol contract and client; a follow-up `finos/morphir` PR implements that method in the CLI host and revendors the resulting web build.

**Tech Stack:** Svelte 5 runes, Effect, TypeScript, Vitest/Testing Library, Electron constrained RPC, JSON-RPC over WebSocket, Rust/Tokio/Axum in the Morphir CLI, Moon/mise/bun.

**Deliberate boundary:** This slice reads a project's already-generated classic `morphir-ir.json`. Missing artifacts and unsupported IR versions are typed load errors shown for that project. Compiling source, provider lifecycle transitions, reloads, stale-model retention, and recovery actions belong to `morphir-ui-irf.5`.

---

### Task 1: Add independent Development Workbench navigation state

**Files:**

- Modify: `packages/morphir-ui/src/workbench/types.ts`
- Modify: `packages/morphir-ui/src/workbench/workbench-store.svelte.ts`
- Modify: `packages/morphir-ui/test/workbench-store.test.ts`
- Modify: `packages/morphir-ui/test/support/fake-services.ts`

- [ ] **Step 1: Write failing store tests**

Add tests that open two Development Workbenches containing two projects apiece and assert:

```ts
await store.selectDevelopmentProject(firstWorkbenchId, firstProject.id)
store.selectDevelopmentDefinition(firstWorkbenchId, firstProject.id, 'definition:value:A:B:c')
await store.selectDevelopmentProject(firstWorkbenchId, secondProject.id)
store.selectDevelopmentDefinition(firstWorkbenchId, secondProject.id, 'definition:type:A:B:T')
await store.selectDevelopmentProject(secondWorkbenchId, otherProject.id)

expect(store.developmentNavigation(firstWorkbenchId)).toMatchObject({
  activeProjectId: secondProject.id,
  projects: [
    { projectId: firstProject.id, status: 'ready', selectedDefinitionId: 'definition:value:A:B:c' },
    { projectId: secondProject.id, status: 'ready', selectedDefinitionId: 'definition:type:A:B:T' },
  ],
})
expect(store.developmentNavigation(secondWorkbenchId)).toMatchObject({
  activeProjectId: otherProject.id,
})
```

Also cover a deferred project load so `status: 'loading'` is observable, an error followed by `retryDevelopmentProject`, a project switch while an earlier request is unresolved, a Workbench close during a project load, and rejection of a project ID absent from the current snapshot. Assert stale promises never replace the newer selection.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
mise exec -- moon run morphir-ui:test -- --run test/workbench-store.test.ts
```

Expected: failure because the Development navigation types and store methods do not exist.

- [ ] **Step 3: Define the navigation state**

Add these exact public types to `workbench/types.ts`:

```ts
export type DevelopmentProjectModelEntry =
  | {
      readonly projectId: string
      readonly status: 'loading'
      readonly selectedDefinitionId: string | null
    }
  | {
      readonly projectId: string
      readonly status: 'ready'
      readonly model: ModelWorkbenchData
      readonly selectedDefinitionId: string | null
    }
  | {
      readonly projectId: string
      readonly status: 'error'
      readonly message: string
      readonly selectedDefinitionId: string | null
    }

export interface DevelopmentNavigationState {
  readonly activeProjectId: string | null
  readonly projects: ReadonlyArray<DevelopmentProjectModelEntry>
}
```

- [ ] **Step 4: Implement token-safe cached project loading**

In `WorkbenchStore`, add a `$state<Record<WorkbenchId, DevelopmentNavigationState>>`, a token map keyed by `JSON.stringify([workbenchId, projectId])`, and these methods:

```ts
developmentNavigation(id: WorkbenchId): DevelopmentNavigationState
selectDevelopmentProject(id: WorkbenchId, projectId: string): Promise<void>
retryDevelopmentProject(id: WorkbenchId, projectId: string): Promise<void>
selectDevelopmentDefinition(
  id: WorkbenchId,
  projectId: string,
  definitionId: string | null,
): void
```

`selectDevelopmentProject` must verify that the ready Development Workbench's current snapshot contains `projectId`, set that Workbench's `activeProjectId`, reuse an existing ready entry without another provider call, otherwise install a loading entry and call `services.loadDevelopmentProjectModel(entry.descriptor, projectId)`. Replace the matching entry only when both the Workbench and token still exist. Closing/disposal clears related tokens and state. Snapshot events remove cached projects that no longer exist and clear an invalid active project.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the Task 1 test command. Expected: all `workbench-store.test.ts` tests pass.

- [ ] **Step 6: Commit the store slice**

```bash
git add packages/morphir-ui/src/workbench packages/morphir-ui/test/workbench-store.test.ts packages/morphir-ui/test/support/fake-services.ts
git commit -s -m "feat(ui): cache development project navigation"
```

### Task 2: Compose Projects above the existing searchable model tree

**Files:**

- Create: `packages/morphir-ui/src/views/development/ProjectNavigation.svelte`
- Modify: `packages/morphir-ui/src/views/model-tree/ModelTreePane.svelte`
- Modify: `packages/morphir-ui/src/views/IrExplorerView.svelte`
- Replace: `packages/morphir-ui/src/views/DevelopmentWorkbenchView.svelte`
- Modify: `packages/morphir-ui/src/views/WorkbenchView.svelte`
- Modify: `packages/morphir-ui/src/shell/MorphirApp.svelte`
- Create: `packages/morphir-ui/test/development-workbench.test.ts`
- Modify: `packages/morphir-ui/test/ir-explorer.test.ts`
- Modify: `packages/morphir-ui/test/morphir-app.test.ts`

- [ ] **Step 1: Write component tests for every project view state**

Create `development-workbench.test.ts` using a real `WorkbenchStore` with fake services. Cover:

```ts
expect(screen.getByText('No projects discovered')).toBeTruthy()
expect(screen.getByRole('status').textContent).toContain('Loading Orders')
expect(screen.getByRole('alert').textContent).toContain('morphir-ir.json was not found')
expect(screen.getByRole('button', { name: 'Retry Orders' })).toBeTruthy()
expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
expect(screen.getByRole('treeitem', { name: 'Orders.Package' })).toBeTruthy()
```

For the ready case, click a project, a definition, a second project, and then the first project. Assert the first definition detail is restored. Switch to a second Development Workbench and back; assert each Workbench restores its own active project and definition. Assert the `Projects` section collapses while the model search/filter controls remain available below it.

Extend `ir-explorer.test.ts` with a controlled-selection test that supplies `selectedDefinitionId`, records `onSelectedDefinition`, rerenders with that ID, and sees the corresponding definition detail.

- [ ] **Step 2: Run component tests and confirm RED**

```bash
mise exec -- moon run morphir-ui:test -- --run test/development-workbench.test.ts test/ir-explorer.test.ts test/morphir-app.test.ts
```

Expected: missing Project navigation UI and controlled explorer selection.

- [ ] **Step 3: Add a reusable leading section to the model tree**

Import `Snippet` from `svelte` in `ModelTreePane.svelte`, add `leading?: Snippet` to its props, and render it inside the expanded tree pane immediately before the existing search toolbar:

```svelte
{#if leading}
  {@render leading()}
{/if}
```

Do not duplicate or replace the existing package/module/definition tree, its filtering, its collapse behavior, keyboard navigation, or resize handle.

- [ ] **Step 4: Make explorer selection optionally controlled**

Extend `IrExplorerView` with:

```ts
treeLeading?: Snippet
selectedDefinitionId?: string | null
onSelectedDefinition?: (definitionId: string | null) => void
```

When `selectedDefinitionId` is `undefined`, retain the existing local Model Workbench behavior. Otherwise resolve the selected definition from `model.ir.definitions` with `definitionNodeId`, derive its raw entry with the existing `findEntry`, and call `onSelectedDefinition(definitionNodeId(info))` on selection. Pass `treeLeading` to `ModelTreePane` as `leading`.

- [ ] **Step 5: Build the collapsible project section and Development view**

`ProjectNavigation.svelte` accepts the immutable `WorkspaceSnapshot`, active project ID, and `onSelect(projectId)`. Render one button per project, use `aria-current="page"` for the active project, show project name/path/version, and render the provider-owned `project.state` token. The `Projects` heading toggles the whole section and reports `aria-expanded`.

`DevelopmentWorkbenchView.svelte` accepts `workbench`, `navigation`, selection/retry callbacks, and `onInspect`. Its main states are:

- no snapshot projects: the Project section plus “No projects discovered”
- active project loading: the Project section plus `role="status"`
- active project error: the Project section plus `role="alert"` and retry button
- active project ready: `IrExplorerView` with `ProjectNavigation` supplied through `treeLeading`, the cached definition ID supplied through the controlled props, and the existing Insight/XRay inspection callback unchanged
- projects present with none active: the Project section plus “Select a project to explore its model”

Update `WorkbenchView` to wire the store callbacks. Update `MorphirApp` so every ready Development Workbench receives the same edge-to-edge explorer layout class as a Model Workbench on its explorer route.

- [ ] **Step 6: Run component tests and confirm GREEN**

Run the Task 2 command. Expected: all selected component tests pass.

- [ ] **Step 7: Commit the UI slice**

```bash
git add packages/morphir-ui/src packages/morphir-ui/test
git commit -s -m "feat(ui): browse projects in development workbenches"
```

### Task 3: Load project artifacts in standalone browser and Electron

**Files:**

- Modify: `apps/morphir-web/src/workspace/browser-provider.ts`
- Modify: `apps/morphir-web/test/browser-layers.test.ts`
- Modify: `apps/morphir-desktop/src/main/workbench-source.ts`
- Modify: `apps/morphir-desktop/src/main/workbench-rpc.ts`
- Modify: `apps/morphir-desktop/src/main/index.ts`
- Modify: `apps/morphir-desktop/src/renderer/src/layers/desktop-layers.ts`
- Modify: `apps/morphir-desktop/test/workbench-source.test.ts`
- Modify: `apps/morphir-desktop/test/workbench-rpc.test.ts`
- Modify: `apps/morphir-desktop/src/renderer/src/layers/desktop-layers.test.ts`

- [ ] **Step 1: Write failing browser and Electron provider tests**

For each host, create a multi-project fixture where `packages/orders/morphir.toml` and `packages/orders/morphir-ir.json` exist. Open the Development Workbench, take the returned stable project ID, call `loadDevelopmentProjectModel`, and assert the returned model is pinned to the same provider and contains the fixture package/module/definition. Add negative tests for an unknown project ID, a missing `morphir-ir.json`, malformed JSON, unsupported IR format, a symlink escaping the Electron root, and a browser project path containing no artifact.

- [ ] **Step 2: Run host tests and confirm RED**

```bash
mise exec -- moon run morphir-web:test -- --run test/browser-layers.test.ts
mise exec -- moon run morphir-desktop:test -- --run test/workbench-source.test.ts test/workbench-rpc.test.ts src/renderer/src/layers/desktop-layers.test.ts
```

Expected: both providers return `unsupported-capability`.

- [ ] **Step 3: Implement browser project loading**

Rediscover the workspace with the same Browser Morphir Home, find the exact qualified project ID, join its canonical relative path with `morphir-ir.json` inside the already-confined uploaded/handle file tree, and fail with `not-found` when absent. Decode with `decodeMorphirIr`; return `ModelWorkbenchData` with a provider-owned source locator derived from the opaque directory locator and stable project ID. Never turn the opaque locator into a native path.

- [ ] **Step 4: Implement constrained Electron project loading**

Add `readProjectModel(descriptor, projectId)` in the main process. Rediscover the snapshot, find the exact project ID, resolve `<canonical-root>/<relative-path>/morphir-ir.json`, canonicalize the artifact, and reject it unless `node:path.relative(canonicalRoot, canonicalArtifact)` is neither absolute nor `..`-prefixed. Read and return `{ descriptor, content }` through a new `morphir/workbench/readProjectModel` RPC registration. The renderer decodes the content with the existing `decodeModelSource` path and maps failures to `WorkbenchError`.

- [ ] **Step 5: Advertise the capability**

Add `{ name: 'morphir/project-model/open', version: '1' }` to the standalone browser and Electron local provider manifests. Add `projectModelOpen` to `WORKBENCH_CAPABILITIES`.

- [ ] **Step 6: Run host tests and confirm GREEN**

Run the Task 3 commands. Expected: all focused host tests pass.

- [ ] **Step 7: Commit the local-provider slice**

```bash
git add apps/morphir-web apps/morphir-desktop packages/morphir-workspace
git commit -s -m "feat(hosts): load development project models"
```

### Task 4: Add the connected project-model protocol and client

**Files:**

- Modify: `packages/morphir-workspace/src/connected.ts`
- Modify: `packages/morphir-workspace/test/connected.test.ts`
- Modify: `apps/morphir-web/src/connected/connected-provider.ts`
- Modify: `apps/morphir-web/test/connected-provider.test.ts`

- [ ] **Step 1: Write failing protocol and adapter tests**

Assert that a connected manifest must advertise `morphir/project-model/open` version 1. Assert a project selection sends:

```json
{
  "method": "morphir.project-model.open",
  "params": { "source": { "providerId": "cli:session-1", "locator": "workspace:initial", "displayName": "orders" }, "projectId": "project-1" }
}
```

and that a valid response descriptor plus v3 IR content becomes decoded `ModelWorkbenchData`. Cover malformed descriptors, provider drift, bad JSON, oversized-response enforcement through the existing RPC client, and a version-1 manifest missing the new capability.

- [ ] **Step 2: Run connected tests and confirm RED**

```bash
mise exec -- moon run morphir-workspace:test -- --run test/connected.test.ts
mise exec -- moon run morphir-web:test -- --run test/connected-provider.test.ts
```

Expected: the method, schemas, and adapter implementation are absent.

- [ ] **Step 3: Add the version-1 method and schemas**

Add `projectModelOpen: 'morphir.project-model.open'` to `CONNECTED_METHODS` and define strict Effect schemas:

```ts
export const ProjectModelOpenParamsSchema = Schema.Struct({
  source: WorkbenchSourceRefSchema,
  projectId: NonEmptyStringSchema,
})

export const ProjectModelOpenResultSchema = Schema.Struct({
  descriptor: ModelWorkbenchDescriptorWireSchema,
  content: NonEmptyStringSchema,
})
```

The wire descriptor schema uses kind `model`, distribution `single-file`, route `explorer`, and the existing source/base timestamp fields. Add the new capability to `ConnectedSessionManifestSchema`'s required version-1 set.

- [ ] **Step 4: Decode connected project models**

Implement `loadProjectModel(descriptor, projectId)` by calling the new method, validating that the result descriptor remains on `descriptor.source.providerId`, decoding `content` with `decodeMorphirIr`, and returning the existing `ModelWorkbenchData` shape. Convert schema/IR failures to typed `WorkbenchError` values.

- [ ] **Step 5: Run connected tests and confirm GREEN**

Run the Task 4 commands. Expected: all focused connected protocol/client tests pass.

- [ ] **Step 6: Commit the connected-client slice**

```bash
git add packages/morphir-workspace apps/morphir-web
git commit -s -m "feat(web): request project models from connected hosts"
```

### Task 5: Verify and open the morphir-ui PR

**Files:**

- Modify: `docs/plans/2026-08-31-development-project-navigation.md` only to check completed boxes if desired

- [ ] **Step 1: Run repository quality gates**

```bash
mise exec -- moon run :format
mise exec -- moon run :lint
mise exec -- moon run :typecheck
mise exec -- moon run :test
mise exec -- moon run :build
git diff --check
```

Expected: every task passes and `git diff --check` emits no output.

- [ ] **Step 2: Push and create the PR**

```bash
git push -u origin feat/development-project-navigation
gh pr create --repo finos/morphir-ui --base main --head feat/development-project-navigation \
  --title "feat: browse development workspace projects" \
  --body "Closes morphir-ui-irf.4 after the dependent CLI host PR lands. Adds cached project navigation, reuses the existing model explorer, loads local project artifacts, and defines the connected project-model protocol."
```

Expected: GitHub returns the new PR URL.

- [ ] **Step 3: Monitor CI and review**

Use `gh pr checks watch --timeout 30m --failfast`, inspect review decisions, issue comments, and inline review comments through `gh pr view` and `gh api`. Verify each claim against code/tests, fix valid findings test-first, and reply to every inline comment with an inline response.

### Task 6: Implement the project-model RPC in finos/morphir

**Files in a new isolated `finos/morphir` worktree based on current `origin/main`:**

- Modify: `crates/morphir/src/commands/ui/protocol.rs`
- Modify: `crates/morphir/src/commands/ui/provider/mod.rs`
- Create: `crates/morphir/src/commands/ui/provider/project_model.rs`
- Modify: `crates/morphir/src/commands/ui/provider/native.rs`
- Modify: `crates/morphir/src/commands/ui/provider/extension.rs`
- Modify: `crates/morphir/src/commands/ui/rpc.rs`
- Modify: `tools/vendor-morphir-web.test.ts`
- Update generated assets via: `tools/vendor-morphir-web.ts`
- Modify: `ecosystem/morphir-ui` submodule pin

- [ ] **Step 1: Create the isolated parent worktree after the UI PR is merge-ready**

```bash
git fetch origin main
git worktree add ~/.config/superpowers/worktrees/morphir/irf4-project-navigation -b feat/ui-project-model-rpc origin/main
```

Expected: a clean branch at the latest umbrella `main`.

- [ ] **Step 2: Write failing Rust protocol/provider/RPC tests**

Add tests that deserialize `morphir.project-model.open`, reject unknown fields and foreign provider/project IDs, load a confined fixture `<project>/morphir-ir.json`, reject missing/oversized/escaping artifacts, and serialize a single-file/explorer model descriptor with content. Exercise both native and extension-selected workspace providers; extension-backed discovery still reads the project artifact through the CLI host's confined filesystem boundary.

- [ ] **Step 3: Run focused Rust tests and confirm RED**

```bash
cargo test -p morphir --bin morphir commands::ui::protocol commands::ui::provider commands::ui::rpc
```

Expected: missing `ConnectedMethod::ProjectModelOpen` and provider method.

- [ ] **Step 4: Implement strict wire types and confined loading**

Add `ProjectModelOpen` with serde name `morphir.project-model.open`, strict params `{ source, project_id }`, and result `{ descriptor, content }`. Extend `WorkspaceCapability` with `load_project_model`. The shared helper must call/open the provider snapshot, find the exact stable project ID, canonicalize the workspace and artifact, reject any artifact outside the workspace, enforce the UI response byte limit before allocation/serialization, read UTF-8, and return a provider-qualified descriptor whose route is `explorer`.

- [ ] **Step 5: Route the RPC and advertise the capability**

Dispatch the new method only after session initialization and normal provider/source validation. Add `morphir/project-model/open` version 1 to native and extension provider manifests. Preserve the existing inbound/outbound WebSocket size limits and auth/origin/session checks.

- [ ] **Step 6: Run focused and full Rust quality gates**

```bash
cargo fmt --all -- --check
cargo clippy -p morphir --all-targets -- -D warnings
cargo test -p morphir
mise run test
```

Expected: formatting, Clippy, focused tests, and the repository test task pass.

- [ ] **Step 7: Merge the green morphir-ui PR, update the submodule, and vendor assets**

After explicit merge authorization and a final review/CI check, squash-merge the UI PR. Then in the parent worktree:

```bash
git -C ecosystem/morphir-ui fetch origin main
git -C ecosystem/morphir-ui checkout origin/main
mise exec -- bun tools/vendor-morphir-web.ts
mise exec -- bun test tools/vendor-morphir-web.test.ts
```

Expected: the submodule points at the merged UI commit, generated assets/provenance match it, and vendoring tests pass.

- [ ] **Step 8: Commit, push, and open the parent PR**

```bash
git add crates/morphir tools ecosystem/morphir-ui Cargo.lock
git commit -s -m "feat(cli): serve development project models"
git push -u origin feat/ui-project-model-rpc
gh pr create --repo finos/morphir --base main --head feat/ui-project-model-rpc \
  --title "feat(cli): serve development project models" \
  --body "Completes connected Development Workbench project navigation by implementing the negotiated project-model RPC and vendoring the matching morphir-web build."
```

- [ ] **Step 9: Monitor the parent PR and finish Beads state**

Watch CI with `gh pr checks watch --timeout 30m --failfast`; inspect and reply inline to every review comment. After explicit merge authorization, squash-merge, clean both feature worktrees/branches, pull and push the authoritative Beads Dolt state, then close `morphir-ui-irf.4` with both merged PR URLs and commit IDs in the close reason.

### Task 7: Final `.4` acceptance verification

**Files:**

- No production changes expected; create a follow-up Bead if verification exposes work outside `.4`.

- [ ] **Step 1: Exercise the three providers**

Using the same v3 project fixture, verify standalone browser, Electron, and `morphir ui` connected web each discover the project, select it, and render package → module → definition. Open two Development Workbenches and prove their active projects and definition details remain independent.

- [ ] **Step 2: Verify planned error boundaries**

Confirm an absent artifact produces a project-local retryable error without replacing the Development Workbench, and that a lone `morphir-ir.json` still opens directly as a Model Workbench. Do not add lifecycle/stale/recovery behavior here; record any such result against `.5`.

- [ ] **Step 3: Run final cross-repository evidence commands**

```bash
# morphir-ui
mise exec -- moon run :test :typecheck :lint :build

# finos/morphir
cargo fmt --all -- --check
cargo clippy -p morphir --all-targets -- -D warnings
cargo test -p morphir
```

Expected: all commands pass at the merged commits before `.4` is closed.
