## ADR-449 Amendment 2 - A head camera's picture keeps its heights, and its calibration its Z (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

Fixes rolling audit v4 H6-P1-2 and H6-P2-1 (P1 after its refuter),
`docs/audits/2026-10-27-rolling-v3/H6-camera-placement.md`. Unit-tested with the real stitch, warp
and projection on ray-cast frames; not tried on a real head camera.

### Context

The Consequences of ADR-449 put two duties on the operator that the app never stated:

- "The joined picture is flattened at the material height set when it was taken. Changing the
  height afterwards needs a new capture."
- "A head with a moving Z carries the camera up and down with it. The calibration holds at the Z
  it was taken at; after changing Z, return it there or calibrate again."

Nothing in the Camera panel, the captures or WORKFLOW F-CAM12 said either. The joined picture was
also flattened at the material height only. The live overlay and Trace from camera flatten each
height area (ADR-441 Amendment 2) at its own height, and the **Raised objects** fold is offered for
a head camera too. With the refuter's camera (60 mm up, fx 500, 640 × 360 px), a mark 15.8 mm from
the lens axis was misplaced as follows:

- **On a 20 mm box on a 3 mm sheet, with the box's height area set:** stitched 6.72 mm off. The
  live warp with the same area was 0.00 mm off.
- **On a 6 mm sheet, captured at 0 mm and then Material height set to 6:** 1.75 mm off, with no
  notice.
- **With the head raised 6 mm:** the live overlay was 1.43 mm off. After autofocus on a 6 mm
  sheet, setting Material height to 6, as its tooltip asks, gave 1.64 mm off.

Each of these moves the burn by the same amount once artwork is placed on the picture. The
calibration recorded the head's X and Y, never its Z.

### Decision

1. **Stitched with the height areas.** **Capture here** and **Capture selection / bed** flatten
   each picture at the material height and each height area at its own, as the live overlay does.
   The joined picture keeps both. On the canvas the areas are outlined over it, as over the live
   picture.
2. **Cleared when the heights change.** A joined picture has no camera left to flatten it again.
   Once the material height, or a height area over the pictured part of the bed, differs from the
   ones it was flattened at, it is not drawn, it is cleared, and a notice says "The bed picture was
   cleared: it was flattened at another material height or other raised objects … Capture the bed
   again." An area elsewhere on the bed changes nothing. The burn check's picture (ADR-490) is
   flat in the same way and follows the same rule. This sits beside the bed-frame rule of ADR-440
   Amendment 5 in `bed-picture-frame.ts`.
3. **Z recorded with the calibration.** The head mount gains `headZAtCalibrationMm`: the machine Z
   at the calibration photo (MPos, or WPos plus WCO, as the status panel shows). A **Check camera**
   photo goes through the same step, so a calibration saved from it records its Z too. The head
   position the camera reads now carries Z with X and Y.
4. **Refused away from that Z.** Nothing in KerfDesk knows which way a laser's Z points, so the
   model is not moved by the Z difference. Instead, a head camera whose Z is more than 0.2 mm from
   its calibration's is not used: no overlay, Trace from camera, Find pieces or capture. Raising a
   camera h mm above the material by dz moves a point r mm from the lens axis by about r·dz/h. With
   the refuter's camera, 0.2 mm keeps that under 0.15 mm at the corner of the clear view, below a
   calibration's own error. The panel says "The head is at machine Z … but this camera was
   calibrated with it at Z … Move Z back to … mm, or calibrate the camera again at this height."
   **Capture** refuses with the same words.
5. **The rule is said.** While a head camera is in use, the panel states its Z: "Calibrated with
   the head at machine Z 12.30 mm. After autofocus or a Z move, the camera picture is not used
   until Z is back there or the camera is calibrated again." A calibration saved before Z was
   recorded is used at any Z, as before, and the panel states the rule and that a new calibration
   records Z.

### Consequences

- Artwork placed on a raised object in a joined picture burns where the picture shows it, and a
  height typed after a capture can no longer leave the picture silently wrong.
- After autofocus the head camera stops until Z returns or a new calibration is made. That can be
  slower, but it is never silently off.
- Z is the controller's machine Z. If Z is not homed, the same number after a power cycle may be
  another physical height. KerfDesk cannot see that, as it cannot for X and Y without homing.
- Nothing new gates Frame, Start or output (ADR-228). The completed Frame stays the placement
  proof.
- WORKFLOW F-CAM12 describes both edges. Neither is tried on a real head camera.
