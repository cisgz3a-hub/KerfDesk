## ADR-250 Amendment 3 - A profile lead keeps its whole cutter clear of every part the job keeps (2026-10-21)

**Status:** Accepted; software-verified through emitted G-code and an independent cutter-disk
model, hardware qualification pending. | **Date:** 2026-10-21

This amends ADR-250 (`DECISIONS.md`) and its 2026-09-05 correction. It changes emitted motion in
one case only: a lead whose cutter would reach a kept part now falls back to the straight plunge
it already had for same-operation siblings. The Frame-first Start contract (ADR-565, PROJECT.md
non-negotiable 21) is unchanged. The new Job Review warning is advisory and never refuses Frame,
Start or Save.

### Context

Rolling audit v2, finding 09-P1-1 (`docs/audits/2026-10-21-rolling-v2/09-cnc-core.md`), was
confirmed by the auditor, a refuter and the coordinator. ADR-250's Consequences say a lead "falls
back to a plunge" when it would enter "a disjoint neighbouring part". The code did that only within
one operation:

- `applyProfileLeadPasses` builds its obstacles from `distinctClosedContours(passes)`, the passes
  of the one group it is called for. It is called once per operation, so parts on other operations
  were never obstacles.
- `leadObstacles` drops every contour that encloses this one, because the enclosing contour's
  interior holds this contour's waste. That is true of a part's outer boundary, but the wall of a
  hole a nested part sits in is kept material, and nothing checked the lead against it.

A default 90° arc lead with the tool-radius radius starts one radius out from the toolpath, so
its cutter reaches three radii (1.5 bit diameters) past the part edge. Reproduced on main
`c708073a7` through `emitGcode`, with every Z<0 feed move modelled as a disk of the bit's radius:

- Two operations, 1/8" bit, a 40×30 mm part 4 mm below a 20×10 mm part: the cutter goes
  0.7625 mm into the other part at `G1 Z-1.500 F300` and on every depth pass.
- One operation with a 100 mm part, a 60 mm hole, and a 40×36 mm part 4 mm from the hole's top
  wall: 0.7625 mm into the hole wall. The same with the nested part on its own operation.
- The 1/8" gap sweep gouges below 4.7625 mm (3r), 1.4625 mm at a 3.3 mm gap. A 1/4" bit gouges
  2.525, 1.525 and 0.525 mm at 7, 8 and 9 mm gaps.
- Preflight, the minimum-feature check and Job Review said nothing.

### Decision

1. **Every kept wall in the job is an obstacle.** Before the operations compile,
   `profileLeadJobWalls` (`profile-lead-job-walls.ts`) collects the walls of every output profile
   operation: Outside path, Inside path and On path, from the same line-art-selected contours the
   operation's kerf offset uses, normalised even-odd as the offset normalises them. The collected
   source geometry is reused by the operation's compile, so contours are not collected twice. Each
   wall records the side it keeps: an Outside or On path cut keeps the even-odd bodies (a hole
   keeps the material around it), an Inside path cut keeps the opposite side.
2. **The whole cutter disk is tested, not the centreline.** `leadClearsKeptWalls`
   (`profile-lead-kept-walls.ts`) checks the lead-in and lead-out together against every wall
   whose box comes within the cutter radius. The lead's centreline must stay on the same side of
   the wall as the contour's start, and at least the cutter radius from it, less what an On path
   wall's own cut already removes (its own cut radius). A 0.005 mm tolerance covers the
   offset's 0.001 mm rounding and its 0.005 mm needle-segment collapse, which already let a
   contour ride a few microns inside its own radius. The cutter radius is half the cut width at full depth,
   the width the profile offset uses (ADR-368 Amendment 2).
3. **The hole around a nested part is checked; the boundary around that hole is not.** A wall
   whose kept side already holds the lead's start is skipped. That is the outer boundary of the
   larger part this contour lies in, and its kept material sits behind the hole wall, which is
   checked. For the same reason a lead may still run into the waste slug of a hole that another
   operation cuts with Inside path: the material around that hole is the sheet the part is cut
   from.
4. **When no lead fits, no lead is placed.** The pass keeps the legacy straight plunge on its
   start vertex, the same motion as `shape: 'none'`, and is marked `leadBlocked: true` on the
   `CncContourPass` or `CncPath3dPass`. The existing same-operation sibling fallback now sets the
   same marker. Motion and G-code comments are otherwise unchanged.
5. **Job Review warns; nothing blocks.** `runCncPreflight` reports `cnc-profile-lead-plunge`
   per layer, counted from the markers on the exact compiled Job. The code is not in
   `COMPILE_INTEGRITY_PREFLIGHT_CODES`, so it is a Job Review warning on Start and a post-save
   advisory on Save. Per ADR-565 it never becomes a Start guard.
6. **Existing checks stay.** The bed, own-contour and same-operation sibling checks run first and
   are unchanged. The new check can only remove a lead, so a job whose leads already clear every
   kept part emits the same bytes.
7. `EMITTER_REVISION` advances to `cnc-leads-clear-kept-parts-20261022-v24`, carrying forward
   `marlin-dark-raster-end-20261021-v23` from PR #1353 (ADR-398 Amendment 2).

Not chosen:

