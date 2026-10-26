# Controller audit v3 — D2 Focus and Z (`ctl-focus-z`)

- **When:** 2026-10-22 evening   **Tree:** origin/main @ `7cd526213`. `origin/main` moved to
  `4d3f00c69` during the audit, but none of the audited files changed (`git log 7cd526213..origin/main`
  on the scope list is empty).
- **Scope:**
  - Auto-focus: `src/core/devices/autofocus-command.ts`; `src/ui/state/{autofocus-action,autofocus-fresh-idle,laser-autofocus-actions}.ts`; `src/ui/laser/{AutofocusEditor,JobSetupControls}.tsx`.
  - Focus Test: `src/core/job/focus-test.ts`; `src/core/output/{focus-test-emission,focus-test-power}.ts`; `src/ui/calibration/FocusTestDialog.tsx`; `src/core/job/compile-job.ts` (focus checks).
  - Focus contributions and identities: `src/core/preflight/focus-contribution.ts`; `src/ui/laser/{frame-focus-contribution,frame-spatial-identity}.ts`; `src/ui/laser/job-review/focus-test-warnings.ts`; `src/ui/laser/second-pass/second-pass-eligibility.ts`.
  - Z and recovery: `src/core/controllers/grbl/focus-resume-issue.ts`; `src/ui/laser/FocusJogControls.tsx`.
  - Project files and clipboard: `src/io/project/{migrate-v17-focus-intent,project-layer-shape-validator}.ts`; `src/ui/state/{layer-focus-test-actions,scene-clipboard-actions}.ts`.
  - Every Z word in `src/core/output`, `src/core/job` and `src/core/raster`.
  - LightBurn Z settings on import: `src/io/lightburn/{lbrn-setting-report,clb-import}.ts`.
- **Governing:**
  - ADR-602 (relative Z Focus Test).
  - ADR-400 and its Amendment 1 (Auto-focus sends only a focus command).
  - ADR-092 Amendment 2026-08-02 (one-line presets).
  - ADR-183 (Auto-focus uses the shared arbiter).
  - ADR-362 Amendment 1 item 6.
  - ADR-565 / PROJECT.md non-negotiable 21; non-negotiables 3, 4 and 13.
- **Lenses run:** L1, L2, L3, L4, L5 and L7, each as its own pass. L6 was folded into L4, which
  covered Abort, stream errors, `error:` and ALARM.
- **Counts:** 5 raised → 0 refuted → P1 0 / P2 1 / P3 4 (+ 3 KNOWN). Refuter (2026-10-22): 5
  confirmed (P3-4 narrowed for Marlin bugfix-2.1.x), 0 plausible, 0 refuted. Severity changes:
  P3-3 P3 → P2 (an F-less `G38.x` probes at the last job's feed; see its Refuter line). No
  refuter-raised finding.

## Headline

KerfDesk emits no laser Z except Focus Test. Per-layer Z offset, Z step per pass and material height
are not modelled. LightBurn import names them as not imported.

Focus Test output holds up. An 11-variant emitter simulation (M3 and M4, passes, air, four GRBL
dialects, reversed layer order, 2 to 101 samples) found:
- no XY move under G91;
- no absolute Z;
- no Z move with the beam on;
- every burned line at its own sample's Z;
- net Z of 0 at the end.

Auto-focus is gated on a fresh Idle report, the Fire latch and other operations. It completes only
after its own `ok` and a later Idle. The accepted `G38.x` and `$HZ` forms are synchronous on GRBL,
grblHAL and FluidNC, so completion is detected, not assumed.

The auditor raised all five as P3. The refuter re-rated P3-3 to P2: an F-less `G38.x` Auto-focus
line is accepted and probes at the last job's modal feed (6000 mm/min after a typical fill, capped
only by `$112`). The other four stay P3: a wrong `error:9` hint; Z-labelled operation names that
survive a paste into another project without their Z; `G30` accepted as "focus" although it does
not focus (and on Marlin moves XY); and a test gap.

## Setting → emitted Z lines → source

