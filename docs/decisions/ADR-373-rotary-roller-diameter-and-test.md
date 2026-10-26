## ADR-373 - Rotary roller diameter, linked circumference, test rotation and the Rotary switch (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24 | **Amends:** ADR-127 (roller scale), ADR-315 (setup
surface). Physical rotary output remains CLAIMED until a maintainer bench pass.

### Context

ADR-127 mapped a roller rotary 1:1: one design millimetre was one machine Y millimetre. That is
right only when the controller's Y steps/mm were changed so the roller moves the part's surface in
millimetres. The common installation instead plugs the roller into the Y motor output unchanged, so
one machine millimetre turns the driven roller by a fixed angle and the part's surface moves by that
angle times the roller's radius. LightBurn's roller setup asks for the roller diameter and the
travel per roller rotation for exactly this reason
(https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/). KerfDesk had no way
to express it, greyed out Motion per turn for rollers, and so could only drive a re-calibrated
controller.

The setup also had no way to check itself before a burn. LightBurn's Rotary Setup has a Test button
that turns the rotary one revolution, pauses and turns back, and an option to show the rotary
enable in the main window so the operator always sees which mapping the next job uses. KerfDesk
showed rotary state only inside the dialog, Machine Setup and Job Review.

### Decision

1. **Optional roller diameter.** `RotarySetup.rollerDiameterMm` is optional and meaningful only for
   a roller. When present, the roller's Y scale is `mmPerRotation / (π × rollerDiameterMm)`, where
   `mmPerRotation` is machine Y travel per revolution of the driven roller. The scale does not
   depend on the part's diameter: a roller moves every part's surface at the roller's surface
   speed. One revolution of the part is `scale × π × objectDiameterMm` machine mm, which remains the
   wrap limit of ADR-127.
2. **Absent means unchanged.** A roller without a roller diameter keeps scale 1 and its output is
   byte-identical to earlier releases (golden digests in `emit-gcode-rotary-roller.test.ts`). A
   chuck keeps `mmPerRotation / (π × objectDiameterMm)` and ignores any roller diameter.
   `.lf2` and machine-profile import accept the field only as a positive finite number.
3. **One set of math.** `rotaryYScale`, `rotaryYLimitMm` and `isRotaryActive` in
   `core/devices/rotary.ts` remain the only source; emit, framing, estimates, preflight, jog
   warnings and `.rd` output already route through them (ADR-127) and needed no change.
   `isRotaryActive` now also requires a usable roller diameter when one is set.
4. **Linked circumference and a strip measure.** Rotary Setup shows Object diameter and
   Circumference as one linked pair (either edits both; the diameter is stored unrounded). A
   **Measure with a strip** helper turns a wrapped strip's flat length and thickness into
   `diameter = wrap / π − thickness`, reading the part where the artwork goes, which calipers cannot
   do on a tapered or soft part. The preview adds the Y scale and the tallest artwork one
   revolution holds.
5. **Test rotation.** Rotary Setup turns the part (or the chuck, or the driven roller) one
   revolution at about ten seconds per revolution (100-1500 mm/min, never above the profile's
   maximum feed), pauses one second, and turns back by the same distance, using the values on
   screen before Apply. Both turns are ordinary jogs through the laser store's jog action, so they
   use each driver's own jog emitter, readiness gate (connected, Idle, no alarm, no job, no other
   motion), cancel path and Frame expiry. No new controller write path exists and no Frame or Start
   file changed. The test also refuses while momentary Fire is on and re-checks Fire before the
   return turn. Stop, closing the dialog or a cancel from any surface stops motion (jog cancel, or
   ABORT MOTION without it) and suppresses the return turn; a rejected turn, alarm or disconnect
   ends the test with its reason.
   Cancel and Abort advance a store-owned intent epoch even between turns; the
   return turn is suppressed if that epoch or the controller session changes during the pause.
6. **Rotary switch.** Once a profile has a rotary setup, a laser project's Job actions dock shows a
   **Rotary** toggle above Frame and Start with the attachment and size. It edits the same
   `device.rotary.enabled` Rotary Setup edits, as one undoable profile edit, is disabled while a
   job, motion or controller operation owns the machine, and opens Rotary Setup when the
   measurements cannot map Y. Switching changes the job's Y mapping and therefore expires a
   completed Frame. Machine Setup's status line and Job Review's Rotary fact use the same wording,
   and Job Review now names the scale and one-revolution travel.

