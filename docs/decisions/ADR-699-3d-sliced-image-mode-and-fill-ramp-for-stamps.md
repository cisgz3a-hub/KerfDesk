## ADR-699 - 3D Sliced image mode and Fill Ramp for rubber stamps

**Status:** Accepted (maintainer request, 2026-11-10: a competitor scorecard rated raster engraving
8/10 against LightBurn's 9, mainly for a missing LightBurn-style 3D slice and stamp ramp, and the
maintainer asked for all the gaps to be built). Follows the standing rule to research what LightBurn
does and copy it. Builds on ADR-020 (raster engrave), ADR-243 (streamed rasters), ADR-492 (scan
angles and passes) and ADR-649 (adding a dither mode). Project schema 23. | **Date:** 2026-11-10

### Context

LightBurn has two depth tools KerfDesk lacked:

- **3D Sliced** (Image mode; LightBurn 2.2 guide "3D Sliced Image", Cut Settings Editor "Image
  Mode"). The image is a depth map: "a pixel's brightness represents depth, rather than shading".
  Number of Passes splits it into layers. Lighter pixels are engraved on fewer passes than darker
  ones, white on none, and the darkest on every pass. LightBurn's preview shows the burned area
  growing pass by pass. Negative Image inverts the depth. A large pass count may need lower power.
  LightBurn offers it on galvo lasers only.
- **Ramp Length** (Fill mode, Advanced; Cut Settings Editor "Fill Mode"). This slopes the sides of
  an engraving by varying power, for rubber stamps whose thin raised parts need support. Min Power
  is the ramp's floor, and Min and Max must differ. **Ramp Outer Edge** slopes the outside too, and
  LightBurn advises leaving it off for stamps. A Ramp Length of 0 disables it.

A search of `src/core` found no laser fill ramp. Every "ramp" there is a CNC plunge ramp. The
nearest thing is Tools → Prepare Stamp (`stamp-height.ts`), which exports a tapered height PNG and
burns nothing itself.

### Decision 1 - 3D Sliced is an Image dither mode

- `'3d-sliced'` joins `DITHER_ALGORITHMS`, offered in the Cut Settings dither picker. Every shipped
  build refuses a dither value it does not list (ADR-649), so an older build refuses such a project
  rather than burning it some other way.
- **Passes is the slice count, as in LightBurn.** With N slices, a pixel of darkness d (0 white ..
  255 black, after brightness, contrast, gamma, sharpen, mask, Negative and the tone curve) is in
  `round(N * d / 255)` slices. Pass k (0-based) burns every pixel in at least N − k slices. The
  darkest pixels go first and the area grows each pass, so a pixel is burned on exactly as many
  passes as it has slices. Every burned cell runs at the operation's Power; Min power is not used.
  More than 255 slices repeats some of them, so depth stays proportional (`slice-3d.ts`).
- Compilation (`compile-job-raster-sliced.ts`) emits **one raster group per pass**, each with
  `passes: 1`, in burn order across ADR-492's angle runs. With Cross-hatch both angles of a pass burn
  the same slice. The depth grid is the Grayscale mapping at S 0..255, built once per angle through
  the image's ordinary resample, sharpen, mask and orientation. Below the streaming threshold, with
  W × H × N cells counted, each pass is materialized. Above it, each pass streams its rows from a
  streamed depth provider, which is bit-identical (ADR-243), so memory stays O(width) whatever the
  slice count.
- Pass-Through still burns its pixels as Grayscale, as with every other dither.
- Preview: the processed bitmap and the dither swatch show the whole stack as power proportional to
  slice depth. The compiled preview, the time estimate and the G-code all come from the N groups, so
  each one counts every pass. Job Review's operation line reads "3D Sliced: N passes, one slice
  each, darker burned deeper" (plus "each scanned twice" with Cross-hatch).
- KerfDesk allows it on GRBL-family and Marlin/Smoothie lasers as well as galvo. Each pass is an
  ordinary threshold raster that any of them can run. Only the depth per pass depends on the
  machine and material.

### Decision 2 - Fill Ramp

- Two optional operation settings: `fillRampLengthMm` (absent or 0 is off) and `fillRampOuterEdge`
  (absent is off). Cut Settings shows a **Ramp** group on Scanline and Island fills: Ramp length,
  Ramp min power (the operation's Min power, which a Fill otherwise ignores) and Ramp outer edge.
  The form writes the fields only when they change, so a Fill whose form is applied untouched gains
  no keys. Comparisons treat absent as off, so fill pools and recipes match as before.
- A ramped Fill compiles to a **raster group** at its hatch angle and line interval
  (`fill-ramp.ts`, `fill-ramp-grid.ts`). The cells are at most 0.1 mm along the scan, so an edge is
  placed within 0.1 mm. The filled area is the even-odd fill of the operation's closed contours, the
  rule a scanline Fill hatches with, sampled at each cell centre. Unfilled cells joined to the
  outside of the artwork are the outer side; the rest are holes. Power at a filled cell is
  `Min + (Power − Min) × min(1, distance / ramp length)`, where distance is the exact Euclidean
  distance (`stamp-distance.ts`) from the cell centre to the nearest hole cell, plus outer cells
  when Ramp outer edge is on. A stamp plate with letters cut as holes keeps a square border and
  slopes every letter wall.
- Cross-hatch scans the ramped grid a second time at +90°. Angle per pass reaches it as one
  operation per angle (ADR-492). Follow Shape ignores the ramp (its rings have no scan to grade), and
  the Ramp group is hidden for it.
- Above 8,000,000 cells (about 200 MB of working memory) the Fill burns flat as before, and Job
  Review warns `fill-ramp-too-large` with a hint to raise the line interval. The output is never
  dropped.
- `.rd` export refuses raster groups (`raster-unsupported`), so it refuses a ramped Fill as it
  refuses an image. LightBurn's DSP ramp is done by the controller. Writing it into `.rd` is left
  to the Ruida work (ADR-697).

### Decision 3 - Schema 23

An older build would ignore `fillRampLengthMm` and burn a stamp flat. Schema 23 makes 1.0.31 and
earlier refuse every project this build saves (the ADR-694 pattern). Migration 22 → 23 changes
nothing else, since no earlier file has a ramp. The installer qualification scripts know 22 as a
historical schema and 24 as the future one.

### Consequences

- Existing projects burn byte-identically. Absent or 0, a ramp never reaches the new code, and
  every other dither takes the unchanged path. The returning-user goldens and the G-code snapshot
  suites pin this, and `compile-job-3d-slice-ramp.test.ts` compares a ramp-free Fill's job against
  one written without the fields.
- `emit-gcode-3d-slice-ramp.snapshot.test.ts` byte-pins a four-slice depth map and a ramped stamp
  plate with the outer edge square and ramped. It also asserts that a slice burns at full power
  only, once per slice, and that ramp power stays between Min power and Power.
- Not material-qualified. The depth a slice burns, and the ramp floor that just marks, depend on the
  laser and the stock, as in LightBurn: test on scrap. Nothing here claims a measured depth.
- PROJECT.md's "advanced fill patterns" out-of-scope entry now lists both as shipped.
