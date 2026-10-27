# Rolling audit v4 — Distribution

- **When:** 2026-10-27, 11:00–13:10Z (resumed once after an app restart).
- **Tree:** the worktree's `src/`, `electron/`, `services/`, `scripts/` and `public/` are origin/main @ `a59f74ff9`.
  - `git diff a59f74ff9 7a459ef2d` touches none of the files cited below except `electron/mcp/machine-tool-info.ts`, which no finding uses.
  - Each finding was re-read on origin/main @ `7a459ef2d` with `git show origin/main:<path>` and is still present there.
- **Live state, read-only, 2026-10-27 12:50–13:05Z:**
  - `dl.kerfdesk.com/desktop/commercial-manual/catalog.json` and `latest.json`. The catalogue lists 27 releases, 1.0.0 (`271796e64`) to 1.0.27 (`adf300522`); `latest.json` is 1.0.27.
  - `desktop/commercial/catalog.json`, `latest-macos.json` and `latest-linux.json` return 404.
  - kerfdesk.com `/terms/` (byte-identical to `public/terms/index.html`), `/pricing/`, the web app entry and two of its chunks.
  - GitHub: the "Protect main branch" ruleset, repository visibility, the check rollups of #1458–#1470, and the deploy runs.
  - The licence server (`license.kerfdesk.com`) and the relay were not contacted.
- **Scope:** the journey download → install → first launch → licence (Free, trial, Pro, offline, second PC) → update → uninstall or reinstall, plus the website claims and the gates that protect `main`.
  - Code: `electron/licensing-*.ts`, `electron/manual-update*.ts`, `electron/commercial-update.ts`, `electron/desktop-licensing.ts`, `electron/desktop-manual-updates.ts`, `electron/update-channel-trust.ts` and `electron/licensing-device.ts`.
  - Also `src/ui/licensing/**`, `src/platform/build-capabilities.ts`, `scripts/browser-free-build.ts`, `src/ui/commands/edition-command-gate.ts`, `src/ui/state/pending-pro-project.ts`, the remote Pro checks (`src/ui/remote-control/*`), `electron-builder*.yml`, `public/{download.html,pricing,terms,privacy}` and `docs/legal/software-supplier-terms.md`.
  - The project, autosave, material library and last-machine stores, for downgrades.
  - Governing documents: ADR-540 (+ Amds 1, 5), ADR-547, ADR-561 (+ Amd 6), ADR-523 Amd 1, ADR-592, ADR-613, ADR-623 Amds 2–3, ADR-626, ADR-649, ADR-670, ADR-671, ADR-673.
- **Lenses run:**
  - L9, entry-point parity, was the main lens.
  - L1, L3 and L6 were run on the licence and update paths.
  - L5 was not re-run: rolling v2 02/04/11 and v3 G7/G8 covered the licence cryptography, IPC and pipeline secrets, and nothing in those files changed since.
  - No installer was downloaded or run. No hardware was operated.
- **Counts:** 4 raised → 1 refuted → P1 0 / P2 1 / P3 2 (+ 6 KNOWN re-observed).
  - Refuter (2026-10-27, fresh context): 3 CONFIRMED (H10-P2-1, H10-P3-1, H10-P3-3), 0 PLAUSIBLE, 1 REFUTED (H10-P3-2: the Pro prompt does name the date). No severity changes.

## Headline

Every build and every route reaches the edition it promises:
- The web app is a stripped browser Free build.
- Preview and free-channel desktop builds run Free.
- Only the commercial desktop build takes a licence.
- Every Pro entry (menu, toolbar, panel buttons, file admission, phone and MCP) asks through the same edition gate.

The update lanes refuse older and backdated releases, and the merge gate held for all 13 PRs merged since `a59f74ff9`.

The defects sit where two distribution paths model the same thing differently:
- **Paid updates after a failed licence check (H10-P2-1).** One failed licence check, for example an offline weekly confirmation or a `license.kerfdesk.com` outage, makes every update look "not covered" for a paying customer. Help > Check for Updates then says their updates "ended on" a date a year in the future.
- **Web app ahead of the desktop release (H10-P3-1).** The web app always runs `main`, while the desktop app runs a batched release. A project saved with ADR-671 sharpening in the web app opens in desktop 1.0.27 and burns unsharpened with no notice. ADR-671, unlike its siblings, never said what an older build does.
- **Copy (H10-P3-3).** The rest is copy drift on what counts as a device or a trial. (H10-P3-2, on the lapsed-update wording, was refuted: the Pro prompt names the date.)

No licence bypass and no remotely reachable hole was found.

## Entry-point map (L9)

