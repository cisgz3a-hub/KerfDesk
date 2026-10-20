# Unsigned commercial Windows downloads

This lane publishes the production licensed app as an **unsigned Windows installer with manual updates**. The release identity and download manifest are authenticated with the existing stable Ed25519 trust anchors. This metadata signature is not Windows code signing. It does not remove Windows publisher warnings or authorize automatic installation.

Preparation writes a UTF-8 BOM-marked `commercial-installer-terms.txt` beside the generated configuration. NSIS otherwise interprets an explicit unmarked licence file using the Windows ANSI code page. The copy preserves the approved text and line endings; the source terms and `public/eula.txt` stay unchanged. Both commercial lanes use this copy. The base, Preview and Sandbox profiles use `build/installer-terms.txt`, regenerated from `public/eula.txt` by `pnpm build:electron-main` (or directly with `node scripts/prepare-installer-terms.mjs` when packaging an existing compiled app).

Prepare the package with the explicit unsigned commercial profile, then use:

```text
node scripts/publish-manual-commercial-release.mjs --expected-latest-sha256 <64-hex|none> [--reviewed-history <file>] <release-directory> <commercial-release-identity.json> <packaged-resources-directory>
```

The operator process needs `DESKTOP_STABLE_MANIFEST_PRIVATE_KEY`, `DESKTOP_STABLE_MANIFEST_KEY_ID`, `COMMERCIAL_CLOUDFLARE_ACCOUNT_ID` and `COMMERCIAL_R2_API_TOKEN`. Use the actual independently pinned stable key. Never substitute a sandbox key or expose secret values in logs or command-line arguments. The source must be clean, match the signed release identity, and belong to the declared main commit or matching version tag. Follow repository publication and current licence checks before running the command.

The package reader verifies production licensing, trusted release identity, desktop renderer, legal notices, explicit `kerfdeskUnsignedInstaller: true`, `commercial-unsigned` channel, disabled update trust and absence of `app-update.yml`. The installer verifier reads its archive without executing it, checks `NotSigned` Authenticode status and binds its embedded executable, ASAR and notices to the verified package. It runs before publication and again on remote readback.

Windows verification requires the full 7-Zip console with the NSIS handler. It uses `7z.exe` in the standard 64-bit Program Files installation, or the absolute path supplied by `ELECTRON_BUILDER_7ZIP_PATH`. Standalone `7za.exe` supplied by electron-builder cannot read NSIS installers. The verifier checks the tool capability before archive inspection and reports a prerequisite failure if full 7-Zip is absent. A blank NSIS unpacked-size field uses bounded extraction with the same 300 MB limit; a declared size must still match the extracted bytes. Missing, malformed or duplicate size fields are refused. The payload must have the 7z signature required by the pinned NSIS extraction plug-in; ZIP bytes renamed to `app-64.7z` are refused. Portable nested-archive tests do not qualify a Windows installer; the native NSIS regression uses the pinned compiler and real `NotSigned` probe without executing the installer.

The publisher writes only:

- `desktop/commercial-manual/releases/X.Y.Z/KerfDesk-X.Y.Z-windows-x64-setup.exe`
- `desktop/commercial-manual/releases/X.Y.Z/download-manifest.json`
- `desktop/commercial-manual/releases/X.Y.Z/release-notes.json`
- `desktop/commercial-manual/catalog.json`
- `desktop/commercial-manual/latest.json`

The first three are immutable and read back before writing history and advancing `latest.json`, both with `Cache-Control: no-store`. State the SHA-256 of the exact latest manifest reviewed, or `none` only if it does not exist. The tool reports the new SHA-256. It refuses changed reviewed state, conflicting immutable bytes, rollback, backdating, invalid signatures and package differences. An exact interrupted retry is safe. Operators must be serialized; the final state comparison is not a distributed lock against another administrator.

