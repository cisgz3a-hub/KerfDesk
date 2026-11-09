## ADR-574 Amendment 1 - SVG artwork reads its transforms as a browser does, and says when it cannot (2026-11-09)

**Status:** Accepted on 2026-11-09 |
**Amends:** ADR-574 (SVG imports preserve viewport geometry), whose Consequences left "CSS unit
policy" and CSS transforms unchanged, under PROJECT.md non-negotiable 6 (explicit unit conversion
at the import boundary). The clip refusals of ADR-358 Amendment 2 item 4 are unchanged.

### Context

Rolling audit v2 finding 14-P3-1: the SVG importer misread CSS transforms on artwork. Rolling
audit v11's W5 refuter re-rated it P1 under the J6-P1-1 precedent (METHOD §3, 2026-10-27): a
browser draws the element in one place, KerfDesk burned it in another, and nothing said so.

- `style="transform: translateX(20px)"`, `style="translate: 20px 0"` and a `<style>` rule
  `transform: translateY(20px)` put a 10 mm square at 20..30 mm in Chromium, but KerfDesk put it
  at 0..10 mm with `notes: []`. The `transform` value went to the SVG attribute reader, which made
  an unknown function the identity and dropped units; `translate`, `rotate`, `scale`,
  `transform-origin` and `transform-box` were never read for artwork.
- The same reader was too lenient on the attribute. Chromium 156 holds the `transform`
  **attribute** to the SVG 1.1 list grammar: `rotate(0.25turn)`, `translate(20px)`,
  `translateX(20)`, `skewx(30)` or a trailing `bogus(3)` void the whole attribute, so the element
  draws untransformed. KerfDesk applied what it could pick out (0.25° for the `turn`, 20 for the
  `px`), which is a silent position error too. (The refuter's "`rotate(0.25turn)` → 90°" row was
  not a browser measurement; the attribute draws unrotated.)

Ground truth: Chromium 156 (Chrome for Testing headless shell, build 1248, every network request
aborted) reported `getBoundingClientRect` for 178 elements, one user unit per CSS px. The tests
carry 160 of those boxes, re-checked against the browser after they were written.

### Decision

1. **One transform per element, in CSS order.** An element's own transform is
   `T(origin) · translate · rotate · scale · transform · T(-origin)` (CSS Transforms 2,
   "current transformation matrix"; SVG 2 makes `transform` a presentation attribute of that
   property). The artwork walk and the object-bounding-box measure both use it
   (`io/svg/svg-element-transform.ts`).
2. **The CSS `transform` property** reads every CSS Transforms 1/2 function: `matrix`,
   `matrix3d`, `translate[X|Y|Z|3d]`, `scale[X|Y|Z|3d]`, `rotate[X|Y|Z|3d]`, `skew[X|Y]` and
   `perspective`. Lengths take `px` (one user unit), `in`, `cm`, `mm`, `Q`, `pt` and `pc`;
   translations take a percentage of the reference box; angles take `deg`, `grad`, `rad` and
   `turn`; `scale` takes a percentage. Names and units are case-insensitive. As in CSS, a bare
   non-zero number is not a length or an angle, arguments need commas, and functions do not.
3. **3D flattens as a browser draws SVG.** The 4×4 result is reduced to its 2D affine part
   (Chromium's `ToAffineTransform`), so `rotateX(60deg)` halves the height, `translateZ` and
   `perspective` change nothing, and the z and w terms of `matrix3d` are dropped.
4. **`translate`, `rotate` and `scale`** are read as CSS properties only (an attribute of that
   name does nothing): `translate: x [y [z]]`, `rotate: [x|y|z|<n n n>] && <angle>`,
   `scale: <n|%>{1,3}`.
5. **`transform-origin`** reads one to three values, keywords in either order, from CSS or the
   presentation attribute, where a bare number is in user units. SVG content starts at `0 0`; the
   CSS-wide `initial` and `unset` mean `50% 50%`, and `revert` returns to `0 0`.
6. **`transform-box`** (CSS only): `view-box`, the default, is the nearest viewport's viewBox size
   from the user-space origin; `fill-box` and `content-box` are the element's object bounding box
   in its own user space, before a `<use>`'s x and y as Chromium measures it. One import measures
   at most 256 fill boxes (`SVG_FILL_BOX_MEASURE_LIMIT`), nested ones included.
7. **The attribute is the SVG 1.1 list.** Case-sensitive names, numbers only, the arities of
   SVG 1.1, one optional comma between functions and none at the end. Anything else voids the
   whole attribute, as in Chromium. A clip shape's transform uses the same reader and still
   refuses the file when it cannot be read.
8. **Invalid values fall back, as CSS does.** An invalid style declaration gives way to the
   presentation attribute, an invalid attribute to no transform. `inherit` takes the parent's
   winning declaration, including through a `<use>`.
9. **Nothing moves silently.** Each imported element under a transform a browser also ignores is
   counted in a warning toast:
   `SVG presentation: Imported N SVG element(s) without a transform value that a browser also ignores as invalid, such as a transform attribute with units or turn angles (only the CSS transform property accepts those). Check their placement against the design.`
   Valid CSS the importer cannot evaluate is approximated and counted in another: a font-, line-,
   viewport- or container-relative unit, `calc()`, `var()` and the other math and substitution
   functions leave that property out; `stroke-box`/`border-box` uses the fill box; a nested
   `<svg>`'s or `<symbol>`'s fill box, and fill boxes past the budget, use the view box.
   `SVG presentation: Imported N SVG element(s) with a CSS transform KerfDesk could only approximate (such as font- or window-relative units, calc() or var(), or a stroke-box reference box); a browser may place them differently. Check their placement against the design.`

### Consequences

- A file whose transform **attribute** carried units or `turn` angles used to import transformed
  and now imports untransformed with a warning, as browsers and design tools draw it. A non-finite
  value such as `translateX(1e400px)` counts as invalid; Chromium clamps it about 33 km away.
- A root `<svg>` transform still applies inside the viewBox mapping (ADR-574, unchanged); a
  browser moves the root's own box with it. That is a separate question.
- Readers are single linear scans (ADR-268 Amendment 2). An element with no transform property and
  no `transform-origin` attribute skips the CSS path, so `<use>` fan-outs cost what they did.
- Code and test evidence: `io/svg/parse-svg-css-transforms.test.ts`,
  `io/svg/parse-svg-transform-origin.test.ts` (each case on the main-thread fallback, worker-text
  and worker-stream routes) and `io/svg/svg-css-transform.test.ts`. Chromium boxes are a headless
  browser's measurement, not a burn.