| Path | Edition / gate | Update and downgrade | Verdict |
|---|---|---|---|
| Web app (kerfdesk.com) | `BROWSER_FREE_BUILD` → `FreeOnlyEdition` (`EditionProvider.tsx:57-61`). Pro bodies are stripped (`browser-free-build.ts:9-59`), including the jig and board panels, Design Studio, box and camera alignment | The service worker serves `main` on each green deploy | Clean. Runs ahead of desktop: H10-P3-1 |
| Windows unsigned commercial (live lane) | `LicensedEdition`. The licence window is held off (`desktop-licence-window.mjs:7`), so the app opens Free and the trial or key unlocks Pro | Manual service: verified `latest.json`, refuses ≤ current and backdated (`manual-update.ts:119-131`), coverage via `manualEligible` | H10-P2-1 (H10-P3-2 refuted) |
| Windows signed commercial (dormant) | Same edition | electron-updater lane, `compare ≤ 0` skipped (`commercial-update.ts:258`) | Same twin as H10-P2-1 (latent) |
| macOS / Linux unsigned commercial (lanes off, 404) | Same edition. No hardware ID for trials (`licensing-device.ts:60`). The `kerfdesk://` link is Windows only (disclosed) | Download-page notices only | Not reachable; see Not verified |
| Preview / free-channel desktop | `channel === 'free'` → `freeBuild` → Pro-in-desktop notice | Preview notify-only | Clean ("A Preview cannot use a Pro licence", `download.html`) |
| Earlier version from `/download.html?version=` | Each build keeps the rules it shipped with | NSIS installs it over a newer version. Autosave refuses newer schema and keeps the slot (`autosave-record.ts:103-137`). Projects: schema 18 since before 1.0.20, unknown layer fields kept on re-save (`normalize-layer.ts:45` @ `adf300522`) | H10-P3-1 also applies |
| Second PC / move licence | `MAX_DEVICES = 3` (`authority.mjs:7`). Help > Licence > Manage devices releases another seat; 6 releases per 30 days (`authority.mjs:10`) | — | Clean. Device/trial wording: H10-P3-3 |
| Phone / MCP Pro edits | `needs_pro` pre-checks (`design-operations.ts:78,173`, `board.ts:96`, `arrange.ts:155`, `machine-actions.ts:166`) | — | Clean (H8 re-read) |

## Findings

### H10-P2-1 — One failed licence check makes a covered paid update "not covered", and the panel tells the customer their updates "ended on" a future date

- **Where:**
  - `electron/licensing-runtime.ts:215`: any failure of a grant request calls `this.updateCache.failAuthentication()`. That includes a network error, a timeout and a server outage, not only a refused credential. The background weekly refresh reaches the same catch through `readGrantReply` (`licensing-background-refresh.ts:71-80`).
  - `electron/licensing-update-cache.ts:126-131`: `claimsTakeRelease` refuses every paid or active-trial release while `authenticationFailed`. Only a later successful grant clears it (`licensing-runtime.ts:254`).
  - `electron/manual-update.ts:142-145`: an ineligible release becomes state `not-covered`. The signed lane does the same at `commercial-update.ts:259-263` and `:277-278`.
  - `src/ui/licensing/update-status-text.ts:39-40,92-96`: `not-covered` is always worded "your licence's updates ended on <updatesUntil>".
- **Anchor:**
  - **Contract.** ADR-547 decision 1 defines the outcome as "not covered (the newest release this licence's updates do not cover)". Decision 4 says such a version "names the date its updates ended".
  - **Contract.** ADR-523 Amendment 1 item 6: "An outage, a rate limit or any other error only shows a message."
  - **Twin.** The same failed request leaves the licence `ready`/`pro` with the message "Your saved licence keeps working offline" (`licensing-messages.ts:172`), while the update panel, for the same rights, says the updates have ended.
  - The fail-closed rule itself is deliberate and pinned (`licensing-free-updates.test.ts:160-180`, ADR-561 item 5 "unverifiable credentials do not authorise an update"). The defect is that this rule is reported as an ended update period.
- **Scenario:**
  1. A paid licence (updates through 2027-10-06) is due its weekly confirmation (`licensing-schedule.ts:24`, 7 days for paid).
  2. KerfDesk starts on a workshop PC that is offline, or while `license.kerfdesk.com` is down or blocked. The download host is a different host, `dl.kerfdesk.com`.
  3. The 30-minute schedule (`desktop-licensing.ts:179-183`) or Help > Check for Updates → Check now then reads `latest.json`.
  4. The panel says "KerfDesk 1.0.11 is out, but your licence's updates ended on 10/6/2027." No Download button is offered.
  5. It lasts until a confirmation succeeds:
     - up to 30 minutes after reconnecting;
     - for the whole outage, or for good behind a proxy that blocks only the licence API.

  Free devices get the same update at once.
