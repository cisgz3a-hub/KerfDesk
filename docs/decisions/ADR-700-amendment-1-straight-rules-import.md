## ADR-700 Amendment 1 - A straight horizontal or vertical rule imports (2026-11-11)

**Status:** Accepted. Amends ADR-700 (EPS and Illustrator 3–8 import). Fixes code quality audit C2
finding D1-P2-4. | **Date:** 2026-11-11

### Context

`paintedSvg` (`src/io/postscript/ps-svg.ts`) sizes the SVG it hands to the SVG import from the
declared `%%BoundingBox`, joined with the drawn extent. If the only artwork is one horizontal or
vertical line, the extent is zero on one axis. The SVG then got `height="0mm"` and a viewBox such as
`0 0 80 0`, which the SVG import reads as nothing drawn. The file was refused with "has no drawable
content" and nothing was inserted. The same happened to two collinear rules, to a thick stroked rule
(the stroke width is not part of the extent), and to a file whose declared box is itself zero-height.

### Decision

An axis of the box with no size grows around its centre to the thickest stroke in the file, and to at
least 1 pt. The points keep their 1:1 scale, so the artwork's size and position relative to each
other are unchanged; only the canvas around them grows. Boxes with both dimensions are unchanged, so
every file that imported before produces the same SVG.

### Verification

`src/io/postscript/convert-postscript.test.ts` covers, each through `parseSvg`:

- a horizontal rule;
- a vertical `rlineto` rule;
- two collinear rules;
- a 10 pt rule, whose canvas is 10 pt tall;
- a zero-height declared box.

A file whose box has both dimensions keeps its viewBox.
