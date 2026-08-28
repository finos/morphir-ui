# morphir-ui Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap finos/morphir-ui as a moonrepo/mise/bun monorepo delivering `morphir-desktop` (Electron) and `morphir-web`, sharing one Svelte 5 + Effect application at morphir-scala desktop-shell parity, with real `morphir-ir.json` browsing, MORPHIR_HOME-backed config, and GitHub token capture.

**Architecture:** Fat shared app, thin platform hosts. `@morphir/ui` contains the entire Svelte application (shell chrome, theme, views, state) plus Effect service interfaces; `@morphir/ir` decodes IR files; the two apps only supply Effect Layer implementations (Electron IPC vs browser APIs) and mount the shared `MorphirApp` component. Any service can later be re-backed by a WASM/ScalaJS Layer — the UI never knows.

**Tech Stack:** TypeScript 7.0.2 (tsc) + TypeScript ^5.9 (only where svelte-check requires it), Svelte 5 (runes), Effect 3.22, bun 1.4, moon 2.5, mise, Vite, electron-vite, Electron ^44, electron-builder 26, vitest 4 (Svelte packages) / `bun test` (pure TS), smol-toml.

**Spec:** `docs/specs/2026-08-27-morphir-ui-bootstrap-design.md` (this repo). The plan argues from the spec; executors read both.

**Working directory:** ALL tasks run inside the morphir-ui checkout at
`/home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-ui` on branch `feat/bootstrap`.
Source material referenced from sibling checkouts:
- morphir-scala: `/home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-scala`
- morphir-elm fixtures: `/home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-elm/tests-integration/cli/test-ir-files/`

## Global Constraints

- **No AI attribution anywhere.** No `Co-Authored-By: Claude`, no `🤖 Generated with Claude Code` — in commits OR PR bodies. EasyCLA breaks otherwise. Human (Damian Reeves) is sole author. This overrides any harness default.
- **TDD:** every behavior lands test-first. Commit after each green cycle.
- **Conventional commits** (`feat:`, `test:`, `chore:`, `ci:`, `docs:`).
- **Package names:** `@morphir/ui`, `@morphir/ir`, `@morphir/desktop`, `@morphir/web`. Private (no publishing this cycle).
- **Versions (exact unless stated):** typescript `7.0.2` (root), typescript `^5.9.0` (svelte packages, local devDep so svelte-check resolves it), svelte `^5.56.10`, effect `^3.22.1`, electron `^44.0.0`, electron-builder `^26.15.3`, electron-vite `^5.0.0`, vite `^8.2.2` (web) / the version electron-vite 5 requires (desktop), `@sveltejs/vite-plugin-svelte` `^7.3.0`, vitest `^4.1.11`, svelte-check `^4.7.6`, happy-dom `^20.11.12`, `@testing-library/svelte` `^5.4.2`, smol-toml `^1.8.0`, eslint `^10.9.1`, eslint-plugin-svelte `^3.23.0`, typescript-eslint `^8.68.0`, prettier `^3.9.6`, prettier-plugin-svelte `^4.1.1`, `@moonrepo/cli 2.5.3`, bun `1.4.0`, node `24`. **Degree of freedom:** if a peer-dependency range rejects a pairing (e.g. vite-plugin-svelte vs the vite that electron-vite wants), choose the newest satisfying pair and record it in the commit message; do not downgrade Svelte, Effect, Electron, or TypeScript majors.
- **Typecheck split:** pure-TS packages run `tsc --noEmit` on TS 7; Svelte packages run `svelte-check` (which needs its local TS 5). Both run in CI.
- **Design fidelity:** token values, CSS, redaction rules, IPC posture, and copy strings in this plan were extracted verbatim from morphir-scala — port them exactly; do not "improve" values (e.g. the `restore` icon is 15×15 while the others are 16×16 — keep it).
- **IR support:** `formatVersion: 3` only. v1/v2/missing produce the exact friendly errors specified in Task 2.
- **Secrets:** raw tokens never touch config files, logs, or the DOM after capture; only `safeStorage`-encrypted blobs on disk; renderer never holds the raw token after save.

## File Structure (end state)

```
morphir-ui/
├── .config/mise/config.toml          # bun, node, moon pins
├── .moon/workspace.yml               # project globs, vcs
├── .moon/toolchain.yml               # bun toolchain
├── .moon/tasks.yml                   # inherited lint/typecheck/test/build tasks
├── .github/workflows/ci.yml          # Task 16
├── package.json                      # bun workspaces root
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc.json  .prettierignore  .gitignore
├── packages/
│   ├── morphir-ir/                   # IR decoding, no UI deps (bun test)
│   │   ├── package.json  moon.yml  tsconfig.json
│   │   ├── src/index.ts  src/decode.ts  src/errors.ts  src/explorer.ts  src/names.ts
│   │   └── test/decode.test.ts  test/explorer.test.ts  test/fixtures/*.json
│   └── morphir-ui/                   # THE shared app (vitest)
│       ├── package.json  moon.yml  tsconfig.json  vite.config.ts
│       ├── src/index.ts
│       ├── src/theme/tokens.ts  src/theme/theme.css
│       ├── src/icons/icons.ts  src/icons/Icon.svelte
│       ├── src/state/shell-state.svelte.ts  src/state/workspace-state.svelte.ts
│       ├── src/services/token.ts  src/services/config.ts  src/services/services.ts
│       ├── src/shell/AppShell.svelte  Titlebar.svelte  Sidebar.svelte
│       │            RegionPanel.svelte  ResizeHandle.svelte  MorphirApp.svelte
│       ├── src/views/OverviewView.svelte  IrExplorerView.svelte
│       ├── src/views/settings/SettingsView.svelte  SettingsSidebar.svelte
│       │            SchemePicker.svelte  Toggle.svelte  SettingsRow.svelte
│       │            GeneralSection.svelte  AppearanceSection.svelte
│       │            GitHubSection.svelte  AboutSection.svelte
│       └── test/*.test.ts  test/support/fake-services.ts
├── apps/
│   ├── morphir-web/
│   │   ├── package.json  moon.yml  tsconfig.json  vite.config.ts  index.html
│   │   ├── src/main.ts  src/layers/browser-layers.ts
│   │   └── test/browser-layers.test.ts
│   └── morphir-desktop/
│       ├── package.json  moon.yml  tsconfig.json  tsconfig.node.json
│       ├── electron.vite.config.ts  electron-builder.yml
│       ├── src/main/index.ts  src/main/rpc.ts  src/main/config.ts
│       │            src/main/workspace.ts  src/main/secrets.ts  src/main/github.ts
│       ├── src/preload/index.ts
│       ├── src/renderer/index.html  src/renderer/src/main.ts
│       │            src/renderer/src/layers/rpc-client.ts  src/renderer/src/layers/desktop-layers.ts
│       └── test/config.test.ts  test/secrets.test.ts  test/github.test.ts  test/rpc.test.ts
└── docs/specs/…  docs/plans/…       # already committed
```

Out of scope this cycle (spec §5, §6): signing/notarization, auto-update, i18n, publishing, the morphir-scala retirement PR (separate follow-up after parity ships), umbrella-repo submodule bump (after merge).

---

### Task 1: Toolchain & workspace scaffold

**Files:**
- Create: `.config/mise/config.toml`, `.moon/workspace.yml`, `.moon/toolchain.yml`, `.moon/tasks.yml`, `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`

**Interfaces:**
- Produces: workspace-wide `moon run <project>:lint|typecheck|test|build` task contract — every later project defines package.json scripts `lint`, `typecheck`, `test`, `build`; moon inherits and runs them.

- [ ] **Step 1: Write tool + workspace config**

`.config/mise/config.toml`:
```toml
[tools]
bun = "1.4.0"
node = "24"
moon = "2.5.3"
```

`.moon/workspace.yml`:
```yaml
$schema: 'https://moonrepo.dev/schemas/workspace.json'
projects:
  - 'apps/*'
  - 'packages/*'
vcs:
  manager: 'git'
  defaultBranch: 'main'
```

`.moon/toolchain.yml`:
```yaml
$schema: 'https://moonrepo.dev/schemas/toolchain.json'
bun:
  version: '1.4.0'
```

`.moon/tasks.yml` (inherited by every project; each project supplies the scripts):
```yaml
$schema: 'https://moonrepo.dev/schemas/tasks.json'
tasks:
  lint:
    command: 'bun run lint'
  typecheck:
    command: 'bun run typecheck'
  test:
    command: 'bun run test'
  build:
    command: 'bun run build'
```

- [ ] **Step 2: Root package.json, tsconfig, lint/format config**

`package.json`:
```json
{
  "name": "morphir-ui-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.4.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "eslint": "^10.9.1",
    "typescript-eslint": "^8.68.0",
    "eslint-plugin-svelte": "^3.23.0",
    "globals": "^17.11.0",
    "prettier": "^3.9.6",
    "prettier-plugin-svelte": "^4.1.1",
    "@types/node": "^26.4.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`eslint.config.js`:
```js
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', '.moon/cache/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser }, globals: { ...globals.browser } }
  },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }
)
```
(`@eslint/js` comes with eslint 10; if it needs an explicit devDep, add `"@eslint/js": "^10.9.1"`.)

`.prettierrc.json`:
```json
{ "semi": false, "singleQuote": true, "printWidth": 100, "plugins": ["prettier-plugin-svelte"] }
```

`.prettierignore`:
```
dist
out
release
node_modules
.moon/cache
bun.lock
```

`.gitignore`:
```
node_modules/
dist/
out/
release/
coverage/
.moon/cache/
.moon/docker/
*.log
.DS_Store
```

- [ ] **Step 3: Verify toolchain resolves**

```bash
mise install && mise exec -- bun install && mise exec -- moon query projects
```
Expected: bun installs (creates `bun.lock`), `moon query projects` prints an empty project list (no apps/packages exist yet) without error. If moon's config schema rejects a key, fix to the current 2.x schema (`moon --version` = 2.5.3) — the intent of each key is documented above.

- [ ] **Step 4: Verify lint/format pass on empty workspace**

```bash
mise exec -- bun run lint && mise exec -- bun run format:check
```
Expected: both exit 0 (prettier check may need `--no-error-on-unmatched-pattern`; if so add it to the script).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold moon/mise/bun workspace with lint and typecheck config"
```

---

### Task 2: @morphir/ir — envelope decoding with friendly version errors

**Files:**
- Create: `packages/morphir-ir/package.json`, `moon.yml`, `tsconfig.json`, `src/index.ts`, `src/errors.ts`, `src/decode.ts`
- Create: `packages/morphir-ir/test/fixtures/` — copy from morphir-elm checkout: `base-ir.json`, `multilevelModules-ir.json`, `simpleTypeTree-ir.json`, `listType-ir.json` (paths under **Working directory** note above)
- Test: `packages/morphir-ir/test/decode.test.ts`

**Interfaces:**
- Produces:
  - `decodeMorphirIr(input: string): Effect.Effect<MorphirLibrary, IrError>` — parses+validates
  - `type MorphirLibrary = { packageName: Path; modules: ReadonlyArray<RawModule> }`
  - `type RawModule = { path: Path; access: 'Public' | 'Private'; types: ReadonlyArray<RawDefEntry>; values: ReadonlyArray<RawDefEntry> }`
  - `type RawDefEntry = { name: Name; access: 'Public' | 'Private'; doc: string | null }`
  - `type Name = ReadonlyArray<string>`; `type Path = ReadonlyArray<Name>`
  - `type IrError = InvalidJson | MissingFormatVersion | UnsupportedFormatVersion | InvalidIr` (all `Data.TaggedError` with `.message`)

- [ ] **Step 1: Package scaffold**

`packages/morphir-ir/package.json`:
```json
{
  "name": "@morphir/ir",
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
  "devDependencies": { "bun-types": "^1.4.0" }
}
```
(The package is consumed as TypeScript source via the `exports` map — Vite compiles it in the apps; `build` is a typecheck. This is deliberate: no dist step this cycle.)

`packages/morphir-ir/moon.yml`:
```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'
type: 'library'
language: 'typescript'
```

`packages/morphir-ir/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["bun-types"] },
  "include": ["src", "test"]
}
```

Copy fixtures:
```bash
cp /home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-elm/tests-integration/cli/test-ir-files/{base-ir.json,multilevelModules-ir.json,simpleTypeTree-ir.json,listType-ir.json} packages/morphir-ir/test/fixtures/
```

- [ ] **Step 2: Write the failing tests**

`packages/morphir-ir/test/decode.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import { decodeMorphirIr } from '../src/index.ts'

const fixture = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text()

describe('decodeMorphirIr', () => {
  test('decodes the minimal legal IR (zero modules)', async () => {
    const lib = await Effect.runPromise(decodeMorphirIr(await fixture('base-ir.json')))
    expect(lib.packageName).toEqual([['morphir'], ['example'], ['app']])
    expect(lib.modules).toHaveLength(0)
  })

  test('decodes multi-level module paths', async () => {
    const lib = await Effect.runPromise(decodeMorphirIr(await fixture('multilevelModules-ir.json')))
    expect(lib.modules).toHaveLength(2)
  })

  test('decodes types and values with access and doc', async () => {
    const lib = await Effect.runPromise(decodeMorphirIr(await fixture('simpleTypeTree-ir.json')))
    const forecast = lib.modules[0]!
    expect(forecast.path).toEqual([['forecast']])
    expect(forecast.access).toBe('Public')
    expect(forecast.types).toHaveLength(2)
    expect(forecast.types.map((t) => t.name)).toEqual([['celcius'], ['custom', 'report']])
    expect(forecast.values).toHaveLength(0)
  })

  test('rejects formatVersion 2 with the regenerate message', async () => {
    const v2 = JSON.stringify({ formatVersion: 2, distribution: ['Library', [], [], { modules: [] }] })
    const exit = await Effect.runPromiseExit(decodeMorphirIr(v2))
    expect(Exit.isFailure(exit)).toBe(true)
    const message = Exit.isFailure(exit) ? String(exit.cause) : ''
    expect(message).toContain('format version 2')
    expect(message).toContain('latest format version is 3')
  })

  test('rejects formatVersion 1 as legacy', async () => {
    const v1 = JSON.stringify({ formatVersion: 1, distribution: [] })
    const exit = await Effect.runPromiseExit(decodeMorphirIr(v1))
    expect(String(exit)).toContain('format version 1')
  })

  test('rejects a missing formatVersion with the regenerate message', async () => {
    const exit = await Effect.runPromiseExit(decodeMorphirIr('{"distribution": []}'))
    expect(String(exit)).toContain("doesn't have a format version")
  })

  test('rejects invalid JSON', async () => {
    const exit = await Effect.runPromiseExit(decodeMorphirIr('not json'))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests, verify failure**

```bash
cd packages/morphir-ir && bun test
```
Expected: FAIL — cannot resolve `../src/index.ts`.

- [ ] **Step 4: Implement**

`src/errors.ts`:
```ts
import { Data } from 'effect'

export class InvalidJson extends Data.TaggedError('InvalidJson')<{ readonly message: string }> {}

export class MissingFormatVersion extends Data.TaggedError('MissingFormatVersion')<{
  readonly message: string
}> {
  static make = () =>
    new MissingFormatVersion({
      message: "The IR is in an old format that doesn't have a format version on it. Please regenerate it!"
    })
}

export class UnsupportedFormatVersion extends Data.TaggedError('UnsupportedFormatVersion')<{
  readonly found: number
  readonly message: string
}> {
  static make = (found: number) =>
    new UnsupportedFormatVersion({
      found,
      message:
        found === 1
          ? 'The IR is using format version 1, a legacy format that morphir-ui does not support yet. Please regenerate it with a current morphir-elm!'
          : `The IR is using format version ${found} but the latest format version is 3. Please regenerate it!`
    })
}

export class InvalidIr extends Data.TaggedError('InvalidIr')<{ readonly message: string }> {}

export type IrError = InvalidJson | MissingFormatVersion | UnsupportedFormatVersion | InvalidIr
```

`src/decode.ts` — hand-rolled narrowing for the positional encodings (Effect Schema stays out of the tagged-tuple business on purpose; the shapes are simple and the error messages must be ours):
```ts
import { Effect } from 'effect'
import { InvalidIr, InvalidJson, MissingFormatVersion, UnsupportedFormatVersion, type IrError } from './errors.ts'

export type Name = ReadonlyArray<string>
export type Path = ReadonlyArray<Name>
export type Access = 'Public' | 'Private'
export interface RawDefEntry { readonly name: Name; readonly access: Access; readonly doc: string | null }
export interface RawModule {
  readonly path: Path
  readonly access: Access
  readonly types: ReadonlyArray<RawDefEntry>
  readonly values: ReadonlyArray<RawDefEntry>
}
export interface MorphirLibrary { readonly packageName: Path; readonly modules: ReadonlyArray<RawModule> }

const isName = (u: unknown): u is Name => Array.isArray(u) && u.every((p) => typeof p === 'string')
const isPath = (u: unknown): u is Path => Array.isArray(u) && u.every(isName)
const isAccess = (u: unknown): u is Access => u === 'Public' || u === 'Private'

const fail = (message: string) => new InvalidIr({ message })

function readDefEntry(entry: unknown, section: string): RawDefEntry {
  if (!Array.isArray(entry) || entry.length !== 2 || !isName(entry[0])) throw fail(`malformed ${section} entry`)
  const ac = entry[1] as Record<string, unknown>
  if (typeof ac !== 'object' || ac === null || !isAccess(ac['access'])) throw fail(`malformed ${section} access`)
  const documented = ac['value'] as Record<string, unknown> | undefined
  const doc =
    documented && typeof documented === 'object' && typeof documented['doc'] === 'string'
      ? documented['doc']
      : null
  return { name: entry[0], access: ac['access'], doc }
}

function readModule(entry: unknown): RawModule {
  if (!Array.isArray(entry) || entry.length !== 2 || !isPath(entry[0])) throw fail('malformed module entry')
  const ac = entry[1] as Record<string, unknown>
  if (typeof ac !== 'object' || ac === null || !isAccess(ac['access'])) throw fail('malformed module access')
  const def = ac['value'] as Record<string, unknown>
  if (typeof def !== 'object' || def === null) throw fail('malformed module definition')
  const types = Array.isArray(def['types']) ? def['types'].map((t) => readDefEntry(t, 'type')) : []
  const values = Array.isArray(def['values']) ? def['values'].map((v) => readDefEntry(v, 'value')) : []
  return { path: entry[0], access: ac['access'], types, values }
}

export const decodeMorphirIr = (input: string): Effect.Effect<MorphirLibrary, IrError> =>
  Effect.try({ try: () => JSON.parse(input) as unknown, catch: (e) => new InvalidJson({ message: String(e) }) }).pipe(
    Effect.flatMap((root) =>
      Effect.try({
        try: () => {
          if (typeof root !== 'object' || root === null) throw fail('IR root must be an object')
          const env = root as Record<string, unknown>
          if (!('formatVersion' in env)) throw MissingFormatVersion.make()
          if (env['formatVersion'] !== 3) throw UnsupportedFormatVersion.make(Number(env['formatVersion']))
          const dist = env['distribution']
          if (!Array.isArray(dist) || dist[0] !== 'Library') throw fail('expected a Library distribution')
          if (!isPath(dist[1])) throw fail('malformed package name')
          const pkgDef = dist[3] as Record<string, unknown>
          if (typeof pkgDef !== 'object' || pkgDef === null || !Array.isArray(pkgDef['modules']))
            throw fail('malformed package definition')
          return { packageName: dist[1], modules: pkgDef['modules'].map(readModule) }
        },
        catch: (e) =>
          e instanceof MissingFormatVersion || e instanceof UnsupportedFormatVersion || e instanceof InvalidIr
            ? e
            : new InvalidIr({ message: String(e) })
      })
    )
  )
