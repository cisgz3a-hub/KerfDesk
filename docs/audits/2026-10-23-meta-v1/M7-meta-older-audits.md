# Meta audit v1 — M7 Older audits (`meta-older-audits`)

- **When:** 2026-10-26, 13:58–14:25 (+08).
- **Tree:** origin/main @ `79720dd5c`.
  - The shared worktree took origin/main at 13:57:58 (merge `ca83d87ed`), before the first test run at 14:04. Its `src/` and `electron/` are identical to `79720dd5c` (`git diff --stat origin/main HEAD -- src electron` is empty).
  - `79720dd5c` is `adf300522` plus #1442 (photo tone calibration) and #1444 (CNC reach review). Neither touches a file cited below.
- **Scope:** the audits that came before the rolling rounds.
  - **Controller:**
    - `2026-09-25-controller-full-audit.md`, with its folder (`README.md`, `verification.md`, `tracks/CN.md`);
    - `2026-10-16-controller-pipeline-audit.md` and `2026-10-16-controller-reconnect-audit.md`;
    - `2026-10-19-controller-behaviour-audit.md`;
    - `2026-10-20-controller-design-audit.md` and `2026-10-20-controller-protocol-audit.md`.
  - **CNC:**
    - `2026-09-24-cnc-full-audit.md`;
    - `2026-09-27-cnc-gap-audit.md`;
    - `2026-09-29-cnc-audit-second-pass.md`;
    - `2026-10-09-released-cnc-output-audit.md`.
- **Method:** METHOD.md with the meta changes in AREAS.md, judged against the clarified §3 (the P1 test has no reach clause).
  - Every item marked fixed, open, deferred, accepted or follow-up was listed (Inventory below).
  - Merge state was read with `gh pr view <n> --json state,mergedAt`.
  - **"Tracked"** means a PR, a fix card, a ledger row, or an ADR that names the item as a deferred follow-up. A later report that only re-observes the item as KNOWN does not count. This is M2's standard (M2-P3-5).
- **Sample (37 items).** It was chosen in four strata, weighted as AREAS asks:
  - **A. Controller items marked fixed with P1/P2-class impact (15).** Both Criticals (MA-7, MA-1) and six of the ten Highs from 2026-09-25, at least one per firmware track (GP, HF, CG, MA, SM, OR), plus GP-3 and CG-11 for variants. Also all three 10-16 P1s and one fix each from the 10-19 and 10-20 audits.
  - **B. CNC items marked fixed (5).** The Critical (MC-1 with JR-1), the two Highs fixed by #1019 or main (JR-2, P2-toolpath-2), GC-1, and the 10-09 P1.
  - **C. CNC items left open (10).** Every open item rated High or Medium whose effect is physical output (position, depth, scale, uncut or overcut stock), plus two items that turned out fixed.
  - **D. Controller items left open, and one contradiction (7).** The 10-19 and 10-20 open items that change behaviour, plus CS-05, which contradicts a 09-25 fix, and the CN-track "clamps" claim from AREAS.
- **Evidence:**
  - The named regression tests of every sampled fixed item were run on the tree: 401 tests in 35 files, all passing.
  - Fresh variants were run for P2-toolpath-2, GC-1, GP-3, CG-11 and JR-1.
  - Fresh repros were run for the open CNC items: `zz-m7-cnc.test.ts` and `zz-m7-cnc-fixed.test.ts`, placed in `src/io/gcode/`.
  - Command: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <files>`, one process at a time.
  - The repro files were deleted from the worktree. Copies and raw output (`out.txt`) are in the scratchpad `m7-repros\`.
- **Counts:**
  - 11 meta findings after the refuter: **P1 1**, **P2 5**, **P3 5**. The auditor raised P1 2, P2 5 and P3 4. The refuter moved M7-P1-2 from P1 to P2 (KNOWN) and M7-P2-4 from P2 to P3.
  - Of the 37 sampled items:
    - 0 fixed items regressed. JR-2's sub-half-bit variant is M6-P2-2, already known.
    - 10 open items are untracked.
    - 3 open items are tracked only by an ADR note: P2-control-1 (ADR-491 Amd 1), F-4 (ADR-648) and D-4/P-4 (ADR-375 Amd 4).
    - 3 items marked open are in fact fixed: P2-relief-finish-3, WA-4 and CS-05.
  - Own candidates dropped: 4 (see "Refuted").
- **Refuter (2026-10-26, independent, on the same tree):** CONFIRMED 10, PLAUSIBLE 0, REFUTED 0, KNOWN 1.
  - **Severity changes:**
    - M7-P1-2: P1 → P2. It is KNOWN through ADR-491 Amd 1 item 3, and the output is the park height the operator set.
    - M7-P2-4: P2 → P3. What the operator sees no longer points at the homing corner, and a wrong pick reverses the jog arrows.
  - **Repros:** `zz-m7r-relief.test.ts`, `zz-m7r-park.test.ts` and `zz-m7r-p2.test.ts` in `src/io/gcode/`, run one at a time and then deleted. Their output is in the scratchpad file `m7r-out.txt`.
  - **Firmware:** read at gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e` (`limits.c`, `motion_control.c`, `defaults.h`, `system.c`).

## Headline

Every sampled fix still holds on main. The Marlin quickstop, the reset-required latch, the grblHAL parser re-arm, the Smoothieware G92 offset and the M3 lit-drain rule all pass. So do the 10-16 Abort and serial-tail repairs, and the 10-19 and 10-20 fixes. Fresh variants of the CNC fixes hold too: tabs on thin stock, the helix half-arcs and the `$32` router error.

The weak point is the open items. The four CNC audits from September left 46 items open. They have no ledger, and later rounds picked up only the ones that fell inside their area. Four open items still reproduce on main and were never carried forward. One more sits as an ADR follow-up with no owner:

- **P2-relief-rough-3 (P1).** One relief's roughing cuts 2.175 mm into a neighbouring relief 1 mm away, at full depth, with no warning.
- **P2-control-1 (P1; the refuter made it P2 and KNOWN).** On a homed router, a park height that fits the Z travel can still lift Z above its top stop, with no warning. ADR-491 Amendment 1 parked this as a follow-up on 2026-09-29. F7 re-observed it as KNOWN, and nobody owns it.
- **MC-2 (P2).** Touch-off still seeks 25 mm down blind. It never checks the probe circuit, although the 09-29 pass ranked this first in "Fix these next".
- **P2-toolpath-3 (P2).** A closed shape stacked on its exact copy cancels and is not cut, with no warning. The laser twin of that warning returns early for CNC.
- **CO-3 (P2).** CNC Job Origin anchors on the cutter's reach, not the artwork. A 0.5 mm V-bit engraving lands 6.35 mm in from zero. This contradicts WORKFLOW's "physical corners of the artwork", and the tests pin the behaviour without an ADR.

The record itself is stale. Five of the ten documents still say "not merged", "draft PR" or "open" for work merged weeks ago. The 10-20 audits list Marlin `G92.1` (CS-05) as open, but #923 fixed it on 2026-09-26.

The wrong 09-25 claim that Marlin "clamps S12000 to full output" did not change any ADR. It did leave the S value out of the CN-1 export advisory. On a PWM255 build, S wraps, so S10000 would run at 6 %.

## Inventory of the older audits (step 1)

PR merge times are from `gh pr view`.

