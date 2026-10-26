## ADR-441 Amendment 5 - Home before the target, say when it was not, and a target on the canvas (2026-10-25)

**Status:** Accepted. | **Date:** 2026-10-25

### Context

The target runs at Absolute coordinates, which name a fixed place on the bed only once the machine
is homed. Engraved before Home, the rings sit wherever the head was at power-on. The calibration's
bed frame then has no native-to-bed offset. ADR-440 Amendment 1 rightly does not treat an unknown
offset as a change. So once the machine is homed, the overlay can be off by however far that zero
was, and nothing says so. The fixed-camera wizard never mentioned homing; only the head-camera photo
step did. LightBurn's camera alignment likewise expects a homed machine at Absolute coordinates.

Separately, **Engrave target** needs a live connection. An operator looking at the target step while
disconnected saw it greyed out and found no way to put the rings on the board.

### Decision

1. **Advice before the target.** While connected, the target step says to home first on a homing
   machine that is not homed. On a machine without homing, it says the camera lines up only while
   the controller keeps its zero. Advice, not a gate (ADR-228): **Engrave target** stays available.
2. **Said afterwards.** `cameraBedFrameNote` adds a usable note when the calibration's frame has no
   native offset and the frame now has one: the rings were placed before KerfDesk knew where the
   machine coordinates sit on the bed. If the picture is off, home and calibrate again. It is
   appended to a moved-picture note when both apply.
3. **Add target to canvas.** A third button on the target step, available without a connection:
   - It replaces the artwork with the ring target as an undoable project edit, the way the other
     calibration generators do, and asks first when the project has unsaved changes.
   - It locks the rings so a stray drag cannot move them.
   - It sets Start from to Absolute Coordinates, the only mode that burns them where the photo looks.
   - It remembers the layout and bed frame as an engraved target, then minimises the wizard at the
     photo step.
   - It is disabled with a reason while the canvas is in CNC mode, because the rings are a laser
     engraving.
   The operator Frames, reviews and Starts the target like any job.

### Consequences

- An unhomed calibration is no longer silent once the bed position is known. A calibration made
  homed, whose controller settings were only read later, can show the note needlessly; it is
  worded as a condition ("if the picture does not line up").
- Changing Start from to Absolute persists after the target job; the toast says so.
- Code and test evidence only (`camera-bed-frame.test.ts`, `calibration-actions.test.ts`,
  `CameraCalibrationWizard.test.tsx`). No machine or camera was used.