```

`src/index.ts`:
```ts
export * from './decode.ts'
export * from './errors.ts'
```

- [ ] **Step 5: Run tests, verify pass; lint & typecheck**

```bash
cd packages/morphir-ir && bun test && bun run typecheck && cd ../.. && bun run lint
```
Expected: all PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ir): decode morphir-ir.json v3 envelope with friendly version errors"
```

---

### Task 3: @morphir/ir — explorer model and name formatting

**Files:**
- Create: `packages/morphir-ir/src/names.ts`, `src/explorer.ts`; extend `src/index.ts`
- Test: `packages/morphir-ir/test/explorer.test.ts`

**Interfaces:**
- Consumes: `MorphirLibrary`, `Name`, `Path` from Task 2.
- Produces:
  - `nameToTitle(name: Name): string` — `["custom","report"]` → `CustomReport`; single letters uppercase (`["u","s"]` → `US`); digit parts verbatim (`["f","r","2052","a"]` → `FR2052A`)
  - `nameToCamel(name: Name): string` — `["list","example"]` → `listExample`
  - `pathToTitle(path: Path): string` — names joined with `.` → `Morphir.Example.App`
  - `interface PackageInfo { name: string; moduleCount: number }`
  - `interface ModuleInfo { packageName: string; name: string; typeCount: number; valueCount: number }`
  - `type DefinitionKind = 'type' | 'value'`
  - `interface DefinitionRef { packageName: string; moduleName: string; localName: string }`
  - `interface DefinitionInfo { ref: DefinitionRef; kind: DefinitionKind; access: 'Public' | 'Private'; doc: string | null }`
  - `interface WorkspaceIr { package: PackageInfo; modules: ReadonlyArray<ModuleInfo>; definitions: ReadonlyArray<DefinitionInfo> }`
  - `toWorkspaceIr(lib: MorphirLibrary): WorkspaceIr`

- [ ] **Step 1: Write the failing tests**

`packages/morphir-ir/test/explorer.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { decodeMorphirIr, nameToCamel, nameToTitle, pathToTitle, toWorkspaceIr } from '../src/index.ts'

const load = async (name: string) =>
  toWorkspaceIr(
    await Effect.runPromise(
      decodeMorphirIr(await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text())
    )
  )

describe('name formatting', () => {
  test('title-cases word parts', () => expect(nameToTitle(['custom', 'report'])).toBe('CustomReport'))
  test('uppercases single letters', () => expect(nameToTitle(['u', 's'])).toBe('US'))
  test('keeps digit parts verbatim', () => expect(nameToTitle(['f', 'r', '2052', 'a'])).toBe('FR2052A'))
  test('camel-cases values', () => expect(nameToCamel(['list', 'example'])).toBe('listExample'))
  test('joins paths with dots', () =>
    expect(pathToTitle([['morphir'], ['example'], ['app']])).toBe('Morphir.Example.App'))
})

describe('toWorkspaceIr', () => {
  test('summarizes the package', async () => {
    const ws = await load('simpleTypeTree-ir.json')
    expect(ws.package).toEqual({ name: 'Morphir.Example.App', moduleCount: 1 })
  })

  test('summarizes modules with counts', async () => {
    const ws = await load('simpleTypeTree-ir.json')
    expect(ws.modules[0]).toEqual({
      packageName: 'Morphir.Example.App',
      name: 'Forecast',
      typeCount: 2,
      valueCount: 0
    })
  })

  test('formats multi-segment module names', async () => {
    const ws = await load('multilevelModules-ir.json')
    expect(ws.modules.map((m) => m.name)).toEqual(['US.FR2052A', 'US.FR2052A.DataTables'])
  })

  test('lists definitions with refs, kinds and camel-cased value names', async () => {
    const ws = await load('listType-ir.json')
    const kinds = new Set(ws.definitions.map((d) => d.kind))
    expect(kinds).toEqual(new Set(['type', 'value']))
    const value = ws.definitions.find((d) => d.kind === 'value')!
    expect(value.ref.localName).toBe('listExample')
    expect(value.ref.moduleName).toBe('Forecast')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/morphir-ir && bun test test/explorer.test.ts
```
Expected: FAIL — `nameToTitle` etc. not exported.

- [ ] **Step 3: Implement**

`src/names.ts`:
```ts
import type { Name, Path } from './decode.ts'

const isDigits = (part: string) => /^\d+$/.test(part)
const cap = (part: string) =>
  isDigits(part) ? part : part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)

export const nameToTitle = (name: Name): string => name.map(cap).join('')

export const nameToCamel = (name: Name): string =>
  name.map((part, i) => (i === 0 ? part : cap(part))).join('')

export const pathToTitle = (path: Path): string => path.map(nameToTitle).join('.')
```

`src/explorer.ts`:
```ts
import type { MorphirLibrary } from './decode.ts'
import { nameToCamel, nameToTitle, pathToTitle } from './names.ts'

export interface PackageInfo { readonly name: string; readonly moduleCount: number }
export interface ModuleInfo {
  readonly packageName: string
  readonly name: string
  readonly typeCount: number
  readonly valueCount: number
}
export type DefinitionKind = 'type' | 'value'
export interface DefinitionRef {
  readonly packageName: string
  readonly moduleName: string
  readonly localName: string
}
export interface DefinitionInfo {
  readonly ref: DefinitionRef
  readonly kind: DefinitionKind
  readonly access: 'Public' | 'Private'
  readonly doc: string | null
}
export interface WorkspaceIr {
  readonly package: PackageInfo
  readonly modules: ReadonlyArray<ModuleInfo>
  readonly definitions: ReadonlyArray<DefinitionInfo>
}

export const toWorkspaceIr = (lib: MorphirLibrary): WorkspaceIr => {
  const packageName = pathToTitle(lib.packageName)
  const modules = lib.modules.map((m) => ({
    packageName,
    name: pathToTitle(m.path),
    typeCount: m.types.length,
    valueCount: m.values.length
  }))
  const definitions = lib.modules.flatMap((m) => {
    const moduleName = pathToTitle(m.path)
    const mk = (kind: DefinitionKind) => (entry: (typeof m.types)[number]) => ({
      ref: {
        packageName,
        moduleName,
        localName: kind === 'type' ? nameToTitle(entry.name) : nameToCamel(entry.name)
      },
      kind,
      access: entry.access,
      doc: entry.doc
    })
    return [...m.types.map(mk('type')), ...m.values.map(mk('value'))]
  })
  return { package: { name: packageName, moduleCount: modules.length }, modules, definitions }
}
```

Add to `src/index.ts`:
```ts
export * from './names.ts'
export * from './explorer.ts'
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd packages/morphir-ir && bun test && bun run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ir): explorer model with morphir name formatting"
```

---

### Task 4: @morphir/ui — package scaffold, design tokens, generated theme.css

**Files:**
- Create: `packages/morphir-ui/package.json`, `moon.yml`, `tsconfig.json`, `vite.config.ts`
- Create: `packages/morphir-ui/src/theme/tokens.ts`, `src/theme/generate.ts`, `src/theme/theme.css` (generated), `src/index.ts`, `scripts/gen-theme.ts`
- Test: `packages/morphir-ui/test/theme.test.ts`

**Interfaces:**
- Produces:
  - `darkTokens` / `lightTokens`: `ReadonlyArray<readonly [string, string]>` (ordered pairs, verbatim below)
  - `MONO_FONT`, `SANS_FONT`, `TRAFFIC_LIGHT_INSET = 78`, `SLIDE_MS = 320`
  - `renderThemeCss(): string`; `@morphir/ui/theme.css` export consumed by both apps
  - Task contract: `bun run gen:theme` regenerates `theme.css`; the test fails on drift.

- [ ] **Step 1: Package scaffold**

`packages/morphir-ui/package.json`:
```json
{
  "name": "@morphir/ui",
  "private": true,
  "type": "module",
  "svelte": "./src/index.ts",
  "exports": {
    ".": { "svelte": "./src/index.ts", "default": "./src/index.ts" },
    "./theme.css": "./src/theme/theme.css",
    "./token": "./src/services/token.ts",
    "./config": "./src/services/config.ts"
  },
  "scripts": {
    "lint": "eslint src test",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "build": "svelte-check --tsconfig ./tsconfig.json",
    "gen:theme": "bun scripts/gen-theme.ts"
  },
  "dependencies": {
    "@morphir/ir": "workspace:*",
    "effect": "^3.22.1"
  },
  "peerDependencies": { "svelte": "^5.56.10" },
  "devDependencies": {
    "svelte": "^5.56.10",
    "svelte-check": "^4.7.6",
    "typescript": "^5.9.0",
    "vite": "^8.2.2",
    "vitest": "^4.1.11",
    "@sveltejs/vite-plugin-svelte": "^7.3.0",
    "happy-dom": "^20.11.12",
    "@testing-library/svelte": "^5.4.2"
  }
}
```
(The local `typescript ^5.9.0` devDep exists ONLY so svelte-check resolves TS 5.x while the root stays on 7.0.2 — Global Constraints.)

`packages/morphir-ui/moon.yml`:
```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'
type: 'library'
language: 'typescript'
```

`packages/morphir-ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["svelte", "vite/client"], "noEmit": true },
  "include": ["src/**/*.ts", "src/**/*.svelte", "test/**/*.ts", "scripts/**/*.ts"]
}
```

`packages/morphir-ui/vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  test: { environment: 'happy-dom', include: ['test/**/*.test.ts'] },
  resolve: { conditions: ['browser'] }
})
```

- [ ] **Step 2: Write the failing test**

`packages/morphir-ui/test/theme.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { darkTokens, lightTokens, renderThemeCss, SLIDE_MS, TRAFFIC_LIGHT_INSET } from '../src/index.ts'

const themeCss = readFileSync(new URL('../src/theme/theme.css', import.meta.url), 'utf8')

describe('theme', () => {
  test('theme.css is exactly the generator output (no drift)', () => {
    expect(themeCss).toBe(renderThemeCss())
  })

  test('every dark token is emitted at :root and .theme-dark', () => {
    for (const [name, value] of darkTokens) {
      expect(themeCss).toContain(`--${name}: ${value};`)
    }
    expect(themeCss).toContain(':root {')
    expect(themeCss).toContain('.theme-dark {')
  })

  test('every light token is emitted for .theme-light and .theme-system', () => {
    for (const [name, value] of lightTokens) {
      expect(themeCss).toContain(`--${name}: ${value};`)
    }
    expect(themeCss).toContain('.theme-light {')
    expect(themeCss).toContain('@media (prefers-color-scheme: dark)')
  })

  test('palettes cover the same token names', () => {
    expect(darkTokens.map(([n]) => n)).toEqual(lightTokens.map(([n]) => n))
  })

  test('quarantine rules survive generation', () => {
    expect(themeCss).toContain('-webkit-app-region: drag')
    expect(themeCss).toContain('.no-motion *')
    expect(themeCss).toContain('background-clip: text')
    expect(themeCss).toContain('box-shadow: inset 2px 0 0 var(--accent)')
  })

  test('constants match morphir-scala', () => {
    expect(TRAFFIC_LIGHT_INSET).toBe(78)
    expect(SLIDE_MS).toBe(320)
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
cd packages/morphir-ui && bun install && bun run test
```
Expected: FAIL — module `../src/index.ts` missing.

- [ ] **Step 4: Implement tokens (VERBATIM from morphir-scala `Tokens.scala`)**

`src/theme/tokens.ts`:
```ts
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, monospace'
export const SANS_FONT = '-apple-system, "Segoe UI", system-ui, sans-serif'

/** Clearance for the macOS traffic lights (px). */
export const TRAFFIC_LIGHT_INSET = 78

/** How long a shell region takes to slide in or out (ms). */
export const SLIDE_MS = 320

type TokenPairs = ReadonlyArray<readonly [string, string]>

export const darkTokens: TokenPairs = [
  ['bg', '#0f0d14'],
  ['surface', '#16131d'],
  ['panel', '#1a1622'],
  ['panel-edge', '#2a2438'],
  ['rail', '#121017'],
  ['edge', '#241f30'],
  ['row-edge', '#221d2e'],
  ['head-edge', '#1d1828'],
  ['hover', '#1f1a29'],
  ['hover-soft', '#1a1622'],
  ['code-bg', '#131019'],
  ['text', '#e8e4f1'],
  ['text-strong', '#ffffff'],
  ['muted', '#8d849e'],
  ['muted2', '#6f6785'],
  ['nav', '#a89fbe'],
  ['dot', '#3d3550'],
  ['accent', '#d6409f'],
  ['accent2', '#8b5cf6'],
  ['accent-text', '#f2b7dd'],
  ['knob', '#ffffff'],
  ['mono', MONO_FONT]
]

export const lightTokens: TokenPairs = [
  ['bg', '#f6f4fa'],
  ['surface', '#ffffff'],
  ['panel', '#ffffff'],
  ['panel-edge', '#e4dff0'],
  ['rail', '#f0edf7'],
  ['edge', '#e0daee'],
  ['row-edge', '#ebe6f4'],
  ['head-edge', '#e4dff0'],
  ['hover', '#eae5f5'],
  ['hover-soft', '#f0ecf8'],
  ['code-bg', '#f4f1fa'],
  ['text', '#1c1726'],
  ['text-strong', '#0f0d14'],
  ['muted', '#6c6484'],
  ['muted2', '#847c9c'],
  ['nav', '#4a4360'],
  ['dot', '#c9c1de'],
  ['accent', '#c02e8c'],
  ['accent2', '#7c4ddb'],
  ['accent-text', '#9c2f77'],
  ['knob', '#ffffff'],
  ['mono', MONO_FONT]
]
```

