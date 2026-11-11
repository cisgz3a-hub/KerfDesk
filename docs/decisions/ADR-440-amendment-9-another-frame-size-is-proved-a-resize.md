## ADR-440 Amendment 9 - A frame of another size is used only once it is shown to be a resize (2026-11-10)

**Status:** Accepted (rolling audit v13 finding Y1-P1-1, the re-rating of KNOWN #1546 architecture
item 5 by the area's independent refuter, confirmed by the audit coordinator on main `4c4b98fd0`;
the maintainer's standing instruction to fix confirmed audit findings). Amends ADR-440 Decision 5.
It refuses camera placement for a picture that cannot be placed truthfully; it adds no Frame or
Start gate (ADR-228). | **Date:** 2026-11-10

### Context

Decision 5 used the lens scaled to any frame of the calibrated shape (`lensForFrame`). The binding
check refused another size only for `crop-and-scale` captures. For a USB source (`resizeMode:
'none'`) and a phone or machine-JPEG source (`unknown`), a same-shape frame was always treated as a
resize.

A camera can deliver a smaller frame of the same shape by cutting out the middle of its sensor
instead of shrinking its whole view, and the frame's size cannot tell the two apart. In that case
the scaled lens describes the wrong rays:

- The refuter's 1080p calibration used on a 720p sensor crop drew the overlay 62 mm off on the
  target and 117 mm on the bed, with no notice. The auditor's renderer gave 60 mm.
- In this amendment's test, a 640 × 360 centre crop of a 1280 × 720 calibration reads bed points
  more than 30 mm off through the scaled lens (389 mm at the far corner).

USB asks for `ideal` 1920 × 1080 (`web-camera.ts`), so a camera that cannot give it falls back to
another mode silently. Phone and JPEG sources serve whatever size their app is set to.

ADR-440 §5 already says "a changed crop is reported and not drawn or traced". A sensor crop is a
changed crop that was not reported.

### Decision

1. **Another size is not placed until it is proved a resize.**
   - `cameraModelForFrame` returns an issue for any frame whose size differs from the
     calibration's, until this session has proved that size a resize for that calibration. A
     frame of another shape still gets the existing shape message.
   - The notice says the picture is W × H, not the size it was calibrated at. It explains that a
     camera can cut out part of its view instead of shrinking it, and names the remedies:
     - set the camera back to the calibrated size;
     - use Check camera with the target on the bed;
     - calibrate again.
   - A fixed camera is also checked automatically, so the notice is usually brief.
   - The calibrated size itself needs no check.
2. **Proof from the kept view.**
   - A fixed camera keeps a view of its surround when its calibration is known good (ADR-663
     Amendment 3). The moved check runs when the camera starts and on each held picture.
   - It compares a frame of another size with that view first, over the surround and through the
     lens scaled to the frame.
   - A resize shows the same view: a match scoring at least 0.8, within one thumbnail pixel, is
     recorded as `resize`.
   - A crop shows a magnified view, and a camera that also moved shows a shifted one. Anything else
     is recorded as `differs`, and the notice then says the picture does not show the calibrated
     view: "Set the camera back to … or calibrate again at this size".
   - With too little surround to compare, nothing is recorded.
3. **Proof from the target.**
   - Check camera re-detects the target's rings in the new photo. It now measures the saved
     calibration at an unproved size (`rescale: 'measuring'`) instead of refusing it.
   - When the saved model still places the rings within the "unchanged" allowance (0.3 mm, or 1.5 ×
     the calibration's own RMS), the size is recorded as `resize`; otherwise it is recorded as
     `differs`.
   - This is the route for a head camera, which keeps no view.
4. **Everywhere a frame is placed.**
   - The gate sits in `cameraModelForFrame`, which every consumer uses: the overlay, trace, Find
     pieces, the moved check, the nudge fix, job watch, and print-and-cut.
   - The head-camera stitch, which reads `lensForFrame` directly, checks the same verdict before
     placing its pictures.
   - The overlay redraws a held picture when a size is proved.
5. **Session-only.**
   - Verdicts are kept per calibration (its `calibratedAt`), calibrated size and frame size, for
     this session. A new calibration starts fresh.
   - Nothing is saved to the project or profile.
   - USB still asks for 1920 × 1080 as `ideal`, not `exact`, so a camera that cannot give it still
     opens.

### Consequences

- A camera whose resolution changed under it is no longer placed silently with the wrong rays.
- A true resize of a fixed camera is placed again at its first check, a few seconds after the
  camera starts or at the next Refresh picture.
- A head camera at a new size needs Check camera, or its calibrated size.
- A fixed camera with no kept view, or a plain surround, needs Check camera or its calibrated size.
- Code and rendered-test evidence only. Whether real UVC webcams or phone apps crop at a lower
  same-shape mode was not established (the refuter could not check it either). The gate does not
  depend on it.

### Verification

`src/ui/camera/frame-rescale-check.test.ts` renders the bed and surround through the fixture lens.
It checks that:

- a 640 × 360 resize of a 1280 × 720 calibration is proved from the kept view, whatever is on the
  bed;
- a same-shape centre crop of the sensor is found to differ;
- the scaled lens puts the crop's bed points more than 30 mm off;
- `cameraModelForFrame` refuses an unproved size, places a proved one with the scaled lens, keeps
  the calibrated size working, and checks each calibration separately;
- Check camera's ring measurement records `resize` or `differs`;
- the real moved check proves a resized held picture, and refuses a cropped one, on its own.

`WorkspaceCameraOverlay.test.tsx` shows a resized still refused until proved, then drawn with the
scaled lens.
