# Controller audit v3 — D1 Air assist and accessories

- **When:** 2026-10-22 19:15   **Tree:** origin/main @ `7cd526213` (audit worktree HEAD `056b26bb0`).
  `origin/main` moved to `17efcd7f4` during the audit; that commit changes no audited path
  (`git diff 7cd526213 origin/main -- src/core/output src/core/preflight src/core/devices src/ui/laser src/ui/state src/core/controllers` is empty).
- **Scope:** `src/core/output/{air-assist-hold,air-keep-alive,grbl-strategy,grbl-output-cursor,marlin-strategy,smoothieware-strategy,cnc-grbl-coolant}.ts`,
  `src/core/raster/emit-raster.ts` (held opening), `src/core/preflight/m7-air-assist-readiness.ts`,
  `src/core/devices/preset-air-assist.ts`, `src/ui/laser/{AccessoryResetControls,JogPadAirAssist,PresetAirAssistOffer,DeviceProfilePowerFields}.tsx`,
  `src/ui/laser/job-review/{air-assist-*,m7-air-assist,manual-air-assist}-warnings.ts`,
  the Manual Air latch (`laser-store.ts` air actions, `laser-status-position.ts`, `air-assist-command-state.ts`,
  `laser-tool-off-air.ts`, `laser-quick-stop.ts`, `laser-job-stop*.ts`, `laser-alarm-line.ts`,
  `laser-console-actions.ts`, `laser-store-helpers.ts` disconnect lines), pause/resume
  (`laser-job-pause-resume.ts`, `laser-stream-pause-beam.ts`), resume preamble
  (`grbl/resume-program.ts`), second pass (`laser-second-pass/program-writer.ts`),
  `controller-capabilities.ts`, `serial-wire-encoding.ts`, the status `A:` parser.
  Governing: PROJECT.md NN 3, 9, 13; ADR-323, ADR-335, ADR-370, ADR-395 (CG-10), ADR-397,
  ADR-398 and Amendments 1–2, ADR-462 and Amendment 1, ADR-228/565 (advisory, not refusal);
  WORKFLOW.md F.3 step 13 and the timing note at WORKFLOW.md:2426.
- **Lenses run:** L1, L2, L3, L4, L5, L7 as separate passes. L6 was folded into Q2 (Abort, halt,
  link loss); no separate pass.
- **Counts:** 4 raised → 0 refuted → P1 0 / P2 0 / P3 4 (+7 KNOWN). Refuter: 4 CONFIRMED, no
  severity changes. P3-1's Smoothieware half was already noted, but not raised, in the
  2026-09-25 controller audit.

## Headline

Job air emission is sound. A seeded property oracle (1,500 jobs per configuration, eight
configurations: GRBL M4, GRBL M3/M7, Neotronics 4040, a restart-unreliable GRBL profile, Falcon
A1 Pro, Marlin inline, Marlin fan + Air restart, Smoothieware) found every lit move running with
exactly the air its group asked for, ADR-335 bridging included, and air off at program end. It
covers cut, scanline/offset/island fill, raster, blank groups, focus tests, entry runways and
overcuts. The weaknesses are at the edges of what KerfDesk can observe. FluidNC and Smoothieware
answer `ok` to an air command they cannot run, so Job Air can silently never start (P3-1). On
Marlin and Smoothieware the Manual Air latch drifts from the board (P3-2). "Air restart" repeats
stop the head on FluidNC and Smoothieware, though ADR-462 says they change nothing (P3-3). No
repository test checks air at each lit move (P3-4).

## Event → command per dialect

GRBL family = stock GRBL 1.1, grblHAL, FluidNC. "Falcon" = the Falcon A1 Pro command contract
(grblHAL base). Marlin = inline (`M3 I`) or fan (`M106`) dialect.