`src/theme/generate.ts` (base + quarantine CSS verbatim from `Base.scala` / `Theme.scala`; scheme emission mirrors `Tokens.sheet`: dark at `:root`, dark on `.theme-dark`, light on `.theme-light`, light as `.theme-system` base with a dark media override):
```ts
import { darkTokens, lightTokens, SANS_FONT } from './tokens.ts'

const block = (selector: string, pairs: typeof darkTokens, indent = '') =>
  `${indent}${selector} {\n${pairs.map(([n, v]) => `${indent}  --${n}: ${v};`).join('\n')}\n${indent}}`

const BASE_CSS = `/* Global resets (ported from morphir-scala theme/Base.scala). */
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  -webkit-font-smoothing: antialiased;
  background: var(--bg); color: var(--text);
  font-size: 14px; line-height: 1.55;
  font-family: ${SANS_FONT};
}
::selection { background: rgba(214, 64, 159, 0.35); }
::-webkit-scrollbar { width: 10px; }
::-webkit-scrollbar-thumb { background: #2a2438; border-radius: 5px; }`

const QUARANTINE_CSS = `/* Quarantine CSS (ported from morphir-scala Theme.scala). */
.titlebar { -webkit-app-region: drag; }
.icon-btn, .nav-item, .chip { -webkit-app-region: no-drag; }
.content {
  flex: 1; overflow: auto; padding: 22px;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px;
  align-content: start;
}
.content.content-settings { grid-template-columns: minmax(0, 1fr); gap: 0; }
.no-motion *, .no-motion *::before, .no-motion *::after {
  transition: none !important; animation: none !important;
}
.resize-vertical { cursor: col-resize; }
.resize-horizontal { cursor: row-resize; }
body.resizing-col, body.resizing-col * { cursor: col-resize; user-select: none; }
body.resizing-row, body.resizing-row * { cursor: row-resize; user-select: none; }
.nav-item.active { box-shadow: inset 2px 0 0 var(--accent); }
.brand-mark {
  background: linear-gradient(120deg, var(--accent), var(--accent2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}`

export const renderThemeCss = (): string =>
  [
    '/* GENERATED by `bun run gen:theme` — edit tokens.ts / generate.ts, not this file. */',
    block(':root', darkTokens),
    block('.theme-dark', darkTokens),
    block('.theme-light', lightTokens),
    block('.theme-system', lightTokens),
    `@media (prefers-color-scheme: dark) {\n${block('.theme-system', darkTokens, '  ')}\n}`,
    BASE_CSS,
    QUARANTINE_CSS,
    ''
  ].join('\n\n')
```

`scripts/gen-theme.ts`:
```ts
import { renderThemeCss } from '../src/theme/generate.ts'
await Bun.write(new URL('../src/theme/theme.css', import.meta.url), renderThemeCss())
console.log('theme.css regenerated')
```

`src/index.ts` (grows in later tasks):
```ts
export * from './theme/tokens.ts'
export { renderThemeCss } from './theme/generate.ts'
```

Generate the file:
```bash
bun run gen:theme
```

- [ ] **Step 5: Run tests, verify pass**

```bash
bun run test && bun run typecheck
```
Expected: PASS. (First `svelte-check` run validates the TS-5-local resolution — if it picks up root TS 7 and errors, check that `packages/morphir-ui/node_modules/typescript` exists.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): port morphir-scala design tokens and generated theme stylesheet"
```

---

### Task 5: @morphir/ui — ShellState (runes)

**Files:**
- Create: `packages/morphir-ui/src/state/shell-constants.ts` (pure TS — NO runes; the Electron main process imports the `@morphir/ui/config` chain, which must never touch Svelte), `packages/morphir-ui/src/state/shell-state.svelte.ts`; extend `src/index.ts`
- Test: `packages/morphir-ui/test/shell-state.test.ts`

**Interfaces:**
- Consumes: `SLIDE_MS` (Task 4).
- Produces:
  - `type ColorScheme = 'system' | 'light' | 'dark'`; `SCHEME_CLASSES: Record<ColorScheme, string>` → `theme-system|theme-light|theme-dark`; `SCHEME_LABELS` → `System|Light|Dark`
  - `type SettingsSection = 'general' | 'appearance' | 'github' | 'about'`
  - `type Route = { kind: 'workspace' } | { kind: 'settings'; section: SettingsSection }`
  - `PANEL_BOUNDS = { left: {min:180,max:420}, right: {min:220,max:560}, bottom: {min:120,max:460} }`
  - `SHELL_DEFAULTS = { leftWidth: 224, rightWidth: 300, bottomHeight: 180, colorScheme: 'dark' }`
  - `interface ShellSnapshot { appearance: { colorScheme: ColorScheme; animations: boolean }; shell: { leftWidth: number; rightWidth: number; bottomHeight: number; leftVisible: boolean; rightVisible: boolean; bottomVisible: boolean } }`
  - `class ShellState` — fields `leftVisible/rightVisible/bottomVisible: boolean`, `leftWidth/rightWidth/bottomHeight: number`, `animations: boolean`, `colorScheme: ColorScheme`, `route: Route`; getters `leftExtent/rightExtent/bottomExtent` (0 when hidden), `schemeClass`, `isSettings`; methods `toggleLeft/toggleRight/toggleBottom()`, `resizeLeft/resizeRight/resizeBottom(px)` (clamped), `openSettings(section?)`, `closeSettings()`, `selectSettingsSection(section)`, `selectColorScheme(scheme)`, `toggleAnimations()`, `restoreDefaults()`, `snapshot(): ShellSnapshot`, `hydrate(snap: ShellSnapshot)`

- [ ] **Step 1: Write the failing tests**

`packages/morphir-ui/test/shell-state.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { PANEL_BOUNDS, SHELL_DEFAULTS, ShellState } from '../src/index.ts'

describe('ShellState', () => {
  test('defaults match morphir-scala ShellDefaults', () => {
    const s = new ShellState()
    expect([s.leftWidth, s.rightWidth, s.bottomHeight]).toEqual([224, 300, 180])
    expect(s.colorScheme).toBe('dark')
    expect(s.animations).toBe(true)
    expect(s.route).toEqual({ kind: 'workspace' })
    expect(s.schemeClass).toBe('theme-dark')
  })

  test('collapsed regions report zero extent and toggle back', () => {
    const s = new ShellState()
    s.toggleLeft()
    expect(s.leftExtent).toBe(0)
    s.toggleLeft()
    expect(s.leftExtent).toBe(224)
  })

  test('resize clamps to PanelBounds', () => {
    const s = new ShellState()
    s.resizeLeft(10)
    expect(s.leftWidth).toBe(PANEL_BOUNDS.left.min)
    s.resizeLeft(9999)
    expect(s.leftWidth).toBe(PANEL_BOUNDS.left.max)
    s.resizeBottom(300)
    expect(s.bottomHeight).toBe(300)
  })

  test('settings routing', () => {
    const s = new ShellState()
    s.openSettings()
    expect(s.route).toEqual({ kind: 'settings', section: 'general' })
    s.selectSettingsSection('github')
    expect(s.route).toEqual({ kind: 'settings', section: 'github' })
    s.closeSettings()
    expect(s.isSettings).toBe(false)
  })

  test('restoreDefaults resets layout, motion and scheme but not route', () => {
    const s = new ShellState()
    s.toggleRight()
    s.resizeLeft(400)
    s.selectColorScheme('light')
    s.toggleAnimations()
    s.openSettings('appearance')
    s.restoreDefaults()
    expect(s.rightVisible).toBe(true)
    expect(s.leftWidth).toBe(SHELL_DEFAULTS.leftWidth)
    expect(s.colorScheme).toBe(SHELL_DEFAULTS.colorScheme)
    expect(s.animations).toBe(true)
    expect(s.isSettings).toBe(true)
  })

  test('snapshot/hydrate round-trips and clamps', () => {
    const s = new ShellState()
    s.resizeRight(400)
    s.selectColorScheme('system')
    s.toggleBottom()
    const snap = s.snapshot()
    const t = new ShellState()
    t.hydrate(snap)
    expect(t.rightWidth).toBe(400)
    expect(t.colorScheme).toBe('system')
    expect(t.bottomVisible).toBe(false)
    t.hydrate({ ...snap, shell: { ...snap.shell, leftWidth: 5 } })
    expect(t.leftWidth).toBe(PANEL_BOUNDS.left.min)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun run test` → FAIL (ShellState not exported).

- [ ] **Step 3: Implement**

`src/state/shell-constants.ts` (pure TS — no runes):
```ts
export type ColorScheme = 'system' | 'light' | 'dark'
export type SettingsSection = 'general' | 'appearance' | 'github' | 'about'
export type Route = { kind: 'workspace' } | { kind: 'settings'; section: SettingsSection }

export const SCHEME_CLASSES: Record<ColorScheme, string> = {
  system: 'theme-system',
  light: 'theme-light',
  dark: 'theme-dark'
}
export const SCHEME_LABELS: Record<ColorScheme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

export interface PanelBounds { readonly min: number; readonly max: number }
export const PANEL_BOUNDS = {
  left: { min: 180, max: 420 },
  right: { min: 220, max: 560 },
  bottom: { min: 120, max: 460 }
} as const satisfies Record<string, PanelBounds>

export const SHELL_DEFAULTS = {
  leftWidth: 224,
  rightWidth: 300,
  bottomHeight: 180,
  colorScheme: 'dark' as ColorScheme
}

export interface ShellSnapshot {
  appearance: { colorScheme: ColorScheme; animations: boolean }
  shell: {
    leftWidth: number
    rightWidth: number
    bottomHeight: number
    leftVisible: boolean
    rightVisible: boolean
    bottomVisible: boolean
  }
}

export const clampPanel = (px: number, bounds: PanelBounds): number =>
  Math.max(bounds.min, Math.min(bounds.max, Math.round(px)))
```

`src/state/shell-state.svelte.ts`:
```ts
import {
  PANEL_BOUNDS,
  SCHEME_CLASSES,
  SHELL_DEFAULTS,
  clampPanel as clamp,
  type ColorScheme,
  type Route,
  type SettingsSection,
  type ShellSnapshot
} from './shell-constants.ts'

export * from './shell-constants.ts'

export class ShellState {
  leftVisible = $state(true)
  rightVisible = $state(true)
  bottomVisible = $state(true)
  leftWidth = $state(SHELL_DEFAULTS.leftWidth)
  rightWidth = $state(SHELL_DEFAULTS.rightWidth)
  bottomHeight = $state(SHELL_DEFAULTS.bottomHeight)
  animations = $state(true)
  colorScheme = $state<ColorScheme>(SHELL_DEFAULTS.colorScheme)
  route = $state<Route>({ kind: 'workspace' })

  get leftExtent() { return this.leftVisible ? this.leftWidth : 0 }
  get rightExtent() { return this.rightVisible ? this.rightWidth : 0 }
  get bottomExtent() { return this.bottomVisible ? this.bottomHeight : 0 }
  get schemeClass() { return SCHEME_CLASSES[this.colorScheme] }
  get isSettings() { return this.route.kind === 'settings' }

  toggleLeft() { this.leftVisible = !this.leftVisible }
  toggleRight() { this.rightVisible = !this.rightVisible }
  toggleBottom() { this.bottomVisible = !this.bottomVisible }
  resizeLeft(px: number) { this.leftWidth = clamp(px, PANEL_BOUNDS.left) }
  resizeRight(px: number) { this.rightWidth = clamp(px, PANEL_BOUNDS.right) }
  resizeBottom(px: number) { this.bottomHeight = clamp(px, PANEL_BOUNDS.bottom) }
  openSettings(section: SettingsSection = 'general') { this.route = { kind: 'settings', section } }
  closeSettings() { this.route = { kind: 'workspace' } }
  selectSettingsSection(section: SettingsSection) { this.route = { kind: 'settings', section } }
  selectColorScheme(scheme: ColorScheme) { this.colorScheme = scheme }
  toggleAnimations() { this.animations = !this.animations }

  restoreDefaults() {
    this.leftVisible = this.rightVisible = this.bottomVisible = true
    this.leftWidth = SHELL_DEFAULTS.leftWidth
    this.rightWidth = SHELL_DEFAULTS.rightWidth
    this.bottomHeight = SHELL_DEFAULTS.bottomHeight
    this.animations = true
    this.colorScheme = SHELL_DEFAULTS.colorScheme
  }

  snapshot(): ShellSnapshot {
    return {
      appearance: { colorScheme: this.colorScheme, animations: this.animations },
      shell: {
        leftWidth: this.leftWidth,
        rightWidth: this.rightWidth,
        bottomHeight: this.bottomHeight,
        leftVisible: this.leftVisible,
        rightVisible: this.rightVisible,
        bottomVisible: this.bottomVisible
      }
    }
  }

  hydrate(snap: ShellSnapshot) {
    this.colorScheme = snap.appearance.colorScheme
    this.animations = snap.appearance.animations
    this.leftWidth = clamp(snap.shell.leftWidth, PANEL_BOUNDS.left)
    this.rightWidth = clamp(snap.shell.rightWidth, PANEL_BOUNDS.right)
    this.bottomHeight = clamp(snap.shell.bottomHeight, PANEL_BOUNDS.bottom)
    this.leftVisible = snap.shell.leftVisible
    this.rightVisible = snap.shell.rightVisible
    this.bottomVisible = snap.shell.bottomVisible
  }
}
```

Add to `src/index.ts`:
```ts
export * from './state/shell-state.svelte.ts'
```

- [ ] **Step 4: Run tests, verify pass** — `bun run test && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): shell state with panel bounds, routing, scheme and snapshot"
```

---

### Task 6: @morphir/ui — shell chrome components

**Files:**
- Create: `packages/morphir-ui/src/icons/icons.ts`, `src/icons/Icon.svelte`, `src/shell/Titlebar.svelte`, `src/shell/Sidebar.svelte`, `src/shell/RegionPanel.svelte`, `src/shell/ResizeHandle.svelte`, `src/shell/AppShell.svelte`; extend `src/index.ts`
- Test: `packages/morphir-ui/test/app-shell.test.ts`

**Interfaces:**
- Consumes: `ShellState`, `SLIDE_MS`, `TRAFFIC_LIGHT_INSET`.
- Produces:
  - `interface NavItem { id: string; label: string }`
  - `icons: Record<'sidebar'|'panelRight'|'panelBottom'|'gear'|'back'|'restore', string>` (raw SVG strings)
  - `Icon.svelte` props: `{ name: keyof typeof icons }`
  - `AppShell.svelte` props: `{ shell: ShellState; badge: string; version: string; crumbTitle: string; navItems: NavItem[]; activeNav: string; onNavSelect: (id: string) => void; onOpenSettings: () => void; center?: Snippet; inspector?: Snippet; log?: Snippet }`
  - Element ids preserved from scala: `titlebar`, `sidebar-toggle`, `bottom-toggle`, `right-toggle`, `app-version`, `restore-defaults`, `settings-button`

- [ ] **Step 1: Write icons (VERBATIM geometry from `Icons.scala`)**

`src/icons/icons.ts`:
```ts
const rect = '<rect fill="none" stroke="currentColor" stroke-width="1.6" x="3" y="3" width="18" height="18" rx="3"/>'
const line = (x1: number, y1: number, x2: number, y2: number) =>
  `<line stroke="currentColor" stroke-width="1.6" stroke-linecap="round" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
const svg = (size: number, body: string) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`

export const icons = {
  sidebar: svg(16, rect + line(9.5, 3, 9.5, 21) + line(5.5, 8, 7, 8) + line(5.5, 12, 7, 12)),
  panelRight: svg(16, rect + line(14.5, 3, 14.5, 21)),
  panelBottom: svg(16, rect + line(3, 14.5, 21, 14.5)),
  gear: svg(
    16,
    '<path fill="none" stroke="currentColor" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle fill="none" stroke="currentColor" stroke-width="2.0" cx="12" cy="12" r="3"/>'
  ),
  back: svg(
    16,
    line(19, 12, 5, 12) +
      '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 19l-7-7 7-7"/>'
  ),
  // NOTE: restore renders at 15×15 in morphir-scala — keep it.
  restore: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M3 3v5h5"/></svg>`
} as const

export type IconName = keyof typeof icons
```

`src/icons/Icon.svelte`:
```svelte
<script lang="ts">
  import { icons, type IconName } from './icons.ts'
  let { name }: { name: IconName } = $props()
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- static, package-internal SVG strings -->
{@html icons[name]}
```

- [ ] **Step 2: Write the failing component tests**

`packages/morphir-ui/test/app-shell.test.ts`:
```ts
import { render, screen } from '@testing-library/svelte'
import { describe, expect, test } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import AppShell from '../src/shell/AppShell.svelte'
import { ShellState } from '../src/index.ts'

const renderShell = (shell = new ShellState()) =>
  render(AppShell, {
    props: {
      shell,
      badge: 'DESKTOP',
      version: '1.2.3',
      crumbTitle: 'Overview',
      navItems: [
        { id: 'overview', label: 'Overview' },
        { id: 'explorer', label: 'IR Explorer' }
      ],
      activeNav: 'overview',
      onNavSelect: () => {},
      onOpenSettings: () => {}
    }
  })

