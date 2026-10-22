## ADR-630 Amendment 4 - An external run checks `$30` and `$32` as project Start does, and names lit rapids (2026-10-22)

**Status:** Accepted. Amends ADR-630 "Review and Start". Keeps PROJECT.md non-negotiable 21 and
ADR-565: the completed Frame stays the only ordinary Start gate. Fixes controller audit v3 findings
D4-P2-1 and D5-P2-2. | **Date:** 2026-10-22

### Context

Project Start runs `runControllerReadiness` over the connected controller's `$30` and `$32`. Job
Review lists what it finds as warnings (#291, `start-job-controller-policy.ts`): a router reporting
`$32=1` (`laser-mode-enabled`), a laser reporting `$32=0` (`laser-mode-disabled`), a `$30` that does
not match the spindle's max RPM (`spindle-scale-mismatch`) or the laser's max S
(`max-power-mismatch`), and settings that were not read. A laser Start whose `$30`/`$32` are not
verified also asks one acknowledgement (ADR-228).

The Run G-code file path never ran those checks. Two things went wrong.

1. **A router in laser mode (D4-P2-1).** `confirmLaserModeStartEvidence` returns nothing for a
   machine that is not a laser, so a CNC external run looked at no controller setting. A router left
   at `$32=1` from laser work ran a CAM post's `M3 S18000` / `G4 P5` with no warning. In laser mode
   GRBL zeroes the spindle on every motion that is not G1, G2 or G3 (gnea/grbl `gcode.c` sets
   `GC_PARSER_LASER_DISABLE`), and the GRBL wiki's Laser Mode page says a spindle "MUST" have laser
   mode off. So the dwell ran with the spindle off, every `G0` stopped it, and each `G1` plunge
   started it from rest. With `$30=1000` left from the laser, `S18000` also saturated without a
   word. Project CNC Start on the same controller lists both. The audit's refuter reproduced the
   external run at store level: the program streamed, and the only prompt was the workholding one.
2. **Lit rapids on a laser at `$32=0` (D5-P2-2).** GRBL turns the laser off on rapids only in
   laser mode: `gcode.c` sets `GC_PARSER_LASER_DISABLE` inside
   `if (bit_istrue(settings.flags, BITFLAG_LASER_MODE))`. grblHAL (`Mode_Laser`) and FluidNC
   (`spindle->isRateAdjusted()`) do the same. KerfDesk's own output writes `S0` on every `G0`
   (non-negotiable 3), so it stays dark either way. An opened program need not: LightBurn-style
   output (`M4`, `G1 … S800`, then `G0 X Y` with no `S`) runs every rapid at `S800` when `$32=0`.
   The only gate was the generic settings prompt, the same one a `$30` mismatch gets. It cited "Job
   Review", which this path never shows, and it did not say what would happen. The audit's power
   oracle ran a rapid at `S800`.

### Decision

1. **The same checks, the same words.** While a controller is connected, the Run review runs
   `runControllerReadiness` with exactly what project Start passes: the project, the live
   `controllerSettings`, the connection's settings capability, and the detected (else active)
   firmware kind. Its errors and warnings are listed in the Run review's warnings, first, in the
   messages Job Review shows. They are warnings, as in Job Review. Nothing new refuses, and Frame
   stays available. Disconnected, the review lists none: Frame already says to connect first.
2. **Lit rapids are named.** On a laser connected through `$` settings (GRBL, grblHAL, FluidNC),
   `findLitRapids` scans the exact sent bytes for `G0` moves made while `M3` or `M4` is on and `S` is
   not set to 0. Within a block, `S` and the spindle change before the move, and `M2`/`M30` switch the
   spindle off and reset the motion mode to `G1` after it, as in `gcode.c`. An `S` the program never
   set counts, because GRBL keeps `S` from whatever ran before. The scan agrees line by line with
   the repo's GRBL power oracle (`grbl-laser-power-model.ts`).
   - When the controller reports `$32=0`, the warning counts those moves, names the first by its
     line in the sent program, and says each burns a line where the head travels.
   - When `$32` is not confirmed, the warning says the same moves burn if laser mode is off.
   - When `$32=1`, or the program writes `S0` on every rapid, there is no such warning.
   - Marlin and Smoothieware have no `$32`, and a Smoothieware `G0` never fires, so they get none.
3. **The level is project Start's.** The same controller state on a project Start gives a Job Review
   warning plus, on a laser whose `$30`/`$32` are not verified, one acknowledgement. The external run
   now gives the same: Run review warnings, and on a laser the same acknowledgement under the same
   condition (`laserModeStartAcknowledgementRequired`). A CNC external run, like a CNC project Start,
   still asks only the workholding attestation; its `$32`/`$30` findings are the Run review warnings
   the operator reads beside the Start button.
4. **Warn, not refuse, for lit rapids.** Refusing was considered and rejected. A lit rapid is a
   policy judgement about the program and the controller's configuration. The program can be sent
   and streamed exactly as reviewed, so a refusal would be a new Start gate beside the Frame, which
   non-negotiable 21, ADR-565 and AGENTS.md rule out. So the review names the consequence, and the
   acknowledgement leads with it.
5. **The acknowledgement cites this path.** The external run's laser acknowledgement keeps the
   meaning of the project one, but says "listed in the Run review warnings" instead of "shown in Job
   Review", and asks to "Start this laser program". When there are lit rapids, the lit-rapid warning
   comes first in it. `confirmLaserModeStartEvidence` takes the prompt text as a parameter, and
   every other caller keeps the Job Review text.

### Consequences

- An opened program on a router left in laser mode, or with `$30` set for a laser, now shows the
  same `$32=1` and `$30` warnings as a project CNC Start. Job Review's **Send $32=0** button is not
  added to the Run dialog. The operator fixes the setting from Job Review, Machine Settings or the
  Console, and the review clears once the controller's settings are read again.
- An opened program on a laser at `$32=0` says, before Frame and again at Start, which rapids will
  burn. The same program at `$32=1` stays quiet.
- The G-code Inspector's own view and Program Health are unchanged. They still draw a `G0` as
  travel, because they do not know the controller.

### Verification

- `lit-rapids.test.ts` checks the scan against the GRBL power oracle: unguarded LightBurn-style
  rapids, `S0` on the move, `M5`, program ends (including the `G1` reset), modal `G0` lines, `S` and
  `M3` on the move itself, and `M3` before any `S`.
- `external-run.controller-readiness.store.test.ts` runs the real laser store with a scripted GRBL
  connection and the real `startExternalProgram`. It covers:
  - a router at `$32=1`/`$30=1000`, whose review lists exactly project Start's two messages and
    whose Start asks only the attestation;
  - a laser at `$32=0` with unguarded rapids, which gets the lit-rapid warning and a prompt that
    leads with it, cites the Run review and sends nothing when declined;
  - the same laser with `S0` on every `G0`, which gets no rapid warning or text, but still gets the
    `$32=0` warning and the acknowledgement, as project Start does;
  - a laser at `$32=1`, which gets no warning and no prompt;
  - `$32` not reported, which gets the conditional wording.
- Two `RunGcodeFileDialog` cases show the warnings in the rendered Run review, with Frame
  available.
- No hardware was run.
