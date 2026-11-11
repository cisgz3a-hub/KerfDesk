## ADR-228 Amendment 3 - The rotary camera advice follows the axis that turns the part (2026-11-10)

**Status:** Accepted (rolling audit v13 finding Y3-P1-1, confirmed P1 by its independent refuter
and the audit coordinator on main `82a9713a4`; the maintainer's standing instruction to fix
confirmed audit findings). Amends Amendment 2's Decision 2 and 3. Advice only: nothing is refused
at Start (ADR-228). | **Date:** 2026-11-10

### Context

Amendment 2 told a rotary job with camera placement that "the camera picture places the artwork
only along the cylinder", to keep a placed Start from, and never to choose Absolute Coordinates.
Two things made that wrong:

- **A placed Start from moves X too.** Current Position centres the job on the head along the
  cylinder, and User Origin anchors it at the origin. With the artwork at X 250–280 on the picture
  and the head at X 60, the refuter's burn landed at X 45–75: 205 mm along the part, on Y, A and Z
  rotaries alike.
  - Amendment 2's test never saw this: its head X equalled the artwork's centre.
  - Before Amendment 2 the flat-bed sentence ("burns where Current Position puts it, not where the
    artwork sits on the camera picture") was true. Amendment 2 made it false.
- **On A and Z, Absolute no longer turns the part away.** Since ADR-695 (Decision 5), every A or Z
  job first declares the current turn as zero (`G92 A0` / `G92 Z0`). An Absolute job then starts
  on the face under the laser and keeps the picture's X: it is the one mode that burns where the
  picture shows. The advice warned against it, for a reason that holds only on Y.

### Decision

1. **The axis decides** (`rotaryCameraWarning(startFrom, axis)`, from `rotaryAxisOf`).
2. **A or Z.**
   - Absolute Coordinates: no warning, as on a flat bed.
   - Current Position, User Origin or Verified Origin: says the job is put at the head or origin
     along the cylinder, not where the artwork sits on the camera picture. It says that on that
     axis Absolute burns where the picture shows and still starts on the face under the laser
     (every job sets that turn as 0), and to choose Absolute Coordinates.
3. **Y.** No single Start from keeps both the picture's X and the current turn.
   - At Absolute Coordinates the advice says Absolute keeps the picture's X but turns the cylinder
     back to work Y 0, not on the face under the laser. It says: jog the head over the artwork on
     the camera picture, turn the face to the laser, then choose Current Position. It keeps "If no
     rotary is fitted, switch Rotary off beside Start".
   - At a placed Start from it says the mode keeps the turn but puts the job at the head or origin
     along the cylinder too, not where the artwork sits on the picture. It says to jog the head over
     the artwork first (Current Position) or to set the origin there (User or Verified Origin), and
     still not to choose Absolute.
4. **The camera target refuses while the rotary is on.**
   - Its rings belong on a flat sheet on the bed. With the rotary on they would be rebased onto a Y
     rotary's turn, or burned as a line along X on A or Z, where the head's Y is never commanded.
   - **Engrave target** says: "The rotary is on. The camera target is engraved on a flat sheet on
     the bed, so switch Rotary off beside Start, then engrave the target". Nothing streams.
   - Amendment 2 only listed a warning in the target's confirm.

### Consequences

- On an A or Z rotary, a job placed on the camera picture burns where it shows from Absolute, and
  the advice says so.
- On Y, the operator is told the one way to get both the picture's X and the current turn.
- Changing what the picture places along a Y rotary (a camera-aware rotary mode that takes X from
  the picture and the turn from the head) is not done here.
- Code and test evidence only. No rotary or camera was used.

### Verification

- `src/ui/laser/start-job-rotary-camera-placement.test.ts` covers:
  - a Y rotary across Absolute and every placed Start from: never advises Absolute, says the X
    move, and says to jog first;
  - A and Z rotaries: Absolute gets no warning, and every placed mode is told to choose Absolute;
  - the real `emitGcode` with the head at X 260 and the artwork at X 110–130: Absolute burns
    X 110–130, while Current Position burns X 250–270 and is told so.
- `src/ui/camera/calibrate/calibration-actions.test.ts`: the camera target refuses on a Y, A or Z
  rotary and starts no job.
