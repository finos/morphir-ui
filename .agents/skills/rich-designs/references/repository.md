# morphir-ui

- `AGENTS.md` owns repository conventions. Architecture specifications belong in `docs/specs/`, implementation
  plans in `docs/plans/`, and reviewed decisions there are binding. Inspect an existing document before adding one.
- Use HTML when the review needs diagrams, navigation or progressive disclosure. Reuse an existing template or
  documentation site if one is present. Do not invent a second site or claim a preview deployment exists without
  checking it. Temporary `.dev/` and `docs/superpowers/` drafts stay local through the repository-local git exclude
  when needed; do not alter the tracked `.gitignore` just for those local drafts.
- [beads](../../beads/SKILL.md) supplies tracker guidance. This repository has its own tracker, configured in
  `.beads/config.yaml`; do not assume morphir-moonbit's shared-database location or issue prefix. Check/bootstrap
  the main checkout before opening a tracker from a new worktree. Record published spec paths/revisions in its
  task; when beads owns a draft, store the complete HTML in that task's `design` field.
- Persistent discoveries belong in beads. Keep a short pointer to a maintained skill instead of copying a long
  workflow into a memory. The parent skill gives a `moonx cli/jq@0.2.2 -j` fallback for exact HTML recovery.

The application uses Svelte 5, Effect and theme tokens. Apply the installed frontend-design skill within those
conventions: no `style=` attributes, respect the existing theme, and keep pure IR/insight packages free of DOM
and Svelte. A request to improve an HTML specification does not authorize restyling the product.

This repo's `moon` command is moonrepo, not the MoonBit compiler. Use `moonx` explicitly for MoonBit scripts;
do not replace the existing moonrepo toolchain to run them. Native `bd` commands remain appropriate.

For documentation/skill-only edits, validate frontmatter, relative links, discovery paths, upstream file identity
and licensing, and use the installed Prettier tooling for authored Markdown/YAML. Keep vendored upstream files
unchanged. Run application lint/typecheck/test/build when application behavior changes; CI runs its configured
suite even for skills-only PRs. Do not weaken those jobs to land a skill.

Every commit requires `git commit -s` for DCO, with only the human contributor in authorship metadata.
The conservative beads profile defers git/sync operations unless explicitly authorized. A current user request
to land these changes supplies that authority; it does not grant administrative branch-protection bypass.