When `latest.json` already exists but `catalog.json` does not, backfill requires one reviewed history file. Immutable uploaded files alone cannot prove that a version ever became latest: an interrupted candidate may have a lower version than a later successful release. Review the successful publication step in `release-desktop-unsigned.yml` (or an authorised local publisher's retained success receipt), its reported version and latest SHA-256, and the corresponding signed immutable manifest. An overall failed workflow may still have promoted latest before a later step failed; inspect the publication result and retained readback evidence rather than classifying by the overall workflow conclusion. Missing receipts are an unresolved migration prerequisite, not permission to classify an unknown release as abandoned. Do not use version order, source ancestry or object existence as publication proof.

Use this schema, replacing the illustrative values with reviewed evidence:

```json
{
  "schemaVersion": 1,
  "expectedLatestSha256": "<SHA-256 of the exact current latest.json bytes>",
  "entries": [
    {
      "version": "1.0.1",
      "manifestSha256": "<SHA-256 of the exact immutable download-manifest.json bytes>",
      "status": "published",
      "evidence": "<workflow run and publication step, or retained local success receipt>"
    },
    {
      "version": "1.0.2",
      "manifestSha256": "<SHA-256 of the exact immutable download-manifest.json bytes>",
      "status": "abandoned",
      "evidence": "<reviewed interruption evidence establishing no latest promotion>"
    }
  ]
}
```

Include every immutable manifest at or below authenticated latest exactly once, including latest with `status: "published"`. Each entry needs a matching digest and nonempty evidence reference; the tool checks the file against the complete bounded listing and authenticated manifests. Receipt references are operator attestations, not automatically fetched or authenticated by the tool. A published entry requires its installer object; an abandoned upload is left intact and excluded from history. Missing, extra, duplicate, stale or conflicting evidence refuses before writes. For the normal workflow, review and commit the file as `docs/releases/manual-download-history.json` in the release source; the workflow passes it when present. For an authorised local recovery use `--reviewed-history <file>`. No evidence is fabricated or provider state changed by adding this interface. After a catalogue exists, normal publications retain its entries and no longer use the migration file. A future missing catalogue requires evidence pinned to the then-current latest.

The catalogue assumes the serialized publisher and trusted administrators control membership. Per-release signatures cannot detect an administrator replacing it with a valid subset that still contains latest. Do not repair such a replacement by importing every immutable upload. Recover from reviewed publication receipts; the current protocol does not claim to prove completeness against arbitrary trusted-store corruption. Missing latest or invalid catalogue bytes remain detectable errors.

Before each release, review `docs/releases/desktop-update-notes.json` in the release PR. Set `sinceSourceSha` to the exact source of the authenticated current manual release and write one to six short, plain customer highlights (at most 240 Unicode characters each). Summarise the reviewed changes since that release; do not copy PR titles, invent benefits or claim a backend deployment from a desktop build. For the first publication only, use `null` as the baseline. The release planner checks these committed notes before starting a Windows build and again when planning the version. Publication reads the notes from the exact signed source commit, requires the declared baseline to match authenticated latest, verifies ancestry, and refuses highlights unchanged from the baseline tree. Changing only the baseline field is insufficient. Merge, squash and rebase workflows need no predicted candidate SHA. After another release advances latest, a new reviewed notes change is required; the release-now override does not bypass this check.

The publisher signs the separate `release-notes.json` sidecar with the pinned stable key and binds it to the exact version, source SHA and publication timestamp. It preflights conflicts and reads the sidecar back before advancing latest. An interrupted retry with the same source, identity and highlights reuses identical bytes. Published notes are immutable; corrections ship in a new release. The existing manual manifest schema and installer allowlist stay unchanged for existing installed versions 1.0.1 and 1.0.2. New clients fetch the sidecar independently and show only verified plain text; a missing or invalid sidecar means notes are unavailable and never blocks an otherwise valid update. It does not change download, installation consent, licence, Frame or Start rules.

The download CDN must not cache error responses. The Cloudflare Cache Response Rule **Do not cache desktop download errors** matches `http.host eq "dl.kerfdesk.com"`, paths beginning `/desktop/`, and response status codes at least 400. It adds `no-store` with **Cloudflare only** off. This prevents a request made before upload from retaining a 404 after publication; successful immutable files retain their existing cache headers. Verify the actual public installer bytes and hash after publication, separately from authenticated R2 readback.

No `latest.yml`, blockmap, signed commercial catalogue, beta catalogue or Preview object is published or changed. A manual-download manifest has a distinct schema and is rejected by existing automatic update validators.

The browser popup and download page prefer the verified signed stable commercial catalogue. Only a 404 or valid empty catalogue permits this separate manual lane. A malformed, tampered or unreachable signed catalogue is an error, never a fallback trigger. The UI labels the installer unsigned and explains Windows publisher warnings. Older immutable exact-version URLs remain available.

ADR-561 adds notifications and explicit update actions starting with version 1.0.1. The app checks this authenticated manual manifest at startup and every 30 minutes. Users choose Download update, then Install when I close KerfDesk. The normal close safeguards must complete before the interactive installer starts. Nothing forces a restart or restores installation consent after relaunch. Version 1.0.0 needs one manual download to acquire this capability.

`.github/workflows/release-desktop-unsigned.yml` automatically publishes after at least 10 merged PRs since the authenticated latest release source, once CI, Browser smoke and Desktop package check pass on the exact main push. Enable the repository variable `KERFDESK_UNSIGNED_RELEASES=on`; keep the `desktop-commercial` environment restricted to main. It needs the four secrets/variables listed above, with `DESKTOP_STABLE_MANIFEST_KEY_ID` stored as an environment variable and the others as environment secrets. Each eligible new source gets the next unused patch version; duplicate source or superseded candidates are skipped. A failed or rate-limited publication leaves the current customer download intact. Retries re-check the latest pointer and immutable bytes before continuing. Do not run a local publisher concurrently with the workflow; the workflow's concurrency lock cannot serialize an outside operator.

For normal updates, create and review PRs, then merge them into `main`. Each distinct merged PR counts once when its integration commit is present in the candidate source and absent from the previous published source. Merge commits, squash merges and rebased merges all count. Open or closed unmerged PRs, merges into other branches, direct commits and commits already released do not advance the batch. The cutoff is source ancestry, not publication time, so changes merged while a release builds are retained for the next batch. Below 10, the Linux job reports the count and skips Windows packaging. Normal PR/main checks continue for every change.

When the maintainer explicitly requests an earlier release, open **Release unsigned Windows desktop**, choose **Run workflow** on `main`, and enable **Release now before 10 merged PRs**. The equivalent authorised operator command is:

```text
gh workflow run release-desktop-unsigned.yml --ref main -f release_now=true
```

A manual dispatch with the input left false still waits for 10. This input bypasses only the batch threshold: successful exact-source checks, current main, clean source, previous-source ancestry, signatures, package/installer qualification and safe publication still apply. The planner rechecks the latest pointer and count before building. A first release without an authenticated baseline requires the explicit override; an already published source is always skipped. The low-level local publisher is an explicitly instructed operator path, not an automatic batch scheduler; use it only for an authorised release or recovery.

Counting uses a complete GitHub PR listing, bounded to 100 pages of 100 PRs, 30 seconds per request, two minutes overall and 16 MiB per page. API failures, rate limits, malformed records, duplicate or incomplete pagination refuse publication, including an early manual release with an existing baseline. Restore API access or review an exceeded bound; do not treat partial results as the count. No PR-count state or reset is stored separately: a successfully advanced signed release pointer supplies the next baseline.

Before publication, the Windows job installs, launches and uninstalls the production candidate, then verifies its packaged fuses and runtime closure against the inherited base configuration. On the disposable unpacked candidate it runs the existing unmodified-launch baseline and ASAR tamper-refusal probe, restores the archive and compares its SHA-256 before and after. Failure blocks publication. These checks retain logs and restoration hashes with installer evidence; they do not establish that an unsigned executable resists a determined local administrator replacing the executable itself.

When an authenticated previous release exists, the same job also installs that immutable public installer, creates a normal runner profile through the shipped app, and upgrades it to the exact candidate. Native Windows accessibility controls set preferences and a saved machine; native file dialogs import, save and reopen a real project. Restart, upgrade, same-version reinstall, uninstall retaining data and reinstall must preserve those values, project content and profile sentinel. Installer hashes, pinned signatures, source/version identities, native window screenshots and process receipts are retained. Failure blocks publication. A first release has no historical baseline and retains the fresh-install checks.

For a published pair, run **Qualify published Windows upgrade** on `main`, selecting the previous and target versions. This read-only workflow authenticates both immutable installers and performs the same native retention scenario. It publishes nothing and needs no provider secrets; a target that opens behind the licence window is opened with the developer qualification licence (`KERFDESK_NATIVE_QUALIFICATION_LICENCE`), whose seat the final phase releases (ADR-623). These NSIS exercises refuse developer machines and persistent or self-hosted runners because same-app installers share registry keys. Paid credential retention, consumer Windows, standard-user UAC, SmartScreen and hardware require separate evidence. See [historical qualification scope](../docs/audits/2026-10-01-historical-windows-upgrade-qualification.md).

Follow the workflow to successful publication, then verify the public download. Users can use **Help > Check for Updates** immediately or wait for the startup/30-minute check; they choose the download and installation themselves.

## Delivery evidence and recovery

ADR-616 adds required public verification after storage publication. To repeat
the read-only check with the exact published version and source, use a fresh
absolute evidence directory:

```text
node scripts/verify-public-desktop-release.mjs --expected-version <X.Y.Z> --expected-source-sha <40-hex> --output-dir <absolute-directory> --website
```

The website probe requires Chrome. Preview uses
`scripts/verify-public-preview-release.mjs` with the same arguments and an exact
Preview version; it verifies all seven artifacts. A missing Preview feed remains
unavailable until an approved Preview publication succeeds. Neither verifier
publishes files or executes an installer.

The unsigned workflow keeps native qualification, dependency and delivery
evidence for 90 days. After all checks pass it signs a compact receipt at
`desktop/commercial-manual/releases/<version>/release-receipts/<runId>-<attempt>.json`.
The receipt proves only the recorded workflow checks and excludes raw logs,
paths, screenshots and credentials. It remains available with the immutable
release after GitHub's raw artifacts expire.

A failed public check or receipt upload may occur **after latest has advanced**.
Inspect the publication step, signed public manifest and retained evidence
before acting. Do not rebuild the same version, delete immutable objects or
assume a workflow retry will repair it: the planner skips an already published
source. Rerun the public verifier read-only; any receipt recovery requires an
explicitly authorised protected workflow with the exact source, original
run/attempt evidence and signing identity. The receipt helper refuses evidence
from a different run, source or installer. Do not fabricate a success receipt
for evidence that has expired or checks that did not run.

For a transient receipt write/readback failure **after the original public
delivery passed**, an authorised operator can dispatch **Recover original desktop
release receipt** on current main. Review the original canonical unsigned run,
exact failed receipt attempt, signed version/source and retained evidence first:

~~~text
gh workflow run recover-desktop-release-receipt.yml --ref main -f original_run_id=<run-id> -f original_attempt=<attempt> -f source_sha=<40-hex-original-source> -f version=<X.Y.Z>
~~~

The manual-only job needs the existing unsigned-release enablement switch,
protected desktop-commercial environment and shared publication lock. It uses
current trusted main code, authenticates exact original GitHub run/attempt/job and
artifact provenance, verifies archive sizes and digests, and reads only bounded
retained data. It never executes a recovered installer/script, rebuilds or
republishes the release, or changes latest/catalogue. Original source and lockfile
are read without checking out or executing that source. The signed identity,
installer, native launch/upgrade, restored ASAR, dependency report and historical
public-delivery evidence must match; the original stable signing key is required.
The same original receipt payload/key is retried idempotently; a separate 90-day
recovery artifact records the recovery run and original artifact IDs/digests.

A newer latest does not invalidate an upgrade-backed release's retained historic
proof, and the recovery makes no claim to freshly check that release's website.
Expired/missing/ambiguous artifacts, originally failed/missing public delivery,
cancelled runs, or missing exact-attempt jobs/checks refuse. In particular, some
reused-job reruns may lack a complete exact-attempt job list. First-release
recovery retains the existing one-entry authenticated catalogue requirement and
refuses once later history exists. This narrow retry does not cover those cases;
do not fabricate checks or rebuild the same version to get around a refusal.

For the separate signed-beta train, a missing authenticated observation holds
automatic promotion. An authorised operator can run **Release train** on `main`
with `action=observe`, the exact `version` and the reviewed
`beta_catalog_sha256`. This manual-only job uses the existing protected
`desktop-commercial` signing and storage configuration and the shared
publication lock. It requires the train enablement switch and canonical
repository; schedules never select it. It calls the existing authenticated
`release-train.mjs observe` command without exporting protected credentials.
This observes the exact newest beta and starts its waiting period now; it does
not build, publish or promote the release, change its licence date, or accept
`--now`. Keep all release enablement variables off until the fixes and the
intended provider action are approved.
## macOS and Linux (ADR-613)

The same workflow publishes the commercial Mac and Linux builds of each Windows release, under the same version, once Windows is published. Each system is off until its repository variable is `on`: `KERFDESK_UNSIGNED_MACOS_RELEASES` (Apple silicon and Intel DMGs) and `KERFDESK_UNSIGNED_LINUX_RELEASES` (x64 `.deb` and AppImage). The Windows documents above, and their single writer, are unchanged: installed Windows copies never see a Mac or Linux file.

The ADR-616 public-delivery verifier and signed success receipt above cover Windows and Preview only. The commercial Mac/Linux jobs currently prove package qualification and authenticated R2 readback, retain native artifacts for seven days, and do not yet prove public CDN/page delivery or retain a durable success receipt. Windows success must not depend on an absent platform feed. Keep the separate platform switches disabled until their publication and qualification are explicitly authorised.

The build jobs hold no secret. Immediately after confirmed Windows publication,
the workflow captures the public signed identity before public delivery and
receipt checks. Enabled companion jobs can use that confirmed identity even if a
later Windows audit step fails; cancellation, absent identity and failed or
skipped companion builds still prevent their publication. Windows audit or
receipt failure remains a failed workflow and requires the recovery above. This
handoff does not rebuild or republish Windows. It prevents later audit failures
from discarding a confirmed handoff; it does not repair historical runs or a
cancellation between publication and handoff. The Windows job hands the
companion jobs its public signed release identity; `scripts/build-commercial-platform.sh` prepares from it (`prepare-commercial-desktop.mjs --release-identity`), packages, and qualifies the package (contract, fuses, launch, import and save; ASAR tamper refusal on macOS; `.deb` install and AppImage launch on Ubuntu 24.04). The publish jobs, in the `desktop-commercial` environment, accept only the files whose SHA-256 their build jobs reported and run:

```text
node scripts/publish-platform-commercial-release.mjs --platform <macos|linux> --sha256 <file>=<64-hex> [...] <release-directory> <commercial-release-identity.json>
```

It writes, under `desktop/commercial-manual/`:

- `releases/X.Y.Z/KerfDesk-X.Y.Z-macos-arm64.dmg`, `…-macos-x64.dmg` and `download-manifest-macos.json`, then `latest-macos.json`
- `releases/X.Y.Z/KerfDesk-X.Y.Z-linux-amd64.deb`, `…-linux-x86_64.AppImage` and `download-manifest-linux.json`, then `latest-linux.json`

It refuses unless the Windows `download-manifest.json` of the same version is already published with the same identity, and refuses rollback, backdating and conflicting immutable bytes. The release notes are the Windows release's `release-notes.json`. A Mac or Linux failure leaves the Windows release as it is; **Re-run failed jobs** repeats the same version (a fresh run of the workflow skips an already published source).

Before the first Mac or Linux release, the maintainer:

1. Publishes Software and Supplier Terms 1.3 (archiving 1.2 and notifying Paddle) so that Pro rights and the trial cover macOS and Linux installations, not only "Windows installations", and updates the pricing, licence and buy pages that say Pro is Windows only.
2. Sets `KERFDESK_UNSIGNED_MACOS_RELEASES=on` and/or `KERFDESK_UNSIGNED_LINUX_RELEASES=on`, and checks that the `desktop-commercial` environment admits the `publish-macos` and `publish-linux` jobs (same branch rule as Windows; no new secret).
3. Runs **Release unsigned Windows desktop** on `main` with **Release now**, or lets the next 10-PR batch run, then checks the Mac and Linux panels on kerfdesk.com/download and installs each file on a real Mac and Linux computer.
