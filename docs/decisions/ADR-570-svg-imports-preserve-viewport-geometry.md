## ADR-570 - SVG imports preserve viewport geometry

**Date:** 2026-10-07

**Status:** Accepted. Amends ADR-046's physical-size mapping.

**Context.** Competitor-derived audit I1 reproduced a root SVG square becoming a rectangle because the importer always used independent X/Y scales. The existing test encoded that result without requesting `preserveAspectRatio="none"`. A nonzero root viewBox origin also shifted physical artwork instead of mapping it into its viewport.

**Decision.** A root with a valid viewBox and at least one positive declared physical dimension maps its viewBox into a millimetre viewport using SVG's `preserveAspectRatio`: default `xMidYMid meet`, explicit alignment/meet/slice, and independent stretching only for `none`. A missing physical axis is inferred using the viewBox aspect ratio. Geometry and fragment bounds share this mapping. Zero-sized viewBoxes or declared dimensions render no artwork.

ViewBox-only files keep the documented one-user-unit-per-millimetre convention, including their coordinate origin. Files without a viewBox keep CSS pixels at 96 DPI. This changes import fidelity and adds no entitlement, Frame, Start, or controller-setting gate; current spatial Frame evidence and exact executable review remain governed by ADR-565.

**Verification.** Fallback and worker regressions exercise default aspect, explicit stretching, nonzero origins, alignment, slice, inferred axes, disabled roots, and the existing millimetre convention. Independent browser rendering supplied the audit's geometry oracle. Source/test results do not qualify a physical machine or released build.

**Source.** [SVG 2 viewport transform](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform).
