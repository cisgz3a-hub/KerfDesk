## ADR-441 Amendment 10 - A canvas target is calibrated only on rings seen to burn at Absolute Coordinates (2026-11-10)

**Status:** Accepted (rolling audit v13 finding Y3-P1-2, confirmed P1 by its independent refuter
and the audit coordinator on main `82a9713a4`; the maintainer's standing instruction to fix
confirmed audit findings). Amends Amendment 5 Decision 3 (the canvas target sets Absolute
Coordinates) and ADR-327 item 4 (Set origin upgrades Absolute to User Origin). Job Review only
warns (ADR-228); the calibration photo refuses, as it already did for a target whose bed frame
changed (ADR-440 Amendment 5). | **Date:** 2026-11-10

### Context

**Add target to canvas** sets Start from to Absolute Coordinates, "the only mode that burns them
where the photo looks". Nothing kept it there:

- **The routine Set origin flipped it silently.** Set origin upgrades Absolute to User Origin
  (ADR-327 item 4), and its toast said only "Origin set to current head position (G92)". A diode
  user who adds the target and then sets the origin at the sheet corner burns it from User Origin
  without touching Start from.
- **The photo step didn't object.** The burn of a canvas target is stamped only at Absolute
  (`stampCanvasTargetBurn`), and an unstamped target was still calibrated on from its remembered
  layout. The step refused it only when the bed frame had changed since.
- **The calibration graded the shifted target as good.** The refuter's rings shifted 26.5 and 43.1
  mm were found 35/35 at the same RMS as the control and given the same grade. Every later camera
  placement was then off by the whole shift (26–43 mm measured; 3.6–70.7 mm in the audit).
- **Nothing warned on a first calibration.** Job Review's camera advice needs the placement latch,
  which a first calibration cannot have.

### Decision

1. **Set origin keeps Absolute while the canvas target's rings are on the canvas.**
   - `placementAfterSetOrigin` leaves Absolute in place when the scene holds the remembered canvas
     target's rings, unmoved. Rings that were moved are ordinary artwork again, and get the usual
     upgrade.
   - It now reports what it did. The toast says "Start from stays Absolute Coordinates: the camera
     target on the canvas burns where the calibration photo expects it only there". After an
     ordinary upgrade it says "Start from is now User Origin", where it used to say nothing.
   - The persistent-origin button's toast does the same. The phone's Set origin follows the same
     rule.
2. **Job Review warns** when a Start streams the canvas target's rings from another Start from:
   - the Start snapshot carries `cameraTargetOnCanvas` (read on the main thread, where the target
     memory lives);
   - the warning says these are the camera calibration target's rings, which the photo reads as
     burned where the target put them, which only Absolute does, and to choose Absolute;
   - it shows without the camera placement latch.
3. **The burn is remembered either way.**
   - A Start that streams the rings at Absolute stamps the burn as before, and clears any earlier
     off-Absolute note.
   - A Start from Current Position, User Origin or Verified Origin is remembered as `burnedFrom`.
4. **The photo step refuses rings not seen to burn at Absolute.**
   - A canvas target with `burnedFrom` is refused, naming the mode: "This target's rings were
     burned from User Origin, not Absolute Coordinates, so they are not where the target put them
     on the bed … Add the target to the canvas again and Start it at Absolute Coordinates, or use
     Engrave target".
   - A canvas target with no burn seen at all is refused with "KerfDesk has not seen a Start burn
     this target at Absolute Coordinates …", or with the existing bed-frame message when Machine
     Setup changed since it was added.
   - **Engrave target**, which streams at Absolute itself, is unchanged.

### Consequences

- The routine Set origin no longer moves the camera target off its layout, and a target burned off
  Absolute anyway cannot become a calibration that is wrong everywhere.
- A canvas target added and then photographed without a Start that KerfDesk saw now needs that
  Start, or Engrave target. That includes a target remembered by a version before this change.
- Rings burned off Absolute could in principle be relabelled from the job origin used. That is not
  done: the photo refuses, and the operator burns again at Absolute.
- Code and test evidence only. No camera or machine was used.

### Verification

- `src/ui/camera/calibrate/canvas-target-burn.test.ts`:
  - Current Position and User Origin burns are remembered and refused with the mode named;
  - a following Absolute burn stamps the target, clears the note and lifts the refusal;
  - a target not yet burned is refused, and a bed-frame change keeps its own message.
- `src/ui/laser/camera-target-start-from.test.ts`:
  - Set origin keeps Absolute with the target on the canvas, upgrades without it or once the rings
    were moved, and its toast says which;
  - Job Review warns at User Origin through the real `machineSnapshot` and `demotedPolicyWarnings`,
    and not at Absolute.
- `OriginRow.document-owner.test.tsx` accepts the toast's new Start-from sentence.
