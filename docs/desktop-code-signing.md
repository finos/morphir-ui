# Desktop code signing for maintainers

Most Morphir Desktop work needs no signing account or private key. Signing begins only when a
maintainer pushes a production `desktop-v*` tag.

This document explains the accounts, credentials, and checks behind that production path. It is
written for maintainers who have not operated a signed desktop release before.

## The four trust checks

The release uses separate trust systems. Passing one does not replace another.

| Check                                    | What it proves                                                     | Needed for developer builds? | Needed for a public release? |
| ---------------------------------------- | ------------------------------------------------------------------ | ---------------------------- | ---------------------------- |
| Git commit and GitHub Actions provenance | Which source and workflow produced a file                          | No                           | Yes                          |
| Windows Authenticode                     | The Windows publisher and file integrity                           | No                           | Yes                          |
| Apple Developer ID and notarization      | The macOS publisher, file integrity, and Apple malware scan        | No                           | Yes                          |
| TUF repository metadata                  | Which exact Morphir release and update channel the CLI may install | Development root only        | Yes                          |

`developer` and `developer-insider` packages skip operating-system signing. They are useful for
local work and CI testing but are not public releases. `stable` and `preview` releases require every
applicable check.

## What developers need

Nothing beyond the checked-in toolchain:

```shell
bun install --frozen-lockfile
bun run --cwd apps/morphir-desktop build
bun run --cwd apps/morphir-desktop package
```

`package` selects the unsigned `developer` build channel. Branch and pull-request CI selects the
unsigned `developer-insider` channel. Neither path reads Windows or Apple secrets.

An unsigned macOS package may trigger Gatekeeper warnings when another person downloads it. That is
expected. Share it only as a development artifact and tell testers that it is unsigned. Never ask a
tester to treat it as a production build.

## Accounts and owners needed for production

Before the first public release, name people for these responsibilities:

| Responsibility                | Account or role                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| GitHub release administration | FINOS `morphir-ui` maintainer who can configure Actions secrets and inspect release runs       |
| Apple program ownership       | FINOS organization membership in the Apple Developer Program, with its Account Holder involved |
| Apple certificate creation    | Apple Account Holder, or an Admin with the required certificate access                         |
| Apple notarization automation | App Store Connect Admin who can create a team API key                                          |
| Windows publisher identity    | FINOS-controlled public-trust code-signing account or certificate-provider account             |
| Windows signing operation     | A narrowly authorized CI identity or signing-service principal                                 |
| TUF root custody              | At least two named human root-key custodians, separate from ordinary CI                        |

Do not register production signing identities to an individual contributor when the publisher should
be FINOS. Organization ownership makes renewal, offboarding, and incident response possible without
depending on one person's account.

## Apple setup

### 1. Confirm program membership and roles

