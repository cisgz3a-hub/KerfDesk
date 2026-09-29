## ADR-140 Amendment 1 - Features only the finishing pass reaches follow the depth ladder (2026-09-29)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-09-29

Amends ADR-140's "one finishing pass at the true contour at full depth". The Frame-first Start
contract (ADR-228) is unchanged: nothing here adds a guard or a refusal.

### Context

ADR-140 finishes a profile in one full-depth pass because the roughing passes have already
cleared everything but the allowance beside the wall, so the finishing cutter only takes that
thin skin. The second CNC audit (`docs/audits/2026-09-29-cnc-audit-second-pass.md`, P2-toolpath-1,
high, reproduced) found features where that premise fails. Roughing offsets the drawing by the
cutter radius plus the allowance and finishing by the cutter radius alone, so a hole or slot
between one cutter width and a cutter width plus twice the allowance keeps its finishing path but
loses its roughing path. The same happens to the neck of a shape that narrows to that width.

With a 1/8" (3.175 mm) bit and a 0.5 mm allowance, a 4 mm screw hole or a 3.8 mm slot in a
6.35 mm deep profile was cut by one plunge to Z-6.35 and a full-width cut at the cutting feed. The
layer's 2 mm depth per pass was ignored for that feature and nothing warned. With a 1/4" bit the
window is 6.35-7.35 mm, which includes an M6 clearance hole. When such a hole was alone on its
layer the whole layer was dropped as empty instead, although finishing could cut it. A Wall
finishing recipe already stepped the finishing pass down at its own depth per pass, so the defect
was limited to layers without one.

Shapeoko CNC A to Z ("Feeds and speeds basics") puts depth per pass at 10% to 50% of the end mill
diameter for softer materials; this pass was 200%. Harvey Performance ("Speeds and Feeds 101")
warns that "a chip load that is too large can pack up chips in the cutter, causing poor chip
evacuation and eventual breakage."

### Decision

1. **A finishing path roughing never reached follows the layer's depth ladder.** Beside a roughed
   wall the finishing path lies the allowance away from a roughing path. A finishing path with any
   point farther than one cutter radius plus the allowance from every roughing path of its part
   (`roughingReach`, `src/core/cnc/finish-allowance-coverage.ts`) is cut at the layer's depth
   ladder, the same Z levels the roughing passes use. Every other finishing path stays one
   full-depth pass. The rule is per path: a part's outer wall keeps its single finishing pass
   while a small hole in the same part is stepped down.
2. **A layer with an allowance is no longer dropped just because nothing could be roughed.** When
   the roughing offset leaves no path but the finishing offset does, the finishing paths are cut
   under item 1. A feature narrower than the cutter still produces nothing and is still reported
   by the existing empty-layer and narrow-feature notices.
3. **A Wall finishing recipe keeps its own depth per pass** for every finishing path, as before.
4. The threshold errs toward the ladder. Only very sharp corners (under about 28 degrees with a
   1/8" bit and a 0.5 mm allowance) can move a point that far from roughing; such a path is then
   cut in several passes, which is slower but never cuts more per pass than the layer allows.

### Consequences

- Jobs with such features take longer, because the feature is cut once per depth pass instead of
  once. A job with no such feature or corner emits the same G-code as before.
- Holding tabs on a stepped finishing path are decided per depth, as on roughing passes.
- Job Review does not yet name the features that fell back to the ladder; the G-code shows them as
  extra passes at the roughing depths.

### Verification

`src/core/cnc/finish-allowance-ladder.test.ts` compiles a 40 mm part, 6.35 mm deep at 2 mm per
pass with a 1/8" bit and a 0.5 mm allowance. A 4 mm hole in it is cut at Z-2, -4, -6 and -6.35
while the outer wall keeps its four roughing passes and one finishing pass at Z-6.35; a 3.8 mm slot
is cut the same way; a 4 mm hole alone on an inside-profile layer is cut instead of dropped; a
16 mm hole keeps its single finishing pass; a 3 mm hole still produces nothing. Without the fix the
hole, slot and alone-on-its-layer cases fail. `src/core/cnc/finish-allowance-coverage.test.ts`
covers the reach rule, including the neck between two roughed lobes and a long diagonal roughing
edge. No hardware result is claimed.
