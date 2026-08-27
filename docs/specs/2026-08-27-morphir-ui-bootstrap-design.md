# morphir-ui Bootstrap Design

**Date:** 2026-08-27
**Status:** Approved
**Scope:** First development cycle of finos/morphir-ui — repository scaffolding plus parity with the morphir-scala desktop shell.

## Background

Morphir's UI efforts are spread across three repositories with three different foundations:

- **morphir-scala** — an Electron desktop shell built with Scala.js and Kyo: polished chrome, design tokens, three-way theming, resizable regions, a settings surface, and a clean IPC security posture, all over hard-coded demo data.
- **morphir-elm** — the classic Morphir web UI in Elm: the insight visualization, decision tables, value editor, and the `morphir-elm develop` server. The most substantial UI codebase.
- **finos/morphir** — "Morphir Live", a Dioxus prototype: workspace/project/model browser with a VS Code-style settings editor over mock data.

Building a real UI focus requires centralization. **finos/morphir-ui** is the single home for Morphir UI development going forward. It ships two deployables — **morphir-desktop** (Electron) and **morphir-web** — sharing one application codebase so the experiences never diverge.

This cycle delivers the repository scaffold and morphir-scala shell parity, after which morphir-scala sheds its Electron UI modules. Later cycles migrate the morphir-elm visualization and the Morphir Live experiences as new views in the same shell.

## Decisions

| Decision | Choice |
| --- | --- |
| First cycle scope | Scaffold + morphir-scala shell parity |
| Backend story | Self-contained UI (no CLI dependency); UI↔CLI hosting protocol designed in a later cycle |
| Token capture | PAT paste + `gh` CLI source; OS-keychain-backed storage |
| Config location | `$MORPHIR_HOME/ui/` (defaults to `~/.morphir/ui/`), aligned with the Morphir CLI home convention |
| Explorer data | Opens and decodes real `morphir-ir.json` files |
| Delivery | Feature branch + PR to finos/morphir-ui (EasyCLA-compliant, human sole author) |
| morphir-scala retirement | After parity ships, morphir-scala removes its Electron UI modules only; the repo continues as a library/capability provider |

## Tech stack

- **TypeScript 7.x** (native compiler) — with the caveat that `svelte-check` runs alongside on whatever TypeScript it requires until it supports the native compiler. Same syntax and semantics; two checkers during the transition.
- **Svelte 5** (runes) for UI.
- **Effect** as the core library for services, async, and error handling.
- **bun** for package management, workspaces, script running, and `bun test`.
- **moonrepo** for task orchestration (`lint`, `typecheck`, `test`, `build`, `package`; `moon ci` in CI).
- **mise** for tool acquisition (bun, node — Electron requires it — and moon).
- **Vite** for bundling (electron-vite for the desktop app).
- **Electron** (latest) for morphir-desktop.

## 1. Repository & module layout

```
morphir-ui/
├── .config/mise/config.toml     # pins bun, node, moon
├── .moon/workspace.yml           # projects: apps/*, packages/*
├── .moon/toolchain.yml           # bun toolchain
├── package.json                  # bun workspaces
├── tsconfig.base.json            # strict TS base config
├── apps/
│   ├── morphir-desktop/          # Electron main + preload, electron-vite, electron-builder
│   └── morphir-web/              # Vite static host
└── packages/
    ├── morphir-ui/               # THE shared Svelte app: shell, views, theme, state, service interfaces
    └── morphir-ir/               # IR model + Effect Schema decoding of morphir-ir.json (no UI deps)
```

Internal package names are `@morphir/ui`, `@morphir/ir`, `@morphir/desktop`, `@morphir/web`. Publishing (registry, scope) is deferred.

**Architecture: fat shared app, thin platform hosts.** `@morphir/ui` contains the entire Svelte application — shell chrome, routes, views, theme and design tokens, state — plus Effect service *interfaces*. The apps are thin hosts that supply Effect `Layer` implementations of those interfaces. Uniform look and feel is structural, not aspirational: there is exactly one shell.

