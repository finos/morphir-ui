# Insight fixture sources

Elm sources compiled once with the morphir-elm CLI (sibling submodule) to
produce `packages/morphir-ir/test/fixtures/insight-ir.json` (formatVersion 3).

Provenance: generated from this directory with

    node <morphir-elm>/cli/morphir-elm.js make -f -p . -o <out> -i

using morphir-elm at the commit recorded below. Regenerate only when the
fixture sources change; commit source and output together.

morphir-elm commit: b36c00c8b2b8481763cfe2606e1c5d8f18e38865

The `elm.json` in this directory works as written (the `direct: { "elm/core":
"1.0.5" }` dependency set with `../../../morphir-elm/src` added to
`source-directories` is sufficient; no additional packages from
`morphir-elm/tests-integration/reference-model/elm.json` were needed).
