# Controller audit v2 — C1 Native resume program (`ctl-native-resume`)

- **When:** 2026-10-22 08:20   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD `db59d99a9`;
  `git diff 99a2e64b7 HEAD -- src` is empty)
- **Scope:** the G-code KerfDesk writes to resume an interrupted laser (or CNC) job from a line.
  - `src/core/controllers/grbl/`: `resume-program.ts`, `laser-resume-reentry.ts`,
    `native-laser-resume.ts`, `native-laser-resume-beam.ts`, `laser-resume-dialect.ts`,
    `resume-travel.ts`, `resume-travel-arc.ts`, `resume-head-stop-block.ts`,
    `focus-resume-issue.ts`.
  - Callers: `src/ui/laser/laser-resume-program.ts`, `start-job-resume-stream.ts`,
    `laser-recovery-flow.ts`, `laser-recovery-head-stop.ts`, `LaserRecoveryMoveTo.tsx`,
    `resume-confirmation.ts`.
  - Twins followed into the emitters: `grbl-strategy.ts`, `grbl-laser-lines.ts`,
    `grbl-laser-arc-moves.ts`, `marlin-strategy.ts`, `marlin-inline-transform.ts`,
    `marlin-fan-transform.ts`, `marlin-travel-feed.ts`, `smoothieware-strategy.ts`,
    `focus-test-emission.ts`, `core/gcode/motion-words.ts`, and the painted-pass source
    (`core/laser-second-pass/source.ts`).
  - Governing documents: ADR-341 and Amendments 2, 3, 6 and 8; ADR-364; ADR-398 and Amendments 1
    and 2; ADR-432; ADR-236 (4040 controlled laser-off travel); ADR-602 (relative Z Focus Test);
    PROJECT.md invariant 3 (laser off on travel).
- **Lenses run:**
  - L1, L2, L3, L4 and L7 as separate passes.
  - L6 only for the build-error paths. `buildResumeProgram` returns typed errors and does not
    throw, and both callers alert and stop before any controller write.
  - L5 skipped. The resume input is KerfDesk's own sealed or compiled program. External G-code
    runs get no resume (ADR-630; report 05-P3-1), and `.lf2` injection belongs to 03-P1-1.
- **Primary sources fetched this session:**
  - GRBL v1.1 wiki "Laser Mode".
  - Marlin 2.1.2.6 `M3-M5.cpp` and `gcode.cpp` (`get_destination_from_command`).
  - Smoothieware edge `GcodeDispatch.cpp` and `Laser.cpp`.
- **Counts:** 5 raised → 0 refuted (refuter: 5 CONFIRMED, 0 PLAUSIBLE; no severity changes) →
  P1 0 / P2 0 / P3 5 (+ 5 KNOWN re-observed).

## Headline

KerfDesk's own laser output resumes correctly on every dialect. The move to the resume point is
always dark. GRBL-family sends `M5` before any motion and `G0 … S0`. Marlin inline sends `M5 I`,
and G0 zeroes inline power. Marlin fan sends `M107`. Smoothieware sends `fire off`, then
`M221 S0`, and G0 never fires there. The beam is re-armed only at S0, at the resume point.

An independent arc-aware GRBL interpreter was run over the arcs that ADR-432 emits. It found the
same burns for all 169 restart lines and for 286 restarts of resumed programs. No line between
resume start and the first burn lit the beam, from a lit M3 start. Each resumed tail differs from
the original by at most one line: the restated S of the first burn.

Five P3s remain:
- The re-entry ignores two travel policies the program itself follows: the 4040's controlled
  laser-off seeks, and Marlin's G0 feed (MA-8).
- Air left on at reconnect is never turned off.
- On constant-power output, a restart inside a lit sweep accelerates from standstill with the
  beam on.
- No resume oracle covers arc output.

CNC automatic resume is refused outright, so the Z re-entry questions do not arise.

## Findings

### P3-1 — On profiles with controlled laser-off travel (the built-in Neotronics 4040), the resume re-enters with an unbounded `G0` rapid that the program itself never uses
- **Where:**
  - `src/core/controllers/grbl/resume-program.ts:344-349`: `positionMove` always writes
    `G0 X… Y… S0`.
  - The emitter twin is `src/core/output/grbl-laser-lines.ts:41-55`. `laserOffSeekLine` writes
    `G1 X… Y… F<controlled> S0 ; kerfdesk:laser-off-motion` when
    `device.controlledLaserOffTravelFeedMmPerMin` is set. The 4040 sets 800
    (`src/core/devices/device-profile.ts:435`).
