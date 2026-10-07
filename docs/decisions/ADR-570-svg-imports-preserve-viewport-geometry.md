## ADR-570 - SVG imports preserve viewport geometry

**Date:** 2026-10-07

**Status:** Accepted. Amends ADR-046's physical-size mapping and extends ADR-358 Amendment 2's visible-artwork clipping.

**Context.** Competitor-derived audit I1 reproduced a root SVG square becoming a rectangle because the importer always used independent X/Y scales. The existing test encoded that result without requesting `preserveAspectRatio="none"`. A nonzero root viewBox origin also shifted physical artwork instead of mapping it into its viewport. I2 reproduced invisible artwork outside nested SVG and symbol viewports importing as executable geometry because their overflow clipping was ignored. Browser rendering also confirmed that a clip directly on a viewport element must use its content coordinate system.

**Decision.** A root with a valid viewBox and at least one positive declared physical dimension maps its viewBox into a millimetre viewport using SVG's `preserveAspectRatio`: default `xMidYMid meet`, explicit alignment/meet/slice, and independent stretching only for `none`. A missing physical axis is inferred using the viewBox aspect ratio. Geometry and fragment bounds share this mapping. Zero-sized viewBoxes or declared dimensions render no artwork.

ViewBox-only files keep the documented one-user-unit-per-millimetre convention, including their coordinate origin. Files without a viewBox keep CSS pixels at 96 DPI. This changes import fidelity and adds no entitlement, Frame, Start, or controller-setting gate; current spatial Frame evidence and exact executable review remain governed by ADR-565.

Viewport `overflow` joins the existing clip chain as the viewport's exact rectangle, transformed from parent space before the viewBox mapping. Nested `<svg>` and instantiated `<symbol>` default to hidden overflow; a standalone root defaults to visible. Explicit `hidden` and `scroll` clip, while `visible` and `auto` render overflow. Presentation attributes, supported stylesheet rules, inline style, and CSS-wide inheritance/initial keywords resolve through the existing cascade. An explicitly visible child retains any ancestor clip.

Viewport clips intersect ordinary clip paths for vector fills, ordered cut lines, and owned image clips. Fully contained native curves stay unchanged; cut curves use the existing 0.025 mm tolerance. A clip owned by a viewport uses its mapped content space. Its object bounding box is measured from the instance's complete child geometry before viewport or other clipping, with the instance viewport passed explicitly to the bbox reader and cache. Inherited clips retain their owner's coordinate system. Clip rectangles never become separate imported artwork.

**Verification.** Fallback and worker regressions exercise default aspect, explicit stretching, nonzero origins, alignment, slice, inferred axes, disabled roots, and the existing millimetre convention. Viewport clipping regressions cover default/explicit/CSS overflow, explicit root clipping, transformed and intersected nested viewports, symbol and SVG instances, pre-clip object boxes, wholly hidden artwork, boundary lines, contained/crossing curves, and transformed embedded images. Independent browser rendering supplied the audit's geometry and own-clip composition oracle. Source/test results do not qualify a physical machine or released build.

Chrome 153 confirms viewport-owned user-space clip placement and differently sized object-box instances. It drops the same element's implicit overflow clip in the object-box and sliced-symbol controls: the object-box example paints `x=20..40, y=10..50`, where SVG 2's viewport intersection keeps `x=20..30, y=10..30`. Those intersection expectations follow the specification and are not browser-matched evidence. The own-clip coordinate-space correction and this rendering discrepancy are separate observations.

**Sources.** [SVG 2 viewport transform](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform), [SVG 2 overflow](https://www.w3.org/TR/SVG2/render.html#OverflowAndClipProperties), and [SVG 2 object bounding boxes](https://www.w3.org/TR/SVG2/coords.html#BoundingBoxes).