**Extension principle (architectural invariant):** any service interface may later be re-backed by a WASM or JS binding — e.g. morphir-scala's markdown→HTML (ScalaJS/WASM) or future morphir-rust WASM bindings — as just another Effect Layer. The UI never knows what language implements a service. Nothing WASM-related is built this cycle; the boundary is the design.

## 2. Shell & theme (ported from morphir-scala)

Ported faithfully from `morphir/ui` in morphir-scala:

- **Design tokens:** the ~22 CSS custom properties (`bg`, `surface`, `panel`, `panel-edge`, `rail`, `edge`, `hover`, `text`, `muted`, `accent`, `accent2`, `accent-text`, `knob`, …), dark palette as default (`#0f0d14` base, magenta `#d6409f` → violet `#8b5cf6` accent gradient) and light palette; mono and sans font stacks.
- **Theming:** `theme-system` / `theme-light` / `theme-dark` classes on the shell root; system mode via `prefers-color-scheme`.
- **Quarantine CSS:** `-webkit-app-region` drag/no-drag, the `.no-motion *` transition kill switch, `col-resize`/`row-resize` cursors, active-nav inset shadow, `background-clip: text` gradient brand mark, box-sizing reset, `::selection`, scrollbar styling.
- **Chrome:** frameless window with app-drawn titlebar — gradient `morphir` wordmark + `DESKTOP` badge (`WEB` badge in the web build), breadcrumb, version chip, right/bottom panel toggles; macOS traffic lights as native overlay, inset 78px.
- **Regions:** left sidebar (clamped 180–420px), right inspector, bottom log; pointer-drag resize with clamped bounds per region; collapse animates extent to zero (320ms) rather than unmounting; all motion honors the animations toggle.
- **Icons:** the six stroked SVG glyphs (`sidebar`, `panelRight`, `panelBottom`, `gear`, `back`, `restore`), recolored via `currentColor`.
- **Navigation:** trimmed to **Overview** and **IR Explorer**, with the gear-to-settings route. The scala Knowledge/Intents entries were repo-specific demo content and are not ported; those slots return in later cycles as real experiences.

UI state lives in Svelte runes. A `shell-state` module owns region sizes/visibility, route, settings section, animation setting, and color scheme; it is hydrated from and persisted to config (unlike scala, which persisted nothing). Views are pure functions of props/state and never own persistence.

## 3. Services & data flow

Service interfaces (Effect) live in `@morphir/ui`; each app provides Layers:

| Service | Desktop Layer | Web Layer |
| --- | --- | --- |
| `ConfigService` | TOML at `$MORPHIR_HOME/ui/config.toml` via IPC | localStorage |
| `WorkspaceService` | native folder/file dialog, real filesystem, real recents | file picker / drag-drop of `morphir-ir.json` |
| `IrService` | shared isomorphic impl from `@morphir/ir` | same |
| `SecretService` | Electron `safeStorage` (OS-keychain-backed); encrypted blob in Electron `userData` (machine-local — keychain-encrypted blobs must not relocate with `MORPHIR_HOME`) | absent |
| `GitHubTokenService` | `paste` (PAT) and `ghCli` (`gh auth token`) sources | absent |

Capabilities absent on a platform hide their UI via capability checks on the provided Layers — no platform `if`s scattered through views.

**IPC (desktop):** mirrors the morphir-scala security posture exactly — `contextIsolation` on, a single `morphir-rpc` channel, a minimal preload exposing only `postMessage`/`onMessage`, strict CSP, JSON-RPC-shaped request/response wrapped in Effect on both ends. The renderer never touches Electron APIs.

**Opening a workspace:** dialog (or web file pick) → read `morphir-ir.json` → `@morphir/ir` decodes the distribution with Effect Schema → IR Explorer renders the packages → modules → definitions tree with a definitions filter (search text, Values/Types toggles). A malformed IR is a typed decode error rendered in-shell — never a crash. Recent workspaces persist to config.