- **Evidence:** REPRO.
  - The test was a temporary `electron/zz-h10-update-coverage.test.ts`. It used the harness of `licensing-free-updates.test.ts` (the real `createLicensingRuntime`, a fetch that throws as if offline, a paid record), then the real `createManualUpdates` fed the signed manual manifest, and the real `updateStatusText`.
  - Command: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run electron/zz-h10-update-coverage.test.ts --silent=false --reporter=verbose`.
  - Output: `H10-COVER {"edition":"pro","state":"ready","updatesUntil":"2027-10-06T00:00:00.000Z","statusMessage":"Unable to reach the licence service. Your saved licence keeps working offline.","eligibleBefore":true,"eligibleAfterFailedRefresh":false,"updateState":"not-covered","text":"KerfDesk 1.0.11 is out, but your licence's updates ended on 10/6/2027. The version you have keeps working.","fetches":1}`.
  - The file was deleted afterwards.
- **Severity note:** P2.
  - It is a misleading result an ordinary paying user meets after an ordinary event (one offline or failed weekly check), and it holds back their update while Free devices take it.
  - It is not P1: no output, licence or data is affected, and it clears on the next successful check.
  - A refuter could argue P3 because it self-heals within 30 minutes once the licence API answers. It does not self-heal during a licence-API outage or behind a filtering proxy.
- **Refuter:** CONFIRMED, P2 kept. Own REPRO on two paths, plus code and ADR reads.
  - **What would make it false:**
    - a confirmation that re-runs before coverage is decided;
    - a separate update outcome for an unconfirmed licence;
    - another text that tells the customer the truth;
    - ADR wording that allows "updates ended" for an unanswered check.
    None holds.
  - **Repro 1, the startup order.** The test was a temporary `electron/zz-h10r-update-coverage.test.ts`, now deleted.
    - It used the real `createLicensingRuntime`, the real `createManualUpdates` and `updateStatusText`.
    - It followed the order of `start()` in `desktop-licensing.ts:169-183`: `status()`, then `refreshInBackground()`, then `check()`.
    - Paid licence, last confirmed 8 days ago. The licence API was offline, or answered 503 `unavailable`, or 429 `rate_limited`, while `latest.json` answered.
    - Each failure gave `updateState: not-covered`, with "KerfDesk 1.0.11 is out, but your licence's updates ended on 10/6/2027. The version you have keeps working."
    - Control: confirmed 1 day ago, the refresh is not due and no licence request is made, so the result is `available`.
    - So it fires only when the weekly confirmation is due and fails. Any failure counts, not only a refused credential (`licensing-runtime.ts:215`).
  - **Repro 2, offline at launch, then Check now.**
    - Everything is offline at launch. The update state is `failed`, with "Check your connection and try Check now again."
    - The user reconnects and chooses Check now. No confirmation runs first: `check()` calls `eligible` directly (`manual-update.ts:107-111,142-145`).
    - The result is `not-covered`, with the same false date.
    - This is the path the app's own message sends the user down. It lasts until the next 30-minute tick re-runs the due confirmation.
  - **No other text tells the truth.**
    - After a quiet check, the renderer re-reads the local status (`EditionProvider.tsx:287-300`). In the repro its `message` is `null`.
    - So Help > Licence shows "Pro licence · Updates through 10/6/2027" (`LicencePanel.tsx:223`), and nothing says the licence check failed.
    - The twin's "keeps working offline" text appears only as the return value of an explicit Refresh licence, never after the quiet check.
    - ADR-623 Amendment 2 decision 3 ("nothing is shown while it is offline") holds for the licence. The update panel shows a false coverage claim instead.
  - **ADRs.**
    - ADR-561 decision 5 ("Revoked or unverifiable credentials do not authorise an update") makes the block itself correct. It does not choose the wording.
    - ADR-547 decision 1 defines not covered as "the newest release this licence's updates do not cover". Decision 4 makes the panel name "the date its updates ended". Here that date is a year in the future.
  - **Novelty.** Nothing in `docs/audits/` covers it, and no open PR touches these files (#1471–#1473 do not).
  - **Newer main.** `git diff a59f74ff9 7a459ef2d` leaves every cited file unchanged.
  - **Severity, P2 under §3.** It is wrong behaviour an ordinary user will hit, with a misleading result:
    - Any paying customer whose weekly confirmation falls due at a launch while offline meets it on the app's own "try Check now" path. Releases ship every few days.
    - The panel states a false fact about rights they paid for and offers no Download, while Free devices update.
    - The P3 argument fails: §3's P3 covers latent issues, drift, missing tests and polish. This is reachable today, and self-healing limits only its duration, not the misleading result.
    - Not P1: no output, licence right or data is affected.
- **Fix direction:**
  - Give a failed confirmation its own update outcome, for example "KerfDesk could not confirm your licence; updates resume after it reconnects", distinct from `not-covered`.
  - Or re-run the confirmation before deciding coverage.
  - Keep the fail-closed rule.

### H10-P3-1 — The web app runs ahead of the desktop release: a project saved there with ADR-671 sharpening opens in desktop 1.0.27 and burns unsharpened with no notice

- **Where:**
  - `src/core/scene/scene-object.ts:390`: `sharpenAmount` and `sharpenRadius` on a photo (ADR-671, #1443, merged 2026-10-27). No schema bump: `PROJECT_SCHEMA_VERSION` is 18 on both `adf300522` (1.0.27) and `a59f74ff9`.
  - On 1.0.27, `validateRasterObject` (`src/io/project/project-shape-validator.ts:313-337` @ `adf300522`) lists no sharpen field and refuses no unknown key.
  - `git grep -n sharpenAmount adf300522 -- src` returns nothing, so 1.0.27's compile cannot apply it.
  - The live web app carries it: `kerfdesk.com/assets/io-ClZE7BKN.js` and `core-KDSLY3Sa.js` each contain `sharpenAmount` (fetched 2026-10-27 13:00Z; deploy of `7a459ef2d` succeeded at 12:27Z).
  - The newest desktop release is still 1.0.27 (`latest.json`).
- **Anchor:**
  - **Twin.** Every sibling ADR that added an output setting without a schema bump states what an older build does with it:
    - ADR-626 item (line 43): "an older build ignores them and cuts" without leads.
    - ADR-649 decision 6: an older build "refuses the project" rather than burning another dither.
    - ADR-670 item 6: "An older build either refuses … or burns an operation's photos uncorrected".
    - ADR-673 line 98: treats the photo as before.
  - ADR-671 item 2 (lines 41-44) adds the two fields and says nothing about older builds. The outcome, a silent unsharpened burn, was never decided.
  - `src/core/scene/project.ts:20-34` is a code comment that gives the general rule: output changes get a bump so "older readers must not silently replace their output semantics".
- **Scenario:**
  1. On kerfdesk.com (Free), Photo engraving → Sharpen 150 %, then Save `portrait.lf2`.
  2. Open it in desktop 1.0.27, or in an older build installed from the site's own "Earlier versions" list.
  3. It opens with "Opened portrait.lf2" and no notice, then burns with the unsharpened tones.
  4. The fields survive a re-save (1.0.27 keeps unknown keys), so the loss is in the burn, not the file.
- **Evidence:** READ + SOURCE.
  - Git reads of both trees, and the live web bundle as above.
  - Not executed against 1.0.27: its deserializer's import closure is 973 files, too large to extract on this PC.
- **Severity note:** P3.
  - The output differs (per-cell power on a photo), but ADR-670 already accepts the identical outcome for the tone curve, so the owner's precedent is acceptance.
  - What is missing is the decision and a notice for this field.
  - The coordinator may weigh P2 under §3, because the burn silently differs from the file.
- **Refuter:** CONFIRMED by two independent lines of evidence, P3 kept.
  - **What would make it false:**
    - 1.0.27 has sharpen code;
    - 1.0.27 refuses unknown raster keys;
    - ADR-671 states what an older build does;
    - the web app does not expose sharpening.
    None holds.
  - **Line 1, the trees.**
    - `git grep sharpenAmount adf300522 -- src` returns nothing.
    - `validateRasterObject` @ `adf300522` (`project-shape-validator.ts:313-337`) checks named fields only and has no strict or unknown-key refusal.
    - `PROJECT_SCHEMA_VERSION` is 18 on both `adf300522` and `7a459ef2d`.
    - ADR-671 on origin/main has no older-build wording. ADR-670 item 6 and ADR-649 decision 6 do.
  - **Line 2, live, fetched 2026-10-27 13:12Z.**
    - `dl.kerfdesk.com/desktop/commercial-manual/latest.json` is 1.0.27, with source `adf300522`.
    - kerfdesk.com `assets/PhotoEngravingDialog-C7tAWCaO.js` contains "Sharpen at engraving resolution" and "Sharpen amount (%)".
    - The Photo engraving dialog is not Pro-gated (`browser-free-build.ts` and `pro-features.ts` do not list it), so the browser Free build can set it.
  - **Not run.** 1.0.27's compile was not run on a sharpened project. The unsharpened burn is inferred from the absence of code.
  - **Anchor nuance.** `project.ts:20-34` is a list of per-version notes, and the quoted words belong to v17. It shows a practice, not a stated general rule.
  - **Severity, P3.** ADR-670 item 6 accepts the same outcome for the sibling tone curve when an operation carries it: an older build "burns an operation's photos uncorrected". So the owner's contract already accepts this class of outcome, and the defect is the decision missing from ADR-671.
- **Fix direction:**
  - Amend ADR-671 to state the older-build outcome, as its siblings do. If refusal is wanted, follow ADR-649 (make the value one an older validator refuses).
  - Consider a general rule: the web app warns, or stamps the saving app version, when a project uses settings newer than the current desktop release.

### H10-P3-3 — The published terms and pricing define a trial and a device differently from the app: the terms promise a trial "once per Windows installation", but a reinstalled Windows on the same PC is refused

- **Where:**
  - `docs/legal/software-supplier-terms.md:31`, published at `public/terms/index.html:155` and identical to the live `/terms/`: a trial "once per Windows installation". It was written 2026-10-07 (`e3820ed51`), before ADR-592.
  - `public/pricing/index.html:504,532,636`: "Each installation of the desktop app counts as one device" and "Each device gets a free 30-day Pro trial".
  - The app:
    - The device is one Windows installation (a `MachineGuid` digest, `electron/licensing-device.ts:80-108`). It is shared by every Windows account and every KerfDesk install on that installation.
    - A trial is also bound to the firmware UUID (`licensing-device.ts:57-78`). The server refuses `trial_already_used` when the hardware already holds another installation's trial (ADR-592 decision 3).
- **Anchor:**
  - **Contract / ground truth.** The live terms against ADR-592 decision 3: "refuses `trial_already_used` when that hardware already holds another installation's trial".
  - **Twin.** Pricing's "each installation of the desktop app" against the app's per-Windows-installation device ID.
- **Scenario:**
  - A customer reinstalls Windows on the same PC, which is a new Windows installation, and chooses Start free 30-day Pro trial. The server answers `trial_already_used`, although the terms promise one trial per Windows installation.
  - Conversely, two Windows accounts on one PC are two "installations of the desktop app" but one device and one trial.
  - Both outcomes are what ADR-592 intends. The published wording is what is wrong.
- **Evidence:** READ + LIVE (`/terms/` fetched 2026-10-27 13:03Z: one match for "once per Windows installation"; `/pricing/`: two matches for "Each installation of the desktop app counts as one device").
- **Known:** No. 02-P3-14 and P3-15 cover the binding's first-come and duplicate-UUID faults, not the published wording.
- **Severity note:** P3. It is copy drift on a legal page, and the trial limit is the intended one. The owner or legal review should approve the wording.
- **Refuter:** CONFIRMED, P3 kept.
  - **What would make it false:** the terms define "eligible" to include the hardware rule, or the server does not bind trials to hardware. Neither holds:
    - The terms never define "eligible".
    - `services/desktop-licensing/authority.mjs:131-134` refuses `trial_already_used`. Its comment says a new Windows installation ID on hardware that already had a trial "is the same computer".
    - ADR-592 decision 3 (dated 2026-10-12) post-dates the terms' wording (`e3820ed51`, 2026-10-07).
  - **Live, fetched 2026-10-27 13:14Z (read-only).**
    - `/terms/` is byte-identical to `public/terms/index.html` on origin/main `7a459ef2d` and in the worktree. It contains "once per Windows installation".
    - `/pricing/` is byte-identical to origin/main. It has "Each installation of the desktop app counts as one device" twice, plus "Free 30-day trial on each device".
  - **Device count.**
    - The terms count "three activated Windows installations", which matches `licensingDeviceId` (the HKLM `MachineGuid`).
    - Pricing's "each installation of the desktop app" does not match it, because the installer is per user and every account shares one `MachineGuid`. That mismatch favours the customer. The trial mismatch does not.
  - **Novelty.** No earlier audit names this wording.
- **Fix direction:** Reword the terms ("once per computer") and pricing ("each Windows installation, or Mac, or Linux system, counts as one device"). Have `check:public-info` or a test pin the wording to ADR-592.

## KNOWN (re-observed, not re-raised)

| ID | State on `7a459ef2d` |
|---|---|
| 02-P3-5 | Still present (`licensing-messages.ts:172`). The H10-P2-1 repro shows it beside the false "updates ended" text. |
| 02-P3-11 | Still present: Help > Licence shows the update date in local time (`LicencePanel.tsx:217`), while coverage compares UTC. The download page's "Earlier versions" advice ("released on or before the Updates through date shown in Help > Licence") inherits the one-day ambiguity. |
| 02-P3-8 | Still present (`project-seal-key.ts:45-49`). The Mac copy on `/download` says a denied keychain prompt only means "enter your licence key again", and does not say that earlier sealed projects then need Pro in Free. Latent: the macOS lane is off. |
| 11-P3-4 | Still present: the live ruleset is strict off and does not require *Desktop packaging gate* (read 2026-10-27). |
| G8-P3-1 | Not re-triggered: #1458–#1470 each had all five required contexts SUCCESS or SKIPPED before merge, and the repository is public. |
| G8-P3-2 | Still present: `release:check` on origin/main has no `check:public-info`. |

**Refuter re-check of the KNOWN items, 2026-10-27, read-only:**
- **Still present on `7a459ef2d`:**
  - 02-P3-5: `licensing-messages.ts:172`.
  - 02-P3-11: `LicencePanel.tsx:216-217` uses `toLocaleDateString`.
  - 02-P3-8: `project-seal-key.ts:45-49`.
  - G8-P3-2: `package.json:58` `release:check` has no `check:public-info`.
- **11-P3-4:** ruleset `19573147` is active, with `strict_required_status_checks_policy: false`. It requires five contexts and not "Desktop packaging gate" (`gh api`).
- **G8-P3-1:** not re-triggered.
  - #1465, #1468 and #1470 each had all five required contexts SUCCESS or SKIPPED.
  - The repository is public.

## Refuted

- **H10-P3-2 (refuter, REPRO): "A lapsed paid customer sees only 'Free', and the Pro prompt names neither the date nor the version to install."**
  - The Pro prompt shows `status.message` under its lead (`ProFeatureDialog.tsx:52-62`).
  - The repro was a temporary `src/ui/licensing/zz-h10r-expired.test.tsx`, now deleted. It used the real runtime, a paid licence with updates until 2027-10-06, and a running 1.0.90 published 2027-10-20.
  - Result: state `updates-expired` and chip "Free". The V-carve prompt reads "This version is newer than your licence's included updates. Renew updates to use Pro in it." Then: "Your licence includes KerfDesk versions released until 2027-10-06. This version is newer, so Pro tools are locked here. Renew updates, or install a version your licence covers."
  - The plain "Free" chip is one of the labels ADR-623 Amendment 3 decision 2 lists for window-off builds. That decision also names the licence panel and the Pro prompt as where the messages appear. This is the message naming the update date that ADR-540 decision 5 asks for.
  - What remains is a missing link to the newest covered installer. That is polish with no anchor.

- **"Old GitHub Preview pre-releases give Pro for free."** `gh release list` shows only v0.2.0-preview.9/10/13, dated 2026-07-23. That is before the Free/Pro split (ADR-540, 2026-09-29) and before the all-rights-reserved licence, so no promised tier is bypassed.
- **"The download page's version history serves builds with since-fixed licence gaps (1.0.0–1.0.21 predate #1346's fix of 02-P2-1 and 02-P2-2) to anyone."** By design:
  - ADR-561 Amendment 6 decision 2 publishes "verified earlier installers" so customers can find covered versions.
  - ADR-540 Amendment 1 accepts that "Previously downloaded builds and historical source cannot be withdrawn".
  - Noted for the maintainer only.
- **"Desktop Free gets camera alignment by importing a machine profile or project that carries a calibration."** The gate is on tool entry (ADR-540 decision 2; Amendment 5 keeps existing jig and board data usable). Project admission deliberately covers only V-carve, relief and adaptive output (`pending-pro-project.ts:42-81`).
- **"The packaged release identity and the published manifest could disagree on `publishedAt`, so an update could lock Pro after installing."** Both come from the one signed identity file the Windows job writes (`release-desktop-unsigned.yml:147-163,262-283`).
- **"The web welcome cannot offer a download because the code-signed catalogue is 404."** It falls back to the manual lane on 404 (`desktop-windows-download.mjs:42-43`).
- **"Paid updates should not fail closed when the licence cannot be confirmed."** The rule is deliberate and pinned (`licensing-free-updates.test.ts:160-180`; ADR-561 decision 5). Only its wording is raised (H10-P2-1).

## Verified clean

- **Downgrade protection, in-app.**
  - The manual lane refuses a version ≤ current, a regressed or changed candidate in the same session, and a backdated release (`manual-update.ts:119-131`).
  - The signed lane skips ≤ current (`commercial-update.ts:258`).
  - The publisher refuses a version or date rollback (`manual-commercial-publisher.mjs:49-54`).
  - Live `latest.json` is 1.0.27 at `adf300522`, and the catalogue is 27 ordered releases with no gaps beyond the never-published 1.0.5.
  - **Refuter spot-check: holds for the live lanes.**
    - `manual-update.ts:119-131` was read, and `manual-update.test.ts` "rejects tampered, wrong-purpose, future and backdated metadata" passes.
    - The platform lane also refuses backdated documents (`platform-manual-update.ts:117-122`).
    - The publisher refuses a version or date rollback (`scripts/manual-commercial-publisher.mjs:48-54`).
    - Nuance: the dormant signed lane (`commercial-update.ts:206-221,257-258`) skips ≤ current but has no `publishedAt` check against the running release. "Refuse older and backdated releases" is exact only for the manual and platform lanes. This is latent while that lane is off, and is not raised.
- **Downgrade data.**
  - Autosave written by a newer schema is retained, never cleared (`autosave-record.ts:103-137`).
  - Projects with a newer schema are refused with "saved with a newer KerfDesk" (`project-open-completion.ts:61-63`).
  - Older readers keep unknown layer fields on re-save (`normalize-layer.ts:45` @ `adf300522`).
  - The material library parses each payload lazily, so one unreadable library never clears the collection (`material-library-collection.ts:173-196`).
  - The last machine fails soft to the starter machine with the setup banner (`last-machine-persistence.ts:47-64`).
  - Schemas in 1.0.0 / 1.0.20 / 1.0.27 / main: project 12 / 18 / 18 / 18; material library 2 / 3 / 3 / 3; machine profile 1; autosave 1.
- **Edition by build.**
  - The browser build ignores a licence client.
  - Desktop builds without commercial metadata run Free.
  - The Preview runs Free and says so on `/download`.
  - Only `channel === 'commercial'` can report `edition: 'pro'` (`licensing-status.ts:93-96`).
  - `startLicensedEditionLocked` holds Pro off until the first status (`main.tsx:87`).
- **Pro gate parity.**
  - Menu and command search through `gateCommandsForEdition` (`edition-command-gate.ts:11-35`).
  - The Design Studio toolbar button (`DesignStudioButton.tsx:16`; `openStudio` has no other caller).
  - The jig "Edit jig" button (`RegistrationJigPanel.tsx:36`).
  - Camera calibrate, check and nudge (`CalibrateCameraControls.tsx:34-61`, `CameraMovedNotice.tsx:38-46`).
  - CNC operation choices.
  - Remote `needs_pro` checks.
  - The browser strips each panel host.
- **Website against app and server.**
  - Prices: US$49.50 and US$20 (`pro-features.ts:69-70`; `payments.mjs:7` `CATALOG = { purchase: 4950, renewal: 2000 }`).
  - Three devices (`authority.mjs:7`).
  - A 30-day trial (`authority.mjs:141-142`).
  - The trial's three-day check-in is disclosed on `/privacy/`.
  - "Installs for your Windows account" (`perMachine: false`).
  - Windows 10/11 x64; macOS 13+ matches `minimumSystemVersion: '13.0'`.
- **Second PC.** Manage devices releases another seat with the key. The 6-per-30-days release cap returns `release_limit_reached` with its own message (`licensing-messages.ts:70`).
- **Merge gate.** The ruleset is active, the repository is public, and #1458–#1470 merged only after their required contexts passed.

## Not verified

- **Installers were not run.** No installer was downloaded or run. NSIS behaviour on installing an older version over a newer one, uninstall leaving `%APPDATA%`, and protocol or file registration are inferred from electron-builder defaults and earlier qualification reports.
- **Live services.** The licence service and relay were not contacted. Whether a licence-API outage actually leaves `dl.kerfdesk.com` reachable is inferred from the separate hosts (`license.kerfdesk.com` and `dl.kerfdesk.com`).
- **macOS and Linux lanes** are off (404), so they were read only. Trials there carry no hardware ID (`licensing-device.ts:60`), and their terms and pricing wording would need the same correction as H10-P3-3.
- **Older reader not run.** 1.0.27's deserializer and raster compile were not executed on a sharpened project (H10-P3-1), because the import closure was too large for this PC's memory.
- **Forward compatibility of every field added since 1.0.0** was not enumerated. Only the fields since 1.0.27 (tone curve and sharpen) and the lead fields were checked against their ADRs.

All `zz-h10-*` files were removed:
- the repro test `electron/zz-h10-update-coverage.test.ts`;
- the scratchpad folders `zz-h10-net` and `zz-h10-tools`;
- two `zz-h10-*` temporary directories.

The refuter's `zz-h10r-*` files were also removed:
- `electron/zz-h10r-update-coverage.test.ts`;
- `src/ui/licensing/zz-h10r-expired.test.tsx`;
- the scratchpad folder `zz-h10r-net`, which held the fetched live pages.

```json
[
  {"id":"H10-P2-1","severity":"P2","area":"distribution","file":"electron/licensing-runtime.ts","line":215,"anchor":"Contract: ADR-547 decisions 1 and 4 (not covered = a release the licence's updates do not cover; names the date updates ended); ADR-523 Amd 1 item 6 (an outage only shows a message); Twin: licensing-messages.ts:172 ('saved licence keeps working offline') vs update-status-text.ts:39-40,92-96","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Any failed licence request (offline weekly confirmation, licence-API outage, filtering proxy) sets authenticationFailed, so the manual and signed update lanes report a covered paid release as not-covered; Help > Check for Updates says 'your licence's updates ended on 10/6/2027' (a future date) and offers no download while Free devices update; repro: ready/pro licence, eligibleBefore true, after one failed refresh false, updateState not-covered","refuter":"Own REPRO (temporary electron/zz-h10r-update-coverage.test.ts, real runtime + createManualUpdates + updateStatusText, in start() order): paid licence due its weekly confirmation; offline, 503 unavailable and 429 rate_limited each gave not-covered 'updates ended on 10/6/2027'; not-due control gave available. Second path: offline launch -> failed ('try Check now again') -> reconnect -> Check now -> not-covered (no confirmation runs before eligible). After a quiet check the re-read status message is null, so Help > Licence shows 'Updates through 10/6/2027' and nothing tells the truth. ADR-561 d5 makes the block correct, not the wording; ADR-547 d1/d4 make 'not covered' name the date updates ended. P2 kept: reachable today on the app's own Check now path, misleading about paid rights; self-healing limits duration only"},
  {"id":"H10-P3-1","severity":"P3","area":"distribution","file":"src/core/scene/scene-object.ts","line":390,"anchor":"Twin: ADR-626 l.43, ADR-649 decision 6, ADR-670 item 6, ADR-673 l.98 each state the older-build outcome; ADR-671 item 2 does not; code comment core/scene/project.ts:20-34","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"The web app (main, live bundle carries sharpenAmount) is ahead of desktop 1.0.27; a project saved with ADR-671 sharpening opens in 1.0.27 (schema 18 on both, unknown raster keys accepted, no sharpen code) and burns unsharpened with no notice; the same applies to builds installed from the site's Earlier versions list","refuter":"Two lines: trees (no sharpenAmount at adf300522; validateRasterObject has no unknown-key refusal; schema 18 on both; ADR-671 silent, ADR-670 item 6 and ADR-649 d6 not) and live (latest.json 1.0.27 at adf300522; PhotoEngravingDialog chunk on kerfdesk.com carries the Sharpen fields, not Pro-gated). 1.0.27 compile not run. project.ts:20-34 is per-version notes, not a general rule. P3 kept: ADR-670 item 6 accepts uncorrected burns of an operation's tone curve"},
  {"id":"H10-P3-2","severity":null,"area":"distribution","file":"src/ui/licensing/ProFeatureDialog.tsx","line":187,"anchor":"Contract: ADR-540 decision 5 ('opens as Free with a message naming the update date'); Twin: electron/licensing-status.ts:219-222 updatesExpiredMessage","evidence":"READ","verdict":"REFUTED","known":false,"summary":"Latent: a paid user whose updates ended and who installs the download page's default (newest) version sees a plain 'Free' chip and no message; the Pro prompt says 'Renew updates' with no date and no route back to a covered version; only Help > Licence names the date","refuter":"REFUTED by REPRO (temporary src/ui/licensing/zz-h10r-expired.test.tsx): ProFeatureDialog shows status.message under its lead, so the V-carve prompt for updates-expired reads 'Your licence includes KerfDesk versions released until 2027-10-06 ... Renew updates, or install a version your licence covers'; the 'Free' chip is a label ADR-623 Amd 3 d2 lists for window-off builds; only a link to the covered installer is missing (polish, no anchor)"},
  {"id":"H10-P3-3","severity":"P3","area":"distribution","file":"docs/legal/software-supplier-terms.md","line":31,"anchor":"Contract: ADR-592 decision 3 (trial refused when the hardware already holds another installation's trial); Twin: pricing 'Each installation of the desktop app counts as one device' vs licensing-device.ts:80-108 per-Windows-installation device id","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Live /terms/ promise a trial 'once per Windows installation' (written before ADR-592) but a reinstalled Windows on the same PC gets trial_already_used; pricing counts each app installation as a device while the app counts one device per Windows installation shared by all accounts","refuter":"Live /terms/ and /pricing/ (13:14Z) byte-identical to origin/main; terms never define 'eligible'; authority.mjs:131-134 refuses trial_already_used for a new Windows installation on the same hardware; ADR-592 (2026-10-12) post-dates the terms wording (e3820ed51, 2026-10-07); terms' device count matches MachineGuid, pricing's 'each installation of the desktop app' does not. P3 kept"}
]
```
