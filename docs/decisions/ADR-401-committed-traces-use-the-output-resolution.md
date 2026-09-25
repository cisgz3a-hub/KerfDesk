## ADR-401 - Committed traces use the resolution the output needs, not the preview cap (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This amends ADR-037. Its 2048 px longest-edge cap stays for the live preview. A committed trace and
a Multi-File trace batch now choose their own working grid.

### Context

Every trace path decoded the source to at most 2048 px on the longest edge before any tracer logic
ran: the dialog preview, the commit and the Multi-File batch (`MAX_EDGE_PX` and
`PREVIEW_MAX_EDGE_PX` in `ui/trace/image-loader.ts`). ADR-037 chose 2048 as a CPU and memory
trade-off, measured on a tracing engine that has since been replaced. It also kept preview and
commit on one grid so the commit could reuse the preview's trace. Potrace traces the bitmap it is
given, and LightBurn's Trace Image traces the imported image at its own resolution.

Reproduced on this base with the Line Art preset, tracing through the app's own box-halving
resampler (`resampleBuffer`) in place of the browser's resize:

| Fixture | Traced on the 2048 px grid | Traced at native size |
|---|---|---|
| 4096 x 512, ten 3 px bars with 1 px gaps | 1 ring (fused) | 10 rings |
| same image, ten 0.7 px hairlines | 0 rings (erased) | 10 rings |
| same image, ten 2 px bars with 2 px gaps | 10 rings | 10 rings |
| same image, ten 1.5 px bars with 1.5 px gaps | 5 rings | 10 rings |
| 4096 x 2048, disc of radius 900 px, largest radial error | 0.608 source px | 0.471 source px |

The tracer's own 2x supersample of the capped grid cannot restore the lost bars: the information is
gone before it runs.

Two ways to keep the trace settings meaning the same thing on the finer grid were measured on the
disc. Running the commit with `pixelScale` set to the grid ratio, which scales every pixel knob as
the supersample route does, also doubles the curve-fitting tolerance: the error was 0.622 source
px, no better than the capped grid. Scaling only the operator's size controls keeps the fitting
tolerance at one working pixel and gives 0.471.

Peak memory was measured as the rise in the process's peak resident memory (`maxRSS`) while tracing
the owl and hummingbird test art (1254 x 1254) resampled to 2508 x 2508 (6.3 MP), in Node with the
same tracer, one process per run:

| Lane | Owl | Hummingbird | Owl run time |
|---|---|---|---|
| Line Art | 149 B/px | 63 B/px | 18 s |
| Smooth | 146 B/px | 113 B/px | 18 s |
| Sharp | 172 B/px | 129 B/px | 16 s |
| Centerline | 73 B/px | 59 B/px | 121 s |
| Edge Detection | 199 B/px | 151 B/px | 28 s |

Per pixel these are upper bounds: at 1.57 MP the same runs measured 144 to 505 B/px, because a
fixed cost of roughly 150 to 700 MB (code, compiled functions, garbage the collector has not yet
reclaimed) is spread over fewer pixels. The machine was shared with other work, so the run times are
slow and indicative only.

### Decision

1. The preview keeps `PREVIEW_MAX_EDGE_PX` = 2048. The cap and `scaleToCap` move to
   `ui/trace/trace-decode-cap.ts`; `image-loader.ts` re-exports both.
2. `planTraceCommitGrid` (`ui/trace/trace-commit-grid.ts`) chooses the commit grid as the smallest
   of:
   - the native size (EXIF orientation applied, from `readImageNaturalSize`, as ADR-396 decodes it);
   - the placed output size times a target density. The output size is the raster's bounds times
     its transform scale, read from the live source at commit. The target is two samples across
     the laser spot, on its finer axis, from `DeviceProfile.laserSubProfile.spotSizeMm`: a feature
     narrower than half a spot cannot burn as a separate mark. Without a recorded spot, and for CNC,
     the spot is taken as 0.1 mm, the default fill line interval, so the target is 20 px/mm (508
     DPI). A layer's line interval is not used: the trace is not yet on a layer when it is
     committed, and it can be moved to another;
   - a working-pixel budget: 25% of the device's memory divided by a planned peak of 190 B/px for
     the filled-contour lanes and Centerline, and 220 B/px for Edge Detection. These are the worst
     measured figures above plus 16 B/px for the decode canvas, its pixel copy, the composited copy
     and the copy moved to the trace worker. Centerline needs less memory but uses the contour figure
     because its run time grows fastest. Device memory is `navigator.deviceMemory` where the browser
     reports it (Chromium and Electron report at most 8 GB) and 4 GB elsewhere. The budget never
     exceeds 24 MP, and Centerline's never exceeds 6 MP (`TRACE_CENTERLINE_MAX_WORKING_PIXELS`):
     6.3 MP is the largest grid with a measured Centerline run time. With 8 GB reported, Line Art
     may trace about 11.3 MP; with none, 5.7 MP.

   The grid is never coarser than the preview's. When the budget binds, the largest grid within it
   is used: a 6000 x 4000 photo placed at its import size traces at 4117 x 2745 with 8 GB, against
   2048 x 1365 before. Tiling a larger source is not part of this decision.
3. Photo shading keeps the preview grid: it samples at most 320 tone bands, so a finer decode would
   change only the cost.