describe('AppShell chrome', () => {
  test('renders brand, badge and version chip', () => {
    renderShell()
    expect(screen.getByText('morphir')).toBeTruthy()
    expect(screen.getByText('DESKTOP')).toBeTruthy()
    expect(document.getElementById('app-version')!.textContent).toBe('v1.2.3')
  })

  test('renders nav items with active state and dots', () => {
    renderShell()
    const active = screen.getByText('Overview').closest('.nav-item')!
    expect(active.classList.contains('active')).toBe(true)
    expect(active.querySelector('.nav-dot')).toBeTruthy()
    expect(screen.getByText('Workspace')).toBeTruthy()
  })

  test('root carries the scheme class and no-motion toggles', async () => {
    const shell = new ShellState()
    const { container } = renderShell(shell)
    const root = container.querySelector('.shell')!
    expect(root.classList.contains('theme-dark')).toBe(true)
    shell.selectColorScheme('light')
    await Promise.resolve()
    expect(root.classList.contains('theme-light')).toBe(true)
    shell.toggleAnimations()
    await Promise.resolve()
    expect(root.classList.contains('no-motion')).toBe(true)
  })

  test('sidebar toggle collapses the left region to zero extent', async () => {
    const shell = new ShellState()
    const { container } = renderShell(shell)
    await userEvent.click(document.getElementById('sidebar-toggle')!)
    expect(shell.leftVisible).toBe(false)
    const left = container.querySelector('[data-region="left"]') as HTMLElement
    expect(left.style.width).toBe('0px')
  })

  test('settings route swaps panel toggles for Restore defaults and Settings crumb', async () => {
    const shell = new ShellState()
    shell.openSettings()
    renderShell(shell)
    expect(document.getElementById('restore-defaults')).toBeTruthy()
    expect(screen.getByText('Restore defaults')).toBeTruthy()
    expect(screen.getByText(/^Settings \//)).toBeTruthy()
    expect(document.getElementById('right-toggle')).toBeNull()
  })
})
```
Add devDep to `packages/morphir-ui/package.json`: `"@testing-library/user-event": "^14.6.0"`.

- [ ] **Step 3: Run to verify failure** — `bun install && bun run test` → FAIL (AppShell.svelte missing).

- [ ] **Step 4: Implement the components**

`src/shell/ResizeHandle.svelte` — 5px strip; drag calls `onResize(px)` with the new size computed from the drag start:
```svelte
<script lang="ts">
  let {
    edge,
    currentSize,
    onResize
  }: { edge: 'left' | 'right' | 'bottom'; currentSize: number; onResize: (px: number) => void } = $props()
  const vertical = edge !== 'bottom'
  let start = 0
  let startSize = 0

  function down(e: PointerEvent) {
    start = vertical ? e.clientX : e.clientY
    startSize = currentSize
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    document.body.classList.add(vertical ? 'resizing-col' : 'resizing-row')
  }
  function move(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    const delta = (vertical ? e.clientX : e.clientY) - start
    onResize(edge === 'left' ? startSize + delta : startSize - delta)
  }
  function up(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    document.body.classList.remove('resizing-col', 'resizing-row')
  }
</script>

<div
  class="resize-handle {vertical ? 'resize-vertical' : 'resize-horizontal'}"
  role="separator"
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
></div>

<style>
  .resize-handle { flex: 0 0 5px; align-self: stretch; }
  .resize-handle:hover { background: var(--edge); }
</style>
```

`src/shell/RegionPanel.svelte` — animated extent; collapse animates to 0 without unmounting:
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { SLIDE_MS } from '../theme/tokens.ts'
  let {
    region,
    extent,
    children
  }: { region: 'left' | 'right' | 'bottom'; extent: number; children: Snippet } = $props()
  const horizontal = region !== 'bottom'
</script>

<div
  class="region region-{region}"
  data-region={region}
  style="{horizontal ? 'width' : 'height'}: {extent}px; transition: all {SLIDE_MS}ms ease-in-out;"
>
  {@render children()}
</div>

<style>
  .region { overflow: hidden; flex-shrink: 0; display: flex; }
  .region-left { border-right: 1px solid var(--edge); background: var(--rail); }
  .region-right { border-left: 1px solid var(--edge); background: var(--panel); }
  .region-bottom { border-top: 1px solid var(--edge); background: var(--panel); }
</style>
```

`src/shell/Titlebar.svelte` (structure, ids and copy from `Topbar.scala`; styles carry the extracted values):
```svelte
<script lang="ts">
  import Icon from '../icons/Icon.svelte'
  import type { ShellState } from '../state/shell-state.svelte.ts'
  let {
    shell,
    badge,
    version,
    crumbTitle,
    macChrome = false
  }: { shell: ShellState; badge: string; version: string; crumbTitle: string; macChrome?: boolean } = $props()
  const crumbPrefix = $derived(shell.isSettings ? 'Settings' : 'morphir')
</script>

<header class="titlebar" id="titlebar">
  {#if shell.leftVisible}
    <div class="brand-zone" class:lights-inset={macChrome}>
      <button class="icon-btn" id="sidebar-toggle" onclick={() => shell.toggleLeft()} title="Toggle sidebar">
        <Icon name="sidebar" />
      </button>
      <div class="brand"><span class="brand-mark">morphir</span><span class="brand-sub">{badge}</span></div>
    </div>
    <div class="titlebar-rest">
      <div class="topbar-title"><span class="crumb">{crumbPrefix} / </span>{crumbTitle}</div>
      {@render rightCluster()}
    </div>
  {:else}
    <div class="titlebar-left" class:lights-inset={macChrome}>
      <button class="icon-btn" id="sidebar-toggle" onclick={() => shell.toggleLeft()} title="Toggle sidebar">
        <Icon name="sidebar" />
      </button>
      <div class="topbar-title"><span class="crumb">{crumbPrefix} / </span>{crumbTitle}</div>
    </div>
    {@render rightCluster()}
  {/if}
</header>

{#snippet rightCluster()}
  <div class="titlebar-right">
    {#if shell.isSettings}
      <button class="titlebar-action" id="restore-defaults" onclick={() => shell.restoreDefaults()}>
        <Icon name="restore" /><span class="titlebar-action-label">Restore defaults</span>
      </button>
    {:else}
      <span class="chip" id="app-version">v{version}</span>
      <button class="icon-btn" id="right-toggle" onclick={() => shell.toggleRight()} title="Toggle inspector">
        <Icon name="panelRight" />
      </button>
      <button class="icon-btn" id="bottom-toggle" onclick={() => shell.toggleBottom()} title="Toggle log">
        <Icon name="panelBottom" />
      </button>
    {/if}
  </div>
{/snippet}

<style>
  .titlebar {
    display: flex; align-items: stretch; height: 52px;
    background: var(--surface); border-bottom: 1px solid var(--edge);
    flex-shrink: 0;
  }
  .brand-zone {
    display: flex; align-items: center; gap: 8px; width: 224px; padding: 0 12px;
    background: var(--rail); border-right: 1px solid var(--edge); flex-shrink: 0;
  }
  .brand-zone.lights-inset { padding: 0 12px 0 78px; }
  .brand-zone.lights-inset .brand-sub { display: none; }
  .titlebar-rest { flex: 1; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; }
  .titlebar-left { display: flex; align-items: center; gap: 12px; padding: 0 0 0 22px; }
  .titlebar-left.lights-inset { padding: 0 0 0 78px; }
  .titlebar-right { display: flex; align-items: center; gap: 8px; padding: 0 22px 0 0; }
  .brand { display: flex; align-items: baseline; gap: 8px; padding: 0 10px; font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
  .brand-sub { font-family: var(--mono); font-size: 9px; font-weight: 600; letter-spacing: 0.22em; color: var(--muted2); }
  .topbar-title { display: flex; gap: 4px; font-weight: 600; font-size: 14px; color: var(--text); }
  .topbar-title .crumb { color: var(--muted2); font-weight: 400; }
  .chip {
    font-family: var(--mono); font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
    color: var(--accent-text); background: rgba(214, 64, 159, 0.14); border: 1px solid rgba(214, 64, 159, 0.35);
  }
  .titlebar-action {
    display: flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 8px;
    color: var(--muted); font-size: 12.5px; cursor: pointer; background: none; border: none;
  }
  .titlebar-action:hover { background: var(--hover); color: var(--text); }
  .titlebar-action-label { font-weight: 500; }
  .icon-btn {
    display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    border-radius: 8px; color: var(--muted); background: none; border: none; cursor: pointer;
  }
  .icon-btn:hover { background: var(--hover); color: var(--text); }
</style>
```

`src/shell/Sidebar.svelte` (structure and copy from `Sidebar.scala` — the section heading literal is `Workspace`):
```svelte
<script lang="ts">
  import Icon from '../icons/Icon.svelte'
  import type { NavItem } from './nav.ts'
  let {
    navItems,
    activeNav,
    onNavSelect,
    onOpenSettings
  }: {
    navItems: NavItem[]
    activeNav: string
    onNavSelect: (id: string) => void
    onOpenSettings: () => void
  } = $props()
</script>

<nav class="sidebar">
  <div class="nav-section">Workspace</div>
  {#each navItems as item (item.id)}
    <button class="nav-item" class:active={item.id === activeNav} onclick={() => onNavSelect(item.id)}>
      <span class="nav-dot"></span>{item.label}
    </button>
  {/each}
  <div class="sidebar-foot">
    <button class="icon-btn" id="settings-button" onclick={onOpenSettings} title="Settings">
      <Icon name="gear" />
    </button>
  </div>
</nav>

<style>
  .sidebar {
    width: 224px; flex: 1; display: flex; flex-direction: column;
    padding: 6px 12px 18px 12px; overflow: hidden;
  }
  .nav-section {
    font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted2); padding: 16px 10px 6px 10px; text-align: left;
  }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px; margin: 1px 0;
    border-radius: 8px; color: var(--nav); font-weight: 500; font-size: 14px;
    background: none; border: none; text-align: left; width: 100%;
  }
  .nav-item:hover { background: var(--hover-soft); color: var(--text); }
  .nav-item.active {
    background: linear-gradient(to right, rgba(214, 64, 159, 0.16) 0%, rgba(139, 92, 246, 0.1) 100%);
    color: var(--text-strong);
  }
  .nav-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dot); flex-shrink: 0; }
  .nav-item.active .nav-dot { background: var(--accent); }
  .sidebar-foot { margin: auto 0 0 0; padding: 6px 4px 0 4px; }
  .icon-btn {
    display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    border-radius: 8px; color: var(--muted); background: none; border: none; cursor: pointer;
  }
  .icon-btn:hover { background: var(--hover); color: var(--text); }
</style>
```

`src/shell/nav.ts`:
```ts
export interface NavItem { readonly id: string; readonly label: string }
```

`src/shell/AppShell.svelte`:
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Titlebar from './Titlebar.svelte'
  import Sidebar from './Sidebar.svelte'
  import RegionPanel from './RegionPanel.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import type { NavItem } from './nav.ts'
  import type { ShellState } from '../state/shell-state.svelte.ts'

  let {
    shell,
    badge,
    version,
    crumbTitle,
    navItems,
    activeNav,
    onNavSelect,
    onOpenSettings,
    macChrome = false,
    center,
    inspector,
    log
  }: {
    shell: ShellState
    badge: string
    version: string
    crumbTitle: string
    navItems: NavItem[]
    activeNav: string
    onNavSelect: (id: string) => void
    onOpenSettings: () => void
    macChrome?: boolean
    center?: Snippet
    inspector?: Snippet
    log?: Snippet
  } = $props()
</script>

<div class="shell {shell.schemeClass}" class:no-motion={!shell.animations}>
  <Titlebar {shell} {badge} {version} {crumbTitle} {macChrome} />
  <div class="shell-body">
    <RegionPanel region="left" extent={shell.leftExtent}>
      <Sidebar {navItems} {activeNav} {onNavSelect} {onOpenSettings} />
    </RegionPanel>
    {#if shell.leftVisible}
      <ResizeHandle edge="left" currentSize={shell.leftWidth} onResize={(px) => shell.resizeLeft(px)} />
    {/if}
    <div class="shell-center">
      <div class="shell-main">
        <main class="content" class:content-settings={shell.isSettings}>
          {#if center}{@render center()}{/if}
        </main>
        {#if shell.rightVisible}
          <ResizeHandle edge="right" currentSize={shell.rightWidth} onResize={(px) => shell.resizeRight(px)} />
        {/if}
        <RegionPanel region="right" extent={shell.rightExtent}>
          <div class="panel-body">{#if inspector}{@render inspector()}{:else}<span class="panel-title">Inspector</span>{/if}</div>
        </RegionPanel>
      </div>
      {#if shell.bottomVisible}
        <ResizeHandle edge="bottom" currentSize={shell.bottomHeight} onResize={(px) => shell.resizeBottom(px)} />
      {/if}
      <RegionPanel region="bottom" extent={shell.bottomExtent}>
        <div class="panel-body">{#if log}{@render log()}{:else}<span class="panel-title">Log</span>{/if}</div>
      </RegionPanel>
    </div>
  </div>
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100%; background: var(--bg); color: var(--text); }
  .shell-body { flex: 1; display: flex; min-height: 0; }
  .shell-center { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .shell-main { flex: 1; display: flex; min-height: 0; }
  .panel-body { padding: 14px; flex: 1; overflow: auto; }
  .panel-title {
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted2);
  }
</style>
```

Add to `src/index.ts`:
```ts
export { icons, type IconName } from './icons/icons.ts'
export { default as Icon } from './icons/Icon.svelte'
export { default as AppShell } from './shell/AppShell.svelte'
export { default as Titlebar } from './shell/Titlebar.svelte'
export { default as Sidebar } from './shell/Sidebar.svelte'
export type { NavItem } from './shell/nav.ts'
```

- [ ] **Step 5: Run tests, verify pass** — `bun run test && bun run typecheck && cd ../.. && bun run lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): shell chrome - titlebar, sidebar, resizable regions, icons"
```

---

### Task 7: @morphir/ui — Token redaction, config schema, Effect services & facade

**Files:**
- Create: `packages/morphir-ui/src/services/token.ts`, `src/services/config.ts`, `src/services/services.ts`; extend `src/index.ts`
- Create: `packages/morphir-ui/test/support/fake-services.ts`
- Test: `packages/morphir-ui/test/token.test.ts`, `test/services.test.ts`

**Interfaces:**
- Produces (used by ALL later tasks):
  - `redactToken(raw: string): string`; `class Token { static parse(input: string): Token | null; toString(): string; toJSON(): string; unsafeReveal(): string }`
  - `type GitHubSource = 'none' | 'gh-cli' | 'pat'`
  - `interface UiConfig { workspace: { recent: ReadonlyArray<string>; reopenOnLaunch: boolean; active: string | null }; appearance: { colorScheme: ColorScheme; animations: boolean }; shell: ShellSnapshot['shell']; github: { source: GitHubSource } }`
  - `defaultUiConfig: UiConfig`; `decodeUiConfig(u: unknown): UiConfig` (lenient — falls back to defaults on invalid input); `configToSnapshot(c: UiConfig): ShellSnapshot`; `withSnapshot(c: UiConfig, s: ShellSnapshot): UiConfig`
  - Effect tags: `ConfigService { load: Effect<UiConfig>; save(c): Effect<void> }`, `WorkspaceService { pickAndRead: Effect<Option<PickedWorkspace>, WorkspaceError>; read: Option<(ref: WorkspaceRef) => Effect<string, WorkspaceError>> }`, `AppInfoService { version: Effect<string> }`, `GitHubService` with `{ status: Effect<GitHubStatus, GitHubError>; setSource(source: 'none' | 'gh-cli'): Effect<void, GitHubError>; savePat(raw: string): Effect<void, GitHubError>; clearPat: Effect<void, GitHubError>; verify: Effect<{ login: string }, GitHubError> }`
  - `interface WorkspaceRef { path: string }`; `interface PickedWorkspace { ref: WorkspaceRef; content: string }`; `interface GitHubStatus { source: GitHubSource; tokenDisplay: string | null }`; errors `WorkspaceError`/`GitHubError` (`Data.TaggedError`, `{ message: string }`)
  - `type CoreServices = ConfigService | WorkspaceService | AppInfoService`
  - `interface Capabilities { github: boolean; reopenWorkspaces: boolean }`
  - `makeAppServices(opts: { core: Layer.Layer<CoreServices>; github?: Layer.Layer<GitHubService> }): Promise<AppServices>` — promise facade: `{ capabilities; version(): Promise<string>; loadConfig(): Promise<UiConfig>; saveConfig(c): Promise<void>; pickWorkspace(): Promise<PickedWorkspace | null>; readWorkspace: ((ref: WorkspaceRef) => Promise<string>) | null; github: { status(): Promise<GitHubStatus>; setSource(s: 'none' | 'gh-cli'): Promise<void>; savePat(raw: string): Promise<void>; clearPat(): Promise<void>; verify(): Promise<{ login: string }> } | null }` — `capabilities.github = github layer present`, `capabilities.reopenWorkspaces = read is Some`
  - Test support: `makeFakeCore(opts?: { config?: UiConfig; workspaceContent?: string; version?: string; reopen?: boolean })` and `makeFakeGitHub(state?: { source?: GitHubSource; pat?: string | null; login?: string })` returning Layers + inspection handles

- [ ] **Step 1: Write the failing token tests**

`packages/morphir-ui/test/token.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { redactToken, Token } from '../src/services/token.ts'

describe('token redaction (morphir-scala contract)', () => {
  test('recognizes known prefixes and keeps last 4', () => {
    expect(redactToken('ghp_' + 'a'.repeat(36) + 'WXYZ')).toBe('Token(ghp_...WXYZ)')
    expect(redactToken('github_pat_' + 'b'.repeat(59) + '1234')).toBe('Token(github_pat_...1234)')
  })
  test('unknown prefix falls back to first 4 chars', () => {
    expect(redactToken('x'.repeat(40) + 'ABCD')).toBe('Token(xxxx...ABCD)')
  })
  test('short tokens collapse to Token(redacted)', () => {
    expect(redactToken('ghp_short')).toBe('Token(redacted)')
    expect(redactToken('')).toBe('Token(redacted)')
  })
  test('Token.parse trims and rejects empty; toString/toJSON never leak', () => {
    expect(Token.parse('   ')).toBeNull()
    const t = Token.parse('  ghp_' + 'c'.repeat(36) + 'TAIL  ')!
    expect(t.unsafeReveal()).toBe('ghp_' + 'c'.repeat(36) + 'TAIL')
    expect(t.toString()).toBe('Token(ghp_...TAIL)')
    expect(JSON.stringify({ t })).toBe('{"t":"Token(ghp_...TAIL)"}')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun run test test/token.test.ts` → FAIL.

- [ ] **Step 3: Implement token.ts (pure TS — importable from Electron main via `@morphir/ui/token`)**

`src/services/token.ts`:
```ts
const KNOWN_PREFIXES = ['github_pat_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'ghp_']
const MIN_HIDDEN = 16
const SUFFIX_LEN = 4
const DEFAULT_PREFIX_LEN = 4

export const redactToken = (raw: string): string => {
  const prefix = KNOWN_PREFIXES.find((p) => raw.startsWith(p)) ?? raw.slice(0, DEFAULT_PREFIX_LEN)
  const hidden = raw.length - prefix.length - SUFFIX_LEN
  if (hidden < MIN_HIDDEN) return 'Token(redacted)'
  return `Token(${prefix}...${raw.slice(-SUFFIX_LEN)})`
}

export class Token {
  readonly #raw: string
  private constructor(raw: string) { this.#raw = raw }
  static parse(input: string): Token | null {
    const trimmed = input.trim()
    return trimmed.length === 0 ? null : new Token(trimmed)
  }
  toString(): string { return redactToken(this.#raw) }
  toJSON(): string { return this.toString() }
  /** The only way to the raw value. Callers: transport to safeStorage / Authorization header ONLY. */
  unsafeReveal(): string { return this.#raw }
}
```

- [ ] **Step 4: Write the failing config + services tests**

`packages/morphir-ui/test/services.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { decodeUiConfig, defaultUiConfig, makeAppServices, withSnapshot, configToSnapshot } from '../src/index.ts'
import { makeFakeCore, makeFakeGitHub } from './support/fake-services.ts'

describe('UiConfig', () => {
  test('empty input decodes to defaults', () => {
    expect(decodeUiConfig({})).toEqual(defaultUiConfig)
    expect(defaultUiConfig.appearance.colorScheme).toBe('dark')
    expect(defaultUiConfig.github.source).toBe('none')
    expect(defaultUiConfig.workspace.reopenOnLaunch).toBe(true)
  })
  test('invalid input falls back to defaults', () => {
    expect(decodeUiConfig({ appearance: { colorScheme: 'sepia' } })).toEqual(defaultUiConfig)
    expect(decodeUiConfig('garbage')).toEqual(defaultUiConfig)
  })
  test('snapshot round-trip', () => {
    const snap = configToSnapshot(defaultUiConfig)
    expect(snap.shell.leftWidth).toBe(224)
    const updated = withSnapshot(defaultUiConfig, {
      ...snap,
      appearance: { ...snap.appearance, colorScheme: 'light' }
    })
    expect(updated.appearance.colorScheme).toBe('light')
    expect(updated.github).toEqual(defaultUiConfig.github)
  })
})

describe('makeAppServices', () => {
  test('exposes core services and capability flags without github', async () => {
    const { core } = makeFakeCore({ version: '9.9.9' })
    const services = await makeAppServices({ core })
    expect(await services.version()).toBe('9.9.9')
    expect(services.capabilities.github).toBe(false)
    expect(services.github).toBeNull()
    const cfg = await services.loadConfig()
    expect(cfg).toEqual(defaultUiConfig)
  })
  test('config save round-trips', async () => {
    const { core, store } = makeFakeCore()
    const services = await makeAppServices({ core })
    const cfg = { ...defaultUiConfig, github: { source: 'gh-cli' as const } }
    await services.saveConfig(cfg)
    expect(store.config).toEqual(cfg)
    expect(await services.loadConfig()).toEqual(cfg)
  })
  test('workspace pick returns content; read capability follows the layer', async () => {
    const { core } = makeFakeCore({ workspaceContent: '{"formatVersion":3}', reopen: true })
    const services = await makeAppServices({ core })
    const picked = await services.pickWorkspace()
    expect(picked!.content).toBe('{"formatVersion":3}')
    expect(services.capabilities.reopenWorkspaces).toBe(true)
    expect(await services.readWorkspace!(picked!.ref)).toBe('{"formatVersion":3}')
  })
  test('github facade appears when the layer is provided', async () => {
    const { core } = makeFakeCore()
    const { github } = makeFakeGitHub({ source: 'pat', pat: 'ghp_' + 'z'.repeat(36) + 'TAIL', login: 'octocat' })
    const services = await makeAppServices({ core, github })
    expect(services.capabilities.github).toBe(true)
    const status = await services.github!.status()
    expect(status).toEqual({ source: 'pat', tokenDisplay: 'Token(ghp_...TAIL)' })
    expect(await services.github!.verify()).toEqual({ login: 'octocat' })
    await services.github!.clearPat()
    expect((await services.github!.status()).tokenDisplay).toBeNull()
  })
})
```

- [ ] **Step 5: Run to verify failure**, then implement.

`src/services/config.ts`:
```ts
import { Either, Schema } from 'effect'
import { SHELL_DEFAULTS, type ColorScheme, type ShellSnapshot } from '../state/shell-constants.ts'

export type GitHubSource = 'none' | 'gh-cli' | 'pat'

const UiConfigSchema = Schema.Struct({
  workspace: Schema.Struct({
    recent: Schema.Array(Schema.String),
    reopenOnLaunch: Schema.Boolean,
    active: Schema.NullOr(Schema.String)
  }),
  appearance: Schema.Struct({
    colorScheme: Schema.Literal('system', 'light', 'dark'),
    animations: Schema.Boolean
  }),
  shell: Schema.Struct({
    leftWidth: Schema.Number,
    rightWidth: Schema.Number,
    bottomHeight: Schema.Number,
    leftVisible: Schema.Boolean,
    rightVisible: Schema.Boolean,
    bottomVisible: Schema.Boolean
  }),
  github: Schema.Struct({ source: Schema.Literal('none', 'gh-cli', 'pat') })
})

export interface UiConfig extends Schema.Schema.Type<typeof UiConfigSchema> {}

export const defaultUiConfig: UiConfig = {
  workspace: { recent: [], reopenOnLaunch: true, active: null },
  appearance: { colorScheme: SHELL_DEFAULTS.colorScheme as ColorScheme, animations: true },
  shell: {
    leftWidth: SHELL_DEFAULTS.leftWidth,
    rightWidth: SHELL_DEFAULTS.rightWidth,
    bottomHeight: SHELL_DEFAULTS.bottomHeight,
    leftVisible: true,
    rightVisible: true,
    bottomVisible: true
  },
  github: { source: 'none' }
}

/** Lenient: any invalid or partial input yields the defaults. Config files are never a crash. */
export const decodeUiConfig = (input: unknown): UiConfig => {
  const merged =
    typeof input === 'object' && input !== null
      ? {
          workspace: { ...defaultUiConfig.workspace, ...(input as Record<string, object>)['workspace'] },
          appearance: { ...defaultUiConfig.appearance, ...(input as Record<string, object>)['appearance'] },
          shell: { ...defaultUiConfig.shell, ...(input as Record<string, object>)['shell'] },
          github: { ...defaultUiConfig.github, ...(input as Record<string, object>)['github'] }
        }
      : input
  return Either.getOrElse(Schema.decodeUnknownEither(UiConfigSchema)(merged), () => defaultUiConfig)
}

export const configToSnapshot = (c: UiConfig): ShellSnapshot => ({
  appearance: { ...c.appearance },
  shell: { ...c.shell }
})

export const withSnapshot = (c: UiConfig, s: ShellSnapshot): UiConfig => ({
  ...c,
  appearance: { ...s.appearance },
  shell: { ...s.shell }
})
```

`src/services/services.ts`:
```ts
import { Context, Data, Effect, Layer, ManagedRuntime, Option } from 'effect'
import type { UiConfig } from './config.ts'

export interface WorkspaceRef { readonly path: string }
export interface PickedWorkspace { readonly ref: WorkspaceRef; readonly content: string }
export interface GitHubStatus { readonly source: import('./config.ts').GitHubSource; readonly tokenDisplay: string | null }

export class WorkspaceError extends Data.TaggedError('WorkspaceError')<{ readonly message: string }> {}
export class GitHubError extends Data.TaggedError('GitHubError')<{ readonly message: string }> {}

export class ConfigService extends Context.Tag('@morphir/ui/ConfigService')<
  ConfigService,
  { readonly load: Effect.Effect<UiConfig>; readonly save: (config: UiConfig) => Effect.Effect<void> }
>() {}

export class WorkspaceService extends Context.Tag('@morphir/ui/WorkspaceService')<
  WorkspaceService,
  {
    readonly pickAndRead: Effect.Effect<Option.Option<PickedWorkspace>, WorkspaceError>
    readonly read: Option.Option<(ref: WorkspaceRef) => Effect.Effect<string, WorkspaceError>>
  }
>() {}

export class AppInfoService extends Context.Tag('@morphir/ui/AppInfoService')<
  AppInfoService,
  { readonly version: Effect.Effect<string> }
>() {}

export interface GitHubServiceApi {
  readonly status: Effect.Effect<GitHubStatus, GitHubError>
  readonly setSource: (source: 'none' | 'gh-cli') => Effect.Effect<void, GitHubError>
  readonly savePat: (raw: string) => Effect.Effect<void, GitHubError>
  readonly clearPat: Effect.Effect<void, GitHubError>
  readonly verify: Effect.Effect<{ login: string }, GitHubError>
}
export class GitHubService extends Context.Tag('@morphir/ui/GitHubService')<GitHubService, GitHubServiceApi>() {}

export type CoreServices = ConfigService | WorkspaceService | AppInfoService

export interface Capabilities { readonly github: boolean; readonly reopenWorkspaces: boolean }

export interface AppServices {
  readonly capabilities: Capabilities
  version(): Promise<string>
  loadConfig(): Promise<UiConfig>
  saveConfig(config: UiConfig): Promise<void>
  pickWorkspace(): Promise<PickedWorkspace | null>
  readonly readWorkspace: ((ref: WorkspaceRef) => Promise<string>) | null
  readonly github: {
    status(): Promise<GitHubStatus>
    setSource(source: 'none' | 'gh-cli'): Promise<void>
    savePat(raw: string): Promise<void>
    clearPat(): Promise<void>
    verify(): Promise<{ login: string }>
  } | null
}

export const makeAppServices = async (opts: {
  core: Layer.Layer<CoreServices>
  github?: Layer.Layer<GitHubService>
}): Promise<AppServices> => {
  const layer = opts.github ? Layer.merge(opts.core, opts.github) : opts.core
  const runtime = ManagedRuntime.make(layer)
  const config = await runtime.runPromise(ConfigService)
  const workspace = await runtime.runPromise(WorkspaceService)
  const appInfo = await runtime.runPromise(AppInfoService)
  const github = opts.github ? await runtime.runPromise(GitHubService) : null
  const read = Option.getOrNull(workspace.read)
  return {
    capabilities: { github: github !== null, reopenWorkspaces: read !== null },
    version: () => runtime.runPromise(appInfo.version),
    loadConfig: () => runtime.runPromise(config.load),
    saveConfig: (c) => runtime.runPromise(config.save(c)),
    pickWorkspace: () => runtime.runPromise(workspace.pickAndRead).then(Option.getOrNull),
    readWorkspace: read ? (ref) => runtime.runPromise(read(ref)) : null,
    github: github
      ? {
          status: () => runtime.runPromise(github.status),
          setSource: (s) => runtime.runPromise(github.setSource(s)),
          savePat: (raw) => runtime.runPromise(github.savePat(raw)),
          clearPat: () => runtime.runPromise(github.clearPat),
          verify: () => runtime.runPromise(github.verify)
        }
      : null
  }
}
```

`test/support/fake-services.ts`:
```ts
import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  GitHubError,
  GitHubService,
  WorkspaceService,
  defaultUiConfig,
  redactToken,
  type GitHubSource,
  type UiConfig
} from '../../src/index.ts'

export const makeFakeCore = (opts?: {
  config?: UiConfig
  workspaceContent?: string
  version?: string
  reopen?: boolean
}) => {
  const store = { config: opts?.config ?? defaultUiConfig }
  const content = opts?.workspaceContent ?? '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'
  const core = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      load: Effect.sync(() => store.config),
      save: (c) => Effect.sync(() => void (store.config = c))
    }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.succeed(Option.some({ ref: { path: '/fake/morphir-ir.json' }, content })),
      read: opts?.reopen ? Option.some(() => Effect.succeed(content)) : Option.none()
    }),
    Layer.succeed(AppInfoService, { version: Effect.succeed(opts?.version ?? '0.0.0-test') })
  )
  return { core, store }
}

export const makeFakeGitHub = (init?: { source?: GitHubSource; pat?: string | null; login?: string }) => {
  const state = { source: init?.source ?? 'none', pat: init?.pat ?? null }
  const github = Layer.succeed(GitHubService, {
    status: Effect.sync(() => ({
      source: state.source,
      tokenDisplay: state.pat ? redactToken(state.pat) : null
    })),
    setSource: (source) => Effect.sync(() => void (state.source = source)),
    savePat: (raw) => Effect.sync(() => { state.pat = raw; state.source = 'pat' }),
    clearPat: Effect.sync(() => { state.pat = null; state.source = 'none' }),
    verify: init?.login
      ? Effect.sync(() => ({ login: init.login! }))
      : Effect.fail(new GitHubError({ message: 'no token configured' }))
  })
  return { github, state }
}
```

Add to `src/index.ts`:
```ts
export * from './services/token.ts'
export * from './services/config.ts'
export * from './services/services.ts'
```

- [ ] **Step 6: Run all package tests, verify pass** — `bun run test && bun run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ui): token redaction, ui config schema, effect service tags and app facade"
```

---

### Task 8: @morphir/ui — WorkspaceState, Overview & IR Explorer views, MorphirApp

**Files:**
- Create: `packages/morphir-ui/src/state/workspace-state.svelte.ts`, `src/views/OverviewView.svelte`, `src/views/IrExplorerView.svelte`, `src/shell/MorphirApp.svelte`; extend `src/index.ts`
- Test: `packages/morphir-ui/test/workspace-state.test.ts`, `test/ir-explorer.test.ts`, `test/morphir-app.test.ts`

**Interfaces:**
- Consumes: `decodeMorphirIr`, `toWorkspaceIr`, `WorkspaceIr` (@morphir/ir); `AppServices`, `UiConfig`, `configToSnapshot`, `withSnapshot` (Task 7); `AppShell`, `ShellState` (Tasks 5–6).
- Produces:
  - `class WorkspaceState` — `current: { ref: WorkspaceRef; ir: WorkspaceIr } | null`, `error: string | null`, `recents: ReadonlyArray<string>`, `loading: boolean`; `openPicked(): Promise<void>`, `reopen(path: string): Promise<void>`. Opening updates recents (dedup, max 8) and persists `workspace.recent`/`workspace.active` via ConfigService. (This fulfills the spec's `IrService` row: the "shared isomorphic impl" is `@morphir/ir` called directly — one decode path for both apps; no separate Effect tag needed.)
  - `MorphirApp.svelte` props: `{ services: AppServices; badge: string; version: string; initialConfig: UiConfig; macChrome?: boolean }` — owns ShellState (hydrated from config), WorkspaceState, nav; persists `ShellSnapshot` changes back to config (200 ms debounce); reopens the active workspace on mount when `reopenOnLaunch && capabilities.reopenWorkspaces`. **Interim:** the settings route renders a `SettingsView` stub replaced wholesale in Task 14; this task renders `<div class="settings-stub">Settings</div>` for it.
  - `OverviewView.svelte` props: `{ workspace: WorkspaceState; capabilities: Capabilities; onOpen: () => void }`
  - `IrExplorerView.svelte` props: `{ workspace: WorkspaceState }`

- [ ] **Step 1: Write the failing tests**

`packages/morphir-ui/test/workspace-state.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { WorkspaceState } from '../src/index.ts'
import { makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'
import { readFileSync } from 'node:fs'

const irFixture = readFileSync(
  new URL('../../morphir-ir/test/fixtures/simpleTypeTree-ir.json', import.meta.url),
  'utf8'
)

describe('WorkspaceState', () => {
  test('openPicked decodes IR, sets current, records recents and persists config', async () => {
    const { core, store } = makeFakeCore({ workspaceContent: irFixture })
    const ws = new WorkspaceState(await makeAppServices({ core }))
    await ws.openPicked()
    expect(ws.error).toBeNull()
    expect(ws.current!.ir.package.name).toBe('Morphir.Example.App')
    expect(ws.recents).toEqual(['/fake/morphir-ir.json'])
    expect(store.config.workspace.active).toBe('/fake/morphir-ir.json')
    expect(store.config.workspace.recent).toEqual(['/fake/morphir-ir.json'])
  })

  test('malformed IR yields a friendly error, not a crash', async () => {
    const { core } = makeFakeCore({ workspaceContent: '{"formatVersion":2,"distribution":[]}' })
    const ws = new WorkspaceState(await makeAppServices({ core }))
    await ws.openPicked()
    expect(ws.current).toBeNull()
    expect(ws.error).toContain('format version 2')
  })

  test('reopen is a no-op without the capability', async () => {
    const { core } = makeFakeCore({ workspaceContent: irFixture, reopen: false })
    const ws = new WorkspaceState(await makeAppServices({ core }))
    await ws.reopen('/anything')
    expect(ws.current).toBeNull()
  })
})
```

`packages/morphir-ui/test/ir-explorer.test.ts`:
```ts
import { render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import IrExplorerView from '../src/views/IrExplorerView.svelte'
import { WorkspaceState, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

const irFixture = readFileSync(
  new URL('../../morphir-ir/test/fixtures/listType-ir.json', import.meta.url),
  'utf8'
)

const openWorkspace = async () => {
  const { core } = makeFakeCore({ workspaceContent: irFixture })
  const ws = new WorkspaceState(await makeAppServices({ core }))
  await ws.openPicked()
  return ws
}

describe('IrExplorerView', () => {
  test('empty state prompts to open a workspace', () => {
    render(IrExplorerView, { props: { workspace: new WorkspaceState(null as never) } })
    expect(screen.getByText(/Open a workspace/)).toBeTruthy()
  })

  test('renders package, modules and definitions', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    expect(screen.getByText('Morphir.Example.App')).toBeTruthy()
    expect(screen.getByText('Forecast')).toBeTruthy()
    expect(screen.getByText('listExample')).toBeTruthy()
    expect(screen.getByText('WindDirection')).toBeTruthy()
  })

  test('search filter narrows definitions', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    await userEvent.type(screen.getByPlaceholderText('Filter definitions'), 'listEx')
    expect(screen.queryByText('WindDirection')).toBeNull()
    expect(screen.getByText('listExample')).toBeTruthy()
  })

  test('kind toggles hide types or values', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    await userEvent.click(screen.getByRole('button', { name: 'Types' }))
    expect(screen.queryByText('WindDirection')).toBeNull()
    expect(screen.getByText('listExample')).toBeTruthy()
  })
})
```

`packages/morphir-ui/test/morphir-app.test.ts`:
```ts
import { render, screen } from '@testing-library/svelte'
import { describe, expect, test } from 'vitest'
import MorphirApp from '../src/shell/MorphirApp.svelte'
import { defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

describe('MorphirApp', () => {
  test('hydrates the shell from initial config', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const config = {
      ...defaultUiConfig,
      appearance: { colorScheme: 'light' as const, animations: false }
    }
    const { container } = render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: config }
    })
    const root = container.querySelector('.shell')!
    expect(root.classList.contains('theme-light')).toBe(true)
    expect(root.classList.contains('no-motion')).toBe(true)
    expect(screen.getByText('WEB')).toBeTruthy()
  })

  test('persists shell snapshot changes to config (debounced)', async () => {
    const { core, store } = makeFakeCore()
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig }
    })
    document.getElementById('right-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 350))
    expect(store.config.shell.rightVisible).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun run test` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/state/workspace-state.svelte.ts`:
```ts
import { Cause, Effect, Exit, Option } from 'effect'
import { decodeMorphirIr, toWorkspaceIr, type WorkspaceIr } from '@morphir/ir'
import type { AppServices, WorkspaceRef } from '../services/services.ts'

export interface OpenWorkspace { readonly ref: WorkspaceRef; readonly ir: WorkspaceIr }

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
    const picked = await this.#services.pickWorkspace()
    if (picked) await this.#ingest(picked.ref, picked.content)
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
        workspace: { ...cfg.workspace, recent: this.recents, active: ref.path }
      })
    } else {
      this.current = null
      const failure = Cause.failureOption(exit.cause)
      this.error = Option.isSome(failure) ? failure.value.message : 'Failed to decode workspace IR'
    }
  }
}
```

`src/views/OverviewView.svelte`:
```svelte
<script lang="ts">
  import type { Capabilities } from '../services/services.ts'
  import type { WorkspaceState } from '../state/workspace-state.svelte.ts'
  let {
    workspace,
    capabilities,
    onOpen
  }: { workspace: WorkspaceState; capabilities: Capabilities; onOpen: () => void } = $props()
</script>

<section class="card">
  <h2 class="card-title">Workspace</h2>
  {#if workspace.current}
    <div class="row"><span class="label">Path</span><span class="value">{workspace.current.ref.path}</span></div>
    <div class="row"><span class="label">Package</span><span class="value">{workspace.current.ir.package.name}</span></div>
    <div class="row"><span class="label">Modules</span><span class="value">{workspace.current.ir.package.moduleCount}</span></div>
  {:else}
    <p class="muted">No workspace open.</p>
  {/if}
  {#if workspace.error}<p class="error">{workspace.error}</p>{/if}
  <button class="action" onclick={onOpen}>Open workspace…</button>
</section>

{#if capabilities.reopenWorkspaces && workspace.recents.length > 0}
  <section class="card">
    <h2 class="card-title">Recent workspaces</h2>
    {#each workspace.recents as path (path)}
      <button class="recent" onclick={() => workspace.reopen(path)}>{path}</button>
    {/each}
  </section>
{/if}

<style>
  .card { background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 10px; padding: 16px; }
  .card-title {
    font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted2); margin-bottom: 10px;
  }
  .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--row-edge); }
  .label { color: var(--muted); }
  .value { font-family: var(--mono); font-size: 12.5px; color: var(--accent-text); }
  .muted { color: var(--muted); }
  .error { color: var(--accent); font-size: 13px; margin-top: 8px; }
  .action {
    margin-top: 12px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--panel-edge);
    background: var(--hover-soft); color: var(--text); cursor: pointer;
  }
  .action:hover { background: var(--hover); }
  .recent {
    display: block; width: 100%; text-align: left; padding: 7px 10px; border-radius: 8px;
    background: none; border: none; color: var(--nav); font-family: var(--mono); font-size: 12.5px; cursor: pointer;
  }
  .recent:hover { background: var(--hover-soft); color: var(--text); }
</style>
```

`src/views/IrExplorerView.svelte`:
```svelte
<script lang="ts">
  import type { WorkspaceState } from '../state/workspace-state.svelte.ts'
  let { workspace }: { workspace: WorkspaceState } = $props()

  let search = $state('')
  let showTypes = $state(true)
  let showValues = $state(true)
  let selectedModule = $state<string | null>(null)

  const ir = $derived(workspace.current?.ir ?? null)
  const activeModule = $derived(selectedModule ?? ir?.modules[0]?.name ?? null)
  const definitions = $derived(
    (ir?.definitions ?? []).filter(
      (d) =>
        d.ref.moduleName === activeModule &&
        (d.kind === 'type' ? showTypes : showValues) &&
        d.ref.localName.toLowerCase().includes(search.toLowerCase())
    )
  )
</script>

{#if !ir}
  <section class="card"><p class="muted">Open a workspace to explore its IR.</p>
    {#if workspace.error}<p class="error">{workspace.error}</p>{/if}
  </section>
{:else}
  <section class="card">
    <h2 class="card-title">Package</h2>
    <div class="pkg">{ir.package.name}</div>
    <div class="muted">{ir.package.moduleCount} modules</div>
  </section>
  <section class="card">
    <h2 class="card-title">Modules</h2>
    {#each ir.modules as m (m.name)}
      <button class="mod" class:active={m.name === activeModule} onclick={() => (selectedModule = m.name)}>
        {m.name}<span class="counts">{m.typeCount}T / {m.valueCount}V</span>
      </button>
    {/each}
  </section>
  <section class="card">
    <h2 class="card-title">Definitions</h2>
    <div class="filter">
      <input placeholder="Filter definitions" bind:value={search} />
      <button class="toggle" class:on={showTypes} onclick={() => (showTypes = !showTypes)}>Types</button>
      <button class="toggle" class:on={showValues} onclick={() => (showValues = !showValues)}>Values</button>
    </div>
    {#each definitions as d (d.ref.localName + d.kind)}
      <div class="def">
        <span class="def-name">{d.ref.localName}</span>
        <span class="def-kind">{d.kind}</span>
        <span class="def-access">{d.access}</span>
        {#if d.doc}<span class="def-doc">{d.doc}</span>{/if}
      </div>
    {:else}
      <p class="muted">No definitions match.</p>
    {/each}
  </section>
{/if}

<style>
  .card { background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 10px; padding: 16px; }
  .card-title {
    font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted2); margin-bottom: 10px;
  }
  .pkg { font-weight: 600; color: var(--text-strong); }
  .muted { color: var(--muted); font-size: 13px; }
  .error { color: var(--accent); font-size: 13px; }
  .mod {
    display: flex; justify-content: space-between; width: 100%; padding: 7px 10px; border-radius: 8px;
    background: none; border: none; color: var(--nav); cursor: pointer; font-size: 13.5px;
  }
  .mod:hover { background: var(--hover-soft); color: var(--text); }
  .mod.active { background: var(--hover); color: var(--text-strong); }
  .counts { font-family: var(--mono); font-size: 11px; color: var(--muted2); }
  .filter { display: flex; gap: 8px; margin-bottom: 10px; }
  .filter input {
    flex: 1; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--panel-edge);
    background: var(--code-bg); color: var(--text); font-size: 13px;
  }
  .toggle {
    padding: 5px 10px; border-radius: 8px; border: 1px solid var(--panel-edge);
    background: none; color: var(--muted); cursor: pointer; font-size: 12.5px;
  }
  .toggle.on { color: var(--accent-text); background: rgba(214, 64, 159, 0.14); border-color: rgba(214, 64, 159, 0.35); }
  .def { display: flex; gap: 10px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--row-edge); }
  .def-name { font-family: var(--mono); font-size: 13px; color: var(--text-strong); }
  .def-kind { font-size: 11px; color: var(--accent2); }
  .def-access { font-size: 11px; color: var(--muted2); }
  .def-doc { font-size: 12px; color: var(--muted); }
</style>
```

`src/shell/MorphirApp.svelte`:
```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import AppShell from './AppShell.svelte'
  import OverviewView from '../views/OverviewView.svelte'
  import IrExplorerView from '../views/IrExplorerView.svelte'
  import { ShellState, type SettingsSection } from '../state/shell-state.svelte.ts'
  import { WorkspaceState } from '../state/workspace-state.svelte.ts'
  import { configToSnapshot, withSnapshot, type UiConfig } from '../services/config.ts'
  import type { AppServices } from '../services/services.ts'
  import type { NavItem } from './nav.ts'

  let {
    services,
    badge,
    version,
    initialConfig,
    macChrome = false
  }: {
    services: AppServices
    badge: string
    version: string
    initialConfig: UiConfig
    macChrome?: boolean
  } = $props()

  const NAV_ITEMS: NavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'explorer', label: 'IR Explorer' }
  ]
  const SECTION_LABELS: Record<SettingsSection, string> = {
    general: 'General',
    appearance: 'Appearance',
    github: 'GitHub',
    about: 'About'
  }

  const shell = new ShellState()
  shell.hydrate(configToSnapshot(initialConfig))
  const workspace = new WorkspaceState(services, initialConfig.workspace.recent)
  let activeNav = $state('overview')

  const crumbTitle = $derived(
    shell.route.kind === 'settings'
      ? SECTION_LABELS[shell.route.section]
      : (NAV_ITEMS.find((n) => n.id === activeNav)?.label ?? '')
  )

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const snap = shell.snapshot()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void services.loadConfig().then((cfg) => services.saveConfig(withSnapshot(cfg, snap)))
    }, 200)
  })

  onMount(() => {
    if (
      initialConfig.workspace.reopenOnLaunch &&
      initialConfig.workspace.active &&
      services.capabilities.reopenWorkspaces
    ) {
      void workspace.reopen(initialConfig.workspace.active)
    }
  })
</script>

<AppShell
  {shell}
  {badge}
  {version}
  {crumbTitle}
  navItems={NAV_ITEMS}
  {activeNav}
  onNavSelect={(id) => {
    activeNav = id
    shell.closeSettings()
  }}
  onOpenSettings={() => shell.openSettings()}
  {macChrome}
>
  {#snippet center()}
    {#if shell.isSettings}
      <!-- Replaced by SettingsView in Task 14 -->
      <div class="settings-stub">Settings</div>
    {:else if activeNav === 'overview'}
      <OverviewView
        {workspace}
        capabilities={services.capabilities}
        onOpen={() => void workspace.openPicked()}
      />
    {:else}
      <IrExplorerView {workspace} />
    {/if}
  {/snippet}
</AppShell>
```

Add to `src/index.ts`:
```ts
export { WorkspaceState } from './state/workspace-state.svelte.ts'
export { default as MorphirApp } from './shell/MorphirApp.svelte'
export { default as OverviewView } from './views/OverviewView.svelte'
export { default as IrExplorerView } from './views/IrExplorerView.svelte'
```

- [ ] **Step 4: Run tests, verify pass** — `bun run test && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): workspace state, overview and IR explorer views, MorphirApp composition"
```

---

### Task 9: morphir-web — browser host

**Files:**
- Create: `apps/morphir-web/package.json`, `moon.yml`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/vite-env.d.ts`, `src/layers/browser-layers.ts`
- Test: `apps/morphir-web/test/browser-layers.test.ts`

**Interfaces:**
- Consumes: `MorphirApp`, `makeAppServices`, service tags, `decodeUiConfig`, `defaultUiConfig` (@morphir/ui).
- Produces: `browserCore(version: string): Layer.Layer<CoreServices>` — localStorage config under key `morphir-ui.config`, file-picker workspace (`read` = `Option.none()` → recents/reopen hidden), static version. The deployable `apps/morphir-web/dist/`.

- [ ] **Step 1: Scaffold**

`apps/morphir-web/package.json`:
```json
{
  "name": "@morphir/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "lint": "eslint src test",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "build": "vite build",
    "dev": "vite"
  },
  "dependencies": {
    "@morphir/ir": "workspace:*",
    "@morphir/ui": "workspace:*",
    "effect": "^3.22.1",
    "svelte": "^5.56.10"
  },
  "devDependencies": {
    "vite": "^8.2.2",
    "vitest": "^4.1.11",
    "@sveltejs/vite-plugin-svelte": "^7.3.0",
    "svelte-check": "^4.7.6",
    "typescript": "^5.9.0",
    "happy-dom": "^20.11.12"
  }
}
```

`apps/morphir-web/moon.yml`:
```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'
type: 'application'
language: 'typescript'
```

`apps/morphir-web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["svelte", "vite/client"], "noEmit": true },
  "include": ["src/**/*.ts", "src/**/*.svelte", "test/**/*.ts", "vite.config.ts"]
}
```

`apps/morphir-web/vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [svelte()],
  define: { __MORPHIR_WEB_VERSION__: JSON.stringify(pkg.version) },
  test: { environment: 'happy-dom', include: ['test/**/*.test.ts'] },
  resolve: { conditions: ['browser'] }
})
```

`apps/morphir-web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:"
    />
    <title>Morphir</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/morphir-web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
declare const __MORPHIR_WEB_VERSION__: string
```

- [ ] **Step 2: Write the failing layer tests**

`apps/morphir-web/test/browser-layers.test.ts`:
```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { defaultUiConfig, makeAppServices } from '@morphir/ui'
import { browserCore } from '../src/layers/browser-layers.ts'

describe('browserCore', () => {
  beforeEach(() => localStorage.clear())

  test('config defaults when localStorage is empty', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(await services.loadConfig()).toEqual(defaultUiConfig)
    expect(await services.version()).toBe('1.0.0')
  })

  test('config round-trips through localStorage', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    const cfg = { ...defaultUiConfig, github: { source: 'gh-cli' as const } }
    await services.saveConfig(cfg)
    expect(JSON.parse(localStorage.getItem('morphir-ui.config')!)).toEqual(cfg)
    expect(await services.loadConfig()).toEqual(cfg)
  })

  test('corrupt localStorage falls back to defaults', async () => {
    localStorage.setItem('morphir-ui.config', '{not json')
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(await services.loadConfig()).toEqual(defaultUiConfig)
  })

  test('web capabilities: no github, no reopen', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(services.capabilities).toEqual({ github: false, reopenWorkspaces: false })
    expect(services.github).toBeNull()
    expect(services.readWorkspace).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify failure** — `cd apps/morphir-web && bun install && bun run test` → FAIL.

- [ ] **Step 4: Implement**

`apps/morphir-web/src/layers/browser-layers.ts`:
```ts
import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  WorkspaceError,
  WorkspaceService,
  decodeUiConfig,
  defaultUiConfig,
  type CoreServices,
  type PickedWorkspace
} from '@morphir/ui'

const CONFIG_KEY = 'morphir-ui.config'

export const browserCore = (version: string): Layer.Layer<CoreServices> =>
  Layer.mergeAll(
    Layer.succeed(ConfigService, {
      load: Effect.sync(() => {
        try {
          return decodeUiConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}'))
        } catch {
          return defaultUiConfig
        }
      }),
      save: (config) => Effect.sync(() => localStorage.setItem(CONFIG_KEY, JSON.stringify(config)))
    }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.async<Option.Option<PickedWorkspace>, WorkspaceError>((resume) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resume(Effect.succeed(Option.none()))
          file.text().then(
            (content) => resume(Effect.succeed(Option.some({ ref: { path: file.name }, content }))),
            (e) => resume(Effect.fail(new WorkspaceError({ message: String(e) })))
          )
        }
        input.oncancel = () => resume(Effect.succeed(Option.none()))
        input.click()
      }),
      read: Option.none()
    }),
    Layer.succeed(AppInfoService, { version: Effect.succeed(version) })
  )
```

`apps/morphir-web/src/main.ts`:
```ts
import '@morphir/ui/theme.css'
import { mount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { browserCore } from './layers/browser-layers.ts'

const services = await makeAppServices({ core: browserCore(__MORPHIR_WEB_VERSION__) })
const initialConfig = await services.loadConfig()

mount(MorphirApp, {
  target: document.getElementById('app')!,
  props: { services, badge: 'WEB', version: __MORPHIR_WEB_VERSION__, initialConfig }
})
```

- [ ] **Step 5: Run tests + build, verify**

```bash
bun run test && bun run typecheck && bun run build && cd ../.. && mise exec -- moon run morphir-web:build
```
Expected: tests PASS, `dist/` produced, moon task green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): browser host with localStorage config and file-pick workspace layers"
```

---

### Task 10: morphir-desktop — Electron scaffold, IPC bridge, smoke mode

**Files:**
- Create: `apps/morphir-desktop/package.json`, `moon.yml`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/main/rpc.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/vite-env.d.ts`, `src/renderer/src/layers/rpc-client.ts`, `src/renderer/src/layers/desktop-layers.ts`
- Test: `apps/morphir-desktop/test/rpc.test.ts`

**Interfaces:**
- Consumes: `MorphirApp`, `makeAppServices`, tags, `defaultUiConfig` (@morphir/ui).
- Produces:
  - `RPC_CHANNEL = 'morphir-rpc'`; request `{ id: number; method: string; params?: unknown }`; response `{ id, result }` or `{ id, error: { code, message, data? } }`; `WIRE_CODE = -32001`, `WIRE_MESSAGE = 'morphir service error'`, `METHOD_NOT_FOUND = -32601`
  - `class RpcRegistry { register(method: string, handler: (params: unknown) => Promise<unknown>): void; dispatch(message: unknown): Promise<RpcResponse> }` (main)
  - `class RpcClient { call(method: string, params?: unknown): Promise<unknown>; effect<A>(method, params?): Effect.Effect<A, Error> }` (renderer)
  - Preload bridge `window.morphirIpc = { platform, postMessage, onMessage }` — the ONLY renderer↔main surface (scala posture; `platform` is a deliberate, documented addition for macChrome detection)
  - Main handlers this task: `morphir/shell/appVersion` → `{ version: string }`; `morphir/shell/smokeReport` `{ ok: boolean }` — in smoke mode prints `SMOKE OK`/`SMOKE FAILED` and exits 0/1; 90 s timeout exits 1
  - `desktopCore(rpc: RpcClient): Layer.Layer<CoreServices>` — AppInfo over RPC; config/workspace layers are marked INTERIM and replaced in Tasks 11–12

- [ ] **Step 1: Scaffold**

`apps/morphir-desktop/package.json`:
```json
{
  "name": "@morphir/desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "lint": "eslint src test",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && svelte-check --tsconfig ./tsconfig.json",
    "test": "bun test",
    "build": "electron-vite build",
    "dev": "electron-vite dev",
    "smoke": "electron-vite build && MORPHIR_SMOKE=1 electron ."
  },
  "dependencies": {
    "@morphir/ir": "workspace:*",
    "@morphir/ui": "workspace:*",
    "effect": "^3.22.1",
    "smol-toml": "^1.8.0",
    "svelte": "^5.56.10"
  },
  "devDependencies": {
    "electron": "^44.0.0",
    "electron-vite": "^5.0.0",
    "electron-builder": "^26.15.3",
    "vite": "^8.2.2",
    "@sveltejs/vite-plugin-svelte": "^7.3.0",
    "svelte-check": "^4.7.6",
    "typescript": "^5.9.0",
    "bun-types": "^1.4.0",
    "@types/node": "^26.4.0"
  }
}
```
(If electron-vite 5's peer range rejects vite 8, use the newest vite it accepts — Global Constraints degree of freedom.)

`apps/morphir-desktop/moon.yml`:
```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'
type: 'application'
language: 'typescript'
```

`apps/morphir-desktop/tsconfig.json` (renderer):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["svelte", "vite/client"], "noEmit": true },
  "include": ["src/renderer/src/**/*.ts", "src/renderer/src/**/*.svelte"]
}
```

`apps/morphir-desktop/tsconfig.node.json` (main + preload + tests):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@types/node", "bun-types"], "noEmit": true },
  "include": ["src/main/**/*.ts", "src/preload/**/*.ts", "test/**/*.ts", "electron.vite.config.ts"]
}
```

`apps/morphir-desktop/electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [svelte()] }
})
```

- [ ] **Step 2: Write the failing RPC registry tests**

`apps/morphir-desktop/test/rpc.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { METHOD_NOT_FOUND, RpcRegistry, WIRE_CODE, WIRE_MESSAGE } from '../src/main/rpc.ts'

describe('RpcRegistry', () => {
  test('dispatches to a registered handler', async () => {
    const registry = new RpcRegistry()
    registry.register('morphir/test/echo', async (params) => ({ echoed: params }))
    const response = await registry.dispatch({ id: 7, method: 'morphir/test/echo', params: { a: 1 } })
    expect(response).toEqual({ id: 7, result: { echoed: { a: 1 } } })
  })

  test('unknown method returns METHOD_NOT_FOUND', async () => {
    const registry = new RpcRegistry()
    const response = await registry.dispatch({ id: 1, method: 'nope' })
    expect(response.error!.code).toBe(METHOD_NOT_FOUND)
  })

  test('handler failure maps to the morphir wire error with detail in data', async () => {
    const registry = new RpcRegistry()
    registry.register('morphir/test/boom', async () => {
      throw new Error('workspace not found: /x')
    })
    const response = await registry.dispatch({ id: 2, method: 'morphir/test/boom' })
    expect(response.error).toEqual({
      code: WIRE_CODE,
      message: WIRE_MESSAGE,
      data: 'workspace not found: /x'
    })
  })

  test('malformed message still yields a response envelope', async () => {
    const registry = new RpcRegistry()
    const response = await registry.dispatch('garbage')
    expect(response.id).toBe(-1)
    expect(response.error!.code).toBe(METHOD_NOT_FOUND)
  })
})
```

- [ ] **Step 3: Run to verify failure** — `cd apps/morphir-desktop && bun install && bun test` → FAIL.

- [ ] **Step 4: Implement main, preload, renderer**

`src/main/rpc.ts`:
```ts
export const RPC_CHANNEL = 'morphir-rpc'
export const WIRE_CODE = -32001
export const WIRE_MESSAGE = 'morphir service error'
export const METHOD_NOT_FOUND = -32601

export interface RpcRequest { id: number; method: string; params?: unknown }
export interface RpcErrorShape { code: number; message: string; data?: unknown }
export interface RpcResponse { id: number; result?: unknown; error?: RpcErrorShape }

export type RpcHandler = (params: unknown) => Promise<unknown>

export class RpcRegistry {
  readonly #handlers = new Map<string, RpcHandler>()

  register(method: string, handler: RpcHandler): void {
    this.#handlers.set(method, handler)
  }

  async dispatch(message: unknown): Promise<RpcResponse> {
    const req = (typeof message === 'object' && message !== null ? message : {}) as Partial<RpcRequest>
    const id = typeof req.id === 'number' ? req.id : -1
    const handler = typeof req.method === 'string' ? this.#handlers.get(req.method) : undefined
    if (!handler) {
      return { id, error: { code: METHOD_NOT_FOUND, message: `method not found: ${String(req.method)}` } }
    }
    try {
      return { id, result: await handler(req.params) }
    } catch (e) {
      return {
        id,
        error: { code: WIRE_CODE, message: WIRE_MESSAGE, data: e instanceof Error ? e.message : String(e) }
      }
    }
  }
}
```

`src/main/index.ts`:
```ts
import { BrowserWindow, app, ipcMain } from 'electron'
import { join } from 'node:path'
import { RPC_CHANNEL, RpcRegistry } from './rpc.ts'

const smoke = process.env['MORPHIR_SMOKE'] === '1'
const registry = new RpcRegistry()

registry.register('morphir/shell/appVersion', async () => ({ version: app.getVersion() }))
registry.register('morphir/shell/smokeReport', async (params) => {
  const ok = typeof params === 'object' && params !== null && (params as { ok?: boolean }).ok === true
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED')
  if (smoke) app.exit(ok ? 0 : 1)
  return {}
})

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !smoke,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  })
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(smoke ? `${rendererUrl}?smoke=1` : rendererUrl)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: smoke ? { smoke: '1' } : undefined
    })
  }
  return win
}

void app.whenReady().then(() => {
  ipcMain.on(RPC_CHANNEL, (event, message) => {
    void registry.dispatch(message).then((response) => event.sender.send(RPC_CHANNEL, response))
  })
  createWindow()
  if (smoke) {
    setTimeout(() => {
      console.error('SMOKE TIMEOUT')
      app.exit(1)
    }, 90_000)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || smoke) app.quit()
})
```
(If `import.meta.dirname` is unavailable in the built main bundle, use `dirname(fileURLToPath(import.meta.url))` from `node:path`/`node:url`.)

`src/preload/index.ts` (ported from morphir-scala `preload.cjs`; `platform` is the one documented addition):
```ts
import { contextBridge, ipcRenderer } from 'electron'

const CHANNEL = 'morphir-rpc'

contextBridge.exposeInMainWorld('morphirIpc', {
  platform: process.platform,
  postMessage: (message: unknown) => ipcRenderer.send(CHANNEL, message),
  onMessage: (handler: (message: unknown) => void) =>
    ipcRenderer.on(CHANNEL, (_event, message) => handler(message))
})
```

`src/renderer/index.html` (CSP verbatim from scala plus `connect-src` for dev HMR):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:"
    />
    <title>Morphir</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`src/renderer/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`src/renderer/src/layers/rpc-client.ts`:
```ts
import { Effect } from 'effect'

export interface MorphirIpc {
  platform: string
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): void
}

declare global {
  interface Window { morphirIpc: MorphirIpc }
}

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void }
interface WireResponse { id: number; result?: unknown; error?: { message: string; data?: unknown } }

