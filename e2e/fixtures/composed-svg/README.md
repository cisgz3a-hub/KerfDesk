# Composed SVG browser fixtures

These three unchanged SVG files were generated for the 2026-09-23 composed-artwork
audit (`reports/svg-roundtrip-fixtures`). They contain actual 8×6 RGB PNG bytes,
not a placeholder image.

| Fixture | Expected artwork | Physical extent |
| --- | --- | --- |
| `composition-mixed.svg` | Two vectors and two images in authored stacking order | 1100 × 250 mm, larger than the default bed |
| `composition-clipped-image.svg` | One image, no helper artwork | 80.16174074164522 × 60.48931025860187 mm |
| `composition-visible-mask.svg` | The mixed composition plus a deliberately visible vector mask | 1100 × 250 mm |

The first image has local bounds `[-2, 4]` to `[38, 34]`, both-axis mirroring,
31° rotation, unequal scales 2 and 0.75, and translation `(-80, 35)`. Its compound
even-odd clip contains a hole and intersects an ancestor clip. The mixed fixture
also has negative coordinates, a filled vector with a hole, an open stroke, and
an overlapping second image. Import translates the composition as a unit. On the
default 400 mm bed, the two 1100 mm compositions fit uniformly to 360 mm wide,
preserving relative registration. The first Undo restores the authored 1100 mm
size and the second removes the whole file. Redo restores both stages. The small
clipped-only image retains its authored size and takes one Undo to remove.

The browser test uses the ordinary Import and SVG Export commands with the
existing picker fixture. Document parsing runs in a real browser Worker; no
parser or store mutation is substituted. Escape cancellation holds the second
native bitmap decode until the key is pressed, then resumes the real decoder.
The clear-project helper is used only between independent import attempts.

After undoing any automatic fit, exported SVG is rendered at matched authored
dimensions with Chromium's native SVG implementation independently
of KerfDesk's parser and renderer. Fewer than 0.01% of pixels may differ by over
12 levels in any RGBA channel, allowing subpixel clipping antialiasing. Separate
workspace samples compare visible pixels, the hole, and both clip boundaries
against a native SVG reference over the same empty-canvas background. Screenshots,
SVG output, project data, worker URLs and pixel metrics are retained as test
artifacts. This verifies browser rendering, not interchange in an external editor
or hardware output.

SHA-256 source identities:

```text
784d63d7e48f1956fd09464fae4272fb7ceeaed7174516e05182c9a39da67a8d  composition-mixed.svg
771e70fe9df7f1598f4692f30707dfb7fed2d0d8f00bf56d010d8bb578b1850d  composition-clipped-image.svg
6078fcff85fcfa6288383f0e8334920e169eada37d5dfd3cf331e864e47d9cd2  composition-visible-mask.svg
```
