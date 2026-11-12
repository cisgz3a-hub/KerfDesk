## ADR-245 Amendment 2 - Image Studio renders neighbourhood-filter previews in a worker (2026-11-12)

**Status:** Accepted on 2026-11-12 |
**Amends:** ADR-245 (Image Studio layers: active-layer document with a composite bake), as
amended by Amendment 1 (display-resolution previews), decision 4 "Neighbourhood filters run at
full resolution", with the budgets of performance audit S1 (100 ms from input to visible
response; a longest UI block of 200 ms, or a progress bar and Cancel if the work can take longer)

### Context

Amendment 1 brought every pointwise adjustment inside the S1 budgets but left the six
neighbourhood filters (Gaussian Blur, Unsharp Mask, High Pass, Median, Halftone and Line
Screen) on the UI thread. They are defined in document pixels, so each slider step filtered the
whole active layer before sampling the window. On a 12 MP photo each step blocked the UI for
0.3-2 s (Amendment 1's runs read about 3 s for Gaussian Blur on a slower afternoon), and
Median at radius 2 for 36 s in Chrome, because `medianInPlace` gathered and sorted every window
with a comparator (60-120 s in Node).

### Decision

1. **Large documents filter in a worker.** When a neighbourhood filter previews a document of
   512 x 512 pixels or more, `adjust-filter-preview.ts` sends a copy of the active layer, the
   selection bounds and mask, the settings and the window to `adjust-filter-worker.ts`. The
   worker runs the same `runAdjustment` and `sampleWindowInto` calls the dialog ran, on the same
   bytes, and sends back the window-sized sample; the dialog composites it with
   `compositeLayersInPlace` exactly as before (`composeFilteredWindow`). Smaller documents, and
   any runtime without a working worker, keep the UI-thread path of Amendment 1; a worker that
   fails falls back to it for the rest of the session.
2. **A progress bar with Cancel answers at once.** The step that starts a render sets the
   dialog's `previewProgress` to 0 in the same task, so "Rendering preview… n%", a bar and a
   **Cancel preview** button appear on the next frame; the filters report the fraction done
   through an optional `FilterProgress` callback, which only reports and changes no pixel.
   Cancel preview stops the render and turns **Preview** off, so the canvas shows the image as
   it is; ticking Preview renders again. OK is unchanged and applies the filter either way.
3. **The latest step wins, and stale work stops.** A filter is one synchronous call inside the
   worker and cannot hear a message, so a step with other settings terminates the worker at
   once rather than letting a stale render hold a core for seconds. Steps closer together than
   120 ms start one render, for the last of them, so a drag does not copy the document per step.
4. **Pan and zoom reuse the filtered document.** The worker keeps the document it filtered
   last. A pan or zoom with unchanged settings only resamples the new window; one that lands
   while that document is still being filtered lets the render finish and then resamples. The
   worker and what it holds are retired when the dialog closes.
5. **Median slides a histogram.** `medianInPlace` keeps a 256-bin histogram per channel along
   each row (Huang's running median): one column leaves and one enters per pixel, and the
   median moves from where it was. The window is the same edge-clamped multiset as the sorted
   gather, so the medians are the same bytes; it also no longer snapshots the document, and its
   values buffer is bytes, not floats.
6. **Exactness holds.** At 100% the worker's preview is still a byte-for-byte crop of the
   committed composite (Amendment 1 decision 6), and OK still runs `commitAdjustment` at full
   resolution on the UI thread.

### Verification

- `adjust-apply-golden.test.ts` passes unchanged: the applied bytes of all 14 adjustments, on one
  layer and on an upper layer, with and without a feathered selection, are those recorded from
  main at 45cbf63f9.
- `adjust-preview-window.test.ts` passes unchanged (1:1 window preview equals the committed
  composite for every adjustment; no document-sized allocation per step on the UI-thread path).
- `median.test.ts` checks the histogram median against the old sorted-window median, kept in the
  test as the reference, for radius 1 to 4, three rects (one touching the document edge) and a
  feathered mask, on noise with frequent ties; and that reporting progress changes nothing.
- `adjust-filter-preview.test.ts` runs the real worker module behind a fake `Worker`: for each of
  the six filters, on a 520 x 512 two-layer document with a feathered selection, the bar shows
  at once and the 1:1 preview equals what OK bakes. It also checks that a step with other
  settings terminates the running render and the latest wins, that steps inside the start delay
  start one render, that a pan resamples without re-filtering (also mid-render), that Cancel
  preview stops the render and turns Preview off, that closing the dialog retires the worker,
  that a failed worker falls back to the UI thread, and that small documents stay there.
- `AdjustDialog.test.tsx` checks the bar, its status text and Cancel preview.
- `e2e/image-studio-adjust-preview.e2e.ts` adds Halftone on the 2400 x 1800 photo at 100%: the
  bar shows while the worker's script is held back, Cancel preview turns Preview off and restores
  the canvas exactly, and after Preview is ticked again the canvas after OK matches the preview
  exactly.

### Measured

**Setup.** The S5 browser harness (`run5.mjs`, adapted as `run6.mjs`) drove production web bundles in
installed Chrome at 1440 x 900: main at 93c880722 ("before") and this change ("after"). The photo was
the audit's 12 MP JPEG (4000 x 3000). Before and after ran on the same PC in the same afternoon.

**What is measured:**

- **shown:** from the slider input to the preview drawn on the canvas.
- **bar:** from the input to the progress bar appearing.
- **block:** the longest main-thread task.

Each figure is the median (range) over every kept step.

**Which runs were kept:**

- Other sessions repeatedly drove free memory down to 247-393 MB. The harness watchdog then ended
  two 6-run sets, so each set was cut to 2 runs: run 0 is dropped and run 1 is kept. Sets ran
  alternately on the after and before bundles until each had 5 kept runs.
- Every set started on a quiet gate: no other tooling, harness or Chrome; CPU under 45%; at least
  2.5 GB free. The memory floor is lowered from the audit's 3 GB because the idle PC sits at about
  2.7 GB.
- A run counts only when its calibration before the run was within 15% of the 36 ms floor; kept
  runs read 36-40 ms. Two runs were dropped for a 43-45 ms calibration.
- Calibration after a run rose to 41-54 ms after some before-tree runs. The S5 audit attributes
  this to the app's own work after a commit.

| 12 MP step (steps x kept runs) | Before: shown / block | After: bar / shown / block | Chrome peak, before / after |
|---|---|---|---|
| Gaussian Blur radius 3, 4, 5 (3 x 5) | 1,258 (1,112-1,605) / 1,239 (max 1,840) ms | **18 (17-19)** / 1,422 (1,284-1,618) / **0** ms | 1.51 / 1.59 GB |
| Halftone cell 10, 12, 14 (3 x 5) | 347 (328-482) / 329 (max 463) | **18** / 460 (426-509) / **0** | 1.00 / 1.06 |
| Unsharp Mask amount 150 (1 x 5) | 1,419 (1,379-1,494) / 1,399 (max 1,475) | **18** / 1,694 (1,553-2,125) / **0** | 1.31 / 1.30 |
| High Pass radius 6 (1 x 5) | 1,369 (1,344-2,013) / 1,350 (max 1,994) | **18** / 1,658 (1,526-2,270) / **0** | 1.26 / 1.25 |
| Line Screen pitch 12 (1 x 5) | 372 (327-530) / 354 (max 511) | **18** / 460 (440-568) / **0** | 0.89 / 0.83 |
| Median radius 2 (before 1 x 3, after 1 x 5) | 35,848 (35,512-36,844) / 35,828 | **18** / 1,910 (1,874-2,397) / **0** | 1.10 / 0.86 |

**Results:**

- Every filter step now answers within the 100 ms budget: the bar appears in 17-19 ms.
- No main-thread task reached the 50 ms long-task threshold during any step, against blocks of
  0.3-2.0 s before (and 36 s for Median).
- The finished preview arrives 0.1-0.3 s later than the old blocking one. Part of that is the
  120 ms start delay, which coalesces steps, and part is the copy to the worker. Median is 19x
  sooner.
- After Cancel, Chrome held at most 0.87 GB, against 1.19 GB before.
- **Gaussian Blur's peak of 1.59 GB is over the 1.5 GB budget, as main's 1.51 GB already was.** The
  worker briefly holds the source copy, the blur's float buffers and the filtered document.

The Node bench (12 MP, run 0 dropped, median of 5; calibration 37-48 ms; ratios hold) gives:

- **Median:** the new median takes 2.2 / 3.3 / 5.9 s at radius 1 / 2 / 4. The old one took 60-120 s
  at radius 2 (calibration 46-65 ms), and its output is identical on the whole 12 MP image.
- **Filter step at 512 x 512:** every filter took 10-76 ms, so smaller documents stay on the UI
  thread within the 200 ms budget.

**Not changed:** OK still applies the filter on the UI thread. At 12 MP that blocks for about 0.3-2 s,
depending on the filter, as before. This amendment covers the preview only.
