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

**Morphir Home**:
The shared user-level Morphir directory used by both the Morphir CLI and UI. It is resolved from `MORPHIR_HOME`, falling back to the operating-system-specific Morphir home (normally `~/.morphir`). User-level UI state belongs here rather than in an Electron-specific application-data silo.
_Avoid_: Electron home, UI home

**Effective Morphir Configuration**:
The configuration produced by Morphir's standard discovery, precedence, merging, validation, and secret-handling rules for a specific anchor. A Development Workbench uses its root as the anchor; other Workbenches use the nearest applicable anchor or user-level configuration.
_Avoid_: UI config when referring to the shared Morphir configuration model