| Event | GRBL family | Falcon A1 Pro | Marlin | Smoothieware | Source |
|---|---|---|---|---|---|
| Group asks for air (job) | `M7`/`M8` before the group; under M3 held until after the group's first laser-off move | `M8` (as GRBL; M4 body) | `M8`/`M7` held until after a dark move under either word (`stopKeepsPower`) | `M8`/`M7` passed through the GRBL body | `grbl-strategy.ts:402-430,466-476`; `grbl-output-cursor.ts:92-118,133-144`; `marlin-strategy.ts:32-36`; `smoothieware-strategy.ts:21-28` |
| Air change between groups | `M9` (+ new word), held while lit | Air-off group between two air-on groups bridged (no `M9`/`M8`) | as GRBL, held until dark | as GRBL | `coolantPlan` `grbl-strategy.ts:414-423`; `air-assist-hold.ts:28-41` |
| Air repeat while on (flag "Air restart") | `M7`/`M8` every ~5 s estimated, before an eligible motion line; after a dark move under M3 | same (preset sets the flag) | same, after a dark move under either word | same (no extra gate) | `grbl-strategy.ts:504-510`; `air-keep-alive.ts:71-116` |
| Job end | held air words dropped, then `M9`, `M5`, park | same | `M9`, `M5 I` / `M107` | `M9`, `M400`, `M221 S0` | `grbl-strategy.ts:489-499`; `grbl-output-cursor.ts:188-193` |
| Manual Air ON / OFF | profile `M7`/`M8` / `M9`, Idle only, refused during any job | same | same | same | `laser-store.ts:403-452,480-492` |
| Frame | `M5`, `M9`, `$J=` corners | `M5` only (pump left alone, ADR-323) | `M5 I`, `M107`, `G0` corners (no `M9`) | `fire off`, `M400`, `M221 S0`, `M5`, `M9`, `M120`… | `grbl/driver.ts:81`; `falcon-command-contract.ts:28`; `marlin/driver.ts:78`; `smoothieware/driver.ts:87` |
| Jog / Home | `$J=` / `$H` (no air word) | `G1` jog, `$HX` `$HY` | `G0` relative / `G28` | tool-off lines (ends `M9`) then motion | same files; latch cleared by `laser-tool-off-air.ts:50-57` |
| Pause / Resume (laser) | `0x84` door: firmware de-energizes coolant, restores it 1 s before motion on `~` | same byte | stream-side pause, beam-off `M5 I`/`M107` queued; air untouched | stream-side pause; air untouched | `laser-job-pause-resume.ts:94-170`; GRBL `protocol.c:566,682-687` |
| Abort | `0x18` (firmware kills coolant), then `M5`, `M9` after the banner | same | `M107`, `M410`, `M5 I`, then `M9` if latch on or program has `M7`/`M8` | `0x18` (halt; switches go to `halt_set_to`), then `M5`, `M9` | `laser-job-stop.ts:238-312`; `laser-quick-stop.ts:30-47`; GRBL `motion_control.c:372-374` |
| Disconnect | `0x18`, banner, `M5`, `M9` | same | stop lines (+`M9` if latch on) | stop lines `M5`,`M9` only if latch on or Fire | `laser-store-helpers.ts:228-245` |
| Firmware alarm / halt | firmware kills coolant; latch corrected by next `Ov:` frame | same | n/a (kill) | switch → `halt_set_to` (default off); latch unchanged | `laser-alarm-line.ts:46-71`; `laser-status-position.ts:183-190` |
| Recovery resume / Start from line | `M5`, `M7`/`M8` if the program had air at the line, `G0 … S0` re-entry | same | as transform 3 (Marlin power words) | as transform 3 (`M221`) | `resume-program.ts:324-345` |
| Second pass | `M9`/`M7`/`M8` before each group's positioning `G0`; `M5`, `M9` at end | same | n/a | n/a | `program-writer.ts:103-111,343-345` |
| CNC coolant | `M7`/`M8` after spindle-up, `M9` at tool-change `M0` and at end | n/a | n/a (CNC is GRBL only) | n/a | `cnc-grbl-coolant.ts`, `cnc-grbl-transitions.ts:93,119` |
| Realtime `0xA0`/`0xA1` | never sent; bytes > 0x7F refused in queued lines | same | n/a | n/a | `serial-wire-encoding.ts:29,49-57` |

## Findings

### P3-1 — On FluidNC and Smoothieware, an air command the board cannot run is acknowledged `ok`, so Job Air never starts and nothing warns; the M7 advisory says such firmware "rejects the command and interrupts the job"

- **Where:** `src/core/preflight/m7-air-assist-readiness.ts:12-13` (the unverified message) and
  `:57-60` (every non-stock-GRBL controller gets it, because only `grbl/driver.ts:76` sends `$I`;
  `fluidnc/driver.ts:92`, `smoothieware/driver.ts:80` and `grblhal/driver.ts:84` set
  `buildInfoQuery: null`); `src/ui/laser/DeviceProfilePowerFields.tsx:133-150` (`AirAssistRow`
  offers M7/M8 on every controller as "the GRBL coolant output"). No M8 readiness check exists
  anywhere; nothing compares a commanded `M7`/`M8` with the next `A:` field.
- **Anchor:** Ground truth + Twin.
  - FluidNC `GCode.cpp` (main @ `6735500`, lines 855-870): `case 8:` sets
    `gc_block.coolant = GCodeCoolant::M8` only `if (config->_coolant->hasFlood())`, with no error
    otherwise (the same for M7 with `hasMist()`). The block then answers `ok`.
  - Smoothieware `GcodeDispatch.cpp` (edge @ `91fe428`, lines 385-422) prints `error:`/`unknown`
    only when `gcode->is_error`. Otherwise it prints `ok`, and no module sets `is_error` for an
    `M8` that no `switch.*.input_on_command` matches (`Switch.cpp` `on_gcode_received` returns at
    once when `match_input_on_gcode` fails).
  - Twin: stock GRBL rejects M7 without `ENABLE_M7` (`gcode.c:263-283`, error:20). grblHAL
    rejects M7 without a mist output (`gcode.c:1861-1863`). On Marlin, KerfDesk turns
    "Unknown command" into a stream stop (`marlin/response.ts:60-89`, ADR-395). ADR-397's context
    names exactly this pattern on Smoothieware: "It read `ok` as proof of work the board had not
    done."
- **Scenario:**
  1. A FluidNC laser has no `coolant: flood_pin`, or its air relay is on a user output. Machine
     Setup has Air output = M8, and the cutting layers have Air on.
  2. Every `M8` is acknowledged. `A:` never shows `F`, and the job cuts with no air. Job Review
     and the live view say nothing.
  3. On Smoothieware with no switch bound to `M8`, the same happens. Manual Air also shows ON for
     good, because Smoothieware reports no `A:` field.
  4. With M7 selected, Job Review shows the "could not verify M7 support" text. It promises a
     rejection and an interrupted job, which neither firmware does.
  5. Mitigation: the Air output tooltip says "Leave Disabled unless you have tested the output".
     On FluidNC, Manual Air flips back to OFF at the next `Ov:` frame, which is a clue.
