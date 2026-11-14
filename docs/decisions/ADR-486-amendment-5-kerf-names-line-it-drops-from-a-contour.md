## ADR-486 Amendment 5 - The kerf names line it drops from part of a contour (2026-11-14)

**Status:** Accepted; software-verified through unit and decoded-G-code tests, no material cut. |
**Date:** 2026-11-14

Amends ADR-486 decision 2 and Amendments 1 and 4 (what the kerf offset reports), Amendment 4
decision 3 (DXF's "ends meet" rule) and Amendment 4 decision 4 (what Close Path and Close Paths with
Tolerance say). Advisory only: nothing here refuses Frame, Start or export (rule 7, non-negotiable
21).

### Context

Tools audit T1 (2026-11-13), Close Path area T35, raised three P2 findings, all confirmed by the
refuter. They share one root: the kerf stage dropped a stretch of a closed contour, and nothing
said so.

1. **T35-P2-1.** Close Path closed a stroke whose closing line runs back over its own line. At any
   non-zero Kerf Offset (even 0.001 mm) that stretch was not cut. Decoded at +0.1 mm:
   - a "P" burned 125 mm open and 100.8 mm closed, losing its lower stem;
   - a "b" burned 130 mm and then 100.8 mm, losing its upper stem;
   - a lollipop (a 40 mm stick, a 20 mm loop, the stick back) burned 160 mm and then 80.8 mm,
     losing both sticks.

   Compile diagnostics and Job Review were empty, and the toast said only "Closed 1 path". Single-line
   fonts are hit after Convert to Path: EMS Nixish loses more than 0.3 mm on 41 of 70 glyphs (its
   "H" burns 45.0 mm of 75.0 mm).
2. **T35R-P2-1.** DXF import closed an unflagged LWPOLYLINE lollipop by itself (its ends meet), so
   the same loss happened with no tool used at all.
3. **T35R-P2-2.** A closing line that lands *beside* the stem, within the kerf, leaves a sliver
   that the shrinking side removes. A "P" whose end misses the stem by 0.05 mm burned 99.2 mm of
   124.95 mm at −0.1 mm.

Amendment 4 counted only whole contours with no area. Its fast check returns "encloses area" as
soon as the shoelace area exceeds perimeter × 1 µm (the "P" is 625 mm² against 0.15 mm²). Its
Limits said, verbatim: "A contour that encloses area only in part keeps that part, and the rest is
dropped without a count."

### What LightBurn does

LightBurn's Close Path draws "a new line between the points" when the ends lie within 0.5 mm, so it
would close the lollipop too. Its Kerf Offset "only works with shapes that are closed" and documents
nothing for a stick hanging off a loop. Nothing there warns either. So the burn stays what the offset
makes, and the fix here is to say what it leaves out.

### Decision

1. **The kerf stage compares each contour with its offset** (`core/geometry/dropped-contour-line.ts`,
   `layer-kerf.ts`).
   - Each closed source contour is walked in short steps. A step is cut when an offset line passes
     within three offsets (plus 2 µm) of it: a mitred corner, the furthest a correct offset strays
     from its source, is under two.
   - A run of uncut steps counts when it is at least 1 mm and ten offsets long. A sharp notch that a
     growing offset fills loses well under that unless it is narrower than about 15°.
   - The length is counted once where the contour runs back over itself. A 25 mm stem under its
     closing line reads 25 mm, not the 50 mm of contour over it.
   - This works the same on the growing and the shrinking side, so it also catches a sliver
     narrower than the kerf, and a narrow neck that a shrinking part loses.
   - A contour the offset dropped entirely is left to Amendment 1 (closed up) and Amendment 4 (no
     area), so it is not counted twice.
2. **Job Review names the object and the amount.** The compile adds `kerf-offset-dropped-line` with
   the layer, the kerf and one entry per contour: the object's name (as the Layers panel names it)
   and its dropped length. Diagnostics of one layer and kerf merge, and copies of one object read as
   one. The warning reads, for example:
   "Kerf offset on layer "Cut" cut only part of 1 closed path: about 25 mm of line in "P" is missing
   from the job and will NOT be cut. Where a closed path runs back over its own line, or two of its
   sides come closer than the 0.2 mm kerf (twice its Kerf Offset), it has no inside there to offset.
   Check the preview before running. Break the path open at a node in the node editor so it burns as
   drawn, widen the narrow part, or set Kerf Offset to 0."
   It names up to three objects, longest first, then "N more".
