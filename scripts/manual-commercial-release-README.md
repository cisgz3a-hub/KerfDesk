# Unsigned commercial Windows downloads

This lane publishes the production licensed app as an **unsigned Windows installer with manual updates**. The release identity and download manifest are authenticated with the existing stable Ed25519 trust anchors. This metadata signature is not Windows code signing. It does not remove Windows publisher warnings or authorize automatic installation.

Prepare the package with the explicit unsigned commercial profile, then use:

```text
node scripts/publish-manual-commercial-release.mjs --expected-latest-sha256 <64-hex|none> <release-directory> <commercial-release-identity.json> <packaged-resources-directory>
```

The operator process needs `DESKTOP_STABLE_MANIFEST_PRIVATE_KEY`, `DESKTOP_STABLE_MANIFEST_KEY_ID`, `COMMERCIAL_CLOUDFLARE_ACCOUNT_ID` and `COMMERCIAL_R2_API_TOKEN`. Use the actual independently pinned stable key. Never substitute a sandbox key or expose secret values in logs or command-line arguments. The source must be clean, match the signed release identity, and belong to the declared main commit or matching version tag. Follow repository publication and current licence checks before running the command.

The package reader verifies production licensing, trusted release identity, desktop renderer, legal notices, explicit `kerfdeskUnsignedInstaller: true`, `commercial-unsigned` channel, disabled update trust and absence of `app-update.yml`. The installer verifier reads its archive without executing it, checks `NotSigned` Authenticode status and binds its embedded executable, ASAR and notices to the verified package. It runs before publication and again on remote readback.

The publisher writes only:

- `desktop/commercial-manual/releases/X.Y.Z/KerfDesk-X.Y.Z-windows-x64-setup.exe`
- `desktop/commercial-manual/releases/X.Y.Z/download-manifest.json`
- `desktop/commercial-manual/latest.json`

The first two are immutable and read back before advancing `latest.json` with `Cache-Control: no-store`. State the SHA-256 of the exact latest manifest reviewed, or `none` only if it does not exist. The tool reports the new SHA-256. It refuses changed reviewed state, conflicting immutable bytes, rollback, backdating, invalid signatures and package differences. An exact interrupted retry is safe. Operators must be serialized; the final state comparison is not a distributed lock against another administrator.

The download CDN must not cache error responses. The Cloudflare Cache Response Rule **Do not cache desktop download errors** matches `http.host eq "dl.kerfdesk.com"`, paths beginning `/desktop/`, and response status codes at least 400. It adds `no-store` with **Cloudflare only** off. This prevents a request made before upload from retaining a 404 after publication; successful immutable files retain their existing cache headers. Verify the actual public installer bytes and hash after publication, separately from authenticated R2 readback.

No `latest.yml`, blockmap, signed commercial catalogue, beta catalogue or Preview object is published or changed. A manual-download manifest has a distinct schema and is rejected by existing automatic update validators.

The browser popup and download page prefer the verified signed stable commercial catalogue. Only a 404 or valid empty catalogue permits this separate manual lane. A malformed, tampered or unreachable signed catalogue is an error, never a fallback trigger. The UI labels the installer unsigned and explains Windows publisher warnings. Older immutable exact-version URLs remain available.

ADR-561 adds notifications and explicit update actions starting with version 1.0.1. The app checks this authenticated manual manifest at startup and every 30 minutes. Users choose Download update, then Install when I close KerfDesk. The normal close safeguards must complete before the interactive installer starts. Nothing forces a restart or restores installation consent after relaunch. Version 1.0.0 needs one manual download to acquire this capability.

`.github/workflows/release-desktop-unsigned.yml` automatically publishes after at least 20 merged PRs since the authenticated latest release source, once CI, Browser smoke and Desktop package check pass on the exact main push. Enable the repository variable `KERFDESK_UNSIGNED_RELEASES=on`; keep the `desktop-commercial` environment restricted to main. It needs the four secrets/variables listed above, with `DESKTOP_STABLE_MANIFEST_KEY_ID` stored as an environment variable and the others as environment secrets. Each eligible new source gets the next unused patch version; duplicate source or superseded candidates are skipped. A failed or rate-limited publication leaves the current customer download intact. Retries re-check the latest pointer and immutable bytes before continuing. Do not run a local publisher concurrently with the workflow; the workflow's concurrency lock cannot serialize an outside operator.

For normal updates, create and review PRs, then merge them into `main`. Each distinct merged PR counts once when its integration commit is present in the candidate source and absent from the previous published source. Merge commits, squash merges and rebased merges all count. Open or closed unmerged PRs, merges into other branches, direct commits and commits already released do not advance the batch. The cutoff is source ancestry, not publication time, so changes merged while a release builds are retained for the next batch. Below 20, the Linux job reports the count and skips Windows packaging. Normal PR/main checks continue for every change.

When the maintainer explicitly requests an earlier release, open **Release unsigned Windows desktop**, choose **Run workflow** on `main`, and enable **Release now before 20 merged PRs**. The equivalent authorised operator command is:

```text
gh workflow run release-desktop-unsigned.yml --ref main -f release_now=true
```

A manual dispatch with the input left false still waits for 20. This input bypasses only the batch threshold: successful exact-source checks, current main, clean source, previous-source ancestry, signatures, package/installer qualification and safe publication still apply. The planner rechecks the latest pointer and count before building. A first release without an authenticated baseline requires the explicit override; an already published source is always skipped. The low-level local publisher is an explicitly instructed operator path, not an automatic batch scheduler; use it only for an authorised release or recovery.

Counting uses a complete GitHub PR listing, bounded to 100 pages of 100 PRs, 30 seconds per request, two minutes overall and 16 MiB per page. API failures, rate limits, malformed records, duplicate or incomplete pagination refuse publication, including an early manual release with an existing baseline. Restore API access or review an exceeded bound; do not treat partial results as the count. No PR-count state or reset is stored separately: a successfully advanced signed release pointer supplies the next baseline.

Before publication, the Windows job installs, launches and uninstalls the production candidate, then verifies its packaged fuses and runtime closure against the inherited base configuration. On the disposable unpacked candidate it runs the existing unmodified-launch baseline and ASAR tamper-refusal probe, restores the archive and compares its SHA-256 before and after. Failure blocks publication. These checks retain logs and restoration hashes with installer evidence; they do not establish that an unsigned executable resists a determined local administrator replacing the executable itself.

Follow the workflow to successful publication, then verify the public download. Users can use **Help > Check for Updates** immediately or wait for the startup/30-minute check; they choose the download and installation themselves.
