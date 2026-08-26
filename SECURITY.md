# Security policy

Morphir UI follows the [FINOS Security Vulnerabilities Responsible Disclosure Policy](https://community.finos.org/docs/governance/software-projects/cve-responsible-disclosure).

If you find a security vulnerability, report it privately. Do not open a public GitHub issue, post to the mailing list, or disclose it publicly before the project announces it.

## Reporting a vulnerability

- Use GitHub's [private vulnerability reporting](../../security/advisories/new) under this repository's Security tab. This is the preferred method.
- If you cannot use GitHub private reporting, email [morphir-maintainers-private@lists.finos.org](mailto:morphir-maintainers-private@lists.finos.org) and [security@finos.org](mailto:security@finos.org).

Include the affected version or commit, the vulnerability and its impact, and steps to reproduce it where possible.

## Our commitment

- We will acknowledge the report within five business days.
- We will provide an initial assessment within ten business days of acknowledgement.
- We will share progress while we investigate and prepare a fix, and coordinate disclosure timing with you.
- We will credit you in the published advisory unless you ask us not to.

FINOS does not operate a bug bounty program and does not offer monetary rewards for vulnerability reports.

## Vulnerability handling

1. You report the vulnerability through a private channel listed above.
2. The maintainers acknowledge and triage the report. If confirmed, they investigate and prepare a fix.
3. The project publishes a patched release when applicable.
4. The project discloses the vulnerability through a [GitHub Security Advisory](../../security/advisories) and follows the FINOS responsible disclosure policy.

Do not include vulnerability details in public issues, pull requests, or commit messages before the advisory is published.

## Scope

This policy applies to code and other artifacts in this repository. Security fixes apply to the latest actively maintained release. Archived repositories do not receive security fixes.

Report vulnerabilities in third-party dependencies to the dependency project first under its disclosure policy. You may also notify the Morphir maintainers privately so they can track exposure and plan an update.