| Audit | Fixed (claimed → PR / ADR) | Open, deferred or follow-up (claimed) | Accepted or "by design" |
|---|---|---|---|
| **2026-09-25 controller full** | All 73 findings. That is 2 Critical, 10 High, 32 Medium and 29 Low across the GP, ST, TC, HF, CG, MA, SM, RU, OR and CN tracks. Fixed in PR #923, merged 2026-09-26 (`eaf62efe2`), under ADR-393 to ADR-400. GP-7 was merged into ST-4, CG-8 into HF-5, and CG-6 was dropped | Hardware checks for "Decisions to review" items 1, 2 and 4, and for HF-1. "Plausible on hardware": TC-3, HF-1, HF-8 (Falcon), RU-1 to RU-5 (effect), OR-4 and MA-10. RU-2's `D8 11` mapping is unverified upstream | ADR-398: the 4040 G-code changes and restarts may repeat work. ADR-395: M410 may slip. ADR-397: Smoothieware without its Laser module runs with the laser off. ADR-400: Disconnect and Home timing. OR-4: xTool keeps `$J=`. CN-3: a Ruida tiled save writes GRBL tiles. ADR-396: a Marlin G92 set before connect is invisible |
| **2026-10-16 pipeline** | F1, F2, F3 (P1) and F4 (P2). The doc says "repaired on branch, not merged". They merged in #1212 on 2026-10-15T20:02Z | Device qualification for each family | No universal physical stop deadline is promised |
| **2026-10-16 reconnect** | 9 faults: connecting fence, bounded shutdown, close admission, Marlin and Smoothieware Disconnect refill, Marlin Abort refill, ownership on disconnect, setting-write proofs, the suppression leak, and the inch/mm WCO. Merged in #1215 on 2026-10-15T21:29Z | Hardware qualification | USB identity, rapid replug, host close deadline, firmware acting on a reset, firmware persistence |
| **2026-10-19 behaviour** | F-1, F-2 and F-3 by #1294 (ADR-639). F-5 and F-9 later by #1328 (ADR-611 Amd 2), which the doc does not record | F-4 (Medium), F-6 (Medium, needs an ADR-212 decision), F-7 (Medium), F-8 (Low), F-10 (Low, verify) | — |
| **2026-10-20 design** | D-5 by #1333 (ADR-648), which the doc does not record | D-1 (High, maintainer decision), D-2, D-3, D-4, D-6 and D-7. Its §4 carries F-4 to F-10, P-2, P-3, P-4, CS-02, CS-04 and CS-05 | The corrections of 2026-10-22 in its header |
| **2026-10-20 protocol** | P-1, P-5 and P-6 by #1315 (ADR-644), which the doc does not record | P-2 (policy), P-3 and P-4. Carried from July: CS-02, CS-04 and CS-05 | — |
| **2026-09-24 CNC full** | Fixed in PR: TP-2, FS-8, GC-1, GC-2 and AC-1 (#898, merged 2026-09-24T23:33Z). MC-3 by ADR-215 Amd 1. The 09-29 recheck adds as fixed on main: JR-1, JR-2, TP-4, AC-9, MC-1 and MC-7; and AC-7 by #1019 | Partly fixed at 09-29: JR-3, JR-4, TP-1, FS-1, FS-4, GC-3, AC-3, MC-4, MC-6 and CO-1. Still open at 09-29 (28): JR-5 to JR-9, TP-3, TP-5, FS-2, FS-3, FS-5, FS-6, FS-7, FS-9, AC-2, AC-4, AC-5, AC-6, AC-8, MC-2, MC-5, CO-2 to CO-5, PV-1 to PV-4 | FS-2 left as set (ADR-256). CO-5 deferred by design |
| **2026-09-27 CNC gap** | CW-01 and CW-02 by ADR-491, ADR-154 Amd 3, ADR-520 and ADR-489 (at 09-29) | CW-03 to CW-06 open. CW-07 partly fixed. The CNG-* gaps are feature requests | Maintainer decisions: post-processors, T/M6, inch entry, custom start/end G-code, running outside G-code, G55–G59 |
| **2026-09-29 CNC second pass** | P2-toolpath-1, P2-toolpath-2, P2-toolpath-4, P2-relief-rough-1, P2-gcode-1, P2-preview-1, P2-review-1, P2-review-2, P2-review-4 and AC-7, all by #1019 (merged 2026-09-29T10:17Z). WA-6 later by #1354 (the doc records this) | P2-relief-finish-1 partly fixed. Open (18): P2-review-3, P2-toolpath-3, P2-relief-rough-2, P2-relief-rough-3, P2-relief-finish-2, P2-relief-finish-3, P2-relief-finish-4, P2-control-1, P2-preview-2, P2-preview-3, WA-1, WA-3, WA-4, WA-6, WA-7, P2-gcode-2, P2-advcam-1, P2-advcam-3. Follow-ups: P2-control-1 (ADR-491 Amd 1 item 3) and a Machine Setup park-height field limit | Tabs at half the stock (ADR-258 Amd 4). "No program end" note kept |
| **2026-10-09 released CNC output** | 1 P1, 7 P2 and 1 P3. The doc says "this candidate has not been merged". They merged in #1109 on 2026-10-08T23:10Z | Arc and helix stock sweeps, concave mating, lead/ramp combinations, retained masks and rail footprints are listed as needing qualification | — |

## Sampled items

**Severity now** applies the clarified §3 to the product defect. When a later round covered the item, its finding ID is given.

| # | Audit · ID (orig.) | Claimed | Current on `79720dd5c` (evidence) | Tracked? | Severity now |
|---|---|---|---|---|---|
| 1 | 09-25 · MA-7 (Critical) | Fixed #923 | **Holds.** `MARLIN_QUICK_STOP_LINES` is M107, M410, M5 I (`marlin/commands.ts:39-43`), used by `laser-quick-stop.ts:34`. `laser-job-stop.marlin`, `laser-quick-stop` and `marlin-driver` tests pass | n/a | P1 class, no regression |
| 2 | 09-25 · MA-1 (Critical) | Fixed #923 | **Holds.** `planStreamPauseBeam` is on the Marlin driver (`marlin/driver.ts:108`). Both pause-beam tests pass | n/a | no regression |
| 3 | 09-25 · OR-1 (High) | Fixed #923 (ADR-398) | **Holds.** Both `m3-lit-drain` tests pass. Later variants were found and fixed by rolling-v2 03-P2-1/P2-2 (#1342) and #1353 | n/a | no regression |
| 4 | 09-25 · GP-2 (High) | Fixed #923 (ADR-393) | **Holds.** `controller-reset-required.test.ts` passes | n/a | no regression |
| 5 | 09-25 · HF-7 (High) | Fixed #923 (ADR-400) | **Holds.** `laser-parser-rearm.test.ts` passes | n/a | no regression |
| 6 | 09-25 · CG-12 (High) | Fixed #923 | **Holds.** `use-job-shortcuts.test.ts` passes | n/a | no regression |
| 7 | 09-25 · SM-1 (High) | Fixed #923 | **Holds.** `laser-status-smoothie-offset.test.ts` passes | n/a | no regression |
| 8 | 09-25 · GP-3 (Medium) | Fixed #923 | **Holds**, variant included. The Console refuses `!`, `~` and `?` inside a line (`grbl/console-command.ts:44-55`). Every user label in a job comment folds them to `_` (`core/gcode-comments.ts:89`) | n/a | no regression |
| 9 | 09-25 · CG-11 (Medium) | Fixed #923 (ADR-396) | **Holds for the action.** Marlin's Reset origin sends a G92 machine-frame restore (`laser-origin-actions.ts:183-186, 203-222`). `marlin-origin-model.test.ts:172-178` passes. The UI copy still says `G92.1` (see M7-P3-3) | n/a | P3 copy drift |
| 10 | 10-16 · F1 (P1) | "Not merged" | **Merged #1212, holds.** `laser-job-stop-write-race.test.ts` passes | stale doc | no regression |
| 11 | 10-16 · F2 (P1) | "Not merged" | **Merged #1212, holds.** `laser-marlin-error-ack-ownership.test.ts` passes | stale doc | no regression |
| 12 | 10-16 · F3 (P1) | "Not merged" | **Merged #1212, holds.** `web-serial-line-errors` and `serial-worker-core` tests pass | stale doc | no regression |
| 13 | 10-19 · F-3 (High) | Fixed #1294 | **Holds.** `laser-store-helpers` and `SafetyNoticeBanner` tests pass | n/a | no regression |
| 14 | 10-20 · P-1 (Medium) | Open in its doc; fixed #1315 | **Holds.** `eeprom-write-line` and `streamer` tests pass. The worker refill uses the same streamer module (`serial-worker-core.ts:28, 242`), so it gets the same rule | ADR-644 | no regression |
| 15 | 10-20 · P-5 (Low) | Fixed #1315 | **Holds.** `checkpoint-interruption.test.ts` passes | ADR-644 | no regression |
| 16 | 09-24 · MC-1 (Critical) and JR-1 (High) | Fixed on main (ADR-180 Amd 5/6) | **Holds.** A router with `$32=1` gets the readiness error `laser-mode-enabled` (`controller-readiness.ts:186-187`), with the one-click `$32=0`. `controller-readiness`, `JobReviewWarnings` and `JobRunControls.cnc-resume` tests pass | n/a | no regression |
| 17 | 09-24 · GC-1 (Medium) | Fixed #898 | **Holds.** Variant: a pocket in an 8 mm radius circle with helical entry gives 18 arcs, none a full circle, with the largest sweep 180.0° (`out.txt`) | n/a | no regression |
| 18 | 09-24 · JR-2 (High) | Fixed on main (09-29) | **Holds for its scenario.** A 3.0 mm hole under a 3.175 mm bit warns. A hole smaller than half the bit is still dropped silently. That is M6-P2-2 (F7-P2-3), already reported | M6-P2-2 | KNOWN |
| 19 | 09-29 · P2-toolpath-2 (High) | Fixed #1019 (ADR-258 Amd 4) | **Holds.** Variants: stock 2 with a 2 mm tab cuts the tab top at Z-1. Stock 3 with a 3 or a 4 mm tab cuts it at Z-1.5 (`out.txt`) | n/a | no regression |
| 20 | 10-09 · relief vector exclusion (P1) | "Not merged" | **Merged #1109, holds.** `relief-authoring-emission-boundary` and `relief-vector-footprint` tests pass | stale doc | no regression |
| 21 | 09-24 · MC-2 (High) | Still open (09-29: "Fix these next" #1) | **Still open.** The first seek is `G38.2 Z-25.000 F150` (`grbl/probe.ts:74,119`). No production code reads `pins.probe` | **No** | **P2** → M7-P2-1 |
| 22 | 09-24 · CO-3 (Medium) | Still open | **Still open.** Repro: the artwork corner lands at (3.175, 3.175) for a 1/8" outside profile, and at (6.350, 6.350) for a 0.5 mm engraving with the 12.7 mm V-bit | **No** | **P2** → M7-P2-3 |
| 23 | 09-24 · CO-2 (Medium) | Still open | **Still open.** The label is "Machine origin corner" (`DeviceProfileFields.tsx:36`). The comment says machine zero "sits at the homing corner" (`origin-transform.ts:9`). CNC Job Review has no warning | KNOWN only (E3-K-4, the surfacing half) | **P2** → M7-P2-4 (refuter: P3) |
| 24 | 09-29 · P2-toolpath-3 (Medium) | Open | **Still open.** Repro: 0 cutting moves on the stacked copies, while the control shape is cut to Z-3. No preflight issue and no Job Review warning | **No** | **P2** → M7-P2-2 |
| 25 | 09-29 · P2-relief-rough-3 (Medium) | Open | **Still open.** Repro: 8 cutting moves reach 2.175 mm into the neighbour at Z-1.5 and Z-3. No warning | **No**. KNOWN only: rolling-v2 16 K-2, and a CNC v1 F6 note (refuter) | **P1** → M7-P1-1 |
| 26 | 09-29 · P2-control-1 (Medium) | Open; follow-up | **Still open.** Repro: `G0 Z50.000`, and `detectCncZTravelWarnings` returns `[]` (`cnc-z-travel-warnings.ts:32`). No code compares the lift with the live WCO | ADR-491 Amd 1 item 3 (follow-up); F7 KNOWN | **P1** → M7-P1-2 (refuter: P2, KNOWN) |
| 27 | 09-29 · P2-preview-2 (Medium) | Open | **Still open.** The CNC end move is drawn to program 0,0 (`draw-preview.ts:286`). `retractBetweenPasses` is read only at `job.ts:411`, never by the preview | KNOWN only (E3-K-3; M6 handed it to M7) | **P2** → M7-P2-5 |
| 28 | 09-29 · P2-review-3 (Medium) | Open | **Still open.** Quick Nest spacing starts at `'2'` in every mode (`QuickNestDialog.tsx:38`). Job Review warns after the nest | KNOWN only (M1-P2-2, M6, F3) | P2 (as M1) → M7-P2-5 |
| 29 | 09-29 · P2-relief-finish-3 (Medium) | Open | **Fixed** by #1136 (ADR-580). STL imports land at the model's own size (`stl-import-action.ts:1-6`, `stl-import-size.ts`) | stale doc | — (M7-P3-1) |
| 30 | 09-29 · WA-4 (Medium) | Open | **Fixed** by #1368 and #1384 (ADR-630 Amd 2, `render-model-arc.ts:1-7`). The rolling-v2 LEDGER 26-K1 row records it | stale doc | — (M7-P3-1) |
| 31 | 10-19 · F-4 (Medium) | Open | **Still open.** The automatic read needs Idle (`machine-settings-read-readiness.ts:54-56`). An Alarm boot reads "Controller reset detected…" (`controller-notice.tsx:193-194`) | ADR-648 Consequences ("stays open"); no fix card | P3 (M7-P3-4) |
| 32 | 10-19 · F-7 (Medium) | Open | **Still open.** One owed reply makes the app recommend Reconnect (`controller-recovery-status.ts:46`) | **No** | P3 (M7-P3-4) |
| 33 | 10-20 · CS-04 | Open | **Still open.** M114 is reported as `Idle` (`marlin/response.ts:118-130`). The code comment says motion first waits for an M400 marker | **No** (code comment only) | P3 (M7-P3-4) |
| 34 | 10-20 · CS-05 | Open | **Fixed** on 2026-09-26 by #923 (CG-11). `clearOrigin: 'G92.1'` (`marlin/driver.ts:81`) has no production reader for Marlin | contradiction | P3 → M7-P3-3 |
| 35 | 10-20 · D-1 (High, decision) | Open | **Still open.** An owned Abort on GRBL-family resets at once (`laser-job-stop.ts:258`). No ADR records a decision | **No** | P3 (M7-P3-4) |
| 36 | 10-20 · D-4 / P-4 | Open | **Still open.** grblHAL `buildInfoQuery: null` (`grblhal/driver.ts:87`). Nothing sends `0x87` | ADR-375 Amd 4 note | P3 |
| 37 | 09-25 CN track · "PWM255 clamps S12000 to full output" | Claim | **Wrong.** S wraps (E1 refuter, ADR-567 Amd 2 item 6). It narrowed the CN-1 export advisory | contradiction | P3 → M7-P3-2 |

## Findings

### M7-P1-1 — 2026-09-29 P2-relief-rough-3 is still open and untracked: a relief's roughing cuts up to one bit radius into a neighbouring relief on the same layer, silently

- **Corrects:** 2026-09-29 CNC second pass, P2-relief-rough-3 (Medium, Open).
  - No later round, ledger, ADR or PR names it.
  - F6 (relief) lists P2-relief-finish-1 and -2 as KNOWN, but not this.
  - **Kind:** record omission, and a wrong severity (P1 by effect under §3).
- **Where:**
  - `src/core/cnc/compile-cnc-relief.ts:99` plans each relief alone (`for (const relief of reliefs)`).
  - `src/core/relief/heightmap-tool-offset.ts:14`: "Out-of-bounds neighbors are ignored (treated as bottomless)".
- **Anchor:**
  - Contract: what is drawn is cut. No ADR accepts one relief cutting another (DECISIONS.md and `docs/decisions` searched for neighbour and multi-relief rules: none).
  - Twin: the same relief alone on the stock stops at its own design surface.
- **Scenario:**
  - Two 24 × 24 mm reliefs on one layer, 1 mm apart.
  - The left one is a 3 mm deep floor. The right one stays at the stock top: a border or plaque meant to be kept.
  - 1/4" end mill, 1.5 mm per pass.
  - The left relief's outer ring rides its own edge. The cutter reaches 3.175 mm past the edge, so it cuts 2.175 mm into the right relief at Z-1.5 and Z-3.
  - Job Review, preflight and the CNC job warnings say nothing. Those warnings include `detectCncReliefPlanningWarnings` and `detectCncZTravelWarnings`.
- **Evidence:** **REPRO.**
  - `zz-m7-cnc.test.ts`, "P2-relief-rough-3":
    ```
    cutting moves 68, tool reach past the neighbour's edge X125: 8 moves, deepest 2.175 mm, at Z [-1.5,-3]
    review ["job Layer L1 uses the generic starter feeds …"]
    ```
  - The 09-29 audit reproduced the same mechanism with a 3 mm raised border: 684 gouge samples.
- **Why P1:** material that is drawn to stay is cut to full depth, silently. The output is wrong in depth and position.
  - §3 has no reach clause, and no warning reaches the operator.
  - M6-P1-1 (a laser lead burning into an unselected neighbour) was rated P1 on the same reasoning.
  - This is not M6-P2-3's case, which the M6 refuter kept at P2. There, two profiles 2.5 mm apart cannot be cut as drawn with that bit, and each contour runs exactly where drawn.
    - Here the overreach is added by KerfDesk: the bottomless-edge rule (`heightmap-tool-offset.ts:14`) lets the cutter run a full radius past the relief's own footprint.
    - Treating the neighbour's footprint as uncuttable would cut both reliefs as drawn, leaving only the usual corner radius at the floor edge.
- **Refuter:** **CONFIRMED. P1 stands.**
  - **Independent repro** (`zz-m7r-relief.test.ts`). A flat end-mill disk was swept along every move in 0.05 mm steps.
    - The tool centres run X 100.000–124.000, which is to the relief's own edge.
    - The cutter reaches 2.175 mm into the neighbour 1 mm away, at Z-1.5 and Z-3 (1,140 swept samples).
    - With default settings (0.5 mm allowance) the reach is still 2.175 mm, at Z-1.5 and Z-2.5.
    - With a 4 mm gap the reach is 0.
    - Preflight, advisories and every detector in `detectMachineJobWarnings` give only the starter-feed note.
  - **Why it cannot be lowered under §3.** Drawn work is cut at depth, and no warning reaches the operator.
    - The design can be cut as drawn. A flat end mill holds the left relief's wall at X124 with its centre at X120.825.
    - So this is not M6-P2-3's case.
  - **Record correction: later rounds did name it.** The finding's "No later round … names it" is wrong.
    - Rolling-v2 16 K-2 re-filed it as KNOWN. That was READ only, not re-run, and rated P2.
    - CNC v1 F6 named "the reliefs-on-one-layer class (16 K-2)" under Refuted.
    - F6's Verified clean also calls the overreach "the documented bottomless-edge rule". The rule is documented only in a code comment (`heightmap-tool-offset.ts:14`). ADR-289 item 7 and ADR-294 item 8 list edge behaviour only as uncertified qualification debt.
    - By M7's own standard it is still untracked: no PR, fix card, ledger row or ADR follow-up. PR searches for relief neighbour, edge, spacing, combined, bottomless and "relief-rough-3" found nothing.
    - This finding therefore also corrects 16 K-2's P2.
  - **Record correction: the scope is wider than one layer.** With the two reliefs on two operations, the gouge is identical (2.175 mm at Z-1.5 and Z-3).
    - So planning one layer's reliefs together would not fix it.
    - The fix must keep the cutter off other drawn work across operations, or warn. That covers other reliefs and, by the same edge rule, vector parts.
  - **Record correction: the twin is misstated.** Alone, the relief also cuts 3.175 mm past its own footprint into bare stock, under the same rule.
    - It does not stop at its footprint.
    - The neighbour case is wrong output because the overreach lands on drawn work.
- **Fix direction:** plan a layer's reliefs against the maximum of their height fields, or treat other reliefs' footprints as uncuttable. At the least, warn in Job Review when two reliefs on one layer are closer than the roughing bit's radius.

### M7-P1-2 — 2026-09-29 P2-control-1 is parked as an ADR follow-up with no owner: on a homed router a park height that fits the Z travel still lifts Z above its top, silently

- **Corrects:** 2026-09-29 P2-control-1 (Medium, Open).
  - ADR-491 Amendment 1 item 3 says the live work-offset check "remain[s] recorded follow-ups". No PR or fix card followed in four weeks.
  - CNC v1 F7 re-observed the mechanism as KNOWN under "09-24 JR-3": "never compared with a known work offset". F7 did not raise it or rate it.
  - **Kind:** record omission (deferred without an owner), and a wrong severity (P1 by effect under §3).
- **Where:**
  - `src/ui/laser/cnc-z-travel-warnings.ts:17-32` compares only the span (deepest cut plus lift) with the travel.
  - `src/ui/laser/job-review/job-review-park-label.ts:34-43` compares only the park height with the travel.
  - `src/core/output/cnc-grbl-transitions.ts:40-45`: the park height has no upper bound.
- **Anchor:**
  - Contract: ADR-491 Amd 1 (the Z range must fit the travel). It deferred the live half.
  - Ground truth: GRBL `$23=0` homes Z to the top, and soft and hard limits are off by default. The 09-29 report cites `system.c` and `limits.c`, and the GRBL wiki "Set up the Homing Cycle".
- **Scenario:**
  - A homed router with a 75 mm Z travel and park height 50.
  - The stock top is zeroed 40 mm below the homed top, so WCO Z is -40.
  - At every bit change and at the job end the program sends `G0 Z50.000`, which is machine Z +10.
  - With limits off, Z stalls on its stop and loses steps, so every later cut runs deeper. With soft limits on, GRBL alarms mid-job when it reads the line.
  - KerfDesk holds both numbers it needs: the confirmed Home and the live WCO. It warns about neither.
- **Evidence:** **REPRO** (missing warning) + **SOURCE** (firmware behaviour, from the 09-29 report).
  - `zz-m7-cnc.test.ts`, "P2-control-1":
    ```
    lifts ["G0 Z3.810","G0 Z-1.000","G0 Z-3.000","G0 Z50.000"]
    detectCncZTravelWarnings [] | review []
    ```
  - **READ:** no CNC warning reads `wcoCache` or `mPos` for Z (`git grep` over `src/ui/laser` and `src/core/preflight`).
- **Why P1:** the depth error is silent, and the Z stall comes from KerfDesk's own command. E3-P2-2 (a park beyond the bed end) was raised to P1 by M4 for the same kind of overrun.
- **Refuter:** **KNOWN. P1 is refuted; this is P2.**
  - **The repro holds** (`zz-m7r-park.test.ts`).
    - One-bit and two-bit jobs lift `G0 Z50.000` at the bit change and at the job end.
    - With a live snapshot ($132 = 75, homing on, $20 and $21 off), `detectMachineJobWarnings` and preflight are empty.
    - Job Review's park row reads "50 mm above stock top · job end and bit changes" in the default tone.
  - **It is tracked, by this report's own definition.** ADR-491 Amd 1 item 3 names "second audit P2-control-1" as a "recorded follow-up". This report's Counts already list it as ADR-tracked, and F7 re-filed it as KNOWN under 09-24 JR-3. The real gap is that the follow-up has no owner, which belongs to the ledger proposed in M7-P3-1.
  - **It is not P1 under §3, because the output is not wrong.**
    - The program lifts to exactly the park height the operator entered.
    - ADR-491 item 3 left that value to the operator on purpose: "only the operator can say how much room the machine has". The same item names the stall and next-job risk.
    - Job Review states the height in millimetres above the stock top.
    - What is missing is a sanity check on an operator value. That is the class of P2-gcode-1 (a 120 mm park on 75 mm of travel), which was rated Medium and fixed with a warning, and of M6-P2-3, which was kept at P2.
    - E3-P2-2 is different. There, KerfDesk wrote a valid bed park into the wrong frame.
  - **Firmware, read at gnea/grbl @bfb67f0c:**
    - With $20=1, `motion_control.c:36-38` checks every non-jog target.
    - On a violation, `limits.c:411-428` feed-holds the running cut "so position is not lost", then resets and raises the soft-limit alarm. That is a refused move with an alarm, not a crash, although the last buffered cuts before the lift stay uncut.
    - With $21=1, the top switch trips ALARM:1.
    - Both of these are loud. Only with both limits off, which is the default (`defaults.h:56-57`), does Z stall.
  - **"Every later cut runs deeper" is wrong inside the job.**
    - A tool-change hold voids the Work-Z evidence (`tool-change-hold-entry.ts:35-37`).
    - Continue then requires a fresh Zero Z (`laser-store-helpers.ts:140-156`), which re-zeroes against the stalled position.
    - Only a job-end stall carries over. The Work-Z evidence survives a finished job (`cnc-start-advisories.ts:35`), so the next Start with the same bit that reuses the zero cuts deeper by the lost steps.
  - **Twin for the fix:** manual jogs are already held inside the homed envelope (`manual-motion-limits.ts`). Job lifts are not.
- **Fix direction:** when Home is confirmed and a WCO is live, warn in Job Review if WCO Z plus the park height (or the highest safe Z) exceeds machine Z 0. Give the amount and the largest height that fits. Add the Machine Setup park-height limit from the same follow-up.

### M7-P2-1 — 2026-09-24 MC-2 is still open and untracked: touch-off never checks the probe circuit, so a forgotten clip drives the bit into the plate

- **Corrects:** 2026-09-24 CNC MC-2 (High, "Still open"). The 09-29 pass confirmed it and ranked it first in "Fix these next".
  - Since then no PR, fix card, ledger row or ADR names it.
  - Controller v2 C2 (probing) did not list it among its KNOWN items.
  - **Kind:** record omission.
- **Where:**
  - `src/core/controllers/grbl/probe.ts:72-74` (seek 150 mm/min, 25 mm travel) and `:119` (the first `G38.2`).
  - `status-parser.ts:288` decodes `pins.probe`, and no production file reads it (`git grep "pins?.probe"` outside tests: nothing).
  - The only pin reader, `ControllerPinNotice.tsx`, shows E-stop and motor fault.
- **Anchor:**
  - Ground truth: GRBL alarms only at the end of travel (ALARM:5).
  - Peer senders ask for a continuity touch before the seek. The 09-24 report cites this. It was not re-fetched here.
  - Twin: the app already decodes `Pn:P` and shows other pins.
- **Scenario:** the operator forgets the clip and presses Probe Z. GRBL seeks 25 mm down at 150 mm/min. The bit reaches the plate and keeps driving into it until the end of travel. The result can be lost steps, a damaged plate or a broken bit. Nothing asks for a test touch, and nothing shows the probe input.
- **Evidence:** **READ** on `79720dd5c`, with the line citations above. The 09-29 recheck saw the same code: "Still seeks `G38.2 Z-25.000 F150` blind; `Pn:P` is parsed but no screen reads it".
- **Severity:** P2. It is ordinary operator behaviour with a damaging result. It is not P1: the move is the one the operator asked for, and no output is silently wrong.
- **Refuter:** **CONFIRMED, P2.**
  - **The seek is unchanged.** `probe.ts:72-74` and `:113-120` still seek 25 mm at F150.
  - **The probe pin is decoded but never read.** `status-parser.ts:288` decodes `probe`. The only production readers of `pins` are E-stop and motor fault (`ControllerPinNotice.tsx:10-11`), door (`LiveMotionBar.tsx:200`) and the limit axes (`laser-alarm-line.ts:142-144`).
  - **The only safeguard is a hint:** "clip the probe lead to the bit" (`ProbeControls.tsx:179`).
  - **It is untracked.** C2's KNOWN table (six rows) does not list it. PR searches for probe continuity, test touch, probe clip, probe pin and MC-2 found nothing.
  - **It is P2, not P1.** The seek is the move the operator asked for. A stall on the plate is re-zeroed by the next good probe, so no later output is silently wrong.
- **Fix direction:** before the seek, show the live probe input and require one test touch (`Pn:P` seen, then cleared). Refuse to seek while `Pn:P` is already closed.

### M7-P2-2 — 2026-09-29 P2-toolpath-3 is still open and untracked: a closed shape stacked on its exact copy is not cut, and the stacked-copy warning skips CNC

- **Corrects:** 2026-09-29 P2-toolpath-3 (Medium, Open).
  - No later round, ledger or PR names it.
  - **Kind:** record omission, plus a twin gap.
- **Where:**
  - `src/core/geometry/kerf-offset.ts:64` fills closed shapes even-odd, so two copies cancel.
  - `src/ui/laser/stacked-copy-warnings.ts:35` returns `[]` for CNC: `if (project.machine?.kind === 'cnc') return [];`.
- **Anchor:**
  - Twin: ADR-359 item 5 warns about stacked copies for laser output.
  - Contract: ADR-433's narrow-feature check merges exact copies on purpose, so it stays silent too.
- **Scenario:** Duplicate without moving, a second import, or an SVG with doubled paths puts two identical closed rectangles on a 3 mm Outside-profile or Pocket layer, next to a third shape. The pair is never cut. The job runs normally and leaves the part in the sheet.
- **Evidence:** **REPRO.** `zz-m7-cnc.test.ts`, "P2-toolpath-3":
  ```
  profile-outside: cutting moves near A(dup)=0 near B=36 deepest B=-3 | review [starter-feed note only]
  pocket:          cutting moves near A(dup)=0 near B=84 deepest B=-3 | review [starter-feed note only]
  ```
- **Severity:** P2. It is a silent omission, like 21-P2-3, F5-P2-3 and M6-P2-2. The part is left uncut, not cut wrong.
- **Refuter:** **CONFIRMED, P2.**
  - **Independent repro** (`zz-m7r-p2.test.ts`). The stacked pair gets 0 cutting moves while the control shape is cut, with Outside profile and with Pocket. This holds both as two objects and as one SVG with a doubled path. Advisories are empty, and the only warning is the starter-feed note.
  - **It is untracked.** PR searches for stacked copies, duplicate shapes and toolpath-3 found nothing.
  - **Correction to the twin and the fix direction.**
    - `stackedCopyWarnings` keys only raster and traced images (`stacked-copy-warnings.ts:65-77`).
    - Removing its CNC early return would still never see two vector outlines.
    - The fix needs a vector key, such as the `StackedOutlines` key the 09-29 report named.
- **Fix direction:** drop exact stacked copies before the CNC even-odd step (`StackedOutlines` key). Or extend the stacked-copy warning to CNC operations with "N shapes are stacked copies and will not be cut".

### M7-P2-3 — 2026-09-24 CO-3 is still open and untracked: CNC Job Origin anchors on the cutter's reach, not the artwork, against WORKFLOW's own rule

- **Corrects:** 2026-09-24 CO-3 (Medium, "Still open" at 09-29). Its fix was "pick one rule and document it".
  - No ADR picked one.
  - `coordinate-origin-audit.test.ts:132` now pins the reach anchor: `sceneAnchor(anchor, radius)`.
  - No later round or ledger names CO-3.
  - **Kind:** record omission, and a contradiction (WORKFLOW and code comment against code and test).
- **Where:**
  - `src/core/job/job-bounds.ts:171-173` widens each CNC group by `toolDiameterMm / 2` on every side.
  - The placement bounds (`computeJobPlacementBounds`, `:51-53`) and Frame use these bounds.
  - `src/core/job/job-origin.ts:138` says the anchors "name PHYSICAL corners of the artwork".
- **Anchor:**
  - Contract: WORKFLOW.md:4659 ("the nine anchors name physical corners of the artwork as drawn on the canvas, on every machine origin — ADR-327"); WORKFLOW F-B13c item 2, as ADR-052 Amd 1 quotes it.
  - Ground truth: LightBurn's job origin is "the smallest possible rectangle that can fully contain all graphics", as quoted in ADR-052 Amd 1.
- **Scenario:** User Origin, Front-left anchor, zero set on the board corner.
  - A 1/8" Outside profile puts the artwork corner at (3.175, 3.175).
  - An On-path cut puts it at (1.588, 1.588).
  - A 0.5 mm deep engraving with the 12.7 mm 90° V-bit puts it at (6.350, 6.350), although that cut is only about 1 mm wide.
  - Frame traces the same widened box, so nothing tells the operator the artwork is set in.
- **Evidence:** **REPRO.** `zz-m7-cnc.test.ts`, "CO-3". The tool-centre minimum is shown; the artwork corner is that minimum plus the radius for Outside.
  ```
  outside 1/8in:       tool-centre min (1.588, 1.587)
  on-path 1/8in:       tool-centre min (1.588, 1.587)
  engrave vb-90 0.5mm: tool-centre min (6.350, 6.350)
  ```
- **Severity:** P2. It breaks a contract with a clear scenario. It stays below P1 only because Frame traces where the cutter goes. A refuter may argue P1 for the V-bit case, where the Frame box is 6.35 mm wider than the engraving.
- **Refuter:** **CONFIRMED, P2.**
  - **Independent repro** (`zz-m7r-p2.test.ts`), at User Origin with the Front-left anchor:
    - A vb-60 engraving 0.5 mm deep has its tool-centre minimum at (3.175, 3.175). A vb-90 one has it at (6.350, 6.350).
    - For a 50 mm design, the Frame bounds before placement span 0–56.35 and 0–62.70.
    - No warning names the inset.
  - **The rule was never decided.** The reach anchor has been pinned by `coordinate-origin-audit.test.ts` since #832 (2026-09-22). No ADR chose it: searching the ADRs for cutter-radius bounds finds none. PR searches found nothing for CO-3.
  - **It stays P2.** No contract says which corner an anchor names for CNC: WORKFLOW:4659 and `job-origin.ts:138` say the artwork, while the #832 test says the reach. The closest precedent, D8-P2-1 (a placement anchor silently moved 0.3 mm, with an unchanged Frame envelope), stayed P2 after M3.
  - **Note for the ADR.** The V-bit inset uses the bit's full body radius (`job-bounds.ts:171`), not its cut width at depth. So it is wrong under either rule, by 5.85 mm for the vb-90 case. The auditor's reason for P2, that Frame traces where the cutter goes, does not hold for V-bits.
- **Fix direction:** decide in an ADR. One option anchors on the artwork (or the stock rectangle) and shows in Job Review how far the cutter reaches past zero. The other keeps the reach anchor and uses a V-bit's cut width at depth. Either way, update WORKFLOW:4659 and `job-origin.ts:138` to match.

### M7-P2-4 — 2026-09-24 CO-2 is still open: on a CNC profile the origin picker still invites the homing corner, which mirrors or turns the part, and Job Review says nothing

- **Corrects:** 2026-09-24 CO-2 (Medium, "Still open" at 09-29).
  - Controller v4 E3 filed only its surfacing half as KNOWN (E3-K-4, P3).
  - Nothing tracks the label, the comment or the Job Review warning the fix asked for.
  - **Kind:** record omission.
- **Where:**
  - `src/ui/laser/DeviceProfileFields.tsx:36` labels the picker "Machine origin corner".
  - `src/core/devices/origin-transform.ts:9`: "Machine origin (0, 0) sits at the homing corner."
  - The corner probe (`grbl/probe.ts`) and surfacing assume Front-left.
- **Anchor:**
  - Ground truth: LightBurn, "The Origin for GCode devices … is typically in the front left corner, regardless of where limit switches are installed" (cited by 09-24).
  - GRBL's default `$23=0` homes to the rear right.
- **Scenario:** a GRBL router owner whose machine homes at the rear right picks "Rear right", as the label and comment suggest. Every CNC part comes out turned 180°, and Front right or Rear left mirror it. Frame shows only a displaced box. Job Review has no CNC note for a non-standard layout.
- **Evidence:** **READ** (lines above). `coordinate-origin-audit.test.ts` (`describe.each([false, true])`) pins the same mirror matrix for CNC as for laser.
- **Severity:** P2. A misleading label leads to wrong output. It is not P1, because the output matches the layout the operator chose, as in LightBurn.
- **Refuter:** **CONFIRMED as open and untracked. Severity lowered from P2 to P3.**
  - **What the operator sees is not what the finding describes.**
    - The visible row label is "Origin". "Machine origin corner" is only the aria-label.
    - The tooltip says the picker "Sets the canvas-to-machine coordinate orientation and jog directions … does not set work zero or change homing settings" (`DeviceProfileFields.tsx:36-37`, unchanged since #832, which predates the 09-24 audit).
    - The homing corner has its own "Recorded home" picker (`DeviceSetupConfirmStep.tsx:57`).
  - **A wrong pick shows before any cut.**
    - Rear right reverses both jog arrows (`jog-direction.ts:26-27`).
    - The Frame that every placement mode requires traces a displaced box. At User Origin it runs off the board, as the 09-24 evidence itself records.
  - **What remains is doc drift (P3):** the developer comment (`origin-transform.ts:9`) and the missing CNC note. E3-K-4 (P3) covers the surfacing half.
- **Fix direction:** for CNC, describe Origin as an axis layout ("standard GRBL router: Front left, whatever the homing corner"). Correct the code comment, and add a Job Review note for a mirrored or turned CNC layout.

### M7-P2-5 — Two open 2026-09-29 P2s that later rounds re-filed only as KNOWN still have no fix card: P2-preview-2 and P2-review-3

- **Corrects:**
  - 2026-09-29 P2-preview-2 (Medium). It was re-filed as E3-K-3 (P2) and handed by M6 to M7.
  - 2026-09-29 P2-review-3 (Medium). It was mentioned by M1-P2-2, M6 and F3. M1 suggested routing it to F7, and F7 did not take it.
  - **Kind:** record omission (M2-P3-5 standard: KNOWN re-filing is not tracking).
- **Where:**
  - P2-preview-2: `src/ui/workspace/draw-preview.ts:286` (`if (project.machine?.kind === 'cnc') return finishPosition ?? { x: 0, y: 0 };`). `retractBetweenPasses` is declared at `src/core/job/job.ts:411` and read by no preview or toolpath builder (`git grep`).
  - P2-review-3: `src/ui/commands/QuickNestDialog.tsx:38` (`padding: '2'` in every machine mode).
- **Anchor:**
  - P2-preview-2: ADR-392 says the preview reads the same placed park. Twin: the emitted program and Job Review's "Park after job" row.
  - P2-review-3: ADR-433. The nest makes parts the bit cannot separate.
- **Scenario:**
  - P2-preview-2: the preview and the 3D view draw the job end as a rapid at the stock top to program 0,0. The program lifts to the park height and goes to the bed park. Bit-change parks and per-pass retracts are not drawn.
  - P2-review-3: a CNC Quick Nest packs parts 2 mm apart, so a 1/8" bit merges the outlines and the parts come out joined. Job Review warns only after the nest.
- **Evidence:** **READ** on `79720dd5c` (lines above). Both mechanisms are unchanged since the 09-29 REPROs.
- **Severity:** P2 each. Both mislead with a visible result, and P2-review-3 does get a warning, so neither is P1.
- **Refuter:** **CONFIRMED, P2 each.**
  - **P2-preview-2 is unchanged.** For CNC, `draw-preview.ts:286` returns `finishPosition ?? {0,0}`. The emitter instead parks at `parkTarget(group, finish)`, where a configured park wins (`cnc-grbl-transitions.ts:31-36`).
  - **P2-review-3 is unchanged.** `QuickNestDialog.tsx:38` still has `padding: '2'`.
  - **Neither has a PR.** Searches for quick nest spacing and preview park found nothing.
  - **Another KNOWN-only re-filing:** F8 also re-filed P2-preview-2 as F8-K-2 (P2).
  - **Wording fix for the sample row 27.** "Read only at `job.ts:411`" is wrong. The emitter reads `retractBetweenPasses` (`cnc-grbl-strategy.ts:187`); only the preview ignores it.
- **Fix direction:** fix cards. Build the CNC preview's park and retract moves from `resolveJobParkTarget` and honour `retractBetweenPasses`. Default the CNC nest spacing to the largest output bit's diameter plus a margin.

### M7-P3-1 — Five of the ten older audits still record merged work as unmerged or open

- **Corrects** (kind: stale record):
  - **2026-10-16 pipeline.** It says "These changes are not yet merged or released". #1212 merged at 2026-10-15T20:02Z.
  - **2026-10-09 released CNC output.** It says "This candidate has not been merged". #1109 merged at 2026-10-08T23:10Z.
  - **2026-09-24 CNC full.**
    - Its header says "Fixes: Draft PR on claude/cnc-audit-te9azb". #898 merged at 2026-09-24T23:33Z.
    - Its 51 status tags were never updated, except MC-3. The 09-29 recheck table is the only current status.
  - **2026-09-29 CNC second pass.**
    - Its header says "Draft PR #1019", which merged at 2026-09-29T10:17Z.
    - It says P2-relief-finish-3 is "Open". #1136 (ADR-580) fixed it on 2026-10-10.
    - It says WA-4 is "Open". #1368 and #1384 fixed it on 2026-10-22. The rolling-v2 LEDGER 26-K1 row is right.
  - **2026-10-19 behaviour, and 2026-10-20 design and protocol.**
    - F-5 and F-9 (#1328, ADR-611 Amd 2) and D-5 (#1333, ADR-648) are not marked fixed.
    - The protocol audit does not record P-1, P-5 and P-6 as fixed (#1315). Only the design audit's header and ADR-644 do.
- **Root cause:** none of these audits has a LEDGER. The rolling rounds do.
  - Their IDs also collide: 10-19 F-1..F-10, 10-16 F1..F4, CNC v1 F1..F8, the 10-20 P-1..P-6 and ADR-375's P-1..P-4.
  - So a search by ID finds the wrong item.
- **Evidence:** `gh pr view` merge times (Inventory). **READ** of each document.
- **Severity:** P3.
- **Refuter:** **CONFIRMED.**
  - Every quoted string is present: 10-16 line 15, 10-09 line 47, 09-24 line 8 and 09-29 line 8.
  - Every merge time matches `gh pr view` (#1212, #1109, #898, #1019, #1136, #1368, #1384, #1328, #1333, #1315 and #923).
  - #1212 merged at 2026-10-15T20:02Z, which is 10-16 04:02 at +08. So the pipeline document went stale within hours.
- **Fix direction:**
  - Add a dated "Status (2026-10-26)" note to each document, linking the merging PR.
  - Open one ledger for the pre-rolling items still open: the 46 CNC items, the 10-19/10-20 controller items, and CS-02/CS-04.
  - Give them prefixed IDs, for example `C0925-MC-2`.

### M7-P3-2 — The 2026-09-25 CN-track claim "PWM255 clamps S12000 to full output" is wrong, and it left the S value out of the CNC export advisory for Marlin

- **Corrects:** `2026-09-25-controller-full-audit.md:1775` and `tracks/CN.md:187`.
  - E1's refuter showed it with Compiler Explorer and Marlin `spindle_laser_types.h` @ 2.1.2.5: a PWM255 or PERCENT build narrows S into `uint8_t`, so S12000 runs as 224 (87.8 %).
  - **Kind:** contradiction (older audit against a later round), with a narrow consequence.
- **Did it drive a decision?**
  - No ADR quotes it (`git grep` for "clamp" with "PWM255": only ADR-567 Amd 2, which states the wrap correctly).
  - It did shape CN-1's fix. The advisory for a Marlin, Smoothieware or Ruida profile names only "the two commands" that read differently, G4 P and M0 (`src/ui/app/cnc-export-controller-advisory.ts:19-28`).
  - Under the clamp claim, the spindle S looked harmless.
  - Under the real wrap, `M3 S<rpm>` on a PWM255 build runs at (rpm mod 256)/255: S12000 runs at 88 %, S24000 at 75 % and S10000 at 6 %.
  - The laser-side `marlinPowerScaleWarning` (ADR-567 Amd 2) covers inline laser profiles only.
- **Evidence:** **READ** (lines above). The arithmetic is from E1's executed x86 GCC run (S12000 → 224).
- **Severity:** P3. The advisory already ends "Check the file before running it on this machine", and KerfDesk never runs a CNC job on Marlin. The report table should still be corrected.
- **Refuter:** **CONFIRMED, P3.**
  - The clamp claim is at report line 1775 and `tracks/CN.md` line 187.
  - ADR-567 Amd 2 item 6 states the wrap: "S600 runs as 88".
  - The advisory names only G4 P and M0 (`cnc-export-controller-advisory.ts:19-28`).
  - The arithmetic holds: S12000 → 224, S24000 → 192, S10000 → 16.
  - In C++, converting an out-of-range float to `uint8_t` is undefined behaviour, so the exact value depends on the compiler. That supports keeping P3 behind the advisory's "check the file".
- **Fix direction:** correct the two table cells to "PWM255/PERCENT builds wrap S to its low byte (S12000 → 224)". Add the spindle S to the Marlin CNC export advisory.

### M7-P3-3 — The 2026-10-20 audits list Marlin `G92.1` (CS-05) as open, but #923 fixed it on 2026-09-26; the Reset-origin copy still says `G92.1` on Marlin

- **Corrects:**
  - 2026-10-20 protocol audit, "Carried over … CS-05 — Marlin `G92.1` is still offered unconditionally (`marlin/driver.ts:81`)".
  - 2026-10-20 design audit §4 row CS-05.
  - **Kind:** contradiction with the 2026-09-25 CG-11 fix. A leftover is copy drift.
- **Where:**
  - On Marlin, `capabilities.workOffsetSource === 'host-recorded'` (`marlin/driver.ts:48`), so Reset origin runs `restoreHostRecordedMachineFrame` and sends `G92 X<m> Y<m>` (`src/ui/state/laser-origin-actions.ts:183-186, 203-222`).
  - The driver field `clearOrigin: 'G92.1'` has no production reader (`git grep "\.clearOrigin"`).
  - The UI still tells the Marlin operator `G92.1`: the tooltip at `src/ui/laser/OriginRow.tsx:114` and the success toast at `:265`, "Temporary work offsets cleared (G92.1); saved G54 is unchanged."
- **Evidence:** **REPRO** (existing test). `marlin-origin-model.test.ts:172-178` ("resets the origin with a G92 that restores machine coordinates, not G92.1") passes on `79720dd5c`. The copy is **READ**.
- **Severity:** P3.
- **Refuter:** **CONFIRMED, P3.**
  - Both the tooltip (`OriginRow.tsx:113`) and the toast (`:265`) say `G92.1` whatever the driver.
  - No production code reads `clearOrigin` for any driver (`git grep`).
  - On Marlin, `laser-origin-actions.ts:184-186` takes the host-recorded G92 restore path.
- **Fix direction:** mark CS-05 fixed by #923 in both 10-20 documents. Make the Reset-origin tooltip and toast name the command actually sent for host-recorded drivers. Drop the dead `clearOrigin` value from the Marlin driver, or document it.

### M7-P3-4 — The 2026-10-19 and 2026-10-20 controller audits left behaviour and decision items with no fix card, ADR decision or ledger row

- **Corrects:**
  - 2026-10-19 F-6, F-7, F-8 and F-10.
  - 2026-10-20 design D-1, D-2, D-3, D-6 and D-7.
  - 2026-10-20 protocol P-2 and P-3.
  - CS-02 and CS-04, carried from July.
  - Only F-4 (ADR-648 Consequences: "stays open") and D-4/P-4 (ADR-375 Amd 4: "grblHAL is still not asked `$I`") are named in an ADR.
  - **Kind:** record omission.
  - Each item was **READ** on `79720dd5c` and is unchanged.
- **Where** (each still true):
  - F-6: Disconnect always sends Ctrl-X (`laser-disconnect-stop.ts:50`).
  - F-7: one owed reply recommends Reconnect (`controller-recovery-status.ts:46`).
  - F-8: grants match stored identity only (`electron/serial-port-grants.ts:109`).
  - F-10: the worker handshake is 2 s (`worker-serial-connection.ts:55`).
  - D-1: an owned Abort resets at once (`laser-job-stop.ts:258`).
  - D-6: no `$C` check run for external files.
  - D-7: no "Home when connected".
  - CS-04: M114 is reported as `Idle` (`marlin/response.ts:130`).
- **Contradiction inside the set:**
  - 10-19 F-6 says LightBurn's "right-click Devices" reconnect "closes and reopens the port without a reset".
  - 10-20 design §4 says that path "also resets the board when DTR is wired to reset [forum]".
  - The decision F-6 asks for therefore rests on two opposite readings of LightBurn.
- **Severity:** P3 as a record finding.
  - None is silent wrong output. D-1's reset is recorded as position-lost (ADR-215 Amd 1).
  - D-1, D-2 and P-2 are maintainer decisions with operator-visible cost: an ALARM:3 after every Abort, and a job ended by one lost reply.
- **Refuter:** **CONFIRMED, P3.**
  - The cited code still holds. D-1 (`laser-job-stop.ts:258`), CS-04 (`marlin/response.ts:130`), F-8 (`serial-port-grants.ts:109`) and F-10 (`worker-serial-connection.ts:55`) match.
  - One citation is a few lines off: F-6's Ctrl-X is at `laser-disconnect-stop.ts:59-70`, not `:50`.
  - The F-6 contradiction is real:
    - the 10-19 audit, lines 171-172, says LightBurn's reconnect does not reset the board;
    - the 10-20 design audit, line 396, says it does.
- **Fix direction:**
  - Put these rows in the ledger proposed in M7-P3-1, with an owner.
  - Ask the maintainer for the three decisions (D-1, D-2, P-2) and the F-6 decision.
  - Before that, re-fetch the LightBurn source behind F-6.

## Contradictions noted (older audit against a later round)

| Older claim | Later evidence | Drove a decision? |
|---|---|---|
| 09-25 CN track: PWM255 "clamps S12000 to full output" | E1 refuter: it wraps (S12000 → 224) | It narrowed CN-1's advisory to G4 P and M0 (M7-P3-2). No ADR |
| 10-20 protocol and design: CS-05 is open | 09-25 CG-11 was fixed by #923; the Marlin path sends a G92 restore | No. Copy drift remains (M7-P3-3) |
| 09-29: JR-2 "Fixed on main" | M6-P2-2: a hole under half the bit is still dropped silently | No new decision; M6 owns it |
| 09-25 HF-8: "Grbl 1.1f" grblHAL builds handled | M3 / D6-P3-3: such boards run a stock-GRBL profile (C4 gap) | Already corrected by M3-P3-3 |
| 10-19 F-6 against 10-20 §4: does LightBurn's reconnect reset the board? | The two say opposite things | F-6's pending ADR-212 decision (M7-P3-4) |
| 09-29 P2-relief-finish-3 and WA-4 "Open" | Fixed by #1136 and #1368/#1384 | No (M7-P3-1) |

## Refuted (own candidates dropped before raising)

- **"JR-1 regressed: `$32=1` on a router gives no Job Review warning."** My first variant called `detectMachineJobWarnings`. The router `$32` message comes from `runControllerReadiness` (`controller-readiness.ts:186-187`) as the error `laser-mode-enabled`, which Job Review shows with Send `$32=0`. The fix holds.
- **"CS-05 still open."** Marlin's Reset origin never sends `G92.1` (M7-P3-3).
- **"P2-relief-finish-3 and WA-4 still open."** Both are fixed (M7-P3-1).
- **"P-4's `0x87` proposal would fire a FluidNC macro."** FluidNC v4.0.3 does bind `0x87` to macro 0 (`fluidnc-v403-realtime-dispatch.ts:17`). But both P-4 and D-4 restrict the byte to grblHAL, so no claim is wrong.

## Verified clean

- **2026-09-25, 09-25 claim "every finding fixed with a regression test", for the sampled set.**
  - The named regression files of the sampled items all exist, and every one passes on `79720dd5c`.
  - That covers MA-7, MA-1, OR-1, GP-1, GP-2, HF-7, CG-1, CG-11, CG-12, SM-1, SM-3, SM-6, SM-7, RU-1 and ST-1, inside the 401 regression tests run in all.
  - No test was deleted when the `src/__audit_repro__` files moved beside the code.
- **GP-3 family.** Every user string written into a job comment folds `! ~ ?` (`gcode-comments.ts:89`), so a layer or material name cannot hold GRBL mid-job.
- **P-1.** The worker-hosted refill uses the shared streamer module, so the EEPROM sync rule applies on both paths.
- **CNC fixes.**
  - Tabs on thin stock (ADR-258 Amd 4) at 2/2, 3/3 and 3/4 mm.
  - Helical entry as half arcs (GC-1).
  - The router `$32` error (JR-1, MC-1).
  - The 10-09 relief exclusion boundary.
- **10-16 repairs.** F1, F2 and F3 hold on main through their regression tests.

## Not verified

- **Hardware follow-ups from 09-25** ("Decisions to review" items 1, 2 and 4, and HF-1: the 4040 M3 air cut, Marlin M410 slip, Smoothieware without its Laser module, the Falcon per-axis Home). No record shows they were done. No hardware was operated.
- **Smoothieware stream-side Pause.** The driver has `realtimePause: false` and no `planStreamPauseBeam`, so whether a lit beam over a stopped head (MA-1's twin) can occur was not traced.
- **Most open CNC items** were not re-run: JR-3 to JR-9, TP-3, TP-5, the FS items, AC-2/4/5/6/8, MC-5, CO-4, PV-1 to PV-4, P2-relief-rough-2, P2-relief-finish-2/4, P2-preview-3, WA-1, WA-3, WA-7, P2-gcode-2, P2-advcam-1/3 and CW-03 to CW-06.
  - CNC v1 (F2, F3, F4, F7, F8) and E3/E6 re-observed many of them as KNOWN.
  - Those that never appear in a later round are TP-3, CO-4, P2-relief-rough-2, P2-relief-finish-4, P2-gcode-2, WA-1 and P2-advcam-3. Their status is unknown, and they belong in the ledger proposed in M7-P3-1.
- **The 37-item gap list (CNG-*)** of 2026-09-27 is feature requests and was not sampled.
- **Vendor and peer sources** cited by MC-2 and CO-2 (gSender, Carbide Motion, LightBurn's origin page) were not re-fetched. The LightBurn line is quoted from the 09-24 report.

```json
[
  {"id":"M7-P1-1","severity":"P1","area":"meta-older-audits","corrects":"2026-09-29 CNC second pass P2-relief-rough-3 (Medium, Open)","kind":"Record omission; wrong severity (P1 by effect)","file":"src/core/cnc/compile-cnc-relief.ts","line":99,"anchor":"Contract: drawn relief is kept; Twin: lone relief stops at its surface; heightmap-tool-offset.ts:14 bottomless edges","evidence":"REPRO","verdict":"CONFIRMED","known":"rolling-v2 16 K-2 (KNOWN only, P2); CNC v1 F6 note; untracked (no PR, fix card, ledger row or ADR follow-up)","summary":"Two reliefs 1 mm apart on one layer, 1/4in end mill: the deep relief's roughing cuts 2.175 mm into the neighbour at Z-1.5 and Z-3 (8 moves); no preflight, job or relief-planning warning; no later round, ledger, ADR or PR names it","refuter":"Refuter repro: tool centres run to the relief edge (X124); 2.175 mm into the neighbour at Z-1.5/-3 (defaults: Z-1.5/-2.5), identical with the reliefs on two operations; no warning. Record corrections: rolling-v2 16 K-2 (P2, READ) and CNC v1 F6 (Refuted note, 'documented bottomless-edge rule' clean claim) did name it, as KNOWN only; a lone relief also overcuts 3.175 mm into bare stock; the fix must cover other drawn work across operations"},
  {"id":"M7-P1-2","severity":"P2","area":"meta-older-audits","corrects":"2026-09-29 P2-control-1 (Medium, Open; ADR-491 Amd 1 item 3 follow-up); CNC v1 F7 KNOWN row '09-24 JR-3'","kind":"Record omission (deferred without owner); wrong severity (P1 by effect)","file":"src/ui/laser/cnc-z-travel-warnings.ts","line":32,"anchor":"Contract: ADR-491 Amd 1 (Z range must fit); Ground truth: GRBL $23=0 homes Z to top, limits off by default","evidence":"REPRO","verdict":"KNOWN","known":"ADR-491 Amd 1 item 3; CNC v1 F7 KNOWN (09-24 JR-3)","summary":"Homed router, park height 50 within a 75 mm travel, work Z0 40 mm below top: the program lifts G0 Z50 (machine Z+10) at every bit change and job end; detectCncZTravelWarnings returns [] and no warning reads the live WCO; with limits off Z stalls and later cuts run deeper","severity_auditor":"P1","refuter":"Repro holds (G0 Z50 at bit change and job end; no warning with a live $132/homing snapshot). Tracked by ADR-491 Amd 1 item 3 'recorded follow-up' (M7's own definition) and F7 JR-3 KNOWN; no owner. P1 refuted: the lift is the operator's own park height, left to the operator by ADR-491 item 3 and shown in Job Review; GRBL soft limits refuse with an alarm (limits.c:411-428 @bfb67f0c), hard limits alarm; with both off, bit-change stalls are healed by the mandatory Zero Z (tool-change-hold-entry.ts:35-37); only a job-end stall carries into a next same-bit job"},
  {"id":"M7-P2-1","severity":"P2","area":"meta-older-audits","corrects":"2026-09-24 CNC MC-2 (High, Still open; 09-29 'Fix these next' #1)","kind":"Record omission","file":"src/core/controllers/grbl/probe.ts","line":119,"anchor":"Ground truth: GRBL alarms only at end of travel; Twin: Pn:P decoded (status-parser.ts:288) but never read","evidence":"READ","verdict":"CONFIRMED","known":"2026-09-24 MC-2 (untracked since 09-29)","summary":"Touch-off still seeks G38.2 Z-25 F150 blind; no test touch and no probe-input display, so a forgotten clip drives the bit into the plate; no later round (C2 included), ledger, ADR or PR names it","refuter":"probe.ts seek unchanged; pins.probe has no production reader; only a 'clip the probe lead' hint (ProbeControls.tsx:179); not in C2 KNOWN; no PR"},
  {"id":"M7-P2-2","severity":"P2","area":"meta-older-audits","corrects":"2026-09-29 P2-toolpath-3 (Medium, Open)","kind":"Record omission; twin gap","file":"src/ui/laser/stacked-copy-warnings.ts","line":35,"anchor":"Twin: ADR-359 item 5 stacked-copy warning (laser only); kerf-offset.ts:64 even-odd fill","evidence":"REPRO","verdict":"CONFIRMED","known":"2026-09-29 P2-toolpath-3 (untracked since)","summary":"Two exact copies of a closed shape on a 3 mm Outside-profile or Pocket layer cancel: 0 cutting moves on them while the control shape is cut to Z-3; no preflight or job warning; stackedCopyWarnings returns [] for CNC","refuter":"Refuter repro: 0 cuts on the stacked pair for Outside and Pocket, as two objects and as one SVG with a doubled path; no warning; no PR. Twin correction: stackedCopyWarnings keys raster/traced images only, so the fix needs a vector key"},
  {"id":"M7-P2-3","severity":"P2","area":"meta-older-audits","corrects":"2026-09-24 CO-3 (Medium, Still open)","kind":"Record omission; contradiction (WORKFLOW/code comment vs code/test)","file":"src/core/job/job-bounds.ts","line":171,"anchor":"Contract: WORKFLOW.md:4659 and job-origin.ts:138 ('anchors name physical corners of the artwork'); Ground truth: LightBurn job origin bounds the graphics","evidence":"REPRO","verdict":"CONFIRMED","known":"2026-09-24 CO-3 (untracked since 09-29)","summary":"User Origin front-left: 1/8in Outside profile puts the artwork corner at (3.175,3.175), On-path at (1.588,1.588), a 0.5 mm 90deg 12.7 mm V-bit engraving at (6.35,6.35); coordinate-origin-audit.test.ts:132 pins the reach anchor with no ADR","refuter":"Refuter repro: vb-60 0.5 mm engraving at (3.175,3.175), vb-90 at (6.35,6.35); reach anchor pinned since #832, no ADR; P2 kept (no contract decides; D8-P2-1 precedent). The V-bit inset uses the full body radius, wrong under either rule"},
  {"id":"M7-P2-4","severity":"P3","area":"meta-older-audits","corrects":"2026-09-24 CO-2 (Medium, Still open); E3-K-4 covers only the surfacing half","kind":"Record omission","file":"src/core/devices/origin-transform.ts","line":9,"anchor":"Ground truth: LightBurn 'Origin for GCode devices is typically front left regardless of limit switches'; GRBL $23=0 homes rear right","evidence":"READ","verdict":"CONFIRMED","known":"2026-09-24 CO-2; E3-K-4","summary":"CNC origin picker labelled 'Machine origin corner' and the code says machine zero sits at the homing corner, inviting Rear right on a default GRBL router, which turns every part 180 deg (Front right/Rear left mirror); no CNC Job Review note","severity_auditor":"P2","refuter":"Open and untracked, but lowered P2->P3: visible label is 'Origin' with an orientation tooltip that says it does not change homing; a separate 'Recorded home' picker exists; a Rear-right pick reverses both jog arrows (jog-direction.ts:26-27) and displaces the required Frame before any cut; the remaining drift is the code comment and the missing CNC note"},
  {"id":"M7-P2-5","severity":"P2","area":"meta-older-audits","corrects":"2026-09-29 P2-preview-2 (E3-K-3, M6 hand-off) and P2-review-3 (M1-P2-2, M6, F3)","kind":"Record omission (KNOWN-only re-filing)","file":"src/ui/workspace/draw-preview.ts","line":286,"anchor":"Contract: ADR-392 (preview reads the placed park); ADR-433 (nest spacing vs bit)","evidence":"READ","verdict":"CONFIRMED","known":"E3-K-3; M1-P2-2; M6","summary":"CNC preview still draws the job end as a stock-top rapid to program 0,0 and ignores park height, bit-change parks and retractBetweenPasses; CNC Quick Nest still defaults to 2 mm (QuickNestDialog.tsx:38); neither has a fix card","refuter":"Both unchanged on main; no PR; F8-K-2 is another KNOWN-only re-filing of P2-preview-2; row 27 wording: the emitter reads retractBetweenPasses (cnc-grbl-strategy.ts:187), only the preview ignores it"},
  {"id":"M7-P3-1","severity":"P3","area":"meta-older-audits","corrects":"2026-10-16 pipeline, 2026-10-09 released CNC, 2026-09-24 CNC, 2026-09-29 CNC, 2026-10-19/10-20 controller docs","kind":"Stale record","file":"docs/audits/2026-10-16-controller-pipeline-audit.md","line":1,"anchor":"gh pr view merge times (#1212, #1109, #898, #1019, #1136, #1368, #1328, #1333, #1315)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Five older audits still say not merged, draft PR or open for work merged weeks ago (P2-relief-finish-3 and WA-4 are fixed; F-5, F-9, D-5, P-1, P-5, P-6 unrecorded in their own docs); no ledger exists for pre-rolling audits and their IDs collide","refuter":"All quoted strings present; merge times match gh pr view"},
  {"id":"M7-P3-2","severity":"P3","area":"meta-older-audits","corrects":"2026-09-25 controller audit CN track (report :1775, tracks/CN.md:187) 'PWM255 clamps S12000 to full output'","kind":"Contradiction","file":"src/ui/app/cnc-export-controller-advisory.ts","line":19,"anchor":"Ground truth: Marlin spindle_laser_types.h @2.1.2.5 (uint8 cutter_power_t, E1 refuter); ADR-567 Amd 2 item 6","evidence":"READ","verdict":"CONFIRMED","known":"E1 refuter note","summary":"The clamp claim is wrong (S wraps: S12000->224, S10000->16); no ADR quotes it, but the CN-1 export advisory names only G4 P and M0, leaving out the spindle S a PWM255 Marlin build wraps","refuter":"Claim at report:1775 and CN.md:187; ADR-567 Amd 2 item 6 states the wrap; the advisory names only G4 P and M0"},
  {"id":"M7-P3-3","severity":"P3","area":"meta-older-audits","corrects":"2026-10-20 protocol and design audits CS-05 'Marlin G92.1 still offered'","kind":"Contradiction; copy drift","file":"src/ui/laser/OriginRow.tsx","line":265,"anchor":"Twin: 2026-09-25 CG-11 fix (#923) laser-origin-actions.ts:183-222; marlin-origin-model.test.ts:172-178","evidence":"REPRO","verdict":"CONFIRMED","known":"2026-09-25 CG-11","summary":"CS-05 was fixed by #923 on 2026-09-26 (Marlin Reset origin sends a G92 machine-frame restore), yet the 10-20 audits list it open; the Reset-origin tooltip and toast still tell Marlin users G92.1","refuter":"Tooltip :113 and toast :265 unconditional; clearOrigin has no reader; Marlin takes the host-recorded G92 path"},
  {"id":"M7-P3-4","severity":"P3","area":"meta-older-audits","corrects":"2026-10-19 F-6/F-7/F-8/F-10; 2026-10-20 D-1/D-2/D-3/D-6/D-7, P-2/P-3, CS-02/CS-04","kind":"Record omission; internal contradiction (F-6 vs 10-20 sec 4 on LightBurn reconnect reset)","file":"src/ui/state/laser-job-stop.ts","line":258,"anchor":"Contract: AREAS M7 (open items must be tracked); the audits' own 'Suggested order'","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Thirteen controller behaviour/decision items from 10-19 and 10-20 are still open on main with no fix card, ADR decision or ledger row (only F-4 and D-4/P-4 are named in ADRs); F-6's pending decision rests on two opposite readings of LightBurn's reconnect","refuter":"Citations hold (F-6 Ctrl-X at laser-disconnect-stop.ts:59-70, not :50); F-6 vs 10-20 design:396 contradiction confirmed"}
]
```
