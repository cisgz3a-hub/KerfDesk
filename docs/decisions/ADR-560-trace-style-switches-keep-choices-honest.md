## ADR-560 - Trace style switches say which kept adjustments apply and keep Enhance region; Smooth says what it does (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29
**Related:** ADR-113 (Crop and Enhance region), ADR-434 Amendment 1 (overrides across preset
switches), ADR-461 (Colour layers), ADR-559 (the Trace dialog shows what automatic detection
chose).

### Context

The 2026-09-24 tracer audit's dialog package (saved on `claude/tracer-saved-work`) also held hint
and wording fixes. Re-measured on main `e5f0a266b` with ADR-559's port applied:

- Most control hints were already rewritten on main (ADR-437's Sensitivity and Detail, ADR-455's
  Remove ink specks), so those saved fixes were dropped. One remains: the tracer rounds Ignore
  Less Than to whole pixels, but its box kept showing a typed 2.5 while 3 was traced (Remove ink
  specks already shows the rounded value).
- The dialog keeps one set of overrides across trace styles (ADR-434 Amendment 1). **Settings
  edited** appeared whenever any override existed, including ones the selected style has no
  control for (Sensitivity kept from Edge Detection while Line Art is selected, a Join gaps value
  kept from Centerline) and the preset's own Detection chosen again. The hint under the preset
  said "Your adjustments stay when you switch styles", although a new preset's own settings
  replace overrides of them.
- Selecting Photo shading or Colour layers set the Boundary to Crop region for good, so an
  operator who had chosen Enhance region lost it on returning to a line style. With Colour
  layers selected the Boundary note still said "Photo shading traces only the boxed region. Use
  Detail to refine its shading."
- Smooth's description ("Clean curves and quieter outlines for rough or noisy artwork. Very fine
  gaps may close.") named no real difference from Line Art: both use Smoothness 1. Smooth differs
  by cutting at a threshold it sets from the image (Otsu) and by a median that repairs isolated
  noise pixels only when at least 0.4% of the image is such noise, leaving connected ink alone
  (`autoMedianFilter`).

### Decision

1. **Settings edited follows the adjustments the style uses** (`trace-setting-edits.ts`). A style
   uses the overrides of the controls its panel shows: Photo shading its tone controls; Colour
   layers its colour controls and Remove specks; Edge Detection Sensitivity, Detail, Minimum line,
   Invert, Smoothness, Optimize and the alpha mask; the filled styles Detection, Invert, the speck,
   hole and area controls, Curve finishing, Diagonal contacts where offered, Join gaps and Max
   stroke width where offered, and the alpha mask. Cutoff and Threshold count only in Manual
   detection or under the alpha mask; under the alpha mask Invert stands down. **Settings edited**
   shows when the used overrides change the options the style traces with (a Line + fill stroke
   width counts whenever set, because the dialog converts it outside the merge).
2. **Kept but unused adjustments are named.** The hint under the preset now reads "Adjustments
   carry over when you switch styles, except those the new style sets itself. Reset trace settings
   restores the selected preset's defaults." and adds "Kept but not used here: …" with the
   controls whose kept values the style, its detection mode or the image ignores. Choosing the
   preset's own Detection is not an adjustment, and the alpha mask is not counted on an image
   without transparency (its panel already says so).
3. **A crop-only style does not replace the Boundary choice.** Photo shading and Colour layers
   trace a boxed region with Crop while selected; the operator's choice is kept and returns with
   the next style that offers Enhance. The Boundary note names the selected style: "Colour layers
   trace only the boxed region."
4. **Ignore Less Than shows what is traced.** Once a typed value loses focus the box shows the
   whole-pixel area the tracer uses (`snapToStep`, as ADR-437's Edge stops).
5. **Smooth says what it does.** "For scans and noisy artwork. Sets its threshold from the image
   and removes isolated noise dots when the image has many of them." The Trace Image tutorial says
   to try Smooth for a noisy scan, or Sharp to keep single-pixel marks and tiny holes.

### Consequences

- Traced output does not change; only what the dialog says and which Boundary mode a line style
  traces with after a visit to a crop-only style.
- A Re-trace still records the Boundary mode that traced, so a Photo shading trace records Crop.
- `OVERRIDE_LABELS` is keyed by every override, so a new override needs a label before it
  compiles.
- Tests: `trace-setting-edits.test.ts` (preset Detection and unchanged values are no edit; a kept
  band counts only in Manual; Edge, Line Art, Centerline, Photo shading and Colour layers name the
  kept controls they ignore; the alpha mask counts only with transparency; Max stroke width) and
  `ImportImageDialog.style-switch.test.ts` (Enhance region returns after Photo shading and Colour
  layers, with each style's note; Settings edited clears when Detection returns to the preset's
  and after leaving Edge Detection, which names Sensitivity; Smooth's description) and
  `ignore-less-than-snap.test.tsx`.