export class RpcClient {
  readonly #pending = new Map<number, Pending>()
  #nextId = 1
  readonly #ipc: MorphirIpc

  constructor(ipc: MorphirIpc = window.morphirIpc) {
    this.#ipc = ipc
    ipc.onMessage((message) => {
      const response = message as WireResponse
      const pending = this.#pending.get(response.id)
      if (!pending) return
      this.#pending.delete(response.id)
      if (response.error) {
        const detail = typeof response.error.data === 'string' ? response.error.data : response.error.message
        pending.reject(new Error(detail))
      } else {
        pending.resolve(response.result)
      }
    })
  }

  call(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++
      this.#pending.set(id, { resolve, reject })
      this.#ipc.postMessage({ id, method, params })
    })
  }

  effect<A>(method: string, params?: unknown): Effect.Effect<A, Error> {
    return Effect.tryPromise({
      try: () => this.call(method, params) as Promise<A>,
      catch: (e) => (e instanceof Error ? e : new Error(String(e)))
    })
  }
}
```

`src/renderer/src/layers/desktop-layers.ts`:
```ts
import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  WorkspaceService,
  defaultUiConfig,
  type CoreServices,
  type UiConfig
} from '@morphir/ui'
import type { RpcClient } from './rpc-client.ts'

export const desktopCore = (rpc: RpcClient): Layer.Layer<CoreServices> =>
  Layer.mergeAll(
    Layer.succeed(AppInfoService, {
      version: rpc.effect<{ version: string }>('morphir/shell/appVersion').pipe(
        Effect.map((r) => r.version),
        Effect.orDie
      )
    }),
    // INTERIM in-memory config — replaced by MORPHIR_HOME TOML over RPC in Task 11.
    Layer.sync(ConfigService, () => {
      let config: UiConfig = defaultUiConfig
      return {
        load: Effect.sync(() => config),
        save: (c: UiConfig) => Effect.sync(() => void (config = c))
      }
    }),
    // INTERIM no-op workspace — replaced by native dialogs over RPC in Task 12.
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.succeed(Option.none()),
      read: Option.none()
    })
  )
