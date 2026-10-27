# Meta audit v1 — M2 Rolling-v2 P2s (`meta-rolling-v2-p2`)

- **When:** 2026-10-23 08:50–09:45 (+08)   **Tree:** worktree HEAD `11a0c63c2` (origin/main
  `ca3dbeb79` plus audit docs). Checked against origin/main `48f3d8b5a` (#1411, #1412): those 24
  files touch material tests and external-program expression and M0/M1 checks only. None is on a
  sampled fix path. The 26-K1 run reads `external-program-review.ts` and
  `normalize-external-program.ts`; their diff on main only adds expression refusals and M0/M1
  wording, and does not touch arcs or the envelope.
- **Scope:** the 58 P2 rows of `docs/audits/2026-10-21-rolling-v2/LEDGER.md` (including 10-K1 and
  26-K1), their 25 area reports, and their fix PRs. P1s are M1's.
- **Method:** METHOD.md with the meta changes in AREAS.md.
  - **Part A (all 58):** `gh pr list --state all --search "created:>=2026-10-20"` (101 PRs, bodies
    included), then a scan of every title and body for the rolling-v2 IDs `NN-P2-n` and `NN-K1`,
    including ranges such as `01-P2-1..P2-4`. The IDs with no PR were checked again by keyword
    (rotary, 4040, Smoothieware, manifest, overscan, camera bridge, rapid, DPI, finishing, Abort
    lane). On origin/main, `git log 70c01e11f..origin/main` was run on each cited file, to rule out
    a fix that landed without naming the finding.
  - **Live checks** (read-only):
    - `gh secret list`, plus the environment and branch-policy APIs, for 11-P2-1.
    - `curl https://kerfdesk.com/pricing` for 22-P2-1.
    - `gh run list --workflow deploy.yml` for the site deploys.
  - **Part B:** for each sampled P2:
    - read the pre-fix code at the merge's first parent (`git show <merge>^1:path`);
    - read the fix on origin/main;
    - ran the fix PR's regression test on the current tree;
    - judged test adequacy from the assertions. For two P2s, the PR test was also run against the
      pre-fix module (see Evidence).
  - **Test runs:** every run was a focused Vitest run of one to three files, with
    `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run …`.
  - **Repro copies:** the scratchpad `m2-repros\` holds `zz-m2-old-dogbone.ts`,
    `zz-m2-dogbone-mutation.test.ts`, `zz-m2-old-selection-transform.ts` and
    `zz-m2-selection-mutation.test.ts`. All `zz-m2-*` files were deleted from the tree.
- **Counts:** 52 meta findings, P2 1 / P3 51 after the refuter:
  - 48 stale records (M2-P3-1.01–.48);
  - 1 wrong severity (M2-P3-2);
  - 1 fix that leaves a gap (M2-P3-3), **raised to P2 by the refuter** (ID kept for traceability);
  - 1 contradiction (M2-P3-4);
  - 1 record omission (M2-P3-5).

  The JSON block has 53 entries: an umbrella entry M2-P3-1, one entry for each stale row, and the
  four other findings. No false positive. One fix fails at P2 for older records (M2-P3-3). Own
  candidates refuted: 6.
- **Refuter (2026-10-23, fresh context):** confirmed 52, plausible 0, refuted 0. Severity changes:
  M2-P3-3 P3 → P2; 03-P2-4 P2 → P1 in the rolling-v2 record (as M2-P3-2 proposes, record only).
  No REFUTER-RAISED P1/P2. Stress sample of three unsampled-by-MUT fixes (23-P2-1, 27-P2-3,
  19-P2-1) all hold; see "Refuter stress sample" below. Repros `zz-m2r-*` were deleted.

## Headline

All 27 sampled P2s were genuine when raised. Every merged fix in the sample works on current main,
and each one's regression test asserts the symptom the finding reported. The record is the weak
point:

- **48 stale rows.** The LEDGER's "Confirmed P1/P2" table still marks all 58 P2s `open`. 48 have
  merged fixes.
- **The summary was already stale.** Its own list (state on 2026-10-22, morning) disagrees with
  GitHub, and it disagreed with the rows on the day it was written.
- **Seven P2s have no fix track.** 01-P2-6, 03-P2-3, 03-P2-6, 03-P2-7, 03-P2-8, 04-P2-1 and
  09-P2-1 have no PR, no fix card and no decision request. Each still holds on main. Later
  controller rounds re-filed four of them as KNOWN and moved on.
- **One rating breaks METHOD §3.** 03-P2-4 meets the P1 test: a 50 % line burned at full power
  while Job Review said 50 %. Its refuter called it "P1 by effect" but kept it at P2. It is already
  fixed.
- **One fix leaves a gap by design.** #1373 (12-P2-2) does not protect calibrations saved before
  the fix. *Refuter: raised to P2. Every calibration made on 1.0.21 or earlier is frameless, and
  ADR-440 Amd 1's stated remedy, "checked again", does not work after a frame change (see
  M2-P3-3).*

## Part A — status reconciliation (all 58 P2s)

**Columns:**
- **Ledger row:** the "Fix status" column of the "Confirmed P1/P2 (coordinator-verified)" table.
- **Ledger summary:** the "Fix PRs from this audit (state on 2026-10-22, morning)" block.
- **GitHub:** the state on 2026-10-23.

**Classes:**
- **M:** fixed and merged.
- **O:** PR open.
- **N:** no PR.
- **F:** marked fixed, but no PR found.

| P2 | Ledger row | Ledger summary | GitHub (2026-10-23) | Class | Match? |
|---|---|---|---|---|---|
| 01-P2-1 | open | Open #1347 | #1347 merged `8f19c435e` | M | **no** |
| 01-P2-2 | open | Open #1347 | #1347 merged | M | **no** |
| 01-P2-3 | open | Open #1347 | #1347 merged; production effect needs a manual relay Worker redeploy (not observable) | M | **no** |
| 01-P2-4 | open | Open #1347 | #1347 merged | M | **no** |
| 01-P2-5 | open | Awaiting decision | no PR (#1347 and ADR-657 l.70: "not changed here") | N | yes |
| 01-P2-6 | open | not listed | no PR (same) | N | yes (untracked, M2-P3-5) |
| 02-P2-1 | open | Open #1346 | #1346 merged `8cbff4126` | M | **no** |
| 02-P2-2 | open | Awaiting decision | #1346 merged; decided as ADR-540 Amd 6 (tapered inlay is Pro) | M | **no** |
| 03-P2-1 | open | Merged #1342 | #1342 merged `0b2657c5e` | M | **no** (row) |
| 03-P2-2 | open | Merged #1342 | #1342 merged | M | **no** (row) |
| 03-P2-3 | open | not listed | no PR; `rotary-transform.ts` unchanged since the audit | N | yes (untracked) |
| 03-P2-4 | open | Merged #1349 | #1349 merged `99d8743b7` | M | **no** (row) |
| 03-P2-5 | open | Merged #1349 | #1349 merged | M | **no** (row) |
| 03-P2-6 | open | not listed | no PR; `contour-entry.ts`, `job-review-contour-entry-facts.ts` unchanged | N | yes (untracked) |
| 03-P2-7 | open | not listed | no PR; `laser-off-motion-policy.ts` unchanged | N | yes (untracked) |
| 03-P2-8 | open | not listed | no PR; `motion-manifest-parser.ts` unchanged (last change #546) | N | yes (untracked) |
| 03-P2-9 | open | Open #1345 | #1345 merged `d9a9aa0a6` | M | **no** |
| 04-P2-1 | open | not listed | no PR; bridge origin still fixed at `http://127.0.0.1:51731`, no identity token | N | yes (untracked) |
| 05-P2-1 | open | In progress | #1370 merged `1a25886ff` | M | **no** |
| 05-P2-2 | open | In progress | #1370 merged | M | **no** |
| 06-P2-2 | open | In progress | #1367 merged `2f18639b1` | M | **no** |
| 06-P2-3 | open | In progress | #1367 merged | M | **no** |
| 06-P2-4 | open | In progress | #1367 merged | M | **no** |
| 06-P2-5 | open | In progress | #1367 merged | M | **no** |
| 07-P2-1 | open | In progress | #1365 merged `71ff820ce` | M | **no** |
| 07-P2-2 | open | In progress | #1365 merged | M | **no** |
| 07-P2-3 | open | In progress | #1365 merged | M | **no** |
| 08-P2-1 | open | In progress | #1357 merged `b4fc50c05` | M | **no** |
| 08-P2-2 | open | In progress | #1357 merged | M | **no** |
| 08-P2-3 | open | In progress | #1357 merged | M | **no** |
| 08-P2-4 | open | In progress | #1357 merged | M | **no** |
| 09-P2-1 | open | not listed | no PR; `live-job-estimate.ts:168` and `prepared-job-metrics.ts:43` still pass `prepared.project.device`; re-filed as KNOWN E6-K-3 | N | yes (untracked) |
| 10-P2-1 | open | Open #1354 | #1354 merged `1bb2b885e` (+ #1384 DOC4 Weld coverage) | M | **no** |
| 10-K1 | open | Open #1354 | #1354 merged | M | **no** |
| 11-P2-1 | open | Merged #1339 | #1339 merged `5a98c5c66`; live: 0 repository secrets, both Pages secrets in `production`, branch policy `main` only | M | **no** (row) |
| 12-P2-2 | open | In progress | #1373 merged `365e37f98` (gap for older calibrations, M2-P3-3) | M | **no** |
| 12-P2-3 | open | In progress | #1373 merged | M | **no** |
| 12-P2-4 | open | In progress | #1373 merged | M | **no** |
| 13-P2-1 | open | Merged #1352 | #1352 merged `b32eebc95` | M | **no** (row) |
| 13-P2-2 | open | Merged #1352 | #1352 merged (+ #1384 DOC5: commit-time overflow keeps the draft) | M | **no** (row) |
| 14-P2-1 | open | Awaiting decision | no PR; `svg-units.ts` still fixes 96 px/in | N | yes |
| 15-P2-1 | open | In progress | #1359 merged `b68a53beb` | M | **no** |
| 16-P2-1 | open | Awaiting decision | no PR; finishing cell files unchanged since #1136 | N | yes |
| 18-P2-1 | open | In progress | #1366 merged `298e0ab4a` (+ #1397: D7-P2-1 found the banner rule re-burned on grblHAL) | M | **no** |
| 19-P2-1 | open | In progress | #1372 `662d958e9` + #1375 `c0263f3be` merged | M | **no** |
| 21-P2-1 | open | In progress | #1360 merged `d9f69b856` | M | **no** |
| 21-P2-2 | open | In progress | #1360 merged | M | **no** |
| 21-P2-3 | open | In progress | #1360 merged | M | **no** |
| 22-P2-1 | open | Open #1355 | #1355 merged `725a37337`; deploys succeeded since; live pricing lists 9 Pro tools | M | **no** |
| 23-P2-1 | open | In progress | #1371 merged `518520035` | M | **no** |
| 23-P2-2 | open | In progress | #1371 merged | M | **no** |
| 23-P2-3 | open | In progress | #1371 merged | M | **no** |
| 25-P2-1 | open | In progress (25/28) | #1369 merged `f34e0ecab` | M | **no** |
| 26-K1 | open | In progress | #1368 merged `cefd0e7c8` (+ #1384 M2: radius tolerance and plane-axis checks) | M | **no** |
| 27-P2-1 | open | In progress | #1364 merged `bfde3e06a` | M | **no** |
| 27-P2-2 | open | In progress | #1364 merged | M | **no** |
| 27-P2-3 | open | In progress | #1364 merged | M | **no** |
| 28-P2-1 | open | In progress (25/28) | #1369 merged | M | **no** |

**Totals:**
- **Classes:** M 48, O 0, N 10, F 0.
- **Ledger row mismatches:** 48, all M rows. No P2 is marked fixed without a PR. No P2 has an
  open PR (the only open PR, #1413, is ADR-630 Amd 6).
- **The ledger's other P2 columns are consistent:**
  - the batch table's P2 column sums to 58;
  - every P2 heading in the 25 reports is in the table, or was lowered by its refuter (06-P2-1,
    12-P2-1, 23-P2-4 and 26-P2-1 to P3).

## Findings

### M2-P3-1 — Stale record: 48 LEDGER P2 rows say `open` although their fixes are merged
- **Corrects:** the "Fix status" column of `LEDGER.md` lines 72–134 for the 48 rows marked
  **no** above. JSON entries M2-P3-1.01–.48 hold one row each.
- **Where:** `docs/audits/2026-10-21-rolling-v2/LEDGER.md:70-134` (table), `:20-27` (summary).
- **Anchor:** Ground truth. GitHub PR state on 2026-10-23, from `gh pr list --state all` with
  bodies. AREAS "Stale record".
- **Scenario:**
  - **Rows.** A maintainer reading the ledger sees 58 open P2s. 10 are actually open.
  - **The table contradicted its own summary when written.** `ef72907cd` (2026-10-22 07:30 +08)
    lists #1339, #1342, #1349 and #1352 as **Merged**. Yet the rows for 03-P2-1/2/4/5, 11-P2-1
    and 13-P2-1/2 still said `open`.
  - **The summary is stale now:**
    - "Open: #1346, #1347, #1354, #1355": all four merged on 2026-10-22.
    - "In progress": all 13 sessions merged as #1357, #1359, #1360, #1364–#1373 and #1375.
    - "Awaiting decisions: 02-P2-2": #1346 settled the tier (ADR-540 Amd 6).
  - **No fix PR column.** Follow-up repairs that corrected rolling-v2 fixes are not recorded
    anywhere in the ledger:
    - #1384 DOC4/DOC5/M2 for 10-P2-1, 13-P2-2 and 26-K1;
    - #1387 for #1354's P3-3;
    - #1397 for #1366's grblHAL banner rule.
- **Evidence:** LIVE (`gh pr list`), plus the merge SHAs in the table above.
- **Refuter:** CONFIRMED.
  - **PR state.** `gh pr view` on all 23 distinct fix PRs behind the 48 rows: #1339, #1342,
    #1345, #1346, #1347, #1349, #1352, #1354, #1355, #1357, #1359, #1360, #1364–#1373 and
    #1375. Every one is `MERGED` into `main`, with the merge SHA the table gives,
    and its title names the IDs it is mapped to. #1347's body says "01-P2-5 and 01-P2-6 are not
    touched".
  - **The summary contradicted the rows when written.** `ef72907cd` (2026-10-22 07:30 +08) lists
    #1339, #1342, #1349 and #1352 under **Merged**, while rows 86 and 110 of the same commit say
    `open`.
  - **Minor.** The table runs to line 135 (04-P2-1), not 134. #1413, called "the only open PR",
    merged since (`17f4d6b68`). Neither changes the finding.
- **Fix direction:**
  - Add a "Fix PR" column holding the merge SHA, and the follow-up PRs where there are any. Mark
    the 48 rows merged with a dated "Corrected by meta-v1 M2" note.
  - Replace the dated summary with a pointer to that column.

### M2-P3-2 — Wrong severity: 03-P2-4 met METHOD §3's P1 test and was kept at P2
- **Corrects:** 03-P2-4 (`03-laser-output.md:179-198`; `LEDGER.md:86`). Kind: wrong severity.
- **Where (original defect):** `src/core/output/grbl-laser-lines.ts:23-24` at `70c01e11f`. `scaleS`
  rounded to whole S for any integer `maxPowerS`.
- **Anchor:** Contract.
  - METHOD §3, P1: "silently produces wrong physical output (power, position, depth, scale)". It
    has no reachability discount; the "unusual conditions" qualifier belongs to P2's security
    clause.
- **Scenario (from the report, re-checked in code):**
  - The controller reports `$30=1`, which ADR-567 applies automatically.
  - A 50 % or 70 % Line emits `S1`, which is full PWM, while Job Review says "power 50%".
  - A 30 % Line emits S0, with only `long-blank-feed`. No warning names the power collapse.
  - The refuter wrote "P1 by effect" and kept P2 because the condition is unusual. It also cites
    field reports of `$30=1`.
- **Evidence:** READ plus REPRO.
  - The pre-fix `scaleS` is shown above (`Number.isInteger(maxPowerS)` → `Math.round`).
  - The #1349 test `small-whole-number-power-range.test.ts` asserts
    `scaleS(30|50|70|100, 1) = 0.3|0.5|0.7|1`, where the old rule gives 0|1|1|1. It also pins the
    archived version-2 bytes `[0, 1]` (line 104). It passes on the current tree (8/8).
- **Severity of this meta finding:** P3. The defect is fixed (#1349, power-scale v3, now v4) and
  shipped in 1.0.22, so no live defect is uncovered. The correction changes the rolling-v2 counts
  to P1 7 and P2 57, and the record of how this class is rated. 26-K1's refuter used the same
  narrower test: "In this ledger, P1 means physical harm with no warning". 26-K1 had a review
  notice, so its P2 stands.
- **Refuter:** CONFIRMED. I tried to keep 03-P2-4 at P2 and could not.
  - **§3 read afresh.** P1's clauses are categorical: fires or moves unexpectedly, silently wrong
    physical output, data loss, remote security. None carries a reach qualifier. Reach appears only
    in P2 ("an ordinary user will hit"; "unusual conditions", inside the security clause) and P3
    ("not reachable today"). `$30=1` is reachable today.
  - **Silent.** At `70c01e11f` readiness warns only on a missing or mismatched `$30`, or `$31 > 0`
    (`controller-readiness.ts:207-247`). Job Review shows the fact row "S max $30 = 1"
    (`job-review-live-rows.ts:136`), which is not a warning. The layer still says 50 %, and the
    30 % case gets only `long-blank-feed`, which names the wrong cause. No warning names the
    collapse.
  - **Wrong physical output.** It is KerfDesk's rounding, not the firmware: the pre-fix `scaleS`
    rounds whenever `Number.isInteger(maxPowerS)`, while GRBL takes decimal S. ADR-567 Amd 1
    states the same. The original refuter itself wrote "P1 by effect".
  - **Reach was not discounted elsewhere in the same ledger.** 21-P1-1 stayed P1 although the
    ledger says "Narrow reach (only Neotronics 4040 has starter presets)". 03-P1-1 and 13-P1-1 need
    a crafted file, and 03-P1-2 a LINE-entity DXF. So a P2 for 03-P2-4 on reach alone is
    inconsistent as well as outside §3.
  - **Fix still holds on `origin/main` `17f4d6b68`.** Vector `scaleS` and raster
    `rasterCompilationPowerScale` both route small ranges through `usesVirtualPowerRange` (version
    4). Fire control floors S, so it fails safe. Archived versions replay as intended. The meta
    finding stays P3: there is no live defect.
  - **For M4.** The controller-v4 ledger records "E4-P1-1 lowered to P2 (reach)". M4 should test
    that lowering against the same reading of §3.
- **Fix direction:** Re-rate 03-P2-4 as P1 in the ledger with a dated note. Remind refuters that
  §3's P1 test has no reachability discount.

### M2-P3-3 (P2 after refuter) — Fix leaves a gap by design: calibrations saved before #1373 still drift silently after a bed or origin change (12-P2-2)
- **Corrects:** 12-P2-2 (`12-camera.md:90`; `LEDGER.md:132`), marked fixed by #1373. Kind: fix
  ineffective (partial, by design).
- **Where:**
  - `src/core/camera/model/camera-bed-frame.ts:43-44` on origin/main:
    `if (fitted === undefined) return { kind: 'ok', model: record };`.
  - No code stamps a frame onto an older record. `git grep bedFrame` finds writers only in
    `calibrate/assumed-target.ts`, the new-calibration path.
- **Anchor:**
  - Twin: overlay, camera trace and camera marks against the burn, as in the original finding.
  - Contract: ADR-440 Amd 1 Consequences: "A calibration made before this amendment has no frame.
    It is used as before until the camera is calibrated or checked again."
- **Scenario:**
  1. A camera user calibrated on 1.0.21 or earlier, so the record has no `bedFrame`.
  2. After updating, they change the bed height from 400 to 410 mm, or the origin corner.
  3. The record is returned unmoved. The overlay, camera trace and camera Print and Cut marks
     shift 10 mm against the burn, with no panel note.
  This is the original 12-P2-2 scenario, on every calibration made before the fix. For a
  calibration made on current main, the defect is gone: test lines 44–83 cover the 400 → 410 shift
  and the origin refusal.
- **Evidence:** READ.
  - The code is quoted above.
  - The fix PR's own test pins the gap: `camera-bed-frame.test.ts:85`, "gives the same record back
    when nothing changed, and for older records without a frame".
- **Severity:** P3, not the original P2. *(Refuter: raised to P2; see the verdict below.)*
  - The governing ADR amendment documents the carve-out, so the code meets its contract.
  - The exposure is transitional: only older calibrations followed by a later bed or origin
    change. Recalibrating, or Check camera, clears it. *(Refuter: Check camera does not
    clear it once the frame has changed; see below.)*
  - The refuter may raise it to P2 under the "original severity" rule if it judges the carve-out
    itself unjustified.
- **Refuter:** CONFIRMED, and **raised to P2**. The carve-out is accepted but unjustified, and the
  remedy the ADR and this finding name does not work.
  - **ADR-440 Amd 1 accepts the gap and warns no one.** Consequences: "A calibration made before
    this amendment has no frame. It is used as before until the camera is calibrated or checked
    again." Decision 4's note ("Said when moved") needs a frame. `cameraBedFrameNote` returns null
    for a frameless record, and no other text marks one (`git grep` finds none).
  - **"Checked again" does not cure it after a frame change.**
    - `openCheck` sets `targetBedFrame: saved.bedFrame ?? null` (`camera-calibration-store.ts:185`).
    - `assumedTarget` then uses `args.knownBedFrame ?? frameNow` (`assumed-target.ts:58`). So
      Check camera labels the old rings in **today's** frame.
    - It compares against the unmoved saved model, so it again reports about 0 mm drift, the
      original 12-P2-2 symptom.
    - Saving the refit stamps today's frame (`calibration-actions.ts:156`) onto a pose fitted
      from rings engraved in the old frame, which makes the error permanent.
    - Only engraving a new target, or "Target already engraved" with a remembered target (bed size
      kept, origin assumed unchanged), gives a correct frame.
  - **REPRO** (`src/ui/camera/calibrate/zz-m2r-frameless-check.test.ts`, deleted, 3/3 passed;
    `model-fixtures` camera):
    - a frameless record after 400 → 410 burns what the camera saw at machine Y200 at
      **Y210.000**;
    - Check camera's assumed frame is `{"origin":"front-left","bedWidthMm":400,"bedHeightMm":410}`
      (source `saved-calibration`);
    - the same pose stamped 410 and the bed set back to 400 burns at **Y210.000**, where the
      unstamped record gives Y200.000.
  - **Why P2 and not P3.**
    - AREAS: a meta finding takes the severity of the product defect it uncovers, and "Fix
      ineffective" covers a defect that still reproduces on main.
    - This is 12-P2-2 itself, misleading Check camera included, on every calibration made on
      1.0.21 or earlier: `365e37f98` is in 1.0.22 (`b9202d5aa`) but not in 1.0.21 (`faf5a54f1`).
    - The reach is the original's: a Machine Setup change after calibrating. Its P2 rationale also
      holds: Frame shows the true outline, so it is not P1.
    - An origin-corner change on a frameless record is still a silent mirror, where a framed
      record is refused.
    - The fix direction above (stamp at first load) is cheap and closes the window for every
      later change.
- **Fix direction:** Stamp a frameless record with the frame current at its first load after the
  update. That is the same assumption "used as before" already makes, and it protects every
  later change. Or show a "calibrated before bed frames were recorded — Check camera" note on the
  calibration row.

### M2-P3-4 — Contradiction: 01-P2-6 sits in the "coordinator-verified" table with only a PLAUSIBLE verdict
- **Corrects:** 01-P2-6 (`01-remote-control.md:136-155`; `LEDGER.md:77`). Kind: contradiction
  (the table's label against the row's own evidence).
- **Where:** `LEDGER.md:65,77`.
  - The table heading says "Confirmed P1/P2 (coordinator-verified)".
  - The row's coordinator evidence says "PLAUSIBLE only (its refuter never returned)".
  - METHOD §5: "The coordinator then re-verifies every P1 and P2 itself before the ledger counts
    it."
- **Anchor:** Contract. METHOD §5; AREAS "Contradiction".
- **Scenario:** The P2 count includes a finding with no refuter verdict and no coordinator check.
  It is also outside every fix track (M2-P3-5).
- **Evidence:** READ on origin/main. The mechanism the finding describes is still there:
  - `machine-control-registry.ts:120-121` calls `this.holds.release(id)`, which calls
    `releaseHeldMotion` (`machine-hold.ts` `HoldDeadman.release`). It then calls
    `releaseHeldMotion(operation)` again.
  - `releaseHeldMotion` guards only on `operationIsTerminal`, so both calls reach `cancelJog()`.
  - The newer attempt makes `assertCancelContext` throw "Motion cancellation was replaced…"
    (`laser-motion-cancel-context.ts`).
  - The first call's `catch` then sets `state = 'unknown'` with "The held jog stop could not be
    confirmed".
  - So the finding is genuine in mechanism. Its user-visible window (the first rejection until the
    second settles, against the phone's 600 ms poll, which stops at the first terminal state) is
    still unmeasured, and that window decides P2 or P3, as the report itself says.
- **Refuter:** CONFIRMED.
  - **The original report.** `01-remote-control.md:16-18`: "The machine-cluster refuter (R1) did
    not return a written verdict … P2-6 … marked PLAUSIBLE". Line 151: "PLAUSIBLE — R1 wrote and
    ran a test … but its written verdict did not return … drop to P3 if [the window] is much shorter
    than the phone's poll". JSON line 306: `"verdict":"PLAUSIBLE"`.
  - **The ledger.** Line 77's evidence cell is "PLAUSIBLE only (its refuter never returned)", under
    the heading at line 65, "Confirmed P1/P2 (coordinator-verified)". No coordinator check is
    recorded for it, against METHOD §5 (line 81).
  - **In the original's favour, without curing the contradiction.** The auditor's two lenses did
    reproduce the `unknown` receipt with the real registry on a fake GRBL port. The mechanism is a
    REPRO, not a READ. The unmeasured part is only the window's length.
  - **Still on `origin/main` `17f4d6b68`.** `machine-control-registry.ts:120-121` releases the hold
    and then calls `releaseHeldMotion(operation)` again. `machine-hold.ts:106,118-119` guards only
    on `operationIsTerminal`, and its `catch` sets `unknown`. Neither file has changed since
    `70c01e11f`.
- **Fix direction:** Mark the row PLAUSIBLE until someone measures the window with the real
  registry on the GRBL simulator, or make `releaseHeldMotion` idempotent (the report's fix
  direction) and close it.

### M2-P3-5 — Record omission: seven open P2s have no PR, no fix card and no decision request
- **Corrects:** the ledger summary, `LEDGER.md:20-27`, for 01-P2-6, 03-P2-3, 03-P2-6, 03-P2-7,
  03-P2-8, 04-P2-1 and 09-P2-1. Kind: stale record (open findings missing from every fix track).
- **Where:**
  - The summary's tracks (Merged, Open, In progress, Awaiting decisions) list none of the seven.
  - The earlier version (`ef72907cd^`, "Proposed but not started") did not list them either.
- **Anchor:** Contract. METHOD §9 step 4: "Propose a fix session for each confirmed P1/P2 cluster".
- **Scenario:** Each is still present on main:
  - **03-P2-3, 03-P2-6, 03-P2-7, 03-P2-8:** the cited files have had no commit since `70c01e11f`.
  - **04-P2-1:** `camera-bridge.ts:10` still has a fixed origin and no identity token, although
    ADR-660 work edited the file afterwards.
  - **09-P2-1:** `live-job-estimate.ts:168`, `prepared-job-metrics.ts:43`.
  - **01-P2-6:** see M2-P3-4.
  - **Later rounds re-filed some as KNOWN and moved on:**
    - 09-P2-1 is E6-K-3 (controller v4 E6);
    - 03-P2-8 appears in C6 and E1;
    - 03-P2-7 in D5;
    - 03-P2-3 in D3.

  The open P2 backlog is therefore 10, not the four the "Awaiting decisions" line implies.
- **Evidence:** READ (`git log 70c01e11f..origin/main -- <file>` for each), and `git grep` over
  `docs/` for each ID.
- **Refuter:** CONFIRMED. None of the seven has a PR, and none is fixed incidentally on
  `origin/main` `17f4d6b68`.
  - **GitHub.** `gh pr list --state all --search "created:>=2026-10-19"` gave 125 PRs (#1290–#1414,
    bodies included). I grepped them for each ID and for keywords:
    - IDs: `E6-K-3`;
    - remote: `releaseHeldMotion`, `jog_hold_stop`, "hold release", idempotent;
    - laser output: rotary, rebase, contour entry, ADR-239, ADR-343, overscan, runway,
      long-blank-feed, manifest, M221;
    - camera bridge: 51731, RTSP, squat;
    - estimate: estimate, ADR-416.
  - **Hits, all unrelated.**
    - #1347's body says "01-P2-5 and 01-P2-6 are not touched".
    - #1389 is roller scale (D3-P2-1), not the rebase.
    - #1380 restores Smoothieware's `M221 S100` before an opened program. It does not touch the
      manifest.
    - #1353 changes `emit-raster-sweep.ts` for the Marlin lit M5. Image runways are still
      unmarked. The only raster use of the marker is controlled laser-off travel
      (`emit-raster-travel.ts:98`).
    - #1386, #1394 and #1396 do not touch the bridge origin.
    - Nothing is open now. #1413 has merged.
  - **Code, re-checked.**
    - `rotary-transform.ts`, `contour-entry.ts`, `job-review-contour-entry-facts.ts`,
      `laser-off-motion-policy.ts`, `motion-manifest-parser.ts`, `smoothieware-strategy.ts`,
      `live-job-estimate.ts`, `prepared-job-metrics.ts` and `estimate-duration.ts` have no commit in
      `70c01e11f..origin/main`.
    - **03-P2-8:** `applyMCode` arms only on M3/M4/M106, while Smoothieware output uses
      `M221 S100 P…`.
    - **09-P2-1:** `estimate-duration.ts:78` still uses `device.maxFeed`.
    - **04-P2-1:** `camera-bridge.ts:10` keeps `http://127.0.0.1:51731` with no token.
    - **03-P2-6:** `contourEntryComment` (`grbl-laser-lines.ts:68-71`) is still unconditional.
  - **Fix tracks.** No fix card or decision for any of the seven in the rolling-v2, controller-v2,
    controller-v3 or controller-v4 ledgers. They are re-filed as KNOWN only: 18 K-7 and K-12, 26
    K-6, C6, D3, D5, E1, E6-K-3.
- **Fix direction:**
  - Add the seven to the ledger summary as "No fix started". Propose fix cards: 03-P2-6/7/8 and
    09-P2-1 are small; 03-P2-3 and 04-P2-1 need a design choice.
  - Or record an explicit deferral for each.

## Part B — deep re-verification (sample of 27)

**Selection rule (fixed before any result was known):**
- **Coverage:** one P2 from each of the 25 areas that have P2s.
- **Within an area:** I picked a P2 whose fix is merged, preferring one whose fix is a single
  module that a variant can test directly. I picked an open P2 only where the area had no merged
  one (04, 09, 14, 16).
- **Two extras, chosen for risk:**
  - 01-P2-6, the only P2 counted without a refuter verdict;
  - 12-P2-2, the fix most likely to miss a migration path.
- **Result:** 27 P2s, 21 with merged fixes (78 %) and 6 open.

**Column meanings:**
- **Genuine?** The claim holds on the pre-fix tree.
- **Effective?** The scenario, or a close variant, no longer reproduces on the current tree.
- **Test adequate?** The PR's test would fail without the fix.
- **Severity OK?** The rating holds under METHOD §3.

**Evidence keys:**
- **RUN:** the PR regression test was run on the current tree and passed.
- **MUT:** the PR test was run against the pre-fix module and failed.
- **READ:** code reading.
- **LIVE:** a live GitHub or site check.

| P2 | Fix | Genuine? | Effective on main? | Test adequate? | Severity OK? |
|---|---|---|---|---|---|
| 01-P2-1 | #1347 | yes (READ `8f19c435e^1`: `executeOrigin` called `zeroZHere()` bare) | yes (RUN `machine-origin.test.ts` 11/11 with 02-P2-1's file; READ `liveZeroZOverwriteWarning` guard) | yes (READ: `zeroZHere` not called; evidence stays `probe`) | yes (borderline P1 noted by the report; an operator tap is the trigger) |
| 01-P2-6 | none | yes in mechanism (READ on main) | n/a (open) | n/a | **unverified** (window unmeasured) → M2-P3-4 |
| 02-P2-1 | #1346 | yes (READ: `useStore.setState(insertPersonalArtwork)`) | yes (RUN `personal-artwork-pro-admission.test.ts`; READ `commitProjectEdit`; lint rule `kerfdesk/no-raw-project-set-state` is an error in `src/ui`) | yes (READ: `requestPro` called once with `vcarve`, project unchanged) | yes |
| 03-P2-4 | #1349 | yes (READ `70c01e11f`) | yes (RUN 8/8) | yes (READ: `scaleS(30,1)` gives 0 under the old rule) | **no**: P1 under §3 → M2-P3-2 |
| 04-P2-1 | none | yes (READ on main: fixed `127.0.0.1:51731`, no token) | n/a | n/a | yes (local squatter needed: P2 security clause) |
| 05-P2-2 | #1370 | yes (READ `1a25886ff^1`: `done` is not an interruption status) | yes (RUN `laser-alarm-done-tail.smoothie.simulator.test.ts` 3/3) | yes (READ: expects `cancelled` plus planner step-back; old code stays `done`) | yes |
| 06-P2-4 | #1367 | yes (READ `2f18639b1^1`: `step={props.step ?? 1}`) | yes (RUN `CutSettingsDialog.stored-values.test.tsx`; READ `step 'any'`) | yes (READ: every input must pass `checkValidity()` before submit) | yes |
| 07-P2-1 | #1365 | yes (READ `71ff820ce^1`: fractional radius, `?? 0` box sums) | yes (RUN `sketch-window-tapered-grid.test.ts` 10/10; whole-pixel radius; `localMean` now throws on an off-grid read) | yes (READ: ink at tapered scales equals the whole-scale ink) | yes |
| 08-P2-2 | #1357 | yes (MUT: `expected 'error' to be 'ok'`) | yes (RUN `selection-transform.test.ts`; multi-drag path READ, `apply-transform-drag.ts` `resizeEditSetsSize`) | **yes, MUT**: the test fails on the old module | yes |
| 09-P2-1 | none | yes (READ on main, unchanged) | n/a | n/a | yes (misleading estimate, no machine effect) |
| 10-K1 | #1354 | yes (MUT: plate keeps 1 ring of 3) | yes (RUN `dogbone-operations.test.ts`) | **yes, MUT**: 3 of 5 tests fail on the old `dogbone.ts` | yes |
| 11-P2-1 | #1339 | yes (the `production` secrets are dated 2026-10-22 10:56; #1384 R1 records removing the repository copies) | yes (LIVE: 0 repository secrets; `production` and `desktop-commercial` deploy from `main` only) | partly: `check:secret-scopes` in CI guards workflow files, but no check guards live repository settings | yes |
| 12-P2-2 | #1373 | yes (READ: the record had no frame) | **partly**: new calibrations yes; older records no → M2-P3-3 | yes for the fix; the test pins the gap (line 85) | yes |
| 12-P2-3 | #1373 | yes (READ `365e37f98^1`: `bedPointToNative(positionLaserTarget)`, unclamped) | yes (RUN `head-capture-store.test.ts`; READ: jog and settle both use the clamped stop) | yes (READ: every jog ≤ `limits.maxX/maxY` of −2) | yes |
| 13-P2-2 | #1352 (+#1384) | yes (report REPRO; old key is a random UUID per import) | yes (RUN `embedded-font-limit.test.ts`: 33 tries leave 1 font; 33rd distinct refused) | yes (READ: `fontKeys()` equals one key) | yes |
| 14-P2-1 | none | yes (READ: `CSS_PX_PER_INCH = 96`, no override) | n/a | n/a | yes (size is visible on canvas; maintainer decision) |
| 15-P2-1 | #1359 | yes (READ diff: render anchor not carried through `mapped()`) | yes (RUN `variable-text-style-anchor.test.ts` 5/5) | yes (READ: burn ranges from emitted G-code per alignment) | yes (Frame shows it, so not silent) |
| 16-P2-1 | none | yes (READ: finishing files unchanged since #1136) | n/a | n/a | yes (inside ADR-412 Amd 1's bound; maintainer decision) |
| 18-P2-1 | #1366 (+#1397) | yes (READ: `disconnect` outside `PLANNER_DISCARDING_KINDS`) | yes (RUN `link-loss-restart.test.ts`) | yes (READ: line 41 → 26 after a banner) | yes |
| 19-P2-1 | #1372, #1375 | yes (spec + Chromium truncate-on-pick) | yes for the named paths (RUN `save-processed-bitmap.test.ts`); 3 of 19 other direct `pickFileForSave` callers read: they prepare first | yes (READ: the Chromium picker model empties on pick) | yes |
| 21-P2-3 | #1360 | yes (READ `d9f69b856^1`: no `Scan+Cut` in `clb-import.ts`) | yes (RUN `clb-import.test.ts`: Fill plus Line presets and a warning) | yes | yes |
| 22-P2-1 | #1355 | yes | yes (LIVE pricing: V-carve, 3D relief, Adaptive clearing, Advanced tracing, Camera alignment, Registration Jig, Place Board, Box generator, Design Studio) | yes (`check:public-info` in CI) | yes |
| 23-P2-1 | #1371 | yes (READ diff: RGB median ignored alpha) | yes (RUN `spot-heal.test.ts`) | yes (READ: faint paper heals to `[0,0,0,24]`, an empty layer to `[0,0,0,0]`) | yes |
| 25-P2-1 | #1369 | yes (report REPRO; READ: no active-bit step before the fix) | yes (RUN `box-insert-active-bit.test.ts`, generator and fit-test inserts) | yes | yes |
| 26-K1 | #1368 (+#1384) | yes | yes (RUN `external-run-arc-planes.test.ts`) | yes | yes (P2, borderline P1, kept by the maintainer) |
| 27-P2-3 | #1364 | yes (READ: only `KD…` keys were redacted) | yes (RUN `save-support-report.incidents.test.ts`: $75/77/330/331/533, FluidNC `$Sta/Password`, `[ESP101]`) | yes | yes |
| 28-P2-1 | #1369 | yes (READ diff: `applyAiDraft` skipped `applyLayerDefaultsToFreshLayers`) | yes (RUN `ai-artwork-seeding.test.ts`) | yes | yes |

**Test runs, one to three files per run, all on the current tree:** 03-P2-4 8/8; 05-P2-2 3/3; 07-P2-1
10/10; 08-P2-2 + 10-K1 + 13-P2-2 20/20; 15-P2-1 5/5; 23-P2-1 + 27-P2-3 + 18-P2-1 23/23; 25-P2-1 +
26-K1 12/12; 19-P2-1 + 28-P2-1 + 21-P2-3 29/29; 01-P2-1/2 + 02-P2-1 11/11; 06-P2-4 + 12-P2-3 10/10.

**Mutation runs (PR test against the pre-fix module):** `vi.mock` pointed the module at its first-parent copy.
- `zz-m2-dogbone-mutation.test.ts`: 3 of 5 failed. Example: "expected [3222.81] to have a length
  of 3 but got 1".
- `zz-m2-selection-mutation.test.ts`: the straight-line case failed with "expected 'error' to be
  'ok'"; the other 10 passed.

## Refuted (own candidates)

- **07-P2-1 fix throws on fractional sub-pixel reads.** Refuted. `localMean` now throws on an
  off-grid read, but every `thresholdAt` caller passes whole pixel indices
  (`contour-boundary.ts:142`, the mask loops, `saddle-connectivity.ts:330`), and the radius is
  rounded.
- **12-P2-3 capture times out at a clamped stop.** Refuted. `settleAt` waits at
  `jogStopOnBed(stop)`, the same clamped target the jog uses (`head-capture-store.ts:186,214-221`).
- **03-P2-4 fix is skipped for archived projects.** Refuted. A fresh prepare uses
  `CURRENT_LASER_POWER_SCALE_VERSION` (`prepare-output.ts:286`). Archived versions only replay a
  saved recovery artifact byte for byte, as ADR-567 intends.
- **02-P2-1 has twins (08-K-1 raw writers).** Refuted. `kerfdesk/no-raw-project-set-state` is an
  error for `src/ui/**` and flags any non-literal patch or a `project` key. The remaining
  `useStore.setState` calls patch other state, or take a justified disable.
- **11-P2-1: a branch workflow can still name `environment: production`.** Refuted. The environment's
  deployment branch policy allows `main` only.
- **19-P2-1: direct `pickFileForSave` callers still pick first.** Refuted for the three read
  (`camera/snapshot.ts`, `file-actions.ts` G-code save, Adjust Image preset export): each prepares
  its bytes first. The other 16 were not read (see Not verified).

## Verified clean

- **Every sampled P2 was genuine when raised** (27 of 27). No false positives. 10-K1 and 08-P2-2
  were shown genuine by running the fix tests against the pre-fix modules.
- **Every merged fix in the sample works on current main**, with the 12-P2-2 carve-out
  (M2-P3-3). *Refuter: that carve-out is a P2 gap, so this claim holds only for calibrations made
  after #1373. The other fixes held under the refuter's stress sample below.*
- **Every sampled regression test asserts the reported symptom**, not the implementation. Two of
  them fail against the pre-fix modules (MUT).
- **The ledger's P2 arithmetic is consistent.** The batch table sums to 58, and every report P2
  heading is either in the table or was lowered by its refuter.
- **11-P2-1 and 22-P2-1 hold live** (repository settings and the deployed pricing page), not only
  in code.
- **No P2 was marked fixed without a PR**, and none has a PR still open.

## Not verified

- **01-P2-3 in production.** The relay is a Cloudflare Worker deployed by hand; no workflow deploys
  it. Whether the relay now in production includes #1347 cannot be seen from here. The merged
  code was not run either.
- **01-P2-6's window** on a real phone and controller (see M2-P3-4).
- **19-P2-1, remaining callers.** 16 of the 19 direct `pickFileForSave` callers were not read for
  failable work after the pick. No real Chromium or Electron picker was exercised.
- **22-P2-1 features page.** Only `/pricing` was fetched, not the features page the finding also
  names.
- **Hardware.** No hardware checks for 18-P2-1, 26-K1 or 12-P2-3: no hardware was operated.
- **The 31 P2s outside the sample** were reconciled in Part A only:
  - 01-P2-2..5 (01-P2-2's test passed in the 01-P2-1 run);
  - 02-P2-2;
  - 03-P2-1, -2, -3, -5, -6, -7, -8, -9;
  - 05-P2-1;
  - 06-P2-2, -3, -5;
  - 07-P2-2, -3;
  - 08-P2-1, -3, -4;
  - 10-P2-1;
  - 12-P2-4;
  - 13-P2-1;
  - 21-P2-1, -2;
  - 23-P2-2, -3;
  - 27-P2-1, -2.
- **Lowered P2s.** The four P2s lowered to P3 (06-P2-1, 12-P2-1, 23-P2-4, 26-P2-1) were not
  re-rated; they belong to M6's refuted/lowered sweep.

## Refuter stress sample (three sampled fixes the meta auditor did not revert-test)

- **23-P2-1 (#1371, spot heal): holds.** MUT: I ran the pre-fix `spot-heal.ts` (from
  `518520035^1`, copied as `zz-m2r-old-spot-heal.ts`) against the current one in
  `zz-m2r-spot-heal-mut.test.ts`.
  - **Old module, 3/3 failed.**
    - Cleaned-up paper `[0,0,0,24]` heals to `[0,0,0,255]`.
    - An empty-layer speck heals to `[0,0,0,255]`: the opaque black disc.
    - Variant: a white speck on a transparent layer leaves a feather edge of `[43,43,43,255]`.
  - **New module, 3/3 passed.** The premultiplied blend keeps the edge white or transparent.
  - **Editor path.** It now passes the repair from `healRepairFor`, which uses the layer's own ring,
    or the composite for an empty upper layer (`editor-session-retouch.ts`).
- **27-P2-3 (#1364, support-report passwords): holds.**
  - **Before and after, by reading.** `bfde3e06a^1`'s `redactSupportReportText` replaced only `KD…`
    keys. The PR test asserts seven password strings absent, so it must fail on the old module.
  - **Ground truth fetched again** (`gh api repos/grblHAL/core/contents/settings.h` and
    `settings.c`):
    - `Setting_WiFi_STA_Password = 75`, `Setting_WiFi_AP_Password = 77`,
      `Setting_AdminPassword = 330`, `Setting_UserPassword = 331` and
      `Setting_MQTTBrokerPassword = 533` match the redaction list exactly.
    - `settings.c:1962`:
      `value = hal.stream.state.webui_connected ? PASSWORD_MASK : ((char *)(setting->value));`.
      Passwords are printed in plain text unless the WebUI is connected, so the original finding
      was genuine.
  - **Settings rows** reach the report as `${row.code}=${row.rawValue}`
    (`save-support-report.ts:71`), the shape the regex matches.
- **19-P2-1 (#1372 and #1375, save picker): holds for all seven named paths.** Read before and
  after.
  - **The order now.** Each path prepares, then calls `pickPreparedSaveTarget`, and only writes
    after the pick:
    - surfacing: preflight and `stageSurfacingProgram`;
    - SVG: `materializeVariableText` and `embedSvgRasterImages`;
    - format export: `exportFile`;
    - `.rd`: `prepareBackgroundRd`;
    - timelapse: `encodeTimelapseVideo`;
    - processed bitmap: hydrate, build and encode;
    - multi-file trace: traced first, with "written even if Cancel came while the picker was
      open".
  - **Not a P2.** `saveSupportReport` still picks before `gatherSupportReportFacts`, by design for
    the menu gesture. It was not one of the seven, and its timestamped filename makes replacing a
    file unlikely.

No product P1 or P2 beyond the M2-P3-3 raise was found (no REFUTER-RAISED).

```json
[
  {"id":"M2-P3-2","severity":"P3","area":"meta-rolling-v2-p2","corrects":"03-P2-4","kind":"wrong severity","file":"src/core/output/grbl-laser-lines.ts","line":23,"anchor":"Contract: METHOD §3 P1 'silently produces wrong physical output (power…)', no reachability discount","evidence":"READ+REPRO","verdict":"CONFIRMED","known":false,"summary":"Original refuter: 'P1 by effect', kept P2 as unusual; $30=1 turned 50%/70% into S1 (full power) with Job Review showing 50%; fixed by #1349 (test passes 8/8), so P1 7 / P2 57 in the record. Refuter: confirmed; section 3 P1 has no reach qualifier and the same ledger kept 21-P1-1 at P1 despite narrow reach"},
  {"id":"M2-P3-3","severity":"P2","area":"meta-rolling-v2-p2","corrects":"12-P2-2","kind":"fix ineffective (partial, by design)","file":"src/core/camera/model/camera-bed-frame.ts","line":44,"anchor":"Twin: overlay vs burn; Contract: ADR-440 Amd 1 Consequences accept frameless records 'as before'","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Calibrations saved before #1373 carry no bedFrame and are returned unmoved, so a later bed-size or origin change still shifts overlay, trace and camera marks silently; own test camera-bed-frame.test.ts:85 pins it; stamp the frame at first load. Refuter: raised P3->P2 (ID kept); Check camera on a frameless record labels rings in today's frame (assumed-target.ts:58), reports ~0 drift and a saved refit stamps the wrong frame (REPRO Y210 at bed 400); every 1.0.21-or-earlier calibration is exposed"},
  {"id":"M2-P3-4","severity":"P3","area":"meta-rolling-v2-p2","corrects":"01-P2-6","kind":"contradiction","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":77,"anchor":"Contract: METHOD §5 coordinator re-verifies every P1/P2 before the ledger counts it","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Listed under 'Confirmed P1/P2 (coordinator-verified)' with evidence 'PLAUSIBLE only (its refuter never returned)'; mechanism (double releaseHeldMotion, replaced cancel -> unknown) still on main, window unmeasured, so P2 unsupported"},
  {"id":"M2-P3-5","severity":"P3","area":"meta-rolling-v2-p2","corrects":"01-P2-6, 03-P2-3, 03-P2-6, 03-P2-7, 03-P2-8, 04-P2-1, 09-P2-1","kind":"stale record (open findings missing from every fix track)","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":20,"anchor":"Contract: METHOD §9 step 4 propose a fix session for each confirmed P1/P2 cluster","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Seven confirmed P2s have no PR, fix card or decision request and still hold on main (cited files unchanged since 70c01e11f); later rounds re-filed 09-P2-1, 03-P2-3/7/8 as KNOWN only"},
  {"id":"M2-P3-1","severity":"P3","area":"meta-rolling-v2-p2","corrects":"LEDGER P2 fix-status column (48 rows) and the 2026-10-22 summary","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":70,"anchor":"Ground truth: GitHub PR state, gh pr list --state all (2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"All 58 P2 rows say open; 48 fixes are merged (rows below); the summary lists merged PRs as open/in progress and 02-P2-2 as awaiting a decision #1346 made; follow-up repairs #1384/#1387/#1397 are unrecorded"},
  {"id":"M2-P3-1.01","severity":"P3","area":"meta-rolling-v2-p2","corrects":"01-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":72,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1347 merged (merge 8f19c435e); summary: Open #1347"},
  {"id":"M2-P3-1.02","severity":"P3","area":"meta-rolling-v2-p2","corrects":"01-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":73,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1347 merged (merge 8f19c435e); summary: Open #1347"},
  {"id":"M2-P3-1.03","severity":"P3","area":"meta-rolling-v2-p2","corrects":"01-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":74,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1347 merged (merge 8f19c435e); summary: Open #1347 (relay Worker redeploy needed for production effect; not observable here)"},
  {"id":"M2-P3-1.04","severity":"P3","area":"meta-rolling-v2-p2","corrects":"01-P2-4","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":75,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1347 merged (merge 8f19c435e); summary: Open #1347"},
  {"id":"M2-P3-1.05","severity":"P3","area":"meta-rolling-v2-p2","corrects":"02-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":78,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1346 merged (merge 8cbff4126); summary: Open #1346"},
  {"id":"M2-P3-1.06","severity":"P3","area":"meta-rolling-v2-p2","corrects":"02-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":79,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1346 merged (merge 8cbff4126); summary: Awaiting decision; #1346 decided it (ADR-540 Amd 6, tapered inlay is Pro)"},
  {"id":"M2-P3-1.07","severity":"P3","area":"meta-rolling-v2-p2","corrects":"03-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":83,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1342 merged (merge 0b2657c5e); summary already said Merged #1342 when the row said open"},
  {"id":"M2-P3-1.08","severity":"P3","area":"meta-rolling-v2-p2","corrects":"03-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":84,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1342 merged (merge 0b2657c5e); summary already said Merged #1342 when the row said open"},
  {"id":"M2-P3-1.09","severity":"P3","area":"meta-rolling-v2-p2","corrects":"03-P2-4","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":86,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1349 merged (merge 99d8743b7); summary already said Merged #1349 when the row said open"},
  {"id":"M2-P3-1.10","severity":"P3","area":"meta-rolling-v2-p2","corrects":"03-P2-5","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":87,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1349 merged (merge 99d8743b7); summary already said Merged #1349 when the row said open"},
  {"id":"M2-P3-1.11","severity":"P3","area":"meta-rolling-v2-p2","corrects":"03-P2-9","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":91,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1345 merged (merge d9a9aa0a6); summary: Open #1345"},
  {"id":"M2-P3-1.12","severity":"P3","area":"meta-rolling-v2-p2","corrects":"05-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":92,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1370 merged (merge 1a25886ff); summary: In progress"},
  {"id":"M2-P3-1.13","severity":"P3","area":"meta-rolling-v2-p2","corrects":"05-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":93,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1370 merged (merge 1a25886ff); summary: In progress (#1366 cross-links the unplug variant)"},
  {"id":"M2-P3-1.14","severity":"P3","area":"meta-rolling-v2-p2","corrects":"06-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":94,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1367 merged (merge 2f18639b1); summary: In progress"},
  {"id":"M2-P3-1.15","severity":"P3","area":"meta-rolling-v2-p2","corrects":"06-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":95,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1367 merged (merge 2f18639b1); summary: In progress"},
  {"id":"M2-P3-1.16","severity":"P3","area":"meta-rolling-v2-p2","corrects":"06-P2-4","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":96,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1367 merged (merge 2f18639b1); summary: In progress"},
  {"id":"M2-P3-1.17","severity":"P3","area":"meta-rolling-v2-p2","corrects":"06-P2-5","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":97,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1367 merged (merge 2f18639b1); summary: In progress"},
  {"id":"M2-P3-1.18","severity":"P3","area":"meta-rolling-v2-p2","corrects":"07-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":98,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1365 merged (merge 71ff820ce); summary: In progress"},
  {"id":"M2-P3-1.19","severity":"P3","area":"meta-rolling-v2-p2","corrects":"07-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":99,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1365 merged (merge 71ff820ce); summary: In progress"},
  {"id":"M2-P3-1.20","severity":"P3","area":"meta-rolling-v2-p2","corrects":"07-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":100,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1365 merged (merge 71ff820ce); summary: In progress"},
  {"id":"M2-P3-1.21","severity":"P3","area":"meta-rolling-v2-p2","corrects":"08-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":101,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1357 merged (merge b4fc50c05); summary: In progress"},
  {"id":"M2-P3-1.22","severity":"P3","area":"meta-rolling-v2-p2","corrects":"08-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":102,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1357 merged (merge b4fc50c05); summary: In progress"},
  {"id":"M2-P3-1.23","severity":"P3","area":"meta-rolling-v2-p2","corrects":"08-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":103,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1357 merged (merge b4fc50c05); summary: In progress"},
  {"id":"M2-P3-1.24","severity":"P3","area":"meta-rolling-v2-p2","corrects":"08-P2-4","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":104,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1357 merged (merge b4fc50c05); summary: In progress"},
  {"id":"M2-P3-1.25","severity":"P3","area":"meta-rolling-v2-p2","corrects":"10-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":107,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1354 (+#1384 DOC4) merged (merge 1bb2b885e); summary: Open #1354"},
  {"id":"M2-P3-1.26","severity":"P3","area":"meta-rolling-v2-p2","corrects":"10-K1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":108,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1354 merged (merge 1bb2b885e); summary: Open #1354"},
  {"id":"M2-P3-1.27","severity":"P3","area":"meta-rolling-v2-p2","corrects":"11-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":131,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1339 merged (merge 5a98c5c66); summary already said Merged #1339; live: 0 repository secrets, production env main-only"},
  {"id":"M2-P3-1.28","severity":"P3","area":"meta-rolling-v2-p2","corrects":"12-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":132,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1373 merged (merge 365e37f98); summary: In progress"},
  {"id":"M2-P3-1.29","severity":"P3","area":"meta-rolling-v2-p2","corrects":"12-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":133,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1373 merged (merge 365e37f98); summary: In progress"},
  {"id":"M2-P3-1.30","severity":"P3","area":"meta-rolling-v2-p2","corrects":"12-P2-4","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":134,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1373 merged (merge 365e37f98); summary: In progress"},
  {"id":"M2-P3-1.31","severity":"P3","area":"meta-rolling-v2-p2","corrects":"13-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":110,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1352 merged (merge b32eebc95); summary already said Merged #1352 when the row said open"},
  {"id":"M2-P3-1.32","severity":"P3","area":"meta-rolling-v2-p2","corrects":"13-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":111,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1352 (+#1384 DOC5) merged (merge b32eebc95); summary already said Merged #1352 when the row said open"},
  {"id":"M2-P3-1.33","severity":"P3","area":"meta-rolling-v2-p2","corrects":"15-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":112,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1359 merged (merge b68a53beb); summary: In progress"},
  {"id":"M2-P3-1.34","severity":"P3","area":"meta-rolling-v2-p2","corrects":"18-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":114,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1366 (+#1397 D7-P2-1) merged (merge 298e0ab4a); summary: In progress"},
  {"id":"M2-P3-1.35","severity":"P3","area":"meta-rolling-v2-p2","corrects":"19-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":115,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1372 + #1375 merged (merge 662d958e9); summary: In progress"},
  {"id":"M2-P3-1.36","severity":"P3","area":"meta-rolling-v2-p2","corrects":"21-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":117,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1360 merged (merge d9f69b856); summary: In progress"},
  {"id":"M2-P3-1.37","severity":"P3","area":"meta-rolling-v2-p2","corrects":"21-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":118,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1360 merged (merge d9f69b856); summary: In progress"},
  {"id":"M2-P3-1.38","severity":"P3","area":"meta-rolling-v2-p2","corrects":"21-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":119,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1360 merged (merge d9f69b856); summary: In progress"},
  {"id":"M2-P3-1.39","severity":"P3","area":"meta-rolling-v2-p2","corrects":"22-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":129,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1355 merged (merge 725a37337); summary: Open #1355; live pricing page now lists 9 Pro tools"},
  {"id":"M2-P3-1.40","severity":"P3","area":"meta-rolling-v2-p2","corrects":"23-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":120,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1371 merged (merge 518520035); summary: In progress"},
  {"id":"M2-P3-1.41","severity":"P3","area":"meta-rolling-v2-p2","corrects":"23-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":121,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1371 merged (merge 518520035); summary: In progress"},
  {"id":"M2-P3-1.42","severity":"P3","area":"meta-rolling-v2-p2","corrects":"23-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":122,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1371 merged (merge 518520035); summary: In progress"},
  {"id":"M2-P3-1.43","severity":"P3","area":"meta-rolling-v2-p2","corrects":"25-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":123,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1369 merged (merge f34e0ecab); summary: In progress (25/28)"},
  {"id":"M2-P3-1.44","severity":"P3","area":"meta-rolling-v2-p2","corrects":"26-K1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":124,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1368 (+#1384 M2) merged (merge cefd0e7c8); summary: In progress"},
  {"id":"M2-P3-1.45","severity":"P3","area":"meta-rolling-v2-p2","corrects":"27-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":126,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1364 merged (merge bfde3e06a); summary: In progress"},
  {"id":"M2-P3-1.46","severity":"P3","area":"meta-rolling-v2-p2","corrects":"27-P2-2","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":127,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1364 merged (merge bfde3e06a); summary: In progress"},
  {"id":"M2-P3-1.47","severity":"P3","area":"meta-rolling-v2-p2","corrects":"27-P2-3","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":128,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1364 merged (merge bfde3e06a); summary: In progress"},
  {"id":"M2-P3-1.48","severity":"P3","area":"meta-rolling-v2-p2","corrects":"28-P2-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":125,"anchor":"Ground truth: GitHub PR state (gh pr list --state all, 2026-10-23)","evidence":"LIVE","verdict":"CONFIRMED","known":false,"summary":"Ledger row says open; fix #1369 merged (merge f34e0ecab); summary: In progress (25/28)"}
]
```
