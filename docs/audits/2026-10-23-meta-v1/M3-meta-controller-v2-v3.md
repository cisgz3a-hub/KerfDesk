# Meta audit v1 — M3 Controller v2 and v3 P1/P2s (`meta-controller-v2-v3`)

- **When:** 2026-10-23 10:05–10:45 (+08)   **Tree:** worktree source at merge-base `e660e0e5c`
  (worktree HEAD `948e8ef66`, audit docs only). Checked against origin/main `17f4d6b68`: its 33
  extra source files are #1411 (material test), #1412 (external-program expression and M0/M1
  checks) and #1413 (external-run controller state). On the fix paths sampled here they add only
  a program-stop warning list and an `externalProgram` flag to `external-run.ts`; they do not
  touch the `$30`/`$32` readiness, the lit-rapid scan or the Smoothieware baseline. Every other
  cited file is read with `git show origin/main:<path>`.
- **Scope:** the 23 P1/P2 rows of `docs/audits/2026-10-22-controller-v2/LEDGER.md` (C2-P1-1 and 11
  P2s) and `docs/audits/2026-10-22-controller-v3/LEDGER.md` (11 P2s, D7-R1 included), their
  reports, their fix PRs (#1376–#1382, #1385, #1388–#1392, #1397, #1398), the three severity
  changes (C7-P2-1 lowered, D2-P3-3 raised, D3-P2-2 lowered), and the "Verified clean" sections of
  C1 and D6.
- **Method:** METHOD.md with the meta changes in AREAS.md. All 23, not a sample.
  - **Genuine?** Pre-fix code read at each merge's first parent (`git show <merge>^1:path`). For
    three findings the pre-fix module was run against the fix PR's own test (see "Test truth").
  - **Merged?** `gh pr view <n> --json state,mergedAt,mergeCommit,files`.
  - **Effective?** Every fix PR's regression tests run on the current tree (15 PRs, 33 files, all
    pass). Independent re-runs of the original scenarios for C3, C4, C6-P2-1, C7-P2-2/P2-3,
    C8-P2-2, D2, D3-P2-1, D5-P2-1 and D7. One adjacent variant tried for each fix where one
    exists, including the D6 refuter's "grblHAL board behind a stock-GRBL profile" for #1379,
    #1382 and #1397.
  - **Primary sources re-fetched:** grblHAL core `stream.c` and `report.c` @ `4ec1ae44`, the grblHAL
    `changelog.md` (for `$384`), Marlin 2.1.2.8 `MarlinCore.cpp`, and Ortur's public grblHAL fork
    (`Ortur_Laser_Firmware_17X-18X`: `grbl.h`, `settings.h`, `config.h`). Copies are in the
    scratchpad `m3-src/`.
  - **Test runs:** `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <files>`,
    one process at a time. Repros were temporary `zz-m3-*` files, all deleted from the tree.
    Copies are in the scratchpad `m3-repros\`.
- **Counts:** 29 meta findings: P2 1 (M3-P3-3, **raised from P3 by the refuter**), P3 28. The
  JSON block has 30 entries: the umbrella M3-P3-1 plus these 29.
  - 23 stale records (M3-P3-1.01–.23, under the umbrella M3-P3-1);
  - 3 fixes that leave a gap (M3-P3-2, M3-P3-3, M3-P3-4);
  - 3 wrong severities, all already fixed, so record corrections (M3-P3-5, M3-P3-6, M3-P3-7).

  No false positive, no fix that fails in its own scenario, no wrong disposition. Own
  candidates dropped: 6 (see "Refuted").
- **Refuter (2026-10-23, fresh context):** confirmed 30 (all JSON entries), plausible 0, refuted 0.
  - Severity change: M3-P3-3 P3 → P2. The C4-P2-1 scenario reproduces in full on Ortur's shipped
    ESP32-S2 grblHAL family (LM2 Pro S1/S2, Aufero 1/2/4). Those boards are COMPATIBILITY_LEVEL 1
    and print "Grbl 1.1f". KerfDesk has no preset for them, so they run its default GRBL profile.
  - Record corrections confirmed: D4-P2-1, C6-P2-2 and D3-P2-1 are P1 by effect (M3-P3-5..7).
  - M3-P3-2 and M3-P3-4 stay P3. Corrections to their anchors are noted in place.
  - No REFUTER-RAISED finding. Repro `zz-m3r-variants.test.ts` was deleted; a copy is in the
    scratchpad `m3r-src\`, with the re-fetched grblHAL and Ortur sources.

## Headline

All 23 controller P1/P2s were genuine when raised, every one has a merged fix, and every fix
works on the current tree in the scenario its finding describes. Each fix PR's regression test
asserts the reported symptom, and the three reverted against their pre-fix module all fail
(C2-P1-1, D5-P2-1, D7-P2-1). The weak points are these:

- **The record.** All 23 ledger rows still read "fix card proposed".
- **The D6 refuter's warning was not carried through.** Fixes that read grblHAL's own behaviour
  from the driver or profile kind still miss a grblHAL board run under a stock-GRBL profile.
  - #1379 (C4-P2-1): `$100=26,67` still reaches such a board unchecked, and the new re-read check
    stays silent.
  - #1397 (D7-R1): its code comment assumes "Grbl 1.1f" builds run a grblHAL profile, which is the
    opposite of what D6-P3-3 found.
  - #1382 (C8-P2-2) records the same gap as still open in its ADR.
  - *Refuter: the C4 gap is P2, not P3. A grblHAL board behind a GRBL profile is the default
    for Ortur's ESP32-S2 lasers: level 1, "Grbl 1.1f", no KerfDesk preset (see M3-P3-3).*
- **#1379's force-origin read needs `$384`.** A level-0 grblHAL dump from before build 20210928
  lists no `$384`, so C3-P2-1 still reproduces on it with `$22=1`. The `$10` reader in the same
  file recognises the same dump as whole.
- **Three P2s meet METHOD §3's P1 test by effect, as 03-P2-4 did in M2.** D4-P2-1's refuter wrote
  "P1 is arguable, since the result is silent and physical" and kept P2 for reach. C6-P2-2 lit a
  fan-wired laser at the parked head after a "Frame complete". D3-P2-1 burned at ×1.96 while
  every on-screen figure agreed. All three are fixed, so these are record corrections.

## P1/P2 table

"Effective" means the original scenario no longer reproduces on the current tree. **Test
adequate:** **R** means the test was run against the pre-fix module and failed. **A** means its
assertion names the symptom that the auditor and refuter repros printed before the fix (read,
not run).

| ID | Genuine? | Fix PR (merge) | Merged? | Effective? | Test adequate? | Severity OK? | Ledger status OK? |
|---|---|---|---|---|---|---|---|
| C2-P1-1 | yes (pre-fix policy run: corner probe in a drained hold returns `ok`) | #1378 `3e90d92d8` | yes 10-22 13:09Z | yes; corner probe and Set/Reset/persistent origin refused in the hold, Z probe and Zero Z allowed; Console blocked by `isActiveJob` | **R** (fails: `{kind:'ok'}` vs `preflight-failed`) | yes (P1) | **no** (M3-P3-1.01) |
| C2-P2-1 | yes (no `activeWcs` update pre-fix) | #1378 | yes | yes (`acknowledgedWcsPatch`; sim test keeps probe Work-Z through Frame) | A | yes | **no** (.02) |
| C3-P2-1 | yes (`forceOrigin: … : null` for grblHAL pre-fix) | #1379 `1d64a4deb` | yes 14:27Z | yes on any dump with `$22`>1 or `$384`; **gap** on a pre-20210928 level-0 dump (M3-P3-2) | A (pins only a `$384` dump) | yes | **no** (.03) |
| C3-P2-2 | yes (`softLimitsEnforced` only) | #1379 | yes | yes (homed grblHAL `$20=0`: [−398, −2]) | A | yes | **no** (.04) |
| C4-P2-1 | yes (`driver.kind === 'grbl-v1.1' ? … : null`) | #1379 | yes | yes on the grblHAL driver (all four inputs refused); **gap** behind a GRBL profile (M3-P3-3) | A | yes (borderline: a silent 2.5 % scale change, but the value is typed malformed behind a prompt) | **no** (.05) |
| C5-P2-1 | yes (setting rows kept pre-fix) | #1377 `07b9ff462` | yes 11:48Z | yes (rows dropped and passwords masked; numeric `$75` nulled) | A (exact transcript rows asserted, so either layer reverted fails) | yes | **no** (.06) |
| C6-P2-1 | yes (Smoothieware baseline `G17G21G90G0`) | #1380 `972aba76c` | yes 12:42Z | yes (baseline now `G17G21G90G0` + `M221 S100`; oracle burns 0.5/0.5/0.25 after a Frame) | A (asserts `[]` burns for the old baseline) | yes (P1 rejected for a dark failure: defensible) | **no** (.07) |
| C6-P2-2 | yes (`echo:Home XYZ First` → message) | #1381 `8ce6fe4f2` | yes 12:33Z | yes (Frame, jog and job stop; advice names `G28 Z`) | A | **no: P1 by effect** (M3-P3-6) | **no** (.08) |
| C7-P2-2 | yes (`controllerKind: 'grbl-v1.1'`) | #1385 `af7dc4f21` | yes 13:43Z | yes (all three LM3 rows `grblhal`); saved `grbl-v1.1` copies are left to Job Review by ADR-660 §5, a stated decision | A | yes | **no** (.09) |
| C7-P2-3 | yes (fallback listed under Creality) | #1385 | yes | yes (withdrawn from the list; saved copies named in Job Review) | A | yes | **no** (.10) |
| C8-P2-1 | yes (`focusJogDirection` read `event.key` only) | #1376 `8dc125bff` | yes 12:05Z | yes (`isNumpadKey` by code or location; Shift+Numpad 3 also covered by code) | A | yes (borderline: a Z move from an XY key is "unexpected", but bounded to one focus step) | **no** (.11) |
| C8-P2-2 | yes (`statusReportMask` unused) | #1382 `f471476a2` | yes 12:16Z | yes on the grblHAL driver; stock-driver gap recorded "Still open" in ADR-375 Amd 2 (folded into M3-P3-3) | A | yes | **no** (.12) |
| D2-P3-3 (P2) | yes (F optional pre-fix) | #1388 `12e3f6fac` | yes 14:29Z | yes (`G38.2 Z-10` refused, F ≤ 150, `G38.3` refused) | A | yes, raise justified | **no** (.13) |
| D3-P2-1 | yes ("adjust the measurements"; unscaled default) | #1389 `46cb14e42` | yes 15:04Z | yes (new roller scales: 40 mm/turn, Ø25 → yScale 0.5093; miss advice names Scale Y) | A | **no: P1 by effect** (M3-P3-7) | **no** (.14) |
| D4-P2-1 | yes (CNC external run: attestation only) | #1390 `d507314b4` | yes 15:01Z | yes (Run review lists `laser-mode-enabled` and `spindle-scale-mismatch`) | A | **no: P1 by its refuter's own reasoning** (M3-P3-5) | **no** (.15) |
| D4-P2-2 | yes (fixed "4 s" advice) | #1391 `91c580c34` | yes 15:09Z | yes (advice names `spinup_ms`) | A | yes | **no** (.16) |
| D5-P2-1 | yes (pre-fix module run: 0 collisions) | #1392 `3547bcf38` | yes 18:40Z | yes (fresh comment line: radius 1.5875); both tool-comment readers now read by field name | **R** (2 fail: "expected 0 to be greater than 0") | yes | **no** (.17) |
| D5-P2-2 | yes (generic prompt only) | #1390 | yes | yes (lit-rapid warning; `$32` unread also warns) | A | yes (P1 rejected because the prompt names `$32`: defensible) | **no** (.18) |
| D5-P2-3 | yes (`runFrame` had no zone check) | #1392 | yes | yes with a verified bed frame; without one, Start's own rule (zones unchecked, disclosed) applies | A | yes | **no** (.19) |
| D5-P2-4 | yes (`confirmWarnings(source.warnings)` only) | #1392 | yes | yes (resume re-entry scanned; manual restart shows it) | A | yes | **no** (.20) |
| D7-P2-1 | yes (pre-fix module run: Telnet greeting → restart) | #1397 `054d331bc` | yes 17:14Z | yes on a network link (any banner reads as `unknown` until status) | **R** (10 fail; D7-P2-1 case "expected not to be called") | yes (ADR-398 D2 accepts over-burn under uncertainty) | **no** (.21) |
| D7-R1 (plausible) | yes: grblHAL `stream.c` @ `4ec1ae44` L323-328 greets 200 ms after DTR with the level's own banner, no reset | #1397 | yes | yes on a grblHAL profile; **gap** behind a GRBL profile (M3-P3-4) | **R** (D7-R1 case fails pre-fix) | yes | **no** (.22) |
| D8-P2-1 | yes (`computeJobBounds(job, device)` anchors) | #1398 `e5194f3b5` | yes 18:26Z | yes (PR tests: line cut stays at X0; current-position, centre and right anchors) | A | yes (P1 weighed and rejected on sub-mm magnitude: defensible) | **no** (.23) |

## Severity changes and P1-by-effect review

| Change | Verdict | Reason (METHOD §3) |
|---|---|---|
| D2-P3-3 raised to P2 | **justified** | KerfDesk's own validator accepted an F-less probe. The overtravel of v²/2a, about 3.5 mm at the generic defaults, is a misleading result an ordinary user hits. Not P1: the operator configured the probe, and the motion is the one requested |
| D3-P2-2 lowered to P3 | **justified** | Every built-in profile ships with Home off. The path fails safe: no beam, a "machine will move" prompt, ALARM:9, and Unlock in the banner. LightBurn behaves the same |
| C7-P2-1 lowered to P3 | **justified** | Only copies saved from preview builds between 2026-07-07 and 2026-09-19. v1.0.0 already had the split, and the overrun shows at a laser-off Frame |
| D4-P2-1 kept at P2 | **not justified** (M3-P3-5) | Its refuter wrote "P1 is arguable, since the result is silent and physical" and kept P2 because the fault "needs a non-default leftover controller setting". That is a reach argument, which M2-P3-2 established is not part of §3's P1 test |
| C6-P2-2 kept at P2 | **not justified** (M3-P3-6) | "Can fire the laser … unexpectedly": the beam lit at the parked head after KerfDesk had said "Frame complete". It was kept for reach (a non-default option) and for signals that KerfDesk's own success message contradicted |
| D3-P2-1 kept at P2 | **not justified** (M3-P3-7) | A silent ×1.96 scale on ADR-373's common install, with preview, wrap and Job Review all agreeing. "The wrong size shows on the first test burn" holds for every wrong-scale defect, and M2-P3-2 rejected the same reason for 03-P2-4 |
| C8-P2-1, C4-P2-1, C6-P2-1, D5-P2-2, D7-P2-1, D8-P2-1 kept at P2 | defensible | The reasons are magnitude (one focus step, sub-mm), a dark failure, a gate that names `$32`, an ADR-accepted over-burn direction, or a value the operator typed malformed and the table shows. None is a reach-only argument |

## Findings

### M3-P3-1 — Stale record: all 23 controller P1/P2 rows still say "fix card proposed"; every one has a merged fix
- **Corrects:** controller-v2 LEDGER (12 rows) and controller-v3 LEDGER (11 rows), "Fix status".
- **Kind:** Stale record.
- **Where:** `docs/audits/2026-10-22-controller-v2/LEDGER.md` "Confirmed P1/P2" table, and the
  totals sentence ("each has a proposed fix session"); `docs/audits/2026-10-22-controller-v3/LEDGER.md`
  "Confirmed P1/P2" table.
- **Scenario:** a reader of either ledger sees 23 open items. GitHub shows 15 merged PRs covering
  all of them (table above, merge SHAs and times). The rows were accurate when written: the v2
  ledger's last commit was 02:49Z and the v3 ledger's was 14:24Z on 2026-10-22, before the fixes
  merged. They were never updated afterwards.
  - The docs PRs merged later, and so were stale as merged. #1356 (v2 docs) merged at 12:20Z,
    after #1377, #1376 and #1382. #1393 (v3 docs) merged at 15:29Z, after #1388–#1391.
  - Record-format note, not counted: the D2 and D3 JSON blocks use bare ids (`"P3-3"`, `"P2-2"`).
    D1, D4–D8 and C1–C8 prefix theirs. A tool that merges the JSON blocks cannot tell D2-P3-3 from
    D3-P3-3.
- **Evidence:** SOURCE (GitHub): `gh pr view` for each PR (state MERGED, `mergedAt`,
  `mergeCommit`), `git log` on both ledgers.
- **Refuter:** CONFIRMED, umbrella and all 23 rows.
  - The spot check asked for 5 PRs: #1378, #1379, #1381, #1389 and #1397, which cover .01–.05,
    .08, .14, .21 and .22. Each is MERGED with the SHA and time in the table.
  - The other 10 fix PRs were re-queried too, and all match.
  - `grep` finds "fix card proposed" on all 23 rows (12 in v2, 11 in v3). The last ledger commits
    are 02:49Z (v2) and 14:24Z (v3).
  - #1356 merged at 12:20:46Z and #1393 at 15:29:22Z.
  - The D2 and D3 JSON ids are bare (`"P3-1"`, `"P2-1"`). D4's are prefixed (`"D4-P2-1"`).
- **Fix direction:** set each row's status to "fixed by #n (merge sha)". Change the v2 totals
  sentence. Add the area prefix to the D2 and D3 JSON ids.

| Sub-id | Row | Ledger | GitHub |
|---|---|---|---|
| .01 | C2-P1-1 | fix card proposed | #1378 merged `3e90d92d8` |
| .02 | C2-P2-1 | fix card proposed | #1378 merged |
| .03 | C3-P2-1 | fix card proposed | #1379 merged `1d64a4deb` (gap: M3-P3-2) |
| .04 | C3-P2-2 | fix card proposed | #1379 merged |
| .05 | C4-P2-1 | fix card proposed | #1379 merged (gap: M3-P3-3) |
| .06 | C5-P2-1 | fix card proposed | #1377 merged `07b9ff462` |
| .07 | C6-P2-1 | fix card proposed | #1380 merged `972aba76c` |
| .08 | C6-P2-2 | fix card proposed | #1381 merged `8ce6fe4f2` |
| .09 | C7-P2-2 | fix card proposed | #1385 merged `af7dc4f21` |
| .10 | C7-P2-3 | fix card proposed | #1385 merged |
| .11 | C8-P2-1 | fix card proposed | #1376 merged `8dc125bff` |
| .12 | C8-P2-2 | fix card proposed | #1382 merged `f471476a2` (stock-driver gap open in ADR-375 Amd 2) |
| .13 | D2-P3-3 (P2) | fix card proposed | #1388 merged `12e3f6fac` |
| .14 | D3-P2-1 | fix card proposed | #1389 merged `46cb14e42` |
| .15 | D4-P2-1 | fix card proposed | #1390 merged `d507314b4` |
| .16 | D4-P2-2 | fix card proposed | #1391 merged `91c580c34` |
| .17 | D5-P2-1 | fix card proposed | #1392 merged `3547bcf38` |
| .18 | D5-P2-2 | fix card proposed | #1390 merged |
| .19 | D5-P2-3 | fix card proposed | #1392 merged |
| .20 | D5-P2-4 | fix card proposed | #1392 merged |
| .21 | D7-P2-1 | fix card proposed | #1397 merged `054d331bc` |
| .22 | D7-R1 | fix card proposed | #1397 merged (gap: M3-P3-4) |
| .23 | D8-P2-1 | fix card proposed | #1398 merged `e5194f3b5` |

C7-P2-1 (lowered to P3) was also fixed by #1385, which added the Falcon A1 Pro bed correction.

### M3-P3-2 — Fix gap (C3-P2-1): grblHAL's force origin is read only when the dump lists `$384`, so a level-0 build from before 20210928 with `$22=1` still gets no jog envelope
- **Corrects:** C3-P2-1 (controller v2), fix #1379; ADR-375 Amendment 3 decision 1.
- **Kind:** Fix ineffective (partial), with a twin inconsistency.
- **Where:**
  - `src/core/controllers/grbl/parse-settings.ts:278`:
    `if (flags === undefined || (flags <= 1 && !map.has(384))) return {};`.
  - Twin in the same file, `:297`: `statusReportMaskFields` treats a dump as whole when it lists
    any non-stock setting.
- **Anchor:**
  - Ground truth: the grblHAL `changelog.md` adds `$384` in build 20210928 ("Added `$384` setting
    for controlling G92 offset persistence … Only available if compatibility level is < 2"). Older
    level-0 builds print the whole `$22` and list extended settings, but have no `$384`. Ortur's
    public grblHAL fork (`GRBL_VERSION_BUILD "20210403"`) has no setting id 374–399 in
    `settings.h`.
  - Twin: `statusReportMaskFields` (`:292-299`).
  - Contract: ADR-375 Amd 3 decision 1, "a COMPATIBILITY_LEVEL 2 dump (`$22` 0 or 1, no `$384`)
    keeps the unknown force origin". This equates "no `$384`" with level 2.
- **Scenario:** a grblHAL laser on a pre-20210928 level-0 build, with `$20=1 $21=1 $22=1 $23=3`.
  Its `$$` lists `$28`, `$40`, `$43`–`$45` and so on, but no `$384`. After Home every held arrow
  still asks for the full bed width, and grblHAL refuses with error:15: the original C3-P2-1
  behaviour. The same snapshot has `statusReportMaskIsFull: true`.
- **Evidence:** REPRO. A temporary `src/ui/state/zz-m3-ctl-variants.test.ts` (copy in the
  scratchpad) used the real `settingsMapToControllerSettings`, `resolveNativeBedFrame` and
  `resolveManualMotionLimits`:
  ```
  M3-C3 pre-$384 $23=3 limits null forceOrigin undefined statusReportMaskIsFull true | $23=0 control {"minX":-397.99,"maxX":-2.01,"minY":-297.99,"maxY":-2.01}
  M3-C3 with $384 $23=3 limits {"minX":-397.99,"maxX":-2.01,"minY":-297.99,"maxY":-2.01}
  ```
  The PR's own test pins only the `$384` dump and the level-2 dump. The level-2 fixture
  (`GRBLHAL_LEVEL_2_DUMP`) is the level-0 fixture with `$384` removed, so it is also the shape of
  a real pre-`$384` level-0 dump with no other extended settings.
- **Severity:** P3. It needs a grblHAL build older than 2021-09-28, force origin off with
  `$22` exactly 1 (bit 2 init lock or bit 3 set makes `$22` > 1, which is read correctly), and
  `$23` ≠ 0. The effect is the original one: refused holds, no motion. Ortur's public fork sets
  force origin on (`HOMING_FORCE_SET_ORIGIN` defined, so `$22` ≥ 9) and is read correctly.
- **Refuter:** CONFIRMED, P3 kept.
  - **Date.** I re-fetched `changelog.md` (grblHAL/core master). `$384` first appears under
    "Build 20210928".
  - **Firmware half reproduces.** Read at core `11640adc` (2021-09-19, `GRBL_VERSION_BUILD
    "20210907"`):
    - At level ≤ 1, `$$` lists every setting (`system.c` ~L410).
    - `$22` is an XBitfield that includes "Set machine origin to 0" (`settings.c` L401). It
      prints whole (`get_int`, L1181).
    - Without force origin, the envelope is [−max_travel, 0] (`system.c` L845-866).
    - With `$40` off, a jog outside the envelope returns `Status_TravelExceeded`
      (`motion_control.c` L720-723).
    - So the head homes to −398, and `$J=G91 X400` targets +2, which is refused with error:15.
  - **KerfDesk half reproduces.** Temporary `zz-m3r-variants.test.ts`, using my own pre-`$384`
    dump:

    | Case | Force origin | Limits |
    |---|---|---|
    | `$22=1 $23=3` | undefined | `null` |
    | `$22=9` | true | [0.01, 397.99] |
    | `$23=0` | – | clamp |
    | Modern dump with `$384`, `$22=1 $23=3` | false | clamp |
  - **Why P3: an adjacent variant, without the original's reach.**
    - The shipped pre-`$384` grblHAL lasers are Ortur's ESP32-S2 fork (build 20210403). Its
      `config.h` defines `DEFAULT_JOG_LIMIT_ENABLE` (`$40=1`) for every machine type, so grblHAL
      clamps the hold (`system_apply_jog_limits`) and never answers error:15.
    - That fork is also COMPATIBILITY_LEVEL 1 and has no KerfDesk preset, so it runs the stock
      driver path, not #1379's.
    - The LM3 is build 20220325, per a forum `$I` log (`[VER:1.1f.20220325:]`, with Z in
      `[OPT:VNZHS…]`). It lists `$384` and is read correctly.
    - What remains is a DIY level-0 build older than 2021-09-28 with `$22=1`, `$23`≠0,
      `$20=1` and `$40=0`.
  - **Corrections to the anchor.** Neither changes the verdict.
    - Ortur's fork is level 1 (`config.h` L47), not level 0.
    - It defines force origin for LM2, LM2 Pro, OLM Pro, Aufero 1 and Aufero CNC only
      (`config.h` L799-801).
    - Aufero 2 and 4 have neither force origin nor homing enabled (L698-704).
- **Fix direction:** use the same "dump shows extended settings" test as `statusReportMaskFields`
  (any non-stock id) as the level ≤ 1 proof, not `$384` alone. Add a pre-`$384` level-0 fixture.

### M3-P3-3 — Fix gap (C4-P2-1): on a grblHAL board run under a stock-GRBL profile, `$100=26,67` is still sent, stored as 26, and the new re-read check says nothing
- **Corrects:** C4-P2-1 (controller v2), fix #1379; the v3 LEDGER's D6 note was not acted on
  for C4. Context: C8-P2-2's twin gap (#1382) is recorded as "Still open" in ADR-375 Amd 2
  (`$10` handling keys on `capabilities.statusReportMask === 'grblhal-fields'`,
  `status-report-mask.ts:42`). ADR-375 Amd 3 records no such gap for the Console.
- **Kind:** Fix ineffective (partial).
- **Where:**
  - `src/core/controllers/console-setting-writes.ts:65-66`: grblHAL value checks only for
    `driver.kind === 'grblhal'`. The stock check passes `26,67`, because stock GRBL refuses it in
    firmware.
  - `:177-184` (`consoleSettingReadbackIssue`): for a `grbl-v1.1` driver a value that is not one
    number is never compared.
- **Anchor:**
  - Ground truth: C4-P2-1's own grblHAL sources. `settings_store_setting` keeps the leading
    number and answers `ok` at every compatibility level.
  - Contract: D6-P3-3, a grblHAL build at COMPATIBILITY_LEVEL ≥ 1 prints "Grbl 1.1f" and is
    recorded as stock GRBL under the default profile, with no identity note.
  - The v3 LEDGER note: "Fixes that key grblHAL behaviour on `driver.kind` alone (C4-P2-1 …)
    will not reach such boards."
- **Scenario:** a grblHAL board at COMPATIBILITY_LEVEL 1 on the default GRBL profile, or a
  level-0 board whose owner kept the GRBL profile despite the banner note. The operator types
  `$100=26,67` and confirms. KerfDesk sends it, grblHAL stores 26 and answers `ok`, and parts come
  out about 2.5 % short. The new re-read comparison returns null. `$110=5O00` is the same.
  `$22=1.0` and `$1=25.0` are now at least reported after the write.
- **Evidence:** REPRO (same temporary test, the real `consoleSettingWriteIssue` and
  `consoleSettingReadbackIssue`):
  ```
  M3-C4 $100=26,67 | stock: null | hal: $100=26,67 cannot be sent: Enter a finite decimal number. …
  M3-C4 $22=1.0 | stock: null | hal: grblHAL would not store $22=1.0 as typed. Send $22=1 instead. …
  M3-C4 readback stock $22=1.0 -> 0: The controller reports $22=0 after the re-read … | $1=25.0 -> 250: The controller reports $1=250 … | $100=26,67 -> 26.000: null | $110=5O00 -> 5.000: null
  ```
- **Severity:** P3. It needs a grblHAL board behind a GRBL profile plus a malformed typed value.
  The original was P2 for any grblHAL owner. *Refuter: P2, see below.*
- **Refuter:** CONFIRMED, **raised to P2**.
  - **Store-level REPRO.** Temporary `zz-m3r-variants.test.ts`, on the default stock-GRBL
    profile with the banner `Grbl 1.1f`:
    - `$100=26,67`: the wire carries `["$100=26,67\n","$$\n"]` and the re-read row is `26.000`.
      `lastWriteError` is `null`, the transcript has no re-read note, and the identity warnings
      are `[]`.
    - `$110=5O00` re-reads as `5.000`, with the same silence.
  - **Shipped hardware.** Ortur's public grblHAL fork `Ortur_Laser_Firmware_17X-18X`, "For
    ESP32 S2 SOC", build 20210403, fetched by me:
    - It is built for the LM2 S0/S2, LM2 Pro S1/S2, Laser Master Pro S2, Aufero 1/2/4 and
      Aufero CNC (`my_machine.h` L47-64). Board `OLM_ESP_V1X` gives OLF 175 and
      `OLM_ESP_PRO_V1X` gives OLF 187.
    - It sets `COMPATIBILITY_LEVEL 1` (`config.h` L47), so it greets "Grbl 1.1f ['$' for help]"
      (`report.c` L426-430).
    - `settings_store_global_setting` (`settings.c` L456-470) reads the value with `read_float`.
      That stops at the first non-digit (`nuts_bolts.c` L152-188) and the rest is never checked,
      so `26,67` is stored as 26 and answered `ok`.
    - A LightBurn forum log from an Aufero 2 S2 shows "Grbl 1.1f ['$' for help]", `OLF: 186` and
      `[VER:1.1f(ESP32).20210403:]`
      (https://forum.lightburnsoftware.com/t/aufero-laser-2-doesnt-move-on-second-job/73472).
    - KerfDesk ships grblHAL presets only for the LM3 and the Falcon A1 Pro. Owners of these
      machines therefore run the default GRBL profile, and D6-P3-3's banner rule gives them no
      identity note.
  - **Also exposed:** LM3 owners on a saved pre-#1385 copy (`grbl-v1.1`). Job Review flags the
    identity mismatch, but `consoleSettingWriteIssue` follows only `driver.kind`.
  - **Severity, by the meta rule.**
    - For these owners the original C4-P2-1 scenario reproduces in full: the same typed value,
      the same firmware truncation, the same `ok` and the same silent re-read.
    - Only the profile differs, and it is KerfDesk's own default for them.
    - The D6 refuter's "needs a non-default build" does not hold here: level 1 is Ortur's shipped
      default.
    - So P2, the same as C4-P2-1.
    - The `.0` forms do not apply to this 2021 build: `read_float` reads `1.0` as 1.
  - **The C8-P2-2 twin folded in here reaches the same family.** It is ADR-375 Amd 2 "Still
    open". Ortur's fork honours the `$10` WCO and Ov bits (`report.c` L1401-1412), so `$10=0`
    leaves the stock driver waiting for WCO. One fix card should cover both.
- **Fix direction:** on the stock driver, compare any re-read that is a number with the leading
  number grblHAL would keep. Or refuse a `$N=` value that is not one decimal on every
  `grbl-dollar` driver: stock GRBL refuses it anyway (error:3), so nothing valid is lost. Record
  the remaining profile gap in ADR-375 Amd 3 as Amd 2 does.

### M3-P3-4 — Fix gap (D7-R1): #1397 assumes a "Grbl 1.1f" grblHAL build runs a grblHAL profile; D6 found it runs the default GRBL profile, where its USB greeting still reads as a restart
- **Corrects:** D7-R1 (controller v3), fix #1397.
- **Kind:** Fix ineffective (partial); contradiction between #1397's code comment and D6-P3-3.
- **Where:**
  - `src/ui/app/link-loss-restart-tracking.ts:56`: `if (banner && !bannerMayGreet(state, link)) return 'boot-banner';`.
  - `:66-72`: `bannerMayGreet` is true on a network link, or when the detected or active kind is
    `grblhal` ("a build reporting itself as \"Grbl 1.1f\" runs a grblHAL profile").
- **Anchor:**
  - Ground truth, re-fetched from grblHAL core `4ec1ae44`:
    - `stream.c:323-328`: `stream_usb_linestate_changed` queues `output_welcome_message` 200 ms
      after DTR, with no compatibility-level condition and no reset.
    - `report.c:311-314`: that message is "Grbl 1.1f ['$' for help]" at any level ≠ 0.
  - Contract: D6-P3-3, such a build on the default GRBL profile is detected as `grbl-v1.1`.
- **Scenario:** a native-USB grblHAL laser (RP2040 or STM32) built at COMPATIBILITY_LEVEL 1, run
  on the default GRBL profile. A USB drop happens mid-job, and the board keeps running its planner.
  On reconnect the greeting arrives inside the 250 ms passive wait. The first sign is
  `boot-banner`, so Automatic steps back over the backlog: moves that already burned run again,
  and the Review says the controller "had restarted". This is the original D7-R1 outcome.
- **Evidence:** REPRO at function level (same temporary test, the real `linkLossRestartEvidence`):
  ```
  M3-D7 usb stock-profile banner: {"sign":"boot-banner","link":"usb"} | usb grblHAL profile: null | tcp stock profile: null
  ```
  SOURCE as above. Not run on hardware.
- **Severity:** P3. It needs a non-default compatibility level, native USB, a GRBL profile, a USB
  drop mid-job, and the operator accepting the Automatic restart. D7-R1 itself was PLAUSIBLE P2.
- **Refuter:** CONFIRMED at function level and by source. P3 kept.
  - **REPRO** (temporary `zz-m3r-variants.test.ts`, the real `linkLossRestartEvidence`, status
    `Run`):

    | Link | Active / detected kind | Banner | Result |
    |---|---|---|---|
    | USB | `grbl-v1.1` / `grbl-v1.1` | yes | `{"sign":"boot-banner","link":"usb"}` |
    | USB | grblHAL profile | yes | `kept-running` |
    | USB | `grbl-v1.1` | none | `kept-running` |
    | TCP | `grbl-v1.1` / `grbl-v1.1` | yes | `kept-running` |
  - **Source,** re-fetched at `4ec1ae44`:
    - `stream.c` L322-327 queues the welcome 200 ms after DTR.
    - `report.c` L311-317 prints "Grbl " at every level other than 0.
  - **Real hardware: no shipped case found.**
    - The DTR welcome is new in core build 20250104. The changelog says: "Added event handler
      for outputting welcome message on 'native' USB connect".
    - The one shipped level-1 grblHAL laser family, Ortur's 2021 ESP32-S2 fork, predates it. Its
      `usb_cdc_line_state_changed_callback` only logs (`usb_serial.c` L58-64), and its banner is
      printed only at reset (`grbllib.c` L270).
    - The LM3 greets as "GrblHAL 1.1f" (level 0), which #1397 reads correctly.
  - **So the gap is a combination.** It needs D7-R1's PLAUSIBLE 200 ms/250 ms premise, a
    native-USB build from 2025 or later compiled at level ≥ 1, and a stock profile. That makes it
    an adjacent variant, P3.
  - **The code comment at L66-67 is wrong regardless.** Ortur's level-1 machines run the default
    GRBL profile.
- **Fix direction:** on USB, treat a bare "Grbl 1.1f" banner as one that may be a greeting, since
  it is ambiguous by D6-P3-3, and decide by the first status as for grblHAL. Correct the code
  comment.

### M3-P3-5 — Wrong severity (D4-P2-1): its refuter called it "P1 arguable, silent and physical" and kept P2 for reach
- **Corrects:** D4-P2-1 (controller v3) severity; already fixed by #1390.
- **Kind:** Wrong severity.
- **Where:** `docs/audits/2026-10-22-controller-v3/D4-ctl-spindle-hours.md:161-163` ("P1 is
  arguable, since the result is silent and physical. P2 is kept because the fault needs a
  non-default leftover controller setting").
- **Anchor:** METHOD §3 P1, "silently produces wrong physical output (power …)". The test has no
  reach clause, as the coordinator confirmed for M2-P3-2 (03-P2-4).
- **Scenario:** as raised, with no warning anywhere: a CAM program on a router left at `$32=1`
  runs its dwell with the spindle at 0, stops the spindle at every G0, and starts each G1 plunge
  from rest. With `$30=1000` an S18000 also saturates. The refuter's corrections (Pause/Resume
  already warned; relay routers unaffected) narrow who is hit, not what happens to them.
- **Evidence:** READ of the report's own reasoning, and of METHOD §3.
- **Severity of this meta finding:** P3, a record correction. The defect is fixed on main.
- **Refuter:** CONFIRMED: D4-P2-1 is P1 by effect. I tried to keep it at P2.
  - **The quote is cut.** The D4 refuter also gave two reasons that are not about reach:
    "KerfDesk sends the file's own bytes unchanged", and "the twin's remedy is an advisory, not a
    gate". Neither is a §3 criterion.
    - Bytes unchanged is equally true of D5-P2-2 (an external laser run with lit rapids at
      `$32=0`). Its refuter rejected P1 only because "a pre-Start acknowledgement does name laser
      mode (`$32=1`)". The CNC external run had no such prompt.
    - An advisory remedy is what makes the fixed path non-silent. It says nothing about the
      unfixed path.
  - **Silent.** Read at `d507314b4^1`: `runControllerReadiness` runs only from
    `start-job-readiness.ts` and the export advisories (`controller-readiness-advisories.ts`).
    No connect notice and no Run-dialog line carries `laser-mode-enabled`.
  - **Physical.**
    - On a PWM spindle, the spindle is at 0 through the dwell and through every G0, and each
      plunge starts from rest.
    - With `$30=1000`, S saturates.
    - Spindle speed is the CNC counterpart of §3's "power".
  - **So P1 by effect.** This is a record correction only; #1390 fixed the defect.
- **Fix direction:** record D4-P2-1 as "P1 by effect (meta-v1 M3)" in the v3 ledger, as was done
  for 03-P2-4.

### M3-P3-6 — Wrong severity (C6-P2-2): a fan-wired Marlin laser lit at the parked head after KerfDesk reported "Frame complete" is P1 by effect
- **Corrects:** C6-P2-2 (controller v2) severity; already fixed by #1381.
- **Kind:** Wrong severity.
- **Where:** `docs/audits/2026-10-22-controller-v2/C6-ctl-other-drivers.md:260-265` ("Severity: P2
  kept. It needs a non-default option, and there are signals").
- **Anchor:** METHOD §3 P1, "Can fire the laser … unexpectedly".
- **Scenario:** the refuter's own store repro:
  - all five Frame `G0`s were skipped, and `frame recorded true` with no notice;
  - Start then sent `M106 S128`, and the simulator fan output lit at `0,0` with no motion;
  - it stayed lit for as long as each burn group's skipped G1 lines took to stream.

  The two reasons given for keeping P2:
  - **A non-default option.** That is reach, which is not a §3 criterion.
  - **Signals: the head does not move, and an echo line appears in the Console.** KerfDesk's own
    "Frame complete" contradicted both, and Start was unlocked by that record.
- **Evidence:** READ of the report, with its refuter's REPRO.
- **Severity of this meta finding:** P3, a record correction. The defect is fixed on main: the
  Frame, jog and job now stop on `Home … First` (`marlin/response.ts` `HOME_FIRST_RE`, with
  `laser-motion-refusal.ts`).
- **Refuter:** CONFIRMED: C6-P2-2 is P1 by effect.
  - **Signals checked.**
    - A motionless Frame is a real pre-burn cue. But it is the operator's inference against
      KerfDesk's own "Frame complete", and that record unlocked Start (ADR-565).
    - The `echo:Home XYZ First` line is stored as a plain `message` transcript row, not a
      warning.
  - **§3's first clause has no "silently" qualifier anyway.** "Can fire the laser …
    unexpectedly" is met: the beam lights at one spot with no motion, for as long as each burn
    group's skipped lines stream.
  - **The remaining reason, a non-default build option, is reach.**
  - **So P1 by effect.** This is a record correction only; #1381 fixed the defect.
- **Fix direction:** record C6-P2-2 as "P1 by effect (meta-v1 M3)" in the v2 ledger.

### M3-P3-7 — Wrong severity (D3-P2-1): a silent ×1.96 wrap scale on the common roller install, reached by following the panel's advice, is P1 by effect
- **Corrects:** D3-P2-1 (controller v3) severity; already fixed by #1389.
- **Kind:** Wrong severity.
- **Where:** `docs/audits/2026-10-22-controller-v3/D3-ctl-rotary.md:170-175` ("Not P1: the operator
  changes a measured value by hand, and the wrong size shows on the first test burn").
- **Anchor:** METHOD §3 P1, "silently produces wrong physical output (… scale)". ADR-373 Context
  names the Y-port roller the common install.
- **Scenario:** in the refuter's correction, the ×1.96 burn "comes from the unscaled default on a
  stock controller, and it is the same with or without the tuned Ø". Tuning Ø, which the panel's
  miss text pointed to, removed the one pre-burn signal. Preview, wrap, Rotary switch and Job
  Review then all describe the wrong part. "Shows on the first test burn" is true of every
  wrong-scale output. It is the reason M2-P3-2 rejected for 03-P2-4, where a 50 % line burned at
  full power also showed on the burn. "Changes a value by hand" is what the app told the operator
  to do.
- **Evidence:** READ of the report, with its refuter's REPRO (`burnedSurfaceMm=39.270` for a 20 mm
  design in both unscaled cases).
- **Severity of this meta finding:** P3, a record correction. The defect is fixed on main for new
  rollers (a 40 mm-per-turn, Ø25 roller now gives yScale 0.5093) and for the miss advice. A saved
  unscaled roller keeps its mode, by ADR-373 Amd 1.
- **Refuter:** CONFIRMED: D3-P2-1 is P1 by effect.
  - **§3 names scale.** The D3 refuter's REPRO gives `burnedSurfaceMm=39.270` for a 20 mm design,
    with or without the tuned Ø, and no warning on either path.
    - Untuned: the burn is silent when the Test is skipped.
    - Tuned: tuning removes the only signal.
  - **"The operator changes a measured value by hand" does not hold up.**
    - It differs from D2-P3-3's accepted "the operator configured the probe", where the motion
      was the one requested.
    - Here the burn is not what was requested, and the change was the panel's own advice.
  - **Cue considered.** A rotary Frame turns the part over about 39 mm of surface for a 20 mm
    design.
    - It shows only as a rotation angle, or as a dot outline where the Frame lights one.
    - It is not a KerfDesk warning, and every on-screen figure agrees with the wrong size.
    - It is no stronger than the visible full-power burn in 03-P2-4.
  - **So P1 by effect.** This is a record correction only; #1389 fixed the defect.
- **Fix direction:** record D3-P2-1 as "P1 by effect (meta-v1 M3)" in the v3 ledger.

## Test truth (fix-reverted runs)

Each run copied the pre-fix module (`git show <merge>^1:path`) into a temporary `zz-m3-old-*`
file and pointed a copy of the PR's test at it, with `vi.mock` or an import rewrite.
`git diff <merge>^1 HEAD` on each module shows only the fix in between.

| Finding | Module reverted | Result |
|---|---|---|
| C2-P1-1 | `laser-probe-policy.ts` (#1378) | 1 failed: `expected { kind: 'ok' } to deeply equal { kind: 'preflight-failed', … }`. The pre-fix store ran the corner probe in the hold |
| D5-P2-1 | `no-go-zones.ts` (#1392) | 2 failed: `expected 0 to be greater than 0`, for both tip-diameter bits |
| D7-P2-1 / R1 | `link-loss-restart-tracking.ts` (#1397) | 10 failed. The D7-P2-1 case fails with "expected not to be called at all, but actually been called 1 times" (some failures are the changed return shape) |

## Refuted (own candidates, dropped)

- **C1's Smoothieware re-arm claim contradicts C6-P2-1** (a program without `M221` gets no
  re-arm). Dropped: laser recovery resumes only KerfDesk's re-emitted project
  (`laser-recovery-flow.ts` `recoverySource`), whose Smoothieware output always carries
  `M221 S100 P…`. External programs are not resumed.
- **The Z probe allowed in a tool-change hold sends `G54`, which could switch a G55 job.**
  Dropped: the CNC preamble pins `G54` (`cnc-grbl-strategy.ts:18`, `cnc-grbl-transitions.ts:55`).
- **#1392's Frame-route zone check skips machines without a verified bed frame.** Dropped: that
  is Start's own rule, stated in `frame-no-go-warnings.ts`, and Job Review discloses it.
- **#1381's `HOME_FIRST_RE` misses non-English builds.** Dropped: Marlin builds the serial message
  with `GET_EN_TEXT` (English on every build).
- **#1385 leaves saved `grbl-v1.1` Ortur copies.** Dropped: a stated decision, ADR-660 §5.
- **Marlin's two boot banners per boot break the session (D6 clean claim).** Dropped. Marlin
  2.1.2.8 does print both `start` (`MarlinCore.cpp:1185`) and `Marlin <ver>` (`:1285`), so the
  epoch rises by 2. A store run with both lines still qualified, read Idle, and left no notice or
  stray acknowledgement (see Verified clean).

## Verified clean

- **Every fix PR's regression tests pass on the current tree:**
  - files: `laser-tool-change-xy-origin`, `probe-active-wcs.simulator`,
    `ProbeControls.tool-change`, `jog-travel-limits`, `manual-motion-limits`,
    `console-setting-writes`, `laser-store-console-setting-writes`, `use-jog-shortcuts`,
    `JogPad.keyboard-jog`, `diagnostic-bundle`, `controller-password-settings`,
    `external-run.smoothie.simulator`, `normalize-external-program`, `marlin-home-first`,
    `laser-motion-refusal`, `status-report-mask`, `grblhal-status-report-mask`,
    `preset-corrections`, `machine-picker-entries`, `autofocus-command`,
    `RotaryTestRotationPanel`, `rotary-setup-edit`, `lit-rapids`,
    `external-run.controller-readiness.store`, `cnc-pause-resume-policy`, `cnc-pause-reentry`,
    `no-go-zones`, `frame-no-go-warnings`, `laser-recovery-flow.no-go`,
    `link-loss-restart-tracking`, `link-loss-restart`, `job-origin`,
    `prepare-output-scan-offset-placement`;
  - totals: 33 files and 470 tests in 8 runs.
- **Independent re-runs** (temporary `zz-m3-independent.test.ts`) on the current tree:
  - D2: `G38.2 Z-10` and `F100000` are refused, `G38.3` is refused, and `G38.2 Z-10 F100` is
    accepted;
  - C6-P2-1: the Smoothieware head is `G17G21G90G0`, `M221 S100`;
  - C7-P2-2: all three LM3 profiles are `grblhal`;
  - C7-P2-3: the fallback is `withdrawn`;
  - D3-P2-1: a new 40 mm/turn, Ø25 roller gives yScale 0.5093;
  - D5-P2-1: a hand-written emitter comment gives a radius of 1.5875.
- **C1 "Verified clean" Q1 and Q5 hold; break attempt failed.** Temporary
  `zz-m3-c1-dark-entry.test.ts`:
  - the real `emitPreparedGcode` of `mixedLaserProject` on the default GRBL profile was resumed
    from every line;
  - each resume ran through the repo's GRBL power oracle from a hostile lit state (`M3 S1000`,
    `G1 F9000`), with `$32=1` and with `$32=0`;
  - `laserMode=true checked=175 litPreamble=0 tailMismatch=0`, and the same for
    `laserMode=false`. No preamble move was lit, and every resumed tail burned the original's
    power and feed.
- **D6 "Verified clean" holds; break attempt failed.** Banner matching and the session reset
  were tested against Marlin 2.1.2.8's real boot, which prints `start` and then a bare
  `Marlin 2.1.2.8`. The repo's simulator emits only `start`. Temporary
  `zz-m3-d6-marlin-boot.test.ts` on the Marlin simulator gave:
  - `start only: epochDelta=1 … qualification=qualified state=Idle notice=null`;
  - `start + Marlin <ver>: epochDelta=2 … qualification=qualified state=Idle notice=null pendingUntrackedAcks=0`.

  The double reset boundary is harmless because both lines arrive before KerfDesk writes. The
  banner reset also clears `activeWcs`, which matters to C2-P2-1's fix
  (`laser-line-handler.ts`).
- **C2-P1-1 has no other route in.** Console G-code is blocked in the hold (`isActiveJob`
  includes `tool-change`). Every X/Y origin writer goes through `assertOriginActionReady`, whose
  default is `'xy'`: Set, Reset, persistent, restore and release motors. The phone remote's
  `set_work_origin` calls the same store action.
- **C5-P2-1 has no other raw sink.** The bundle carries only transcript rows, the numeric
  settings block, build info and the firmware report. Password ids are nulled in the settings
  block too.

## Not verified

- **No hardware.** The C4 and D7 variants were run at function level; no grblHAL build at
  COMPATIBILITY_LEVEL 1 was available.
- **Which builds lack `$384`.** Whether any shipped machine runs a pre-20210928 level-0
  grblHAL with `$22=1` and `$23` ≠ 0 was not established (M3-P3-2's population). *Refuter:
  the shipped pre-`$384` lasers (Ortur ESP32-S2, 20210403) are level 1 with `$40=1`, so they
  never see error:15; the LM3 is build 20220325.*
- **Primary-source citations** in the 16 reports beyond those re-fetched above (M5's scope).
- **Full PR suites.** Only the regression tests listed above were run, and only three were
  reverted.
- **Other "Verified clean" claims.** Of C1 and D6, only the claims named above were attacked.
  The remaining claims are M6's scope.
- **D7-P2-1's network case** was not re-run over loopback TCP; the function-level evidence for
  `link: 'network'` is the PR test and the variant run.

```json
[
  {"id":"M3-P3-1","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":16,"anchor":"Record vs GitHub (gh pr view)","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"controller-v2 and controller-v3 LEDGER P1/P2 rows","kind":"Stale record","summary":"All 23 controller P1/P2 rows say 'fix card proposed'; 15 merged PRs (#1376-#1398) fix all of them; D2/D3 JSON ids lack the area prefix"},
  {"id":"M3-P3-1.01","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":28,"anchor":"gh pr view 1378","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C2-P1-1","kind":"Stale record","summary":"fix card proposed -> #1378 merged 3e90d92d8"},
  {"id":"M3-P3-1.02","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":29,"anchor":"gh pr view 1378","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C2-P2-1","kind":"Stale record","summary":"fix card proposed -> #1378 merged"},
  {"id":"M3-P3-1.03","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":25,"anchor":"gh pr view 1379","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C3-P2-1","kind":"Stale record","summary":"fix card proposed -> #1379 merged 1d64a4deb (gap M3-P3-2)"},
  {"id":"M3-P3-1.04","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":26,"anchor":"gh pr view 1379","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C3-P2-2","kind":"Stale record","summary":"fix card proposed -> #1379 merged"},
  {"id":"M3-P3-1.05","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":27,"anchor":"gh pr view 1379","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C4-P2-1","kind":"Stale record","summary":"fix card proposed -> #1379 merged (gap M3-P3-3)"},
  {"id":"M3-P3-1.06","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":22,"anchor":"gh pr view 1377","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C5-P2-1","kind":"Stale record","summary":"fix card proposed -> #1377 merged 07b9ff462"},
  {"id":"M3-P3-1.07","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":23,"anchor":"gh pr view 1380","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C6-P2-1","kind":"Stale record","summary":"fix card proposed -> #1380 merged 972aba76c"},
  {"id":"M3-P3-1.08","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":24,"anchor":"gh pr view 1381","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C6-P2-2","kind":"Stale record","summary":"fix card proposed -> #1381 merged 8ce6fe4f2"},
  {"id":"M3-P3-1.09","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":30,"anchor":"gh pr view 1385","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C7-P2-2","kind":"Stale record","summary":"fix card proposed -> #1385 merged af7dc4f21"},
  {"id":"M3-P3-1.10","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":31,"anchor":"gh pr view 1385","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C7-P2-3","kind":"Stale record","summary":"fix card proposed -> #1385 merged"},
  {"id":"M3-P3-1.11","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":32,"anchor":"gh pr view 1376","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C8-P2-1","kind":"Stale record","summary":"fix card proposed -> #1376 merged 8dc125bff"},
  {"id":"M3-P3-1.12","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/LEDGER.md","line":33,"anchor":"gh pr view 1382","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"C8-P2-2","kind":"Stale record","summary":"fix card proposed -> #1382 merged f471476a2 (stock-driver gap open in ADR-375 Amd 2)"},
  {"id":"M3-P3-1.13","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":24,"anchor":"gh pr view 1388","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D2-P3-3 (P2)","kind":"Stale record","summary":"fix card proposed -> #1388 merged 12e3f6fac"},
  {"id":"M3-P3-1.14","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":25,"anchor":"gh pr view 1389","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D3-P2-1","kind":"Stale record","summary":"fix card proposed -> #1389 merged 46cb14e42"},
  {"id":"M3-P3-1.15","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":26,"anchor":"gh pr view 1390","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D4-P2-1","kind":"Stale record","summary":"fix card proposed -> #1390 merged d507314b4"},
  {"id":"M3-P3-1.16","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":27,"anchor":"gh pr view 1391","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D4-P2-2","kind":"Stale record","summary":"fix card proposed -> #1391 merged 91c580c34"},
  {"id":"M3-P3-1.17","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":28,"anchor":"gh pr view 1392","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D5-P2-1","kind":"Stale record","summary":"fix card proposed -> #1392 merged 3547bcf38"},
  {"id":"M3-P3-1.18","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":29,"anchor":"gh pr view 1390","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D5-P2-2","kind":"Stale record","summary":"fix card proposed -> #1390 merged"},
  {"id":"M3-P3-1.19","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":30,"anchor":"gh pr view 1392","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D5-P2-3","kind":"Stale record","summary":"fix card proposed -> #1392 merged"},
  {"id":"M3-P3-1.20","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":31,"anchor":"gh pr view 1392","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D5-P2-4","kind":"Stale record","summary":"fix card proposed -> #1392 merged"},
  {"id":"M3-P3-1.21","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":32,"anchor":"gh pr view 1397","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D7-P2-1","kind":"Stale record","summary":"fix card proposed -> #1397 merged 054d331bc"},
  {"id":"M3-P3-1.22","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":33,"anchor":"gh pr view 1397","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D7-R1","kind":"Stale record","summary":"fix card proposed -> #1397 merged (gap M3-P3-4)"},
  {"id":"M3-P3-1.23","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/LEDGER.md","line":34,"anchor":"gh pr view 1398","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"D8-P2-1","kind":"Stale record","summary":"fix card proposed -> #1398 merged e5194f3b5"},
  {"id":"M3-P3-2","severity":"P3","area":"meta-controller-v2-v3","file":"src/core/controllers/grbl/parse-settings.ts","line":278,"anchor":"Ground truth: grblHAL changelog ($384 added in build 20210928); Twin: statusReportMaskFields (:297); Contract: ADR-375 Amd 3 decision 1","evidence":"REPRO","verdict":"CONFIRMED","known":null,"corrects":"C3-P2-1 / #1379","kind":"Fix ineffective (partial)","summary":"Force origin is read only with $22>1 or $384 listed; a pre-20210928 level-0 grblHAL dump with $22=1 and $23=3 still gives null limits (every hold error:15), while the same snapshot has statusReportMaskIsFull true"},
  {"id":"M3-P3-3","severity":"P2","area":"meta-controller-v2-v3","file":"src/core/controllers/console-setting-writes.ts","line":65,"anchor":"Ground truth: grblHAL settings_store_setting (C4-P2-1 sources); Contract: D6-P3-3, v3 LEDGER D6 note","evidence":"REPRO","verdict":"CONFIRMED (raised P3->P2 by refuter: Ortur ESP32-S2 grblHAL, level 1, default GRBL profile)","known":"v3 LEDGER note (D6 refuter); C8 twin gap recorded in ADR-375 Amd 2","corrects":"C4-P2-1 / #1379","kind":"Fix ineffective (partial)","summary":"A grblHAL board behind a stock-GRBL profile still takes $100=26,67 and $110=5O00 unchecked; consoleSettingReadbackIssue returns null for them on the grbl-v1.1 driver, so the stored 26 / 5 is never reported"},
  {"id":"M3-P3-4","severity":"P3","area":"meta-controller-v2-v3","file":"src/ui/app/link-loss-restart-tracking.ts","line":56,"anchor":"Ground truth: grblHAL core 4ec1ae44 stream.c:323-328, report.c:311-314; Contract: D6-P3-3","evidence":"REPRO","verdict":"CONFIRMED","known":null,"corrects":"D7-R1 / #1397","kind":"Fix ineffective (partial); Contradiction","summary":"bannerMayGreet assumes a 'Grbl 1.1f' grblHAL build runs a grblHAL profile; on the default GRBL profile over USB its DTR greeting still returns boot-banner, so Automatic restart re-burns the backlog"},
  {"id":"M3-P3-5","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/D4-ctl-spindle-hours.md","line":161,"anchor":"METHOD §3 P1 (no reach clause; M2-P3-2 precedent)","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"D4-P2-1 severity","kind":"Wrong severity","summary":"Refuter wrote 'P1 is arguable, silent and physical' and kept P2 on reach (non-default leftover $32=1); record as P1 by effect (fixed by #1390)"},
  {"id":"M3-P3-6","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v2/C6-ctl-other-drivers.md","line":260,"anchor":"METHOD §3 P1 'Can fire the laser ... unexpectedly'","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"C6-P2-2 severity","kind":"Wrong severity","summary":"Fan-wired Marlin lit at the parked head after KerfDesk reported Frame complete; kept P2 on reach and on signals KerfDesk's own success message contradicted; record as P1 by effect (fixed by #1381)"},
  {"id":"M3-P3-7","severity":"P3","area":"meta-controller-v2-v3","file":"docs/audits/2026-10-22-controller-v3/D3-ctl-rotary.md","line":173,"anchor":"METHOD §3 P1 'silently produces wrong physical output (scale)'; ADR-373 Context; M2-P3-2 precedent","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"D3-P2-1 severity","kind":"Wrong severity","summary":"Silent x1.96 wrap scale on the common Y-port roller with every pre-burn figure agreeing, reached by the panel's own advice; 'shows on the first test burn' is the reason rejected for 03-P2-4; record as P1 by effect (fixed by #1389)"}
]
```
