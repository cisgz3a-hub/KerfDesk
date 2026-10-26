## ADR-441 Amendment 6 - A target whose anchors are unclear is refused, not labelled wrongly (2026-10-25)

**Status:** Accepted. | **Date:** 2026-10-25

### Context

The matcher tries every L of three solid discs, grows the ring grid from each, and keeps the largest
grid (decision 3). A ring whose hole fills in looks like a solid disc. This happens in a small, dim
or noisy picture, or when the rings are burned nearly solid. Such filled rings form Ls too, and
three faults let a wrong one win:

- `latticeScore` accepted any pair of arms that landed on rings, including skewed pairs such as one
  step and (2, −1). Those span the whole lattice, so they grow a full grid.
- Any L of grid steps grows a grid as large as the true one. On a square layout, an L turned a
  quarter around a filled ring fits the layout exactly.
- Grid size was the only test, so the choice among such Ls was arbitrary.

An audit rendered 120 noisy 640 × 480 photos of a 400 mm target with known cameras. Before this
change, 49 came back as a "mirrored" picture or as a match with every ring labelled wrongly. Two
silent cases were then fitted: one reported 0.41 mm average error for a picture 215 mm out, another
0.63 mm for one 322 mm out. The grade gave no hint.

### Decision

1. **Arms must be grid steps.** An L counts only when its short arm and half its long arm are not
   near parallel (|cos| ≤ 0.9) and form a reduced pair: no combination `h − k·a` or `a − k·h`
   (k = ±1, ±2) is shorter than 0.9 of the arm. No mark may lie within a quarter step of a half step
   along either arm or their diagonals. These are tests on lengths, so a tilted camera's
   perspective does not defeat them.
2. **The grid must fit the layout.** Each grid is grown two cells past the layout's edge, accepting
   only true rings there, never solid blobs. A labelling that finds a ring where the layout has none
   is wrong and is set aside.
3. **The winner must be clear.** It must beat every other fitting labelling that names a ring
   differently, by more than max(2, 5 %) rings.
4. **No disc where a ring belongs.** If the winning grid holds a solid disc on any cell other than
   the three anchor cells, a ring has filled in. The true third anchor may then be such a ring, so
   the photo cannot say which L is right.
5. Any of 2–4 failing gives the new reason `anchors-unclear`. Its message asks for even light, a
   larger picture or a closer camera, a lighter new target, and points at old marks beside the
   target. A mirrored picture is reported only when the clear winner is mirrored.

### Consequences

- In the same 120 photos, no silently wrong match and no false "mirrored" remains. The photos fail
  plainly instead: anchors not found 72, unclear 38, too few rings 9.
- Clean photos are unaffected. The audit's good cases gave the same fit to the last digit: fisheye
  lid camera, Brown-Conrady webcam, camera turned 90° and 180°, a 600 × 300 bed, and a camera
  looking straight down.
- A photo with a single filled ring inside the grid is now refused even when the true anchors are
  all visible. Engraving a lighter target or improving the picture fixes it.
- Code and rendered-photo evidence only (`bed-calibration.test.ts`); no camera was used.
