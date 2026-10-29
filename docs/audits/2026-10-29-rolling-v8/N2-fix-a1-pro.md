# Rolling audit v8 — N2 Fix verification: Falcon A1 Pro ground truth (#1499)

- **When:** 2026-10-29, evening +0800   **Tree:** origin/main @ `33bc394c6` (#1513 merged; the desktop 1.0.28 source).
  - #1499 squash-merged as `6e388bb56` (parent `5f3c420f4`, head commit `0ea61452b`).
  - `git diff --stat 6e388bb56 origin/main` over all 69 files #1499 touched changes only `WORKFLOW.md`. Every source and test file is as merged.
  - **Repros ran on main's exact tree.** 324 source files under `src/core/devices`, `src/core/job`, `src/core/motion-planner`, `src/core/controllers`, `src/core/preflight`, `native-bed-frame.ts` and `scan-quality-warnings.ts` in `…\scratchpad\j7-main\` were compared with `origin/main` (0 differ).
  - **Parent tree for regressions and test truth:** `git archive 5f3c420f4 src scripts public` and the root configs, unpacked to `…\scratchpad\j7-main\zz-n2-parent\`. It holds no link (`find -type l` = 0, `dir /AL` = none) and resolves `node_modules` from `j7-main`.
  - Commands: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`, one file at a time. The files are listed at the end and were deleted.
- **Scope:** fix verification of #1499 (ADR-675, ADR-322 Amd 3, ADR-370 Amd 2). It fixed rolling v6 K3-P2-2 (P1), K3-P2-1, K3-P3-1 and K3-P3-2. Covered:
  - the K3 repros on a simulated grblHAL controller that answers with the published A1 Pro banner, `$$` and `$I`;
  - siblings: other Falcon and CoreXY presets, edited, saved, imported and custom profiles, `$$` failure modes, every `$` write route, Home/alarm/Start-from, ADR-664 and ADR-640;
  - regressions: emitter v40 bytes, Cartesian runways and estimates, and the #1513 Falcon wizard e2e change;
  - the three ADR texts against the code, and test truth.
- **Lenses run:** L10 (all five steps), L2 (grblHAL core `f8f10aec` source, both published dumps re-fetched, Creality product page). Not run: L4–L7.
- **Counts:** 6 raised → 0 refuted → P1 0 / P2 1 / P3 4 (+ 1 KNOWN: N2-P3-1; + 7 KNOWN re-observed).
  - Refuter: 4 CONFIRMED (N2-P2-1, N2-P3-2, N2-P3-3, N2-P3-5), 1 CONFIRMED in part (N2-P3-4: items 1, 2 and 4 hold, item 3 refuted), and 1 KNOWN (N2-P3-1, deferred by ADR-675 Alternatives). No severity changes.

## Headline

**#1499 holds for every K3 finding it names, on main, by simulation.** On a simulated controller that greets `GrblHAL 1.1f` and answers the full published `$$`:
- **K3-P2-1 (homing, bed frame): fixed.** Connect sends only `$$` and `$G`. Home sends `$HX`, `$HY`, `G4 P0.01`. After it:
  - the vendor frame is 0..358 × 0..268, and jog limits follow it;
  - the Absolute preflight offset is {0, 0};
  - the K3 fill at X 2 is refused with `X out of bed: -23` in machine mode.
  - Before Home, after a failed Home (`error:5`) and after `ALARM:1`, the frame is null again.
  - The frame equals grblHAL's own homed work envelope for these settings (`machine_limits.c` L116-138: 363 − 5 pull-off = 358).
- **K3-P2-2 (CoreXY acceleration): fixed.** The along-scan acceleration matches an independent motor-space model at 20 angle/acceleration pairs (difference < 1e-9).
  - At `$120=1000` and 10000 mm/min the automatic runway is 15.3 mm at 0°, 20.9 mm at 30°, 21.7 mm at 45° and 20.6 mm at 63°. Before the fix 45° got 10.9 mm.
  - With a stored 5 mm runway at 45° and 6000 mm/min, the advisory now fires: "needs about 7.0711 mm … on this CoreXY machine".
- **K3-P3-1 (settings read): fixed.** No `$N=`, `$#`, `$SLP` or `$RST` is sent at connect or Home.
  - Start's `$30`/`$32` check passes from the read.
  - Release motors says `$62=0`.
  - `$150`, `$151` and `$152` writes are refused on the Console, the Machine Settings write and both Falcon drivers.
- **No regression on Cartesian machines.** Emitted bytes, estimates and runways are identical on main and the parent: 135 of 135 non-CoreXY rows over 15 profiles × 9 jobs.
  - On CoreXY, axis-aligned runway bytes are unchanged too.
- **Test truth holds.** Every #1499 regression test run against the parent fails (19 failing cases in 10 files). The 11th file fails at import, because its module is new.

**One new P2.** #1499 makes the A1 Pro read `$$` at every connect. Each connect now offers the firmware's `$130`/`$131` (363 × 273) as profile updates. One press of **Use detected values** makes the vendor frame, jog limits and preflight run 5 mm past grblHAL's own homed envelope (0..358 × 0..268), and nothing warns afterwards (N2-P2-1).

The five P3s cover:
- K3-P2-2's wider reach (a CoreXY machine that is not the preset);
- the diagonal max-rate cap, which only the time model knows;
- `$22=0` shown as a plain fact;
- ADR text drift;
- e2e/simulator gaps.

## Fix verification matrix

| Machine / preset | Check | Before #1499 (parent `5f3c420f4` or K3) | After #1499 (main `33bc394c6`) | Verdict |
|---|---|---|---|---|
| A1 Pro preset | `homing` | `{enabled:false}` inherited (K3) | `{enabled:true, direction:'front-left'}` (`falcon-profiles.ts:24`) | Fixed |
| A1 Pro, simulated published `$$` | Vendor frame after Home | null (K3 REPRO) | `{0..358 × 0..268, offset 0,0}`; null before Home, after `error:5` and after `ALARM:1` (REPRO) | Fixed |
| A1 Pro | Frame vs firmware envelope | — | Equals grblHAL's homed envelope 0..(363−5) × 0..(273−5) (SOURCE `machine_limits.c` L116-138) | Clean |
| A1 Pro | Jog limits | null (K3) | 0..358 × 0..268 after Home; null after `ALARM:1` (REPRO) | Fixed |
| A1 Pro | Absolute preflight, fill at X 2, 10000 mm/min | size-only, passes (K3) | `X out of bed: -23` (0°), `-14.128` (45°, a=500), `-11.795` (45°, a=1000) (REPRO) | Fixed |
| A1 Pro | No-go zones | refused every Start (K3) | checkable after Home (offset known; READ `preflight.ts:238`) | Fixed |
| A1 Pro | Default Start from | User Origin | Absolute (REPRO) | Fixed (Absolute before a Home → generic warning, frame-first design; KNOWN) |
| A1 Pro | Start's `$30`/`$32` check | never verifiable (`settings:'none'`) | verified from the connect `$$` (REPRO) | Fixed |
| A1 Pro | Release motors | sent `$SLP`, refused by `$62=0` | disabled: "Sleep ($SLP) is disabled in this grblHAL build ($62=0). KerfDesk cannot change $62…" (REPRO) | Fixed |
| A1 Pro | Job Review "Homing $22" | "Controller settings: Not read" | "On" from the read (REPRO) | Fixed |
| A1 Pro, 45° scan, a=1000, 10000 mm/min | Automatic runway | 10.9 mm (needs 19.6) | 21.7 mm (needs 19.6 × 1.1 = 21.6) (REPRO) | Fixed |
| A1 Pro, 30° / 63° / 17° / 112.5° | Automatic runway | Cartesian a/max(\|c\|,\|s\|) | equals motor model at every angle (REPRO, 20 pairs) | Fixed |
| A1 Pro, stored 5 mm, 45°, 6000 mm/min | Runway advisory | silent (needs 3.54 by Cartesian) | fires, "7.0711 mm … on this CoreXY machine" (REPRO) | Fixed |
| A1 Pro | Preflight laser-off allowance | longest at 0° | longest at 45° (`Note: … 21.7 mm`) (REPRO) | Fixed (conservative) |
| Saved A1 Pro copy (homing off, no kinematics) | Job Review | nothing | both corrections named, with their effects (REPRO) | Fixed |
| A1 Pro copy with `kinematics:'cartesian'` set by the operator | Job Review | — | not named (operator's own value) (REPRO) | As designed |
| Falcon A1, Falcon 2, Falcon 2 Pro | Presets | none in the catalogue | none in the catalogue (REPRO catalogue listing) | n/a |
| Falcon-compatible fallback (withdrawn, stock GRBL) | Kinematics, bytes | absent | absent; bytes and estimates identical (REPRO) | Unchanged, correctly |
| LM3 ×3, xTool D1 Pro ×4, S30 ×2, 4040, generic GRBL/grblHAL | Kinematics, bytes, estimates, runways | Cartesian | absent = Cartesian; identical in 135/135 rows (REPRO) | No regression |
| A1 Pro, axis-aligned runway | Emitted bytes | — | identical to parent on CoreXY at 0° (REPRO) | ADR-675 D7 holds |
| Custom CoreXY machine | Motion layout | not modelled | Machine Setup **Motion layout** (READ `PlannerAdvanced.tsx:102-120`) | Fixed if set; not detected (N2-P3-1) |
| Any profile with `$$` timeout / `error:3` / partial / `$22=0` / stock banner | Connect | Falcon never read `$$` | failed qualification (timeout, error) / verified with laser mode unverified (partial) / Home `error:5` and no warning (`$22=0`, N2-P3-3) / frame applies (stock banner) (REPRO) | Mostly clean |
| A1 Pro | `$150`–`$152` writes | Console refused (ADR-370 Amd 1) | refused on Console, Machine Settings write, both Falcon drivers; nothing sent (REPRO). Macros and Run G-code file: same guard / `$` lines refused (READ). Remote: no console route (READ) | Clean |
| A1 Pro | Detected-values offer | only after a typed `$$` | every connect: 358→363, 268→273, accel 500→1000, Z 33 (REPRO) | **N2-P2-1** |
| A1 Pro, 45° M3 image above 25456 mm/min | Diagonal max-rate cap | not modelled | modelled in estimates only; M3 advice ignores it (REPRO) | N2-P3-2 |
| #1513 Falcon wizard e2e | Replace settings step | prompted (A1 Pro homing off vs fixture homing on) | not prompted (both home front-left; TUNED_SETTINGS) (READ) | Legitimate change; assertion gap N2-P3-5 |

## Findings

### N2-P2-1 — Every A1 Pro connect now offers the firmware's 363 × 273 travel as a profile update; accepting it moves the vendor frame, jog limits and preflight 5 mm past grblHAL's own homed envelope, with no warning afterwards

- **Where:**
  - **The read at every connect.** `src/core/controllers/falcon-command-contract.ts:28` sets `settings: 'grbl-dollar-read'`, which keeps grblHAL's `$$` query.
  - **The offer.**
    - `src/ui/laser/DetectedSettingsBanner.tsx:46-47` lists Bed width and Bed height as profile updates.
    - `src/ui/laser/DetectedSettingsToast.tsx:74-75`: `hasUpdates` re-announces on every read while the profile differs.
    - The toast text is at `:96`.
  - **Where the bed becomes the frame.** `src/ui/state/native-bed-frame.ts:102-109` builds the vendor frame from `device.bedWidth`/`bedHeight` with no firmware term.
  - **No firmware inset.**
    - `src/ui/state/manual-motion-limits.ts:141` returns no firmware under a command set.
    - `:45-48` therefore uses the frame as is.
    - On a plain grblHAL profile, `intersectWithFrame` would inset by the pull-off.
  - **The warning that then goes away.** Job Review's travel fact (`src/ui/laser/job-review/job-review-live-rows.ts:398-415`) is the only warning, and it goes silent once the bed equals `$130`/`$131`.
- **Anchor:**
  - **Ground truth (SOURCE).** grblHAL core [`machine_limits.c` L116-138 @ f8f10aec](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L116-L138), with negative homing and "Set machine origin to 0":
    - `sys.work_envelope.min.values[idx] = 0.0f;`
    - `sys.work_envelope.max.values[idx] = - (settings.axis[idx].max_travel + pulloff);`
    - `max_travel` is stored negative ([settings.c L215](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/settings.c#L215)).
    - `pulloff` counts when hard limits are on (L123).
    - With the published `$21=1 $23=3 $22=43 $27=5 $130=363 $131=273`, the firmware's homed envelope is X 0..358, Y 0..268.
  - **Ground truth (SOURCE).** Creality's product page (live, fetched 2026-10-29) gives the engraving area as "268*358mm".
  - **Contract.** K3-P3-1's fix direction said to keep Use detected values from copying `$130`/`$131` over a listed machine. ADR-637 Amd 2 Decision 1 keeps the listed area in the automatic fill.
- **Scenario:**
  1. An A1 Pro owner connects on 1.0.28.
     - KerfDesk reads `$$` and toasts "Machine settings detected: profile updates and review items are ready in Machine Setup."
     - It does so again at every connect: `shouldAnnounceDetectedSettings` returns true on the 2nd call too.
  2. Machine Setup lists **Bed width 358 → 363**, **Bed height 268 → 273** and **Acceleration 500 → 1000** together.
     - The acceleration change is now correct with CoreXY, so the owner presses **Use detected values**.
     - Every Start's Job Review also shows a warning-tone "Travel $130 × $131: 363 × 273 mm — profile bed 358 × 268 mm" until they do.
  3. After a Home the frame is 0..363 × 0..273 and jog limits match it.
     - A line job drawn at canvas X 320–362 emits `X362`, and Absolute preflight passes it.
     - On the 358 × 268 preset the same job is refused with `X out of bed: 362`.
     - Nothing warns: the travel fact now matches.
  4. `$20=0` (soft limits off) and the A1 Pro has no switch at X+/Y+, so the firmware does not refuse X 358–363 / Y 268–273.
     - If `$130` is the travel from the switch, as grblHAL's envelope treats it, those 5 mm run past the end of travel.
     - The head then stalls or loses steps, and the rest of the burn lands shifted.
- **Evidence:** REPRO (KerfDesk side) + SOURCE (firmware envelope). From `zz-n2-a1pro.test.ts`, test "detected values":
  ```
  TOAST rows [Bed width 358.000 mm→363.000 mm, Bed height 268.000→273.000, Z travel Not set→33.000, Acceleration 500→1000 mm/s^2]
  TOAST text Machine settings detected: profile updates and review items are ready in Machine Setup.
  TOAST announce 1st true 2nd true
  APPLIED bed 363 273 accel 1000 kin corexy homing {"enabled":true,"direction":"front-left"}
  APPLIED frame {"nativeBounds":{"minX":0,"minY":0,"maxX":363,"maxY":273},…} jog {"minX":0,"minY":0,"maxX":363,"maxY":273}
  EDGE bed=358x268 maxX=362 maxY=266 preflight ["Line 9: X out of bed: 362","Line 10: X out of bed: 362"]
  EDGE bed=363x273 maxX=362 maxY=271 preflight []
  ```
  The physical end of travel is inferred from the firmware's envelope and Creality's area, not measured.
- **Severity:** P2.
  - It is a misleading offer, now made on every A1 Pro connect, that removes the bed limit the preset and the firmware agree on.
  - It is not rated P1 because acceptance is an explicit press with old → new rows shown, and the overrun is only physical if the mechanics end where grblHAL's envelope does. That is not verified.
  - **For the refuter:** under §3, if the maintainer's unit cannot reach X 363 / Y 273, this is a wrong machine move with no warning after acceptance.
- **Novelty:** Partly KNOWN.
  - #1499's "Not done" names it: "'Use detected values' still copies the 363 × 273 travel over the listed 358 × 268 (ADR-637 Amd 2 decision 5 keeps it explicit…)".
  - H4 (rolling v3) listed "Use detected values copies `$130/$131` over a listed machine's work area" as by design. K3-P3-1 asked to stop it.
  - **New here:**
    - the every-connect offer, which #1499 introduced;
    - grblHAL's envelope proof that 363 × 273 is past the firmware's own homed limits;
    - the missing firmware inset under the Falcon command set.
- **Refuter:** CONFIRMED, **P2 kept**. Checked by the refuter's own repro on main's tree, grblHAL source the refuter fetched itself, and both published dumps re-fetched.
  - **Firmware envelope (SOURCE, re-fetched).** `machine_limits.c` L116-138 @ `f8f10aec`: with `force_set_origin` and the homing bit set in `dir_mask`, the envelope is `min = 0`, `max = -(max_travel + pulloff)`.
    - `pulloff` counts only with hard limits on (L123).
    - `limits_set_machine_positions` (L146-165) and the CoreXY override (`corexy.c` L135-153) set 0 after the pull-off move (L506-521).
    - With `$21=1 $22=43 $23=3 $27=5 $130=363 $131=273`, the homed envelope is 0..358 × 0..268, 363 mm from the switch.
    - KerfDesk's own grblHAL model says the same. `jog-travel-limits.ts:119-126` insets the far edge by the pull-off ("grblHAL's own envelope already ends a pull-off short of both edges"). It is skipped only under a command set (`manual-motion-limits.ts:141`).
  - **Does the firmware stop the move? No (SOURCE + REPRO).**
    - Both dumps read `$20=0` and `$40=1`: rayforge #461 via the GitHub API (merge `2ed50476`), and LightBurn `/t/177926.json` post 3.
    - `$20=0` leaves `sys.soft_limits.mask` empty (`settings.c` L1143-1154), so G-code targets are not checked (`planner.c` L703, `gcode.c` L3023). A burn past 358 is neither alarmed nor stopped.
    - `$40=1` would clamp `$J=` jogs to the envelope (`machine_limits.c` L772-800, `motion_control.c` L789). But the Falcon contract jogs and frames with `G1` (`jog: 'gcode-relative'`; the simulator test asserts no `$J=`), so the clamp never applies.
    - So the result is not a visible alarm. If the mechanics end near 363 mm from the switch, it is a silent stall or lost steps.
  - **Refuter REPRO** (`zz-n2r-a1pro.test.ts`): the real stores, a fake port greeting `GrblHAL 1.1f ['$' or '$HELP' for help]`, all 107 `$$` rows of rayforge #461, and Home through the driver.
    ```
    CONNECT outbound ["$$\n","$G\n",""]          (no $N=, $#, $SLP)
    ROWS-OFFER [Bed width 358.000 mm->363.000 mm, Bed height 268.000 mm->273.000 mm, Z travel Not set->33.000 mm, Acceleration 500 mm/s^2->1000 mm/s^2]
    ANNOUNCE 1st true 2nd true; REREAD patch bed 363 273 announce true
    TRAVEL-FACT before {"value":"363 × 273 mm — profile bed 358 × 268 mm","tone":"warning"}
    HOME confirmed ["$HX\n","$HY\n","G4 P0.01\n"]
    FRAME preset {0,0,358,268} limits {0,0,358,268} reach {0,0,358,268}
    ACCEPTED bed 363 273 accel 1000 kin corexy homing {"enabled":true,"direction":"front-left"}
    FRAME accepted {0,0,363,273} limits {0,0,363,273} reach {0,0,363,273}
    TRAVEL-FACT after {"value":"363 × 273 mm","tone":"default"}
    TOASTS after accept []
    JOG (click-to-position at the canvas's far edge) ["M5\nG21 G91\nG1 X363.000 F3000 S0\nG90\n"]  mpos x 363, err null, toasts []
    ```
    So a beam-off move reaches 363 mm from the pulled-off origin: 368 mm from the switch, 5 mm past `$130`. No notice of any kind appears.
  - **Every connect: yes, and it is by rule.** ADR-611 Amendment 2 says "updates always announce" (`DetectedSettingsToast.tsx:74-75`). #1499 is what put the A1 Pro under that rule.
  - **An ADR does accept the copy, but its premise does not hold.**
    - ADR-322 Amd 3 Decision 3 and ADR-637 Amd 2 Decision 5 keep **Use detected values** copying the travel, because the old → new rows are shown first.
    - Those rows are not a warning. The explicit path (`DeviceSetupFoundMachine.tsx:136-171`) shows "Your controller reports values that differ from this setup:" and the button, with no caveat.
    - The caveat ("configured travel is the controller's limit, not a measured work area" and **Work area kept at…**) appears only on the automatic path (`:58-99`, `:104-134`).
    - ADR-637 Amd 2's Context assumes "GRBL's soft limits bound travel by the same values". On grblHAL with `$21=1` they bound it to `$130 − $27`.
    - So on the correct 358 × 268 preset, Job Review's travel fact shows a warning tone at every Start, which pushes the operator toward the wrong bed.
  - **Why not P1.** The overrun is a wrong physical move only if the mechanics end where grblHAL's envelope does. That rests on `$130` being the travel from the switch, and on Creality's "268*358mm" area. Neither proves where the frame stops, and no hardware was run (§4).
    - Re-rate to P1 if the maintainer's unit cannot move to X 363 / Y 273 after a Home. No warning reaches the operator after acceptance, and Frame would not reveal it either (G6 clarification).
  - **Why not lower.**
    - Every A1 Pro owner meets the offer at every connect.
    - It is bundled with the one correct row (acceleration 1000, now right under CoreXY).
    - The result is misleading: the bed, frame, jog limits and preflight are all 5 mm wider than the firmware's own envelope.
  - **Novelty.** The copy itself is KNOWN: H4 calls it by design, and K3 line 438 noted "the extra 5 mm … equals the `$27=5` pull-off". New here:
    - the every-connect offer;
    - the source-level envelope;
    - G1 jogs bypassing `$40`;
    - the missing inset under the command set;
    - the false warning tone on the correct preset.
  - No open PR touches these files (`gh pr list`: #1478, #1515, #1516).
- **Fix direction:**
  - For a listed machine whose command set fixes the frame (the A1 Pro), leave `bedWidth`/`bedHeight` out of the detected-values patch, as the automatic fill already does (ADR-637 Amd 2 Decision 1). Or compare `$130 − $27` (with hard limits on) instead of `$130`.
  - Silence the toast and the travel fact when the controller's homed envelope equals the profile bed.
  - Amend ADR-637 Amd 2 Decision 5 for command-set machines.

### N2-P3-1 — K3-P2-2's wider reach remains: a CoreXY machine that is not the A1 Pro preset stays Cartesian unless the operator finds Motion layout; KerfDesk can show `[KINEMATICS:CoreXY]` but never uses it

- **Where:**
  - `src/core/devices/device-profile.ts:163-166`: absent is Cartesian.
  - `src/core/controllers/controller-firmware-report.ts:40`: KINEMATICS is only displayed.
  - `src/core/controllers/grblhal/driver.ts:97`: no `$I` at connect.
  - ADR-637 Amd 2 Decision 1: the automatic fill copies acceleration from `$$` on any machine.
- **Anchor:** K3-P2-2 "Wider reach: any CoreXY grblHAL machine whose `$$` KerfDesk reads gets the doubled figure". ADR-675 Alternatives: "Read the kinematics from `$I` at connect. Left out for now".
- **Scenario:**
  1. A custom or generic-grblHAL CoreXY laser connects, and Machine Setup's automatic fill copies `$120=1000`.
  2. Motion layout stays Cartesian (default).
  3. A 45° automatic runway is half what the firmware needs (the K3 numbers), and the runway advisory computes the Cartesian value.
  - The Motion layout tooltip and the `$120` tooltip now tell the operator to set it (`PlannerAdvanced.tsx:46,116`), so this is a missing detection, not a wrong default the app chose.
- **Evidence:** READ. The REPRO "ACCEL" table quantifies the gap: Cartesian 1414 vs CoreXY 707 mm/s² at 45°.
- **Severity:** P3 (improvement; the PR's own named follow-up).
- **Refuter:** CONFIRMED as fact, **KNOWN**; P3 kept.
  - The facts hold on main:
    - `machineKinematics` defaults to Cartesian (`device-profile.ts:163-166`);
    - `KINEMATICS` is only a displayed `HAL_FIELDS` entry (`controller-firmware-report.ts:40`);
    - grblHAL's `buildInfoQuery` is null (`grblhal/driver.ts:97`).
  - The refuter's motor model gives 707 mm/s² at 45° for `$120=1000`, against the Cartesian 1414.
  - It is KNOWN: K3-P2-2's "Wider reach" names it, and ADR-675 Alternatives defers it in so many words ("Read the kinematics from `$I` at connect. Left out for now").
  - Why P3 and not P1. KerfDesk's output is right for the layout the profile declares. The layout is an operator setting with its own field and tooltips (`PlannerAdvanced.tsx:46,116`). What is missing is detection, not a wrong value KerfDesk supplies.
  - The automatic fill does copy `$120`. But under the default M4 the scan-entry dose follows speed, and the runway advisory still fires once the 25 mm cap binds.
  - The coordinator may weigh this against K3-P2-2's P1.
- **Fix direction:** On grblHAL, read `$I` (or `$I+`) at connect, or on Machine Setup's Find my machine. When `[KINEMATICS:CoreXY…]` or OPT `C` disagrees with the profile, offer **Use CoreXY motion** as the preset correction does.

### N2-P3-2 — The CoreXY diagonal max-rate cap ($110/√2, 25456 mm/min on the A1 Pro) is modelled only in the time estimate; the M3 image advice can be silent above it, or recommend a speed the firmware will not reach

- **Where:**
  - `src/core/gcode-time/segment-blocks.ts:47` (`maxRateAlong`) applies the cap to estimates.
  - `src/ui/laser/constant-power-warnings.ts:66-99` uses only the along-scan acceleration; `:83` gives the sustained feed it recommends.
- **Anchor:** SOURCE, grblHAL `f8f10aec`:
  - [`planner.c` L355-366](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/planner.c#L355-L366) limits the max rate per motor;
  - L506 sets the block's `rapid_rate`;
  - L322-323 caps the nominal speed at it;
  - [`corexy.c` L218](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/kinematics/corexy.c#L218) scales the feed by motor/Cartesian distance.
  - So a 45° head move tops out at `$110`/√2. ADR-675 Context states the same.
- **Scenario.** A1 Pro with `$120=1000`, the GRBL Compatible dialect (M3 images), 45° scan angle and 2 mm pixels.
  - At 30000 mm/min the M3 advice is silent, and the firmware runs 25456. Under M3 that is a 1.179× dose over the whole row.
  - At 36000 mm/min it advises "lower the speed to about 31749 mm/min". That is still above the cap: 1.25× under M3.
  - The scan-entry runway advisory does fire across this whole speed range, because 25 mm of runway reaches only ≈11300 mm/min at 45°. So a warning to reduce speed does reach the operator before output. Only its stated cause (entry runway, not the cruise cap) is incomplete.
- **Evidence:** REPRO (`zz-n2-a1pro.test.ts`, "M3 advice"):
  ```
  M3 a=1000 speed=30000 pitch=2 45deg firmwareCap=25456 doseRatio=1.179 advice=none
  M3 a=1000 speed=36000 pitch=2 45deg firmwareCap=25456 doseRatio=1.414 advice=… (recommends 31749 mm/min, computed by lookAheadSpeedMmPerSec)
  M3 a=1000 speed=30000 pitch=2 0deg firmwareCap=30000 doseRatio=1.000 advice=none
  ```
  Runway needed at 30000 mm/min, 45°, a=1000: 176.8 mm, against the 25 mm maximum.
- **Severity:** P3. A specific runway warning always accompanies the case (§3: a warning reaches the operator), and the dose stays M4-compensated by default.
- **Refuter:** CONFIRMED, P3 kept.
  - **READ.** `imageWarning` (`constant-power-warnings.ts:66-92`) takes only `alongScanAccelMmPerSec2` and never `device.maxFeed`. Only `segment-blocks.ts:47` divides the max rate by the drive share.
  - **SOURCE re-fetched** (`planner.c` L355-366, L504-506; `corexy.c` L218):
    - the motor-space length of any head move is √2 × its length;
    - the cartesian rate cap is `$110 / max(|c+s|, |c−s|)`, which is 25455.8 mm/min at 45° (refuter's arithmetic).
  - **Numbers recomputed.** Dose 30000/25456 = 1.179 and 36000/25456 = 1.414. Runway 500²/(2·707.1) = 176.8 mm.
  - **Why the warning always fires.**
    - The manual and automatic overscan are both clamped to 25 mm (`operation-cut-extras.ts:57`, `fill-sweep-plan.ts:39`).
    - At 45° and a = 1000, 25 mm reaches only about 10760 mm/min with the 1.1 margin.
    - So the runway advisory fires whenever the speed is above the cap. The refutation "a specific warning reaches the operator" holds, and it holds P3.
- **Fix direction:** In the M3 advice and the runway advisory, use `min(speed, maxFeed / busiestDriveShareAtAngle)` as the reachable feed and say "this CoreXY machine caps a 45° scan at N mm/min".

### N2-P3-3 — A controller that reports `$22` homing off under the homing-on A1 Pro preset is shown as a plain fact; the only cue is Home's `error:5`

- **Where:**
  - `src/ui/laser/job-review/job-review-live-rows.ts:354`: `fact('Homing $22', …)`, default tone, never compared with `device.homing`.
  - The detected patch has no homing row (`DetectedSettingsBanner.tsx:41-68`).
- **Anchor:** ADR-322 Amd 3 "Awaiting confirmation": "If that unit reads `$22` with bit 0 clear, the homing default should be revisited." KerfDesk now reads `$22` on every A1 Pro connect.
- **Scenario:** A unit with `$22=0` connects.
  - Job Review shows "Homing $22: Off" in the default tone.
  - The default Start from is Absolute. Home sends `$HX` and gets `error:5`.
  - Absolute jobs run from the power-on zero with only the generic unverified-mapping note.
- **Evidence:** REPRO (variant `22=0`):
  ```
  VARIANT 22=0 Home error:5 unknown
  VARIANT 22=0 facts [{"label":"Travel $130 × $131",…,"tone":"warning"},{"label":"Homing $22","value":"Off","tone":"default"}]
  VARIANT 22=0 detected {…no homing key…}
  ```
- **Severity:** P3. The Home error is visible, and no published unit reads `$22=0`.
- **Refuter:** CONFIRMED, P3 kept.
  - **READ.** `settingsFacts` (`job-review-live-rows.ts:354`) gives `Homing $22` the default tone and never reads `device.homing`.
  - The only other cue is a generic review item. `describeReviewItems` (`DetectedSettingsBanner.tsx:112-117`) pushes "Homing cycle ($22)" for any `$22` value, with the same text whether it is on or off.
  - It is latent: both published units read `$22=43`. Without a Home there is no frame (`native-bed-frame.ts:101`), so Absolute gets the KNOWN generic unverified-mapping note, not a wrong frame.
- **Fix direction:** Give the `$22` fact a warning tone when it disagrees with `device.homing.enabled`, naming Machine Setup's homing switch. Optionally, add homing to the detected patch's review items.

### N2-P3-4 — ADR text drift in ADR-675 and ADR-322 Amd 3 / ADR-370 Amd 2

- **Where and anchor:**
  1. **ADR-675 Decision 1:** "an unknown value is dropped on load".
     - A machine profile file with an unknown `kinematics` is refused whole: "profile.kinematics is invalid" (`src/io/machine-profile/machine-profile-shape.ts:223`; #1499's own test asserts `kind: 'invalid'`).
     - A project is refused by `src/io/project/project-shape-validator.ts:149` ("missing or invalid `device.kinematics`").
     - Only `deserialize-project.ts`'s normalizer drops it, and it runs after that validator.
     - So a file from a later KerfDesk with a third layout will not open.
  2. **ADR-322 Amd 3 Decision 3:** "Pause checks laser mode".
     - The laser-mode check runs only when the driver has no safety-door byte (`src/ui/state/laser-job-pause-resume.ts:124`).
     - The Falcon contract keeps grblHAL's `0x84` (`falcon-command-contract.ts:31`, `grbl/driver.ts:69`), so it never runs on the A1 Pro.
  3. **ADR-322 Amd 3 Consequences:** "the first connect toasts that settings were read". It toasts on every connect while the profile differs (N2-P2-1 REPRO: "announce 1st true 2nd true").
  4. **ADR-370 Amd 2 Decision 2:** "Job Review's controller facts show what that controller reports for `$150`-`$153`, `$22` and `$62`".
     - Job Review's facts show `$22` (and `$30`, `$32`, `$20`, `$13`, travel) but not `$150`–`$153` or `$62` (`job-review-live-rows.ts:345-362`).
     - The settings table shows them, and `$62` reaches Release motors' reason.
- **Evidence:** READ (+ REPRO for item 3).
- **Severity:** P3 (doc/code drift).
- **Refuter:** CONFIRMED in part (items 1, 2 and 4), P3 kept. Item 3 is REFUTED (moved to Refuted). Each sentence was checked against the ADR files at `33bc394c6`:
  1. **Holds.** ADR-675 Decision 1 reads "Profile files, projects and Machine Setup round-trip it; an unknown value is dropped on load". But:
     - `validateProfileKinematics` (`machine-profile-shape.ts:220-224`) returns "profile.kinematics is invalid";
     - `project-shape-validator.ts:149` uses `optionalLiteral`, which returns "missing or invalid `device.kinematics`";
     - `deserialize-project.ts:103-104` returns `invalid` before the normalizer (`:319`) can drop the value.
  2. **Holds.** In ADR-322 Amd 3 Decision 3, "Pause checks laser mode" is false on the A1 Pro.
     - `assertPauseSafe` runs only when `safetyDoor === null` (`laser-job-pause-resume.ts:122-128`).
     - The Falcon contract keeps the GRBL driver's `realtime.safetyDoor` (`falcon-command-contract.ts:31` spreads it; `grbl/driver.ts:69` sets it).
     - #1499 did not touch the pause file.
  3. **Refuted.** ADR-322 Amd 3 Consequences reads "the first connect toasts that settings were read". That is literally true: the first connect does toast. The sentence does not say "only".
     - Repeating while the profile differs is ADR-611 Amendment 2's stated rule ("updates always announce").
     - The repeat is part of N2-P2-1, not ADR drift.
  4. **Holds (minor).** ADR-370 Amd 2 Decision 2 reads "Machine Setup's settings table and Job Review's controller facts show what that controller reports for `$150`-`$153`, `$22` and `$62`".
     - Job Review's `settingsFacts` (`job-review-live-rows.ts:345-362`) lists `$32`, `$30`, travel, `$22`, `$20` and `$13`. It shows neither `$150`–`$153` nor `$62`.
- **Fix direction:**
  - Correct the four sentences, or drop an unknown layout at both validators as Decision 1 says.
  - For a fifth gap, see N2-P3-5.

### N2-P3-5 — Test gaps: no test drives the published banner and full dump through Home to the frame, and the #1513 Falcon wizard e2e no longer checks homing or kinematics

- **Where:**
  - **The simulator tests.** `src/ui/state/laser-lifecycle-falcon.simulator.test.ts:37-46` and `laser-home-falcon-relock.test.ts` greet `Grbl 1.1f` (lifecycle) or answer a 5–7 row `$$`.
    - `falcon-a1-pro-preset-homing.test.ts` checks the frame with a hand-built `homingState: 'confirmed'`, not a Home through the driver.
    - No test asserts that connect sends no `$N=`/`$#`.
  - **The e2e.** `e2e/production-workflows.spec.ts:447-454`: since #1513 the saved device is checked for `profileId`, `controllerKind`, `controllerCommandSet`, bed and frame feed only.
- **Anchor:** ADR-322 Amd 3 Verification. #1513 removed the Replace step on purpose (both machines home front-left; `machine-choice-replaces.ts` TUNED_SETTINGS). That change is legitimate, but the spec does not assert the value that caused it.
- **Scenario:** A later change that drops `homing` or `kinematics` from the wizard's saved device, or that sends a write at connect, passes every current Falcon test.
- **Evidence:** READ. This audit's repro covers both paths and passes on main.
- **Severity:** P3 (test gap).
- **Refuter:** CONFIRMED, P3 kept.
  - Seven Falcon tests greet the A1 Pro with `GrblHAL 1.1f`, and none of them closes the gap:
    - `laser-home-falcon-relock.test.ts:98` answers five rows (`$22=47`) and asserts the Home lines, not the frame;
    - `frame-wcs-normalization-falcon`, `autofocus-crafted-project`, `laser-console-falcon-air-settings`, `laser-motion-release`, `laser-parser-rearm` and `controller-sleep` assert other things.
  - None asserts that connect sends no `$N=`/`$#`.
  - The e2e `toMatchObject` (`production-workflows.spec.ts:447-454`) leaves out `homing` and `kinematics`.
  - The refuter's own full-dump repro passes on main (N2-P2-1 output: Home through the driver gives the 0..358 × 0..268 frame; connect sends only `$$` and `$G`). So this is a test gap only.
- **Fix direction:**
  - Add `homing: {enabled:true, direction:'front-left'}` and `kinematics:'corexy'` to the e2e `toMatchObject`.
  - Add one simulator test with the `GrblHAL 1.1f` banner and the full published `$$` that Homes through the driver and asserts the frame and the absence of `$N=`/`$#`/`$SLP`.

## KNOWN re-observed

- **C7-P3-3 (A1 Pro acceleration 500, firmware 1000).** CoreXY now makes it doubly conservative.
  - At 10000 mm/min a 45° Fill wants 43.2 mm and is held at the 25 mm maximum.
  - The runway advisory then fires: "needs about 39.2837 mm", where the firmware needs 19.6.
  - The 0° case fires too (27.8 > 25) and did so before #1499.
  - This is a false-positive advisory in the safe direction. Fixing C7-P3-3, or accepting accel 1000 now that CoreXY is modelled, removes it. That trips over N2-P2-1 if done through **Use detected values**.
- **Frame-first Absolute without a Home** (guard inventory 2026-07-18, item 18 deleted).
  - The A1 Pro now defaults to Absolute. Before a Home this session it gets the generic `UNKNOWN_NATIVE_BED_MESSAGE`, and a camera placement says "Home is not confirmed; watch Frame to verify the exact placement."
  - ADR-322 Amd 3 Consequences accept this, as LightBurn's Absolute does.
- **D5-P3-4.** Before a Home, the no-go refusal still blames "this hand-set origin" on an Absolute A1 Pro job.
- **HF-4 / HF-7.** Release motors on the A1 Pro is now disabled with the `$62=0` reason, not sent. Fixed for this firmware by #1499's read.
- **J8-P3-2 (`$150`–`$152`).** Refused on the Console, the Machine Settings write, macros (same Console guard), Run G-code file (`$` lines refused, `normalize-external-program.ts:272`) and both Falcon drivers.
  - The connect `$$` also gives the stock-GRBL Falcon driver grblHAL evidence (`$14`–`$18`).
  - No remote route sends `$` lines (`remote-control/machine-validation.ts:5-23`).
- **K3 camera path.** Old A1 Pro calibrations, fitted while the offset was unknown, get `UNVERIFIED_FRAME_NOTE` once homed (`camera-bed-frame.ts:125-130`). The calibration step now says "Home the machine before engraving the target". The P1 re-weigh K3 asked for no longer applies.
- **K3 Not verified, FluidNC CoreXY.** Still not read. ADR-675 claims grblHAL only.

## Refuted

- **"After a failed Falcon Home, Home stays blocked."**
  - In the first run Home was refused with "previous controller write … settle" because the fake port did not answer the bare `\n` that grblHAL's sticky-error clear sends (`grblhal/driver.ts` `stickyLineError`).
  - With that `ok`, the retry Homes and confirms (`HOME2 outcome resolved confirmed`).
- **"The CoreXY diagonal speed cap silently over-burns M3 images."** The scan-entry runway advisory fires for every 45° speed above ≈11300 mm/min at a=1000, so a warning reaches the operator. Kept as P3 (N2-P3-2).
- **"Pause's new laser-mode check can block Pause on a Falcon whose `$$` failed."** The Falcon has a safety-door byte, so the check never runs (ADR drift N2-P3-4.2).
- **"Auto-focus drops the frame."** The Auto-focus button keeps XY homing (`laser-autofocus-actions.ts:171-183`). Only a typed Console `$HZ1` voids it, deliberately (gap-start-8).
- **"Choosing another listed machine after the A1 Pro keeps CoreXY."** `apply-preset` replaces the whole draft, and **My machine isn't listed** starts from the firmware starter (`machine-picker-entries.ts:241-305`).
- **"#1513's e2e change hides a regression."** The Replace prompt disappeared because the A1 Pro now homes at the front left like the fixture's machine, and ADR-637 Amd 1 asks only before replacing tuned values. The xTool spec still covers Replace.
- **"Emitter v40 changes Cartesian output."** It does not: bytes, estimates and runways are identical in 135/135 rows.
- **"A failed or partial `$$` blocks Start."** Qualification gates only supervised recovery (`laser-controller-qualification.ts:93-97`). The laser readiness path warns on absent settings.
- **"The CoreXY time model double-applies the Cartesian junction share."** `junctionVelocity` takes the acceleration as given. The CoreXY corner then gives v² = a·δ·(1+√2)/2, which matches grblHAL's motor-space junction (`planner.c` L555-575) when re-derived.
- **N2-P3-4 item 3 (refuter): "ADR-322 Amd 3 Consequences says only the first connect toasts."**
  - The sentence says "the first connect toasts that settings were read". That is true on main, and it does not say "only".
  - The repeat at later connects follows ADR-611 Amendment 2 ("updates always announce"). It belongs to N2-P2-1, not to ADR drift.

## Refuter method (fresh context, 2026-10-29)

- **Tree.** `origin/main` @ `33bc394c6`, fetched again. Seven cited source files in `j7-main` compared byte for byte with `origin/main`: all the same.
- **Firmware source, fetched by the refuter.** `raw.githubusercontent.com/grblHAL/core/f8f10aecdf05943e3a02b1ac3c691b666a811495/`:
  - `machine_limits.c`, `settings.c`, `settings.h`, `motion_control.c`, `gcode.c`, `planner.c`, `kinematics/corexy.c`.
  - Read: the envelope (L116-138), machine positions (L146-165, `corexy.c` L135-153), the end of the homing cycle (L506-521), the soft-limit mask (`settings.c` L1143-1163), the jog clamp (`machine_limits.c` L772-800, `motion_control.c` L789-792, `$40` = `Setting_JogSoftLimited`), and the per-motor planner limits (`planner.c` L342-366, L416-420, L504-506).
- **Dumps, fetched by the refuter.**
  - rayforge #461 body through `gh api` (merge `2ed50476475a`, head `2675a36a0c4a`, merged 2026-09-26T21:27:13Z): 107 `$` rows.
  - LightBurn `/t/177926.json` post 3 (2025-08-19T20:39:25Z).
  - Both read `$20=0 $21=1 $22=43 $23=3 $27=5.000 $40=1 $44=4 $45=1 $46=2 $120=$121=1000 $130=363 $131=273`.
- **Repros** (`j7-main`, `zz-n2r-vitest.config.ts` with an fflate alias and one worker, run one at a time; all deleted afterwards):
  - **`src/zz-n2r-a1pro.test.ts`.** Real `useLaserStore`/`useStore`. A fake port greets with the published banner and answers the full dump and `$G`. Home goes through the driver. Then: the detected patch, `shouldAnnounceDetectedSettings` twice plus a re-read, Job Review travel facts, **Use detected values** through `initDeviceSetup` → `deviceSetupReducer('accept-detected')` → `machineSetupProfile` → `updateDeviceProfile`, the frame, the limits and reach before and after, and `dispatchPositionLaser` at the far edge. 1 passed. Output under N2-P2-1.
  - **`src/zz-n2r-runway.test.ts`.** An independent CoreXY motor model (A = X+Y, B = X−Y, a / max(|c+s|, |c−s|)) against `alongScanAccelMmPerSec2` and `automaticOverscanMm` at a = 1000 and 10000 mm/min. 1 passed:
    ```
    ANGLE 0 model 1000.000 app 1000.000 need 13.889 x1.1 15.278 app-runway 15.3
    ANGLE 30 model 732.051 app 732.051 need 18.973 x1.1 20.870 app-runway 20.9
    ANGLE 45 model 707.107 app 707.107 need 19.642 x1.1 21.606 app-runway 21.7
    ANGLE 63 model 743.496 app 743.496 need 18.681 x1.1 20.549 app-runway 20.6
    ANGLE 112.5 model 765.367 app 765.367 need 18.147 x1.1 19.961 app-runway 20
    CARTESIAN-45 runway 10.9    DIAG-CAP 45 25455.8
    ```
    The 21.7 mm figure **holds**: 21.606 mm rounded up on the 0.1 mm grid (`automatic-overscan.ts:55-56`). So does the parent's 10.9 mm.
  - **Test truth (spot check).** This used aliases to parent `5f3c420f4` copies of single files (`git show`; plain files, no links), not a full parent tree. Holds:
    - `falcon-command-contract.test.ts` with the parent contract: 1 failed / 4 passed ("expected null to be '$$'").
    - `falcon-a1-pro-preset-homing.test.ts` with only the parent preset: 4 failed / 1 passed (homing false, `user-origin`, no frame, offset undefined). The 5th case needs the parent contract too, which is consistent with the auditor's 5/5 on the full parent.
- **"Holds" claims spot-checked.**
  - The after-Home frame 0..358 × 0..268: holds, through a driver Home with the full dump.
  - Connect and Home send no `$N=`, `$#` or `$SLP`: holds.
  - The 45° runway: holds.
  - Test truth: holds for the two files checked.
- **Novelty.**
  - `gh pr list --state open`: #1478, #1515 and #1516; none touches these files.
  - `docs/audits` grep: H4 (by-design copy), K3 (line 438 pull-off note, line 353 fix direction), E2.
- **Not run.** The Absolute preflight edge job (the auditor's REPRO stands; the refuter drove the jog path instead), and the `$22=0` variant (READ only).

## Verified clean

- **K3-P2-1, K3-P2-2, K3-P3-1, K3-P3-2.** All fixed as described in the matrix.
  - K3-P3-2: the preset's evidence notes cite both dumps (`falcon-profiles.ts:65-75`). The `native-bed-frame.ts:119-126` comment is updated.
- **The `$$` failure modes** (REPRO):
  - **Timeout:** qualification failed ("controller settings query timed out."), `$G` skipped (`activeWcs null`), connection kept. Only `$$` was sent.
  - **`error:3`:** failed, and a bare `\n` clears grblHAL's sticky error.
  - **Partial (first 20 rows):** qualified; laser mode unverified, so Start asks for the `$30`/`$32` acknowledgement.
  - **Stock-like dump under a `Grbl 1.1f` banner:** qualified; the vendor frame applies after Home (HF-8 design).
  - None of them writes anything.
- **The settings capability.** `grbl-dollar-read` never passes a `=== 'grbl-dollar'` write gate:
  - `console-setting-writes.ts:96`;
  - `grbl-settings-actions.ts:206`;
  - `controller-sleep.ts:63`;
  - `DeviceSetupMachineStep.tsx:58`.
  - Every `!== 'none'` branch it now passes is a read: `MachineSettingsPanel`, `SuperConsoleSettingsPane`, `external-run-readiness`, `laser-mode-start-evidence`.
- **Saving.**
  - Machine Setup saves `kinematics` with the draft (`device-setup-flow.ts:331-345`).
  - Profile files and projects round-trip it (#1499's test, which fails on the parent).
  - Old projects and profiles load as Cartesian and are named in Job Review.
- **Time model.** Cartesian estimates are unchanged (identical `estimateJobDuration` in all 135 rows). CoreXY estimates rise, for example the A1 Pro 45° fill from 25.8 s to 34.75 s.
- **ADR-664 / ADR-640.**
  - The laser dot holds the Fire latch, which refuses Home. Home and its new frame do not touch the dot's transaction.
  - The Falcon has no jog-cancel byte, unchanged.
  - A reconnect resets `homingState` (`laser-connection-actions.ts:254,294`), so the frame needs a new Home.
- **Recovery after an alarm.** `CheckpointResumeBanner.tsx:152` now offers Home on the A1 Pro (READ).

## Not verified

- **The maintainer's own A1 Pro.** Not read. Read-only checklist, typed in KerfDesk's Console on the A1 Pro preset, lid closed, no job:
  - **Before you start.** Since 1.0.28, connecting already sends `$$`.
    - Do **not** press **Use detected values** or accept the detected-settings toast (N2-P2-1).
    - Do not click the Console's quick buttons: they include `$X` and `$#`.
    - Never send a line with `=`.
  - **Step 0 (no command).** Power on and watch whether the head homes by itself.
  - **`$I`:**
    - `[FIRMWARE:grblHAL]`;
    - `[KINEMATICS:CoreXY v2.02]` and `C` in `[OPT:…]` (ADR-675);
    - `HOME` in `[NEWOPT:…]`;
    - `[Firmware:Version …]` and `[BUILD:…]` against v1.0.4 / 20260706154934. The Super Console's parsed report drops `[Firmware:…]` and `[BUILD:…]`, so read the raw Console lines.
  - **`$$`:**
    - `$22`: is bit 0 set? Is bit 2 clear? 43 is expected, 47 means the startup lock is on, 0 is N2-P3-3.
    - `$23=3`, `$27`, `$20`/`$21`, `$62`.
    - `$110`/`$111`, `$120`/`$121`.
    - `$130`/`$131`: with `$27` this gives the firmware envelope; 363 − 5 = 358 is expected.
    - `$150`–`$153` (16 means microsteps).
  - **`?`:** `MPos`, `Bf:` and whether `WCO:` appears.
  - **Out of scope:** settling N2-P2-1's physical part (can the head reach X 363 / Y 273 after a Home?) needs motion and is not on this read-only list.
- **The physical end of travel** past 358/268 (N2-P2-1).
- **Creality's wiki pages.** They render client-side, so the live fetch returned no content, and `web.archive.org` is blocked to this session. K3's pinned archive copies stand unre-checked. Creality's product page (fetched 2026-10-29) states the 268 × 358 mm area and 600 mm/s and, in its visible part, no motion structure.
- **Creality's firmware fork.** Its source is not public. That it keeps stock grblHAL's CoreXY planner and envelope code is inferred from its `$I` (`CoreXY v2.02`, the `f8f10aec` code) and from two units' behaviour.
- **Falcon A1 (stock GRBL) kinematics.** No preset, so not checked.
- **FluidNC and Marlin CoreXY planners.**
- **The Falcon wizard e2e and the rest of the browser suite.** Not run here (#1513 reports it green).

## L2 sources (pinned)

**SOURCE: firmware code at grblHAL core [`f8f10aec`](https://github.com/grblHAL/core/tree/f8f10aecdf05943e3a02b1ac3c691b666a811495).** This is the commit that brought "CoreXY v2.02", the version the A1 Pro reports. Files were fetched 2026-10-29 through the GitHub API.

| Claim | Source line | Quote |
|---|---|---|
| CoreXY motor transform | `kinematics/corexy.c` L68-78 | `target[X_AXIS] = position[X_AXIS] + position[Y_AXIS];` |
| Feed scaled into motor space | `kinematics/corexy.c` L218 | `pl_data->feed_rate *= get_distance(trsf, position) / get_distance(target, cpos);` |
| Unit vector from motor steps | `planner.c` L420 | `unit_vec[idx] = (float)delta_steps / settings.axis[idx].steps_per_mm;` |
| Per-motor acceleration and rate limits | `planner.c` L342-366, L505-506, L322-323 | `limit_value = min(limit_value, fabsf(settings.axis[idx].acceleration / unit_vec[idx]));` |
| Junction planned in motor space | `planner.c` L559-575 | `float junction_acceleration = limit_acceleration_by_axis_maximum(junction_unit_vec);` |
| `$I` prints kinematics | `kinematics/corexy.c` L236-241 (called from `report_build_info`, `report.c` L1110) | `"[KINEMATICS:CoreXY v2.02]"` |
| OPT `C` and NEWOPT `HOME` | `report.c` L868-869; L963-964 | `#if COREXY` … `'C'`; `if(settings.homing.flags.enabled) strcat(buf, "HOME,");` |
| `$22` bit names | `settings.c` L444 | `"Enable,Enable single axis commands,Homing on startup required,Set machine origin to 0,…"` |
| `$150` is the axis microstep setting | `settings.h` L35, L157, L517 | `Setting_AxisMicroSteps = Setting_AxisSettingsBase + 5 * AXIS_SETTINGS_INCREMENT` (100 + 50) |
| Homed envelope with forced origin | `machine_limits.c` L116-138, `settings.c` L215 | `sys.work_envelope.max.values[idx] = - (settings.axis[idx].max_travel + pulloff);` |

**SOURCE: the two published dumps, re-fetched 2026-10-29.**
- **barebaric/rayforge PR #461** via the GitHub API: merge `2ed50476475a22703812781f369bc2f871225725`, head `2675a36a0c4a`, merged 2026-09-26T21:27:13Z.
  - Body SHA-256 `a5713551d568…`. This differs from K3's `49f2cf09…`; the PR body may have been edited or hashed differently. Every value used here matches K3's table.
  - The body prints `$22=43`, `$27=5.000`, `$120=$121=1000.000`, `$130=363.000`, `$131=273.000`, `$150`–`$153=16`, `[KINEMATICS:CoreXY v2.02]` and `[OPT:VNMCZHL,512,65536,4,0]`.
- **LightBurn forum topic 177926**, `/t/177926.json` fetched live: post 3, created 2025-08-19T20:39:25Z, updated 20:55:03Z. It shows the same rows and the `GrblHAL 1.1f` banner.

**SOURCE: Creality.** `creality.com/products/falcon-a1-pro-20w`, live 2026-10-29, gives the engraving area "268*358mm" and 600 mm/s. No Creality page reached by this audit documents `$22`, `$150`–`$152` or CoreXY.

**Inferred, not source:**
- that Creality's fork behaves like stock `f8f10aec` in the planner and envelope;
- that `$130` equals the physical travel from the switch;
- that the maintainer's unit matches the dumps.

## Test truth

#1499's test files from main were copied into the parent tree (`5f3c420f4`) and run one at a time:

| Test file (main version) | On parent |
|---|---|
| `core/job/automatic-overscan.test.ts` | 4 failed / 6 passed (every CoreXY case fails; e.g. "expected 13.3 to be 20.9") |
| `ui/state/falcon-a1-pro-preset-homing.test.ts` | 5/5 failed (homing false, `user-origin`, no frame, offset undefined, `'none'`) |
| `ui/laser/scan-quality-warnings.test.ts` | 1 failed (CoreXY advisory) / 16 passed |
| `core/devices/preset-corrections.test.ts` | 1 failed (A1 Pro corrections) / 7 passed |
| `core/controllers/falcon-command-contract.test.ts` | 1 failed (`$$` query null) / 4 passed |
| `core/gcode-time/program-time-corexy.test.ts` | 3 failed / 1 passed |
| `io/machine-profile/machine-profile-kinematics.test.ts` | 2/2 failed |
| `ui/laser/constant-power-warnings.test.ts` | 1 failed (CoreXY corner 2.46 vs 4.13) / 12 passed |
| `ui/state/laser-lifecycle-falcon.simulator.test.ts` | 1 failed (no `$$` at connect) / 4 passed |
| `ui/laser/PlannerAdvanced.test.tsx` | 1/1 failed ("no Motion layout select") |
| `core/motion-planner/drive-share.test.ts` | fails at import (new module) |

## Repro files (deleted after the run)

| File | What it did |
|---|---|
| `j7-main\src\zz-n2-a1pro.test.ts` | The repro on main. It covered: the catalogue listing; the simulated A1 Pro (published banner, full `$$`, `$I`) for connect, Home, frame, jog limits, preflight offset and sent lines; Home failure and `ALARM:1`; the `$$` variants (timeout, error, partial, `$22=0`, stock banner); Console and Machine Settings writes; detected values and the edge job; the motor-model angle table; Fill compile, preflight and advisory at 0/30/45°; the stored 5 mm advisory; the preset corrections; the M3 advice against the diagonal cap |
| `j7-main\src\zz-n2-bytes.test.ts` (and its copy in the parent tree) | Hashed the emitted G-code and printed estimates and runways for 15 profiles × 9 jobs, on main and on the parent |
| `j7-main\zz-n2-parent\` | `git archive 5f3c420f4` of `src`, `scripts`, `public` and the root configs, for the bytes and test-truth runs. It was moved out of `j7-main` before it was deleted; it held no link |
| `scratchpad\zz-n2-src\` | grblHAL `f8f10aec` source files fetched for L2 |
| `scratchpad\zz-n2-rayforge-461-body.txt`, `zz-n2-lb-177926.json` | The two published dumps |
| `scratchpad\zz-n2-*.log`, `zz-n2-m.txt`, `zz-n2-p.txt`, `zz-n2-patch.cjs`, `zz-n2-pat.txt` | Run logs, the bytes comparison, and edit helpers |
| Refuter: `j7-main\src\zz-n2r-a1pro.test.ts`, `j7-main\src\zz-n2r-runway.test.ts`, `j7-main\zz-n2r-vitest.config.ts` | The refuter's repros (see Refuter method) |
| Refuter: `j7-main\src\core\devices\zz-n2r-parent-falcon-profiles.ts`, `j7-main\src\core\controllers\zz-n2r-parent-falcon-command-contract.ts` | Parent `5f3c420f4` copies, aliased in for the test-truth spot check |
| Refuter: `scratchpad\zz-n2r-src\`, `zz-n2r-dumps\`, `zz-n2r-scripts\` | grblHAL `f8f10aec` files, the two dumps, and a dump-extraction helper |

```json
[
  {"id":"N2-P2-1","severity":"P2","area":"fix-a1-pro","file":"src/ui/laser/DetectedSettingsToast.tsx","line":74,"anchor":"Ground truth: grblHAL machine_limits.c L116-138 @ f8f10aec (homed envelope max = -(max_travel + pulloff) => 363-5 = 358, 273-5 = 268 with $21=1 $22=43 $23=3 $27=5); Creality product page '268*358mm' (live 2026-10-29); Contract: K3-P3-1 fix direction, ADR-637 Amd 2 Decision 1","evidence":"REPRO (auditor + refuter: toast announces on every read; Use detected values -> bed 363x273, vendor frame and jog limits 0..363x0..273; edge job X362 passes preflight; click-to-position G1 X363) + SOURCE (envelope, $20/$40 semantics); physical end of travel inferred","verdict":"confirmed","known":"partly: #1499 'Not done', H4 by-design note, K3-P3-1 fix direction","summary":"#1499 reads $$ at every A1 Pro connect, so every connect offers $130/$131 (363x273) as profile updates; accepting moves the vendor frame, jog limits and preflight 5 mm past grblHAL's own homed envelope (0..358x0..268) with no firmware inset under the command set and no warning afterwards","refuter":"CONFIRMED P2 kept: own REPRO (GrblHAL banner, full rayforge $$, driver Home, accept-detected via reducer) -> frame/limits 0..363x0..273, travel fact silent, no toast, click-to-position sends G1 X363.000; SOURCE re-fetched: envelope 0..358x0..268, $20=0 so G-code unchecked, $40=1 jog clamp bypassed because the Falcon contract jogs with G1; P1 if the unit cannot reach X363/Y273 after Home"},
  {"id":"N2-P3-1","severity":"P3","area":"fix-a1-pro","file":"src/core/devices/device-profile.ts","line":164,"anchor":"K3-P2-2 wider reach; ADR-675 Alternatives ('Read the kinematics from $I at connect. Left out')","evidence":"READ (+ REPRO angle table)","verdict":"known","known":"K3-P2-2 wider reach; ADR-675 Alternatives defers $I kinematics detection","summary":"A CoreXY machine other than the A1 Pro preset stays Cartesian unless the operator sets Motion layout; KINEMATICS from $I is displayed but never used, and the automatic fill copies $120 regardless","refuter":"CONFIRMED as fact, KNOWN; P3 kept (output matches the declared layout; detection missing, deferred by ADR-675)"},
  {"id":"N2-P3-2","severity":"P3","area":"fix-a1-pro","file":"src/ui/laser/constant-power-warnings.ts","line":83,"anchor":"SOURCE grblHAL f8f10aec planner.c L322-323, L355-366, L506; corexy.c L218 (diagonal capped at $110/sqrt2)","evidence":"REPRO (a=1000, 45 deg, 2 mm pixels: silent at 30000 mm/min where the firmware runs 25456; at 36000 it recommends 31749, still above the cap; runway advisory fires across the range)","verdict":"confirmed","known":false,"summary":"The CoreXY diagonal max-rate cap is modelled only in the time estimate; the M3 advice ignores it and can recommend an unreachable speed, though the runway advisory warns in the same range","refuter":"CONFIRMED P3 kept: imageWarning ignores maxFeed; cap 25455.8 at 45 deg recomputed; overscan clamped to 25 mm so the runway advisory always fires above the cap"},
  {"id":"N2-P3-3","severity":"P3","area":"fix-a1-pro","file":"src/ui/laser/job-review/job-review-live-rows.ts","line":354,"anchor":"ADR-322 Amd 3 'Awaiting confirmation' (revisit if $22 bit 0 is clear)","evidence":"REPRO (variant $22=0: fact 'Homing $22 Off' default tone; Home error:5; no homing row in the detected patch)","verdict":"confirmed","known":false,"summary":"A controller reporting $22 homing off under the homing-on A1 Pro preset is shown as a plain fact; only Home's error:5 hints at it while Start from defaults to Absolute","refuter":"CONFIRMED P3 kept (READ): Homing $22 fact default tone, review item text identical for on/off; latent (both units $22=43)"},
  {"id":"N2-P3-4","severity":"P3","area":"fix-a1-pro","file":"src/io/machine-profile/machine-profile-shape.ts","line":223,"anchor":"ADR-675 D1 ('unknown value is dropped'); ADR-322 Amd 3 D3 ('Pause checks laser mode'); ADR-370 Amd 2 D2 (Job Review shows $150-$153 and $62)","evidence":"READ","verdict":"confirmed","known":false,"summary":"ADR drift: unknown kinematics refuses the whole profile/project; the Pause laser-mode check never runs on the Falcon (safety-door byte); Job Review shows $22 but not $150-$153 or $62","refuter":"CONFIRMED in part P3 kept: items 1 (validators refuse unknown kinematics), 2 (Pause check skipped with safety-door byte), 4 (Job Review lacks $150-$153/$62) hold; item 3 refuted (first connect does toast; repeat is ADR-611 Amd 2)"},
  {"id":"N2-P3-5","severity":"P3","area":"fix-a1-pro","file":"e2e/production-workflows.spec.ts","line":447,"anchor":"ADR-322 Amd 3 Verification; #1513 e2e change","evidence":"READ","verdict":"confirmed","known":false,"summary":"No test drives the published GrblHAL banner and full $$ through a driver Home to the frame or asserts that connect sends no write; the Falcon wizard e2e no longer asserts saved homing or kinematics","refuter":"CONFIRMED P3 kept (READ): seven GrblHAL-banner Falcon tests use short dumps or other assertions; none Homes through the driver to the frame or asserts no $N=/$#; e2e omits homing/kinematics"}
]
```
