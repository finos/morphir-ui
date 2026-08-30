# Morphir UI

Morphir UI presents Morphir models and development environments through one application while preserving the distinction between an artifact being explored and a development root being worked on.

## Language

**Workbench**:
A switchable area for one opened subject in Morphir UI. Several Workbenches can remain open at the same time, and each has a kind that determines its capabilities.
_Avoid_: Workspace as the umbrella term, open context

**Model Workbench**:
A Workbench for exploring one Morphir model represented as either a single-file distribution or a Document Tree distribution.
_Avoid_: File workspace, Document Tree workspace

**Development Workbench**:
A Workbench anchored at a development root where Morphir projects, generated models, and knowledge bases are created and maintained. A development root may contain only a knowledge base and does not require Morphir project configuration.
_Avoid_: Model Workbench, repository workspace

**Workbench Source**:
The canonical file or directory from which a Workbench is detected and opened. One source can have at most one open Workbench.
_Avoid_: Workspace file

**Workbench Capability**:
An operation exposed to a Workbench through an Effect service, such as inspecting a source, reading a distribution, or discovering development contents. Capabilities are supplied by platform-specific Layers and determine what the UI can offer without coupling it to Electron or browser APIs.
_Avoid_: Platform flag, feature boolean

**Workbench Provider**:
A versioned implementation of one or more Workbench Capabilities. Each Workbench Source is pinned to the provider that opened it so a change in connection does not silently change its meaning.
_Avoid_: Backend mode, platform implementation

**Morphir Workspace**:
A development structure declared by a `[workspace]` configuration section and composed of a root plus discovered member projects. It may exist inside a Development Workbench but is not itself a Workbench.
_Avoid_: Workbench, open workspace

**Morphir Project**:
A configured unit of Morphir development that can stand alone, appear at a workspace root, or be discovered as a workspace member. Its lifecycle state belongs to the provider that manages it.
_Avoid_: Workbench, IR package

**Morphir Home**:
The shared user-level Morphir directory used by both the Morphir CLI and UI. It is resolved from `MORPHIR_HOME`, falling back to the operating-system-specific Morphir home (normally `~/.morphir`). User-level UI state belongs here rather than in an Electron-specific application-data silo.
_Avoid_: Electron home, UI home

**Browser Morphir Home**:
The browser-private equivalent of Morphir Home used by a Standalone Web Host, with the same configuration semantics but no implicit access to the operating system's Morphir Home.
_Avoid_: Virtual filesystem home, localStorage config

**Standalone Web Host**:
The `morphir-web` application with Workbench Capabilities supplied inside the browser by JavaScript, WebAssembly, browser storage, and user-granted file handles.
_Avoid_: Static web mode, reduced web app

**Connected Web Host**:
The same `morphir-web` application with additional Workbench Capabilities supplied by a connected Morphir CLI and its extensions.
_Avoid_: Server edition, separate web app

**Effective Morphir Configuration**:
The configuration produced by Morphir's standard discovery, precedence, merging, validation, and secret-handling rules for a specific anchor. A Development Workbench uses its root as the anchor; other Workbenches use the nearest applicable anchor or user-level configuration.
_Avoid_: UI config when referring to the shared Morphir configuration model