```

`src/renderer/src/main.ts`:
```ts
import '@morphir/ui/theme.css'
import { mount } from 'svelte'
import { MorphirApp, makeAppServices } from '@morphir/ui'
import { desktopCore } from './layers/desktop-layers.ts'
import { RpcClient } from './layers/rpc-client.ts'

const rpc = new RpcClient()
const services = await makeAppServices({ core: desktopCore(rpc) })
const version = await services.version()
const initialConfig = await services.loadConfig()

mount(MorphirApp, {
  target: document.getElementById('app')!,
  props: {
    services,
    badge: 'DESKTOP',
    version,
    initialConfig,
    macChrome: window.morphirIpc.platform === 'darwin'
  }
})

if (new URLSearchParams(location.search).get('smoke') === '1') {
  void rpc.call('morphir/shell/smokeReport', { ok: true })
}
```
(The smoke report only fires after `makeAppServices`, `version`, `loadConfig` and `mount` all succeeded — it IS the round-trip proof.)

- [ ] **Step 5: Run tests + build + smoke, verify**

```bash
bun test && bun run typecheck && bun run build && MORPHIR_HOME=$(mktemp -d) bun run smoke
```
Expected: tests PASS, build produces `out/`, smoke prints `SMOKE OK` and exits 0. On a headless machine prefix with `xvfb-run -a`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(desktop): electron scaffold with rpc bridge, preload posture and smoke mode"
```

---

### Task 11: morphir-desktop — ConfigService over MORPHIR_HOME TOML

**Files:**
- Create: `apps/morphir-desktop/src/main/config.ts`
- Modify: `apps/morphir-desktop/src/main/index.ts` (register handlers), `src/renderer/src/layers/desktop-layers.ts` (replace INTERIM config layer)
- Test: `apps/morphir-desktop/test/config.test.ts`

**Interfaces:**
- Consumes: `decodeUiConfig`, `defaultUiConfig`, `UiConfig` via the pure subpath `@morphir/ui/config` (no Svelte imports in the main process).
- Produces:
  - `morphirHome(env?): string` — `$MORPHIR_HOME` or `~/.morphir`
  - `uiConfigPath(env?): string` — `<home>/ui/config.toml`
  - `loadConfigFile(path?): Promise<UiConfig>` (missing/corrupt → defaults), `saveConfigFile(config, path?): Promise<void>` (mkdir -p + tmp-file + atomic rename; camelCase TOML keys)
  - RPC: `morphir/config/load` → `UiConfig`; `morphir/config/save` `{ config }` → `{}`

- [ ] **Step 1: Write the failing tests**

`apps/morphir-desktop/test/config.test.ts`:
```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultUiConfig } from '@morphir/ui/config'
import { loadConfigFile, morphirHome, saveConfigFile, uiConfigPath } from '../src/main/config.ts'

let dirs: string[] = []
const tempHome = () => {
  const dir = mkdtempSync(join(tmpdir(), 'morphir-ui-test-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }))
  dirs = []
})

describe('morphirHome', () => {
  test('respects MORPHIR_HOME and falls back to ~/.morphir', () => {
    expect(morphirHome({ MORPHIR_HOME: '/custom/home' })).toBe('/custom/home')
    expect(morphirHome({})).toContain('.morphir')
    expect(uiConfigPath({ MORPHIR_HOME: '/custom/home' })).toBe('/custom/home/ui/config.toml')
  })
})

describe('config file round-trip', () => {
  test('missing file yields defaults', async () => {
    expect(await loadConfigFile(join(tempHome(), 'ui', 'config.toml'))).toEqual(defaultUiConfig)
  })

  test('save then load round-trips', async () => {
    const path = join(tempHome(), 'ui', 'config.toml')
    const config = {
      ...defaultUiConfig,
      appearance: { colorScheme: 'light' as const, animations: false },
      workspace: { recent: ['/a/morphir-ir.json'], reopenOnLaunch: false, active: '/a/morphir-ir.json' }
    }
    await saveConfigFile(config, path)
    expect(await loadConfigFile(path)).toEqual(config)
  })

  test('corrupt TOML yields defaults, not a crash', async () => {
    const home = tempHome()
    mkdirSync(join(home, 'ui'), { recursive: true })
    writeFileSync(join(home, 'ui', 'config.toml'), '= not toml =')
    expect(await loadConfigFile(join(home, 'ui', 'config.toml'))).toEqual(defaultUiConfig)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun test test/config.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/main/config.ts`:
```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'smol-toml'
import { decodeUiConfig, defaultUiConfig, type UiConfig } from '@morphir/ui/config'

export const morphirHome = (env: Record<string, string | undefined> = process.env): string =>
  env['MORPHIR_HOME'] && env['MORPHIR_HOME'].length > 0 ? env['MORPHIR_HOME'] : join(homedir(), '.morphir')

export const uiConfigPath = (env?: Record<string, string | undefined>): string =>
  join(morphirHome(env), 'ui', 'config.toml')

export async function loadConfigFile(path: string = uiConfigPath()): Promise<UiConfig> {
  try {
    return decodeUiConfig(parse(await readFile(path, 'utf8')))
  } catch {
    return defaultUiConfig
  }
}

export async function saveConfigFile(config: UiConfig, path: string = uiConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, stringify(config), 'utf8')
  await rename(tmp, path)
}
```

The `"./config"` subpath export already exists in `packages/morphir-ui/package.json` (Task 4), and `config.ts` only imports the pure `shell-constants.ts` (Task 5) — so this chain contains zero Svelte.
**Import boundary rule:** `src/main/**` may import ONLY `@morphir/ui/config` and `@morphir/ui/token` (pure TS) — never `@morphir/ui` root (it pulls Svelte components into the main bundle).

In `src/main/index.ts` register (next to the shell handlers):
```ts
import { loadConfigFile, saveConfigFile } from './config.ts'
import { decodeUiConfig } from '@morphir/ui/config'

registry.register('morphir/config/load', async () => loadConfigFile())
registry.register('morphir/config/save', async (params) => {
  const config = decodeUiConfig((params as { config?: unknown })?.config)
  await saveConfigFile(config)
  return {}
})
```

Replace the INTERIM config layer in `src/renderer/src/layers/desktop-layers.ts`:
```ts
Layer.succeed(ConfigService, {
  load: rpc.effect<UiConfig>('morphir/config/load').pipe(Effect.orElseSucceed(() => defaultUiConfig)),
  save: (config: UiConfig) =>
    rpc.effect('morphir/config/save', { config }).pipe(Effect.asVoid, Effect.orDie)
})
```

- [ ] **Step 4: Run tests + smoke, verify**

```bash
bun test && bun run typecheck && MORPHIR_HOME=$(mktemp -d) bun run smoke
```
Expected: PASS; smoke green proves the renderer now boots through the real config RPC (its boot chain calls `loadConfig`).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(desktop): persist ui config as TOML under MORPHIR_HOME"
```

---

### Task 12: morphir-desktop — WorkspaceService with native dialogs

**Files:**
- Create: `apps/morphir-desktop/src/main/workspace.ts`
- Modify: `apps/morphir-desktop/src/main/index.ts`, `src/renderer/src/layers/desktop-layers.ts` (replace INTERIM workspace layer)
- Test: `apps/morphir-desktop/test/workspace.test.ts`

**Interfaces:**
- Produces:
  - `readWorkspaceFile(path: string): Promise<string>` — throws `Error('workspace not found: <path>')` on any read failure (message mirrors scala `UiServiceError.WorkspaceNotFound`)
  - RPC: `morphir/workspace/pick` → `{ path: string } | null` (native open dialog filtered to JSON); `morphir/workspace/read` `{ path }` → `{ content: string }`
  - Renderer WorkspaceService layer: `pickAndRead` chains pick→read; `read` is `Option.some` → desktop gains recents/reopen capability

- [ ] **Step 1: Write the failing tests**

`apps/morphir-desktop/test/workspace.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWorkspaceFile } from '../src/main/workspace.ts'

