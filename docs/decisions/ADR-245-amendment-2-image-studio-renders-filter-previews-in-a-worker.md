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
whole active layer before sampling the window: on a 12 MP photo Gaussian Blur blocked the UI
for about 3 s per step, Halftone about 2 s, and Median at radius 2 about 70 s, because
`medianInPlace` gathered and sorted every window with a comparator.

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

Pending: the before/after browser sets are queued behind a quiet-PC gate and land in this section before merge.
