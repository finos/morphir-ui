# Releasing Morphir Desktop

For account setup, key custody, rehearsal, and rotation, read
[Desktop code signing for maintainers](desktop-code-signing.md) first.

Morphir Desktop releases are built from `desktop-v<VERSION>` tags. The tag version must exactly
match `apps/morphir-desktop/package.json`; a mismatch stops the workflow before packaging.

The release workflow produces these CLI-managed portable targets:

| Platform       | Portable target | Launch entry point                                   |
| -------------- | --------------- | ---------------------------------------------------- |
| Windows x86_64 | ZIP             | `morphir-desktop.exe`                                |
| macOS arm64    | ZIP             | `Morphir Desktop.app/Contents/MacOS/morphir-desktop` |
| Linux x86_64   | tar.gz          | `morphir-desktop`                                    |

It also publishes the NSIS, DMG, AppImage, and deb system packages produced by electron-builder.
GitHub Releases are the durable public source; the one-day workflow artifacts only transfer bytes
between jobs and are not a supported download location.

## Build channels

Build channels decide whether operating-system signing is required. They do not replace the
authenticated `stable` and `preview` update channels used by the Morphir CLI.

| Build channel       | Command or trigger                               | Signing  | Intended use                         |
| ------------------- | ------------------------------------------------ | -------- | ------------------------------------ |
| `developer`         | `bun run package` or `bun run package:developer` | Off      | Local work                           |
| `developer-insider` | Branch and pull-request CI                       | Off      | Shared CI packages and early testing |
| `preview`           | Prerelease `desktop-v*` tag                      | Required | Published prerelease                 |
| `stable`            | Final `desktop-v*` tag                           | Required | Published release                    |

Developer-channel packages record their build channel in packaged `package.json` metadata. CI
artifacts exist only to detect packaging regressions and support early testing. They must never be
promoted to a public release.

Local development follows the same rule. Neither of these commands needs code-signing or Apple
credentials:

```shell
bun run --cwd apps/morphir-desktop build
bun run --cwd apps/morphir-desktop package
```

`build` compiles the Electron application. `package` aliases `package:developer` and creates unsigned
packages for the host platform. Use `package:developer-insider` when testing the same build channel
as branch CI. Both pass `--config.mac.notarize=false` explicitly. The tag workflow is the only
checked-in path that passes `--config.mac.notarize=true`.

## Required signing secrets

Release jobs fail when their platform signing credentials are absent. Configure these GitHub
Actions secrets before pushing a release tag:

| Secret                     | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `WINDOWS_CSC_LINK`         | Base64 PKCS#12 Windows code-signing certificate |
| `WINDOWS_CSC_KEY_PASSWORD` | Windows certificate password                    |
| `MACOS_CSC_LINK`           | Base64 Developer ID Application certificate     |
| `MACOS_CSC_KEY_PASSWORD`   | macOS certificate password                      |
| `APPLE_API_KEY_BASE64`     | Base64 App Store Connect API `.p8` key          |
| `APPLE_API_KEY_ID`         | App Store Connect key ID                        |
| `APPLE_API_ISSUER`         | App Store Connect issuer ID                     |
| `APPLE_TEAM_ID`            | Apple Developer team ID                         |

Windows packaging verifies the Authenticode signature on the portable executable and installer.
macOS packaging verifies the application signature, stapled notarization ticket, Gatekeeper
assessment, and declared launch entry point. A failure prevents publication.

## Release metadata handoff

`release:contract` normalizes the portable packages into the Morphir tool-release v1 target layout.
It writes a canonical release descriptor and `release-targets.json`, containing the exact length,
SHA-256 digest, and Morphir TUF custom metadata for every target. The workflow publishes those files
with `SHA256SUMS` and GitHub build-provenance attestations.

These files are signing input, not TUF metadata. They must be admitted to the production TUF
repository by its targets-role signing workflow. Do not configure the CLI to trust
`release-targets.json` or GitHub artifact attestations in place of the out-of-band TUF root.

## Cut a release

1. Update `apps/morphir-desktop/package.json` to the exact semantic version and merge it to `main`.
2. Create and push the matching tag, for example `desktop-v0.2.0`.
3. Confirm all three package jobs completed their operating-system signature checks.
4. Inspect the GitHub release assets, checksums, and provenance attestations.
5. Submit the release targets to the production TUF targets-role signing workflow.
6. Verify the published TUF repository with `morphir tool install desktop --version <VERSION>`.

Versions with a SemVer prerelease component are published as preview releases and descriptors;
final versions enter the stable channel.
