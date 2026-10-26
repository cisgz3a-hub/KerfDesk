## ADR-438 Amendment 3 - The sketch window stays a whole number of pixels on a tapered grid (2026-10-22)

**Status:** Accepted. Amends ADR-438 Decision 3 (the supersample taper). | **Date:** 2026-10-22

### Context

Rolling audit v2, finding 07-P2-1. The Sketch, automatic-detail and Faint lines masks compare
each pixel with the mean of an 8 source-pixel box around it. On a supersampled grid the box
scales with `pixelScale`. ADR-438's taper made that factor fractional (for example 1.10, 1.51 or
1.82) for sources of about 0.75 to 1.5 MP. The box was then read from the integral image at
fractional indices. A typed array returns `undefined` there, and `?? 0` turned every corner into
0, so every interior box counted as empty.

Measured on this base:

- **Line + fill with Detection: Sketch** on a 2 px pen drawing (three circles and a diagonal)
  traced the drawing at 840 px (exact 2x) and 1050 px (native). At 900, 950 and 1000 px (1.82,
  1.51 and 1.10x) it traced only one `#000000` path: a corner triangle.
- **Line Art**, the Free default, auto-promotes a colour logo to the local-contrast mask. On a
  1100 to 1200 px logo (1.83, 1.59 and 1.28x) it traced 28, 24 and 32 rings against 17 on the
  exact 2x grid. The extra rings included a corner triangle at 1100 px. These traces took 40 to
  76 s against 8 s, because the contour support restore patched the nearly empty mask.

Edge Detection's window (`local-contrast-mask.ts`) already rounded its radius, so it was not
affected.

### Decision

1. The sketch, automatic-detail and Faint lines window is `sketchWindowRadiusPx`:
   `max(1, round(8 x detector window scale))` working pixels. The detector window scale is
   `pixelScale`, times the commit ratio of ADR-409 Amendment 2. Every reader of this window uses
   the same value: the sketch mask, its crack field, automatic detail, Faint lines and the
   region-enhance context. Where 8 x the factor was already whole (8, 10, 12, 16, 20 px at 1,
   1.25, 1.5, 2, 2.5x), the radius is unchanged.
2. `localMean` reads the integral image without a fallback. A read off the grid gives NaN, and
   that throws a `RangeError` instead of counting as an empty box. Any future fractional or
   out-of-range box then fails the tests instead of silently erasing ink.

### Consequences

- The three sizes in the taper band now trace the pen drawing, with 4.02 to 4.09 x n of stroke
  (the drawing has 4.03 x n). Up to two filled blobs remain where two strokes cross at a shallow
  angle, and none sits in the corner. The colour logo traces 17 rings at 1100, 1150 and 1200 px,
  as at 1000 px, in 6 to 10 s.
- Traces whose window was already whole are unchanged, because the rounded radius equals the old
  one there.
- Not part of this amendment: audit 07-P3-1 (Line + fill uses the fractional taper, so its
  strokes can sit up to 0.3 px off centre and split into width groups).

### Verification

`src/core/trace/sketch-window-tapered-grid.test.ts` covers four things:

- the rounded radii at whole and tapered factors;
- the Sketch mask of Line Art, Smooth and Line + fill, and the Faint lines mask of Line Art, on a
  2 px line page, keeping every ink pixel at pixel scales 1.10, 1.51, 1.70, 1.82 and 2. Before
  the fix, Line Art + Sketch kept 196 of 5638 at 1.7;
- Line + fill with Sketch on the pen drawing at 840, 900, 950, 1000 and 1050 px;
- each plan's factor, so that the tapered sizes really are fractional.

`src/core/trace/sketch-window-colour-logo.test.ts` covers Line Art on the colour logo at 1100,
1150 and 1200 px against the 1000 px trace.
