# Multi-project workspace and provider design

**Date:** 2026-08-29
**Status:** Approved
**Scope:** Multi-project Development Workbenches in the desktop, standalone web, and CLI-connected web hosts

## Problem

Morphir UI can keep several typed Workbenches open, but a Development Workbench currently exposes only a configuration anchor and shallow lists of model or knowledge-base directories. It does not represent the Morphir Workspace declared by `[workspace]`, discover member projects, report their lifecycle state, or navigate into their models.

The existing desktop discovery code also implements its own configuration-path precedence. That conflicts with Morphir's configuration rules, which require conflict detection, standard merging, and a shared Morphir Home. Extending that code separately in each host would create several definitions of a Morphir Workspace.

The sources of truth are:

- `finos/morphir` configuration and workspace specifications
- `morphir-devkit` configuration discovery and loading
- `morphir-daemon::Workspace` and its workspace and project lifecycle types
- the Workbench and capability language in this repository's `CONTEXT.md`

The current `morphir-daemon::Workspace` is a reference model, not yet a complete implementation of the specification. It handles only simple trailing `/*` member patterns and does not apply `exclude`. The portable capability must implement the recorded rules and share the standard configuration loader rather than preserving those limitations.

## Decision

Workspace discovery is a versioned Workbench Capability. It does not have one fixed execution location.

- A Standalone Web Host executes discovery inside the browser through a local JavaScript and WebAssembly provider.
- The Electron host executes the same portable capability through a Node filesystem adapter.
- A Connected Web Host obtains the capability from the Morphir CLI, which may execute it natively or delegate it to an extension.

The shared Svelte application depends only on Effect services and runtime-neutral data. One `morphir-web` build supports standalone and connected operation by registering the providers available at runtime.

The canonical configuration and workspace logic belongs in portable Rust code shared with the CLI. Native CLI code calls it directly. Local UI hosts use its WebAssembly build. JavaScript owns browser and Node integration, including directory selection, permission prompts, persistent browser handles, and virtual-filesystem imports.

This choice avoids three rejected designs:

1. A session-wide standalone or connected mode would prevent capabilities from being composed and would force unrelated Workbenches to change providers together.
2. Browser-owned TypeScript discovery everywhere would duplicate Morphir configuration behavior and bypass CLI extensions.
3. Waiting for a complete daemon wire protocol would block useful local workspace browsing and make the UI architecture depend on one transport.

## Domain model

### Provider-qualified sources

A Workbench Source is not assumed to be a native path. The UI stores a provider-qualified reference:

```ts
interface WorkbenchSourceRef {
  readonly providerId: string
  readonly locator: string
  readonly displayName: string
}
```

`providerId` names a logical provider instance. Its capability manifest carries protocol and capability versions. `locator` is opaque outside that provider. It may be a browser directory-handle key, a native path, or a CLI-side workspace identifier. The Workbench ID derives from the provider and locator together.

A Workbench remains pinned to the provider that opened it. Losing a connection does not silently reinterpret a CLI path as a browser directory or switch configuration sources.

### Workspace snapshot

Opening a Development Workbench returns an immutable `WorkspaceSnapshot` containing:

- the Development Root and detected primary configuration
- workspace identity and `closed | initializing | open | error` lifecycle state
- member projects, including a project at the workspace root when configured
- stable project IDs based on provider identity and paths relative to the Development Root
- project name, version, source directory, configuration anchor, and `unloaded | loading | ready | stale | error` lifecycle state
- project and workspace diagnostics
- model and knowledge-base sources associated with the root or a project

Duplicate project names remain separate because identity is path-based. The provider reports the duplicate as a diagnostic.

A lone `morphir-ir.json` or Document Tree distribution remains a Model Workbench. The UI must not invent a Workspace or Project around an artifact that the user opened only for exploration.

## Effect capability boundary

The shared app exposes provider-neutral Effect services for these operations:

- enumerate providers and their versioned capability manifests
- choose or receive a Development Workbench source
- open, refresh, and close a workspace snapshot
- load a project's model on demand
- stream workspace, project-state, and diagnostic changes
- request provider-specific recovery such as permission renewal or reconnection

Hosts compose Layers for the providers they can supply. Views consume the services and snapshots. They do not branch on Electron, browser, WebAssembly, or CLI flags.

Provider selection is explicit when more than one provider can open a source. The open action distinguishes a directory on "This browser" from a directory managed by a named connected Morphir provider.

## Portable workspace capability

The portable capability applies Morphir's standard rules rather than the current desktop detector's path precedence:

1. Resolve the Development Root and primary configuration through the six standard TOML and YAML layouts.
2. Reject multiple primary configurations and identify every conflicting path.
3. Apply Morphir Home, system, project, workspace-member, user-override, environment, and CLI layers according to the standard loader when those sources are available to the provider.
4. Detect `[workspace]`, resolve its root, expand `members`, apply `exclude`, and include a configured root project.
5. Load each discovered project configuration and return its actual lifecycle state and diagnostics.

The Rust capability depends on an imported, root-scoped virtual-filesystem interface rather than native `std::fs` calls. A provider cannot traverse above its granted Development Root through `..`, symlinks, glob expansion, or configuration paths.

The CLI's native adapter can also expose Morphir Home and configured extension capabilities. The browser adapter exposes only user-granted directories and its Browser Morphir Home.

## Standalone web provider

The standalone provider uses the File System Access API when available. Its JavaScript layer:

- asks the user for a Development Root
- stores an opaque handle key in Workbench configuration
- stores the actual handle in browser-controlled structured storage
- checks or renews read permission before opening
- implements the virtual-filesystem imports used by the WebAssembly capability

Browsers without persistent directory handles may use a directory upload fallback for the current session. The provider manifest reports whether persistence and live observation are available so the UI can hide unsupported actions.

Standalone web uses a Browser Morphir Home. It follows the same configuration model and precedence rules but cannot see the operating system's Morphir Home without a separate, explicit directory grant. Mounting an operating-system Morphir Home is not required by this design.

## Electron provider

Electron runs the portable WebAssembly capability outside the renderer. The main process supplies a Node filesystem adapter and resolves the actual Morphir Home, including `MORPHIR_HOME`. The renderer communicates through the existing constrained RPC boundary and never receives unrestricted filesystem access.

The bundled provider keeps the desktop app useful without an installed CLI. A CLI-backed provider can also be registered later in the same session and opened alongside local Workbenches.

## CLI-connected web provider

The Morphir CLI gains a command that starts a loopback-only host, serves the normal `morphir-web` assets, creates a session, and opens the browser. This is the connected form of the same web application, not another build or themed variant.

The host uses versioned JSON-RPC over WebSocket. Its startup manifest lists provider IDs, capability names, versions, and extension provenance. RPC exposes named Morphir capabilities only. It does not expose arbitrary filesystem calls or an unrestricted extension proxy.

The CLI may satisfy workspace operations with native Rust code or route a declared capability to a compatible extension. Project lifecycle changes and diagnostics arrive as protocol notifications and become an Effect stream in the web provider Layer.

### Connection security

- Bind only to `127.0.0.1` on an operating-system-assigned port.
- Generate a one-time launch secret and exchange it for an `HttpOnly`, `SameSite=Strict` session cookie.
- Require the CLI-served origin and a valid session on every WebSocket upgrade and request.
- Allow only advertised, version-compatible capability calls.
- Invalidate the provider and its session when the CLI host exits.
- Never put secrets, native paths not intended for display, or extension internals in browser logs.

A separately hosted public Morphir web site pairing directly with a local CLI is outside this design. The CLI-served connected form avoids cross-origin, private-network-access, and mixed-content failure modes while delivering the connected capability.

## Data flow

