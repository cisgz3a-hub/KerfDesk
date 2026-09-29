## ADR-541 - Weekly release train: every build reaches a beta ring first, and everyone after four quiet days (2026-09-29)

**Status:** Implemented; off until the owner sets `KERFDESK_RELEASE_TRAIN` to `on` | **Date:** 2026-09-29 | **Builds on:** ADR-523 (commercial updates), ADR-522 Amendment 1 (native package checks), ADR-544 decision 3 (the commercial package checks itself)

### Context

ADR-523 prepared the commercial Windows update lane. Its publisher is an operator command, run by
hand from a clean checkout, that lists each release straight in the one catalogue every licensed
device reads. Nothing builds commercial releases on a schedule, and no customer can try a version
before everyone else gets it.

On 2026-09-29 the owner settled how commercial updates reach customers. These are not reopened here:

- **Batched updates.** A weekly build goes to beta first, then to everyone after a few quiet days.
- **Licensed users update only on natural quit.** ADR-523 already does this; nothing here changes it.
- **The train runs only once billing, Cloudflare R2 and Windows signing are in place.** Nothing may
  sign, publish or go live without the owner's word, so the train must be off by default.

The existing constraints stand. Customers download only from `https://dl.kerfdesk.com` (the R2
bucket `kerfdesk-downloads`), never from GitHub. Release tags stay with the maintainer (ADR-248).
The repository is private, so Windows runners bill at 2x and macOS at 10x the Linux rate (ADR-522
Amendment 1).

### Decision

1. **Two rings on dl.kerfdesk.com.**
   - **Stable** is `desktop/commercial/catalog.json`. Every licensed device and the download page
     read it, as before.
   - **Beta** is `desktop/commercial/beta/catalog.json`. It lists every beta and every stable
     release, so a device on beta never sees fewer versions than everyone else.
   - Both rings list the same Ed25519-signed envelopes and point at the same immutable release
     files under `desktop/commercial/releases/<version>/`.
   - `publish-commercial-release.mjs` now lists a new release in the beta ring only. Every earlier
     safety stays: the reservation, the read-back of every object, immutability, no rollback, the
     bounded catalogue, compare-before-replace and the shared `kerfdesk-commercial-publication`
     concurrency group. A release must be newer than the newest release in either ring, and the
     publisher stops if the rings disagree about a version. An exact retry of a release published
     before the rings existed fills in its beta entry.
   - **Each command states the catalogue it replaces.** ADR-523's publisher now requires
     `--expected-catalog-sha256`, the SHA-256 of the catalogue the operator reviewed (the one the
     previous run printed), or `none` before the first. Publication replaces the beta catalogue,
     so it states beta's; promotion replaces the stable catalogue, so it states stable's. A
     deleted, truncated or replaced catalogue is refused before any write instead of being made
     permanent. An identical retry whose own catalogue write landed still resumes. Each run prints
     the catalogue it left.
   - **Promotion** copies the beta entry, byte for byte, into the stable catalogue
     (`promoteCommercialRelease` in `scripts/commercial-release-rings.mjs`, or
     `scripts/promote-commercial-release.mjs <version>` by hand). Nothing is signed again, so
     promotion needs the bucket and never the signing key. Before writing, it checks that the
     release's `update-manifest.json` is that exact entry and that every artifact still matches its
     signed size and hashes. It refuses a version beta does not list, a different envelope already
     on stable, a rollback, a backdated release, a full stable catalogue and a stable catalogue that
     changed while it ran. Promoting a version twice reports `already-promoted`.
   - The signed release date is the beta cut's on both rings, so a licence's update eligibility
     (ADR-523) is the same whichever ring a device reads.

2. **A device opts in to beta.** In a commercial build, Help > Licence shows **Get new versions
   early (beta)** with one line: "New versions reach you a few days before everyone else, with less
   testing behind them." The choice is `commercial-update-ring.json` under userData, written only
   by the main process (`electron/update-ring-store.ts`) with an atomic rename. A missing, damaged,
   oversized or unexpected file reads as stable. The renderer reads and changes it only through the
   licensing `app://` route `early-updates` and `LicenceAdapter`. `electron/commercial-update.ts`
   reads the beta catalogue only on an opted-in device, from the next update check, which runs each
   time KerfDesk opens. Turning it off never downgrades: the device keeps its version until stable
   passes it. Preview and source builds show nothing.

