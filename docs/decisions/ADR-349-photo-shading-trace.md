## ADR-349 - Photo shading is encoded in filled vector coverage

Date: 2026-09-23
Status: Accepted

### Context

The existing binary and edge presets discard the continuous tones that describe
a photographic face. The old Photo/Detailed presets removed in ADR-043 merely
coloured tone bands grey. Artwork operations and bitmap conversion do not turn
those display colours into corresponding engraving intensity, so restoring them
would not preserve shades through output.

### Decision

Add a **Photo shading** preset with a dedicated, deterministic backend. It averages
source luminance on a bounded grid and varies the width of black filled vertical
lines with darkness. Highlights, midtones and shadows are represented by covered
area. Vertical lines cross the default horizontal Fill scan direction, allowing
each scan row to reproduce the width of a shade without relying on operation
colour or variable power. Transparent pixels composite onto white.

The user can adjust Detail, Brightness and Contrast. Binary detection, alpha-mask
tracing, despeckling, contour supersampling and curve finishing are not applied
to the photo preset; changing presets retains each style's adjustments without
allowing a previous binary threshold to erase the photograph's midtones.

Photo output uses the existing filled-contours scene representation and the same
worker, preview, boundary placement, vector commit and optional raster output
paths. It needs no new dependency or project schema. CNC commits preserve the
reviewed ribbon geometry, because generic contour fairing changes the narrow
widths that carry tone. This adds an actual filled vector photo treatment to
ADR-043; the removed adaptive-colour presets remain absent.

Photo Raster scan conversion opts into coverage sampling: exact pixel overlap
across the ribbon widths, averaged over four samples along their length. The
integration axis follows the source rotation. This preserves thin filled
lines as intermediate pixel shades before the selected Image processing mode
runs. An edge index visits only the edges crossing each sample row, so dense
photos avoid rescanning every vertex for every pixel row. It retains existing
fill rules, rotation and operation binding. Ordinary
Convert to Bitmap and other trace presets keep their existing sampling.

Photo boundaries offer Crop only. The contour preset's Enhance operation replaces
whole enclosed contours, which is unsuitable for lines spanning a photograph.
Changing from Enhance to Photo shading resets the region to Crop.

### Verification and limits

Regression checks cover tone coverage, transparency, detail bounds, deterministic
geometry, preset switching, default Fill output, raster conversion and CNC
commit fidelity. A public-domain NASA portrait provides visual face coverage.

This is a line-halftone treatment. Image mode remains available for continuous
grayscale or dithered photo engraving. Fill spacing, raster resolution, artwork
size, tool width and material response limit reproducible detail. Vector Fill
scanlines must cross the ribbons; rotation can require adjusting scan direction.
The software checks do not qualify a physical engraving or cut. Frame, Start, controller and
power contracts are unchanged.

### Amendment — bounded full-photo raster handoff (2026-09-24)

Full default-detail photographs could exceed the bitmap conversion budget before
the worker started, even at modest raster sizes. The source contained both
polyline points and equivalent line curves, and cloning/flattening those object
graphs dominated the estimate. Lowering DPI could not resolve a geometry-only
budget failure.

Photo raster output now packs its canonical closed straight-edge contours into
transferable Float64 coordinates and Uint32 contour offsets. The worker receives
source metadata separately and uses typed edge, ordering, active-edge and crossing
buffers. This preserves the existing even-odd exact-width/four-subrow coverage
calculation, including rotation and mirroring. Nonlinear, open or nonzero-fill
artwork continues through the ordinary conversion path.

The 64 MiB conversion budget is unchanged. Preflight accounts for all packed
buffers, sorting headroom, the coverage row and bitmap encoding, and distinguishes
geometry-only failures from failures that reducing raster resolution can fix.
For the full 512-pixel reference portrait rendered at 640 by 640 pixels, default
Detail 60 needs an estimated 24.953 MiB and Detail 100 needs 35.189 MiB, down from
112.069 and 193.967 MiB respectively. These are preflight estimates, not measured
whole-application heap peaks. Source vectors and their detail are unchanged.
