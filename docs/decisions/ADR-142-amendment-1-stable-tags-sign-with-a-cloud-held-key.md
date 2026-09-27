## ADR-142 Amendment 1 - Stable tags sign with a cloud-held key, and the update feed must name the signer (2026-09-27)

**Status:** Implemented; needs the maintainer's certificate before the first signed tag. | **Date:** 2026-09-27

### Context

ADR-142 made stable tags fail closed without `CSC_LINK` and `CSC_KEY_PASSWORD`, a `.pfx`
certificate file and its password. Since June 2023 certificate authorities issue code-signing
keys only on hardware tokens or cloud key vaults, so a certificate bought today never comes as a
`.pfx` and the workflow could not sign with it (`docs/audits/2026-09-27-electron-desktop-audit.md`,
item S1). The maintainer chose a cloud certificate (2026-09-27); the workflow uses SSL.com eSigner,
which works from GitHub-hosted Windows runners with no hardware.

The audit also found that the update check depends on a file nobody checked. electron-updater
installs a downloaded update only when its signer matches `publisherName` in
`resources/app-update.yml`, and when that key is missing it installs the update without checking
its signature at all (`NsisUpdater.verifySignature`). electron-builder writes `publisherName` from
the signing certificate. A build that signed nothing writes none; a package built on 2026-09-27
with no certificate confirmed that.

### Decision

- **Secrets.** Tag builds fail before packaging unless `STABLE_ESIGNER_USERNAME`,
  `STABLE_ESIGNER_PASSWORD` and `STABLE_ESIGNER_TOTP_SECRET` exist in the `desktop-production`
  environment. They replace `STABLE_WINDOWS_CSC_LINK` and `STABLE_WINDOWS_CSC_KEY_PASSWORD`, which
  the workflow no longer reads.
- **Certificate.** The workflow downloads SSL.com's eSigner Cloud Key Adapter (CKA) from a pinned
  URL, checks its SHA-256, installs it for the runner user, and loads the eSigner certificate into
  `Cert:\CurrentUser\My`. The key never leaves SSL.com. Exactly one code-signing certificate must
  appear, or the step fails.
- **Signing.** electron-builder signs every executable with that certificate by thumbprint
  (`win.signtoolOptions.certificateSha1`, passed on the command line), using the runner's newest
  Windows SDK `signtool.exe`. `electron-builder.yml` sets SHA-256 only and SSL.com's RFC 3161
  timestamp server: eSigner bills per signature, and a SHA-1 signature adds nothing on supported
  Windows. `forceCodeSigning` stays on, so a missing certificate fails the build.
- **Verification.** Before publication, the installer signature must be `Valid` and timestamped,
  `KerfDesk.exe` must be signed by the same certificate, and `scripts/verify-update-publisher.mjs`
  must find a `publisherName` in `win-unpacked/resources/app-update.yml` that matches the
  installer's signer the way electron-updater compares them.

ADR-135's trust switch is unchanged: only a signed tag build sets
`kerfdeskUpdateChannelTrusted=true`, and now that build also proves its updater will check the
next update's signer.

### Consequences

- The maintainer buys an SSL.com code-signing certificate enrolled in eSigner (IV for an
  individual, OV for a company), and stores the account username, password and the TOTP secret
  shown at eSigner enrollment as the three secrets. The unsigned dry run and the Preview lane need
  none of them.
- Each stable build uses 4 signatures (app, `elevate.exe`, uninstaller, installer).
- Installed copies accept updates only from the certificate's common name. A renewal must keep
  the same name; changing it (for example from a personal to a company certificate) needs one
  release whose `publisherName` lists both names before the switch.
- The CKA pin is updated by changing its URL and SHA-256 together.
- The eSigner steps cannot run before the certificate exists. The first signed tag is the first
  real run; if it fails, nothing is published.

### Verification

- `src/platform/electron/release-desktop-workflow-gate.test.ts` pins the secret names, the step
  order, the pinned CKA download, the thumbprint signing, the SHA-256 and timestamp settings, and
  the timestamp, same-signer and `publisherName` checks.
- `scripts/verify-update-publisher.test.mjs` covers a matching name, a matching full DN, a missing
  `publisherName` and a different signer.
- The PowerShell steps parse under PowerShell 7.5; the credential check and signtool selection
  were run against stand-in values. An unsigned Windows package built with the new
  `electron-builder.yml` skipped signing as before, and its `app-update.yml` (no `publisherName`)
  failed `verify-update-publisher.mjs`.