- **Evidence:** SOURCE. FluidNC `GCode.cpp:867` "`if (config->_coolant->hasFlood())`".
  Smoothieware `GcodeDispatch.cpp:418` "`new_message.stream->printf("ok\n");`". KerfDesk message:
  "unsupported firmware rejects the command and interrupts the job".
- **Severity note:** P3, because it needs an untested or misconfigured air output. The physical
  result is an air-less cut, which is a fire risk. The refuter may weigh P2.
- **Refuter:** CONFIRMED. Severity stays **P3**. Novelty: partly KNOWN.
  - **FluidNC.** Fetched `bdring/FluidNC` main @ `6735500` (same commit as the auditor).
    - `GCode.cpp:851-878`: `case 8:` sets `gc_block.coolant` only `if (config->_coolant->hasFlood())`.
      There is no else branch and no error, so the block is answered `ok`.
    - `CoolantControl.h:23-24`: `hasFlood()` is `_flood.defined()`.
    - `CoolantControl.cpp` `group()`: `flood_pin` and `mist_pin` default to `NO_PIN`.
    - `MachineConfig.cpp:172-173`: a YAML file with no `coolant:` section still gets a default
      `CoolantControl`, so `M8` there is acknowledged and does nothing.
    - The wiki page (`wiki.fluidnc.com/en/config/coolant`) timed out. The `@config` source
      comments above are what that page is generated from.
  - **Smoothieware.** Fetched edge @ `91fe428` (same commit as the auditor).
    - `GcodeDispatch.cpp:385-421`: the reply is `error:` only when `gcode->is_error`, and `ok`
      otherwise.
    - A GitHub code search for `is_error` in the repo finds only two setters, both feed-rate
      checks (`Robot.cpp:1556,1647`). No module rejects an unbound `M8`.
    - `Switch.cpp:310-312` returns at once when no switch matches.
    - The switch documentation describes M-codes acting only through a configured
      `input_on_command`.
  - **Opt-in check (why P3, not P2).** No preset sets air on these dialects, and the user must
    configure it.
    - `GENERIC_FLUIDNC_PROFILE` and `GENERIC_SMOOTHIEWARE_PROFILE` (`profile-catalog.ts:67-88,116-141`)
      inherit `airAssistCommand: 'none'` (`device-profile.ts:400`).
    - Only two presets default to `M8`: Sculpfun S30 (stock GRBL, `brand-laser-profiles.ts:126`)
      and Falcon A1 Pro (grblHAL contract, `falcon-profiles.ts:25`).
    - Choosing M7/M8 is a deliberate Machine Setup step. The tooltip says "Leave Disabled unless
      you have tested the output". The setup text says "Confirm which relay controls your air
      assist", and the rail points to Setup "after a hardware test".
    - A LightBurn `.lbdev` import also sets `M8` (from `AirAssistM7: false`,
      `lbdev-json.ts:71-76`). Its import review shows that field, and it matches what LightBurn
      itself would send on that board.
    - Operation Air defaults to off.
    - The same blind spot exists on stock GRBL with nothing wired to the coolant pin. No firmware
      can prove a pump is connected, and LightBurn does not verify air either.
    - The pump's silence is audible to the operator, who must attend the laser. On FluidNC,
      Manual Air also drops back to OFF at the next `Ov:` frame.
  - **Real defect.** The M7 advisory text is wrong for FluidNC and Smoothieware: neither rejects
    the command or interrupts the job. KerfDesk also never compares `M8` with `A:`. Both are
    P3 doc drift and a missing check.
  - **Minor overstatement.** Step 3's "Manual Air shows ON for good" is too strong on
    Smoothieware. The next Frame, jog or Home sends `M9` and clears the latch
    (`laser-tool-off-air.ts`, from the CG-5 fix).
  - **Novelty.** The Smoothieware half was recorded as a matrix note, not a finding, in
    `docs/audits/2026-09-25-controller-full-audit/tracks/CG.md:687-689`: "With no module, `M8` is
    acknowledged with `ok`". That note left FluidNC "not checked". The FluidNC half and the
    M7-message mismatch are new.
- **Fix direction:** On firmware with `A:` (FluidNC, grblHAL), compare a commanded `M7`/`M8` with
  the next accessory report, at Manual Air and during a job, and warn when it never shows. For
  Smoothieware, say in Machine Setup and Job Review that air needs a switch module bound to that
  M-code. Make the M7 message controller-specific.

### P3-2 — On Marlin and Smoothieware the Manual Air latch follows only KerfDesk's own Manual Air writes and settled jobs: a Console `M8` leaves it OFF, so Abort and Disconnect skip the `M9` and leave the pump running; an unsolicited Smoothieware halt leaves it ON with the pump off

- **Where:**
  - `src/ui/state/laser-console-actions.ts:265-277`: a Console accessory command only invalidates
    `accessoryCache`; `airAssistOn` is untouched.
  - `src/ui/state/laser-quick-stop.ts:40-47`: Marlin's Abort adds `M9` only when `airAssistOn` is
    set or the stream holds `M7`/`M8`.
  - `src/ui/state/laser-store-helpers.ts:228-241`: an idle Disconnect sends stop lines only when
    `airAssistOn` or Fire is set.
  - `src/ui/state/laser-alarm-line.ts:46-71`: an `ALARM:` line clears `accessoryCache`, but not
    `airAssistOn`.
  - Simulator twin: `src/__fixtures__/controllers/smoothie-sim-machine.ts:120-128` and
    `smoothie-laser-power-model.ts:114-116`. A halt clears only manual fire, so the simulated
    flood stays on.