| Setting | Emitted Z lines | Source |
|---|---|---|
| Focus Test sample, `layer.focusTest.offsetMm = o ≠ 0` | `; Focus Test Z offset o mm from starting focus`, dark seek to the line start, `M5`, `G91`, `G1 Z<o> F<f> S0`, `G90`, `M3/M4 S0`, then the absolute XY burn. Afterwards: a dark `G0` inside the sample, `M5`, `G91`, `G1 Z<−o> F<f> S0`, `G90`, `M3/M4 S0` | `focus-test-emission.ts:223-252` |
| Focus Test sample with `o = 0` | Marker comment only, no Z | `focus-test-emission.ts:227` |
| Focus Test Z travel feed | `f = min(travelFeed, device.maxFeed)`, using the XY ceiling. GRBL itself clamps Z to `$112` | `focus-test-emission.ts:224` |
| Sample with no represented burn (power emits `S0`, or collapsed geometry) | Nothing; the Z pair is dropped with the sample | `grbl-strategy.ts:384` |
| Focus intent on a Fill, Image or raster override, a non-GRBL dialect, or CNC mode | Refused as unconstructable output; nothing is emitted | `compile-job.ts:120-149`, `focus-test.ts:121-126` |
| LightBurn layer Z Offset / Z Step per Pass (`.lbrn`) | None. The import report names them | `lbrn-setting-report.ts:59-60` |
| LightBurn `.clb` Z fields | None. Listed under `unknownFields` | `clb-import.ts:51,87` |
| Job material thickness | None. It only picks recipes, and its tooltip says so | `JobMaterialControls.tsx:104` |
| Laser preamble and postamble | `G21 G90 G54 G94 [G17] M3/M4 S0`, then `M5` and an optional `G0 X Y S0` park. No Z | `grbl-strategy.ts:77-115` |
| Auto-focus | One operator line: `$HZ1` (Falcon contract), `$HZ` (grblHAL, FluidNC), `G38.2`–`G38.5 Z… [F…]`, or `G30` (Marlin, Smoothieware) | `autofocus-command.ts:55-152` |
| Focus jog Z± | `$J=G91 G21 Z±step F min(maxFeed,600)`. Falcon contract: `M5`, `G21 G91`, `G1 Z… F… S0`, `G90` | `JogPad.tsx:38,78`, `falcon-command-contract.ts:61-77` |
| CNC Frame retract (out of scope, CNC only) | `$J=G90 G21 Z…` | `frame-lines.ts:20-22` |

## Findings

### P3-1 — The Auto-focus hint says `error:9` means "no probe pin"; GRBL and grblHAL `error:9` is "G-code locked out during alarm or jog"
- **Where:**
  - `src/ui/laser/AutofocusEditor.tsx:92`: "`error:9` (no probe pin)".
  - `src/ui/state/autofocus-action.ts:155-158`: "Auto-focus rejected (error:9 — G-code locked / no probe pin)."
  - `src/ui/state/autofocus-action.test.ts:273`: the test pins the wrong meaning.
- **Anchor:** Ground truth.
  - gnea/grbl `doc/csv/error_codes_en_US.csv` row 9: "G-code commands are locked out during alarm or jog state."
  - grblHAL `errors.c:39`: `Status_SystemGClock`, same text.
  - grblHAL `gcode.c:1574-1575`: a driver with no probe answers `G38` with `Status_GcodeUnsupportedCommand`, which is `error:20`.
- **Scenario:**
  - An operator without a probe input gets `error:20`, and the hint for that ("unsupported on this firmware") is right.
  - An operator who gets `error:9` has a controller in Alarm or Jog. A jog or alarm can race the fresh-Idle check. The editor and the toast send that operator to check probe wiring instead of clearing the alarm or jog.
- **Evidence:** REPRO + SOURCE.
  - A temporary Vitest called `describeAutofocusResult({kind:'rejected',errorCode:9})`. It printed `"Auto-focus rejected (error:9 — G-code locked / no probe pin)."`.
  - The CSV and grblHAL sources were fetched to the scratchpad (`src-dl/grbl-errors.csv`, `grblhal-errors.c`, `grblhal-gcode.c`).