- **Lens:** L3, L1.
- **Anchor:**
  - Contract: ADR-236 (DECISIONS.md:11224-11226), "The built-in 4040 sets it to 800 mm/min, so
    vector and raster laser-off seeks emit explicit `G1 ... F800 S0`". It was added because
    "laser-off repositioning used unbounded `G0`" (DECISIONS.md context of ADR-236).
  - Twin: the painted second pass enters "with the source's own travel style" (ADR-341 Amendment
    2 decision 3; `core/laser-second-pass/source.ts:223-224`). The job park also uses
    `laserOffSeekLine`.
- **Scenario:**
  1. A 4040 job is interrupted after a lost link, a reset or an Abort.
  2. Recovery or Start from line is used.
  3. The preamble writes `G0 X33 Y379.500 S0`, a full-rate rapid from wherever the head stands
     to the restart point. This is often the longest move of the run.
  4. The original program contains no `G0` at all: 62 of 62 seeks are controlled `G1 … F800 S0`.
  5. The move is dark, because `M5` precedes it. The defect is that the profile's travel-quality
     policy is bypassed on exactly the move it was meant to bound.
- **Evidence:** REPRO. Temporary `src/core/controllers/grbl/zz-c1-resume-dialects.test.ts`
  (deleted; copy in the session scratchpad `repros-c1/`). It emitted `mixedLaserProject` for
  `NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE` and resumed at line 94. Command:
  `node ../../../node_modules/vitest/vitest.mjs run src/core/controllers/grbl/zz-c1-resume-dialects.test.ts`.
  Output:

  `{"name":"4040","programG0":0,"controlledSeeks":62,"at":94,"preamble":["; KerfDesk resume preamble","G21","G90","G54","G94","M5","G0 X33 Y379.500 S0","M3 S0","F1500","G1 X40.828 Y380.931 F800 S0 ; kerfdesk:laser-off-motion",…]}`.
- **Refuter:** CONFIRMED (REPRO + twin).
  - *False if:* the 4040 program already contains `G0`, the builder or a caller writes the
    re-entry as a controlled seek, or ADR-236 scopes the 800 mm/min policy so that it excludes
    the resume.
  - *Checked:*
    - Independent repro: temporary `zz-c1r-resume.test.ts` (deleted; copy in the refuter
      scratchpad), same Vitest command, over every restart line of `mixedLaserProject` on
      `NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE`. Output:
      `{"g0":0,"ctl":21,"lineCount":179,"checked":177,"g0Reentries":167,"controlled":0}`.
      The program has no `G0` at all. 167 of 177 resume preambles write a full-rate `G0 X Y S0`,
      and none writes a controlled seek. `ctl` counts only the `F800` seeks; the auditor's 62
      also counted the burn-feed runways that carry the same marker.
    - `resume-program.ts:344-349` never reads the device. `controlledLaserOffTravelFeedMmPerMin`
      is read only by the emitters and by preflight.
    - ADR-236 says "vector and raster laser-off seeks emit explicit `G1 ... F800 S0`", and no
      ADR exempts the resume. ADR-341 Amendment 2 decision 3 makes the painted-pass twin avoid
      exactly this: "position with that move's feed rather than a rapid"
      (`laser-second-pass/source.ts:221-229`).
  - *Severity:* P3 is right. The move is dark, and ADR-236 itself says the quality cause is
    unproven on hardware. The 4040's Frame (2000 mm/min) and jogs also run outside the 800 policy.
- **Fix direction:**
  - Pass the profile's controlled laser-off feed into the builder. Write the re-entry as
    `laserOffSeekLine` would, `G1 X Y F<feed> S0` with the marker comment.
  - Do this under a new transform version, so that archived transform 1–4 steps still replay
    byte for byte.

### P3-2 — The Marlin re-entry `G0` carries no F, so it runs at whatever feed the board holds (residual of MA-8 / ADR-398 decision 3)
- **Where:** `src/core/controllers/grbl/native-laser-resume.ts:80-86` (`reentryMove` writes
  `G0 X… Y… S0`, or `G0 X… Y…` for the fan dialect). The emitter twin is
  `src/core/output/marlin-travel-feed.ts:33-35`, which gives every Marlin `G0` its own
  `F<maxFeed>`.
- **Lens:** L3, L2.
- **Anchor:**
  - Contract: ADR-398 decision 3, "Every Marlin `G0` carries `F<profile max feed>`".
  - Ground truth: Marlin 2.1.2.6 `gcode.cpp`, `if (parser.floatval('F') > 0) { feedrate_mm_s =
    parser.value_feedrate();`. `G0_FEEDRATE` is commented out in stock builds (MA-8,
    2026-09-25 full audit). So a `G0` without F moves at the modal feed.
  - Twin: the timing model prices every rapid at `maxFeed`
    (`core/gcode-time/segment-blocks.ts:35-36`).