- **Anchor:** Contract + Ground truth + Twin.
  - Contract: ADR-395 / audit CG-10. Abort and Disconnect send `M9` "when Manual Air is on or the
    job's program uses `M7` or `M8`", which in intent means "when air may be on". ADR-397
    decision 7: "The Smoothieware simulator follows the firmware".
  - Ground truth: Marlin `M7-M9.cpp` (only `M9` calls `air_assist_disable()`, per audit CG-10).
    Smoothieware `Switch.cpp` `on_halt` (line 62) sets each output to `haltsetting`, which
    defaults to false (`halt_set_to`, line 125), unless `ignore_on_halt` is set.
  - Twin: `settledProgramAirAssistPatch` (`air-assist-command-state.ts:12-19`) updates the latch
    from a finished program's air words, but the Console path does not. KerfDesk's own Smoothieware
    Abort clears the latch ("The reset itself de-energizes coolant", `laser-job-stop.ts:302`),
    but an unsolicited halt does not.
  - GRBL-family boards are self-correcting: the next `Ov:` frame without `A:` resets the latch
    (`laser-status-position.ts:183-190`).
- **Scenario:**
  - (a) Marlin, Air output M8. The operator types `M8` in the Console, and the pump runs. Manual
    Air still reads OFF. ABORT then sends `M107`, `M410`, `M5 I` with no `M9`, and Disconnect
    sends nothing, so the pump keeps running.
  - (b) Smoothieware. Manual Air is ON, then the kill button or a hard limit halts the board. The
    switch goes off, but Manual Air reads ON until the next Frame, jog or Home sends `M9`. The
    Frame before any Start does this, so it cannot carry into a job.
- **Evidence:** REPRO (auditor Vitest through the real store and simulators; copies are in the
  session scratchpad at `…/scratchpad/d1-repros/`, and the repo files were deleted).
  - `zz-d1-console-air.simulator.test.ts`, Marlin simulator: after `sendConsoleCommand('M8')` the
    output was `{"latchAfterConsoleM8":false,"disconnectLines":[]}`. Abort when idle gave
    `{"abortLines":["M107\n","M410\n","M5 I\n"]}`, with no `M9`.
  - `zz-d1-smoothie-halt-air.simulator.test.ts`, Smoothieware simulator: after
    `setAirAssistEnabled(true)`, then `pressKillButton()` / `hardLimit('+X')`, and 5 s later, the
    output was `{"halted":true,"simFlood":true,"airAssistOn":true,"status":"Alarm"}` in both
    cases. The firmware would have the switch off, but the simulator keeps `flood:true`.
- **Severity note:** P3. Air left on is not a burn hazard, and a stale ON is cleared by the
  mandatory Frame.
- **Refuter:** CONFIRMED (own REPRO and SOURCE). Severity stays P3. New.
  - **Repro.** A temporary `src/ui/state/zz-d1r-air-latch.test.ts` drove the real store against
    the Marlin and Smoothieware simulators. It has since been deleted.
  - **(a) Marlin.**
    - The Console `M8` really reached the board: `"m8Sent":true` in the outbound log, with an
      `ok` back.
    - The latch stayed off: `"latch":false`.
    - An idle Disconnect then sent `"disc":[]`.
    - An idle `stopJob()` sent `["M107\n","M410\n","M5 I\n"]`, with no `M9`.
    - Why: the Console path only invalidates `accessoryCache` (`laser-console-actions.ts:265-277`).
      The `'accessories'` state effect returns just the observation patch
      (`laser-console-actions.ts:330-332`), and nothing else writes `airAssistOn`.
  - **(b) Smoothieware.**
    - Sequence: Manual Air ON, then `pressKillButton()`, then 5 s.
    - Result: `{"onBefore":true,"halted":true,"simCoolant":{"mist":false,"flood":true},"latchAfterHalt":true,"status":"Alarm"}`.
    - Firmware ground truth, fetched edge @ `91fe428`: `Switch::on_halt` (`Switch.cpp:62-70`)
      sets the pin to `haltsetting`. That value is read from `halt_set_to` with
      `by_default(false)` (`:125`), unless `ignore_on_halt` is set.
    - So the real switch goes off while the latch and the simulator stay on. This is a twin
      break with ADR-397 decision 7.
  - **Novelty.** Not covered before.
    - CG-10 fixed Abort and Disconnect for the latch and stream cases.
    - CG-5 covered `M9` from jog, Frame and Home.
    - C5 K-5 covered Console air with no confirmation.
    - This Console-latch gap and the unsolicited-halt gap are residuals none of them raised.
- **Fix direction:**
  - Treat an accepted Console `M7`/`M8`/`M9` as a latch update, as settled programs already are.
  - Clear the latch, or mark it unknown, on an unsolicited halt for drivers whose halt
    de-energizes switches.
  - Make the Smoothieware simulator apply `halt_set_to` on halt.

### P3-3 — "Air restart" repeats stop the head on FluidNC and Smoothieware, though ADR-462 says a repeat "changes nothing" and that the Smoothieware strategy is unchanged; the checkbox is offered for every controller and the estimator assumes no stop

- **Where:**
  - `src/core/output/grbl-strategy.ts:504-510` runs `withAirKeepAlive` for any profile with the
    flag. `smoothieware-strategy.ts:21-27` reaches it with the device unchanged.
  - `src/ui/laser/DeviceProfilePowerFields.tsx:166-167`: `AirRestartRow` is hidden only when air
    output is Disabled.
  - `src/core/output/air-keep-alive.ts:21-24`: the comment's claim.
  - `src/core/gcode-view/render-model-words.ts:455-470`: the timing model syncs only when coolant
    changes.
