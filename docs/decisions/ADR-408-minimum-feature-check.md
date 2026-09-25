## ADR-408 - Job Review warns about cut features narrower than the kerf or bit (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This adds warnings only. The Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232
and 237) is unchanged: a completed Frame for the exact reviewed job is still the only ordinary Start
gate, and these findings are Job Review warnings like ADR-246's dot-width advisory in the image
editor. Compile, G-code, bounds and Frame are unchanged.

### Context

A laser Line cut removes a band about one kerf wide centred on the path; a CNC profile or pocket
removes a band one bit diameter wide. Material narrower than that band between two cuts burns away
or is cut away: a stencil bridge breaks and its island falls out, a thin part is lost. A gap
narrower than the band cannot be cut as drawn: on a laser the two cuts merge and the shapes fuse;
on a CNC outside profile or pocket the bit cannot enter it. Traced artwork produces these features
routinely, because the tracer follows ink at pixel scale and the placement decides how wide a
pixel is.

Neither Potrace 1.16 nor LightBurn's Trace Image warns about it (the premise of this leapfrog item;
Potrace's output is unit-free vector outlines, so it cannot know a kerf). KerfDesk already had one related advisory, ADR-246's dot-width
check for Image operations in the image editor (`ui/image-editor/editor-kerf-check.ts`); vector
cuts had none.

What already exists to build on:

- Laser Line operations have `kerfOffsetMm`, the path offset that compensates the beam ("Compensate
  laser beam width on closed Line cuts"). Compile moves each closed path by that amount, so the
  beam's edge lands on the drawn line when it is half the kerf. The device
  profile's laser head may carry `spotSizeMm`. CNC operations resolve their bit with `layerCncTool`,
  which has `diameterMm`.
- Job Review warnings are plain strings in one list (`JobReviewWarnings.tsx`); there is no warning
  location or canvas highlight mechanism, so a finding has to say where it is in words.
- The tracer's centerline stage has an exact Euclidean distance transform
  (`core/trace/centerline/distance-field.ts`), whose value at a pixel is the inscribed radius.

Options for measuring local width, which is twice the radius of the largest disk that fits in the
region at that place:

- A. Rasterise each cutting operation's filled region at a resolution tied to the kerf and read
  the distance transform. Its ridge value is the inscribed radius. Width is quantised to a pixel,
  so at kerf / 4 per pixel a 0.10 mm bridge at a 0.15 mm kerf reads as 0.075 or 0.11 mm depending
  on where the pixel grid falls. The grid scales with the job's area, not its cut length: the owl
  test image placed 300 mm wide is 8,000 x 8,000 pixels at kerf / 4, 512 MB for the Float64 field
  the existing transform returns. Open paths (Centerline traces) have no filled region to
  rasterise, and every corner has a ridge branch whose radius falls to zero, so corners need a
  separate filter.
- B. The same quantity measured exactly on the paths. Two boundary pieces closer than the
  threshold witness a local width when the disk whose diameter is their closest-point chord holds
  no other boundary: that disk is then a maximal inscribed disk and the chord is the local width
  (twice its radius). At an ordinary corner the chord cuts across the corner, the corner's own
  edges enter the disk, and nothing is reported. Cost scales with cut length. Open lines work
  unchanged.

B is chosen: it reports the width the operator drew (0.1 mm, not a pixel step), it needs no
area-sized buffer, and it handles Centerline traces, while measuring the same inscribed-radius
width A would.

### Decision

1. `core/min-feature` checks cutting operations only. `minFeatureTargets`
   (`operation-targets.ts`) reads the artwork exactly as compile flattens it
   (`compilationPolylines`, then the object transform and `toMachineCoords`) for:
   - laser Line operations (after object overrides), against the kerf: twice a non-zero Kerf Offset,
     else the laser head's larger `spotSizeMm` axis, else `DEFAULT_LASER_KERF_MM` = 0.15 mm (a
     typical diode or CO2 kerf in 3 mm plywood or acrylic is 0.1 to 0.2 mm). Parts and gaps are
     both checked.
   - CNC `pocket` and `profile-inside` (areas the bit cannot enter), `profile-outside` (gaps the
     bit cannot fit into) and `profile-on-path` (both), against the operation's bit diameter.

   Fill, Image, CNC engrave, V-carve, drill, inlay and relief operations are skipped. The check reads
   the artwork, not the kerf-compensated path: compensation moves the loss from one side of a cut
   to the other (parts keep their size, holes and gaps shrink) but cannot make a feature finer than
   the beam.
2. `analyzeMinimumFeatures` (`min-feature-analysis.ts`) implements option B:
   - Paths are split into pieces no longer than two thresholds and indexed in a uniform grid
     (compressed rows, cells at least one threshold, at most 1,000,000 cells).
   - A piece pair closer than the threshold is a witness when its closest-point chord's disk,
     shrunk by 5% for polygonised curves, is empty. Parallel pieces use the middle of their overlap,
     so the chord runs through the middle of the strip. Pairs on one path whose boundary distance
     between the chord ends is under 1.45 chord lengths are skipped before the disk test: going
     around an empty disk takes at least half its circumference, pi/2 chord lengths.
   - Material or gap: closed paths fill even-odd. A witness's side comes from one piece's winding and
     the parity of closed paths around that piece's path (one cached ray per path); a chord nearly
     along both pieces falls back to a ray from its midpoint. A witness between open lines is a gap.
   - Witnesses sharing a piece, or on consecutive pieces of one path, are one feature; each feature
     keeps its narrowest witness. Features whose witness chords span less than half the threshold
     are dropped: they are hair spikes and pixel notches the beam rounds off like a corner. A small
     round hole still spans its diameter, so every hole at least half the threshold across is kept.
   - A spike sharper than about 36 degrees is reported as a narrow part: near its tip it really is
     narrower than the kerf.