- **Scenario:**
  - A Marlin job loses its link mid-cut at F600, on a board that does not reset.
  - The resume re-entry crawls to the restart point at 600 mm/min. After a power-on it moves at
    4000 mm/min, and after a Frame at the framing feed.
  - Job Review and the live countdown time the move at the profile maximum, for example
    6000 mm/min.
  - The move is dark, so the effect is a slow travel and a wrong time estimate.
  - The preamble's next line, `G1 F<feed>`, restores the cut feed, so burns are unaffected.
- **Evidence:**
  - REPRO, same temporary test. The Marlin inline program has 30 of 30 `G0` lines with F. Its
    preamble is `["…","M5 I","G0 X40 Y176 S0","M3 I S0","G1 F6000",…]`. The Marlin fan
    preamble is `["…","M107","G0 X40 Y176","G1 F6000","M106 S153",…]`.
  - SOURCE: Marlin `gcode.cpp`, as quoted above.
- **Refuter:** CONFIRMED (REPRO + SOURCE).
  - *False if:* the re-entry carries F, a preamble line before it sets a travel feed, or
    Marlin's `G0` does not use the modal feed.
  - *Checked:*
    - Independent repro over every restart line of `mixedLaserProject` on
      `generic-marlin-laser`:
      - Inline: `{"g0":30,"g0F":30,"checked":175,"reentryNoF":168}`, preamble
        `["…","M5 I","G0 X15 Y179.500 S0","M3 I S0","G1 F1500"]`.
      - Fan: `{"g0":30,"g0F":30,"checked":247,"reentryNoF":241}`.
      - Every program `G0` carries F, and no re-entry does.
    - Re-fetched Marlin 2.1.2.6 `gcode.cpp`. `get_destination_from_command` sets
      `feedrate_mm_s` only from a positive F, and G0 is dispatched as
      `G0_G1(TERN_(HAS_FAST_MOVES, …))`. ADR-398 Context records independently that
      `G0_FEEDRATE` is commented out in stock `Configuration_adv.h` (MA-8).
    - Timing twin confirmed: `segment-blocks.ts:35-36` prices every rapid at `maxFeedMmPerMin`.
    - ADR-364 decision 3 wrote this `G0` a day before ADR-398 decision 3 ("Every Marlin `G0`
      carries `F<profile max feed>`"). The resume was never brought in line, so this is drift
      between them, not a deliberate exception.
  - *Not verified:* the power-on feed. It is `MMM_TO_MMS(DEFAULT_FEEDRATE_MM_M)`
    (`motion.cpp`); the 4000 mm/min value was not traced. P3 stands: the move is dark and burns
    are unaffected.
- **Fix direction:**
  - Give the Marlin re-entry the travel F the program's own `G0` lines carry. The scan can keep
    the last `G0`'s F text, or the builder can take the profile's max feed.
  - Do this under a new transform version.

### P3-3 — Air assist left on at reconnect is never switched off: the preamble re-issues `M7`/`M8` when the program had air on, but sends no `M9` when it had air off
- **Where:**
  - `src/core/controllers/grbl/resume-program.ts:337-342`: `airWords` only pushes `M7`/`M8`.
  - `src/core/controllers/grbl/native-laser-resume.ts:65-66`: the same for Smoothieware and
    Marlin.
- **Lens:** L1, L3, L7.
- **Anchor:**
  - Contract: ADR-341 Amendment 3, "Resumed and painted jobs burn what the original burned".
    Its oracle compares air per burn, and decision 1 restores the program's air.
  - Twin: the beam is always hard-offed to the program's own off state (`M5`, `M5 I`, `M107`,
    `M221 S0`; ADR-364 Consequences, "so that the resume restores the program's own off state").
    Air gets no matching off.
  - L7: both oracles start with air off. See `resume-program.emitter-oracle.test.ts:7-9`, which
    says "coolant/air off (GRBL clears both on reset…)". The native oracle's hostile states set a
    lit beam but no air.
