## ADR-093 Amendment 2 - Material presets carry the scan pattern (2026-11-12)

**Status:** Accepted on 2026-11-12 |
**Amends:** ADR-093 (material presets), with ADR-492 (image scan angle, cross-hatch, angle per
pass) and ADR-699 (fill ramp)

### Context

Oracle audit O1, area O9, finding O9-P2-1. A material preset (`MaterialRecipe`) held power, speed,
passes, interval, dither and the other fields listed in `MATERIAL_RECIPE_FIELDS`, but not five
settings added later to operations: the Image scan angle, Image cross-hatch, angle change per pass
(ADR-492), and the Fill ramp length and outer-edge switch (ADR-699). Applying a preset spread the
recipe over the operation, so those five stayed as the operation had them, and saving a preset left
them out.

Each one changes how a burn is laid down. With Image cross-hatch on, every pass scans twice, at
the scan angle and 90 degrees from it, so a plain Image preset applied to a cross-hatched operation
burned each pass twice. A preset saved from a cross-hatched operation burned half as much when
applied elsewhere. Worse, the app said the operation already matched the preset: `recipeMatchesLayer`
compared only the recipe fields, so Apply did nothing, a linked preset's snapshot recorded the
cross-hatch, and Apply Best Recipes reported the operation as already current.

LightBurn's Material Library stores a layer's whole Cut Settings: a preset is created "from layer"
and re-applied as a set (docs.lightburnsoftware.com, Reference > Material Library), and the `.clb`
files it writes hold cross-hatch and angle with the rest. ADR-415 and ADR-494 left perforation,
overcut and tabs out of presets on purpose, as design choices. ADR-492 and ADR-699 said nothing
about presets, and the five settings above decide energy and scan direction, not the design.

### Decision

1. `MaterialRecipe` gains five optional fields: `imageScanAngleDeg`, `imageCrossHatch`,
   `passAngleStepDeg`, `fillRampLengthMm` and `fillRampOuterEdge`
   (`src/core/material-library/recipe-scan-pattern.ts`). They are part of `MATERIAL_RECIPE_FIELDS`,
   so the Apply preview, `recipeMatchesLayer` and the linked-preset checks compare them.
2. A recipe holds each one only while it is on, as an operation does: an angle that folds to 0
   (0, 180, absent) is left out and a negative one is stored folded into [0, 180); cross-hatch and
   the outer-edge switch only when true; the ramp only when longer than 0, and its outer-edge switch
   only with it. Capture, normalisation and library loading all write this form.
3. Applying a preset turns off any of the five the preset does not hold. An older preset, saved
   before this amendment, therefore applies with no cross-hatch, scans along X, keeps one angle for
   every pass and has no ramp, as the operation it was saved from did when those settings were
   absent.
4. Library loading rejects a preset whose scan pattern field has the wrong type, a non-finite angle
   or a negative ramp, as it rejects any other invalid recipe field.
5. The Apply preview names the rows "Image scan angle", "Image cross-hatch", "Angle change per pass",
   "Fill ramp length" and "Ramp outer edges", and shows an absent one as Off.

### Consequences

- Applying a preset gives the scan its saver had. An operation whose own cross-hatch or angle was
  wanted keeps it only if the preset holds it; the Apply preview lists each one it turns off first.
- The library schema version is unchanged: the fields are optional, and an older build reading a
  newer library drops them on load (its recipes never held them).
- Not changed: perforation, overcut and tabs stay with the operation (ADR-415, ADR-494); leads
  (ADR-626), automatic overscan (ADR-495) and image overscan stay out of presets too and are listed
  for the maintainer in the O9 report.

### Tests

`src/core/material-library/recipe-scan-pattern.test.ts` (an old cross-hatch, angle and step turn
off; a saved cross-hatch, angle, step and ramp come back; off values are left out; loading validates
the fields); `src/ui/state/material-preset-scan-pattern.test.ts` (Apply over a cross-hatched
operation that otherwise matches now applies, the preview lists Image cross-hatch On to Off);
`material-library.test.ts` (the capture key set includes the five fields).