1. The host registers its local provider and any connected providers.
2. The user chooses a provider and source, or the CLI supplies an initial source at launch.
3. The provider inspects the source and returns a Development Workbench descriptor.
4. The Development Workbench service loads the effective configuration and returns a workspace snapshot.
5. The UI renders the workspace and project hierarchy.
6. Selecting a project requests its model from the same provider.
7. Existing package, module, definition, explorer, and insight components render the loaded project model.
8. Provider events update lifecycle state and diagnostics without replacing Workbench identity or navigation state.

Several local and connected Development or Model Workbenches can remain open together. Each keeps its provider, route, selection, and lifecycle independently.

## Failure behavior

The provider returns typed failures and diagnostics with these rules:

- Missing permission, invalid root configuration, or an incompatible capability version prevents the Workbench from opening.
- An invalid member project does not discard the workspace. It appears with `error` state and its diagnostics.
- A lost CLI connection marks its Workbenches disconnected and offers reconnection to the same provider.
- Revoked browser directory permission offers a permission retry.
- Unmatched member globs produce no projects and are not failures unless the configuration rules say otherwise.
- Duplicate project names remain visible under their stable path identities and produce a diagnostic.
- A failed project reload preserves the last usable model while showing `error` state and current diagnostics.

## Delivery

This epic includes both local and connected providers. Its implementation slices are:

1. Provider-qualified source references, workspace snapshots, lifecycle types, and Effect service contracts.
2. Portable Rust workspace discovery and shared configuration conformance fixtures.
3. Browser virtual filesystem, Browser Morphir Home, WebAssembly provider, and directory selection.
4. Electron Node filesystem adapter and local provider Layer.
5. CLI loopback host, capability negotiation, extension delegation, and connected web Layer.
6. Workspace to project to module to definition navigation with streamed lifecycle state.
7. Regression coverage for single-file and Document Tree Model Workbenches.

Work across `finos/morphir-ui`, `finos/morphir-rust`, and the `finos/morphir` CLI is part of this epic. Tracker dependencies must make the cross-repository order explicit.

## Testing

All providers must pass one contract suite against the same workspace fixtures. The suite covers:

- root, hidden, and dot-config TOML and YAML layouts
- conflicting primary configurations
- Morphir Home and user-override precedence
- member and exclusion globs
- a root that is both workspace and project
- duplicate names and malformed member configurations
- permission denial and renewal
- virtual-filesystem traversal and symlink confinement
- provider disconnect and reconnect
- capability and protocol version mismatch
- lifecycle events and preservation of the last usable model

Pure service tests use in-memory virtual filesystems and fake Effect Layers. Browser tests exercise directory handles, browser storage, the WebAssembly boundary, and connected WebSocket behavior. Electron tests exercise the main-process adapter and renderer RPC. CLI integration tests start the loopback host, authenticate a browser session, negotiate capabilities, open a fixture workspace, observe project-state notifications, and reject unauthorized calls.

Component tests verify the project hierarchy, diagnostics, loading and stale states, provider-aware open actions, reconnection, and navigation into the existing explorer and insight views. Existing Model Workbench tests remain unchanged and gain explicit regression scenarios for lone IR files and Document Tree distributions.

## Acceptance criteria

The design is complete when implementation demonstrates all of the following:

1. Desktop, standalone web, and CLI-connected web can open a real Development Root and discover the same projects from the same fixture.
2. Each project displays provider-owned lifecycle state and diagnostics.
3. Navigation proceeds from Development Workbench to project to package to module to definition and reuses the existing explorer and insight views.
4. Browser-local and CLI-connected Workbenches can be open concurrently without changing each other's provider or state.
5. Connected web can use a CLI or extension-provided workspace capability through the negotiated protocol.
6. Desktop and connected web use the actual Morphir Home; standalone web uses a Browser Morphir Home with the same semantics.
7. Opening a lone `morphir-ir.json` or Document Tree distribution behaves as it does before this campaign.
