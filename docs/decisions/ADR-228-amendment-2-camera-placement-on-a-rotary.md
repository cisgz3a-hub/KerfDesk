## ADR-228 Amendment 2 - Camera placement on a rotary never advises Absolute Coordinates (2026-11-09)

**Status:** Accepted (rolling audit v11 finding W4-P2-1, rated P1 by its independent refuter; the
maintainer's standing instruction to fix confirmed audit findings). Amends Amendment 1's Decision
and adds a third exception beside ADR-654 Amendments 3 (Place Board) and 4 (registration jig).
ADR-127 and its Amendment 1 are unchanged. | **Date:** 2026-11-09

### Context

Amendment 1 made Job Review say, while camera placement is on at a relative Start from: "Choose
Absolute Coordinates to burn it where it is placed". That holds on a flat bed, where the camera
picture shows bed positions. It does not hold on an active rotary:

- ADR-127 rebases an Absolute rotary job so its lowest Y sits at work Y 0. ADR-127 Amendment 1 keeps
  the anchor only for placed jobs, because Current Position, User Origin and Verified Origin name
  the cylinder's turn and Absolute does not.
- In the refuter's repro (chuck, 360 mm per turn, Ø60, a 20 × 20 mm square, head at work Y 80,
  Current Position), Job Review advised Absolute. Following that advice moved the burn from Y
  60.9–99.1 to Y 0–38.2: 60.9 mm of rotary Y, which is 60.9° of turn, or 31.9 mm of surface on Ø60.
  After the switch no warning remained.
- Neither the preview nor the canvas Frame outline shows the shift. Both are surface-true by design
  (`rotary-job.ts`), so at Absolute the outline sits on the artwork placed on the camera picture,
  and the canvas agrees with the wrong advice. Only the physical Frame turns the cylinder to Y 0.
- The camera target compiles at Absolute with placement forced on (`transient-camera-job.ts`). If
  the Rotary switch is left on, its rings rebase to Y 0 (roller 0–129.6 instead of 135.2–264.8),
  and nothing warned.

**Ground truth.** LightBurn, *Rotary Mode — GCode*
(https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/RotaryModeGCode/, fetched
2026-11-08) says Current Position is "the best Start From mode to use when working with a rotary".
LightBurn's *Camera Alignment* page
(https://docs.lightburnsoftware.com/latest/Reference/Cameras/Alignment/, fetched 2026-11-08) tells
users to set Start From to Absolute Coords, and has no rotary exception. **LightBurn's two pages
conflict on a rotary.** KerfDesk follows the rotary guidance, because Absolute is the mode that
loses the cylinder's turn (ADR-127 Amendment 1).

### Decision

1. **The rotary comes first.** When `rotaryAppliesTo(project.device, project.machine)` holds and
   camera placement is on, `cameraPlacementStartFromWarning` gives the rotary wording
   (`rotaryCameraWarning`) in place of the flat-bed, Place Board and jig wording. A registration
   jig's outline warning (ADR-057 Amendment 6) still comes before it, as before.
2. **It never advises Absolute Coordinates.** At a placed Start from it says the camera picture
   places the artwork only along the cylinder, and that this Start from sets where the job burns
   around the cylinder: on the turn under the laser now (Current Position), or on the turn at the
   User or Verified Origin. It says to keep that Start from and not to choose Absolute Coordinates,
   which turns the cylinder back to work Y 0 before burning.
3. **Absolute is warned about.** With camera placement on and Start from at Absolute
   Coordinates, Job Review now warns. Start resolves Absolute to no `jobOrigin`, so that case is
   included. The warning says Absolute turns the cylinder back so the job starts at work Y 0, not on
   the face under the laser, and that neither the preview nor the canvas Frame outline shows that
   turn. It says to choose Current Position (or User Origin), turn the face to engrave under the
   laser, and watch the Frame. It ends: "If no rotary is fitted, switch Rotary off beside Start
   first".
4. **The camera target gets the same warning.** It reads Job Review's warnings into its confirm
   before engraving. With the Rotary switch left on, that confirm now lists the Absolute rotary
   warning, which says to switch Rotary off.
5. **Advice only.** These are Job Review warnings. Frame and Start are unchanged, and nothing is
   refused (ADR-228, ADR-565). Without an active rotary (switch off, invalid measurements, or a CNC
   project), every case keeps its earlier wording.

### Consequences

- A rotary operator who follows Job Review keeps the turn they set up, as LightBurn's rotary guide
  advises.
- The phone and MCP Starts read the same Job Review warnings through `machineSnapshot`, so they give
  the same advice.
- WORKFLOW F-CAM2 lists the rotary wording beside the Place Board and jig ones.
- Not changed: the camera picture still does not place along the circumference (no camera code
  reads the rotary), and the canvas Frame outline stays surface-true.

### Verification

`src/ui/laser/start-job-rotary-camera-placement.test.ts`:

- The full rotary × camera × Start from matrix through the real Job Review entry,
  `demotedPolicyWarnings`. Start from covers Absolute both as Start resolves it (no `jobOrigin`)
  and given explicitly, plus Current Position, User Origin and Verified Origin. A rotary switched
  off, or set up on a CNC project, gives the flat-bed wording.
- Place Board and jig layouts on a rotary.
- `emitGcode` repro: Current Position at work Y 80 burns Y 60.9–99.1, and Absolute burns Y 0–38.2.
- The real `prepareStartJob` at Absolute and at User Origin.
- The camera target's own `prepareStartJobSnapshot` call (Absolute, placement forced on,
  `requireFrame: false`).

On main's code, 10 of its 26 cases fail: every rotary case. The flat-bed cases and the emit repro
pass. Code and test evidence only. No rotary, camera or other hardware was run.
