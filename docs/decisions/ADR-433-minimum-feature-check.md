## ADR-433 - Job Review warns about cut features narrower than the kerf or bit (2026-09-25)

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
Potrace's output is unit-free vector outlines, so it cannot know a kerf). KerfDesk already had one
related advisory, ADR-246's dot-width check for Image operations in the image editor
(`ui/image-editor/editor-kerf-check.ts`); vector cuts had none.

What already exists to build on:

- Laser Line operations have `kerfOffsetMm`, the path offset that compensates the beam ("Compensate
  laser beam width on closed Line cuts"). Compile moves each closed path by that amount, so the
  beam's edge lands on the drawn line when it is half the kerf. The device profile's laser head may
  carry `spotSizeMm`. CNC operations resolve their bit with `layerCncTool`, which has `diameterMm`.
- A laser Line operation is not always a cut. Centerline and Edge traces land on Line operations
  by default, and Line is how line art is scored or engraved. Kerf Offset, tabs and more than one
  pass are the settings only a through-cut uses. ADR-246's check follows the same principle: it
  runs only once the operator has set a positive dot-width correction.
- CNC profile cuts machine only one edge of a traced double-line ring whose edges are within one
  bit diameter (ADR-218, `lineArtContoursForLayer` in `compile-cnc-layer-passes.ts`).
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
     both checked. Objects are grouped by kerf, kerf source and cut intent, so a warning's note
     about where the kerf came from is true for every object in it.
   - CNC `pocket` and `profile-inside` (areas the bit cannot enter), `profile-outside` (gaps the
     bit cannot fit into) and `profile-on-path` (both), against the operation's bit diameter. The
     paths are the ones compile machines: the layer's contour pool passed through compile's own
     `lineArtContoursForLayer`, now exported for this, so a traced stroke band whose second edge
     compile drops is not reported. The pairing sees every object, as in compile, before a
     fresh-trace check limits the result to the new object.

   Fill, Image, CNC engrave, V-carve, drill, inlay and relief operations are skipped. The check reads
   the artwork, not the kerf-compensated path: compensation moves the loss from one side of a cut
   to the other (parts keep their size, holes and gaps shrink) but cannot make a feature finer than
   the beam.
2. A laser Line operation is a declared cut only when its effective settings have a non-zero Kerf
   Offset, tabs, or more than one pass (`laserCutIntent`). Otherwise its findings are assumed: the
   operation may equally score or engrave. A laser head's spot size sets the width, not the intent:
   it says how wide the beam is, not whether this operation cuts through, and catalogue profiles
   fill it in without the operator measuring anything. CNC profiles and pockets are always
   declared cuts.
3. `analyzeMinimumFeatures` (`min-feature-analysis.ts`) implements option B:
   - Paths are split into pieces no longer than two thresholds and indexed in a uniform grid
     (compressed rows, cells at least one threshold, at most 1,000,000 cells). A closed outline
     stacked exactly on an earlier one (the same vertices from any start, either way round) is
     dropped first: filled even-odd it would cancel its twin and turn one part into a phantom gap,
     while physically it cuts the same line again.
   - A piece pair closer than the threshold is a witness when its closest-point chord's disk,
     shrunk by 5% for polygonised curves, is empty. Parallel pieces use the middle of their overlap,
     so the chord runs through the middle of the strip. Pairs on one path whose boundary distance
     between the chord ends is under 1.45 chord lengths are skipped before the disk test: going
     around an empty disk takes at least half its circumference, pi/2 chord lengths.
   - Material or gap: closed paths fill even-odd. A witness's side comes from one piece's winding and
     the parity of closed paths around that piece's path (one cached ray per path); a chord nearly
     along both pieces falls back to a ray from its midpoint. A witness between open lines is a gap.
     A ray counts crossings only with the closed paths whose bounding box holds its start (found
     through a coarse grid of path boxes), since no other path can change the parity, and takes the
     cheapest exact route: those paths' own segments, or the grid row towards whichever side of
     their boxes is nearer. Every box, cell and edge it touches is counted as work.
   - Witnesses sharing a piece, or on consecutive pieces of one path, are one feature; each feature
     keeps its narrowest witness. Features whose witness chords span less than half the threshold
     are dropped as specks (hair spikes and pixel notches the beam rounds off like a corner) unless
     they are pinches: a witness between two different paths, or between two points of one path at
     least two thresholds apart along it. Two holes or two parts meeting tip to tip span one chord
     whatever the pinch width, so without this exception every pinch narrower than half the kerf
     was hidden while wider ones were shown. A small round hole spans its diameter, so every hole
     at least half the threshold across is kept too.
   - A spike sharper than about 36 degrees is reported as a narrow part: near its tip it really is
     narrower than the kerf.
4. Work is counted, not timed (core is clock-free): `DEFAULT_MIN_FEATURE_BUDGET` allows 500,000
   pieces and 4,000,000 candidate pairs, disk probes, box checks and ray cells and crossings, shared
   by every operation in one check (`checkProjectMinimumFeatures`). When it runs out the findings
   so far are reported and the operations not fully checked are named.
5. Job Review (`ui/laser/job-review/min-feature-warnings.ts`) adds findings to the existing warning
   list, from the exact prepared (output-scoped) project; the check is memoised per prepared
   project because the model is rebuilt at Confirm.
   - A declared cut gets one warning per kind with the layer, the count, the kerf or bit and where
     the kerf came from, and the narrowest width, for example (four 10 mm holes with 0.1 mm
     bridges, Kerf Offset 0.075 mm, front-left origin on a 400 mm bed): `Layer "Cut": 3 parts
     narrower than the 0.15 mm kerf (twice its Kerf Offset) — they burn away or break; narrowest
     0.1 mm at X 25.1 · Y 385 mm; also at X 35.2 · Y 385 mm and X 45.3 · Y 385 mm.` A 2 mm slot
     pocketed with a 3 mm bit reads `Layer "Pocket": 1 area narrower than the 3 mm bit (3 mm end
     mill) — the bit cannot enter it, so it stays uncut; narrowest 2 mm at X 11 · Y 385 mm.`
   - Positions are machine coordinates, the Job size frame, so they are given only for an Absolute
     job. A Current Position, User Origin or verified-origin job moves the artwork at run time, and
     its warning gives the narrowest width without a position.
   - An assumed cut gets one short, optional line with no positions and no setting to change:
     `Layer "Engrave", only if it cuts through: 12 parts and 3 gaps narrower than the 0.15 mm kerf
     (a typical kerf), narrowest 0.02 mm. Ignore this if the layer scores or engraves.` The check
     never recommends a G-code-changing setting (such as Kerf Offset) as a way to tune the
     advisory.

   They never refuse Frame, Start or export.
6. After a vector trace commits (`ui/trace/trace-output-commit.ts`), the new artwork alone is
   checked on the next task, so the dialog closes first, and a warning toast names the operation,
   counts and narrowest width (`ui/trace/trace-min-feature-notice.ts`). Only declared cuts are
   checked for the notice: a Centerline or Edge trace on a plain Line operation, and a filled
   trace on its default Fill operation, get no notice; a trace committed onto an operation with a
   Kerf Offset, tabs or extra passes, or a CNC profile or pocket, does.

### Consequences

- Before this ADR no warning existed. Measured after it, Line Art and Centerline traces of the owl
  and hummingbird test images (1,254 x 1,254 pixels) at a 0.15 mm kerf, in a vitest harness on a
  shared, loaded laptop (median of three warm runs), with the pinch and stacked-copy rules and the
  box-limited rays of the review round (before them in brackets, same tracer build):

  | Trace, width | Pieces | Work units | Time | Narrow parts | Narrow gaps |
  |---|---|---|---|---|---|
  | owl Line Art, 100 mm | 142,448 | 2,211,282 (1,918,901) | 0.57 s | 2,880 (2,843) | 2,275 (2,178) |
  | owl Line Art, 300 mm | 243,037 | 1,009,699 (869,472) | 0.32 s | 646 (634) | 396 (385) |
  | owl Centerline, 100 mm | 88,485 | 525,327 | 0.20 s | 0 | 183 (156) |
  | hummingbird Line Art, 100 mm | 114,513 | 1,706,400 (1,455,502) | 0.42 s | 1,535 (1,527) | 1,806 (1,766) |
  | hummingbird Line Art, 300 mm | 173,441 | 671,097 (591,500) | 0.23 s | 181 (175) | 251 (246) |
  | hummingbird Centerline, 300 mm | 101,781 | 257,113 | 0.14 s | 0 | 44 (36) |

  The narrowest widths are all under 0.01 mm: real pinch points where the tracer's outlines meet
  at a pixel corner, so traces this dense at these sizes are genuinely finer than a 0.15 mm kerf.
  The added findings are those pinches, formerly dropped as specks. The extra work units are box
  checks the rays now count; the time did not change.
- Synthetic cases (tests): four 10 mm holes with 0.1 mm bridges at a 0.15 mm kerf report 3 narrow
  parts, narrowest 0.1 mm, positioned on each bridge, whichever way the holes wind; 0.3 mm bridges
  report nothing; two squares 0.1 mm apart report 1 gap of 0.1 mm; two diamond holes (or parts)
  tip to tip report one pinch at 0.1, 0.05 and 0.005 mm alike (0 below 0.075 mm before); a
  0.035 mm corner-to-corner gap is reported; a 0.06 mm hair spike is not; a square stacked on
  its own reversed copy next to a 0.1 mm gap reports 1 gap (1 part and 2 gaps before); a 2 mm by
  20 mm slot pocketed with a 3 mm bit reports 1 area of 2 mm; a traced 1 mm ring under a 3 mm bit
  reports nothing on profile-on-path and profile-inside (1 mm band before), and the band when
  both edges are machined; plain squares, circles and a 0.5 mm square report nothing.
- Large jobs: 60 x 60 pairs of parts 0.1 mm apart on 300 mm, loose or cut from a sheet, now finish
  with all 3,600 gaps or bridges in about 1.0M work units and 0.4 s; before, a ray along the whole
  grid row per part spent the 4M budget and found 993 of them. Jobs that do spend the whole budget
  (the piece cap or the test cap) take, measured on the same loaded laptop: 22,500 circles 1.5 s,
  3,000 parallel open lines 1.2 s, a 200 x 200 part sheet 0.9 s, 2,000 nested squares 0.8 s. That
  is the worst case added to opening Job Review once per prepared job (Confirm reuses the result),
  on the main thread; the post-trace notice runs it only for declared cuts, after the dialog has
  closed. Moving the check into a worker, as ADR-246's check runs, is the next step if that pause
  proves noticeable.
- Findings are text. A canvas highlight for the positions would need a warning-location mechanism
  Job Review does not have.
- Text objects fill nonzero; the check reads every closed path even-odd, which differs only where a
  font's glyph contours overlap. Only exact stacked copies are merged; a copy shifted by any amount
  is two outlines, and the sliver between them is reported like any other.
- Tests: `min-feature-analysis.test.ts` (including pinches, the hair spike, stacked copies and the
  3,600-part sheet), `project-check.test.ts` (kerf sources, cut intent, grouping by source,
  operation selection, CNC sides, traced rings, shared budget), `min-feature-warnings.test.ts`
  (wording, the optional line, positions only for Absolute, memo, and a real
  `prepareCurrentStartJob` to `buildJobReviewModel` path) and `trace-min-feature-notice.test.ts`.

Not part of this decision: a canvas overlay of the positions; per-object thickening or a fix-up
action like ADR-246's Thicken; checking Fill hatch spacing or raster dots; a kerf setting separate
from Kerf Offset.