### Consequences

- Stock roller installations can be driven without re-calibrating the controller, with the same
  inputs LightBurn users already know.
- A setup can be checked by motion alone, with the beam off, before anything burns, and adjusted
  until one revolution lands on the mark.
- The operator always sees whether the next Frame and Start use the rotary mapping.
- Frame-first is unchanged (PROJECT.md non-negotiable 21, ADR-228/230/232/237): the rotary facts and
  warnings stay in Job Review, the switch and the test add no Start gate, and any change to the
  mapping or any test turn expires a completed Frame.
- Residual risk: a GRBL `$J=` jog keeps the controller's modal spindle state. KerfDesk never sends
  M3/M4 for the test and refuses it while Fire is on, but a laser left on by a hand-typed console
  command is outside what a jog can prevent; this is the same exposure as every jog.
- The scale factor, direction and wrap limit are unit- and simulator-tested only; physical rotary
  qualification remains an operator-owned supervised test disclosed in Job Review.

### Verification

- `core/devices/rotary.test.ts`: roller without diameter scale exactly 1, measured roller scale and
  wrap limit, chuck unchanged and ignoring a roller diameter, revolution travel, diameter
  derivations, activity checks.
- `io/gcode/emit-gcode-rotary-roller.test.ts`: byte-identical legacy roller output (vector and
  raster, forward and reversed), roller-diameter scaling, wrap-limit refusal, chuck unchanged.
- `io/project/project-rotary.test.ts`, `io/machine-profile/machine-profile-rotary.test.ts`: round
  trip and rejection of a non-positive or non-numeric roller diameter.
- `ui/laser/rotary-test-rotation.test.ts`: plan, feed limits, readiness reasons, out-pause-back
  order, stop, early end, refusal, cancel elsewhere, Fire and alarm between turns, stop routing.
- `ui/laser/rotary-test-rotation.simulator.test.ts`: exact GRBL `$J=` and Falcon tool-off wire text
  for both turns, no laser-on word, return to the start, and Stop sending `0x85` with no return.
- `ui/laser/rotary-test-rotation.commands.test.ts`: both turns' text on GRBL, grblHAL, FluidNC,
  Marlin, Smoothieware and the Falcon contract, none with M3/M4 or a nonzero S word.
- `ui/laser/RotarySetupDialog.roller.test.tsx`, `RotaryTestRotationPanel.test.tsx`,
  `RotaryModeSwitch.test.tsx`, `RotaryModeSwitch.frame.test.tsx`,
  `device-setup/DeviceSetupRotaryFields.test.tsx`, `rotary-setup-edit.test.ts`,
  `rotary-summary.test.ts`: dialog, switch (including Frame expiry) and wizard behaviour.

### Amendment 1 (2026-10-22) - a missed test turn names what to change, and a new roller scales

**Context.** Controller audit v3 finding D3-P2-1 (confirmed by a refuter): every new roller
started unscaled, and the Test rotation note after any turn said "adjust the measurements and
test again". On an unscaled roller only **Turn object once** exists and Motion per turn is greyed
out, so the operator could change only the object diameter. Tuning it makes the test land: on a
stock roller (40 machine mm per turn of a Ø25 roller) under an 80 mm tumbler, Ø40.74 turns the
tumbler exactly once. But Y stays at scale 1, so a 20 mm design still burns 39.27 mm tall. The
wrap preview, the Rotary switch and Job Review then all agree on a 128 mm circumference, which
removes the one signal before a burn that the setup is wrong.

LightBurn's GCode rotary page
(https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/) says:
- For a roller, the object diameter "does not affect output".
- Output comes from mm per rotation and the roller diameter.
- The Test turns "the roller or wheel driven by the motor", and the correction is to mm per
  rotation: reduce it if the rotary turns too far, increase it if it stops short.
- It has no roller mode without a roller diameter.

**Decision.**
1. **The note names the value the turn can correct.** After a finished turn, Test rotation says:
   - After **Turn chuck once** or **Turn roller once**: change Motion per turn, lower if it turned
     too far, higher if it stopped short. This is LightBurn's instruction.
   - After **Turn object once** on a roller scaled from its diameter: check Motion per turn with
     Turn roller once first. Then measure the roller diameter and the object again rather than
     adjust either until the mark lands. The roller diameter sets the burn size; the object
     diameter only sets how much artwork fits in one turn.
   - After **Turn object once** on an unscaled roller: the controller is not moving the part's
     surface in millimetres, so jobs would burn at the wrong size. Turn on **Scale Y from the
     roller diameter** and enter the roller diameter and Motion per turn, or set the controller's
     Y steps/mm to the part's surface. Changing the object diameter can make the mark land, but
     it does not fix the size.

   No note asks the operator to tune a roller's object diameter. The note follows the setup on
   screen, so once the operator turns roller scaling on, it already names the next check.
