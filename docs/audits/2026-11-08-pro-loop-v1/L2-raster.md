# Pro loop v1 — L2 Raster engraving

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108` from `origin/main` `5f09e1110`
- **Scope:** `src/core/raster/emit-raster*.ts`, `dither*.ts`, `raster-power-values.ts`,
  `src/core/output/grbl-fill-emission.ts`
- **Lenses run:** L2 (LightBurn Image Mode), L3 (pixel grid against emitted rows), L4 (scan angle,
  Negative, Dot Width Correction).
- **Counts:** 0 raised.

## Headline

A 100 × 20 px image of ten grey bands (luma 0 to 255), placed at 50 × 10 mm, burned where and as dark
as LightBurn's documentation says it should, for every dither algorithm tried.

## Measurements

2 lines/mm, 3000 mm/min, 80 % max, 10 % min (Grayscale).

| Variant | Rows | Burn duty per band, dark → light | Mean S per band |
|---|---|---|---|
| Grayscale | 20, at pixel-row centres 290.25 … 299.75 | 1.0 × 9, white 0 | 800 723 644 567 490 410 333 256 177 0 |
| Grayscale, Negative | 20 | white first | mirror of the above |
| Threshold | 20 | 1 1 1 1 1 0 0 0 0 0 | 800 |
| Floyd–Steinberg | 20 | 1.00 .90 .79 .68 .53 .46 .32 .23 .10 0 | 800 |
| Jarvis / Stucki / Ordered | 20 | within ±0.05 of the band's darkness | 800 |
| Atkinson | 20 | loses the two lightest bands | 800 |
| Scan angle 90° | 90 columns | — | — |

- **Tone mapping.** Band 8 (luma 227) burns at 177 = 10 % + (28/255) × 70 % of S1000, the linear
  min–max map LightBurn documents: "using Min Power for the lightest shades and Max Power for the
  darkest" ([LightBurn Image Mode, 2.2 docs](https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/),
  fetched 2026-11-08). Pure white is skipped, which is how KerfDesk's ADR-649 Amd 1 also treats it.
- **Direction.** Rows run from the image's bottom to its top, as LightBurn documents for Scan Angle 0.
- **Dot Width Correction 0.1 mm.** Each burned run is trimmed 0.1 mm at each end. LightBurn's ideal
  value is "about half the total thickness of the laser's beam", and the beam over-burns a run's end by
  half its width, so trimming each end by the value is the matching behaviour.
- **Atkinson** diffuses only 6/8 of the error by design, so its highlight loss is the algorithm, not
  a defect.

## Verified clean

Row placement, tone map, Negative, scan angle, Dot Width Correction, dither duty.

## Not verified

Bidirectional scan-offset tables at speed, image overscan sizing (ADR-495) and the Marlin raster
paths; each has its own suite.