- **Anchor:** Contract / doc + Ground truth + Twin.
  - ADR-462, "Firmware that handles `M8` normally. A repeat changes nothing there", and
    "Profiles without the flag. Their bytes are unchanged, and so are … the Marlin and
    Smoothieware strategies" (lines 63-68). WORKFLOW.md:2426-2428: "Redundant
    `M3`/`M4`/`M7`/`M8`/`M9` re-arms do not invent another stop".
  - FluidNC `GCode.cpp` (lines 1947-1964) runs `protocol_buffer_synchronize()` for every
    `M7`/`M8`/`M9` block before `set_state`. `CoolantControl::set_state` returns early only when
    nothing changed, so the drain still happens.
  - Smoothieware `Switch.cpp` `on_gcode_received` (lines 313-367) calls
    `THEKERNEL->conveyor->wait_for_idle()` on every matching on-command for a DIGITAL output. Its
    comment acknowledges "redundant swicth on calls".
  - Twin: the estimator (no stop) against the firmware (a full drain per repeat).
- **Scenario:**
  1. A FluidNC or Smoothieware profile has Air output M8 and "Air restart" ticked. The tooltip is
     Creality-specific, but nothing stops this.
  2. In a dynamic-power line job, an `M8` lands between lit `G1` moves about every 5 s of
     estimated time. Each one brings the head to a full stop mid-contour.
  3. Smoothieware's laser idles dark (`Laser.cpp:282-284`) and FluidNC's M4 is dark at rest, so
     there is no stationary lit dwell. The cost is stop-start marks and time the estimate leaves
     out. Marlin's case was already handled by ADR-462 Amendment 1 (dark-move placement).
