## ADR-440 Amendment 5 - The canvas target, the bed picture, the nudge ring and the machine notice follow the bed frame (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

### Context

Amendments 1, 3 and 4 tied the camera calibration to the bed frame its rings were placed in.
Rolling audit v3, area G6, found four places that missed it. Independent refuters confirmed all
four on main `9a2bf6b13`.

- **G6-P2-1 (P1).** **Add target to canvas** (ADR-441 Amendment 5) remembered the bed frame at
  the click, but the rings burn later through an ordinary Start. In the repro, a front-left
  400 × 400 bed got the target, and Machine Setup was then corrected to 400 × 410 before the burn.
  The fit labelled the rings in the remembered 400 frame, and Amendment 1 moved the result by
  another 10 mm. Marks at machine (200, 210), (60, 70) and (340, 300) were drawn where artwork
  burns 10 mm nearer the front. The Camera panel said "KerfDesk moves its picture 10 mm to match".
  A target added offline and burned after homing was saved with ADR-441 Amendment 5's false "not
  homed" note.
- **G6-P2-3 (P1).** A head camera's stitched bed picture (ADR-449) was kept in scene millimetres
  with no frame, and drawn before any model or frame check. After a bed correction it stayed put,
  10 mm off. After an origin change it was still drawn, mirrored against the burn, although
  Amendment 1 Decision 3 refuses the model there. It also survived opening another machine's
  project. The burn check's picture (ADR-490) had the same gap.
- **G6-P2-2 (P2).** Amendment 3 Decisions 1 and 4 treat a file whose bed size differs as another
  machine, and it brings its own calibration. That stays. But when only the bed size differs, the
  machine notice named the same machine twice and gave no bed sizes. It said nothing about the
  camera, and its primary button, **Use project machine**, reverts both the bed correction and the
  newer calibration.
- **G6-P3-3 (P2).** The nudge ring (ADR-663 Amendment 2) is an Absolute burn that a camera fit is
  measured on, like the target. It had none of the target step's home-first advice. A nudge on an
  unhomed machine folded the power-on offset, up to the 10 mm limit, into a calibration placed with
  the native offset known. The record kept that offset, so ADR-441 Amendment 5's note never fired.

### Decision

1. **The canvas target's frame is the frame at the Start that burns it.** The engraved-target
   memory keeps the frame at the add only until then (`EngravedTarget.burnSeen`). A camera helper
   watches each framed Start (`completedFrameRunOwner`). A Start counts when it runs at Absolute
   Coordinates and its output-scoped scene holds every ring of the remembered layout, unmoved. It
   then records the bed frame of that Start, native offset included, and that Start's time
   (`canvas-target-burn.ts`). This amends ADR-441 Amendment 5 Decision 3, which remembered the
   frame at the add. It also follows Amendment 1 Decision 1: the frame is the one the rings were
   placed in.
2. **An unseen burn after a change is refused.** Suppose no Start of the rings was seen: they ran
   from saved G-code or another computer, or before this amendment. If the frame at the add still
   places the bed the same way (same origin corner, no shift), it is used. If not, the photo step
   says why and does not fit: "This target was added to the canvas while the machine was set up
   differently …". It asks for the target to be added again and started, or for **Engrave target**.
   An offset known in only one of the two frames is not a change, as in Amendment 1.
3. **A flat bed picture records where it was taken.** The stitched head-camera picture and the
   burn check's picture keep the bed frame and the machine (profile id, else name) of their scene
   millimetres (`BedPicture.taken`). The overlay draws the picture where that part of the bed is in
   today's frame (`bedAreaInBedFrame`). After a bed-size or native-offset change it is moved, and a
   notice says by how much. After an origin change, or on another machine, it is cleared with a
   notice saying why. Opening a project for the same machine keeps it, because the bed under the
   camera has not changed. The stored picture stays the one captured, so the burn check's
   Show/Hide still recognises it.
4. **The machine notice names the bed and the camera.** When the opened file has the same profile
   id and name and only its bed size differs, the notice gives both bed sizes. It also says which
   camera calibration is in use until the operator chooses, with the dates of both. The safe choice
   comes first as the primary button: **Keep current machine**, which keeps the current bed and
   calibration. **Use project machine** is second, and the notice says the next change to the
   machine saves that choice. A notice for another machine also names the camera swap. Amendment 3's
   swap is unchanged.
5. **The nudge ring gets the target's advice and is flagged when unhomed.** The nudge setup step
   shows the same home-first advice as the target step, and it advises without blocking (ADR-441
   Amendment 5). The bed frame is remembered as the ring starts burning. For a ring burned earlier,
   the frame at the photo is used. Suppose that frame has no native offset while the calibration's
   frame has one. The result step then says the offset may include where the head was at power-on,
   and asks the operator to home and burn again. If they apply **Fix** anyway, the nudged
   calibration's frame drops its native offset. Once homed, the Camera panel then shows ADR-441
   Amendment 5's note, and a later offset change no longer moves the calibration.

### Consequences

- A canvas target burned through KerfDesk records the frame the rings really burned in, homed or
  not. A target burned elsewhere and then followed by a Machine Setup change must be added again.
  Before this amendment it was silently fitted 10 mm off.
- A head-camera bed picture follows bed corrections, as the live overlay does. It is cleared, with
  a notice, after a change that no translation can follow.
- A nudge made unhomed is no longer silent. The calibration loses the native offset it can no
  longer vouch for, so a later offset change no longer moves the picture until the camera is
  recalibrated homed.
- Evidence: `canvas-target-burn.test.ts` reproduces G6-P2-1 with a rendered photo of the rings and
  the real fit (the three marks now burn within 0.5 mm of where they are drawn).
  `bed-picture-frame.test.tsx` covers G6-P2-3, `ProjectBedReconciliationBanner.test.tsx` covers
  G6-P2-2, and `nudge.test.ts` with `NudgeFix.test.tsx` cover G6-P3-3. This is code and test evidence
  only. No camera, machine or Falcon A1 Pro was used.
