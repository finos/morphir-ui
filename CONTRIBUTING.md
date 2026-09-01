# Morphir UI contribution and governance policies

This document describes how to contribute to the FINOS Morphir UI repository and how its maintainers govern repository changes.

The project is also governed by:

- [Linux Foundation Antitrust Policy](https://www.linuxfoundation.org/antitrust-policy/)
- FINOS [IP Policy](https://community.finos.org/governance-docs/IP-policy.pdf)
- FINOS [Community Code of Conduct](https://community.finos.org/docs/governance/code-of-conduct)
- FINOS [Collaborative Principles](https://community.finos.org/docs/governance/collaborative-principles/)
- FINOS [Meeting Procedures](https://community.finos.org/docs/governance/meeting-procedures/)

Morphir UI uses the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) and accepts contributions through GitHub pull requests.

## Project governance

Morphir UI is part of the [FINOS Morphir project](https://github.com/finos/morphir). The [Morphir maintainer roster](MAINTAINERS.md) acts as the Technical Steering Committee for this repository. FINOS policies and any approved Morphir technical charter take precedence over this file.

## Developer Certificate of Origin

Every commit must include a Developer Certificate of Origin sign-off. The sign-off certifies that you have the right to submit the contribution under the project's license. The DCO check fails if any commit in a pull request lacks a `Signed-off-by` line.

Read the [Developer Certificate of Origin](https://developercertificate.org/) before contributing. Add this line to each commit message, using your real name and an email address associated with your GitHub account:

```text
Signed-off-by: Jane Doe <jane.doe@example.com>
```

Create a signed-off commit with:

```bash
git commit -s -m "Describe the change"
```

You can configure Git to add the sign-off automatically:

```bash
git config --global format.signoff true
```

If the DCO check reports unsigned commits, add sign-offs with an interactive rebase, replacing `X` with the number of commits in your pull request:

```bash
git rebase -i HEAD~X --signoff
git push --force-with-lease
```

Do not merge a pull request while its DCO check is failing. See the [Linux Foundation DCO guidance](https://bestpractices.coreinfrastructure.org/en/criteria/0?details=true&rationale=true#1.dco) for background.

## Contributor License Agreement

This repository also uses EasyCLA. Contributors must sign the free [FINOS Contributor License Agreement](https://community.finos.org/docs/governance/software-projects/easycla/) as an individual or through their employer. You only need to establish coverage once for FINOS software projects that share the same EasyCLA group.

Open a pull request to start the check. If EasyCLA cannot confirm your coverage, the bot will explain how to sign or confirm your company affiliation. Email [help@finos.org](mailto:help@finos.org) if you have trouble with the process.

## Engineering principles

Morphir UI follows the ecosystem [domain modeling policy](https://github.com/finos/morphir/blob/main/docs/developers/domain-modeling.md). Public APIs and application state should make invalid states unrepresentable. Prefer discriminated unions, exhaustive matching, opaque or branded values, and validating constructors over boolean state flags, optional payload combinations, and unconstrained strings.

Performance-critical private code may use compact representations when profiling or a reproducible benchmark proves the benefit. Keep the representation behind named helpers, test conversion to the domain type, and do not expose it through public APIs.

## Contribution process

1. Search existing issues for the same problem or proposal.
2. Join the existing discussion, or open an issue that explains the problem and the change you propose.
3. Fork the repository and create a focused branch.
4. Make the change and add appropriate tests and documentation when an implementation exists.
5. Sign off every commit.
6. Open a pull request, complete EasyCLA if prompted, and respond to review comments.

## Pull request guidelines

- Keep each pull request focused on one change.
- Follow the existing code and documentation structure.
- Link related issues.
- Avoid unrelated formatting and whitespace changes.
- Make sure the branch merges cleanly and all repository checks pass.
- Add the [Apache License 2.0 header](https://www.apache.org/licenses/LICENSE-2.0#apply) and copyright information to new source files.
- Update [NOTICE](NOTICE) when a new dependency or contribution requires attribution.

## Roles

A Contributor is anyone who contributes code, documentation, issues, reviews, meeting participation, or other project work.

A Maintainer is a Contributor with write access who may review and merge pull requests. Maintainers are the voting members of the Technical Steering Committee for this repository.

The TSC Chair is the project's contact with FINOS staff and the FINOS Governing Board. The maintainers may elect a Chair through the voting process below.

## Contribution rules

The key words MUST, SHALL, SHOULD, and MAY have the meanings defined in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

- All changes MUST arrive through pull requests, including changes by Maintainers.
- A Maintainer other than the Contributor SHOULD review each pull request before merge.
- Non-trivial pull requests SHOULD remain open long enough for all Maintainers to review them.
- If no Maintainer objects after review, any Maintainer MAY merge the pull request.
- If a Maintainer objects, the Maintainers SHOULD seek consensus. If they cannot reach consensus, any Maintainer MAY call a vote.

## TSC voting

The TSC MAY vote when it cannot reach consensus. Votes use these values:

- `+1` means agree.
- `-1` means disagree.
- `+0` means abstain.

A meeting has quorum when at least half of all voting TSC members attend. A motion at a meeting passes with a majority of votes cast when quorum is present. An electronic vote outside a meeting requires a majority of all voting TSC members. If the project has one Maintainer, that Maintainer decides matters that would otherwise require a vote.

The TSC decides contested pull requests and the election or removal of Maintainers and the TSC Chair. Discussion and votes MUST be public in the relevant issue or pull request, an official public project channel, or a minuted project meeting.

## Maintainer changes

A Contributor who has made substantial contributions MAY apply or be nominated as a Maintainer. The existing Maintainers decide the nomination under the voting rules above.

Submit every maintainer addition, removal, or correction as a pull request to [MAINTAINERS.md](MAINTAINERS.md). Link any required vote from the pull request, and email [help@finos.org](mailto:help@finos.org) after a maintainership change.

## Changes to this document

The TSC MAY amend this document with a two-thirds vote of the entire TSC, subject to approval by LF Projects where required.