- **Scenario:**
  - The operator switches air on from the Machine panel before resuming
    (`ui/state/laser-store.ts:417` sends the profile's air command). Or a lost link on a board
    that did not reset leaves `M8` held from a later air layer.
  - The restart line lies in a no-air operation.
  - Every resumed burn up to the program's next air change runs with air, where the original
    ran without it.
  - This is not a burn hazard: air on reduces fire risk. It does change the mark, and
    ADR-341 Amendment 3 promises air fidelity.
- **Evidence:** REPRO. Temporary `zz-c1-resume-arcs.test.ts`, test "air left on" (deleted; copy in
  `repros-c1/`). The program is
  `G21/G90/G54/G94/M4 S0/G0 X0 Y0 S0/G1 X5 F900 S300/G1 X6/M8/G0 X10 Y0 S0/G1 X15 S300/M9/M5`,
  resumed at line 8 on a controller holding `M8`. Output: the preamble has no `M9`
  (`[…,"M5","G0 X5 Y0 S0","M4 S0","F900"]`). Burn air was `original ["","M8"]` against
  `resumed ["M8","M8"]`.
- **Refuter:** CONFIRMED (REPRO + READ).
  - *False if:* something sends `M9` between the reconnect and the resume stream, or recovery
    Start requires a step that clears air.
  - *Checked:*
    - Independent repro on real emitter output: `mixedLaserProject` on the default GRBL profile
      with `airAssistCommand: 'M8'`, every restart line. The resumed program was run through
      `oracleBurns` with `M8` prepended (a board that kept air), and once without (control).
      Output: `{"checked":179,"airDiff":27,"controlDiff":0,"m9InPreamble":0,"firstAt":92,"wrongBurns":24,"of":52}`.
      27 restarts burn with the wrong air; the first is the no-air line layer, where 24 of 52
      burns get air. With air off at the start, there are 0 divergences, and no preamble contains
      `M9`.
    - Nothing else sends `M9` on this path. `M9` is sent only by an intentional disconnect
      (`laser-disconnect-stop.ts:68`), the reset cleanup after Abort, a rejected line or an
      owned reset (`stopLaserLines`), and the GRBL/Smoothieware Frame, jog and Home tool-off
      prefix (`laser-tool-off-air.ts`).
    - A cable loss can send nothing, and `finalRecoveryStartAssertion`
      (`recovery-start-authorization.ts`) requires no Frame, jog or Home first.
  - *Mitigation, not a refutation:*
    - Using **Frame remaining area**, **Go to restart point** (a jog) or **Home** first clears
      the air on GRBL and Smoothieware.
    - Marlin's tool-off lines (`M5 I`, `M107`) do not clear it.
  - *Physical output:*
    - Beam power, feed and geometry are unchanged.
    - The process condition changes: air on clears smoke and cools the cut, so a no-air
      engrave can come out lighter or cleaner than the original. It is not a burn hazard.
    - The Manual-Air variant is the operator's own choice.
  - *Severity:* P3 stands.
- **Fix direction:**
  - When the program had air off at the restart line and its profile has an air command, write
    `M9` in the preamble before the re-entry, under a new transform version.
  - Add an air-on hostile start to both oracles.

### P3-4 — On constant-power output, a restart inside a lit sweep accelerates from standstill with the beam on; the painted-pass twin backs up by the sweep's own lead-in
- **Where:**
  - `src/core/controllers/grbl/resume-program.ts:344-349` and
    `native-laser-resume.ts:80-86`: the re-entry ends exactly at the restart point.
  - The first resumed burn then starts from rest, with its power restated
    (`laser-resume-reentry.ts:142-148`, `native-laser-resume.ts:141-151`).
- **Lens:** L3, L2.
- **Anchor:**
  - Twin: painted-pass writer 2 replays "from its first painted point less the sweep's own
    lead-in … so the head reaches every painted point at the speed the original reached there"
    (ADR-341 Amendment 3 decision 3; Amendment 9).
  - Ground truth: the GRBL wiki "Laser Mode" page says M3 "keeps the laser power as programmed,
    regardless if the machine is moving, accelerating, or stopped". Marlin `M3 I` is continuous,
    and stepper.cpp blanks only dynamic mode (03-P2-2 SOURCE).
  - Possibly a deliberate scope: no ADR states either way for resume.
- **Scenario:**
  - Marlin inline output is always continuous (`marlin-inline-transform.ts:1-9`). Take a photo
    resumed mid-row on Marlin. The re-entry stops on the row, `M3 I S0` follows, then
    `G1 X… S153` accelerates from 0 at full continuous power.
  - The first v²/2a of the row is over-exposed. At 6000 mm/min and 500 mm/s² that is about
    10 mm, and at 1200 mm/min about 0.4 mm. The original crossed the same point at speed, behind
    its overscan.
  - The same applies to the `grbl-compatible` dialect (all M3) and to the 4040's M3 cuts.
    M4/dynamic and Smoothieware `P0` output are unaffected, because power scales with speed.
  - An automatic restart already lands on re-burned planner lines, so the mark falls on an
    overlap. A manual Start from line can put it on fresh work.
- **Evidence:** READ + SOURCE (GRBL wiki quoted above). No hardware.
- **Refuter:** CONFIRMED (REPRO + SOURCE). Severity stays P3.
  - *False if:*
    - the head reaches the restart point moving, so the junction keeps its speed;
    - the program's own beam is dark there;
    - power scales with speed; or
    - an ADR accepts or handles the case.
  - *Repro:* temporary `zz-c1r-resume.test.ts` (deleted; copy in the refuter scratchpad).
    - The project was `mixedLaserProject` with the photo widened to 40 mm, at 1200 and at
      6000 mm/min, with `accelMmPerSec2` 500.
    - The test resumed at every line that burns, follows a burning line and lies on a straight
      G1 run.
    - The original speed at the point was taken from the collinear G1 chain around it.
    - Output:
      - `grbl-compatible`: `{"midSweep":20,"litFromRestConstant":20,"vMedian":100}` at 6000.
      - `marlin-inline`: the same, 20 of 20.
      - The `grbl-dynamic` (M4) control: `litFromRestConstant: 0`.
    - Sample at 6000 mm/min:
      - Preamble `["…","M5 I","G0 X60 Y166.250 S0","M3 I S0","G1 F6000"]`, then
        `G1 X70.000 S76`.
      - The original crossed the point at 100 mm/s; the resume starts it from 0.
      - The ramp is 10 mm. Energy per mm is 20× the original's over the first 0.1 mm and 6.3×
        over the first 1 mm.
      - At 1200 mm/min: a 0.4 mm ramp, 4× over the first 0.1 mm and 1.4× over the first 1 mm.
  - *Standstill is certain:* GRBL `gcode.c` (re-fetched) says "All spindle state changes are
    synced, even in laser mode". So the `M3 S0` after `M5` drains the planner at the point.
    `M3 I` syncs on Marlin as well. The head therefore starts the first lit block from rest,
    whatever the approach angle of the `G0`.
  - *Ground truth (re-fetched GRBL v1.1 wiki "Laser Mode"):*
    - M3 "keeps the laser power as programmed, regardless if the machine is moving,
      accelerating, or stopped".
    - The wiki advises lead-in and lead-out moves for M3 to avoid scorching.
  - *Project precedent:*
    - ADR-257 names this mechanism ("burns at full programmed S while accelerating"). It is why
      the default cuts moved to M4.
  - *ADR search:* `docs/decisions` and DECISIONS.md were searched for resume or restart
    together with run-up, back up, accelerat*, standstill, lead-in and overscan. No ADR
    accepts, records or handles this for resume.
  - *Scope correction:* Smoothieware constant-power layers are affected too. The strategy maps
    M3 to `M221 S100 P1`, which turns proportional scaling off (`smoothieware-strategy.ts:59-68`).
    Only `P0` (M4) is safe.
  - *Severity ruling: P3, not P2.*
    1. It is reachable only on non-default constant-power output: always on Marlin inline, and
       otherwise only with `grbl-compatible`, 4040 cuts, or a per-layer Constant power setting.
       The KerfDesk GRBL default is M4.
    2. In both automatic restart paths, the mark falls where the interruption already marked
       the work.
       - Abort, reset and error step back over the planner, so they re-burn moves that already
         ran (accepted by ADR-398 decision 2).
       - A lost link with M3 continuous leaves the head stopped lit at the stop point.
       - So the dot adds to an existing defect rather than spoiling clean work.
       - Only a manual Start from line on fresh work shows it alone.
    3. The closest precedent records the same class of resume-time lit-head mark as an
       accepted residual: ADR-364's zero-length fan-restore residual. The gap here is the
       missing residual record plus a quality improvement, not a broken resume contract.
       ADR-341 Amendment 3 promised speed fidelity only for painted passes (decision 3).
  - *Fix priority:* raise it ahead of the other four P3s for Marlin-inline photo work at
    3000 mm/min or more. There the ramp reaches 2.5–10 mm into the row.
- **Fix direction:**
  - For constant-power programs, when the restart line is inside a lit sweep, re-enter at the
    sweep's lead-in or overscan start, or back up along the first segment and approach dark.
    The beam then comes on at speed, as the painted-pass writer does.
  - Otherwise, record the residual in ADR-341 / ADR-364.

### P3-5 — No resume oracle covers ADR-432 arc output; the GRBL oracle's interpreter rejects G2/G3 and its scenarios never emit arcs
- **Where:**
  - `src/core/controllers/grbl/laser-burn-oracle.test-helper.ts:78` throws "outside the
    oracle's laser subset" for G2/G3.
  - `resume-program.emitter-oracle.test.ts:197-214` uses `createProject().device`
    (`DEFAULT_DEVICE_PROFILE`, which has no `controllerKind`) and the Falcon brand profile.
    Neither gets arcs (`devices/laser-arc-moves.ts:43-49`).
  - Arc resume is pinned only by hand-written unit programs:
    `resume-program.transform.test.ts:40-71` (plane pin) and
    `resume-entry-point.test.ts:24-42`.
- **Lens:** L7.
- **Anchor:** Contract: ADR-432 sends laser line cuts to GRBL-family controllers as native G2/G3
  and adds resume transform 4 for them. METHOD L7 asks whether a fragile path has a regression
  test.
- **Scenario:** a later change to motion-word insertion, power restatement or plane pinning could
  produce a wrong arc on a resumed generic GRBL, grblHAL or FluidNC job. Such a change could
  append S into an I/J word, drop G2/G3 on a modal continuation, or lose G17. No oracle would
  fail.
- **Evidence:**
  - REPRO showing that the behaviour holds today, so this is a test gap only.
  - Temporary `zz-c1-resume-arcs.test.ts` (deleted; copy in `repros-c1/`) ran an independent
    interpreter with GRBL laser-mode rules: G2/G3 centre from I/J, M3 power held at rest and S
    sync on non-motion lines.
  - It used a generic `grbl-v1.1` profile with `laserArcMoves: 'on'`, M3 and M4 line layers with
    air, and a fill.
  - Output: `{"mode":"constant","arcLines":30,"lines":87,"checked":86,"bad":[],"darkBad":[]}`,
    `{"mode":"dynamic","arcLines":30,"lines":84,"checked":83,"bad":[],"darkBad":[]}`, and the
    chain check `{"chain":true,"checked":286,"bad":[]}`.
- **Refuter:** CONFIRMED (two independent lines of evidence).
  - *False if:* any resume burn-equivalence test runs over G2/G3 output.
  - *Checked:*
    - `laser-burn-oracle.test-helper.ts:78` throws for any G other than 0/1/4/17/20/21/54-59,
      90, 91 and 94. The emitter oracle therefore passes only because its programs contain no
      arcs.
    - Its profiles cannot emit arcs:
      - `DEFAULT_DEVICE_PROFILE` has no `controllerKind`, so `controllerAcceptsLaserArcs`
        returns false.
      - The Falcon profile is vendor `Creality`, so arcs are off by default
        (`laser-arc-moves.ts:35-49`).
    - The native oracle and `laser-resume-dialect.test.ts` run only Smoothieware and Marlin.
    - The arc tests that touch resume check other things:
      - `resume-travel-native-arcs.test.ts` and `resume-travel-arcs*.test.ts` check travel
        length and the entry point.
      - `resume-program.transform.test.ts` pins the plane.
      - None compares the burns of a resumed arc program with the original's.
    - ADR-432's own test list names only the transform-4 plane pin for resume.
  - *Severity:* P3 (missing test) is right.
- **Fix direction:** extend `laser-burn-oracle.test-helper.ts` with G2/G3, with the centre from
  I/J and the arc as part of the burn key. Add a generic GRBL scenario with arcs on to the emitter
  oracle.

## KNOWN (re-observed, not re-raised)

- **K-1** 18-P3-3: the resume word regex reads no leading-dot numbers. It is still in
  `laser-resume-reentry.ts:59-60` and `resume-program.ts:66`. The same pattern is also in
  `resume-travel.ts:12`, with the same root and fix.
- **K-2** ADR-364 residual: if the Marlin-fan re-entry has zero length, the restored `M106` can
  light the standing head until the first move is planned.
- **K-3** Decided, not raised. The transform's modal scan does not rebuild coordinate-frame
  changes (`G92`/`G10` X/Y words are read as positions) or carry axes across a mid-program
  `G20`/`G21` switch. G93 and G90.1 are not tracked.
  - ADR-341 Amendment 6 decision 2 keeps "normal recovery and archived resume transforms"
    unchanged, and `resume-head-stop-block.ts:1-3` says so.
  - None of these words is emitted by KerfDesk's laser strategies. Searches of
    `core/output`, `core/gcode` and `core/raster` found only `G21`/`G90`/`G54`/`G94`/`G17`, plus
    `G91` inside Focus Test, which is refused. External programs get no resume.
- **K-4** 05-P2-1, 05-P2-2 and 18-P2-1 (restart-line numbering and planner step-back). These
  choose `fromLine`; the program built from it was audited here and is correct for any line.
- **K-5** ADR-364 residual: Marlin dynamic inline (`M4 I`), standard-mode power and Smoothieware
  manual `fire <power>` are re-armed but not modelled. KerfDesk writes none of them.

## Refuted

The refuter (2026-10-22) refuted none of P3-1..P3-5. All five were reproduced, and none changed
severity.

Candidates the auditor dropped:

- *Smoothieware runs the preamble's bare `F` as `G0 F` after the `G0` re-entry, which would set
  the seek rate and leave the burn feed unrestored.* No. `GcodeDispatch.cpp` always prepends
  `G1 ` to a bare-F line ("strcpy(buf,"G1 ")"). Only bare X/Y/Z lines take `modal_group_1`.
- *The `; KerfDesk resume preamble` comment line wedges Marlin (MA-5).* No. The streamer drops
  `;`-only lines (03-P1-1 evidence), so the comment is never sent.
- *Focus Test refusal misses a leading-dot offset in its marker.* No. The marker comes from
  `formatGcodeCoordinateMm` (`toFixed(3)`, `coordinate-format.ts:7-10`), which always keeps the
  leading zero. Compact spelling also keeps it (`motion-words.ts`: "`0.100` becomes `0.1`").
- *GRBL restated S loses precision (`formatNumber` uses `toFixed(3)`).* No practical effect. Vector
  S comes from `scaleS` in 0.1 % steps of `$30`, and the error is at most 0.0005 S. Raster rows
  carry their own S, so they are never restated.
- *The Marlin-fan re-entry `G0 X Y` has no `S0` and so breaks PROJECT.md invariant 3.* No. It
  directly follows `M107`, or `M107` then air, and `findLaserOnTravelIssues` treats `M107` as a
  sticky S0 (`core/invariants/predicates.ts:69`).

## Verified clean

- **Q1, dark travel to the resume point, on every dialect.**
  - GRBL, grblHAL and FluidNC:
    - `M5` comes before air and before any motion.
    - The re-entry `G0 … S0` is never lit in laser mode (GRBL wiki: "will never turn on and
      always disable the laser").
    - The re-arm `M3 S0`/`M4 S0` comes at the point. Because the modal motion is G0, `M3`
      syncs to 0.
  - Marlin inline: `M5 I` synchronises, kills power and leaves inline mode. A `G0` then sets
    `inline_power(0)` in inline mode and `apply_power(0)` in standard mode (Marlin 2.1.2.6
    `gcode.cpp`). `M3 I S0` re-arms at zero after `planner.synchronize()`.
  - Marlin fan: `M107` comes before air and the re-entry, and the held `M106 S` goes just before
    the first move.
  - Smoothieware: `fire off` ends manual fire. `Laser.cpp` powers only `is_g123` blocks and turns
    off with no block. `M400`+`M221 S0` and the re-arm `M400`+`M221 S100 P<mode>` follow.
  - The arc repro started from a lit M3, modal-G1 controller. No line after `M5` and before the
    first burn left the beam lit at rest or on a G0 (`darkBad: []`, 169 restarts).
- **Q2, modal restore.**
  - Units, `G90`, the program's own WCS, `G94` and the plane (transform 4, GRBL) are restored.
    `M5`, air, re-entry, re-arm in the program's M3/M4 (or the dialect's equivalent) and feed
    follow in that order.
  - S is restated on the first burn that relies on the modal S.
  - `G91`, `G53`, `G28` and `G30` before the line are refused (`resume-program.ts:228-235`).
  - KerfDesk laser output never changes units, frame or feed mode mid-program (K-3).
  - Marlin and Smoothieware get no `G94`, and Marlin gets no `G54` unless the program selected
    one.
- **Q3, mid-arc.** An arc is one line. A restart at it re-enters at the previous end point, which
  is the arc's start at emitted precision, and replays `G2/G3 X Y I J` unchanged, with S appended
  when modal. No chord is ever written: the re-entry is dark and the arc keeps its own I/J.
  Lead-in/contour boundaries are separate lines. All of this was reproduced in the arc repro.
  - `resume-travel.ts`/`resume-travel-arc.ts` are diagnostic only (the unconfirmed-travel note).
    They matched an independent XY path length, swept arcs included, over every 8-line window of
    an arc program (`{"checked":21,"nulls":0,"bad":[]}`).
- **Q4, Z re-entry for CNC.**
  - `buildResumeProgram` refuses CNC with `CNC_AUTOMATIC_RECOVERY_DISABLED_REASON`
    (`resume-program.ts:73-75`). The `safeZMm`/`spindleSpinupSec`/`plungeMmPerMin` options are
    retained but never read.
  - Laser resumes write no Z word. A Focus Test with relative Z motion is refused whole
    (`focus-resume-issue.ts`), even at line 1. A zero-offset Focus Test emits no Z and resumes
    normally.
- **Q5, the twin.** Across every restart line of two arc programs, the resumed tail differs from
  the original by 0 lines (58 and 55 restarts) or 1 line (28 and 28), always the first burn's
  appended S (`{"hist":{"0":58,"1":28}}`). The existing oracles pass on this tree:
  `resume-program.emitter-oracle.test.ts` (9 tests) and `resume-program.native-oracle.test.ts`
  (10 tests). They were run with the same Vitest command.
- **Q6, boundaries.**
  - Line 1 gives only modal words and `M5`, with no motion before the program's own first line.
  - A comment, blank or `M5` line replays harmlessly. A tail of blanks or comments is refused
    ("Nothing left to run").
  - Past the end gives "Line must be between 1 and N".
  - Mid raster row: the inserted motion word is in the line's own spacing, after any `N` number.
  - There is no laser M0. CNC is refused.
  - A resume of a resume burns what the first resume burns from that line (286 checks).
- **Dialect selection** (`laser-resume-dialect.ts`) matches `select-output-strategy.ts`: GRBL
  family and unknown → `grbl`, `smoothieware`, `marlin` → inline/fan by `resolveMarlinDialect`.
  The saved recovery passes the archived project's device, and the manual path compiles
  live from the open project, so dialect and program agree.

## Not verified

- No hardware. Air on-delay dwell, Marlin fan timing and controlled-seek quality on a real 4040
  were not measured.
- FluidNC laser-mode G0 semantics were not fetched. The resume does not depend on them, because
  `M5` precedes the re-entry and the tail is the original's.
- The planner step-back and the restart-line choice (areas 05/18) were used, not re-audited.
- The recovery Review UI, Frame remaining area and "Go to restart point" jog were read only as
  callers. Their motion commands belong to C3.
- The CNC pass recovery and Pause-and-lift re-entry (ADR-215, ADR-411) are separate builders.
  They are covered by 18 "Verified clean" and not re-run here.

```json
[
  {"id":"C1-P3-1","severity":"P3","area":"ctl-native-resume","file":"src/core/controllers/grbl/resume-program.ts","line":344,"anchor":"Contract: ADR-236 controlled laser-off seeks (DECISIONS.md:11224); Twin: grbl-laser-lines.ts:41-55 laserOffSeekLine, painted-pass entry ADR-341 Amd 2 D3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Resume re-entry is an unbounded G0 rapid on profiles with controlled laser-off travel (built-in 4040), whose program has no G0 at all"},
  {"id":"C1-P3-2","severity":"P3","area":"ctl-native-resume","file":"src/core/controllers/grbl/native-laser-resume.ts","line":80,"anchor":"Contract: ADR-398 D3 every Marlin G0 carries F; Ground truth: Marlin gcode.cpp feedrate_mm_s from F, no G0_FEEDRATE; Twin: marlin-travel-feed.ts:33-35","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Marlin resume re-entry G0 has no F, so it runs at the board's modal feed (MA-8 residual) while timed as a max-feed rapid"},
  {"id":"C1-P3-3","severity":"P3","area":"ctl-native-resume","file":"src/core/controllers/grbl/resume-program.ts","line":337,"anchor":"Contract: ADR-341 Amd 3 resumed jobs burn what the original burned (air); Twin: unconditional beam hard-off vs air-on-only restore","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Preamble re-issues M7/M8 but never M9, so air left on at reconnect runs the resumed no-air burns with air; oracles start with air off"},
  {"id":"C1-P3-4","severity":"P3","area":"ctl-native-resume","file":"src/core/controllers/grbl/resume-program.ts","line":344,"anchor":"Twin: painted-pass writer 2 backs up by the sweep lead-in (ADR-341 Amd 3 D3, Amd 9); Ground truth: GRBL wiki M3 power constant while accelerating; GRBL gcode.c spindle changes synced in laser mode","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Constant-power (Marlin inline, grbl-compatible, 4040 M3 cuts, Smoothieware M221 P1 layers) restart inside a lit sweep accelerates lit from standstill, over-exposing the first v^2/2a (repro: 20x over first 0.1 mm, 10 mm ramp at 6000 mm/min); refuter kept P3"},
  {"id":"C1-P3-5","severity":"P3","area":"ctl-native-resume","file":"src/core/controllers/grbl/resume-program.emitter-oracle.test.ts","line":197,"anchor":"Contract: ADR-432 native arcs + transform 4; METHOD L7","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"No resume burn-equivalence oracle covers ADR-432 arc output; the oracle interpreter throws on G2/G3 and its profiles never emit arcs (behaviour holds today per repro)"}
]
```