- **Testing other operations' toolpaths instead of their walls.** That needs every profile
  operation's offset before any lead is baked, so each would be offset twice, and a miter-joined
  toolpath overstates the cutter's reach at convex corners. The walls are the material the job
  keeps; the disk test against them is exact.
- **Trying a smaller lead or another start point before the plunge.** Either changes the start or
  the lead shape of jobs that a lead does not fit today, and needs its own evidence. ADR-250 names
  the plunge as the fallback.
- **Refusing the job.** A plunge marks a wall; it does not damage another part, and the program is
  still the truthful one. ADR-565 keeps policy findings as warnings.

### Consequences

- A lead never reaches another part across operations, nor the wall of the hole a nested part
  sits in, at any depth. Where the gap is under about three cutter radii on the side the lead
  starts, that contour plunges at its start, and Job Review says so per layer.
- The warning now also covers leads the same-operation sibling check dropped, which were silent.
- The per-layer group builder (`cncGroupForLayerResolvedWithEvidence`) moved from
  `compile-cnc-job.ts` to `compile-cnc-layer-group.ts`, which keeps both files under the
  400-line limit. It gained only the lead-wall argument. The shared side test `segmentsStayOnSide` moved to
  `profile-lead-side-crossings.ts`.
- Limits, found and not changed:
  - An inlay insert's outline is planned inside the inlay compile and is not a wall for other
    operations' leads. The insert's own lead is checked against every other operation's walls.
  - Pockets, engraves, V-carves, drilling and reliefs are not walls. Their material lies on the
    part face, behind a profile wall a lead would meet first.
  - Every cutter is modelled as a cylinder of its full-depth cut width, and every kept part as
    full depth. A neighbour cut shallower than this pass is still treated as a full-depth part.
  - The self-collision fallback (a lead curling into its own contour, which most hole corners
    hit) stays silent.

### Verification

- `emit-gcode-cnc-lead-kept-parts.test.ts` compiles scenes through `emitGcode` and judges the
  emitted program with `cnc-cutter-clearance.test-support.ts`, which models every Z<0 feed move
  as a disk of the bit's radius against the drawn part outlines in machine coordinates. It never
  reads the compiler's obstacle model. It covers:
  - the audit scene across two operations and within one, and the nested part on one operation
    and on two;
  - the 1/8" gap sweep from 3.3 to 6 mm in 0.1 mm steps, with the lead kept from 3r + 0.05 mm
    and warned below 3r - 0.05 mm;
  - the 1/4" bit at 7, 8 and 9 mm (warned) and 9.6 mm (lead kept);
  - an Inside path neighbour (lead kept) and an On path neighbour at 4 mm (lead kept) and 2.5 mm
    (warned).
  On main, six of these fail with the audit's numbers (-0.7625 mm, -1.4625 mm, -2.525 mm, and no
  warning for the one-operation case). With the change every case clears to within -0.005 mm.
- `profile-lead-islands.test.ts` and `profile-lead-clearance.test.ts` now expect a dropped
  sibling lead to equal the unled pass plus `leadBlocked`.
- An emit-hash probe (not committed) emitted 14,400 programs on main `c708073a7` and on the
  change, with the change's own source files swapped back to main's for the main run. The
  matrix covered:
  - one part, a part with a 10 mm or a 4 mm hole, a circle, a star beside an L;
  - two parts above or beside each other, or two circles, at gaps of 2, 3.5, 4, 5, 7, 9, 12 and
    20 mm;
  - a part nested 3.5, 4, 6, 8 or 12 mm from a hole wall, and a 3×3 grid at 4 and 8 mm;
  - one operation, or the first part on its own operation, as Outside/Outside,
    Inside/Inside, Inside/Outside and Outside/On path;
  - 1/16", 1/8" and 1/4" end mills; the default arc, a 3 mm line, a 6 mm 180° arc and None;
    climb and conventional; no tabs, tabs, and a 0.3 mm finish allowance.

  Results:
  - 13,543 programs are byte-identical.
  - All 857 changed programs carry the new warning, and their other preflight findings are
    unchanged.
  - 651 changed programs have only Outside parts and were measured with the disk model above.
    Every one gouged a kept part on main.
  - 179 changed programs have an On path neighbour, measured with that part kept one cutter
    radius inside its line. Every one gouged it on main, and all clear to -0.0005 mm with the
    change.
  - 9 changed programs are an Inside path part with a hole, measured with the sheet outside the
    part and the island kept. On main, a 6 mm 180° lead on the island ran through the outer wall
    into the kept sheet by 0.17 to 3.175 mm, because the outer wall encloses the island and was
    skipped. With the change they clear to -0.0005 mm.
  - The last 18 are a 1/4" Outside part 2 mm from a hole cut with Inside path. Its own toolpath
    already runs inside that hole, closer than a radius to the hole's wall, so no lead can keep
    the radius and it plunges. Its contour cuts that strip of sheet either way.
  - 424 programs keep identical motion and gain only the warning: these are the leads the
    same-operation sibling check already dropped.
  - 456 programs still bring the cutter within a kept part on the change. Each matches the same
    job with Lead None exactly: the parts are closer than the cut width, so the profile itself
    cuts the neighbour. Leads do not cause these.
- No hardware run was made. The change is verified in emitted G-code only.
