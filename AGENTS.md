# Agent Instructions

Guidance for AI coding agents working on **finos/morphir-ui**, the Morphir ecosystem's UI monorepo.

## ⚠️ Commit authorship and DCO

**Every commit must be signed off** — `git commit -s` adds the `Signed-off-by` line the DCO check requires.

**Never add an AI assistant as author or co-author.** No `Co-Authored-By: Claude …`, no "Generated with …" trailers. FINOS repositories gate merges on EasyCLA; AI attribution breaks CLA verification and blocks the pull request. Only the human contributor appears in commit metadata.

## What this repository is

A moonrepo + mise + bun monorepo with two deployables over one shared application:

| Path                       | Package            | Role                                                                                          |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `packages/morphir-ir`      | `@morphir/ir`      | Morphir IR v3 decoding — envelope, explorer model, full value/type AST. Pure TypeScript.      |
| `packages/morphir-insight` | `@morphir/insight` | IR → display-tree transform (the insight visualization). Pure; depends only on `@morphir/ir`. |
| `packages/morphir-ui`      | `@morphir/ui`      | The shared Svelte 5 + Effect application: shell, theme, IR explorer, insight views, settings. |
| `apps/morphir-web`         |                    | Browser host.                                                                                 |
| `apps/morphir-desktop`     |                    | Electron host — `MORPHIR_HOME` config, `safeStorage` token capture.                           |

Designs live in `docs/specs/`, implementation plans in `docs/plans/`. Read the relevant spec before changing architecture; the decisions in them were reviewed and are binding.

## Toolchain

```bash
mise install        # acquire bun, node
bun install         # install workspace dependencies
moon run :build     # build everything
moon run :test      # test everything
moon run :lint :typecheck
```

moon global tasks live under `.moon/tasks/**` — **not** `.moon/tasks.yml`, which nothing inherits.

## Conventions

- **Domain modeling.** Follow Morphir's [domain modeling policy](https://github.com/finos/morphir/blob/main/docs/developers/domain-modeling.md). Make invalid states unrepresentable with discriminated unions and exhaustive matching. Use opaque or branded types and schema-backed smart constructors for values that share a primitive representation but have different meanings. Lifecycle variants carry exactly the data valid for that state; do not maintain parallel boolean flags and optional payloads. Effect services expose these domain types at capability boundaries.
- **Existing vocabulary first.** Before adding a primitive parameter, boolean state flag, or free-form string, inspect and extend the existing workspace, project, provider, and IR domain types when the concept already exists. Test boundary validation and lifecycle transitions.
- **Performance-sensitive internals.** A private compact representation is acceptable only when profiling or a reproducible benchmark proves the benefit. Keep it behind named helpers, test conversion to the public domain type, and document why it exists. Unrelated boolean flags are not an acceptable optimization.
- **Purity boundaries.** `@morphir/ir` and `@morphir/insight` contain no Svelte and no DOM, so Electron's main process and future non-browser hosts can import them.
- **Svelte 5 idiom.** Runes (`$state`/`$derived`/`$props`/`$effect`), `.svelte.ts` modules for stateful logic, snippets over slots.
- **No inline styles.** No `style=` attributes; use scoped `<style>` blocks and `style:` directives bound to CSS custom properties. Colors come from theme tokens with `light-dark()`; scheme classes only flip `color-scheme`.
- **TypeScript split.** TypeScript 7 (native) cannot serve `typescript-eslint` or `svelte-check`, so workspace roots use TS 5.x for tooling while pure-TS packages pin TS 7 locally (morphir-desktop uses a `typescript7` npm alias). Do not "fix" this by unifying versions.
- **Code display.** CodeMirror 6 (+ Lezer) for editable code surfaces, Shiki (pure-JS engine) for read-only highlighting. Monaco and tree-sitter were evaluated and rejected for the UI.
- **Leniency.** Unrecognized IR constructs decode to `UnknownNode` and render as a visible fallback. Decoders never throw on malformed input.
- **TDD.** Write the test first; `bun test` for pure packages, vitest + testing-library for components.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**

```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**

- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**

- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.

<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->

## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
