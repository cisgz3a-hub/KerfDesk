# Meta audit v1 — M6 Clean claims, refuted, merged and lowered findings (`meta-clean-and-refuted`)

- **When:** 2026-10-23 (first runs) and 2026-10-26 (re-run on current main).
- **Tree:** origin/main @ `adf300522`.
  - The shared worktree's source stops at merge-base `e660e0e5c`. Since then #1410–#1438 merged, including the fixes for F1, F2, F3, F5, F6 and 12-P2-1.
  - So every result below was re-run in a read-only export of origin/main (`git archive origin/main`) in the scratchpad, with a junction to the repo's `node_modules`. The export and the junction were removed afterwards.
  - The first runs on `e660e0e5c` gave the same numbers wherever the code is shared.
- **Scope:**
  - Every "Verified clean" section, and every finding marked REFUTED, MERGE-INTO or lowered, in:
    - rolling-v2 (01–28);
    - controller v2 (C1–C8), v3 (D1–D8) and v4 (E1–E6);
    - CNC v1 (F1–F7);
    - the refuted and lowered items in meta v1 M1–M5.
  - Cross-report statements on banner, `$30`, `$32`, WCS, M1, scan offset, park, interval order, open outlines and feed override.
- **Method:** METHOD.md with the meta changes in AREAS.md, judged against the clarified METHOD §3 (the P1 test has no reach clause).
  - **Part A:** 14 clean claims, weighted to safety, were attacked with fresh tests: other dialects, designs, settings or spellings than the original auditor used, and code merged since.
  - **Part B:** 52 refuted, merged, lowered or dropped dispositions were listed. Each was read against §3. The doubtful ones were re-run on main.
  - **Part C:** the reports were grepped for the topics above. Each statement was compared with the code on main or a fetched primary source.
- **Test runs:**
  - Command: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run <file>` in the export, one process at a time.
  - Repros were temporary `zz-m6-*` files, now deleted from the worktree and the export.
  - Copies of the 12 test files are in the scratchpad `m6-repros\tests\`, and their raw output is in `m6-repros\out.txt`.
- **Primary sources fetched on 2026-10-26:**
  - gnea/grbl `protocol.c` @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`;
  - LightBurn Material Test 2.1 (`docs.lightburnsoftware.com/2.1/Reference/MaterialTest/`);
  - LightBurn Interval Test (`docs.lightburnsoftware.com/latest/Reference/IntervalTest/`, which the page says is the 2.2 RC).
- **Counts:**
  - 11 meta findings, as raised: P1 3, P2 3, P3 5.
  - After the refuter: **P1 4**, **P2 2**, P3 5, plus one refuter-raised **P2** (M6-R1).
    - M6-P2-1 was raised from P2 to P1. It is the KNOWN controller-v2 C5-P3-1, so the meta finding is that C5-P3-1 was under-rated (P3 → P1).
  - Clean claims: 14 tried, 3 broken. Of the 3, the two Console claims (A7, A8) were already disclosed as C5-P3-1, C4-P3-1 and 17-P3-2 in the same rounds.
  - Dispositions: 52 checked, 9 wrong. Of the 9, 8 are new and one (E5-P2-4) was already corrected by M4.
  - Contradictions: 6. X5 is overstated; see M6-P1-2.
  - Of the 11 findings, 6 are live defects on main (M6-P1-1..3 and M6-P2-1..3) and 5 are record corrections. M6-R1 is a seventh live defect.
