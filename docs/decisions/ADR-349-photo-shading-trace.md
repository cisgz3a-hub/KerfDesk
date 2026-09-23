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
