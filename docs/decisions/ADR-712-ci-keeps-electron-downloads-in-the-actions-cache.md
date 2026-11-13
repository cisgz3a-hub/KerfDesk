## ADR-712 - CI keeps Electron's downloads in the Actions cache and fetches a missing zip with retries

**Status:** Accepted. Asked for after the 2026-11-09 Electron CDN outage. | **Date:** 2026-11-13

### Context

- On 2026-11-09 every "Package, check and launch the desktop app" job failed for over 45 minutes:
  `Response code 504 (Gateway Time-out)` for
  `https://github.com/electron/electron/releases/download/v44.9.1/electron-v44.9.1-linux-x64.zip`.
  It held main and pull requests #1636 to #1639 red until GitHub's release CDN recovered.
- The log shows `pnpm install` passed (setup-node's pnpm store cache restores electron's
  postinstall result, so the postinstall did not download). The failing download was
  electron-builder's own: it unpacks a fresh Electron zip for every package and fetches it with
  `@electron/get` into `@electron/get`'s default cache folder. No workflow kept that folder, so
  every packaging job downloaded the zip again. electron-builder retries three times over about
  12 seconds, which does not outlast an outage.
- electron's postinstall downloads the same zip into the same folder whenever the pnpm store cache
  misses, which happens on every lockfile change.
- The unit test `electron/native-smoke-licence-config.test.ts` imports only types from `electron`;
  it downloads nothing.
- electron's postinstall passes `cacheRoot: process.env.electron_config_cache`; electron-builder
  passes none. Both therefore use `@electron/get`'s default folder only while
  `electron_config_cache` is unset, so this ADR deliberately sets no cache variable.

### Decision 1 - One composite action restores the folders before every `pnpm install`

`.github/actions/electron-downloads` runs before the root `pnpm install` in every job that already
restores the pnpm store (setup-node `cache: pnpm`, or `setup-remote-control`) or runs
electron-builder.

- It caches `@electron/get`'s and electron-builder's default folders: `~/.cache/electron` and
  `~/.cache/electron-builder` on Linux, `~/Library/Caches/electron{,-builder}` on macOS, and
  `%LOCALAPPDATA%\electron\Cache` and `%LOCALAPPDATA%\electron-builder\Cache` on Windows. On macOS
  it leaves out `*.keychain`, the root-certificate keychain electron-builder copies there.
- The key is `electron-downloads-v1-<os>-<arch>-electron-<v>-builder-<v>-<job>`, with both versions
  read from `pnpm-lock.yaml`. A job that runs electron-builder (`packaging: 'true'`) saves its own
  entry, because jobs need different tools (NSIS, AppImage, fpm, winCodeSign); without one it
  starts from another job's entry for the same versions. Every other job only restores
  (`actions/cache/restore`) and never saves, so it adds no entries and no "path does not exist"
  warnings.
- `actions/cache` v6.1.0 joins the reviewed action allowlist at
  `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`, under both `actions/cache` and
  `actions/cache/restore`.

### Decision 2 - A packaging job fetches a missing Electron zip with bounded backoff

Before `pnpm install`, a packaging job runs `electron-downloads.mjs prefetch`. When the restored
cache lacks the host's Electron zip, it fetches `SHASUMS256.txt` and the zip itself, waiting 15,
30, 60, 120 and 240 seconds between six attempts (about eight minutes), and retrying only network
errors and HTTP 408, 425, 429 and 5xx. It checks the zip's SHA-256 against that file before moving
it into the cache; where the electron package is already installed it uses that package's
`checksums.json` instead, and also re-checks a restored zip against it. electron's postinstall and electron-builder still verify the zip themselves before
unpacking it. If every attempt fails, the step fails with a message that names the CDN and says to
re-run.

### Decision 3 - The commercial release lane stays cache-free

`release-desktop-unsigned.yml` and `qualify-desktop-upgrade.yml` restore no caches, not even the
pnpm store. Their packaging jobs use the action with `cache: 'false'`, so they get only the
retrying prefetch. Their install-only jobs do not use it. Provenance, attestation, signing and
qualification steps are unchanged.

### Decision 4 - A pinned older commit skips the step

Deploy, the release train, the unsigned release and the package check when the release train calls
it check out a pinned commit that may predate this action. There the step runs only when
`hashFiles('.github/actions/electron-downloads/action.yml') != ''`, so building an older commit
still works.

### Consequences

- With a warm cache, an Electron CDN outage no longer fails `pnpm install` or the zip and tool
  downloads electron-builder makes.
- **Remaining exposure:** `@electron/get` always re-downloads `SHASUMS256.txt` (about 10 KB) to
  verify a cached zip; it never reads checksums from its cache. electron-builder supplies no
  checksums, so each packaging step still makes that one small request, with electron-builder's
  own three retries. Removing it means giving electron-builder `electronDownload.checksums` in its
  configuration, which changes the build configs and the commercial build script; that is left for
  a separate decision.
- A cache entry not used for 7 days is evicted. The native jobs (Windows, macOS) run only from the
  release train or by hand, so their first run after a quiet week downloads again, with the
  bounded retries.
- `electron-downloads.test.mjs` (run by CI's "Policy checks and builds" job) pins the folders and
  the release subfolder to the installed `@electron/get` copies and electron-builder, and checks
  that every installing or packaging job uses the action before `pnpm install` with the right
  inputs, conditions and pinned-commit guard.