- **Refuter:** done 2026-10-26 in the shared worktree at HEAD `505fb2ccf`, which includes origin/main `adf300522`.
  - **Verdicts:** confirmed 9, plausible 1, refuted 0, known 1 (M6-P2-1 = C5-P3-1).
  - **Severity change:** M6-P2-1 P2 → P1.
  - **Refuter-raised:** M6-R1 (P2).
  - **Evidence corrections:**
    - M6-P1-2: an Outside profile whose gap is narrower than the bit does get an ADR-433 gap line in Job Review. It misdescribes the effect.
    - X5: the laser comment is literally true.
  - **Repros:** fresh `zz-m6r-*` tests, run one at a time and then deleted. Copies and raw output are in the scratchpad `m6r-repros\` (`out.txt`).

## Headline

The "Verified clean" sections hold up well, and a dozen fresh oracles found nothing. The misses are in what the rounds threw away.

Three reasons are no longer accepted under §3:
- a decision already in an ADR;
- "documented in WORKFLOW";
- "the trigger is unusual".

On those grounds, three silent burn or size defects were dropped or lowered, and all three still reproduce on main:
- **Cut selected graphics.** A laser lead burns 0.91 mm into an unselected neighbour part (03 C-D-3, kept as P3 doc drift).
- **CNC open outline.** An open outline on a CNC Outside profile is cut on the line, so the part comes out one bit diameter undersized with no notice (F3, dropped).
- **Open plate outline.** A hole's lead burns 1.45–1.62 mm into a plate whose outline is left more than 0.5 mm open (M1-P2-1, lowered to P3).

Two clean claims about the Console also break:
- C4: "checks values as GRBL reads them";
- C5: "persistent commands are blocked".

A comment or a `/` inside the setting key, as in `$RST(x)=*` or `$22(x)=0.5`, slips past the block, the confirmation, the value check and the settings re-read. GRBL strips those characters and runs the command.

## Part A — clean claims tried

Results are on origin/main `adf300522`.

| # | Report | Clean claim | Fresh attempt | Result |
|---|---|---|---|---|
| A1 | D1 | Air equals the group's request at every lit move; air off at the end | 4 dialects (grbl-dynamic, grbl-v1.1, marlin-inline, Smoothieware) × 4 variants: Line leads (arc and line), kerf 0.1, 1 mm overcut, 2 passes, tabs, a part drawn open, per-artwork air override both ways (off on an air operation, on on an air-off operation), and a Fill operation. Own G-code oracle; air keyed by S | **Holds.** 4,768 lit moves, 0 with the wrong air; air off at every end |
| A2 | 03 | Laser off on travel; no lit G1 joins separate shapes | Same 16 programs. Every lit segment's ends and midpoint lie within 0.03 mm of the prepared job's polylines, leads included; no lit G0 on GRBL dialects | **Holds.** joinBad 0, litG0 0 |
| A3 | C1 | Resume is dark to the resume point, and the tail burns as the original | M3 ran GRBL only. This run used Marlin inline, Marlin fan and Smoothieware, resumed from every line of a leads + tabs + overcut + 2-pass + Constant + Fill program, starting from a hostile lit state (`M3`/`M106 S255`, modal G1) | **Holds.** 1,614 resumes, 0 lit preamble moves, 0 tail mismatches (one refusal per dialect: "nothing left to run") |
| A4 | D2 | Every Focus Test sample returns to its Z; Z is 0 at the end; no XY under G91; each burn at its own offset | Two Focus layers (+1.5 and −2.25), with leads, tabs, overcut, kerf, 2 passes and Constant power, plus a Fill layer; layer order reversed; 2 dialects. A Focus Test on Fill was also tried | **Holds.** End Z 0; each S burns only at its own offset (S500 at 1.5, S300 at −2.25, S600 at 0). Focus on Fill is refused with a clear `focus-test-uncompilable` |
| A5 | C8 | Override bytes are right, and a laser Start resets them to 100% | Bytes in `commands.ts` checked against gnea `config.h` values (0x90–0x97, 0x99–0x9D) and the rapid buttons. The Run G-code file path passes `machineKind: 'laser'` into `laserStartOverrideReset` (`external-run.ts:250`) | **Holds.** CNC keeps its own warn-only policy (ADR-355 decision 5) |
| A6 | C8 | "Jogs and Frame are immune to the feed override (`PL_COND_FLAG_NO_FEED_OVERRIDE`)" | Read `falcon-command-contract.ts` on main | **Broken (P3):** the Falcon A1 Pro jogs and Frames with `G1 … S0`, not `$J=`. See M6-P3-3 |
| A7 | C4 | "The Console check reads the value as GRBL's line reader does" | `$22(x)=0.5`, `$/22=0.5`, `$2(c)2=1.5` through `prepareConsoleCommand` and `consoleSettingWriteIssue`, against a port of `protocol.c` | **Broken (P2):** see M6-P2-1 |
| A8 | C5 | "Spelling: `$rst = *`, `$RST=&` blocked" (persistent commands) | `$RST(x)=*`, `$/RST=*`, `$N(x)0=G0X100`, `$I(x)=x` | **Broken (P2):** all four are sent as plain G-code. See M6-P2-1 |
| A9 | E4 | "Canonical line = GRBL's collected line" | 10 edge lines (nested parens, a stray `)`, `%` mid-line, `/`, a tab, lowercase, `;` before `(`, an unclosed `(`, `X1.2.3`, an `E` word) against a port of `protocol.c` | **Holds.** 9 equal (case aside); the repeated-word line is refused (error:25) |
| A10 | F4 | The depth ladder lands on −depth and never steps deeper than depth per pass | 200,000 random depth / depth-per-pass pairs at 3–5 decimals | **Holds.** 0 bad; worst over-step 7e-15 mm |
| A11 | F7 | No rapid into uncut stock | 6 designs on post-fix code: offset pocket with a round island; island adaptive at 1/4" (#1421); a 3/8" + 1/8" rest pocket at 85% (#1421, with M0); helix entry; two outside parts 3.5 mm apart with tabs, 0.5 mm allowance and retract (#1416); an outside profile with a 10° ramp. Own flat-cutter height field at 0.2 mm, per-section bit from the tool comment | **Holds.** 169 below-Z0 rapids, 0 into stock |
| A12 | F2 / F3 / 09 | No gouge | Same 6 programs. Cutter-centre clearance to the design, sampled every 0.1 mm on every cutting move below Z0 (arcs interpolated) | **Holds.** Worst −0.0014 mm (output rounding) |
| A13 | 09 / E3 / D4 | Z safety: no XY G0 below safe Z; M3 at safe Z; Z lift after M0 before XY; no cut with the spindle off; spin-up `G4` after every M3 | Same 6 programs | **Holds.** 0 violations |
| A14 | D5 | Every app jog entry point warns about no-go zones | Every caller of `buildJog`, `.jog(` and `jogToMachinePosition` on main, including features merged after D5 (Falcon laser dot, camera nudge and calibration) | **Holds.** All motion goes through `laser-jog-actions.ts:114,153` or `positioning-light-actions.ts:333` (`warnJogMotionPolicy`); Frame has its own check (#1392) |

## Part B — refuted, merged, lowered and dropped dispositions

**Verdict key:**
- **OK** means the disposition stands under the clarified §3.
- **Wrong** means it does not stand; the meta finding is named.
- Rows marked *(re-run)* were tested on main.

### rolling-v2

| Item | Disposition | Verdict |
|---|---|---|
| 01: OAuth lease extension, machine-review leak, dead-man release, pairing brute force, 20 sockets | Refuted | OK: each refutation names the guard (ADR-583, `reviewMessageProjector`, `runCancelJog`, the DO counter, `getWebSockets`). Not re-run |
| 02 R-1..R-5 | Refuted | OK. R-5 ("raw `setState` in `apply-studio-snapshot.ts`") is now hardened: `commitProjectEditNow` (`apply-studio-snapshot.ts:87`) |
| 02 deleted-customer P2 → P3-19, trial nonce P2 → P3-1, seal key P2 → P3-8 | Lowered | OK: no physical output; the seal-key outcome equals an accepted unsealed project |
| 03 C-C-3 (180° scan) | Refuted | OK: the burned picture is identical |
| **03 C-D-3 → P3-10** (leads ignore uncut neighbours under an output scope) | Refuted as a contract break; kept as P3 doc drift | **Wrong → M6-P1-1** *(re-run)* |
| 03 C-K-1/C-K-2 → P2-9; C-E-2 → P2-7; C-B-3 → P3-3 | Narrowed or merged | OK. P2-9 was fixed by #1345 |
| 04 A-3, E-6; E-5 → A-7 | Refuted / merged | OK |
| 06-P2-1 → P3 (Job Review sub-operation card) | Lowered: latent | OK under §3: sub-operations come only from hand-edited v3+ files (no UI, importer or MCP path creates them), so the defect is not reachable today |
| 07 P3-3 second half | Refuted | OK |
| 08 P2-3 plain buttons, P3-5 pick order | Sub-claims refuted | OK (ADR-493 decision 6, ADR-196) |
| 09 P3-1 → KNOWN K-5 (simulator ignores "Retract between passes") | Refuted as new | OK as a disposition. Still open on main: `toolpath-cnc.ts` never reads `retractBetweenPasses`. Left to M7 (2026-07-25 1.14, 2026-09-29 P2-preview-2) |
| 09: inlay tabs gate, Marlin G4, plunged-travel advisory, inlay code, CNC comment injection, `$30` vs RPM | Refuted | OK. The `$30` refutation is true for project Start only; external runs were D4-P2-1, fixed by #1390 |
| 11 P3-9 (macOS Electron zip) | Refuted | OK |
| **12-P2-1 → P3** (Open swaps in an older camera calibration) | Lowered: "by design", ADR-500 Amd 1 §2 | **Wrong → M6-P3-1** (fixed by #1437) |
| 12-P2-3 sub-claim ("certainly alarms" → "can trip") | Softened | OK |
| 14 P2-1 Illustrator sub-claim | Partly refuted | OK |
| 22 P2-1 kept P2; privacy P3s not raised | Weighed | OK |
| 23-P2-4 → P3 (Layers panel resampling) | Lowered: performance only | OK |
| 26-P2-1 → P3 (Cnc3DPane live reveal) | Lowered: latent | OK: `Cnc3DPane` is still unmounted on main (`App.tsx:111`) |
| Auditor-dropped candidates in 05, 06, 07, 08, 10, 13, 15–21, 24, 25, 27, 28 | Dropped before raising | Read, not re-run: none rests on reach or "documented" alone for a physical-output effect |

### Controller v2–v4

| Item | Disposition | Verdict |
|---|---|---|
| C1 dropped (Smoothie bare F, comment line, marker zero, restated S, Marlin-fan re-entry) | Dropped | OK. A3 re-tested the dark entry on Marlin and Smoothieware |
| C2-P3-3 sub-claim (ADR-103 retract) | Refuted | OK |
| C3 dropped (step jogs and Frame corners unclamped; homing-edge corner; release mid-hold; stale envelope; FluidNC hold) | Dropped | OK per ADR-375 decision 3. The "stale envelope" reason ("every `$N=` write clears the observation") fails for disguised writes; see M6-P2-1 |
| C4-P2-1 detail correction | Corrected | OK |
| C5 dropped (lone `!`, `$HELP`, macros, FluidNC verbose errors, DEL, ALARM:5) | Dropped | OK |
| C6 dropped (M1000 fire, Smoothie ok-per-line, FluidNC inches, Marlin G21, door byte, FluidNC Fire) | Dropped | OK |
| C7-P2-1 → P3 | Lowered | OK; agrees with M3. Fixed by #1385 anyway |
| C8 dropped (override bytes; readout; Canvas saved position; typed moves; duplicate names; inch DRO; 0.001 in step; Idle override panel) | Dropped | OK. A5 confirms the bytes |
| D1 considered and not raised | Not raised | OK |
| D2 dropped; D2-P3-3 → P2 | Dropped / raised | OK |
| D3-P2-2 → P3 | Lowered | OK; agrees with M3 (fails safe with ALARM:9) |
| D4 P3-2 contract anchor rejected; D4 dropped (0 s spin-up, 0 RPM, `$30` caps) | Refuted / dropped | OK |
| D5 dropped | Dropped | OK |
| D6 dropped (level-1 empty line, stale report, cross-family Start, Save omission, FluidNC v3 tags, Smoothie re-probe) | Dropped | OK |
| D7 dropped "FluidNC over Telnet is not misread by #1366" | Dropped | Moot: #1397's `bannerMayGreet` treats any banner on a network link as a possible greeting (`link-loss-restart-tracking.ts:65-70`) |
| D8 dropped | Dropped | OK |
| E1–E3 dropped | Dropped | OK |
| E4-P1-1 → P2, restored to P1 | Lowered, then restored | OK |
| E4 dropped | Dropped | OK |
| E5-P2-4 → P3 | Lowered | **Wrong**, already corrected by M4-P3-7 (P2). No new ID |
| E5 dropped "LightBurn runs lowest interval first" | Dropped as deliberate | Substance OK; the record gap is M6-P3-4 |
| E6 dropped | Dropped | OK |

### CNC v1

| Item | Disposition | Verdict |
|---|---|---|
| F1 dropped (8 candidates, ADR-453 and ADR-319 tolerances) | Dropped | OK |
| F2-P1-1 → P2, restored to P1 | Lowered, then restored | OK |
| **F2-P2-2 kept P2** (rest-ladder fin standing full depth) | Kept on "METHOD's own terms" | **Wrong → M6-P3-2** (fixed by #1421) |
| **F3 dropped "open contours on an Outside or Inside profile are cut on the line with no notice"** | Dropped: "documented WORKFLOW fallback" | **Wrong → M6-P1-2** *(re-run)* |
| F3-P2-1 kept P2 (allowance ≥ bit) | Kept, with "input is unusual" | OK on effect: a full-width slot and a loose waste ring are not a P1 output. The reach wording is not a valid reason, but the rating stands. Fixed by #1416 |
| F3 other dropped candidates | Dropped | OK |
| F4 dropped | Dropped | OK |
| **F5-P2-2 MERGE-INTO F1-P2-1** | Merged | Merge **OK**: same root and fix, and the consequence is recorded on the F1-P2-1 row. #1418 added the seating regression. The merged row's **severity is wrong → M6-P3-2** (fixed by #1422) |
| F5 self-refuted (3 oracle artefacts) | Dropped | OK |
| F6-P2-1 MERGE-INTO 16-P2-1 | Merged | OK: same `sampleTargetCell` / D/10 root and the same fix. The ball-bit stock and the weak ADR-412 Amd 1 remedy are written into the 16-P2-1 row, so no consequence is lost. The 16-P2-1 fix card must cover ball bits |
| F6-P3-3 → P2 | Raised | OK (fixed by #1420) |
| F6 dropped "two-sided switched off after a split cuts side B from the top" | Dropped: "needs the operator to disable the setup", 16 K-2 class | The reason is wrong under §3, but the outcome was not reproduced on main *(re-run)*: with a 10 → 4 mm wedge split at 5 mm, the setup-off program cut deeper than side A alone in 0 cells. Not raised; see Not verified |
| **F7-P2-3 → P3** (sub-half-bit holes dropped silently) | Lowered: ADR-433 D3 decides | **Wrong → M6-P2-2** |
| F7 dropped | Dropped | OK. A11 re-tested the air floors |

### Meta v1

| Item | Disposition | Verdict |
|---|---|---|
| **M1-P2-1 → P3** (open plate outline > 0.5 mm, lead burn) | Lowered: contract question, realism, LightBurn | **Wrong → M6-P1-3** *(re-run)* |
| **M1-P2-2 → P3** (cross-operation parts closer than the bit) | Lowered: KNOWN (ADR-250 Amd 3 Verification), ADR-433 per operation | **Wrong → M6-P2-3** |
| M2-P3-3 → P2; M3-P3-3 → P2 | Raised | OK |
| M4-P3-6 (E4-P2-3 to P1) refuted | Refuted | OK: a missing optional stop leaves the file's own motion unchanged |
| M4-P3-7 (E5-P2-4 back to P2) | Plausible | Agree |

## Part C — contradictions

| # | Statement A | Statement B | Resolution |
|---|---|---|---|
| X1 | ADR-497 decision 3: hatch spacing runs "widest" first, the gentlest end | LightBurn Material Test 2.1: "lowest Interval … will run first" | ADR-497 is right on the principle. The record has a gap: M6-P3-4 |
| X2 | D6 table row 95: "grblHAL, native USB / network: (no banner)" | D7-P2-1: grblHAL greets every new Telnet client. D7-R1: native-USB builds send the banner about 200 ms after the port opens | D7 is right (fixed by #1397), but the D6 row is still uncorrected: M6-P3-5 |
| X3 | C8 clean: "Jogs and Frame are immune to the feed override" | D6 refuter REPRO `D6R-FRAME`: the Falcon frames with `G21 G90` and `G1 … S0`; `falcon-command-contract.ts:35-36,73` | C8 is wrong for the Falcon contract: M6-P3-3 |
| X4 | ADR-626 clause 4: the free end "can never end inside another part"; "Why this is better": "A lead never runs into a neighbouring part" | ADR-626 Amendment 1, decision 1: "The bed, clearance and free-end checks stay with the prepared job" | Both are in force, and they conflict under an output scope: M6-P1-1 |
| X5 | `line-open-outline-issues.ts:8-10` (ADR-626 Amd 8): "CNC (`cnc-open-contours-omitted`) already say[s] when [it leaves] open contours out" | `CncOpenPathNote.tsx:8`: profiles "still emit, so they are deliberately silent here"; WORKFLOW.md:5411 cuts them on the line | The comment holds only for V-carve, Pocket and Drill: M6-P1-2 |
| X6 | F2-P1-1 restored to P1: stock left standing to full depth, silent | F2-P2-2 and F1-P2-1 (with F5-P2-2) kept at P2 for the same consequence class | Inconsistent application of §3: M6-P3-2 |

## Findings

### M6-P1-1 — Wrong disposition (03 C-D-3 / P3-10): under Cut selected graphics, a laser lead burns into an unselected neighbour part, with no warning; it is still on main
- **Corrects:** rolling-v2 03 C-D-3, which was refuted as a contract break and kept as P3-10 doc drift "for a maintainer decision".
- **Kind:** Wrong disposition and wrong severity; contradiction X4.
- **Where (origin/main `adf300522`):**
  - `src/core/job/apply-laser-leads.ts:79`: the scene is passed in, but only to judge the scrap side.
  - `src/core/job/apply-laser-leads.ts:102`: the obstacles come from `leadJobLines`.
  - `src/core/job/laser-lead-rings.ts:56-74`: `leadJobLines` takes only the prepared job's burning groups, so a part outside the output scope is never an obstacle.
  - `src/ui/laser/laser-lead-warnings.ts`: no warning code covers it.
  - No lead file has changed since `e660e0e5c`.
- **Anchor:**
  - **Contract:** ADR-626 clause 4 (line 96), "so it can never end inside another part"; "Why this is better" (line 167), "A lead never runs into a neighbouring part".
  - **Contract:** Amendment 1, decision 1 (line 238) keeps the free-end and clearance checks on the prepared job. It never says that a lead may then end inside an unselected part.
  - **Twin:** the same layout cut as a whole job drops the lead.
- **Scenario:**
  - Layout: a 20 mm plate A with four 20 mm neighbour parts 0.5 mm away (left, right, top, bottom), all on one Line operation. Leads are in + out, line, 2 mm, automatic side.
  - Cut selected graphics with A selected: A's lead burns `G1 X110.000 Y300.000 … S300`, 0.914 mm inside the top neighbour.
  - Whole job: 0 mm.
  - The operator cuts A now and the neighbours later (or the reverse). Each part cut later carries a lead burn inside its outline.
  - Nothing warns. The lead is placed at full length, so even the "adjusted" count stays silent.
  - Output-off neighbours behave the same (03's REPRO).
- **Evidence:** REPRO on main.
  - `zz-m6-lead-scope-e2e.test.ts` (end to end through `prepareOutput` with `outputScope` and `emitPreparedGcode`):
    `A selected only: lit burn inside a neighbour up to 0.914 mm … advisories=[]` and `whole job: … 0.000 mm`.
  - `zz-m6-lead-scope.test.ts` (`applyLaserLeads` with the scene, a 0.5 mm gap, B out of the job):
    `depthIntoB=1.500`; with B in the job: `0.000`.
- **Why not P3:** the effect is the one that made 03-P1-2 and 03-P1-3 P1: a silent burn into a part the operator keeps.
  - The refuter's reason was that Amendment 1 "chose this". That is neither of the two reasons §3 accepts for lowering a P1: that the output is not wrong, or that a clear warning reaches the operator.
  - The amendment does not name the consequence, and clause 4 still promises the opposite.
- **Refuter:** **CONFIRMED, P1 kept.**
  - **Repro on HEAD** (`zz-m6r-lead-scope`, through `prepareOutput` and `emitPreparedGcode`). Lit moves were sampled at 40 points.
    - **0.5 mm gap:**
      - A selected alone: `G1 X110.000 Y300.000 F1500 S300` burns 0.914 mm inside the top neighbour, and `job.diagnostics` is `[]`.
      - Whole job: 0.000 mm, with `laser-leads-adjusted` (1 omitted).
      - Neighbours on an output-off operation, whole job: 0.914 mm, `[]`.
    - **1 mm gap:** 0.414 mm in both scoped cases. The whole job gives 0.000 mm, with 2 leads shortened.
    - **2 mm gap:** 0 in every case.
  - **Real Job Review** (`prepareCurrentStartJob` → `buildJobReviewModel`, `zz-m6r-lead-review`):
    - With A selected alone, the only notices are the generic ones and the "Selected artwork only" tile. No lead line appears.
    - The whole-job review says "1 shape gets no lead-in or no lead-out … leave the scrap side, come too close …".
  - **Is it a documented choice?** Only partly.
    - ADR-626 Amd 1 decision 1 ends with "The bed, clearance and free-end checks stay with the prepared job: they are about the lines actually cut". So the scope behaviour is deliberate.
    - But the same decision counts unselected and output-off contours as part edges when it judges the side ("output on or off, selected or not"). Amd 1 decision 3 also treats a lead operation's closed shapes as part edges.
    - Clause 4 and "Why this is better" were never narrowed. No amendment says a lead may end inside an unselected part.
    - An unstated consequence of a design choice is not one of §3's two lowering conditions.
  - **Is the output wrong?** It is harmless only if the sheet does not carry the neighbours.
    - Output off is normally used to run an operation later. Cut selected graphics is used to cut parts in batches or to recut one part. In both cases the material under the lead is a part.
    - KerfDesk's own whole-job twin refuses that lead.
    - No warning reaches the operator, so P1 stands.
  - **Novelty:** the defect is KNOWN as 03-P3-10, recorded as doc drift. This correction is to its severity.
- **Fix direction:** Treat every closed contour of the scene's Line operations, inside or outside the output scope and output on or off, as a clearance obstacle for lead fitting, since they are parts on the sheet. Alternatively, warn in Job Review whenever a lead ends inside a scene contour that the job does not cut.

### M6-P1-2 — Wrong disposition (F3 dropped candidate): an open outline on a CNC Outside or Inside profile is cut on the line, so the part is one bit diameter off size, with no advisory and no Job Review line
- **Corrects:** F3's auditor-dropped candidate, "Open contours on an Outside or Inside profile are cut on the line with no notice … documented as WORKFLOW.md … so it is not raised".
- **Kind:** Wrong disposition; contradiction X5.
- **Where (origin/main):**
  - `src/core/cnc/closed-contour-cut-types.ts:5,19-23`: only V-carve, Pocket and Drill omit open contours (and report `cnc-open-contours-omitted`). Profiles "still emit".
  - `src/ui/layers/CncOpenPathNote.tsx:8`: "deliberately silent here".
  - `WORKFLOW.md:5411-5413`: "cut on-path (documented fallback)".
  - `src/core/preflight/line-open-outline-issues.ts:8-10`: the laser twin's advisory (#1345) assumes CNC already says so.
- **Anchor:**
  - **Twin:** the laser Line advisory `line-open-outline` (03-P2-9, ADR-626 Amd 8) and CNC's own `cnc-open-contours-omitted` for closed-only cut types.
  - **Ground truth:** Vectric offsets open vectors to the chosen side, which F3 itself notes.
  - **§3:** wrong scale with no warning.
- **Scenario:** a 40 × 30 mm rectangle on a Profile Outside layer with the default 1/8" bit.
  - The rectangle is either an SVG path whose end stops 0.05 mm short, or a DXF of four LINEs with a 0.01 mm corner gap.
  - DXF LINEs that touch exactly are joined at 1e-4 mm by #1345, so they are safe.
  - The open outline is cut at X 10…50, the drawn line. The closed control is cut at X 8.413…51.588.
  - So the part comes out 3.175 mm small in X and in Y.
  - `prepareOutput` advisories `[]`, `runCncPreflight` `[]`, and the real Job Review model (`prepareCurrentStartJob` → `buildJobReviewModel`) has no line about it.
  - An Inside profile makes the hole too large in the same way.
- **Evidence:** REPRO on main.
  - `zz-m6-open-profile.test.ts`: `svg open (0.05 gap): closed=[false] cutX=[10, 50] advisories=[] preflight=[]`; `dxf 4 LINEs gap 0.01: closed=[false] cutX=[0, 40] … preflight=[]`.
  - `zz-m6-open-profile-review.test.ts`: the Job Review strings for the open case mention only the WCO notice and the tool line.
- **Why not "documented":** WORKFLOW.md is not a warning that reaches the operator. §3 makes a silent size error P1 however few files trigger it.
- **Refuter:** **CONFIRMED, P1 kept**, with one evidence correction.
  - **Repro on HEAD** (`zz-m6r-open-profile`):
    - SVG outline open by 0.05 mm or 0.001 mm: cut at X 10…50. The closed control is cut at 8.413…51.588.
    - **Inside profile**, open by 0.05 mm: cut at X 10…50. The closed control is cut at 11.588…48.413, so the hole comes out 3.175 mm too large.
    - DXF LINEs with a 0.01 or 0.2 mm gap: cut on the line.
    - `prepareOutput` advisories and `runCncPreflight` are `[]` in every case. An SVG that ends exactly on its start without `Z` is read as closed.
  - **Correction: Job Review is not silent for an Outside profile.**
    - The meta repro filtered on `/open|on.path|closed|offset/`, so it missed the ADR-433 minimum-feature line.
    - The real model (`zz-m6r-open-profile-review`) shows: `Layer "pocket-main": 1 gap between cut shapes or lines narrower than the 3.17 mm bit … so it stays uncut; narrowest 0.05 mm at X 100 · Y 100 mm`. It shows the same line for a 0.001 mm gap ("under 0.01 mm") and for a 1 mm gap.
    - This does not lower the rating. The line points at the right corner, but it describes a sliver left uncut, not a profile cut on its line and a part 3.175 mm small. It is not a clear warning of the actual output.
    - An Inside profile (0.05 mm gap) and an Outside profile with a gap of 4 mm or more (at least the bit) get no line at all.
  - **Is it documented?**
    - WORKFLOW.md:5411-5413 states the fallback, and `profile-paths.ts:8-9` adds "matching Easel". WORKFLOW is a Contract source, so the code meets its own contract. The finding rests on the Twin and Ground-truth anchors.
    - The Easel claim does not hold up. On the Easel forum (`forum.easel.com/t/importing-svg-files/74108`, 2019-06-12, fetched 2026-10-26), a user quotes Easel's own message: "check for open paths and join them before importing". A reply says closing the path is what lets you "choose 'outside' path".
    - That is forum evidence, not docs: UNVERIFIED as a docs source. Nothing found shows Easel silently cutting an Outside-selected open path on its line.
    - The Vectric anchor comes from F3's text and was not re-fetched.
  - **§3:** a WORKFLOW line does not reach the operator, and KerfDesk silently replaces the Outside cut the operator chose with On path. So P1 stands.
  - **Consistency with 03-P2-9:** M6 Part B keeps 03-P2-9 (the laser twin) at P2. That is consistent. LightBurn documents kerf offset as closed-only (03 refuter), so the laser output matches the reference app and only the disclosure was missing. See M6-R1 for that finding's unfixed band.
  - **X5 is overstated.** `line-open-outline-issues.ts:8-10` says CNC "already say[s] when [it leaves] open contours out". That is true for V-carve, Pocket and Drill. The comment does not claim that profiles warn; it is incomplete, not false.
- **Fix direction:**
  - Report open contours on Profile Outside and Profile Inside as the laser Line advisory does: count the open contours per artwork, and say they are cut on the line, not offset.
  - Better, join them at the Line advisory's 0.5 mm, or offset open paths to the side as Vectric does.

### M6-P1-3 — Wrong severity (M1-P2-1): a hole's lead burns 1.45–1.62 mm into a plate whose outline is left 0.6–1 mm open; lowered to P3, still on main
- **Corrects:** M1-P2-1. The M1 auditor rated it P2 because "the trigger … is a drawn gap over 0.5 mm"; the M1 refuter lowered it to P3 as a "contract question".
- **Kind:** Wrong severity.
- **Where:**
  - `src/core/job/laser-lead-open-outlines.ts:37-38`: `OPEN_OUTLINE_GAP_MM` = 0.5.
  - The lead files are unchanged on main.
- **Anchor:**
  - **Contract:** ADR-626 clause 4 (as M6-P1-1).
  - **§3:** reach and "unusual trigger" can lower only an unreachable defect. A refuter must show either that the output is not wrong or that a warning reaches the operator.
- **Scenario:** an 80 mm plate drawn as one open polyline with a corner gap, an r5 hole, and Line leads on with automatic side.
  - Gap 0.6 mm or 1.0 mm: the hole's lead reaches 1.449 mm (arc) or 1.620 mm (line) from the hole edge into the plate. There are no advisories.
  - Gap 0.4 mm: nothing burns in the plate (side-unknown).
  - M1's own DXF runs gave 1.49–1.99 mm.
- **Evidence:** REPRO on main, `zz-m6-open-gap-lead.test.ts`: `gap 0.6 line: lit samples in plate material=326 worst 1.620 mm … advisories=[]`.
- **Why the lowering fails:**
  - "Realism", LightBurn parity and an ADR boundary are not among §3's lowering conditions.
  - ADR-626 Amd 8 does not list this consequence under "Not covered".
  - It stays P1 until the maintainer accepts it in the ADR and Job Review names it.
- **Refuter:** **CONFIRMED, P1 kept.**
  - **Repro on HEAD** (`zz-m6r-open-gap`, the M6 plate):
    - **Gap 0.45 or 0.49 mm:** `laser-leads-side-unknown` and `line-open-outline` fire. Nothing reaches the plate beyond the 0.245 mm noise floor of the hole's own cut.
    - **Gap exactly 0.5 mm:** the lead burns 1.449 mm (arc) or 1.620 mm (line) into the plate, with no side-unknown. Only `line-open-outline` fires, and it names the outline's own missing lead, not the hole's lead.
    - **Gap 0.6, 1.0 or 3.0 mm:** the same burn, and nothing at all is reported.
    - **Real Job Review at 0.6 mm** (`zz-m6r-lead-review`): no lead line and no open-outline line.
  - **Is a documented ADR boundary a reason under §3? No.**
    1. §3 names only two ways to lower a P1: the output is not wrong, or a clear warning comes first. "The ADR drew the line at 0.5 mm" is neither, just as "the trigger is rare" is neither.
    2. ADR-626 Amd 8 sets a detection limit; it does not say the output past it is right.
       - Decision 1 sends wider gaps "for Join paths". But nothing tells the operator to use Join paths above 0.5 mm, because decision 4's advisory stops at the same 0.5 mm.
       - "Not covered" names a different case.
       - Clause 4 and "Why this is better" still promise that a lead never ends inside another part.
    3. The output is wrong under both of the M1 refuter's own readings, "a deliberate bridge or a gross drafting error": either way the plate is the kept part.
       - The product's own rule makes the side unknown for lines 0.49 mm apart. Lines 0.6 mm apart are no less ambiguous, so the twin anchor holds.
    4. LightBurn parity does not make the output right here. ADR-626 promises to do better than LightBurn on exactly this point ("LightBurn places it regardless").
    5. The contract breaks even inside its own boundary. Amd 8 decision 2 says lines that "stop up to 0.5 mm short" leave the side unknown, yet at exactly 0.5 mm the lead still burns: the detector closes gaps of 0.48 mm or less.
  - **What the maintainer decides:** the fix, either a wider band (for example lead length + kerf) or a Job Review line, and any ADR amendment. Under §3 the rating falls only when the output changes or a clear warning names it.
- **Fix direction:** As M1 proposed: under automatic side, treat a contour as side-unknown when open Line paths come within lead length + kerf of closing round it, or name such outlines in Job Review.

### M6-P2-1 — Wrong clean claims (C4, C5; also the C3 dropped "stale envelope" reason): a comment or `/` in a `$` key slips past the Console's persistent-command block, the setting-write confirmation, the value check and the settings re-read
- **Corrects:**
  - C4 Verified clean: "The Console check reads the value as GRBL's line reader does".
  - C5 Verified clean: "Spelling … `$rst = *`, `$RST=&` blocked".
  - C3's dropped reason: "Every `$N=` write clears the observation before dispatch".
- **Kind:** Wrong clean claim.
- **Where (origin/main):**
  - `src/core/controllers/grbl/console-command.ts:79`: the `$` line is compacted for spaces and tabs only.
  - `:88`: `SETTING_WRITE_RE` is tested on that compacted form.
  - `:227-233`: `isBlockedPersistentCommand` matches `^\$RST=`, `^\$N\d*=` and `^\$I=` on the same form.
  - `:104`: anything else becomes kind `gcode` with `requiresConfirmation` false.
  - `src/ui/state/laser-console-settings-write.ts:27`: the settings snapshot is invalidated and re-read only for kind `setting-write`.
  - The intent in the code comment above `:79`: "so spaces cannot disguise a persistent write/reset as ordinary G-code".
- **Anchor:**
  - **Ground truth:** gnea/grbl `protocol.c` @ `bfb67f0c` (fetched 2026-10-26), `protocol_main_loop`.
    - Comments are dropped while the line is collected: "Enable comments flag and ignore all characters until ')' or EOL".
    - So is `/`: "Block delete NOT SUPPORTED. Ignore character."
    - This happens before `else if (line[0] == '$')` hands the line to `system_execute_line`.
  - **Contract:** the Console's own policy (ADR-375 C-4; settings-console audit).
- **Scenario:**
  - `$22(x)=0.5` is sent with no confirmation and no value check. GRBL runs `$22=0.5` and stores 0: homing and soft limits are off, and it answers `ok`. KerfDesk's `$$` snapshot still says `$22=1`, because no re-read is scheduled.
  - `$N(x)0=G0X100` stores a startup block that moves the machine on every reset.
  - `$RST(x)=*` restores EEPROM defaults, for example `$30` and `$32`, with no prompt.
  - `$30(x)=255` leaves the old `$30` in the snapshot that Start's power scale reads. This last effect is READ only.
- **Evidence:** REPRO on main.
  - `zz-m6-console-disguise.test.ts`: `$RST(x)=* -> kind=gcode wire="$RST(x)=*\n" confirm=false effect=machine-state issue=none`, the same for `$/RST=*`, `$N(x)0=G0X100`, `$N/0=G0X100`, `$I(x)=x` and `$30(x)=255`. The plain forms are refused, or confirmed and checked.
  - `zz-m6-functions.test.ts`: `$22(x)=0.5 -> kind=gcode … issue=none | GRBL reads $22=0.5`.
- **Severity:** P2.
  - It needs an operator-typed or saved-macro spelling; there is no import path for macros (C5).
  - The effects reach persistent motion and stale power evidence. That is a local-access weakness with a clear failure scenario.
  - Not checked on grblHAL or FluidNC.
- **Refuter:** **KNOWN as controller v2 C5-P3-1.**
  - **Same defect:** same file and line (`console-command.ts:79`), same mechanism, and the same spellings: `$RST(x)=*`, `(x)$N0=`, `(x)$I=`, `$32(x)=0`, `(x)$22=0.5`.
    - The `/` form is rolling-v2 17-P3-2, and `$22.0=` is C4-P3-1.
    - The meta correction stands as a **wrong severity of C5-P3-1**, and it is **raised to P1**.
  - **The clean claims are overstated.**
    - C5's "Spelling … blocked" covers case and spaces. The same report raised the comment form as its P3-1, and says so in its headline.
    - C4's value-check claim covers lines classified as setting writes. C5 lists `(x)$22=0.5` as "a further spelling" of C4's K-2.
    - So the gap was disclosed, at P3.
  - **No fix since C5:**
    - The `$` classifier in `console-command.ts` last changed on 2026-09-29 (`dc7fac96b`).
    - #1379 changed only the grblHAL value checks in `console-setting-writes.ts`. #1410 did not touch the classifier.
    - #1417's `936b517bc` changed only `TOOL_COMMAND_RE` (G43, G43.2 and M61).
    - `trackConsoleWcs` (`frame-wcs-selection.ts`) still re-reads the WCS only for `stateEffect === 'reference'`.
  - **Classifier repro on HEAD** (`zz-m6r-console`):
    - These are each sent as `gcode`, unconfirmed, effect `machine-state`, no issue: `$RST(x)=*`, `(x)$RST=*`, `$N(x)0=G0X100`, `(max power) $30=255`, `$22(x)=0.5`, `$H ;home` and `(home) $H`.
    - Trailing comments are caught: `$RST=* ;wipe` and `$N0=G0X100 ;start` are refused. `$30=255 ;max power` is a confirmed setting write. `$22=0.5 ;x` fails the value check.
    - So the hole is a leading comment, or a comment or `/` inside the key. A labelled macro line such as `(max power) $30=255` is the natural trigger.
  - **Store repro** (`zz-m6r-console-store`): the real `sendConsoleCommand` over a fake stock-GRBL session, with `$30=1000` observed.
    - `(x)$30=255`, `$30(x)=255` and `$/30=255` are each sent, and the controller answers `ok`.
    - `controllerSettings.maxPowerS` stays 1000 and its observation is kept. `resolveLaserPowerScale`, which Start binds, returns `1000/controller`.
    - GRBL now holds `$30=255`. Every layer above 25.5 % is sent with S above 255 and burns at full PWM, while Job Review shows the % that was set.
    - Nothing re-reads `$$` before Start: `laserPowerScaleStillCurrent` only compares epochs.
    - By contrast, a plain `$30=255` is confirmed and read back.
  - **Severity:**
    - C5 kept P3 because "every case needs the operator to put a comment into a $ command". That is a reach argument. Under §3, reach lowers a finding to P3 only when the defect is unreachable, and a Console line or a saved macro reaches this one today.
    - **The `$30` case is P1 by effect.** It is the 03-P2-4 class: a 50 % layer burns at full power while Job Review shows 50 %. M2-P3-2 corrected 03-P2-4 to P1.
    - **The `$H ;home` case** with a stored non-G54 startup block gives E4-P1-1's split, where Frame traces in one WCS and the job runs in another. This rests on a READ of the code plus C5's store repro; it was not re-run end to end.
    - **The `$RST`, `$N` and `$I` cases alone are P2:** ADR-362 decision 1 is broken, with a clear scenario.
      - `$RST=*` makes GRBL reset and send its banner, which clears KerfDesk's evidence (C5 refuter). That case is a bypass of the block, not stale state.
  - **Severity change:** M6-P2-1 P2 → P1, which corrects C5-P3-1 from P3 to P1.
  - The fix direction as written (classify the line in the form GRBL collects, as `normalize-external-program.ts` does) also closes 17-P3-2 and C4-P3-1.
- **Fix direction:**
  - Classify a `$` line on the form GRBL collects: drop `(...)`, `;…` and `/` as `protocol.c` does, not only spaces.
  - Or refuse `(`, `)`, `;` and `/` before the `=` of a `$` line.

### M6-P2-2 — Wrong severity (F7-P2-3 lowered to P3): a closed hole smaller than half the bit, on a Pocket or Inside-profile layer, is dropped without a word; it is still on main
- **Corrects:** F7-P2-3's lowering from P2 to P3 "because ADR-433 Decision 3 is explicit".
- **Kind:** Wrong severity.
- **Where:**
  - `src/core/min-feature/min-feature-analysis.ts:74`: `MIN_EXTENT_FACTOR = 0.5`, unchanged on main.
  - #1418's ADR-433 Amendment 2 covers only the straight inlay pair.
- **Anchor:**
  - **Twin:** a hole from half the bit up to the bit gets ADR-433's "stays uncut" warning; a smaller one, more certainly uncut, gets nothing.
  - **Twin:** `cnc-layer-empty` exists because a silent omission is found "after the cut" (`cnc-preflight.ts`).
  - **Contract (METHOD §3):** P3 is "latent, doc/code drift, missing test, or polish". This is none of those.
- **Scenario** (F7 auditor and refuter REPRO): a 2 mm screw hole on a 1/4"-bit Inside-profile or Pocket layer comes out uncut. Job Review is silent, while a 3 mm hole on the same layer is warned.
- **Evidence:** READ on main, plus the F7 auditor's and refuter's REPROs.
- **Why the lowering fails:** the ADR decides the speck rule, but the twin anchor does not depend on that ADR. ADR-433's stated reason for the rule (laser specks that the beam rounds off) does not fit a whole CNC hole. It is reachable and ordinary, and the result is misleading.
- **Refuter:** **CONFIRMED at P2.**
  - **The original ruling was contract-based, not reach-based.**
    - The F7 refuter relied on ADR-433 decision 3, which keeps every hole at least half the threshold across and so drops smaller ones. Amendment 1 kept the factor for CNC.
    - So this is not the §3 reach error.
  - **But the contract basis cannot produce a P3.**
    - METHOD §3 defines P3 as latent, doc/code drift, a missing test or polish. It has no slot for a contract question.
    - If the decided behaviour were right, the finding would be REFUTED. Once it is CONFIRMED, its scenario sets the severity.
    - The F7 refuter confirmed it and agreed that the rule's only stated reason, laser specks, does not fit a whole CNC hole.
  - **Not P1:** a 2 mm hole cannot be cut with a 6.35 mm bit, so the program is the best the bit can make, and the defect is disclosure only.
  - **P2:** an ordinary user gets a misleading result, since a 3 mm hole warns and a 2 mm hole does not.
  - Not re-run: READ, and the code is unchanged (`MIN_EXTENT_FACTOR = 0.5`). The F7 auditor's and refuter's REPROs stand.
- **Fix direction:** As F7 proposed: report every closed CNC Pocket or Inside-profile contour that compiles to nothing, or exempt closed contours from the speck rule on CNC.

### M6-P2-3 — Wrong severity (M1-P2-2 lowered to P3): parts on two CNC profile operations placed closer than the bit are cut into, and only the one-operation layout warns; it is still on main
- **Corrects:** M1-P2-2's lowering to P3 as "KNOWN (ADR-250 Amd 3 Verification)" and "ADR-433 decision 1 is per operation by design".
- **Kind:** Wrong severity.
- **Where:**
  - `src/core/min-feature/operation-targets.ts:238` (M1's citation).
  - Main has no cross-operation width check: a grep of `src/core/min-feature` and `src/core/preflight` finds none.
- **Anchor:**
  - **Twin:** the same layout on one operation gets an ADR-433 gap warning.
  - **§3:** a silent gouge into a kept part.
- **Scenario** (M1 REPRO): parts 2.5 mm apart on two operations with a 1/8" bit.
  - Each contour cuts 0.676 mm into the other part.
  - min-feature reports 0 gaps. The only Job Review line is the lead-plunge advisory, about a mark.
- **Evidence:** READ on main, plus the M1 auditor's and refuter's REPROs.
- **Why the lowering fails:**
  - An ADR's Verification table is not a tracked finding; no ledger row carries this one.
  - "Per operation by design" fixes the scope of the check. It does not make the silent result correct.
  - It is P2 at least. Under §3 the refuter should also weigh P1, as for M6-P1-1: the drawing cannot be cut as drawn, and nothing says so.
- **Refuter:** **CONFIRMED at P2.** P1 is not supported.
  - **The M1 refuter's lowering mixed three reasons, and none of them is a ground for P3.**
    - **KNOWN, from ADR-250 Amd 3's Verification note.** KNOWN is a novelty label, not a severity. A PR's verification note is not a tracked finding. The same-operation sibling, 2026-09-29 P2-review-3, is itself an open P2.
    - **Contract:** "per operation by design; no ADR promises a cross-operation check".
    - **"The operator's layout":** this is a reach argument.
    - The twin anchor (one operation warns, two operations do not) stands on its own.
  - **P1 was weighed and rejected.**
    - Each contour is cut exactly where it is drawn, at the correct offset. The gouge comes from a layout that cannot be cut with that bit.
    - Unlike M6-P1-1's leads or M6-P1-2's silent switch from Outside to On path, KerfDesk adds nothing that reaches the other part.
    - That meets §3's "the output is not wrong" condition. What is missing is disclosure, which is P2.
  - Not re-run: READ, and `operation-targets.ts` is unchanged.
- **Fix direction:** Run the ADR-433 gap check across the CNC operations that cut through the same stock, or warn when two operations' outside contours are closer than the larger bit.

### M6-P3-1 — Wrong severity (12-P2-1 lowered to P3): the product treated it as a bug and fixed it (#1437)
- **Corrects:** the 12-P2-1 refuter's P2 → P3 lowering, which relied on ADR-500 Amd 1 §2 ("Open uses the document's machine").
- **Kind:** Wrong severity (record).
- **Evidence:**
  - #1437 (merged 2026-10-25) describes the behaviour as a bug: the calibration was "silently dropped … for the session" and "lost for good" after a machine edit.
  - The fix adds ADR-440 Amendment 3, "calibration belongs to the machine", and an info toast.
  - The twin anchor (retired camera results) and the misleading "Calibrated" readout stood all along. The rating should have stayed P2.
- **Refuter:** **CONFIRMED** (spot-checked).
  - #1437 (`3ae0393e6`, merged in `8988b97ea`) adds `withCurrentMachineCamera` in `project-bed-reconciliation.ts`.
    - When the opened file's device identity matches the machine in use, the current calibration is kept and an info toast says so.
    - That is exactly 12-P2-1's scenario: same profile id, name and bed.
  - The commit message calls the old behaviour a silent drop.
  - The 12 refuter's lowering was contract-based (ADR-500 Amd 1 §2), and the maintainer has since reversed that contract (ADR-440 Amd 3).
  - Record 12-P2-1 as P2, fixed by #1437.
- **Fix direction:** Record 12-P2-1 as P2, fixed by #1437 (Corrected by meta-v1 M6).

### M6-P3-2 — Wrong severity (F2-P2-2; F1-P2-1 with F5-P2-2 merged): kept at P2 while F2-P1-1 was restored to P1 for the same consequence
- **Corrects:** the CNC v1 LEDGER rows F2-P2-2 and F1-P2-1. Contradiction X6.
- **Kind:** Wrong severity (record; all fixed).
- **Evidence:**
  - **F2-P2-2:** a 1.65 × 36 mm fin standing the full 3 mm, the ladder reporting `complete`, Job Review `[]`. The refuter kept P2 "on the METHOD's own terms".
  - **F1-P2-1 with F5-P2-2:** 0.18–0.55 mm floor fins, and an inlay plug seated 0.37–0.67 mm short with an open seam, with default settings and no warning.
  - **F2-P1-1:** the coordinator restored it to P1 under §3 for full-depth stock pins that the verifier certified.
  - **Fixes:** #1421 (rest ladder core ring), #1422 (floor reaches inside corners), #1418 (inlay seating test).
  - A11/A12 on main found no gouge or rapid hit in the rest and adaptive programs. They do not measure coverage.
- **Refuter:** **PLAUSIBLE.** Not re-run; all of it is fixed.
  - The consistency argument is strong for F2-P2-2: a fin stands at full depth while the ladder reports complete, which is the same consequence as F2-P1-1's pins.
  - For F1-P2-1, the 0.18–0.35 mm floor fins make a weaker case for P1. The inlay plug seated 0.37–0.67 mm short, with an open seam, is what carries it.
- **Fix direction:** Record both as "P1 by effect under METHOD §3, fixed" (Corrected by meta-v1 M6).

### M6-P3-3 — Wrong clean claim (C8): "Jogs and Frame are immune to the feed override" is false on the Falcon A1 Pro contract
- **Corrects:** C8 Verified clean, Overrides, bullet 5. Contradiction X3.
- **Kind:** Wrong clean claim.
- **Where:** `src/core/controllers/falcon-command-contract.ts:35-36,73`. Jog (`buildFalconJog`) and Frame (`buildFalconFrame`) write `G1 … S0`, because `$J` is disabled by the vendor contract, and the GRBL realtime overrides remain available.
- **Scenario:** a feed override left at 200% (or 10%) after a job. On a Falcon A1 Pro, the next Frame and every jog run at that multiple, while C8 states that they ignore it.
  - The beam stays dark (`M5`, `S0`), so P3.
  - Marlin and Smoothieware also jog with `G0`/`G1`, but they have no realtime overrides.
- **Evidence:** READ (main), plus the D6 refuter's REPRO `D6R-FRAME`.
- **Refuter:** **CONFIRMED** (spot-checked, READ on HEAD).
  - `buildFalconJog` writes `M5`, `G21 G91`, then `G1 … F… S0` (`falcon-command-contract.ts:73`). The Falcon Frame uses `buildFalconFrame`.
  - The generic GRBL driver frames with `buildGrblFrameJogLines` (`$J=`, `grbl/driver.ts:88`).
  - So the C8 sentence holds only for the generic driver.
- **Fix direction:** Correct the C8 sentence ("`$J=` jogs and Frame"). Consider sending the feed-override reset ahead of a Falcon Frame, as laser Start does.

### M6-P3-4 — Contradiction (ADR-497 decision 3 vs the LightBurn page E5 cites): ADR-497's order is the right one, but the ADR does not record that it departs from LightBurn
- **Corrects:** E5's dropped item ("LightBurn runs lowest interval first and KerfDesk widest first: this is deliberate (ADR-497 D3)") and ADR-497. Contradiction X1.
- **Kind:** Contradiction.
- **Evidence:**
  - **LightBurn Material Test 2.1** (fetched 2026-10-26):
    - The order is "determined according to an ascending list of potential risk of burning or charring material".
    - The run-first sentence reads "highest Speed, lowest Power, lowest Interval, and fewest Passes will run first".
  - **LightBurn Interval Test** (latest, the 2.2 RC):
    - It defines "Line Interval is the distance between scan lines".
    - A lower interval means "a higher density of scan lines".
    - It states no burn order.
  - So LightBurn's interval rule contradicts its own principle: the lowest interval is the densest, highest-energy cell.
  - ADR-497 decision 3 ("widest hatch spacing … the first cell burned is the gentlest") follows the stated principle and is physically right. E5-P2-3's anchor ("LightBurn's ascending risk order") agrees.
  - **What is missing:** ADR-497 never mentions LightBurn's interval order, and the maintainer's standing rule is to copy LightBurn. The departure is undocumented.
- **Refuter:** **CONFIRMED.**
  - I re-fetched LightBurn Material Test 2.1 on 2026-10-26. It says "boxes with the highest Speed, lowest Power, lowest Interval, and fewest Passes will run first", ordered as an "ascending list of potential risk".
  - ADR-497 mentions LightBurn only as the source of the gap (line 5) and, in Amendment 1, for the hatch floor.
  - Decision 3 (line 31) records widest-first with no note that this departs from LightBurn.
- **Fix direction:** Add one sentence to ADR-497 (or its Amendment 1) recording that the interval order deliberately departs from LightBurn's list, and why.

### M6-P3-5 — Contradiction (D6 report vs D7): the D6 row "grblHAL, native USB / network: (no banner)" is still uncorrected in the D6 report
- **Corrects:** `docs/audits/2026-10-22-controller-v3/D6-ctl-detect-identify.md:95`. Contradiction X2.
- **Kind:** Contradiction / stale record.
- **Evidence:**
  - D7-P2-1 (confirmed, fixed by #1397): grblHAL `telnetd.c` greets every new client.
  - D7-R1 (plausible): native-USB builds send the banner about 200 ms after the port opens.
  - The v3 LEDGER note and AREAS.md mention the correction, but the D6 table row and D6-P3-2's premise ("no banner on open") still read as fact.
- **Refuter:** **CONFIRMED** (spot-checked).
  - `D6-ctl-detect-identify.md:95` still reads "grblHAL, native USB / network | *(no banner)*".
  - Only the v3 LEDGER's D7-P2-1 row says "D6's … row is wrong".

### M6-R1 (REFUTER-RAISED, P2) — 03-P2-9's unfixed band: a plate left open by more than 0.5 mm, on a Line operation with a kerf offset, silently loses compensation, and its hole is offset outward
- **Corrects:** the Part B row "03 C-K-1/C-K-2 → P2-9 … OK. P2-9 was fixed by #1345". #1345 fixed P2-9 only for gaps up to 0.5 mm.
- **Kind:** Fix incomplete. It is the kerf twin of M6-P1-3.
- **Where (HEAD `505fb2ccf`):**
  - `src/core/preflight/line-open-outline-issues.ts:68` joins open paths only at `OPEN_OUTLINE_GAP_MM` (0.5 mm).
  - ADR-626 Amd 8 decision 4 sets the same boundary.
  - Open paths are never kerf containers (ADR-486 Amd 2 and Amd 3).
- **Anchor:** Twin. The same plate left open by 0.3 mm gets `line-open-outline` ("no kerf offset … Join paths"); left open by 0.6 mm, it gets nothing.
- **Scenario:** an 80 mm plate drawn as one open polyline with a corner gap, an r5 hole, and a Line operation with Kerf Offset 0.2 mm.
- **Evidence:** REPRO, `zz-m6r-open-kerf` (`prepareOutput`, `emitPreparedGcode` and `lineOpenOutlineIssues`):
  - **Closed plate:** hole R 4.800, plate X 99.8…180.2.
  - **Gap 0.3 mm:** hole R 5.200, plate 100…180, and `line-open-outline` fires.
  - **Gap 0.6 or 1.0 mm:** the same geometry (hole 0.8 mm too large in diameter, plate 0.4 mm small), with `line-open-outline` `[]` and advisories `[]`.
- **Severity:** P2, not P1.
  - For leads, ADR-626 promises to do better than LightBurn. For kerf it promises nothing of the kind: kerf on open shapes follows the closed-shape rule that the 03 refuter verified against LightBurn's docs.
  - So the output matches the reference app's, and what is missing is the disclosure #1345 added for gaps up to 0.5 mm.
  - It is reachable, with a misleading result.
- **Novelty:** close to 03-P2-9 and M6-P1-3, but not raised anywhere:
  - M1 tested the band above 0.5 mm for leads only.
  - M2 did not re-verify 03-P2-9.
- **Fix direction:** fix it alongside M6-P1-3. Name the outline whenever joining nearby open Line paths would change a closed contour's kerf side or close a kerf-offset outline, not only within 0.5 mm.
- **Fix direction:** Annotate the row: "may greet on connect (network: always; native USB: build-dependent) — Corrected by D7 / meta-v1 M6".

## Refuted (own candidates, dropped)

- **F6 "two-sided off cuts side B into the part" is a live P1.**
  - Not reproduced on main. A 10 → 4 mm wedge was split at 5 mm with a 1 mm web on 14 mm stock, through the real `splitReliefForTwoSides`.
  - With `cncSetup.twoSided` removed, the program cut deeper than side A alone in 0 cells (0.25 mm grid).
  - There are no warnings either, but there is no damage to warn about for this model.
- **E4's canonical-line claim is broken by nested or stray parentheses.** No: KerfDesk keeps exactly what GRBL keeps, for example `G1X10c)Y5` against GRBL's `G1X10C)Y5`.
- **D7's FluidNC Telnet claim is wrong.** Moot: #1397 treats every network banner as a possible greeting.
- **03 "scan offset … interpolated and clamped as ADR-052 says" contradicts D8 ("scaled from rest below the first sample").** No: ADR-052 states both halves (`DECISIONS.md` ADR-052 lines 39-40).
- **C2's dropped "Frame's G54 selection voids G55 evidence" contradicts E4-P1-1.** Consistent: C2 assumed that the store knows the WCS, and E4-P1-1 is the case where it does not (fixed by #1413).
- **C3's dropped "Frame corner on the homing edge" contradicts 12-P2-3.** Consistent with ADR-375 decision 3: manual moves are clamped, Frame and job are not.
- **02 R-5 still lacks hardening.** No: it is hardened (`commitProjectEditNow`).

## Verified clean

- A1–A5 and A9–A14 above hold on origin/main `adf300522` with fresh designs, dialects and settings.
- Totals: 4,768 lit moves checked for air and joins; 1,614 resumes on Marlin and Smoothieware; 169 below-Z0 rapids against a height field; 200,000 depth ladders; every jog builder caller.
- The merges F6-P2-1 → 16-P2-1 and F5-P2-2 → F1-P2-1 lost no consequence; both are written into the target rows.
- The lowerings of 06-P2-1, 23-P2-4, 26-P2-1, C7-P2-1 and D3-P2-2, and the refutation of M4-P3-6, stand under the clarified §3.

## Not verified

- **No hardware.** Console disguises were checked against `protocol.c` and KerfDesk's classifier, not on a board. grblHAL and FluidNC line collection was not checked.
- **`$30(x)=255` and Start's power scale** are READ only: the snapshot is not invalidated, but the path to `connected-laser-power-scale` was not run.
- **Job Review rendering:** only model strings and `preflight.issues` were read; the UI was not checked.
- **M1-P2-1** was re-run with an open polyline, not a DXF. **M1-P2-2** and **F7-P2-3** were not re-run on main: their code is unchanged (READ).
- **16-P2-1** (gouge inside ADR-412 Amd 1's half-cell bound) and the older KNOWN items (09-29 K-2 overlapping reliefs, K-5 simulator retract) were not re-rated. They belong to M7's older-audit scope.
- **The F6 two-sided-off candidate** was tried with one wedge model only.
- **The rolling-v2 auditor-dropped candidates** (about 70) were read, not re-run.

```json
[
  {"id":"M6-P1-1","severity":"P1","area":"meta-clean-and-refuted","corrects":"rolling-v2 03 C-D-3 / P3-10","kind":"Wrong disposition","file":"src/core/job/laser-lead-rings.ts","line":74,"anchor":"Contract ADR-626 clause 4 + 'Why this is better' vs Amendment 1 decision 1; METHOD §3 clarification","evidence":"REPRO","verdict":"CONFIRMED","known":"03 P3-10 (doc drift)","summary":"Under Cut selected graphics (or an output-off neighbour) lead obstacles come only from the prepared job, so a lead burns 0.914 mm (e2e) / 1.5 mm (function) into an unselected neighbour part with no warning; whole job: 0. P1 by effect on origin/main adf300522","refuter":"REPRO on HEAD 505fb2ccf (zz-m6r-lead-scope, zz-m6r-lead-review): gap 0.5 mm, A selected alone, 0.914 mm into the top neighbour, diagnostics []; output-off neighbours 0.914 mm; gap 1 mm 0.414 mm; whole job 0 with laser-leads-adjusted; the real Job Review for the scoped job has no lead line. Amd 1 D1 keeps the free-end checks on the prepared job but never states the consequence, and it counts unselected and output-off contours as part edges for the side; clause 4 and Why this is better are unamended. Not a §3 lowering reason; P1 kept"},
  {"id":"M6-P1-2","severity":"P1","area":"meta-clean-and-refuted","corrects":"CNC v1 F3 dropped candidate (open contours on Outside/Inside profiles)","kind":"Wrong disposition","file":"src/core/cnc/closed-contour-cut-types.ts","line":5,"anchor":"Twin laser line-open-outline (ADR-626 Amd 8) and cnc-open-contours-omitted; Ground truth Vectric open-vector offset; METHOD §3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An open outline (SVG 0.05 mm gap; DXF LINEs 0.01 mm gap) on a CNC Profile Outside layer is cut on the line (X10..50 vs 8.413..51.588 closed), part 3.175 mm small, prepare advisories [], preflight [], Job Review silent; line-open-outline-issues.ts:9 wrongly says CNC already reports it","refuter":"REPRO (zz-m6r-open-profile, zz-m6r-open-profile-review): SVG open by 0.05 or 0.001 mm and DXF open by 0.01 or 0.2 mm are cut on the line; an Inside profile open by 0.05 mm is cut at X10..50 (hole 3.175 mm too large); advisories and preflight []. CORRECTION: an Outside profile whose gap is narrower than the bit gets the ADR-433 Job Review line '1 gap ... narrower than the 3.17 mm bit ... stays uncut; narrowest 0.05 mm at X 100 Y 100', which the meta filter missed. It describes a sliver, not a part 3.175 mm small, so it is not a clear warning; Inside profiles and gaps at least the bit get nothing. The Easel parity claim (profile-paths.ts:9) is unsupported: the Easel forum quotes a message to join open paths (forum, UNVERIFIED as docs). P1 kept. X5 overstated: the laser comment is literally true"},
  {"id":"M6-P1-3","severity":"P1","area":"meta-clean-and-refuted","corrects":"meta-v1 M1-P2-1 (lowered to P3)","kind":"Wrong severity","file":"src/core/job/laser-lead-open-outlines.ts","line":37,"anchor":"Contract ADR-626 clause 4; METHOD §3 (no reach clause; lowering needs non-wrong output or a warning)","evidence":"REPRO","verdict":"CONFIRMED","known":"M1-P2-1","summary":"Plate outline open 0.6-1.0 mm with an r5 hole and leads on: the hole's lead burns 1.449 (arc) / 1.620 (line) mm into the plate, no advisory, on origin/main; lowered for an unusual trigger and an ADR boundary, which §3 does not accept","refuter":"REPRO (zz-m6r-open-gap, zz-m6r-lead-review): gaps of 0.45 and 0.49 mm give side-unknown and nothing burns; at exactly 0.5 mm the lead burns 1.449 / 1.620 mm with only line-open-outline, which is about the outline, not the hole; at 0.6, 1.0 and 3.0 mm the burn is the same, nothing is reported and the real Job Review is silent. An ADR detection boundary is neither §3 lowering condition. Amd 8 does not say the output past it is right; clause 4 is unamended; under both of the M1 refuter's readings (bridge or drafting error) the plate is a part; ADR-626 promises to do better than LightBurn; at exactly 0.5 mm the ADR's own 'up to 0.5 mm short' is already broken. P1 kept; the fix and the ADR wording are the maintainer's"},
  {"id":"M6-P2-1","severity":"P1","area":"meta-clean-and-refuted","corrects":"C4 and C5 Verified clean; C3 dropped 'stale envelope' reason","kind":"Wrong severity (C5-P3-1)","file":"src/core/controllers/grbl/console-command.ts","line":79,"anchor":"Ground truth gnea/grbl protocol.c @ bfb67f0c (comments and '/' dropped before system_execute_line); Contract Console policy ADR-375 C-4","evidence":"REPRO","verdict":"KNOWN","known":"controller-v2 C5-P3-1 (same file, line and spellings); '/' form rolling-v2 17-P3-2; $22.0= C4-P3-1","summary":"$RST(x)=*, $N(x)0=G0X100, $I(x)=x, $22(x)=0.5, $30(x)=255 and '/' variants are classified as plain G-code: no persistent-command block, no confirmation, no value check, no $$ invalidation, while GRBL strips the comment and runs them","severity_raised_from":"P2","refuter":"KNOWN as C5-P3-1; the classifier is unchanged since (dc7fac96b; #1379, #1410 and #1417 did not touch it). Store REPRO (zz-m6r-console-store): (x)$30=255, $30(x)=255 and $/30=255 are sent and answered ok; maxPowerS stays 1000 and its observation is kept; resolveLaserPowerScale gives 1000/controller while GRBL holds $30=255, so every layer above 25.5% burns at full PWM (the 03-P2-4 class, P1 per M2-P3-2). $H ;home skips the WCS re-read (E4-P1-1 class, READ). C5 kept P3 for reach; raised to P1. $RST, $N and $I alone would be P2. The C4 and C5 clean claims were scoped and the gap was disclosed, so this is not a wrong clean claim"},
  {"id":"M6-P2-2","severity":"P2","area":"meta-clean-and-refuted","corrects":"CNC v1 F7-P2-3 (lowered to P3)","kind":"Wrong severity","file":"src/core/min-feature/min-feature-analysis.ts","line":74,"anchor":"Twin ADR-433 half-bit-to-bit warning and cnc-layer-empty rationale; METHOD §3 P3 definition","evidence":"READ","verdict":"CONFIRMED","known":"F7-P2-3","summary":"A closed hole under half the bit on a Pocket/Inside-profile layer is dropped silently while larger uncut holes warn; reachable and misleading, so P2, not P3; unchanged on main","refuter":"The original lowering was contract-based (ADR-433 D3; Amd 1 kept the factor), not reach-based. But METHOD §3's P3 has no slot for a contract question: a confirmed finding takes its scenario's rating. Not P1, because a hole smaller than the bit cannot be cut, so only disclosure is missing. P2 kept (READ; code unchanged)"},
  {"id":"M6-P2-3","severity":"P2","area":"meta-clean-and-refuted","corrects":"meta-v1 M1-P2-2 (lowered to P3)","kind":"Wrong severity","file":"src/core/min-feature/operation-targets.ts","line":238,"anchor":"Twin one-operation ADR-433 gap warning; METHOD §3","evidence":"READ","verdict":"CONFIRMED","known":"M1-P2-2; ADR-250 Amd 3 Verification","summary":"Parts on two CNC profile operations 2.5 mm apart with a 1/8in bit cut 0.676 mm into each other with no gap warning; KNOWN only in an ADR verification table, not in any ledger; P2 at least, P1 to be weighed","refuter":"The M1 refuter's P3 rested on KNOWN (an ADR verification note; KNOWN is novelty, not severity), contract (per operation by design) and the operator's layout (reach). The twin stands. P1 rejected: each contour is cut as drawn and KerfDesk adds nothing that reaches the other part, so the output is not wrong; disclosure only, P2 (READ)"},
  {"id":"M6-P3-1","severity":"P3","area":"meta-clean-and-refuted","corrects":"rolling-v2 12-P2-1 (lowered to P3)","kind":"Wrong severity","file":"src/ui/state/project-actions.ts","line":64,"anchor":"PR #1437 / ADR-440 Amendment 3 (calibration belongs to the machine)","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Lowered as by design under ADR-500 Amd 1 §2, but #1437 fixed it as a bug and ADR-440 Amd 3 reversed the basis; record P2, fixed","refuter":"#1437 (3ae0393e6): withCurrentMachineCamera keeps the calibration in use, with an info toast, when the opened file has the same device identity. That is exactly 12-P2-1's scenario. The original lowering was contract-based, and the maintainer reversed the contract (ADR-440 Amd 3). Record P2, fixed"},
  {"id":"M6-P3-2","severity":"P3","area":"meta-clean-and-refuted","corrects":"CNC v1 F2-P2-2 and F1-P2-1 (with F5-P2-2 merged)","kind":"Wrong severity","file":"docs/audits/2026-10-23-cnc-v1/LEDGER.md","line":19,"anchor":"METHOD §3; consistency with the F2-P1-1 restoration","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"Full-depth rest fin and V-carve floor fins / short inlay seat were kept P2 while F2-P1-1's full-depth pins were restored to P1; record P1 by effect, fixed by #1421/#1422/#1418","refuter":"Not re-run (all fixed). Strong for F2-P2-2 (a full-depth fin while the ladder reports complete, as F2-P1-1). F1-P2-1's case for P1 rests on the short inlay seat rather than the 0.18-0.35 mm fins"},
  {"id":"M6-P3-3","severity":"P3","area":"meta-clean-and-refuted","corrects":"C8 Verified clean (overrides bullet 5)","kind":"Wrong clean claim","file":"src/core/controllers/falcon-command-contract.ts","line":35,"anchor":"Twin D6 refuter REPRO D6R-FRAME; GRBL feed override applies to G1","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Falcon A1 Pro jogs and Frames with G1 ... S0, so they follow a leftover feed override; C8 says jogs and Frame are immune","refuter":"READ on HEAD: buildFalconJog writes M5 / G21 G91 / G1 ... S0 (falcon-command-contract.ts:73), and the Falcon frames with buildFalconFrame; generic GRBL frames with $J (grbl/driver.ts:88), so C8 holds only for the generic driver"},
  {"id":"M6-P3-4","severity":"P3","area":"meta-clean-and-refuted","corrects":"E5 dropped item; ADR-497 decision 3","kind":"Contradiction","file":"docs/decisions/ADR-497-material-test-grids-vary-any-two-settings.md","line":30,"anchor":"Ground truth LightBurn Material Test 2.1 and Interval Test (fetched 2026-10-26)","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"LightBurn lists 'lowest Interval' first while claiming ascending risk (lowest interval = densest); ADR-497's widest-first is right but the departure from LightBurn is unrecorded","refuter":"LightBurn Material Test 2.1 re-fetched 2026-10-26: lowest Interval runs first, under an ascending-risk principle. ADR-497 D3 (line 31) records widest-first with no note of the departure"},
  {"id":"M6-P3-5","severity":"P3","area":"meta-clean-and-refuted","corrects":"D6 report table row (line 95)","kind":"Contradiction","file":"docs/audits/2026-10-22-controller-v3/D6-ctl-detect-identify.md","line":95,"anchor":"D7-P2-1 (grblHAL telnetd greets each client), D7-R1","evidence":"READ","verdict":"CONFIRMED","known":"v3 LEDGER note","summary":"The D6 row 'grblHAL native USB / network: (no banner)' is still uncorrected in the report although D7 showed grblHAL greets every network client and native-USB builds may greet on open","refuter":"D6-ctl-detect-identify.md:95 still reads \"(no banner)\"; only the v3 LEDGER D7-P2-1 row says it is wrong"},
  {"id":"M6-R1","severity":"P2","area":"meta-clean-and-refuted","corrects":"rolling-v2 03-P2-9 (recorded fixed by #1345; M6 Part B OK)","kind":"Fix incomplete (REFUTER-RAISED)","file":"src/core/preflight/line-open-outline-issues.ts","line":68,"anchor":"Twin: line-open-outline fires at a 0.3 mm gap, not at 0.6 mm; ADR-626 Amd 8 decision 4 boundary","evidence":"REPRO","verdict":"REFUTER-RAISED","known":"adjacent to 03-P2-9 and M6-P1-3","summary":"An 80 mm plate drawn open with a 0.6-1.0 mm corner gap, an r5 hole and a Line Kerf Offset of 0.2: hole R 5.200 (closed 4.800), plate 100..180 (closed 99.8..180.2), line-open-outline [] and advisories []; at 0.3 mm the advisory fires. P2: kerf on open shapes matches LightBurn's closed-only rule, so only the disclosure is missing"}
]
```
