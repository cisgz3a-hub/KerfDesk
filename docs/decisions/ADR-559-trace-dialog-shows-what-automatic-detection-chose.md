## ADR-559 - The Trace dialog shows what automatic detection chose, starts Manual from it, and offers Join gaps (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29
**Related:** ADR-402 (levelling uneven lighting), ADR-405 (Centerline join gap), ADR-408 (Re-trace
Original settings), ADR-409 (commit grid), ADR-435 (frozen whole-source decisions), ADR-477
(trace command).

### Context

The 2026-09-24 tracer audit compared the Trace Image dialog with what the engine does. Its dialog
findings were saved on 2026-09-25 and are ported here onto main `e5f0a266b`, where they still hold:

- Switching Smooth, Sharp, Centerline or Line + fill from automatic detection to **Manual
  brightness band** started the band at 0 to 128 (`applyManualDetection`). Their automatic
  threshold (Otsu) can sit far from 128: on grey ink at 150 on paper at 240 it cuts at 151, and on
  anti-aliased copies of that ink at 191 to 196, so the 0 to 128 band traced nothing. The dialog's
  own test shows the same with ink at 170: 900 ink pixels automatic, none at 0 to 128.
- Line Art's automatic detection is a fixed 0 to 128 band, plus marks darker than their
  surroundings only when a colour check passes (`auto-sketch-trace.ts`). Its Detection option
  ("Automatic (preserve pale details)"), its note and its description promised pale details on
  every image. The dialog showed neither the band nor which route ran.
- The preview decodes large images at most 2048 px on a side. Remove ink specks, Ignore Less Than,
  Minimum line and the join gap count pixels of that grid (the commit keeps their size on its own
  grid, ADR-409), while the dialog header shows the image's own size. ADR-409's note names the
  preview size only when the commit traces a finer grid, and Minimum line's hint said
  "source-image pixels".
- Centerline and Line + fill join facing line ends closer than `centerlineJoinGapPx` (3 px in both
  presets). ADR-405 left exposing it for later; the dialog had no control.

### Decision

1. **A trace reports what it chose, and nothing reads the report back.** A trace step may yield a
   display-only `TraceReport` (`trace-steps.ts`): `automaticThresholdLuma` (the automatic cut;
   luma below it is ink), `lightingLevelled` (ADR-402 levelled the page first, so no single band
   matches) and `localDetailAdded` (which way Line Art's colour check went).
   `prepareTraceForContour` builds it where each decision is made (`trace-report.ts`), and the
   contour, Centerline and Line + fill lanes yield it once. The worker and the inline fallback
   return it with the result. Crop keeps the crop's report; Enhance keeps the full pass's, whose
   whole-source cut the region re-trace also uses (ADR-435). A relaxed zero-paths retry
   returns the retry's report. Options, cache keys and traced output are unchanged.
2. **The report is shown only while it describes the settings** (`trace-preview-facts.ts`): the
   latest finished preview with the same file, boundary, boundary mode and detection options.
   Finishing controls (Smoothness, Optimize, Ignore Less Than, Join gaps, Line + fill's stroke
   width) keep it, so the panel does not flicker while a curve change re-traces.
3. **Automatic shows its band.** In automatic and Faint lines modes Detection shows the band in
   use, read-only: Line Art's preset band; for automatic-threshold styles "Cutoff 0, Threshold
   T − 1, set from this image" once the preview has reported, "set from this image when the
   preview finishes" before that, or that uneven lighting was evened out first. Line Art says
   whether colour detail was found. Its Detection option reads "Automatic (band + pale colour
   detail)" and its description "Traces brightness 0–128 as ink and, in colour artwork, adds pale
   details."
4. **Manual starts where automatic was.** The automatic cut inks luma below T and the manual band
   is inclusive, so the first switch to Manual on an automatic-threshold style sets Threshold to
   T − 1, and the automatic cut's pixels stay ink on the traced grid. A band set earlier is kept.
   Without a matching report the band starts at the preset's 0 to 128, as before. The value comes
   from the finished preview; no extra trace runs to find it.
5. **The preview grid is named.** When the preview traced a grid smaller than the image, the
   settings panel says "The preview traces this image at W × H px; pixel sizes here count those
   pixels." Minimum line's hint now says "pixels".
6. **Join gaps.** Centerline and Line + fill show **Join gaps** (0 to 50 px; the presets' 3 by
   default), which sets `centerlineJoinGapPx`; 0 turns the bridge off. It persists with Re-trace
   Original (ADR-408), carries across preset switches like the other style-only controls, returns
   to 3 on **Reset trace settings**, and the trace command takes it as `--join-gaps` (ADR-477).

### Consequences

- The report is only as fresh as the last finished preview. Until one finishes, Manual starts at
  0 to 128.
- The reported cut is the one the traced grid used. A small image may be traced on an enlarged
  grid, whose interpolated edges give a cut of its own (a 64 px anti-aliased disc: 114 on Sharp,
  125 on Smooth); that route also restores ink from the decoded grid's own cut
  (`contour-support.ts`), so there a Manual band can differ from automatic at a few restored
  pixels.
- Art with no grey between ink and paper leaves a gap in the histogram, and Otsu reports the
  lowest cut in it: pure black on white without anti-aliasing reads "Threshold 0". Every cut in
  the gap selects the same pixels, and the edge between saturated pixels sits at the pixel
  boundary whatever the threshold (`contour-boundary.ts`), so Manual still traces the same. A cut
  in the middle of the gap would read better but moves the sub-pixel edges of unsaturated
  two-tone art (ink at 150 on paper at 240), so it was not used.
- Switching from Faint lines to Manual starts at the same cut, and the pale strokes Faint lines
  added are no longer traced; Manual is a plain band.
- Tests: `trace-report.test.ts` (the cut; the band ending at T − 1 selects the same pixels and one
  ending at T does not; levelled lighting; a region's frozen cut; Line Art's two routes; Faint
  lines; runners get the report without the paths changing, on the contour, Centerline and
  Line + fill lanes), the worker, inline, Crop and Enhance report tests,
  `trace-preview-facts.test.tsx`, `TraceDetectionControls.test.tsx` (Smooth, Sharp, Centerline
  and Line + fill keep their 900 ink pixels in Manual) and `TraceJoinGapsControl.test.tsx` (a 4 px
  stroke broken by a one-pixel gap traces as one path by default and two at 0). The two end-to-end
  tests that switch Sharp to Manual read the band from the panel instead of expecting 128.

### References

- N. Otsu, "A Threshold Selection Method from Gray-Level Histograms", IEEE Transactions on
  Systems, Man, and Cybernetics 9(1):62-66, 1979. <https://doi.org/10.1109/TSMC.1979.4310076>