**Token handling rules (inherited from morphir-scala's connector design):** exactly one named source is active — no fallback chain; the token value is wrapped in a `Token` type whose string rendering is always redacted (`Token(ghp_…abcd)`, recognizing `github_pat_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `ghp_` prefixes); the raw value never appears in logs, config, or UI after capture.

## 4. Config & GitHub token capture UX

Settings keeps the morphir-scala information architecture: a full-surface route (not a modal) reached from the sidebar gear; section list on the left with a Back row; stacked groups of `label / description / trailing` rows on the right; "Restore defaults" in the titlebar while in settings.

Sections:

- **General** — active workspace, recent workspaces (real, clickable), reopen-last-workspace-on-launch toggle.
- **Appearance** — color scheme picker with live miniature-shell preview cards (ported), panel-animations toggle.
- **GitHub** (new) — source picker (`None` / `gh CLI` / `Personal access token`); when PAT is selected, a password-style paste field; once saved, the token displays only in redacted form; a **Verify** button calls `GET https://api.github.com/user` and shows the authenticated login (or the failure); **Remove** clears the stored secret. The source choice persists to config; the PAT itself only to `safeStorage`.
- **About** — app version, package versions.

## 5. Testing, CI & packaging

TDD throughout (tests before implementation, per project rules).

- **Unit/service tests:** `bun test` for `@morphir/ir` decoding (golden `morphir-ir.json` fixtures generated from morphir-elm examples), config round-trips, token source logic, redaction.
- **Component tests:** Testing Library + happy-dom under `bun test` for shell behavior (region collapse/resize state, scheme switching, settings rows, capability hiding).
- **Desktop smoke:** ported from scala's `smoke.sh` concept — `MORPHIR_SMOKE=1` boots Electron headlessly, mounts the renderer, round-trips each IPC service, exits nonzero on failure or 90s hang.
- **CI:** GitHub Actions using mise + `moon ci`; jobs: lint (eslint with svelte plugin + prettier), typecheck (TS 7 native for `.ts`, `svelte-check` for `.svelte`), test, build web, package desktop (electron-builder: mac zip/dmg, win zip/nsis, linux tar.gz/AppImage/deb — unsigned), smoke.
- **Out of scope this cycle:** code signing/notarization, auto-update, i18n, publishing to registries.

## 6. morphir-scala retirement (post-parity)

After parity ships, a follow-up PR to morphir-scala:

- Removes only the Electron UI modules: `morphir/desktop`, `morphir/ui`, `morphir/appkit/electron`.
- Updates intents 0025 (Electron appkit), 0029 (morphir-ui), 0030 (desktop app), 0031 (publish desktop) to reflect supersession by finos/morphir-ui.
- Adds a README pointer to finos/morphir-ui as the home of Morphir desktop/web UI.

Everything else stays: `connector/github` (headless token plumbing), `langkit-markdown` (markdown→HTML, a future WASM/ScalaJS capability for morphir-ui), and appkit's non-Electron secret stores. morphir-scala continues as a library and capability-provider repository.

## Success criteria

1. `morphir-desktop` launches with the themed shell at morphir-scala visual parity (tokens, chrome, regions, motion, three-way theming).
2. Opening a real morphir-elm-produced `morphir-ir.json` renders a browsable packages → modules → definitions tree with filtering.
3. Settings persist across launches under `$MORPHIR_HOME/ui/config.toml`; restore-defaults works.
4. A PAT can be captured, is displayed only redacted, verifies against the GitHub API, and can be removed; `gh` CLI source works when `gh` is authenticated.
5. `morphir-web` serves the same shell with web-appropriate capabilities (file-pick IR loading; token UI hidden).
6. CI is green: lint, both typecheckers, tests, web build, unsigned desktop packages on all three OSes, headless smoke.
7. All work lands via PR to finos/morphir-ui with EasyCLA-compliant authorship.

## Later cycles (out of scope, recorded for continuity)

1. **morphir-elm visualization migration** — insight view, decision tables, value editor, XRay, dependency graph, as views in the shared shell.
2. **Morphir Live experiences** — workspace/project/model management and TOML settings editing from finos/morphir.
3. **CLI hosting integration** — the UI↔CLI protocol once the Morphir CLI extension/hosting story lands; the self-contained Layers become one implementation among several.
4. **Capability bindings** — WASM/ScalaJS-backed Layers (markdown rendering, IR operations) from morphir-scala / morphir-rust.