- **Evidence:** REPRO (auditor Vitest, `zz-d1-air-oracle.test.ts` "keep-alive on non-GRBL
  firmware"). A 60-vertex 600 mm/min cut with the flag gave `m8Count: 20` for both
  `smoothiewareStrategy` and FluidNC (`grblStrategy`, `controllerKind:'fluidnc'`). The context
  was `['G1 X0.000 Y2.000','G1 X20.000 Y3.000','M8','G1 X0.000 Y4.000']`. SOURCE as cited above.
- **Severity note:** P3. It needs a Creality-specific checkbox on another firmware, and the stops
  are dark.
- **Refuter:** CONFIRMED (own REPRO and SOURCE). Severity stays P3. New: 03-P3-1 covered only
  Marlin.
  - **Repro.** A temporary `src/core/output/zz-d1r-keepalive.test.ts`, since deleted, emitted one
    job through `selectOutputStrategy`.
    - The job: a 40 mm closed square at 300 mm/min, 3 passes, Air on, `M8`, "Air restart" ticked.
    - FluidNC (`M4`): `m8: 12`, with 9 inserted between two lit `G1` moves, for example
      `G1 X40.000 Y0.000 F300 S700` / `M8` / `G1 X40.000 Y40.000`.
    - Smoothieware: identical, `m8: 12`, 9 between lit moves (`… S0.700` / `M8` / `G1 …`).
    - FluidNC with the flag cleared: `m8: 1`, 0 between lit moves.
    - Stock GRBL emits the same bytes as FluidNC. That is harmless there, because GRBL syncs
      coolant only on a change.
  - **FluidNC source.** `GCode.cpp:1947-1964` (main @ `6735500`) calls
    `protocol_buffer_synchronize()` for every block with `gc_block.coolant != None` (that is,
    with the pin configured) before `CoolantControl::set_state`.
    `CoolantControl.cpp` `set_state` returns early only after that drain, when the state is
    unchanged.
  - **Smoothieware source.** `Switch.cpp:316-371` (edge @ `91fe428`; drains at lines 324, 330, 337, 352 and 367) calls
    `THEKERNEL->conveyor->wait_for_idle()` for a matching on-command on every output type when
    the command has no `S` word. KerfDesk sends a bare `M8`, so this is broader than "DIGITAL"
    only. A SIGMADELTA switch skips the drain only for an `S` value that is already set.
  - **Estimator twin.** `render-model-words.ts:455-470` pushes a coolant synchronization only
    when the coolant state changes.
  - **Anchor nuance.** ADR-462 scopes "a repeat changes nothing" to stock GRBL and grblHAL
    (lines 63-66). It already expects that "a vendor firmware that drained its planner" would
    stop dark under M4 (lines 55-57). The firm anchors are therefore:
    - WORKFLOW.md:2426-2428 ("Redundant … re-arms do not invent another stop"), which is also
      false on Marlin;
    - the "Smoothieware strategies" unchanged line;
    - the checkbox being offered on every controller.
- **Fix direction:** Offer "Air restart", and run the repeats, only for profiles whose firmware
  drops an unchanged `M8` (stock GRBL, grblHAL, the Falcon contract). Otherwise correct ADR-462,
  WORKFLOW and the estimator for FluidNC, Smoothieware and Marlin.

### P3-4 — No repository test asserts that each lit move runs with its group's air; the output property tests draw a random `airAssist` but use a profile whose Air output is Disabled, so they never emit an air word

- **Where:** `src/core/output/__fixtures__/laser-job-arbitraries.ts:41,87` (`airAssist:
  fc.boolean()`), used by `grbl-strategy.property.test.ts`, `marlin-strategy.property.test.ts` and
  `smoothieware-strategy.property.test.ts` with `DEFAULT_DEVICE_PROFILE`
  (`device-profile.ts:400`, `airAssistCommand: 'none'`). The air tests that do exist are examples:
  `grbl-strategy-air-assist.test.ts`, `grbl-strategy-job-end-held-air.test.ts`, and the
  cycling-advisory twin test.
- **Anchor:** Contract. PROJECT.md NN 13 "All invariants property-tested". The air-per-group rule
  (ADR-335, ADR-398 Amendment 1) is an output invariant with only example coverage.
  `src/__fixtures__/controllers/grbl-lit-drain-checker.ts` checks lit drains, not air presence.
- **Scenario:** A future emitter change that releases a held `M8` after a group's first burn, for
  example in a new fill style or an entry runway, would let that burn run without air. No test
  would fail.
- **Evidence:** REPRO (L7 negative control). The auditor's oracle
  (`zz-d1-air-oracle.test.ts`, seed 1022) passes on today's code. It ran 1,500 jobs per
  configuration, with 3,408-6,368 lit moves per configuration and both air states present, across
  the eight configurations in the headline. Its sensitivity check found 63 of 600 jobs mismatched
  when the expectation ignored ADR-335 bridging, so the oracle can fail. The property files
  contain no `M7`/`M8`/`M9` assertion (`grep -n "air\|M8\|M9"` matches only `airAssist: false`
  fixtures).
- **Refuter:** CONFIRMED (READ and grep, two lines of evidence). Severity stays P3. New.
  - **First line.** The three strategy property tests emit with devices that have air disabled:
    - `grbl-strategy.property.test.ts` uses `DEFAULT_DEVICE_PROFILE`;
    - `marlin-strategy.property.test.ts:20-30` and `smoothieware-strategy.property.test.ts:15-19`
      spread it;
    - that profile has `airAssistCommand: 'none'` (`device-profile.ts:400`).
  - **Second line.** `bridgedAirGapIndices` has no test caller. Its only users are
    `air-assist-hold.ts`, `grbl-strategy.ts` and `air-assist-cycling-warnings.ts`.
  - **Wording.** "No repository test" is slightly too broad.
    - Example tests do pin air placement: `grbl-strategy-air-assist.test.ts`, and the Falcon
      end-to-end test `src/io/gcode/prepare-output-air-assist.test.ts`.
    - Three oracles compare per-burn air between twins: second-pass vs original
      (`second-pass.property.test.ts:271-291`), resume vs original
      (`resume-program.emitter-oracle.test.ts:101`), and compact vs verbose fill
      (`grbl-fill-compaction-resume.test.ts`).
    - The one property test that draws `airAssist: fc.boolean()` on an `M8` device
      (`marlin-raster-lit-end.test.ts:142`) checks lit drains only.
    - None of these checks each lit move against its own group's request.
  - **Anchor note.** Air-per-group is not a declared invariant in `src/core/invariants/`, so the
    NN 13 anchor is indirect. The gap is still a missing test, which is P3.
- **Fix direction:** Add the oracle as a property test: an air-enabled device across the GRBL,
  Falcon, Marlin and Smoothieware strategies, each lit move checked against
  `bridgedAirGapIndices`.

## KNOWN (not re-raised)

- **K-1** 03-P2-1, a blank last air-on group releasing a held `M8` after the final M3 burn. Fixed
  by #1342 (ADR-398 Amendment 1). Confirmed: `heldLinesAtJobEnd` drops air words, and the
  oracle's endings are clean.
- **K-2** 03-P2-2, Marlin air changes between operations stopping lit. Fixed by #1342
  (`stopKeepsPower`). The oracle is clean on inline and fan.
- **K-3** 03-P3-1, Marlin keep-alive `M8` between lit moves. Fixed by ADR-462 Amendment 1.
- **K-4** C1-P3-3, the resume preamble re-issues `M7`/`M8` but never `M9`.
- **K-5** C5 K-5, the Console sends `M7`/`M8` while Idle without confirmation. P3-2 adds the latch
  consequence, which is not in C5.
- **K-6** 2026-09-25 HF-7 evidence: "Manual Air sets the rail after the write, whatever the
  reply". This is still true: `safeWrite` awaits the transport write only. A refused `M7`
  (error:20) shows ON until the next `Ov:` frame on GRBL.
- **K-7** 18-preflight "the M7-unsupported finding should refuse". Refuted there: it is advisory
  by rule 7.

## Refuted / considered and not raised

- **Refuter:** no auditor finding was refuted, and the refuter raised no new P1 or P2. Considered
  and not raised:
  - A FluidNC door resume has no fixed coolant lead time. It uses `delay_ms`, default 0. This
    matches the auditor's lead-time ruling below.
  - A LightBurn `.lbdev` import sets `M8` from `AirAssistM7: false`. This is shown in the import
    review, and LightBurn sends the same command on that board.

- **The job should pre-arm air before the first operation.** ADR-323 decision 3 and ADR-335
  reject this deliberately.
- **Under M3 the `M8` follows the group's travel, so there is no lead time.** This is the
  ADR-398 OR-1 trade-off: the drain happens dark. grblHAL `$673` and FluidNC `delay_ms` on-delays
  then dwell dark. No ADR or WORKFLOW clause requires air lead time.
- **Manual Air ON makes Job Review's start advisory ("runs with air assist off") wrong on Falcon
  and Marlin, whose Frame sends no `M9`.** The advisory describes the emitted bytes. The extra
  air is an operator-set state and errs safe.
- **Manual Air requires Job Air on every output layer ("defaults" readiness).** This is a
  maintainer decision of 2026-09-19 (`JogPadAirAssist.tsx:17-24`).
- **grblHAL `Ov:` frames without `A:` wrongly read as "all off".** No: grblHAL sets the
  coolant/spindle report flags whenever overrides refresh and the output is on (`report.c:1473-1481`),
  and sends `A:` (possibly empty) on every change (`:1535-1562`). FluidNC follows GRBL
  (`Report.cpp:579-583`).
- **`AIR_ON_RE` misses `G1 X10 M8` in an external Marlin program.** Marlin runs one command per
  line (`marlin-program-reader.ts:2`), so `M8` there is not executed either.
- **A crafted `.lf2` injecting through `airAssistCommand`.** No: it is validated as a literal
  (`project-shape-validator.ts:125`, `deserialize-project.ts:480-481`,
  `machine-profile-shape.ts:220`, `material-library-device-hint.ts:141`).

## Verified clean

- **Air at every lit move (Q1).** The seeded oracle covered eight configurations, 1,500 jobs each.
  - Group kinds: cut (1–2 passes, constant and dynamic, entry runway, final-pass overcut, focus
    test, planner stop), scanline, offset and island fill, and raster (including blank and
    partially inked images).
  - Coordinates came from a 13×13 integer grid, to force coincident starts. Blank (0%) groups
    were included.
  - Every lit move's air equals the group's request, with ADR-335 bridging on restart-unreliable
    profiles. Air is off at program end. The Marlin and Smoothieware runs skipped 319 jobs whose
    emission threw (focus test on those strategies).
- **Placement.** Air-on precedes the group's first lit move on every path:
  - before the group when the beam is dark;
  - after the first laser-off move when held;
  - after the raster's first sweep travel (`emit-raster.ts:269-277`);
  - via the 1 mm darkening excursion for a coincident start (`grbl-output-cursor.ts:133-144`).
- **Job end.** Held air words are dropped, then `M9`, `M5` and the park (ADR-398 Amendment 1).
- **Abort.**
  - GRBL-family reset kills coolant (GRBL `motion_control.c:372-374`), and KerfDesk clears the
    latch.
  - Marlin sends `M107`, `M410`, `M5 I`, then `M9` when the latch or the stream says air.
  - Smoothieware's Ctrl-X halt sets switches to `halt_set_to`, and cleanup `M5`/`M9` is allowed
    while halted (`GcodeDispatch.cpp` allowed list).
- **Pause and Resume.**
  - GRBL door (`0x84`) de-energizes coolant (`protocol.c:566`). On resume it restores coolant and
    waits `SAFETY_DOOR_COOLANT_DELAY` 1.0 s before motion (`protocol.c:682-687`, `config.h:180`).
  - The grblHAL keep-coolant door option is logged (`laser-job-pause-resume.ts:370-382`).
  - Marlin and Smoothieware stream-side pause leave air alone, and resume needs no air restore.
- **Toggles (Q3).**
  - KerfDesk never sends `0xA0`/`0xA1`. Queued lines refuse bytes above `0x7F`, so a pasted
    NBSP or "°" cannot toggle coolant (`serial-wire-encoding.ts:29,49-57`).
  - Manual Air is refused during any active, paused or tool-change job, any motion or controller
    operation, and any non-Idle state, so it cannot desync a job's air.
  - The command is the profile word or `M9` on every dialect.
  - `A:` mirrors GRBL, grblHAL and FluidNC accessory state, including an empty grblHAL `A:`.
- **M7 readiness (Q4).**
  - Stock GRBL prints `M` in `[OPT:` exactly when `ENABLE_M7` is compiled, which is also when
    the parser accepts `M7` (`report.c:382-384`, `gcode.c:263-272`). The check reads the current
    session's `$I`.
  - The word scan ignores comments and finds `M07`, `M7.0` and `N10 G1 M7`.
  - grblHAL needs a mist capability (`gcode.c:1861-1863`), and KerfDesk conservatively warns
    "unknown" there.
- **Twins (Q5).**
  - The ADR-335 bridging rule lives in one function, read by both the emitter and Job Review.
  - The start, standby and manual-air advisories match emission.
  - The second-pass writer sets air before each group's positioning `G0` and ends `M5`, `M9`.
  - The resume preamble is `M5`, air words, then the `G0 … S0` re-entry (`resume-program.ts:324-345`).
  - The timing model syncs on coolant changes only, which matches stock GRBL (`gcode.c:952-956`)
    and grblHAL (`gcode.c:2649`).
  - Preset air offer: `presetAirAssistUpdate` fires only for a saved preset copy whose Air output
    is Disabled while the preset defines one.
- **Trust boundary (L5).** `airAssistCommand` is validated as a literal at every untrusted entry,
  and remote clients can toggle only a layer's `airAssist` boolean.
- **CNC coolant.** It turns on after the spindle spins up, turns off at the tool-change `M0`, and
  turns back on after the spindle restarts. `M9` comes after `M5` at the end.

### Refuter spot-checks (held)

- **Pause and Resume restore air before motion.** Holds.
  - GRBL: re-read from `gnea/grbl` master `protocol.c`. The door de-energizes at line 566.
    The restore at lines 682-687 re-applies the saved coolant, then
    `delay_sec(SAFETY_DOOR_COOLANT_DELAY)`, before the plunge or cycle resume.
  - FluidNC (not in the auditor's citations): the 0x84 door is shared through the GRBL driver
    (`grbl/driver.ts:66`). In laser mode `Parking::park` stops the spindle and coolant
    (`Parking.cpp:125-131`). `Parking::unpark` calls `restore_coolant()` before
    `Protocol.cpp:1343-1349` sends the cycle start.
  - Refinement: on FluidNC the lead time is `coolant/delay_ms` (default 0), not GRBL's fixed
    1.0 s.
  - Marlin's stream-side pause queues only `stopLaserLines` (`M5 I`, `M107`), with no `M9`
    (`marlin/driver.ts:38`, `laser-stream-pause-beam.ts:75`).
- **Manual Air is refused during a job on every dialect.** Holds.
  - `setAirAssistEnabled` has one caller, `JogPadAirAssist.tsx:42,47`.
  - Its synchronous gate (`laser-store.ts:405-407`, then `airAssistCommandBlockMessage`) checks
    `isActiveJob` first. That covers `streaming`, `paused`, `tool-change`, `done` and `errored`
    (`laser-store-helpers.ts:72-76`), on every driver.
  - No `await` precedes the write.
- **Marlin Abort switches air off.** Holds for KerfDesk's own job air.
  - `streamSwitchesAirOn` scans `streamer.queued`, which is the whole program, not the unsent
    tail (`streamer.ts:62-65`). So `M9` follows even after the last `M8` was sent.
  - `laser-quick-stop.test.ts:85-91` pins the mid-job case.
  - The gap is Console-typed air only (P3-2a).

## Not verified

- **Hardware.** None was run, so pump spin-up and air lead time are unmeasured. Also unknown:
  how the Falcon A1 firmware handles repeats, door/resume and `A:`; and whether its
  `$150`/`$151` airflow levels map to `M7`/`M8`.
- **Smoothieware.** No real Smoothieware laser configs were sampled to see whether `M8` is
  commonly bound to a switch. The FluidNC and Smoothieware behaviour above is from source only,
  at the cited commits.
- **On-delays.** The time estimate leaves out grblHAL `$673` and FluidNC `coolant/delay_ms`
  on-delays. This was not sized, because the defaults are believed to be 0 and that is
  unconfirmed.
- **Marlin `kill()`.** Whether Marlin turns `AIR_ASSIST` off on a kill or halt was not checked.
- **Air left running.** Not assessed: closing the desktop app with Manual Air ON on a board that
  does not reset when its port closes, and a link loss on such boards. Both leave the air running
  until reconnect, and no clause covers either.
- **Remote Abort.** The remote "Abort confirmed" check requires `!airAssistOn`. A stale latch
  (P3-2b) could delay that confirmation; this was not reproduced.
- **External programs.** Air words in external programs (ADR-630) were checked only for the
  Marlin Abort pattern.

```json
[
  {"id":"D1-P3-1","severity":"P3","area":"ctl-air-accessories","file":"src/core/preflight/m7-air-assist-readiness.ts","line":12,"anchor":"Ground truth: FluidNC GCode.cpp M8 only if hasFlood (no error); Smoothieware GcodeDispatch ok unless is_error; Twin: GRBL error:20 / grblHAL unsupported / Marlin unknown-command stop; ADR-397 context","evidence":"SOURCE","verdict":"CONFIRMED","known":"partial: Smoothieware half noted (not raised) in 2026-09-25 controller-full-audit CG.md:687-689; FluidNC half and M7 message new","summary":"FluidNC and Smoothieware acknowledge an unrunnable M7/M8 with ok, so Job Air never starts with no warning; the M7 advisory claims such firmware rejects the command and interrupts the job"},
  {"id":"D1-P3-2","severity":"P3","area":"ctl-air-accessories","file":"src/ui/state/laser-console-actions.ts","line":265,"anchor":"Contract: ADR-395/CG-10 M9 when air may be on, ADR-397 D7 simulator follows firmware; Ground truth: Marlin M7-M9.cpp, Smoothieware Switch::on_halt halt_set_to; Twin: settledProgramAirAssistPatch vs Console, own Abort vs unsolicited halt","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"On Marlin/Smoothieware the Manual Air latch ignores Console M8 (Abort/Disconnect skip M9, pump left running) and unsolicited halts (rail ON, pump off); Smoothie simulator keeps flood on through a halt"},
  {"id":"D1-P3-3","severity":"P3","area":"ctl-air-accessories","file":"src/core/output/grbl-strategy.ts","line":504,"anchor":"Contract/doc: ADR-462 'a repeat changes nothing', 'Smoothieware strategies unchanged', WORKFLOW.md:2426; Ground truth: FluidNC GCode.cpp sync on every M7/M8/M9, Smoothieware Switch.cpp wait_for_idle on every M8; Twin: timing model syncs only on change","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Air restart repeats are offered and emitted on FluidNC and Smoothieware, where each M8 drains the planner mid-contour; ADR-462, WORKFLOW and the estimator assume no stop"},
  {"id":"D1-P3-4","severity":"P3","area":"ctl-air-accessories","file":"src/core/output/__fixtures__/laser-job-arbitraries.ts","line":41,"anchor":"Contract: PROJECT.md NN 13 invariants property-tested; ADR-335/ADR-398 Amd 1 air-per-group rule","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"No test asserts each lit move runs with its group's air; output property tests draw random airAssist on a profile with Air output Disabled, so no air word is ever emitted"}
]
```
