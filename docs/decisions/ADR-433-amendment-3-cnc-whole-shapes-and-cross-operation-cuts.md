## ADR-433 Amendment 3 - On CNC, a shape the bit cannot enter is reported however small, and a cut that reaches another operation's part is reported (2026-10-26)

**Status:** Accepted; software-verified through emitted G-code, an independent cutter-disk model and
the real Job Review model. | **Date:** 2026-10-26

Amends ADR-433 decision 3 (the speck rule) and decision 1 (one operation at a time). Fixes meta audit
v1 M6-P2-2 and M6-P2-3 (`docs/audits/2026-10-23-meta-v1/M6-meta-clean-and-refuted.md`). An
independent refuter and the coordinator confirmed both on main `adf300522`. Emitted motion is
unchanged. The findings stay Job Review warnings, and the CNC part of the fresh-trace notice; nothing
blocks Frame, Start or Save (ADR-565).

### Context

**M6-P2-2.** Decision 3 dropped features whose witness chords span less than half the threshold, as
specks the beam or bit rounds off. A small round hole spans its own diameter, so a hole under half
the bit was dropped too.
- On a CNC Pocket or Inside-profile layer such a hole compiles to nothing: a 2 mm screw hole under a
  1/4" bit is not cut at all.
- Job Review said nothing, while a 3.2 mm hole on the same layer was warned.
- The rule's only stated reason, laser specks, does not fit a whole CNC hole. CNC audit v1 F7-P2-3
  had lowered this to P3 on the contract alone. The meta audit restored it to P2.

**M6-P2-3.** Decision 1 checks one operation at a time.
- Two parts on one Outside profile 2.5 mm apart under a 1/8" bit: the kerf offset merges them. ADR-433
  says the gap stays uncut.
- The same parts on two Outside operations: each operation cuts its own part, and each cut runs
  0.675 mm into the other part.
- Nothing warned. ADR-250 Amendment 3 noted this in its Verification: 456 programs whose parts sit
  closer than the cut width, so "the profile itself cuts the neighbour". It was never tracked as a
  finding.

### Decision

1. **A whole shape is never a speck on CNC** (`min-feature-analysis.ts`, `wholeShapes` on the
   request; `operation-targets.ts` sets it for every CNC target).
   - A closed path whose bounding box is narrower than the threshold in one direction cannot hold
     the bit anywhere: the widest disk inside a shape fits inside its box. Its feature is kept
     however short its witness chords.
   - A path no witness pair finds (a triangle: each pair of its edges meets at a corner) gets one
     feature at the centre of its box. Its width is 4 · area / perimeter, the inscribed circle's
     diameter when that circle touches every edge.
   - The side rules are unchanged:
     - On a Pocket or Inside profile, a hole is an area the bit cannot enter: "the bit cannot enter
       it, so it stays uncut".
     - On an Outside profile, a small hole in a part is a gap the bit cannot fit into.
     - An island inside a pocket is neither, and is not reported.
   - Laser requests keep decision 3 as it was: a sub-kerf speck still burns away like a corner.
2. **A profile cut that reaches another operation's part is reported** (`core/cnc/cnc-kept-part-cuts.ts`,
   `cnc-profile-cuts-kept-part`).
   - After the operations compile, every profile toolpath (Outside, Inside and On path) is held
     against the kept walls of every other profile operation. These are the walls ADR-250 Amendment 3
     keeps leads clear of, now tagged with the operation that keeps them.
   - The test is the leads' cutter-disk test at the full-depth cut width. The cut reaches a kept part
     where its centreline comes closer to the wall than the cutter radius, less what that wall's own
     cut removes. A centreline that meets the wall runs into the part.
   - A wall whose kept side holds the whole toolpath is skipped: that is the outer boundary of a
     larger part the cut lies inside, behind a nearer wall that is checked. Unlike a lead, a toolpath
     can start inside the other part when the parts are closer than the cutter radius, so only a path
     that never meets the wall is skipped.
   - Compile records each pair in `CncCompilationSidecar.keptPartCuts`: the walls reached, the
     deepest reach and its position on the kept part's edge.
   - Preflight words it from the exact compiled Job. For example: `Layer "Plates": its 3.17 mm cut
     reaches 1 part that layer "Brackets" keeps and cuts up to 0.67 mm into it at X 50 · Y 347.5 mm.
     The parts sit closer together than the bit can pass between. Move them further apart.`
   - The position is given only when the program runs where it was compiled (machine coordinates,
     no motion offset), as decision 5 gives positions only for an Absolute job.
   - A derived recovery Job keeps the entries of the layers it still cuts.

Not chosen:

- **Pooling every operation into one ADR-433 analysis.** Operations cut with different bits and
  sides, so one threshold cannot describe them. The compiled toolpath against the kept walls measures
  what the program actually does.
- **Exempting every closed contour from the speck rule on CNC.** A hair spike on a large traced
  outline lies on a closed path too. Only a shape the bit cannot enter anywhere is a whole feature.

### Consequences

- A CNC hole or slot smaller than half the bit, on a Pocket, Inside, On path or straight-inlay layer,
  is now named with its width and position, as larger ones were.
- Traced artwork on a CNC pocket now also names the tiny closed dots the bit leaves out. They are
  counted like any other area.
- Parts on two profile operations closer than either cut can pass between draw one line per cutting
  operation, naming the other layer, how deep the cut goes and where.
- The one-operation layout is unchanged. Its kerf offset merges the parts, so ADR-433's gap line
  stays the only line.
- Pockets, engraves, V-carves, drilling and reliefs are not measured. Their cuts stay inside their
  own regions, and ADR-250 Amendment 3 lists them as not walls. Every kept part is still treated as
  full depth.
- The check runs once per compile, over toolpaths whose boxes come within reach of another
  operation's wall. Depth passes that repeat one XY path are measured once.

### Verification

- `src/io/gcode/emit-gcode-cnc-kept-part-cuts.test.ts` emits the audit scene through `emitGcode`.
  It judges the program with `cnc-cutter-clearance.test-support.ts`, which models every Z<0 feed move
  as a disk of the bit's radius and never reads the compiler's walls. Cases:
  - At 2.5 mm the model measures -0.675 mm. Both operations report it, each within 0.01 mm of the
    model.
  - At 1.6, 2, 3 and 3.1 mm the deepest reported reach equals the model's gouge.
  - At 0.5 and 1 mm each cut runs into the other part.
  - At 3.25, 4 and 8 mm nothing is reported and the model clears.
  - One operation reports nothing, and its program does not gouge.
  - A part 2 mm inside another operation's hole is reported against the hole wall only (1.175 mm,
    both ways).
  - A relative-origin program gives no position.
- `src/core/min-feature/cnc-whole-shapes.test.ts`:
  - A 2 mm hole under a 1/4" bit compiles to no passes and is reported on Pocket and on Inside.
  - Holes of 1, 2 and 3 mm are each reported, narrowest first.
  - A 3-4-5 mm triangle reports 2 mm.
  - An island and a freed part report nothing; a 2 mm hole in an Outside plate reports a gap.
  - A 0.05 mm laser speck is still dropped.
- `src/ui/laser/job-review/cnc-part-size-review.test.ts` runs `prepareCurrentStartJob` and
  `buildJobReviewModel`. A 1 mm hole beside a 10 mm one shows `1 area narrower than the 3.17 mm bit …
  stays uncut; narrowest 1 mm at X 150.5`. Parts 2.5 mm apart on two layers show the
  cross-operation line for each layer.
- No hardware run was made.