2. **A new roller scales, as LightBurn's does.** Rotary Setup and Machine Setup's rotary fields
   start a profile that has no rotary from `NEW_ROTARY_SETUP` (`ui/laser/rotary-setup-edit.ts`).
   That is `DEFAULT_ROTARY_SETUP` plus a 25 mm roller diameter, the field's existing starting
   value. A saved chuck switched to Roller also starts scaled.
   - Motion per turn keeps its existing 360 mm starting value. Both numbers are placeholders for
     the operator's measured values; LightBurn states no default for either.
   - A never-edited new roller therefore maps Y ×4.58 instead of ×1. Neither placeholder fits an
     unmeasured rotary. The scaled one shows both values it depends on, Turn roller once checks
     Motion per turn directly, and the scale is visible in Rotary Setup and Job Review before
     anything burns.
3. **Earlier projects are unchanged.** A saved roller without a roller diameter opens unscaled and
   keeps scale 1, with output byte-identical to decision 2 above (the golden digests are
   unchanged). Nothing changes in:
   - `DEFAULT_ROTARY_SETUP`, `rotaryYScale` or any other core function;
   - `.lf2` and machine-profile import.

   No load path adds a roller diameter; only a setup created in the UI after this amendment
   carries one.
4. **The mode is named.** `rotaryAttachmentSummary` labels an unscaled roller "(Y not scaled)",
   as a scaled one already carried "(rollers Ø25 mm)". The Rotary switch, Machine Setup's status
   line and Job Review's Rotary fact therefore all say which mapping the next job uses.
5. **Copy:**
   - the toggle's hint and title say when Y may stay unscaled;
   - tutorial steps 2-3, `docs/laser-production-workflows.md` and WORKFLOW F-B17 follow
     decisions 1-2;
   - audit P3-4: Machine Setup's note no longer promises that the calibration pattern measures a
     full revolution or shows direction. The pattern is a symmetric rectangle under half a
     turn. The generate toast now names the height to measure around the part.

**Consequences.**
- A stock roller left on the defaults now follows LightBurn's flow: enter the roller diameter and
  Motion per turn, check the roller turn, then the object turn.
- An operator whose controller's Y steps/mm already move the surface must turn scaling off on a
  new roller; the toggle's hint says when.
- Not changed by this amendment (same audit):
  - D3-P2-2: Home with the rotary on;
  - D3-P3-1 and D3-P3-2: positional checks against rotary Y;
  - D3-P3-3: the G-code inspector's wrap ignores Reverse;
  - an asymmetric calibration pattern.
- Evidence is unit and component tests only; physical rotary qualification stays operator-owned.

**Verification.**
- `ui/laser/RotaryTestRotationPanel.test.tsx`:
  - an unscaled roller whose diameter was tuned to land (Ø128/π, a 128 mm turn) gets the
    roller-scaling note and no "adjust the measurements";
  - turning scaling on switches the note to the roller-turn check;
  - roller and chuck turns name Motion per turn.
- `io/gcode/emit-gcode-rotary-roller.test.ts`: on a stock roller, the unscaled output burns ×1.96
  tall and the tuned diameter changes no byte. With roller scaling on, the 50 mm line burns 50 mm
  for both object sizes.
- `ui/laser/RotarySetupDialog.roller.test.tsx`: a profile with no rotary opens on a scaled
  roller and applies `rollerDiameterMm: 25`.
- `ui/laser/rotary-setup-edit.test.ts`: covers `NEW_ROTARY_SETUP`, a chuck switched to Roller
  starting scaled, and a legacy roller staying unscaled.
- `ui/laser/MachineDialogControls.audit.test.tsx`: in Rotary Setup, a saved chuck switched to
  Roller enables Motion per turn and shows the 25 mm roller diameter.
- `ui/laser/rotary-summary.test.ts` and `device-setup/device-setup-option-status.test.ts`: the
  "(Y not scaled)" label.
