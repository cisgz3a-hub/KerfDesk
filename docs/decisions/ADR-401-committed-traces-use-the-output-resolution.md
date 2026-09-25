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
     exceeds 24 MP. With 8 GB reported, Line Art may trace about 11.3 MP; with none, 5.7 MP.

   The grid is never coarser than the preview's. When the budget binds, the largest grid within it
   is used: a 6000 x 4000 photo placed at its import size traces at 4117 x 2745 with 8 GB, against
   2048 x 1365 before. Tiling a larger source is not part of this decision.
3. Photo shading keeps the preview grid: it samples at most 320 tone bands, so a finer decode would
   change only the cost.
4. At commit (`traceAtCommitGrid`, `ui/trace/trace-commit-at-grid.ts`), when the planned grid is
   finer than the preview's, the source is decoded at that grid and traced there. A preview trace is
   reused only if it already holds that grid. The operator's size controls keep the physical meaning
   they had on the preview grid, so the commit drops the specks the preview dropped: Ignore less
   than and the ink despeckle area scale by the square of the grid ratio; Minimum line, the
   Centerline join gap and the edge join gap scale by the ratio. Curve-fitting tolerances are not
   scaled. If the finer decode or trace fails for any reason other than cancellation, the commit
   traces the preview grid and adds the notice "This device could not trace the image at full
   resolution, so the trace uses the preview resolution."
5. The Multi-File batch plans each file with the same function, using the import size (254 DPI, as
   `rasterImportGeometry` places it) as the output size and the project's machine for the density.
   Each file is now decoded on its turn (`BatchTraceImageJob.image` may be a loader), so a batch
   holds one large decode at a time instead of all of them.
6. When the committed grid is finer, the dialog says so under the preview once the preview is
   ready, for example: "Preview: 2048 x 256 px. The committed trace uses 4096 x 512 px (the full
   image), so it can keep detail the preview cannot show." When the budget binds, it says the grid
   is the most the device's memory allows and gives the full size.

### Consequences

- Sources up to 2048 px on the longest edge, including the owl and hummingbird art, are unchanged:
  their planned grid is the preview's, and the commit reuses the preview trace as before.
- For larger sources the committed trace can differ from the preview in detail the preview could
  not resolve. That is the purpose; the dialog note says so. Placement is unchanged: the trace
  carries its working grid (`tracePixelWidth`, `tracePixelHeight`) and is registered over the
  source's physical bounds, and the boundary box is remapped to the working grid.
- Commits of large sources take longer and use more memory, within the budget above. Closing the
  dialog cancels them as before; the worker's heartbeat keeps a long trace alive.
- Before and after, from `trace-commit-at-grid.test.ts`: the 4096 x 512 bars keep 10 + 10 + 10 + 10
  rings at commit (the preview grid keeps 1 + 0 + 10 + 5), and the disc's largest radial error
  falls from 0.608 to 0.471 source px.
- Tests: `trace-commit-grid.test.ts` (density, the memory guard at 0.5 to 8 GB, the 6000 x 4000
  budget, the output and preview bounds, Photo shading, the size-control conversion, the dialog
  copy), `trace-commit-at-grid.test.ts` (the fixtures above, reuse of a preview trace, the fallback
  notice, cancellation before and during the finer trace), and `multi-file-trace-action.test.ts`
  (the batch uses the same plan and decodes one file at a time).

Not part of this decision: tiling sources beyond the budget; a finer preview; scaling the preview's
size controls to native pixels; measuring peak memory in a browser rather than Node.