The publisher needs an organization membership in the
[Apple Developer Program](https://developer.apple.com/help/account/basics/about-your-developer-account).
Apple documents the current permissions in its
[roles reference](https://developer.apple.com/help/account/access/roles).

For direct distribution outside the Mac App Store, Morphir needs a **Developer ID Application**
certificate. Apple currently reserves creation of Developer ID certificates for the Account Holder,
with cloud-managed access available to suitably authorized Admins. Follow Apple's
[Developer ID certificate procedure](https://developer.apple.com/help/account/certificates/create-developer-id-certificates).

Morphir currently publishes a ZIP and DMG, not a signed `.pkg`. A Developer ID Installer certificate
is therefore not part of the current workflow.

### 2. Create and export the Developer ID Application credential

The person creating the certificate generates a certificate-signing request on a controlled Mac,
creates the Developer ID Application certificate in Apple's portal, and installs the returned
certificate in the same keychain that holds the private key.

Export the certificate and private key together as a password-protected PKCS#12 file for CI only if
FINOS policy permits an exportable key. Store the PKCS#12 bytes and password in the organization's
approved secret manager before adding them to GitHub. Base64 encoding makes binary data suitable for
a secret field; it does not encrypt or protect the certificate.

The workflow reads:

| GitHub secret            | Value                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `MACOS_CSC_LINK`         | Base64-encoded PKCS#12 containing the Developer ID Application certificate and private key |
| `MACOS_CSC_KEY_PASSWORD` | PKCS#12 export password                                                                    |

If FINOS requires a non-exportable or cloud-managed Apple key, stop here. The current workflow must
be adapted to that custody model rather than copying the key into GitHub.

### 3. Create the notarization API key

Use a **team** App Store Connect API key. Individual keys do not work with `notarytool`. An App Store
Connect Admin creates a team key under **Users and Access > Integrations > App Store Connect API**.
Apple's [API-key guide](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
describes the roles and one-time private-key download.

Download the `.p8` file once and place it immediately in approved secret storage. Record its key ID
and the team's issuer ID at the same time.

The workflow reads:

| GitHub secret          | Value                                 |
| ---------------------- | ------------------------------------- |
| `APPLE_API_KEY_BASE64` | Base64-encoded `.p8` team key         |
| `APPLE_API_KEY_ID`     | App Store Connect key ID              |
| `APPLE_API_ISSUER`     | App Store Connect issuer ID           |
| `APPLE_TEAM_ID`        | Ten-character Apple Developer team ID |

The release runner decodes the key into its temporary directory, submits the signed app to Apple's
notary service, staples the returned ticket, and then runs `codesign`, `stapler`, and Gatekeeper
verification. A failed check stops publication.

## Windows setup

Windows public releases need an Authenticode identity. There are two practical custody models.

### Managed signing service

This is the preferred organizational model when it is available. Microsoft
[Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/overview) manages keys in
HSMs and exposes signing through Azure identities. Setup requires:

- an Azure subscription and resource group owned by the organization;
- an Artifact Signing account;
- completed public-trust identity validation for FINOS;
- a public-trust certificate profile;
- a CI principal assigned only the certificate-profile signer role.

Microsoft's [setup quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
and [role-assignment guide](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles)
cover those resources.

The checked-in workflow does not yet implement this route. Adopting it means replacing the two PFX
secrets below with workload identity federation and an Artifact Signing integration. Do not create a
long-lived Azure client secret merely to avoid that work.

### Certificate file

The current workflow supports a password-protected PKCS#12 code-signing certificate through
electron-builder. The certificate must represent the FINOS publisher identity and chain to a root
trusted by supported Windows versions. Ask the selected certificate authority whether its current
issuance and hardware requirements permit this CI model before purchasing it.

The workflow reads:

| GitHub secret              | Value                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `WINDOWS_CSC_LINK`         | Base64-encoded PKCS#12 code-signing certificate and private key |
| `WINDOWS_CSC_KEY_PASSWORD` | PKCS#12 password                                                |

electron-builder signs the packaged executable and NSIS installer. The workflow then uses Windows
`Get-AuthenticodeSignature` to require a valid signature. Microsoft recommends SHA-256 and RFC 3161
time stamping so signatures remain valid after certificate expiry; see Microsoft's
[Authenticode time-stamping guidance](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures).

If the certificate arrives on a hardware token or remote HSM, do not export it or work around its
controls. Adapt the workflow to the provider's supported SignTool integration.

## GitHub configuration

Only repository administrators should add or replace signing secrets.

1. Obtain each credential through the approved organizational process.
2. Keep the source files in the approved secret manager. GitHub is a deployment destination, not the
   only backup.
3. Add each value under **Settings > Secrets and variables > Actions** using the exact names above.
4. Restrict who can modify `.github/workflows/release-desktop.yml` with CODEOWNERS and branch rules.
5. Require review for version bumps and `desktop-v*` tags.
6. Record certificate owners, expiry dates, API-key owners, and renewal dates outside the repository.

Never paste a private key into an issue, pull request, workflow log, terminal transcript, or committed
`.env` file. Avoid commands that print encoded secrets to standard output in a recorded terminal.

## Rehearse before the first release

Start with the keyless paths and add trust one platform at a time:

1. Confirm `developer` packaging locally.
2. Confirm all three `developer-insider` CI package jobs are green.
3. Add Windows credentials and verify a signed throwaway package on a protected branch or temporary
   workflow that cannot publish a release.
4. Add Apple credentials and verify signing, notarization, stapling, and Gatekeeper assessment without
   publishing.
5. Rotate the test credentials if the rehearsal exposed them to more people or systems than intended.
6. Cut a prerelease tag and inspect every signature, checksum, provenance record, and TUF target before
   testing CLI installation.
7. Cut a stable release only after the prerelease installs and launches on clean machines.

The production tag workflow deliberately fails when a required credential is absent. That failure is
a release-control success. Developer builds remain green because they never enter that path.

## Rotation and incident response

- Track certificate and API-key expiry well before the release that would first be affected.
- Rehearse replacement with a prerelease build.
- Revoke an App Store Connect key immediately if its `.p8` file may be exposed.
- Contact Apple through its documented process before revoking a Developer ID certificate. Revocation
  affects already signed applications, not only future builds.
- Revoke or disable the Windows signing credential or CI principal through its provider after suspected
  compromise.
- Remove replaced secrets from GitHub and verify that old workflow runs cannot use them.
- Treat TUF root-key response as a separate procedure. OS code-signing rotation does not rotate the CLI's
  update trust root.

Do not test revocation for the first time during an incident. Assign owners and write the contact path
before enabling public release tags.
