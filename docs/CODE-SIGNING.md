# Code signing — T3-4

LaserForge ships unsigned by default. Distributing unsigned binaries
triggers Windows SmartScreen ("Unknown publisher") and macOS Gatekeeper
("LaserForge cannot be opened because the developer cannot be
verified"); serious users will not run them on production machines.

This doc covers how to produce **signed** installers once the certs
are in hand. The infrastructure is already wired — `npm run
electron:build:signed:win` and `electron:build:signed:mac` consume
environment variables and call into the signed-builder configs at
`scripts/signing/electron-builder.{windows,macos}-signed.cjs`. The
remaining work is one-time cert provisioning + a CI secret manager.

## Windows

### Cert provisioning

1. Buy an EV (Extended Validation) code-signing certificate. ~$300-400
   per year. Reputable issuers: DigiCert, Sectigo, GlobalSign, Certum.
   EV is required to bypass SmartScreen reputation lock-out from day
   one; standard OV certs reach SmartScreen reputation only after ~3
   months of signed downloads.
2. The cert ships as a `.pfx` file (sometimes on a hardware token —
   the simpler local-build path is a software-token PFX). Store it
   outside the repo.
3. Note the password set at issuance time.

### Local sign

```powershell
$env:WIN_CSC_LINK = "C:\path\to\laserforge-ev.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<pfx-password>"
npm run electron:build:signed:win
```

The build pipeline runs `validate-signing-env.mjs` first; if either
env var is empty, it exits with a clear "missing env var: …" message
before electron-builder starts.

### CI sign

Move the PFX into a base64 GitHub secret (`WIN_CSC_LINK_BASE64`) and
inject it into the runner via a write-and-export step:

```yaml
- name: Decode signing cert
  if: runner.os == 'Windows'
  shell: pwsh
  run: |
    [IO.File]::WriteAllBytes("$env:RUNNER_TEMP\\cert.pfx",
      [Convert]::FromBase64String($env:WIN_CSC_LINK_BASE64))
    "WIN_CSC_LINK=$env:RUNNER_TEMP\\cert.pfx" >> $env:GITHUB_ENV
  env:
    WIN_CSC_LINK_BASE64: ${{ secrets.WIN_CSC_LINK_BASE64 }}

- name: Build + sign Windows installer
  if: runner.os == 'Windows'
  run: npm run electron:build:signed:win
  env:
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

## macOS

### Cert + notarization provisioning

1. Enroll in the Apple Developer Program. $99 / year.
2. In Apple Developer → Certificates, generate a **Developer ID
   Application** certificate and download/import it into the local
   Keychain.
3. Generate an **app-specific password** at
   <https://appleid.apple.com> → Sign-In and Security → App-Specific
   Passwords. Store it in your CI secret manager.
4. Note your 10-character Team ID from the Apple Developer Account
   homepage.

### Local sign + notarize

```bash
export MAC_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"
npm run electron:build:signed:mac
```

`scripts/signing/electron-builder.macos-signed.cjs` enables
`hardenedRuntime`, points at `entitlements.mac.plist`, and triggers
notarization via `notarize.teamId`.

### CI sign

Same idea as Windows — the four env vars become GitHub Secrets:

```yaml
- name: Build + sign + notarize macOS dmg
  if: runner.os == 'macOS'
  run: npm run electron:build:signed:mac
  env:
    MAC_SIGNING_IDENTITY: ${{ secrets.MAC_SIGNING_IDENTITY }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

The cert itself stays in the runner's Keychain — for hosted runners
that means an `apple-actions/import-codesign-certs` step before this
one decoding a base64 `.p12` blob into a temporary keychain.

## GitHub Release publishing

The signed Windows and macOS workflows stay manual-only. By default
they build, sign, attest, and upload Actions artifacts without touching
GitHub Releases.

For an intentional release publish (T1-260), run the signed workflow
with `publish_release: true`, `release_tag` set to the target tag
(for example `v1.0.0`), and `release_qa_confirmed: true` only after
the installer QA/hardware verification checklist has been completed.
The workflow refuses to publish signed release assets unless that QA
gate is machine-confirmed. The workflow creates a draft release when
the tag does not already have one, uploads the release assets, then
publishes the release so updater clients can read the final asset set.

- the platform installer (`.exe` or `.dmg`),
- `SHA256SUMS.windows` or `SHA256SUMS.macos`,
- `sbom.windows.cdx.json` or `sbom.macos.cdx.json`.

Windows releases also upload electron-updater metadata:

- `latest.yml`,
- the NSIS installer `.blockmap`.

The platform-specific checksum and SBOM filenames avoid Windows and
macOS workflows overwriting each other's release assets.

## Linux

Out of scope for T3-4. AppImage/Snap/Flatpak each have their own
signing mechanism (GPG / Snap Store / Flathub) and ship under T3-84
once the business model decides Linux distribution targets.

## Verification

After a signed build:

- **Windows**: right-click the `.exe`, Properties → Digital Signatures
  tab. The signer name must match the cert's CN; the timestamp must be
  present (electron-builder timestamps via `signtoolOptions` by
  default).
- **macOS**: `codesign -dv --verbose=4 LaserForge.app`. Look for
  `Authority=Developer ID Application: …` and a non-empty Team ID.
  Then `spctl --assess --verbose=4 LaserForge.app` to confirm
  Gatekeeper acceptance.
- **Release provenance (T1-259)**: the signed Windows/macOS release
  workflows generate GitHub artifact attestations for the installer and
  an SBOM attestation tying `release/sbom.cdx.json` to the installer.
  Verify a downloaded installer with:

  ```bash
  gh attestation verify ./LaserForge-Setup.exe -R stolkjohannjohann-sudo/LaserForge
  gh attestation verify ./LaserForge.dmg -R stolkjohannjohann-sudo/LaserForge
  ```

Both checks are pre-release blockers; an installer that ships unsigned
defeats the entire purpose of T3-4 and must not be uploaded to a
public release channel.

## Installer QA

Before publishing a release, run the manual installer matrix in
[docs/INSTALLER-QA.md](INSTALLER-QA.md). That T3-85 checklist records
the exact release candidate artifacts, checksum/SBOM/attestation proof,
and the required Windows/macOS install scenarios: fresh install,
upgrade, uninstall/reinstall, restricted user, unicode path,
Gatekeeper, offline install, and offline launch.