describe('readWorkspaceFile', () => {
  test('reads an existing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'morphir-ws-'))
    const path = join(dir, 'morphir-ir.json')
    writeFileSync(path, '{"formatVersion":3}')
    expect(await readWorkspaceFile(path)).toBe('{"formatVersion":3}')
  })

  test('maps missing files to the workspace-not-found contract', async () => {
    await expect(readWorkspaceFile('/nope/morphir-ir.json')).rejects.toThrow(
      'workspace not found: /nope/morphir-ir.json'
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement.

`src/main/workspace.ts`:
```ts
import { readFile } from 'node:fs/promises'

export async function readWorkspaceFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new Error(`workspace not found: ${path}`)
  }
}
```

In `src/main/index.ts` register:
```ts
import { dialog } from 'electron'
import { readWorkspaceFile } from './workspace.ts'

registry.register('morphir/workspace/pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Morphir workspace',
    filters: [{ name: 'Morphir IR', extensions: ['json'] }],
    properties: ['openFile']
  })
  return result.canceled || result.filePaths.length === 0 ? null : { path: result.filePaths[0] }
})
registry.register('morphir/workspace/read', async (params) => {
  const path = (params as { path?: string })?.path
  if (typeof path !== 'string') throw new Error('workspace not found: <missing path>')
  return { content: await readWorkspaceFile(path) }
})
```

Replace the INTERIM workspace layer in `desktop-layers.ts`:
```ts
Layer.succeed(WorkspaceService, {
  pickAndRead: rpc.effect<{ path: string } | null>('morphir/workspace/pick').pipe(
    Effect.mapError((e) => new WorkspaceError({ message: e.message })),
    Effect.flatMap((picked) =>
      picked === null
        ? Effect.succeed(Option.none())
        : rpc.effect<{ content: string }>('morphir/workspace/read', { path: picked.path }).pipe(
            Effect.mapError((e) => new WorkspaceError({ message: e.message })),
            Effect.map((r) => Option.some({ ref: { path: picked.path }, content: r.content }))
          )
    )
  ),
  read: Option.some((ref) =>
    rpc.effect<{ content: string }>('morphir/workspace/read', { path: ref.path }).pipe(
      Effect.mapError((e) => new WorkspaceError({ message: e.message })),
      Effect.map((r) => r.content)
    )
  )
})
```
(Add `WorkspaceError` to the `@morphir/ui` imports in that file.)

- [ ] **Step 3: Run tests + smoke** — `bun test && bun run typecheck && MORPHIR_HOME=$(mktemp -d) bun run smoke` → PASS / `SMOKE OK`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(desktop): native workspace pick and read with reopen capability"
```

---

### Task 13: morphir-desktop — SecretStore (safeStorage) and GitHub token services

**Files:**
- Create: `apps/morphir-desktop/src/main/secrets.ts`, `src/main/github.ts`
- Modify: `apps/morphir-desktop/src/main/index.ts` (register handlers), `src/renderer/src/layers/desktop-layers.ts` (add `desktopGitHub`), `src/renderer/src/main.ts` (pass the github layer)
- Test: `apps/morphir-desktop/test/secrets.test.ts`, `test/github.test.ts`

**Interfaces:**
- Consumes: `redactToken`, `Token` from `@morphir/ui/token`; config load/save from Task 11.
- Produces:
  - `interface SecretCrypto { isAvailable(): boolean; encryptString(plain: string): Buffer; decryptString(blob: Buffer): string }` (prod impl = Electron `safeStorage`)
  - `class SecretStore { constructor(file: string, crypto: SecretCrypto); get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> }` — JSON file of base64 encrypted blobs at `join(app.getPath('userData'), 'secrets.json')` (machine-local by design, spec §3); `set` throws `Error('secure storage is not available on this system')` when `!isAvailable()`
  - `GH_SECRET_KEY = 'github'`
  - `ghCliToken(exec?): Promise<string>` — runs `gh auth token`; missing binary / non-zero exit → `Error('gh CLI unavailable or not authenticated')`
  - `verifyGitHubToken(token: string, fetchImpl?): Promise<{ login: string }>` — `GET https://api.github.com/user`, headers `Authorization: Bearer <raw>`, `Accept: application/vnd.github+json`, `User-Agent: morphir-desktop`; non-OK → `Error('GitHub verification failed (<status>)')`. Runs in MAIN (CSP keeps the renderer off the network; raw token never re-enters the renderer).
  - RPC: `morphir/github/status` → `{ source, tokenDisplay }` (redacted or null); `morphir/github/setSource` `{ source: 'none' | 'gh-cli' }` → `{}`; `morphir/github/setToken` `{ token }` → `{}` (parses via `Token.parse`, rejects blank, stores raw in SecretStore, sets config source `pat`); `morphir/github/clearToken` → `{}` (deletes secret, source → `none`); `morphir/github/verify` → `{ login }` (token from active source; `none` → throws `'no token source configured'`)
  - `desktopGitHub(rpc: RpcClient): Layer.Layer<GitHubService>` for the renderer

- [ ] **Step 1: Write the failing tests**

`apps/morphir-desktop/test/secrets.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type SecretCrypto } from '../src/main/secrets.ts'

const fakeCrypto = (available = true): SecretCrypto => ({
  isAvailable: () => available,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse()),
  decryptString: (blob) => Buffer.from([...blob].reverse()).toString('utf8')
})

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'morphir-secrets-')), 'secrets.json')

describe('SecretStore', () => {
  test('set/get/delete round-trip through encryption', async () => {
    const store = new SecretStore(tempFile(), fakeCrypto())
    expect(await store.get('github')).toBeNull()
    await store.set('github', 'ghp_supersecretvalue1234')
    expect(await store.get('github')).toBe('ghp_supersecretvalue1234')
    await store.delete('github')
    expect(await store.get('github')).toBeNull()
  })

  test('file content never contains the plaintext', async () => {
    const file = tempFile()
    const store = new SecretStore(file, fakeCrypto())
    await store.set('github', 'ghp_supersecretvalue1234')
    const raw = await Bun.file(file).text()
    expect(raw).not.toContain('ghp_supersecretvalue1234')
  })

  test('refuses to store when encryption is unavailable', async () => {
    const store = new SecretStore(tempFile(), fakeCrypto(false))
    await expect(store.set('github', 'x')).rejects.toThrow('secure storage is not available')
  })
})
```

`apps/morphir-desktop/test/github.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { ghCliToken, verifyGitHubToken } from '../src/main/github.ts'

describe('verifyGitHubToken', () => {
  test('returns the login on 200', async () => {
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.github.com/user')
      expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer ghp_abc')
      return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 })
    }) as typeof fetch
    expect(await verifyGitHubToken('ghp_abc', fakeFetch)).toEqual({ login: 'octocat' })
  })

  test('maps failure statuses to a friendly error', async () => {
    const fakeFetch = (async () => new Response('bad', { status: 401 })) as typeof fetch
    await expect(verifyGitHubToken('ghp_abc', fakeFetch)).rejects.toThrow('GitHub verification failed (401)')
  })
})

describe('ghCliToken', () => {
  test('maps a missing gh binary to the friendly error', async () => {
    const failingExec = () => Promise.reject(new Error('spawn gh ENOENT'))
    await expect(ghCliToken(failingExec)).rejects.toThrow('gh CLI unavailable or not authenticated')
  })

  test('trims the token from stdout', async () => {
    const fakeExec = () => Promise.resolve({ stdout: 'gho_tok123\n', stderr: '' })
    expect(await ghCliToken(fakeExec)).toBe('gho_tok123')
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement.

`src/main/secrets.ts`:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretCrypto {
  isAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(blob: Buffer): string
}

export const GH_SECRET_KEY = 'github'

export class SecretStore {
  constructor(
    private readonly file: string,
    private readonly crypto: SecretCrypto
  ) {}

  async #read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  async #write(blobs: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(blobs), 'utf8')
  }

  async get(key: string): Promise<string | null> {
    const blobs = await this.#read()
    const blob = blobs[key]
    if (!blob) return null
    try {
      return this.crypto.decryptString(Buffer.from(blob, 'base64'))
    } catch {
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.crypto.isAvailable()) throw new Error('secure storage is not available on this system')
    const blobs = await this.#read()
    blobs[key] = this.crypto.encryptString(value).toString('base64')
    await this.#write(blobs)
  }

  async delete(key: string): Promise<void> {
    const blobs = await this.#read()
    delete blobs[key]
    await this.#write(blobs)
  }
}
```

`src/main/github.ts`:
```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type Exec = (file?: string, args?: string[]) => Promise<{ stdout: string; stderr: string }>
const defaultExec: Exec = (file = 'gh', args = ['auth', 'token']) =>
  promisify(execFile)(file, args).then(({ stdout, stderr }) => ({ stdout: String(stdout), stderr: String(stderr) }))

export async function ghCliToken(exec: Exec = defaultExec): Promise<string> {
  try {
    const { stdout } = await exec()
    const token = stdout.trim()
    if (!token) throw new Error('empty token')
    return token
  } catch {
    throw new Error('gh CLI unavailable or not authenticated')
  }
}

export async function verifyGitHubToken(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ login: string }> {
  const response = await fetchImpl('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'morphir-desktop'
    }
  })
  if (!response.ok) throw new Error(`GitHub verification failed (${response.status})`)
  const body = (await response.json()) as { login?: string }
  if (typeof body.login !== 'string') throw new Error('GitHub verification failed (no login)')
  return { login: body.login }
}
```

In `src/main/index.ts`, wire up (after `app.whenReady()` — `safeStorage` requires a ready app):
```ts
import { app, safeStorage } from 'electron'
import { redactToken, Token } from '@morphir/ui/token'
import { GH_SECRET_KEY, SecretStore } from './secrets.ts'
import { ghCliToken, verifyGitHubToken } from './github.ts'

// inside app.whenReady().then(() => { ... })
const secrets = new SecretStore(join(app.getPath('userData'), 'secrets.json'), safeStorage)

registry.register('morphir/github/status', async () => {
  const config = await loadConfigFile()
  const stored = config.github.source === 'pat' ? await secrets.get(GH_SECRET_KEY) : null
  return { source: config.github.source, tokenDisplay: stored ? redactToken(stored) : null }
})
registry.register('morphir/github/setSource', async (params) => {
  const source = (params as { source?: string })?.source
  if (source !== 'none' && source !== 'gh-cli') throw new Error(`invalid source: ${String(source)}`)
  const config = await loadConfigFile()
  await saveConfigFile({ ...config, github: { source } })
  return {}
})
registry.register('morphir/github/setToken', async (params) => {
  const token = Token.parse(String((params as { token?: string })?.token ?? ''))
  if (!token) throw new Error('token must not be empty')
  await secrets.set(GH_SECRET_KEY, token.unsafeReveal())
  const config = await loadConfigFile()
  await saveConfigFile({ ...config, github: { source: 'pat' } })
  return {}
})
registry.register('morphir/github/clearToken', async () => {
  await secrets.delete(GH_SECRET_KEY)
  const config = await loadConfigFile()
  await saveConfigFile({ ...config, github: { source: 'none' } })
  return {}
})
registry.register('morphir/github/verify', async () => {
  const config = await loadConfigFile()
  const token =
    config.github.source === 'pat'
      ? await secrets.get(GH_SECRET_KEY)
      : config.github.source === 'gh-cli'
        ? await ghCliToken()
        : null
  if (!token) throw new Error('no token source configured')
  return verifyGitHubToken(token)
})
```

Add to `src/renderer/src/layers/desktop-layers.ts`:
```ts
import { GitHubError, GitHubService, type GitHubStatus } from '@morphir/ui'

export const desktopGitHub = (rpc: RpcClient): Layer.Layer<GitHubService> =>
  Layer.succeed(GitHubService, {
    status: rpc.effect<GitHubStatus>('morphir/github/status').pipe(
      Effect.mapError((e) => new GitHubError({ message: e.message }))
    ),
    setSource: (source) =>
      rpc.effect('morphir/github/setSource', { source }).pipe(
        Effect.asVoid,
        Effect.mapError((e) => new GitHubError({ message: e.message }))
      ),
    savePat: (raw) =>
      rpc.effect('morphir/github/setToken', { token: raw }).pipe(
        Effect.asVoid,
        Effect.mapError((e) => new GitHubError({ message: e.message }))
      ),
    clearPat: rpc.effect('morphir/github/clearToken').pipe(
      Effect.asVoid,
      Effect.mapError((e) => new GitHubError({ message: e.message }))
    ),
    verify: rpc.effect<{ login: string }>('morphir/github/verify').pipe(
      Effect.mapError((e) => new GitHubError({ message: e.message }))
    )
  })
```

In `src/renderer/src/main.ts` change the services line:
```ts
import { desktopCore, desktopGitHub } from './layers/desktop-layers.ts'

const services = await makeAppServices({ core: desktopCore(rpc), github: desktopGitHub(rpc) })
```

- [ ] **Step 3: Run tests + smoke** — `bun test && bun run typecheck && MORPHIR_HOME=$(mktemp -d) bun run smoke` → PASS / `SMOKE OK`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(desktop): safeStorage-backed secret store and github token services"
```

---

### Task 14: @morphir/ui — Settings surface (General, Appearance, GitHub, About)

**Files:**
- Create: `packages/morphir-ui/src/views/settings/SettingsView.svelte`, `SettingsSidebar.svelte`, `SettingsRow.svelte`, `Toggle.svelte`, `SchemePicker.svelte`, `GeneralSection.svelte`, `AppearanceSection.svelte`, `GitHubSection.svelte`, `AboutSection.svelte`
- Modify: `packages/morphir-ui/src/shell/MorphirApp.svelte` (replace the Task 8 settings stub), `src/index.ts`
- Test: `packages/morphir-ui/test/settings.test.ts`

**Interfaces:**
- Consumes: `ShellState` (`route.section`, `selectSettingsSection`, `closeSettings`, `selectColorScheme`, `toggleAnimations`), `WorkspaceState`, `AppServices`, `SCHEME_LABELS`/`SCHEME_CLASSES`, icons.
- Produces:
  - `SettingsView.svelte` props: `{ services: AppServices; shell: ShellState; workspace: WorkspaceState; version: string }` — full-surface settings: left `SettingsSidebar` (Back row + sections; `github` only when `services.capabilities.github`), right = active section.
  - `Toggle.svelte` props: `{ checked: boolean; onChange: (value: boolean) => void; label: string }` — `role="switch"`, `aria-checked`.
  - `SchemePicker.svelte` props: `{ value: ColorScheme; onSelect: (s: ColorScheme) => void }` — three cards, each with a miniature shell preview painted in its own scheme class (live preview, scala parity).
  - GitHub UX contract (spec §4): source picker None / gh CLI / Personal access token; PAT field is `type="password"`, cleared after save; stored token shown ONLY redacted; Verify shows `Authenticated as <login>` or the failure message; Remove clears.

- [ ] **Step 1: Write the failing tests**

`packages/morphir-ui/test/settings.test.ts`:
```ts
import { render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import SettingsView from '../src/views/settings/SettingsView.svelte'
import { ShellState, WorkspaceState, makeAppServices } from '../src/index.ts'
import { makeFakeCore, makeFakeGitHub } from './support/fake-services.ts'

const setup = async (opts?: { github?: boolean }) => {
  const { core, store } = makeFakeCore()
  const github = opts?.github ? makeFakeGitHub({ login: 'octocat' }).github : undefined
  const services = await makeAppServices(github ? { core, github } : { core })
  const shell = new ShellState()
  shell.openSettings()
  render(SettingsView, {
    props: { services, shell, workspace: new WorkspaceState(services), version: '1.2.3' }
  })
  return { services, shell, store }
}

describe('SettingsView', () => {
  test('lists sections; GitHub hidden without the capability', async () => {
    await setup()
    expect(screen.getByText('General')).toBeTruthy()
    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.queryByText('GitHub')).toBeNull()
  })

  test('GitHub section appears with the capability', async () => {
    await setup({ github: true })
    expect(screen.getByText('GitHub')).toBeTruthy()
  })

  test('scheme picker updates the shell', async () => {
    const { shell } = await setup()
    shell.selectSettingsSection('appearance')
    await userEvent.click(await screen.findByRole('button', { name: /Light/ }))
    expect(shell.colorScheme).toBe('light')
  })

  test('reopen-on-launch toggle persists to config', async () => {
    const { shell, store } = await setup()
    shell.selectSettingsSection('general')
    await userEvent.click(await screen.findByRole('switch', { name: /Reopen on launch/ }))
    expect(store.config.workspace.reopenOnLaunch).toBe(false)
  })

  test('PAT capture: save shows redacted token, verify shows login, remove clears', async () => {
    const { shell } = await setup({ github: true })
    shell.selectSettingsSection('github')
    await userEvent.click(await screen.findByLabelText('Personal access token'))
    const input = await screen.findByPlaceholderText(/github_pat_/)
    await userEvent.type(input, 'ghp_' + 'k'.repeat(36) + 'TAIL')
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
    expect(await screen.findByText('Token(ghp_...TAIL)')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/Authenticated as octocat/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('Token(ghp_...TAIL)')).toBeNull()
  })

  test('about shows the version', async () => {
    const { shell } = await setup()
    shell.selectSettingsSection('about')
    expect(await screen.findByText('v1.2.3')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement.

`src/views/settings/SettingsRow.svelte`:
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  let {
    label,
    description = '',
    trailing
  }: { label: string; description?: string; trailing?: Snippet } = $props()
</script>

<div class="settings-row">
  <div class="row-text">
    <div class="row-label">{label}</div>
    {#if description}<div class="row-desc">{description}</div>{/if}
  </div>
  <div class="row-trailing">{#if trailing}{@render trailing()}{/if}</div>
</div>

<style>
  .settings-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 12px 0; border-bottom: 1px solid var(--row-edge);
  }
  .row-label { font-weight: 500; color: var(--text); }
  .row-desc { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .row-trailing { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 12.5px; color: var(--accent-text); }
</style>
```

`src/views/settings/Toggle.svelte`:
```svelte
<script lang="ts">
  let { checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string } = $props()
</script>

<button
  class="toggle"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  onclick={() => onChange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    width: 34px; height: 20px; border-radius: 999px; border: none; cursor: pointer;
    background: var(--dot); position: relative; transition: background 160ms ease;
  }
  .toggle.on { background: var(--accent); }
  .knob {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--knob); transition: transform 160ms ease;
  }
  .toggle.on .knob { transform: translateX(14px); }
</style>
```

`src/views/settings/SchemePicker.svelte`:
```svelte
<script lang="ts">
  import { SCHEME_CLASSES, SCHEME_LABELS, type ColorScheme } from '../../state/shell-state.svelte.ts'
  let { value, onSelect }: { value: ColorScheme; onSelect: (scheme: ColorScheme) => void } = $props()
  const SCHEMES: ColorScheme[] = ['system', 'light', 'dark']
</script>

<div class="schemes">
  {#each SCHEMES as scheme (scheme)}
    <button class="scheme-card" class:active={scheme === value} onclick={() => onSelect(scheme)}>
      <span class="preview {SCHEME_CLASSES[scheme]}">
        <span class="mini-top"></span>
        <span class="mini-body"><span class="mini-rail"></span><span class="mini-accent"></span></span>
      </span>
      {SCHEME_LABELS[scheme]}
    </button>
  {/each}
</div>

<style>
  .schemes { display: flex; gap: 12px; }
  .scheme-card {
    display: flex; flex-direction: column; gap: 6px; align-items: center; padding: 8px;
    border-radius: 10px; border: 1px solid var(--panel-edge); background: none;
    color: var(--muted); font-size: 12.5px; cursor: pointer;
  }
  .scheme-card.active { border-color: var(--accent); color: var(--text); }
  .preview {
    display: flex; flex-direction: column; width: 108px; height: 64px; border-radius: 8px;
    overflow: hidden; background: var(--bg); border: 1px solid var(--edge);
  }
  .mini-top { height: 12px; background: var(--surface); border-bottom: 1px solid var(--edge); }
  .mini-body { flex: 1; display: flex; }
  .mini-rail { width: 24px; background: var(--rail); border-right: 1px solid var(--edge); }
  .mini-accent { align-self: flex-end; margin: 6px; width: 28px; height: 6px; border-radius: 3px;
    background: linear-gradient(90deg, var(--accent), var(--accent2)); }
</style>
```

`src/views/settings/GeneralSection.svelte`:
```svelte
<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import Toggle from './Toggle.svelte'
  import type { AppServices } from '../../services/services.ts'
  import type { WorkspaceState } from '../../state/workspace-state.svelte.ts'
  let { services, workspace }: { services: AppServices; workspace: WorkspaceState } = $props()

  let reopenOnLaunch = $state(true)
  $effect(() => {
    void services.loadConfig().then((cfg) => (reopenOnLaunch = cfg.workspace.reopenOnLaunch))
  })
  async function setReopen(value: boolean) {
    reopenOnLaunch = value
    const cfg = await services.loadConfig()
    await services.saveConfig({ ...cfg, workspace: { ...cfg.workspace, reopenOnLaunch: value } })
  }
</script>

<SettingsRow label="Active workspace" description="The workspace currently open in the shell.">
  {#snippet trailing()}<span>{workspace.current?.ref.path ?? '—'}</span>{/snippet}
</SettingsRow>
<SettingsRow label="Reopen on launch" description="Reopen the last workspace when the app starts.">
  {#snippet trailing()}<Toggle checked={reopenOnLaunch} onChange={setReopen} label="Reopen on launch" />{/snippet}
</SettingsRow>
<SettingsRow label="Recent workspaces" description="Workspaces you opened recently.">
  {#snippet trailing()}<span>{workspace.recents.length === 0 ? '—' : workspace.recents.join(' · ')}</span>{/snippet}
</SettingsRow>
```

`src/views/settings/AppearanceSection.svelte`:
```svelte
<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import Toggle from './Toggle.svelte'
  import SchemePicker from './SchemePicker.svelte'
  import type { ShellState } from '../../state/shell-state.svelte.ts'
  let { shell }: { shell: ShellState } = $props()
</script>

<SettingsRow label="Color scheme" description="System follows your OS preference.">
  {#snippet trailing()}
    <SchemePicker value={shell.colorScheme} onSelect={(s) => shell.selectColorScheme(s)} />
  {/snippet}
</SettingsRow>
<SettingsRow label="Panel animations" description="Slide shell regions when they open and close.">
  {#snippet trailing()}
    <Toggle checked={shell.animations} onChange={() => shell.toggleAnimations()} label="Panel animations" />
  {/snippet}
</SettingsRow>
```

`src/views/settings/GitHubSection.svelte`:
```svelte
<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import type { AppServices, GitHubStatus } from '../../services/services.ts'
  let { services }: { services: AppServices } = $props()
  const github = services.github!

  let status = $state<GitHubStatus | null>(null)
  let patSelected = $state(false)
  let pat = $state('')
  let verifyResult = $state<string | null>(null)
  let error = $state<string | null>(null)

  const refresh = async () => (status = await github.status())
  $effect(() => {
    void refresh()
  })
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

  async function selectSource(source: 'none' | 'gh-cli') {
    error = null
    verifyResult = null
    patSelected = false
    try { await github.setSource(source); await refresh() } catch (e) { error = message(e) }
  }
  async function saveToken() {
    error = null
    try { await github.savePat(pat); pat = ''; await refresh() } catch (e) { error = message(e) }
  }
  async function verify() {
    error = null
    try { verifyResult = `Authenticated as ${(await github.verify()).login}` } catch (e) { error = message(e) }
  }
  async function remove() {
    error = null
    verifyResult = null
    try { await github.clearPat(); await refresh() } catch (e) { error = message(e) }
  }
</script>

<SettingsRow label="Token source" description="Exactly one source is active — no fallback chain.">
  {#snippet trailing()}
    <label><input type="radio" checked={status?.source === 'none' && !patSelected} onchange={() => selectSource('none')} /> None</label>
    <label><input type="radio" checked={status?.source === 'gh-cli'} onchange={() => selectSource('gh-cli')} /> gh CLI</label>
    <label aria-label="Personal access token">
      <input type="radio" checked={status?.source === 'pat' || patSelected} onchange={() => (patSelected = true)} /> Personal access token
    </label>
  {/snippet}
</SettingsRow>

{#if patSelected || status?.source === 'pat'}
  <SettingsRow label="Personal access token" description="Stored encrypted in the OS keychain. Never written to config or logs.">
    {#snippet trailing()}
      <input class="pat" type="password" placeholder="ghp_… or github_pat_…" bind:value={pat} />
      <button class="action" onclick={saveToken} disabled={pat.trim().length === 0}>Save token</button>
    {/snippet}
  </SettingsRow>
{/if}

{#if status?.tokenDisplay}
  <SettingsRow label="Stored token" description="Only the redacted form is ever displayed.">
    {#snippet trailing()}
      <span>{status.tokenDisplay}</span>
      <button class="action" onclick={remove}>Remove</button>
    {/snippet}
  </SettingsRow>
{/if}

<SettingsRow label="Verification" description="Calls GET /user with the active source.">
  {#snippet trailing()}
    <button class="action" onclick={verify}>Verify</button>
    {#if verifyResult}<span class="ok">{verifyResult}</span>{/if}
    {#if error}<span class="err">{error}</span>{/if}
  {/snippet}
</SettingsRow>

<style>
  .pat {
    width: 260px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--panel-edge);
    background: var(--code-bg); color: var(--text); font-family: var(--mono); font-size: 12.5px;
  }
  .action {
    padding: 5px 12px; border-radius: 8px; border: 1px solid var(--panel-edge);
    background: var(--hover-soft); color: var(--text); cursor: pointer; font-size: 12.5px;
  }
  .action:hover { background: var(--hover); }
  .action:disabled { opacity: 0.5; cursor: default; }
  label { display: flex; align-items: center; gap: 5px; color: var(--text); font-family: var(--sans, inherit); font-size: 13px; }
  .ok { color: var(--accent2); }
  .err { color: var(--accent); }
</style>
```

`src/views/settings/AboutSection.svelte`:
```svelte
<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  let { version }: { version: string } = $props()
</script>

<SettingsRow label="App version">
  {#snippet trailing()}<span>v{version}</span>{/snippet}
</SettingsRow>
<SettingsRow label="Foundation">
  {#snippet trailing()}<span>Svelte · Effect · @morphir/ui</span>{/snippet}
</SettingsRow>
```

`src/views/settings/SettingsSidebar.svelte`:
```svelte
<script lang="ts">
  import Icon from '../../icons/Icon.svelte'
  import type { SettingsSection } from '../../state/shell-state.svelte.ts'
  let {
    sections,
    active,
    onSelect,
    onBack
  }: {
    sections: ReadonlyArray<{ key: SettingsSection; label: string }>
    active: SettingsSection
    onSelect: (key: SettingsSection) => void
    onBack: () => void
  } = $props()
</script>

<div class="settings-side">
  <button class="back" onclick={onBack}><Icon name="back" /> Back</button>
  {#each sections as section (section.key)}
    <button class="section" class:active={section.key === active} onclick={() => onSelect(section.key)}>
      {section.label}
    </button>
  {/each}
</div>

<style>
  .settings-side { display: flex; flex-direction: column; gap: 2px; width: 180px; flex-shrink: 0; }
  .back {
    display: flex; align-items: center; gap: 7px; padding: 8px 10px; margin-bottom: 10px;
    border-radius: 8px; background: none; border: none; color: var(--muted); cursor: pointer; text-align: left;
  }
  .back:hover { background: var(--hover); color: var(--text); }
  .section {
    padding: 8px 10px; border-radius: 8px; background: none; border: none; text-align: left;
    color: var(--nav); font-weight: 500; cursor: pointer;
  }
  .section:hover { background: var(--hover-soft); color: var(--text); }
  .section.active {
    background: linear-gradient(to right, rgba(214, 64, 159, 0.16) 0%, rgba(139, 92, 246, 0.1) 100%);
    color: var(--text-strong);
  }
</style>
```

`src/views/settings/SettingsView.svelte`:
```svelte
<script lang="ts">
  import SettingsSidebar from './SettingsSidebar.svelte'
  import GeneralSection from './GeneralSection.svelte'
  import AppearanceSection from './AppearanceSection.svelte'
  import GitHubSection from './GitHubSection.svelte'
  import AboutSection from './AboutSection.svelte'
  import type { AppServices } from '../../services/services.ts'
  import type { ShellState, SettingsSection } from '../../state/shell-state.svelte.ts'
  import type { WorkspaceState } from '../../state/workspace-state.svelte.ts'

  let {
    services,
    shell,
    workspace,
    version
  }: { services: AppServices; shell: ShellState; workspace: WorkspaceState; version: string } = $props()

  const sections = $derived(
    ([
      { key: 'general', label: 'General' },
      { key: 'appearance', label: 'Appearance' },
      ...(services.capabilities.github ? [{ key: 'github', label: 'GitHub' }] : []),
      { key: 'about', label: 'About' }
    ] as ReadonlyArray<{ key: SettingsSection; label: string }>)
  )
  const active = $derived(shell.route.kind === 'settings' ? shell.route.section : 'general')
</script>

<div class="settings">
  <SettingsSidebar
    {sections}
    {active}
    onSelect={(key) => shell.selectSettingsSection(key)}
    onBack={() => shell.closeSettings()}
  />
  <div class="settings-body">
    {#if active === 'general'}<GeneralSection {services} {workspace} />
    {:else if active === 'appearance'}<AppearanceSection {shell} />
    {:else if active === 'github' && services.capabilities.github}<GitHubSection {services} />
    {:else}<AboutSection {version} />{/if}
  </div>
</div>

<style>
  .settings { display: flex; gap: 22px; }
  .settings-body { flex: 1; min-width: 0; }
</style>
```

In `MorphirApp.svelte`, replace the Task 8 stub:
```svelte
{#if shell.isSettings}
  <SettingsView {services} {shell} {workspace} {version} />
{:else if activeNav === 'overview'}
```
and add `import SettingsView from '../views/settings/SettingsView.svelte'`.

Add to `src/index.ts`:
```ts
export { default as SettingsView } from './views/settings/SettingsView.svelte'
```

- [ ] **Step 3: Run all package tests** — `bun run test && bun run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): settings surface with scheme picker, general, github token capture and about"
```

---

### Task 15: morphir-desktop — electron-builder packaging

**Files:**
- Create: `apps/morphir-desktop/electron-builder.yml`, `apps/morphir-desktop/build/.gitkeep`
- Modify: `apps/morphir-desktop/package.json` (add `package` script), `apps/morphir-desktop/moon.yml` (package task)

**Interfaces:**
- Produces: `moon run morphir-desktop:package` → unsigned installers/archives under `apps/morphir-desktop/release/`.

- [ ] **Step 1: Port electron-builder.yml (from morphir-scala, files list adapted to electron-vite output)**

`apps/morphir-desktop/electron-builder.yml`:
```yaml
appId: org.finos.morphir.desktop
productName: Morphir Desktop
copyright: Copyright © FINOS
artifactName: ${name}-${version}-${os}-${arch}.${ext}
directories:
  output: release
  buildResources: build
files:
  - out/**/*
  - package.json
mac:
  target:
    - zip
    - dmg
  category: public.app-category.developer-tools
  notarize: false
win:
  target:
    - zip
    - nsis
linux:
  target:
    - tar.gz
    - AppImage
    - deb
  category: Development
```

Add to `apps/morphir-desktop/package.json` scripts:
```json
"package": "electron-vite build && electron-builder --publish=never"
```

Add to `apps/morphir-desktop/moon.yml`:
```yaml
tasks:
  package:
    command: 'bun run package'
    local: true
```

- [ ] **Step 2: Verify a fast local package**

```bash
cd apps/morphir-desktop && bun run build && bunx electron-builder --linux tar.gz --publish=never
ls release/
```
Expected: `morphir-desktop-0.1.0-linux-x64.tar.gz` (per artifactName) in `release/`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(desktop): electron-builder packaging for mac, windows and linux"
```

---

### Task 16: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the moon task contract (Task 1), desktop smoke (Task 10), package script (Task 15).

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: jdx/mise-action@v3
      - run: bun install --frozen-lockfile
      - run: moon run :lint :typecheck :test :build
      - name: Install xvfb
        run: sudo apt-get update && sudo apt-get install -y xvfb
      - name: Desktop smoke
        working-directory: apps/morphir-desktop
        env:
          MORPHIR_HOME: /tmp/morphir-home
        run: xvfb-run -a bun run smoke

  package:
    needs: check
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.0
      - run: bun install --frozen-lockfile
      - name: Package
        working-directory: apps/morphir-desktop
        shell: bash
        run: bun run package
      - uses: actions/upload-artifact@v4
        with:
          name: morphir-desktop-${{ matrix.os }}
          path: |
            apps/morphir-desktop/release/*.tar.gz
            apps/morphir-desktop/release/*.AppImage
            apps/morphir-desktop/release/*.deb
            apps/morphir-desktop/release/*.zip
            apps/morphir-desktop/release/*.dmg
            apps/morphir-desktop/release/*.exe
```

- [ ] **Step 2: Validate locally**

```bash
mise exec -- moon run :lint :typecheck :test :build
```
Expected: all green (this is exactly what the `check` job runs).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: lint, typecheck, test, build, smoke and 3-os packaging"
```

---

### Task 17: Final verification, push, PR

**Files:** none (verification + delivery only)

- [ ] **Step 1: Full verification against the spec's success criteria**

```bash
cd /home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-ui
mise exec -- bun install --frozen-lockfile
mise exec -- moon run :lint :typecheck :test :build
cd apps/morphir-desktop && MORPHIR_HOME=$(mktemp -d) bun run smoke && cd ../..
```
Expected: every task green; smoke prints `SMOKE OK`. Walk the spec's Success criteria list (§Success criteria) and confirm each has a passing test or a demonstrated behavior; record any gap instead of hand-waving it.

- [ ] **Step 2: Review history for authorship compliance**

```bash
git log --format='%an %ae%n%b' | grep -iE 'claude|anthropic|co-authored' || echo CLEAN
```
Expected: `CLEAN`. If anything matches, STOP and rewrite history before pushing (EasyCLA).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/bootstrap
gh pr create --repo finos/morphir-ui --title "feat: bootstrap morphir-ui monorepo with desktop and web apps" --body "$(cat <<'BODY'
## What

Bootstraps morphir-ui as the single home for Morphir UI development:

- moonrepo + mise + bun monorepo; TypeScript 7 (with svelte-check on TS 5 during the transition), Svelte 5, Effect
- `packages/morphir-ui` — the shared application: shell chrome, theme and design tokens ported verbatim from morphir-scala's desktop shell, IR explorer, settings surface, Effect service interfaces
- `packages/morphir-ir` — morphir-ir.json (formatVersion 3) decoding with friendly version errors
- `apps/morphir-desktop` — Electron host: MORPHIR_HOME TOML config, native workspace dialogs, safeStorage-backed GitHub token capture (PAT paste + gh CLI source, always-redacted display), headless smoke test, electron-builder packaging
- `apps/morphir-web` — browser host sharing the same app with web-appropriate capabilities
- CI: lint, typecheck, test, build, smoke, unsigned 3-OS packaging

## Design

- Spec: `docs/specs/2026-08-27-morphir-ui-bootstrap-design.md`
- Plan: `docs/plans/2026-08-27-morphir-ui-bootstrap.md`

## Follow-ups (separate PRs)

- morphir-scala retirement of its Electron UI modules once this ships
- morphir-elm classic visualization migration
- Morphir Live (finos/morphir) experiences
BODY
)"
```
(NO AI attribution in the PR body — Global Constraints.)

- [ ] **Step 4: Report** — PR URL, CI status, and any degrees of freedom exercised (version pairs adjusted, schema fixes) back to the user.