3. **Close Path still closes such a path, and warns.** The ring encloses real area, which Fill and
   the kerf use. The user asked for it, and LightBurn closes it too. Refusing would also leave the
   bowl of a "P" unfillable. So Close Path and both modes of Close Paths with Tolerance close it as
   before, and the toast turns into a warning that adds: "1 closed path runs back over about 25 mm of
   its own line: Kerf Offset cuts only the part that encloses area and leaves that line out, and
   without a kerf it burns twice. Undo leaves it open, burning as drawn."
   - The test is the kerf's own even-odd reading at 1 µm with no offset
     (`retracedLineMm` / `subpathRetracedLineMm` in `zero-area-contour.ts`), with the same 1 mm floor.
   - A pure out-and-back path still stays open (Amendment 4 decision 4).
4. **DXF's "ends meet" rule leaves such a run open.** The file did not ask for a closed contour.
   The importer only guesses that an exporter omitted the flag, and that guess should not make a
   ring that loses line. An unflagged, straight LWPOLYLINE, POLYLINE or SPLINE whose closed ring
   runs back over part of itself stays open and burns as drawn at any kerf. A bulged run and a
   flagged-closed contour are kept as before; decision 2 covers them.
5. **Amendment 4's first limit is replaced.** A contour that encloses area only in part keeps that
   part, and the rest is now counted and named in Job Review.
6. **Nothing else moves.** The kerf offset and its G-code are unchanged. The only G-code change is a
   DXF lollipop that now imports open.

### Limits

- The check measures how close an offset line comes, not which side it is on. A slot that closes up
  next to another contour of the same path, within three offsets of that contour's offset line, can
  read as partly dropped as well as closed up.
- On the shrinking side, a notch sharper than about 15° can be named, because the shrinking part
  loses the notch's tip as a run longer than ten offsets. That is real line the cut leaves out.
- The Close Path toast cannot know the layer's kerf. A closing line a hair beside the stem encloses
  a sliver, so Close Path says nothing, and only Job Review names it once a shrinking kerf drops it.
- DXF bulged runs are judged by their anchors as before, so a bulged lollipop still closes; Job
  Review names its loss.
- Code and test evidence only. No material was cut.

### Tests

- `src/ui/state/partly-retraced-kerf.test.ts` reads every burn back from the emitted G-code with the
  independent decoder in `retraced-paths.test-support.ts`:
  - "P", "b" and lollipop at kerf +0.1, −0.1 and +0.001 after Close Path: the burn is the bowl or
    loop outline (4 × (side ± 2 × kerf)), and Job Review names the object and about 25, 30 and 40 mm.
  - The Close Path and Close Paths with Tolerance toasts warn; a plain open shape keeps the info
    toast; an out-and-back path still stays open with no warning.
  - The near-miss "P": at −0.1 Job Review names about 25 mm; at +0.1 the sliver burns as a thin
    ring and nothing is said.
  - A DXF lollipop imports open and burns 160 mm at ±0.1; a square whose ends meet still closes.
  - No warning for a frame, a frame with a 30° notch, or a circle at +0.1, −0.1 and +0.5, and a
    0.05 mm slot is still reported as closed up only.
  - EMS Nixish "H" and Relief "P" at +0.1, and EMS Casual Hand "P" at −0.1, after Convert to Path
    and Close Path, are named.
- `src/io/gcode/laser-leads-scrap-side.test.ts`: two squares joined by a 0.4 mm neck, cut at
  −0.25 and −0.3 mm, lose the neck's 10 mm walls. Each kerfed operation now names about 9 mm of
  line in "bell" and nothing else.
- `src/core/geometry/dropped-contour-line.test.ts` covers the coverage walk, the once-only count,
  the 1 mm floor and `retracedLineMm`.