- **Refuter:** CONFIRMED, P3 kept, new (no match in either ledger or in any open PR's files).
  - Primary sources fetched again: gnea/grbl `error_codes_en_US.csv` row 9 is "G-code lock",
    "…locked out during alarm or jog state". Row 20 is "Unsupported or invalid g-code command".
    grblHAL `errors.c` has the same text for `Status_SystemGClock` and
    `Status_GcodeUnsupportedCommand`. grblHAL `gcode.c:1574-1575` answers `G38` with no probe
    input with `Status_GcodeUnsupportedCommand` (error:20).
  - A third firmware agrees. FluidNC `GCode.cpp:606-610` logs "No probe pin defined" and returns
    `GcodeUnsupportedCommand` (error:20).
  - Stock GRBL 1.1 always compiles the probe pin, so on none of the three does a missing probe
    give error:9.
  - Nuance: the toast (`autofocus-action.ts:157`) is half right, since "G-code locked" is the real
    meaning. The editor hint (`AutofocusEditor.tsx:92`) gives only the wrong meaning, and the test
    at `autofocus-action.test.ts:272-275` pins the "probe pin" wording.
  - P3 fits: the wording is wrong, but it sends the operator to the wrong check only after a
    failure that has already stopped safely.
- **Fix direction:** Say that `error:9` means the controller was in Alarm or Jog, and keep `error:20` as the
  "no probe or unsupported" case. Update the test.

### P3-2 — A Focus Test pasted into another project keeps "Focus N: Z x mm" operation names, but its Z moves are dropped
- **Where:** `src/ui/state/scene-clipboard-actions.ts:226-241`.
  - The new operation gets `layerWithoutFocusTest(copied)` (`:238`) but keeps `name: seed.name`, which is seeded from `source.name` (`:230,240`).
  - Saved Artwork insert uses the same function (`src/ui/library/personal-artwork-model.ts:113`).
- **Anchor:** Twin, and Contract ADR-602.
  - ADR-602: "Names and the displayed list use the represented values"; "Sample labels are retained operation names".
  - The label (operation name) should agree with the Z the line is burned at. Every other Focus surface agrees with emission: `LayerFocusTestNotice`, the Job Review range and the marker comment.
- **Scenario:**
  1. Generate a Focus Test in a scratch project (the generator replaces the scene).
  2. Select all, copy, open the working project and paste.
  3. The operations are named `Focus 1: Z -1.000 mm`, `Focus 2: Z 0.000 mm`, `Focus 3: Z 1.000 mm`.
  4. All lines burn at the same height: no `G91`/`Z` is emitted, and there is no Focus notice or Job Review Focus warning.
  5. The operator compares lines labelled with different Z values that were burned identically, and picks a "best" focus from noise.
- **Evidence:** REPRO.
  - A temporary store Vitest, `src/ui/state/zz-d2-focus-paste.test.ts` (copy in the scratchpad), ran `setProject(focus)`, `selectAllObjects`, `copySelection`, `setProject(new)`, `pasteClipboard`, then `emitGcode`.
  - Output: `{"ops":[{"name":"Focus 1: Z -1.000 mm","focusTest":null},{"name":"Focus 2: Z 0.000 mm","focusTest":null},{"name":"Focus 3: Z 1.000 mm","focusTest":null}],"zLines":0,"burns":3}`.
  - The existing test `focus-test-layer-safety.test.ts:43` checks only that `focusTest` is undefined.
- **Refuter:** CONFIRMED, P3 kept, new.
  - Independent repro without the store: a temporary Vitest (since deleted) ran
    `generateFocusTest` with 3 samples from −1 to +1, then
    `prepareClipboardPaste(EMPTY_SCENE, focus.layers, focus.objects, [], [], false)`, then
    `grblStrategy.emit(compileJob(…))`.
    - Output: `{"ops":[{"name":"Focus 1: Z -1.000 mm","focus":null},{"name":"Focus 2: Z 0.000 mm","focus":null},{"name":"Focus 3: Z 1.000 mm","focus":null}],"zLines":0,"burnsS":3}`.
    - The same-project path (`reuseExistingOperations = true`) keeps the offsets: `[-1,0,1]`.
  - What would refute it is a toast or rename on paste. None exists: `scene-clipboard-actions.ts`
    and the paste commands have no Focus wording other than the comment at `:233`.
  - P3 fits. The stripped paste is the safer direction (no Z moves), and the failure is a
    misleading comparison, not wrong motion. The flow is also uncommon.
  - For the fix: "Remove Focus Test Z" (`layer-focus-test-actions.ts:34`) also keeps the
    `Z x mm` name. There the operator chose it, so it is not a defect, but a shared rename helper
    should cover both.
- **Fix direction:** When Focus intent is stripped on paste or insert, also drop the Z suffix from the
  operation name, or mark it "(no Z)". Alternatively, say so in a paste toast.

### P3-3 (re-rated P2 by the refuter) — The accepted `G38.x` Auto-focus form depends on modal state, and the rule forbids pinning it
- **Where:** `src/core/devices/autofocus-command.ts`.
  - `:139-146`: Z target, with F optional (`parameters … 'F'`).
  - `:129`: exactly one G/M command per line, so `G91 G38.2 …` is refused.
  - `:33-34`: the example `G38.2 Z-10 F100` reads as "10 mm down".
- **Anchor:**
  - Ground truth, gnea/grbl `gcode.c`:
    - `:590-598`: every motion mode, probe included, converts axis words by distance mode. Under `G90` the value is a work coordinate, with WCS and G92 offsets.
    - `:418-421`: under `G94`, a block without F gets "Push last state feed rate".
    - `:664`: an undefined feed gives `error:22`.
  - Contract: ADR-400 Amendment 1 rule 1, "a Z target and an optional feed".
- **Scenario:**
  - Every KerfDesk laser job ends in `G90`, with the last burn's F modal (the preamble pins `G90`, and the postamble resets nothing).
  - Feed case:
    1. The operator configures `G38.2 Z-10`, which is accepted.
    2. After a fill at F6000 they press Auto-focus.
    3. GRBL probes at the inherited 6000 mm/min, capped only by `$112`, instead of a slow probe feed.
    4. Overtravel after contact is v²/2a. For example, `$112` = 1000 mm/min with `$122` = 50 mm/s² gives about 2.8 mm into a sprung probe or the nozzle.
  - After power-up or Abort, the same line fails with `error:22`.
  - Distance case: with a G92 or WCS Z shift, `Z-10` can lie above the head. The probe then moves up and ends in ALARM:5.
- **Evidence:** REPRO + SOURCE.
  - A temporary Vitest called `autofocusCommandIssue`:
    - `G38.2 Z-10` on grbl-v1.1 → `null` (accepted);
    - `G91 G38.2 Z-10 F100` → refused with the accepted-forms message;
    - `G38.3 Z-50` on grblHAL → accepted.
  - Source: `src-dl/grbl-gcode.c` in the scratchpad.
- **Refuter:** CONFIRMED; **severity P3 → P2** for the inherited-feed case. New: no match in
  either ledger or in any open PR's files.
  - **What would refute it.** Any of these would: a guard that adds or forces an F; a reset or
    `M2` that clears F after a job; a Console policy that asks before a probe; or GRBL refusing an
    F-less probe. None holds.
    - `probeIssue` (`autofocus-command.ts:139-146`) rejects only F ≤ 0.
    - `normalizeAutofocusCommand` (load) and `profileAutofocusIssue` (Machine Setup, profile
      import) use the same rule.
    - The GRBL Console policy classifies `G38.2 Z-10` as plain `gcode` with
      `requiresConfirmation: false` (`console-command.ts:103-104`), so `autofocusDispatchIssue`
      passes it.
    - Normal job completion sends no reset; only Stop and the error auto-stop do.
  - **REPRO** (temporary Vitest, since deleted):
    - `autofocusCommandIssue` returns `null` (accepted) for `G38.2 Z-10` and
      `G38.2 Z-10 F100000` on grbl-v1.1, for `G38.3 Z-500` on grbl-v1.1 and for `G38.3 Z-50` on
      grblHAL. `G91 G38.2 Z-10 F100` is refused.
    - `emitGcode` of a one-square Fill at 6000 mm/min on the default profile ends
      `G1X20Y379.9F6000S300`, `G1 X15.000 Y379.900 F6000 S0 ; kerfdesk:laser-off-motion`, `M5`,
      `G0 X0.000 Y0.000 S0`. There is no `M2`/`M30`, so F6000 is the modal feed the next press
      inherits.
  - **SOURCE** (fetched by the refuter; gnea/grbl master):
    - `gcode.c:418-421`: under G94 without F, "Push last state feed rate".
    - `gcode.c:664`: error:22 only when the pushed value is 0.
    - `gcode.c:44`: `gc_init` zeroes the parser state, so error:22 comes only after power-up or a
      reset.
    - `gcode.c:1092-1095`: program end does not reset F, so even an `M2` would not help.
    - `gcode.c:848-866`: a `$J=` jog does not update the modal feed, so a jog or Frame between job
      and press does not clear it.
    - `planner.c:389`: the rate is capped per axis by `$112`.
    - `probe.c:59-65`: contact raises `EXEC_MOTION_CANCEL`, a decelerating stop, not an instant
      halt.
    - `defaults.h` (generic): `$112` = 500 mm/min, `$122` = 10 mm/s².
    - grblHAL `gcode.c:2418` (push last state feed) and `:765-792` (reset zeroes parser state)
      behave the same.
  - **Physics.** Overtravel after contact is v²/2a.
    - At the generic defaults it is (8.33 mm/s)²/(2 × 10 mm/s²) ≈ 3.5 mm at the inherited
      (capped) feed. At the in-app example F100 it is ≈ 0.14 mm.
    - The auditor's 1000 mm/min and 50 mm/s² case gives ≈ 2.8 mm.
    - On a lead-screw Z that is several millimetres of stepper force into a sprung probe, a touch
      plate or the nozzle, roughly 25 to 100 times the overtravel the operator expects from a
      probe. It is enough to bend a probe tip or skip steps.
  - **Why P2 rather than P3.** It is reachable today, not latent.
    - The rule accepts the F-less form without warning, and the Auto-focus press exists so the line
      runs with no Frame or review.
    - The failure is intermittent and misleading: error:22 after power-up or Abort, then a fast
      probe after any completed job.
    - Twin: KerfDesk's own probes always write F on the probe line and state the distance mode.
      - The surface grid puts both on one line (`laser-surface-probe-actions.ts:142,157`:
        `G91 G38.2 Z… F…`, `G90 G38.2 Z… F…`).
      - The Z plate writes `G91` and then `G38.2 Z… F…` (`probe.ts:118-121`).
      - The rule refuses the one-line pinned form and accepts the one whose speed comes from the
        previous job.
  - **Why not P1.** The operator types the line (no preset or catalogue profile ships a `G38`),
    the direction and target are what they typed, and `$112` bounds the speed.
  - **Distance case: PLAUSIBLE, kept as P3 detail.** `gcode.c:590-598` applies distance mode and
    WCS/G92 offsets to probe targets, as the auditor says. Not reproduced on a controller.
  - **Refuter addendum (same root, not a separate finding).**
    - The rule bounds neither the Z target nor F: `G38.3 Z-500` and `F100000` are accepted.
    - On stock GRBL the probe pin always exists and reads untriggered when nothing is wired
      (pull-up). `G38.3` and `G38.5` ("no error") therefore run as a plain Z move with no alarm.
    - So a `G38.3 Z-50` on a laser without a probe is the `G1 Z` move ADR-400 Amendment 1 says
      Auto-focus refuses.
- **Fix direction:**
  - Require a positive F on `G38.x`, perhaps with a ceiling. Also bound |Z|, or refuse the
    no-error forms `G38.3`/`G38.5`.
  - Either allow one leading `G90`/`G91` (and `G21`) distance word on the line, or state beside the editor that the Z target is a work coordinate under `G90`.

### P3-4 — `G30` is accepted as an Auto-focus command, but on both firmwares it measures rather than focuses, and Marlin's moves XY
- **Where:**
  - `src/core/devices/autofocus-command.ts:147-151`: `G30` is accepted for Marlin and Smoothieware, or when no controller is known.
  - `src/ui/state/laser-autofocus-actions.ts:167-178`: the success patch voids only Z evidence because "focusing moves only Z".
- **Anchor:** Ground truth, and Contract ADR-400 Amendment 1 rule 1.
  - Rule 1 accepts "the forms machines document for focusing" and refuses anything that moves X or Y.
  - Smoothieware zprobe documentation: `G30` probes, "report[s] the distance traveled then return[s] to where it started".
  - Marlin 2.1.x:
    - `G30.cpp` calls `probe.probe_at_point(pos, raise_after, 1)` with `pos = current_position`.
    - `probe.cpp:894-897` runs `if (probe_relative) npos -= offset_xy; do_blocking_move_to(npos, …)`, so the nozzle moves by the probe's XY offset and stays there.
    - It then stows and calls `move_z_after_probing()`.
    - Neither firmware sets Z or moves to a focal height. Smoothieware sets Z only with `G30 Z<n>`.
- **Scenario:**
  - Marlin: on an Ender-style Marlin laser with a BLTouch (X offset −40 mm), the operator configures `G30`. Auto-focus moves the head 40 mm in X, lifts Z to `Z_AFTER_PROBING`, and toasts "Auto-focus complete". Frame was cleared at dispatch, so nothing burns in the wrong place, but the result misleads.
  - Smoothieware: the head ends where it started, and KerfDesk reports success.
- **Evidence:** REPRO + SOURCE.
  - A temporary Vitest showed `autofocusCommandIssue('G30', {kind:'smoothieware'|'marlin'})` → `null`.
  - The Smoothieware page was fetched (smoothieware.github.io zprobe documentation).
  - Marlin `G30.cpp`, `probe.h:149-151` and `probe.cpp:866-911` are in the scratchpad (`src-dl/`).
- **Refuter:** CONFIRMED, narrowed for Marlin; P3 kept; new.
  - **REPRO.** `autofocusCommandIssue` returns `null` for `G30` with no controller, on Marlin and on
    Smoothieware. It also returns `null` for `G30 Z0` (Smoothieware) and `G30 F100` (Marlin). It
    refuses `G30` on grbl-v1.1. The Marlin and Smoothieware Console policies have
    `requiresConfirmation: false`, so the press sends it.
  - **Smoothieware**, from the zprobe page the refuter fetched:
    - Bare `G30` "will report the distance traveled then return to where it started".
    - Only `G30 Znnn` "sets Z to nnn". So bare G30 measures and focuses nothing, as the auditor says.
  - **Marlin.** The marlinfw.org `G30` page says only "By default probe in the current position"
    and does not mention XY. The refuter fetched the source on two branches.
    - **2.1.x release** (`2.1.x` and the `2.1.2.5` tag). `G30` calls
      `probe.probe_at_point(pos, raise_after, 1)` with `pos` = current XY. `probe_at_point`
      defaults to `probe_relative = true`, so the nozzle moves by −probe offset to put the probe
      there. Then it calls `move_z_after_probing()` and does not return. This is the auditor's
      reading, confirmed.
    - **bugfix-2.1.x** (development). After probing it runs `motion.blocking_move(probepos)`,
      commented "Move the nozzle to the position of the probe". So the XY move is transient there.
    - Both first raise to a safe Z before the XY move (`probe.cpp:977-999`, bugfix), and neither
      redefines Z.
  - **What would refute it.** A guard that confines `G30` to a probe with no XY offset, or a Marlin
    in which `G30` never moves XY. None was found.
  - **Severity.** P3 fits. It needs a Marlin or Smoothieware laser with a Z probe and an
    operator-typed `G30`, which is a niche setup. The XY move is dark, and Frame evidence is
    cleared at dispatch. The harm is a false "Auto-focus complete" and an unexpected,
    beam-off head move.
- **Fix direction:** Drop bare `G30` from the accepted forms. Alternatively, accept only Smoothieware's
  `G30 Z<n>` (probe and set Z), describe it as a probe-and-set, and refuse Marlin `G30` (an XY move
  when the probe is offset).

### P3-5 — No test ties each burned Focus line to its own sample's Z, and the Focus invariants have no property test
- **Where:**
  - `src/core/job/focus-test.test.ts:66-90` checks pairing, `|z| ≤ 1`, net zero and laser-off Z moves.
  - `src/io/gcode/focus-test-output.test.ts:18-30` counts markers.
  - Neither checks that the line burned after marker *o* is burned at Z = *o*.
  - Nothing under fast-check covers the Focus Z invariants.
- **Anchor:** Contract.
  - PROJECT.md non-negotiable 13: "All invariants property-tested".
  - ADR-602's verification list ("per-sample net-zero Z, laser-off Z moves, absolute XY burns").
  - Twin: labels and emitted Z (question 4 of this area).
- **Scenario:** A regression that swapped `group.focusTest` between groups, for example in reordering or
  lead application, would pass every existing assertion. Each Z would still be paired and net zero,
  but the label would be wrong.
- **Evidence:** REPRO (coverage only).
  - The auditor's simulation, `src/io/gcode/zz-d2-focus-sim.test.ts` (copy in the scratchpad), tracked distance mode, beam state and Z per burn across 11 variants through `emitGcode`. Every variant passed, with output like `{"burns":9,"mismatches":0,"violations":[],"endZ":0}`.
  - So today's code is correct; the suite just does not pin it.
- **Refuter:** CONFIRMED (coverage gap), P3 kept, new.
  - The refuter read every Focus test file outside `zz-*`: 30 files. Their assertions were
    checked for a per-burn Z binding.
    - The closest are `focus-test.test.ts:66-90`, which checks a running |z| ≤ 1, pairing and net
      zero.
    - `focus-test-integration.test.ts:121-122` counts markers and checks for one
      `G1 Z-1.000 F300 S0`.
    - Neither ties a burn to its marker. A group-swapped offset keeps every pair net zero and
      within ±1.
  - No file that imports `fast-check` mentions Focus.
  - PROJECT.md:472 is non-negotiable 13, "All invariants property-tested".
  - Independent check of the "today's code is correct" claim (temporary Vitest, since deleted):
    - It tracked G90/G91 and Z, and compared each `S>0` XY burn's Z with the last
      `; Focus Test Z offset` marker.
    - Seven samples from −1.5 to 1.5 gave `{"burns":7,"mismatches":0,"endZ":0}`.
    - Reversed order with 2 passes gave `{"burns":14,"mismatches":0,"endZ":0}`.
    - `grbl-compatible` gave `{"burns":7,"mismatches":0,"endZ":0}`.
- **Fix direction:** Add a per-burn "Z equals this sample's marker" check, plus a small fast-check
  property over random offsets, sample counts, passes, power modes and dialects.

## Refuted

The refuter (2026-10-22) refuted no raised finding.

The auditor checked and dropped these candidates:
- *The Z move's `F` leaks into the burn (modal F).* No. The first burn move of every segment writes
  `F` (`grbl-strategy.ts:195-196`), and the runway line carries its own feed.
- *Abort or an error between `G91` and `G90` leaves the controller relative.* No.
  - On GRBL-family controllers, Abort is a realtime soft reset (`laser-job-stop.ts:110-122`). `gc_init` then restores `G90`.
  - A stream error triggers the auto-stop reset (`laser-reset-cleanup.ts`).
  - Every job preamble pins `G90`, and the Falcon jog and Frame pin it too.
- *`$H Z` with a space slips past the `$HZ` rule.* No. grblHAL removes spaces and capitalises before `=`
  (`system.c:1153-1157`), so it runs as `$HZ`, the command the rule checked.
- *Auto-focus completes on a stale Idle while `G38` or `$HZ` still moves.* No.
  - GRBL `mc_probe_cycle` waits until Idle before the line's `ok` (`motion_control.c:261-291`).
  - grblHAL `go_home` blocks (`system.c:481-508`).
  - FluidNC `home()` loops `while (state_is(State::Homing))` (`ProcessSettings.cpp:436-472`).
  - The arbiter needs an Idle after the `ok` (`laser-interactive-command.ts:305-321`).
  - An Alarm status cancels the request (`laser-status-line.ts:364`).
- *The Job Review Focus range uses legacy power-scale v1.* No. `prepareOutput` always sets the
  current version (`prepare-output.ts:285`). The `?? 1` default applies only to archived outputs,
  which were emitted with v1.
- *Frame identity misses a contributing Focus layer.* No. Both contributing sets are supersets of
  the emitted set: power > 0 for absolute placement, and a test at 100% power for relative placement
  (`frame-focus-contribution.ts:103-120`).
- *A cross-project paste carries hidden Z intent.* No. The intent is stripped by design. Only the
  name survives (P3-2).

## Verified clean

- **No assumed Z datum in laser output.**
  - There is no `G92`, `G10`, `G53`, `G28` or `G30` and no absolute Z. The only Z is Focus Test's relative pair. A grep of `core/output`, `core/job` and `core/raster` matches only `focus-test-emission.ts:64-65`.
  - Laser Frame is XY-only; the `$J=G90 Z` retract is CNC only.
- **Focus Test emission** (11-variant simulation, see P3-5):
  - Every Z move is preceded by `M5` and carries `S0`.
  - No XY moves under `G91`; `G90` is back before any burn.
  - Each sample returns to its starting Z.
  - Each burned line is at its own marker offset.
  - Z is 0 at the end.
  - This held with M3, M4, 3 passes, air on and off, `grbl-dynamic`, `-compatible`, `-raster` and `neotronics-4040-safe`, reversed layer order, and 2 and 101 samples.
- **Sign convention:**
  - A positive offset is controller +Z. The dialog (`FocusTestDialog.tsx:73-74`) and Job Review (`focus-test.ts:163`) say so, and the Z+ jog buttons use the same sign.
  - This matches LightBurn's Focus Test with Relative Z ("the laser's current Z position plus the value you enter in the Start Z field").
  - LightBurn's per-layer Z Offset ("Positive values move the Z Axis inward") has no KerfDesk counterpart, so no sign is inverted anywhere.
  - KerfDesk has no Reverse-Z setting; the disclosure covers bed-moving machines.
- **Labels:** sample names, `LayerFocusTestNotice`, the marker comment and the emitted `Z` all format
  the same 3-dp represented value. Distinct offsets are enforced at 0.001 mm.
- **Recovery:** resume and Start-from-line refuse any program with the Focus marker and relative Z
  motion (`focus-resume-issue.ts`, `resume-program.ts:81`). The XY-only painted second pass excludes
  them. Zero-offset samples keep ordinary recovery.
- **Auto-focus preflight:** checks connection, job, motion, the Fire latch (`laser-store-helpers.ts:188`), MPG, busy and owed acks, then a fresh status after its own `?` that must read Idle. Frame permits are cleared at dispatch.
- **Auto-focus completion and failure:**
  - It completes on the owned terminal `ok` plus an Idle after it, or an active→Idle cycle.
  - `error:` → rejected with its code; ALARM line or Alarm status → alarm; silence → timeout and motion-uncertain, with status cleared.
  - A Smoothieware shell word is refused before sending.
  - On success, Z-zero evidence is voided.
- **Laser off during Auto-focus:**
  - Fire blocks it.
  - In GRBL laser mode a non-`G1/G2/G3` motion sets `GC_PARSER_LASER_DISABLE` (`gcode.c:872`), so a `G38` probe runs dark.
- **Command rule:**
  - Refused: M-codes, `G0`–`G3`, X, Y and rotary words, `S>0`, `$…=`, `$J=`, comments, two commands on one line, and `$HZ…` on stock GRBL.
  - Accepted: `$HZ1` only under the Falcon contract; `$HZ` on grblHAL and FluidNC. Both firmwares refuse `$HZ` with an error when single-axis homing is not enabled.
- **Project and migration:**
  - The v17→18 migration strips `focusTest` from layers, sub-layer settings and `lastResolved`.
  - The v18 validator requires a finite offset with |offset| ≤ 1000 and 3 dp, and a positive travel feed. A sub-layer `focusTest` is refused.
  - A same-project paste keeps the intent; Remove Focus Test Z is a single Undo step.
- **Twins:**
  - Job Review builds the Focus range from compiled groups with the same `hasRepresentedCutBurn` as emission (`focus-test-warnings.ts:29-36`).
  - The CNC refusal probe (`focus-contribution.ts`) only considers non-zero offsets.
- **LightBurn import:** Z Offset and Z Step per Pass are reported as not imported. `.clb` Z fields
  land in `unknownFields`.
- **Focus jog:** the laser shows Z± only with the `z-axis` capability, confirmed travel and positive travel.

**Refuter spot-checks (2026-10-22).** The refuter tried to break the two riskiest claims and both
held.
- **Abort mid-sample leaves no G91.**
  - `runStopJob` (`laser-job-stop.ts:110-122`) uses the driver's soft reset whenever it has one.
    Only Marlin and Ruida have `softReset: null` (`marlin/driver.ts:62`, `ruida/driver.ts:40`), and
    Focus output is refused for both.
  - After that reset each firmware's `gc_init` zeroes the parser state, so distance mode is
    absolute again:
    - gnea/grbl `gcode.c:44`;
    - grblHAL `gcode.c:765-792`, on both the cold and the warm path (`memset` up to
      `g92_offset`);
    - FluidNC `GCode.cpp:72-79` (`memset`, then `modal_defaults`).
  - A stream `error:` follows the same auto-stop reset (`laser-error-line.ts`).
  - Not covered: a USB link loss between `G91` and `G90` sends no reset. ADR-602 already discloses
    an interrupted Focus run.
- **Recovery refuses Focus Z programs.**
  - Every laser resume entry goes through `buildLaserResumeProgram` → `buildResumeProgram`, which
    runs `focusResumeIssue` at `resume-program.ts:81` before scanning. The entries are
    `laser-recovery-flow.ts:93`, `recovery-artifact-binding.ts:67`, `start-job-resume-stream.ts:152`
    and `recovery-stress-testing.tsx:331`.
  - No output step strips the comment that holds the marker. The only `stripComments` helpers are
    in resume, re-entry and external-program parsing, not in emission.
- **Also re-checked.**
  - A G38 probe runs dark in GRBL laser mode (`gcode.c:868-872`).
  - The per-burn Z claim was re-checked independently (see P3-5).

## Decided, not raised

- **ADR-602:**
  - Z travel and capability are warnings, not Start gates (NN 21: Frame is the only Start guard), and Frame traces XY only.
  - Sample labels are operation names, not engraved text, although LightBurn engraves them.
  - The 2D estimate excludes Z.
  - An interrupted run can leave Z displaced.
  - A crafted `.lf2` can therefore carry ±1000 mm Focus offsets on an innocently named operation. This is disclosed by `LayerFocusTestNotice` in the layer row and by the Job Review range.
- **ADR-400 Amendment 1 refuses every M-code and non-G-code form.** Vendor routines reported on
  forums would be refused: xTool S1's focus M-code and Atomstack's `[ESP500]`. Neither machine is in
  the catalogue.
- **`$HZ` on grblHAL and FluidNC is accepted as "focus" though it homes Z, usually upward.** The ADR
  chose this, and only an operator can type it.

## KNOWN (not re-raised)

- **13-P1-1:** a project file's Auto-focus command. Fixed by #1352 (ADR-400 Amendment 1). Re-checked here: load clears it, the button re-checks it, and a same-identity file keeps the operator's command.
- **03-P3-12 / 18 K-10:** the Inspector flags KerfDesk's own Focus Test output as a rapid below Z0.
- **C8-P2-1:** NumLock-off keypad 9 and 3 jog Z by one focus step (PR #1376).

## Not verified

- **Falcon A1 Pro `$HZ1` timing:** whether it answers `ok` before or after its cycle, and whether its
  status shows activity. The vendor has not documented it, and no hardware was used. A Falcon that
  answered early and kept reporting Idle would complete Auto-focus early.
- **Physical Z direction, clearance and soft limits on real machines.** With GRBL Z homed to the top,
  any +Z sample trips a soft limit and resets mid-job. This failure is safe and was not simulated.
- **Vendor focus commands** for xTool, Atomstack and Sculpfun come from forum reports only. The Sculpfun
  S30 and xTool D1 Pro in the catalogue have manual focus.
- **Air keep-alive timing of Focus Z moves.** It uses the XY feed and acceleration limits, while
  `$112`/`$122` are usually lower. This belongs to D1.
- **UI flows in a browser.** All evidence is from store and emitter Vitests. FluidNC, Smoothieware and
  Marlin behaviour was read from source and documentation only; no simulator was run.

```json
[
  {"id":"P3-1","severity":"P3","area":"ctl-focus-z","file":"src/ui/laser/AutofocusEditor.tsx","line":92,"anchor":"Ground truth: gnea/grbl error_codes_en_US.csv row 9 'G-code commands are locked out during alarm or jog state'; grblHAL errors.c:39; grblHAL gcode.c:1574 no probe -> error:20; FluidNC GCode.cpp:606-610 'No probe pin defined' -> error:20","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Auto-focus editor hint and toast (autofocus-action.ts:157, pinned by autofocus-action.test.ts:273) say error:9 means 'no probe pin'; it means alarm/jog lockout"},
  {"id":"P3-2","severity":"P3","area":"ctl-focus-z","file":"src/ui/state/scene-clipboard-actions.ts","line":238,"anchor":"Twin: operation-name label vs emitted Z; Contract ADR-602 'Names ... use the represented values'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Cross-project paste / Saved Artwork insert strips Focus Z intent but keeps names like 'Focus 1: Z -1.000 mm'; all lines burn at one height with no Focus notice"},
  {"id":"P3-3","severity":"P2","area":"ctl-focus-z","file":"src/core/devices/autofocus-command.ts","line":141,"anchor":"Ground truth: gnea/grbl gcode.c:590-598 distance mode applies to probe targets, :418-421 push last state feed, :664 error:22, :1092-1095 M2 keeps F, planner.c:389 $112 cap, probe.c:64 motion-cancel decel; grblHAL gcode.c:2418; Twin: laser-surface-probe-actions.ts:142,157 and probe.ts:118-121 always write F; Contract ADR-400 Amd 1 rule 1 'optional feed'","evidence":"REPRO","verdict":"CONFIRMED (re-rated P3->P2 by refuter)","known":false,"summary":"Accepted G38.x Auto-focus is modal: F-less form probes at the last job feed (repro: a 6000 mm/min fill leaves F6000 modal; capped only by $112, ~3.5 mm overtravel at GRBL defaults vs ~0.14 mm at F100), under G90 Z-10 is a work coordinate, no F ceiling or |Z| bound (G38.3 Z-500 accepted), and 'G91 G38.2 ...' is refused so it cannot be pinned"},
  {"id":"P3-4","severity":"P3","area":"ctl-focus-z","file":"src/core/devices/autofocus-command.ts","line":147,"anchor":"Ground truth: Smoothieware zprobe doc (G30 returns to where it started); Marlin G30.cpp + probe.cpp:894-897 (nozzle moves by probe XY offset, then move_z_after_probing); Contract ADR-400 Amd 1 rule 1 (focus forms only, no XY motion)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Bare G30 accepted as Auto-focus on Marlin/Smoothieware; it measures without focusing (Smoothie returns to start; Marlin 2.1.x release shifts XY by the probe offset and raises, bugfix-2.1.x moves XY and back) yet reports 'Auto-focus complete'"},
  {"id":"P3-5","severity":"P3","area":"ctl-focus-z","file":"src/core/job/focus-test.test.ts","line":66,"anchor":"Contract: PROJECT.md NN 13 (invariants property-tested); ADR-602 verification list; Twin label vs emitted Z","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"No test binds each burned Focus line to its own sample's Z (a swapped-offset regression passes); Focus Z invariants have no property test. Auditor simulation shows today's output is correct"},
  {"id":"K-1","severity":"P1","area":"ctl-focus-z","file":"src/io/project/project-shape-validator.ts","line":124,"anchor":"see rolling-v2 13-P1-1","evidence":"READ","verdict":"KNOWN","known":"13-P1-1 (fixed by #1352)","summary":"Project-file Auto-focus command injection; fixed, re-checked here"},
  {"id":"K-2","severity":"P3","area":"ctl-focus-z","file":"src/core/gcode-view/finding-checks.ts","line":91,"anchor":"see rolling-v2 03-P3-12","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"03-P3-12 / 18 K-10","summary":"Inspector flags Focus Test output as rapid below Z0"},
  {"id":"K-3","severity":"P2","area":"ctl-focus-z","file":"src/ui/laser/use-jog-shortcuts.ts","line":69,"anchor":"see controller-v2 C8-P2-1","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"C8-P2-1 (PR #1376)","summary":"NumLock-off keypad Page keys jog Z by one focus step"}
]
```