4. At commit (`traceAtCommitGrid`, `ui/trace/trace-commit-at-grid.ts`), when the planned grid is
   finer than the preview's, the source is decoded at that grid and traced there. A preview trace is
   reused only if it already holds that grid. The operator's size controls keep the physical meaning
   they had on the preview grid, so the commit drops the specks the preview dropped: Ignore less
   than and the ink despeckle area scale by the ratio of the two grids' pixel counts; Minimum line,
   the Centerline join gap and the edge join gap scale by the longest-edge ratio. (A width-only
   ratio is wrong on a tall source: 100 x 30000 previews at 7 x 2048, so it reads 14.29 against
   14.65, and gives an area factor of 204 against 209.) Curve-fitting tolerances are not scaled. If
   the finer decode or trace fails for any reason other than cancellation, the commit traces the
   preview grid and adds the notice "This device could not trace the image at full resolution, so
   the trace uses the preview resolution." While the finer attempt runs, the dialog shows its
   phases over the preview (reading the image, then the trace phases, with the elapsed time) until
   the commit settles it.
5. The Multi-File batch plans each file with the same function, using the import size (254 DPI, as
   `rasterImportGeometry` places it) as the output size and the project's machine for the density.
   Each file is now decoded on its turn (`BatchTraceImageJob.image` may be a loader), so a batch
   holds one large decode at a time instead of all of them. It has the same fallback as a commit:
   a file whose finer decode or trace fails for any reason other than cancellation is traced on
   the preview grid with the unconverted settings (`BatchTraceImageJob.fallback`) and carries the
   same notice, and the batch continues.
6. When the committed grid is finer, the dialog says so under the preview once the preview is
   ready, for example: "Preview: 2048 x 256 px. The committed trace uses 4096 x 512 px (the full
   image), so it can keep detail the preview cannot show, and takes longer to trace." When the
   budget binds, it says the grid is the most the trace style may use on this device and gives the
   full size.

### Consequences

- Sources up to 2048 px on the longest edge, including the owl and hummingbird art, are unchanged:
  their planned grid is the preview's, and the commit reuses the preview trace as before.
- For larger sources the committed trace can differ from the preview in detail the preview could
  not resolve. That is the purpose; the dialog note says so. Centerline can also differ in the
  skeleton of broad solid areas the preview did resolve: its internal thresholds are in working
  pixels and are not converted (the 12 px spur and junction budgets, for example). In a review
  probe an 80 px solid square traced as one diagonal on the 2048 grid and as an X on the native
  grid; realistic 16 to 40 px strokes (T, L, +, ring) matched exactly. Placement is unchanged: the
  trace carries its working grid (`tracePixelWidth`, `tracePixelHeight`) and is registered over the
  source's physical bounds, and the boundary box is remapped to the working grid.
- Commits of large sources take longer and use more memory, within the budget above. Before this
  decision a commit reused the finished preview and cost almost nothing; now every commit of a
  source over 2048 px decodes and traces again. A freshly imported image is placed at 10 px/mm
  against a 20 px/mm target, so only memory or the native size bounds its grid: a 12 MP phone photo
  always takes the finer path. Measured in Node on the shared machine, with a 4000 x 3000 synthetic
  line-art image placed at 400 x 300 mm and 8 GB reported (preview grid 2048 x 1536, then commit
  grid): Line Art 3.4 s then 10.2 s (3881 x 2911); Centerline 6.1 s then 9.7 s (2828 x 2121, the
  6 MP ceiling; 20.1 s at 3881 x 2911 without it); Edge Detection 3.4 s then 9.1 s (3607 x 2705).
  The dialog note says the commit takes longer, and the dialog shows the commit's phases. Closing
  the dialog cancels a commit as before; the worker's heartbeat keeps a long trace alive.
- The commit grid, and so the committed geometry, depends on the reported device memory. The same
  file and settings can trace differently on an 8 GB Chromium device, a 4 GB one, and Firefox or
  Safari (which report nothing, so 4 GB is assumed): a 6000 x 4000 source traces at 4117 x 2745
  with 8 GB and at about 2911 x 1941 with none. This applies to retraces and Multi-File SVG exports
  too. Chromium reports only a few rounded values (0.25 to 8 GB), so results are reproducible
  within each reported tier.
- Before and after, from `trace-commit-at-grid.test.ts`: the 4096 x 512 bars keep 10 + 10 + 10 + 10
  rings at commit (the preview grid keeps 1 + 0 + 10 + 5), and the disc's largest radial error
  falls from 0.608 to 0.471 source px.
- Tests: `trace-commit-grid.test.ts` (density, the memory guard at 0.5 to 8 GB, the Centerline
  ceiling, the 6000 x 4000 budget, the output and preview bounds, Photo shading, the size-control
  conversion including a tall source, the dialog copy), `trace-commit-at-grid.test.ts` (the
  fixtures above, reuse of a preview trace and of a finer trace an earlier commit settled, a
  boundary remapped to the commit grid in crop and enhance modes, the reported phases, the fallback
  notice, cancellation before and during the finer trace), `use-trace-preview-settlement.test.tsx`
  and `ImportImageDialog.commit-progress.test.tsx` (the dialog shows the commit's phases), and
  `multi-file-trace-action.test.ts` (the batch uses the same plan, decodes one file at a time, and
  falls back per file when the finer decode or trace fails, but not when it is cancelled).

Not part of this decision: tiling sources beyond the budget; a finer preview; scaling the preview's
size controls to native pixels; measuring peak memory in a browser rather than Node.
