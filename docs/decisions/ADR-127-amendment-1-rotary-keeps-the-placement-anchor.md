## ADR-127 Amendment 1 - An active rotary keeps the placement anchor, and checks Y only by its extent (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

Amends ADR-127's Decision bullets "Both rebase Y to 0" and "Bounds preflight swaps bed height for
the one-revolution wrap limit". The scale factors, the wrap limit, reverse for Absolute jobs, and
the rule that only emitted motion is scaled are unchanged.

### Context

ADR-127 rebased every rotary job so its lowest Y sat at work Y 0, because "rotation is relative".
That holds for an Absolute job, whose flat-bed Y means nothing on a cylinder. It does not hold for a
placed job. Current Position, User Origin and Verified Origin put the anchor on a work position
that already names the cylinder's turn, and the rebase threw that position away:

- A chuck rotary (360 mm per turn, Ø60) with the cylinder at work Y 80 and a 40 × 20 mm job from
  Current Position, centre anchor: the program turned the cylinder back about 80 mm to work
  Y 0..38.2, burned there, and parked at Y 80. The same job on the flat bed burns at Y 70..90.
- User Origin front-left and back-left gave byte-identical output.
- The finish already used the anchor (`finishOptionsForJobOrigin` parks a Current Position job at
  its start), so the job's own park disagreed with its burn.

LightBurn's rotary G-code page recommends Current Position for rotary work and says output is
"centered around the starting position of the laser head". ADR-493 items 2 and 5 already describe
rotary Y as "rotation from the job's own start".

Rolling audit v2 03-P2-3 found this on 2026-10-21; meta audit v1 M2 re-checked it on main on
2026-10-23. Controller audit v3 D3-P3-2 found the matching preflight half: positional bounds
checks compared rotary Y with `[0, wrap]`, so a trusted work offset or an earlier rotation gave
false out-of-bed warnings. Keeping the anchor makes non-zero rotary Y the normal case, so that half
is fixed here too.

### Decision

1. **Placed jobs keep their anchor.** Preparation records `Job.rotaryAnchorY` on a laser job when
   the rotary applies and the placement is Current Position (the head's work Y), User Origin or
   Verified Origin (work Y 0). `withRotaryAnchor` in `core/job/rotary-job.ts` is the only writer,
   and `completePreparedOutput` calls it last, after leads.
2. **The rotary scales around the anchor.** `applyRotaryYScale` maps a placed job's Y to
   `anchor + (y − anchor) × scale`. With Reverse direction it maps to `anchor − (y − anchor) ×
   scale`, mirroring about the anchor, so the anchor still burns where the cylinder is and the
   design comes off the part the same way as on an unreversed rotary. A job without an anchor
   (Absolute, and every job prepared before this change) keeps ADR-127's rebase to Y 0 and its
   `[0, extent]` reverse window. One map serves cut, fill, raster bounds, contour-entry bounds and
   `restoreRotarySurfacePoint`, so the canvas Frame outline inverts the emitted mapping exactly.
3. **Y is checked by its extent.** With the rotary on, `runPreflight`'s bounds check keeps the bed
   for X (by position with a trusted offset, by span without one) and drops Y from it. A separate
   check (`core/preflight/rotary-bounds.ts`) warns `out-of-bed` when the program's own motion spans
   more Y than one turn. The span leaves out the unknown start point, which on a rotary is the
   cylinder's current turn. The Ruida export uses the same `runPreflight`.

### Consequences

- A rotary job from Current Position burns around the head and returns there; User Origin anchors
  differ as they do on the flat bed. Frame, the estimate and the canvas outline all read the same
  machine-space job, so the Frame traces the new position before Start.
- Absolute rotary output is byte-identical. Placed rotary output moves; placed flat-bed output
  is unchanged (no anchor is recorded without an active rotary).
- A placed rotary job can now command negative work Y (an anchor at the back edge, or a centre
  anchor near Y 0). Rotary Y has no rails, so this is not a bed violation and no longer warns.
- Not changed here: D3-P3-1 (no-go zones are still checked against rotary Y) and the jog half of
  D3-P3-2 (the jog bounds warning still compares MPos Y with the wrap). Both stay open follow-ups.
- Like ADR-127, physical rotary output is unit-tested only; a bench pass on a real rotary remains
  operator-owned.

### Verification

- `src/io/gcode/emit-gcode-rotary-placement.test.ts`, failing before this change:
  - Current Position at work Y 80, centre anchor, burns Y 80 ± 10 × scale and parks at Y 80
    (main burned Y 0..38.2);
  - User Origin front-left burns Y 0..38.2 and back-left Y −38.2..0, with no out-of-bed warning;
  - Reverse direction mirrors a front-left job about the origin;
  - Absolute still burns Y 0..38.2;
  - a trusted offset of Y −50 gives no out-of-bed warning (D3-P3-2), and a placed job taller than
    one turn still warns.
- The existing rotary suites (`emit-gcode-rotary*.test.ts`, `rotary-transform*.test.ts`,
  `rotary-job.test.ts`, Ruida, canvas Frame perimeter and every other test naming the rotary)
  pass unchanged, including "refuses a job taller than one revolution".
- Code and test evidence only. No rotary was run.
