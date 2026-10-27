## ADR-670 Amendment 2 - Material presets drop a tone curve, and Photo engraving keeps Grayscale (2026-10-27)

**Status:** Accepted. Amends ADR-670 Decision items 6 and 7 and "Verification and limits", and
ADR-581 Decision 2. Fixes rolling audit v4 findings H5-P2-2 and H5-P2-3 (both P2). Frame, Start,
output policy and licences are unchanged. | **Date:** 2026-10-27

### Context

1. **Material presets (H5-P2-2).** Assign, Link, Refresh and Apply best recipes in the Material
   Library, and the remote `apply_material_recipe`, all apply a preset through
   `applyMaterialRecipe`. It replaced every recipe setting but kept the operation's
   `photoToneCurve`, and the link snapshot recorded that curve as part of the preset. A
   `MaterialRecipe` holds no curve ("Verification and limits"). So a slate preset assigned over a
   Birch-calibrated operation burned slate photos corrected for birch: 32 % to 39 % less total power
   than the preset alone in the audit's repros. Item 7 says a curve belongs to the dither, DPI,
   marking, power and speed it was measured with. The function already dropped the old power mode
   and scan offset for the same reason, and Copy settings clears a curve the source leaves unset
   (Amendment 1).
2. **Grayscale (H5-P2-3).** The wedge offers Grayscale (item 2), and item 5 applies the curve "to
   every dither including Grayscale". But the Photo engraving window, the only place to choose a
   calibration (item 7), offered only the photo dithers and opened a Grayscale photo as Jarvis
   (ADR-581 Decision 2). Choosing a Grayscale calibration said it was "measured with a different
   photo processing", and Apply wrote Jarvis with the Grayscale curve. The audit's ramp then burned
   2 power levels with mean S 201.5, instead of 60 levels with mean S 268.9.

### Decision

1. **Applying a preset removes the operation's tone curve.** `applyMaterialRecipe` drops
   `photoToneCurve` with the power mode and scan offset. A recipe that one day holds a curve will
   set its own. Assign treats an operation that still holds a curve as different from the preset,
   so assigning a preset whose settings already match still removes the curve, as one Undo step. The
   link snapshot no longer records a curve. Before Assign or Link, the Material Library's list of
   setting changes, and the linked-recipe review, show **Tone calibration** going from the curve's
   name to None. A curve in a photo's own settings, where Photo engraving writes it, is untouched:
   presets never reach artwork overrides (ADR-317).
2. **Photo engraving keeps Grayscale.** A photo that burns with Grayscale opens on Grayscale. For
   that photo the picker offers Grayscale beside the photo dithers, still after another one is
   picked, and Apply writes Grayscale. A Grayscale calibration on a Grayscale photo shows no notice.
   Every other mode still starts with Jarvis. A photo that uses a dither is not offered Grayscale,
   because Grayscale modulates power and needs a machine and material that shade (ADR-581).

### Consequences

- Compile is unchanged for the same settings, so `EMITTER_REVISION` does not move. An operation
  that took a curve with a preset loses it on the next Assign, Link or Refresh. A linked operation
  whose snapshot holds a curve loses it on the next Refresh.
- Tests: `material-preset-tone-curve.test.ts` covers Assign, Link and its snapshot, Assign over
  matching settings, and the recipe preview row. Through the real compile, a ramp burns the same
  total S as the preset alone, where it burned 1 936 900 against 2 869 300 before.
  `PhotoEngravingDialog.grayscale.test.tsx` covers a Grayscale photo opening on Grayscale and
  keeping it on offer. It also covers a Grayscale calibration applying with no notice, writing
  Grayscale plus the curve into the photo's effective operation, and a Stucki photo not being
  offered Grayscale.
- These are code and test results. No wedge or photo was burned and no controller was operated.