3. **`.github/workflows/release-train.yml`** does nothing unless the repository variable
   `KERFDESK_RELEASE_TRAIN` is `on`. Until then its only job is one Linux step that writes what
   switching it on needs.
   - **Tuesdays at 07:17 UTC, the cut (Linux).** `scripts/release-train.mjs decide` finds the
     newest main commit that CI, Browser smoke and the Desktop package check all passed on. A beta
     is due only when a user-facing change (anything the Preview notes do not class as maintenance)
     lies between the newest release's source commit and that commit.
   - **Paid runners start only when a beta is due.** First a Linux preflight checks that every
     secret and variable is set, that the signing key is the one the pinned key ID names, that the
     bucket answers and that the approved terms match their hash. Then the Desktop package check
     runs its Windows and macOS jobs (`workflow_call`, `native: true`) on exactly that commit. Then
     one Windows job builds and signs the installer with eSigner, checks the signature, publisher,
     fuses, `app.asar` contents and tamper refusal (ADR-544 decision 3), and publishes to the beta
     ring.
   - **Daily at 09:43 UTC, promotion (Linux).** The newest beta reaches stable once it has been the
     newest beta for four days and nothing holds it (item 6). A beta that a newer one replaced is
     never promoted.
   - **Manual runs.** `workflow_dispatch` offers `status` (the default: both rings and the
     promotion decision, with no secrets), `cut` and `promote`. A manual cut still builds only when
     a beta is due.
   - The cut records the beta catalogue's SHA-256, and the Windows job publishes with it as the
     expected catalogue, so a beta catalogue that changed after the decision stops publication.
     The daily promotion states the stable catalogue it read. The train only states catalogues it
     read itself, so it cannot catch a catalogue damaged before a run: `status` prints both
     SHA-256s for review, and a hand publication or promotion states a reviewed one.
   - The build and promote jobs share `kerfdesk-commercial-publication` with
     `cancel-in-progress: false`, so a publication is never cancelled midway. Top-level permissions
     are empty and each job asks only for what it reads. Every action is pinned by SHA. Secrets are
     named only in the jobs that use them, and the Linux preflight learns only whether each eSigner
     secret is set.
   - The train never tags, pushes, or uploads to GitHub Releases. Its signed release identity names
     `refs/heads/main`. Preparation, the publisher and the download page accept that or the
     matching `refs/tags/v<version>` and refuse every other ref. The publisher also checks the
     ref against the checkout: a tag must point at the signed commit, and a train build's commit
     must be on `origin/main`, so the Windows job checks out main's full history. The desktop client already accepts any
     signed source ref, so it needed no change for train releases.

4. **Versions are `<ISO week-year>.<ISO week>.<patch>`**: `2026.40.0` is the first build of the
   week of 29 September 2026, and a same-week rebuild counts the patch up.
   - The train never commits or tags, so it cannot bump `package.json`. The version has to come
     from the release date and rise every week without a stored counter. A week number does that.
   - It is a plain `X.Y.Z`, which the publisher, electron-updater and the client compare as
     numbers. Every part stays below 65536, the limit of each part of a Windows file version.
   - The ISO week-year keeps versions rising across New Year. With the calendar year, 1 January
     2027 (ISO week 53 of 2026) would be `2027.53.0` and the following Monday `2027.1.0`, a step
     backwards.
   - A version an interrupted publication reserved is never reused; the cut takes the next patch.
   - It sorts above hand releases numbered like `1.0.0`, which stay possible. If a release newer
     than this week's train ever exists, the cut stops with a clear message instead of publishing
     a lower number.
   - Support can tell from the version which week a build came from.