3. Work is counted, not timed (core is clock-free): `DEFAULT_MIN_FEATURE_BUDGET` allows 500,000
   pieces and 4,000,000 candidate pairs, disk probes and ray crossings, shared by every operation in
   one check (`checkProjectMinimumFeatures`). When it runs out the findings so far are reported and
   the operations not fully checked are named.
4. Job Review (`ui/laser/job-review/min-feature-warnings.ts`) adds one warning per operation and
   kind to the existing warning list, from the exact prepared (output-scoped) project, memoised per
   prepared project because the model is rebuilt at Confirm. Each warning gives the layer, the
   count, the kerf or bit and where the kerf came from, and the narrowest width with its position
   in machine coordinates (the Job size frame for an Absolute job) plus up to two more positions,
   for example (four 10 mm holes with 0.1 mm bridges, Kerf Offset 0.075 mm, front-left origin on a
   400 mm bed): `Layer "Cut": 3 parts narrower than the 0.15 mm kerf (twice its Kerf Offset) — they
   burn away or break; narrowest 0.1 mm at X 25.1 · Y 385 mm; also at X 35.2 · Y 385 mm and
   X 45.3 · Y 385 mm.` A 2 mm slot pocketed with a 3 mm bit reads `Layer "Pocket": 1 area narrower
   than the 3 mm bit (3 mm end mill) — the bit cannot enter it, so it stays uncut; narrowest 2 mm at
   X 11 · Y 385 mm.`
   They never refuse Frame, Start or export.
5. After a vector trace commits (`ui/trace/trace-output-commit.ts`), the new artwork alone is checked
   on the next task, so the dialog closes first, and a warning toast names the operation, counts and
   narrowest width when it has any (`ui/trace/trace-min-feature-notice.ts`). A trace that commits
   to a Fill operation, the default for filled-outline presets, gets no notice until its operation
   is switched to Line.

### Consequences

- Before this ADR no warning existed. Measured after it, Line Art and Centerline traces of the owl
  and hummingbird test images (1,254 x 1,254 pixels) at a 0.15 mm kerf, in a Node harness on a
  shared, loaded laptop (median of three warm runs):

  | Trace, width | Pieces | Work units | Time | Narrow parts (narrowest) | Narrow gaps (narrowest) |
  |---|---|---|---|---|---|
  | owl Line Art, 100 mm | 190,248 | 2,785,484 | 0.75 s | 3,145 (under 0.01 mm) | 2,453 (under 0.01 mm) |
  | owl Line Art, 300 mm | 273,897 | 1,051,407 | 0.37 s | 670 (under 0.01 mm) | 417 (under 0.01 mm) |
  | owl Centerline, 100 mm | 88,485 | 525,327 | 0.20 s | 0 | 156 (under 0.01 mm) |
  | hummingbird Line Art, 100 mm | 114,513 | 1,455,502 | 0.41 s | 1,527 (under 0.01 mm) | 1,766 (under 0.01 mm) |
  | hummingbird Line Art, 300 mm | 173,441 | 591,500 | 0.23 s | 175 (under 0.01 mm) | 246 (under 0.01 mm) |
  | hummingbird Centerline, 300 mm | 101,781 | 257,113 | 0.11 s | 0 | 36 (under 0.01 mm) |

  An earlier, less loaded run of the owl at 100 mm took 0.41 s. The near-zero widths are real
  pinch points where the tracer's outlines meet at a pixel corner, so traces this dense at these
  sizes are genuinely finer than a 0.15 mm kerf.
- Synthetic cases (tests): four 10 mm holes with 0.1 mm bridges at a 0.15 mm kerf report 3 narrow
  parts, narrowest 0.1 mm, positioned on each bridge, whichever way the holes wind; 0.3 mm bridges
  report nothing; two squares 0.1 mm apart report 1 gap of 0.1 mm; a 2 mm by 20 mm slot pocketed
  with a 3 mm bit reports 1 area of 2 mm; plain squares, circles and a 0.5 mm square report nothing;
  a 1,600-square grid finishes within the default budget and a 50,000-unit budget stops early and
  says so.
- The worst case adds up to the budget's cost, under a second, to opening Job Review once per
  prepared job; Confirm reuses the result.
- Findings are text. A canvas highlight for the positions would need a warning-location mechanism
  Job Review does not have.
- Text objects fill nonzero; the check reads every closed path even-odd, which differs only where a
  font's glyph contours overlap.
- Tests: `min-feature-analysis.test.ts`, `project-check.test.ts` (kerf sources, operation
  selection, CNC sides, shared budget), `min-feature-warnings.test.ts` (wording, memo, and a real
  `prepareCurrentStartJob` to `buildJobReviewModel` path) and `trace-min-feature-notice.test.ts`.

Not part of this decision: a canvas overlay of the positions; per-object thickening or a fix-up
action like ADR-246's Thicken; checking Fill hatch spacing or raster dots; a kerf setting separate
from Kerf Offset.
