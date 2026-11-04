## ADR-245 Amendment 1 - Image Studio previews adjustments at display resolution (2026-11-04)

**Status:** Accepted on 2026-11-04 |
**Amends:** ADR-245 (Image Studio layers: active-layer document with a composite bake), decision
5 "One composite path", with the budgets of performance audit S1 (100 ms from input to visible
response, 200 ms longest UI block, 1.5 GB peak)

### Context

Performance audit S1, area S5 (`docs/audits/2026-11-02-performance-s1/S5-trace-image.md`),
confirmed S5-P2-1: every slider step of an Image Studio adjustment recomputed the whole document
on the UI thread. On a 12 MP photo each step:

- cloned the document (48 MB), ran the adjustment over all of it and composited every layer;
- copied the result again (`docToCanvas`) into a new 12 MP canvas and drew it down to about
  1 MP on screen;
- for Levels and Threshold, rescanned the whole document's luma histogram, because the histogram
  canvas used an inline `ref` callback that React re-runs on every render. That was over half of
  each step.

The refuter measured Threshold at 408-414 ms from input to result with a 306-310 ms block,
Levels at 287-294 ms (185-189 ms block) and Brightness at 120-198 ms, with Chrome at
1.47-2.20 GB inside the dialog.

### Decision

1. **The histogram is computed once per dialog source.** `Histogram` memoizes `lumaHistogram`
   on the document, selection and revision (painting and undo are parked while a dialog is up),
   as the Curves editor already did.
2. **The dialog previews the visible window at display resolution.** `previewWindow` takes the
   part of the document the canvas shows, clipped to the selection bounds, at
   `min(1, view.scale)`. The canvas keeps drawing the unchanged composite and draws the
   window-sized preview over its document rectangle. Pan and zoom recompute the window.
3. **Pointwise adjustments run on the sampled window.** Brightness / Contrast, Levels, Curves,
   Threshold, Posterize, Invert, Desaturate and Remove white background map each pixel on its
   own, so they run on an area-averaged copy (alpha-weighted, so transparent pixels never bleed
   colour). Each catalog entry declares this (`AdjustmentSpec.pointwise`), so a new adjustment
   must choose.
4. **Neighbourhood filters run at full resolution.** Gaussian Blur, Unsharp Mask, High Pass,
   Median and the two screens are defined in document pixels (radius, pitch, screen phase). They
   run on a full-size scratch copy kept for the dialog and are sampled afterwards.
5. **Buffers are reused.** The samples, the working and output buffers, the scratch copy and
   the canvas the preview is painted into live for the whole dialog. A slider step allocates
   nothing document-sized. Everything is dropped when the dialog closes.
6. **At 100% or closer the window is copied, not averaged,** and the preview is a byte-for-byte
   crop of the committed composite. Decision 5 of ADR-245 holds as before: the preview composite
   uses the same `compositeLayersInPlace` as Apply. At fit view the preview is the same
   adjustment on the averaged pixels the screen would show, so a Threshold edge can differ by a
   screen pixel from the full-resolution result drawn small.
7. **OK is unchanged.** `commitAdjustment` still runs the adjustment over the full-resolution
   active layer, so the applied pixels are the same bytes as before. During a dialog, the Info
   readout reads the document, not the preview.

### Verification

- `adjust-apply-golden.test.ts` pins the applied pixels, and the composite, of all 14
  adjustments on one layer and on an upper layer, with and without a feathered selection. Its
  hashes were recorded from main at 45cbf63f9 before this change.
- `adjust-preview-window.test.ts` checks that the 1:1 window preview equals the committed
  composite for every adjustment in those four cases, with an interior window so the filters
  read neighbours outside it. It also checks that three further steps return the same buffer
  and construct no document-sized array.
- `AdjustDialogHistogram.test.tsx` counts histogram scans: one for an open plus five Levels or
  Threshold steps (six before this change).
- `e2e/image-studio-adjust-preview.e2e.ts` thresholds a 2400 x 1800 photo at fit view and
  checks that Cancel restores the canvas exactly. At 100% it checks that the canvas after OK
  matches the preview exactly.

### Measured

The audit's browser harness (`run5.mjs`, production bundles of main 45cbf63f9 and of this change,
installed Chrome at 1440 x 900, run 0 dropped). The photo is the audit's 12 MP JPEG
(4000 x 3000), and the 4096 x 4096 benchmark PNG. "Shown" is input to the preview drawn on the
canvas; "block" is the longest main-thread task. Both are median (range) over every kept step.
The calibration read 37-84 ms against the audit's 36-41, so the PC was slower than in the audit
and the "before" times are about twice the refuter's. Before and after ran on the same harness
the same evening, so their ratio holds.

| Photo | Step | Before: shown / block | After: shown / block | Chrome peak, before / after |
|---|---|---|---|---|
| 12 MP | Brightness (6 steps x 5 runs) | 401 (220-664) / 381 (max 644) ms | **54 (48-81) / 0 (max 56) ms** | 1.66 / 1.21 GB |
| | Levels Gamma (3 x 5) | 680 (555-873) / 477 (max 596) | **42 (39-55) / 0 (max 0)** | 1.78 / 1.09 |
| | Threshold Level (3 x 5) | 882 (725-1,565) / 679 (max 1,254) | **65 (55-78) / 0 (max 58)** | 1.73 / 1.01 |
| | Posterize Levels (3 x 3) | 422 (362-694) / 402 (max 674) | **62 (51-80) / 0 (max 57)** | 1.61 / 1.13 |
| 4096 x 4096 | Brightness (6 x 4) | 295 (166-499) / 276 (max 480) | **33 (31-41) / 0 (max 0)** | 1.78 / 1.36 |
| | Levels Gamma (3 x 4) | 426 (338-961) / 318 (max 703) | **36 (28-77) / 0 (max 55)** | 1.79 / 1.21 |
| | Threshold Level (3 x 4) | 533 (463-663) / 445 (max 560) | **33 (31-36) / 0 (max 0)** | 1.70 / 1.11 |
| 12 MP | Gaussian Blur radius (3 x 2, before and after alternated) | 3,068 (2,795-3,361) / 3,047 | 2,879 (2,687-3,320) / 2,858 | 1.91 / 1.55 |

Every pointwise step now shows within the 100 ms budget, with no block over 200 ms, and Chrome
stays under 1.5 GB. Neighbourhood filters are no slower than before and use less memory, but at
12 MP they still block for the whole filter: Gaussian Blur about 3 s, Halftone about 2 s, and
Median about 70 s per step in Node on both trees. Previewing them inside the budget needs a
worker with progress and Cancel, which this amendment leaves open.