5. **Four quiet days** (`QUIET_DAYS` in `scripts/release-train-policy.mjs`).
   - Four days give opted-in devices the rest of the working week, Wednesday to Friday, with a
     Tuesday beta before it reaches everyone on Saturday. Devices check for updates each time
     KerfDesk opens, so a device used daily gets the beta within a day.
   - Four is shorter than the seven days between cuts. With seven or more, the next Tuesday's cut
     would replace every beta before it qualified, and a run of busy weeks would keep stable
     waiting indefinitely.
   - A Tuesday beta can be promoted on Saturday, Sunday or Monday. A short hold, a failed daily
     run or a late scheduled cut therefore delays promotion by a day rather than a week.

6. **Holds.** Promotion waits while any open issue carries the `release-hold` label, or while the
   repository variable `KERFDESK_RELEASE_HOLD` is `on`. A held beta stays on beta and is promoted
   by the first daily run after the hold ends, if it is still the newest beta. A published release
   cannot be withdrawn: its files are immutable and beta devices may have installed it. A bad beta
   is fixed forward by a newer beta, from the next cut or a manual `cut` run.

7. **Switching on is the owner's step**, described in `docs/desktop-commercial-launch.md` ("Weekly
   release train"): the `desktop-commercial` environment limited to `main` with six secrets, three
   variables, the `release-hold` label and, last, `KERFDESK_RELEASE_TRAIN` set to `on`.

### Consequences

- Nothing changes until the owner sets the variable. Until then each scheduled run costs one short
  Linux job.
- A week with no user-facing change costs only Linux minutes. A week that cuts a beta also pays for
  the Windows and macOS package checks and one Windows build.
- Hand publications (the pilot, an urgent fix) also land in beta only. `node
  scripts/promote-commercial-release.mjs <version>` puts one on stable, and on the download page,
  at once, with no quiet days.
- The beta catalogue lists every release, so it reaches the 64-entry or 256 KiB bound first: about
  15 months of weekly releases, less with same-week rebuilds. The publisher then refuses rather than
  dropping history, and the reviewed archival design ADR-523 requires must land before that.
- GitHub keeps one pending job per concurrency group. A Windows build that waits for the
  publication group while a promotion runs could therefore be replaced by a second promotion queued
  behind it. That needs two promotions within a few minutes, in practice a manual one. Nothing was
  reserved, so running `cut` again recovers.
- The eSigner CKA installer is downloaded from SSL.com's GitHub release and pinned by SHA-256, as in
  the stable lane. It is a signing tool, not a customer download.
- The train's checks cover the signed commercial package's fuses, contents and tamper refusal, but
  CI has not yet installed and launched a commercial build. The pilot checklist
  (`docs/desktop-commercial-pilot-checklist.md`) remains required before customers.

### Rejected

- **Re-signing or rebuilding for stable.** Stable must carry the bytes beta used. A new signature or
  build would be a new, untried release.
- **Separate release files per ring.** It doubles the uploads and lets the rings drift. One set of
  immutable files with two lists cannot drift.
- **Semantic versions bumped by the train.** They need a commit or tag on main, which the train
  must not make (ADR-248).
- **GitHub Releases as the beta channel.** Customers never download from GitHub.
- **Deciding on Windows.** The decision needs only Git history and the public catalogues. A Windows
  runner costs twice as much to learn that nothing is due.

### Tests

`scripts/commercial-release-publisher.test.mjs` and `scripts/commercial-release-promotion.test.mjs`
cover publishing to beta, promotion, their expected catalogues and their refusals.
`scripts/commercial-release-package.test.mjs` covers the source checks for a tag and for main. `scripts/release-train-policy.test.mjs`
covers versions, cuts, holds and quiet days, and `scripts/release-train.test.mjs` covers the command
line against fake hosts. `src/platform/electron/release-train-workflow-gate.test.ts` pins the
workflow: off by default, triggers, Linux decisions, Windows only when due, the native check on the
release commit, the shared group, permissions, secrets, pinned actions and no GitHub uploads or
tags. `electron/update-ring-store.test.ts`, `electron/commercial-update.test.ts`,
`src/platform/electron/licensing.test.ts` and `src/ui/licensing/LicencePanel.test.tsx` cover the
opt-in from the file to the panel.
