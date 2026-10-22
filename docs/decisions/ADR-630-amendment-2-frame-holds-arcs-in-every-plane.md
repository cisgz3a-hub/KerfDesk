## ADR-630 Amendment 2 - The Frame holds arcs in every plane (2026-10-22)

**Status:** Accepted. Amends ADR-630 "The Frame" and Amendment 1 items 1 and 9. Keeps PROJECT.md
non-negotiable 21 and ADR-565: the completed Frame stays the only ordinary Start gate. Fixes rolling
audit v2 finding 26-K1 (known item WA-4, 18 K-4). | **Date:** 2026-10-22

### Context

ADR-630 says the external-run envelope "covers rapid, linear and arc moves". The Run review reads the
G-code Inspector's model, and that parser drew only XY-plane (`G17`) arcs. It skipped a `G18` (XZ) or
`G19` (YZ) arc as "not renderable (XY only)", left the position where the arc started, and counted `K`
as a word it does not interpret. GRBL runs arcs in every plane. gnea/grbl `gcode.c` maps `G18` to
axis_0 = Z, axis_1 = X, axis_linear = Y, and `G19` to axis_0 = Y, axis_1 = Z, axis_linear = X. The
centre uses `ijk[axis_0]` and `ijk[axis_1]`, so the offsets are K,I for `G18` and J,K for `G19`.
`motion_control.c` `mc_arc` sweeps in axis_0 and axis_1 only, with the same clockwise test in every
plane, and moves the linear axis evenly.

Since ADR-630 lets an opened file run, the skipped arcs shortened the Frame. The audit measured it
through the real Run chain:

- `G1 X10`, then `G18 G2 X20 Z-1 I5 K0` (or `R5`). The Frame traced X 0..10, while GRBL moves to X20.
- A raster of `G18` arcs from X-25 to X25. The Frame covered X-25..0, half the part.
- A Fusion-style lead-out, `G19 G3 Y40 Z29 J0 K30` after `G1 Y10`. The Frame traced Y 0..10, 30 mm
  short.

The outline size and the bed and no-go checks (Amendment 1 item 2) used the same short envelope. The
review showed only Program Health's generic "Some moves could not be drawn" and, for the I/K form,
"does not interpret K". An R-form arc got no warning that mentioned the Frame. Every other move the
outline leaves out is named as "not in the Frame outline" (Amendment 1).

### Decision

1. **Arcs are read in their plane.** The Inspector's parser draws a `G2`/`G3` in the plane that
   `G17`, `G18` or `G19` selects, on GRBL's axes:
   - `G17`: X,Y with offsets I,J, and Z linear.
   - `G18`: Z,X with offsets K,I, and Y linear.
   - `G19`: Y,Z with offsets J,K, and X linear.

   The XY solve applies to the plane's two axes: the I/J/K centre, the R-form centre (a negative R
   takes the major arc), the radius checks, the full circle and the sweep. The linear axis moves
   evenly along the arc, as `mc_arc` moves it. The arc is drawn and timed like an XY arc, and the
   position advances to its end. An offset outside the plane is ignored, as GRBL ignores it.
2. **The outline holds the arc's exact extent.** As for XY arcs (Amendment 1 item 9), the arc's exact
   box in its plane counts. A `G18` arc adds its X extremes to the Frame envelope, a `G19` arc its Y
   extremes, and both add their Z extremes to the program's bounds. The outline size and the bed and
   no-go checks follow the envelope.
3. **K is an arc offset in the XZ and YZ planes.** On any other line the Inspector still does not
   interpret `K`, and the review still names it.
4. **A move the Inspector still cannot read is named as not in the Frame outline.** Such a move adds
   nothing to the outline: an arc whose radius does not match, an R too small for its chord, an arc
   with neither its plane's offsets nor R, a non-finite target, a canned cycle without R and Z, or a
   Marlin line the Marlin reader cannot place. A controller usually rejects such a line, but its
   limits are not the Inspector's, so it may run it. The review therefore says "The Inspector could
   not read … so it is not in the Frame outline. If the controller runs it, the head still makes
   it." It gives the first line's number in the sent program, where the baseline line comes first.
   This replaces Program Health's "Some moves could not be drawn" in the review. It is a warning,
   not a refusal and not a Start guard (ADR-565). A program whose only motion cannot be read is
   still refused, because no envelope can be built (ADR-630 "Refusals").

### Not changed

- The motion manifest that follows a running job's progress (`core/job`) still reads every arc as
  XY. It builds neither the Frame nor the review.
- The CNC G-code import parser (WORKFLOW.md F-CNC10) still refuses `G18`/`G19` arcs with their line
  number.
- KerfDesk's own output never emits `G18` or `G19`.

### Verification

Unit tests draw `G18` arcs (I/K and R forms, a negative R, a helix) and `G19` arcs (J/K and R forms,
a full circle). Each test compares the program's bounds with an independent reading of `gcode.c` and
`mc_arc`, and checks that `K` counts as interpreted only on a `G18`/`G19` arc. End-to-end tests run the
Run dialog's chain: normalize, inspect from the head with `boundsFromStart`, review with Program
Health's findings, prepare the run, and build the Frame's GRBL jogs. The cases are `G18` arcs in I/K
and R form, a `G18` raster, Fusion-style `G19` lead-ins and `G18` lead-outs in both forms, and the
audit's `G19` lead-out. Each test asserts that the traced rectangle holds every executed point and is
no larger than the motion. Unreadable I/K and R arcs get the "not in the Frame outline" warning and no
refusal. Before this change all eight end-to-end cases failed. No hardware was run.
