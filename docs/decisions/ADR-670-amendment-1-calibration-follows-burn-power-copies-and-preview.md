## ADR-670 Amendment 1 - Tone calibration follows the photo's burn power, Copy settings and Preview (2026-10-27)

**Status:** Accepted. Amends ADR-670 Decision items 2, 6 and 7 and "Verification and limits". Fixes
rolling audit v3 findings G1-P3-2, G3-P3-2 and G9-P2-1 (all P2). Frame, Start, output policy and
licences are unchanged. | **Date:** 2026-10-27

### Context

Three paths did not keep ADR-670's promises.

1. **Power multiplier (G1-P3-2).** A photo's power multiplier (Advanced artwork settings) scales its
   operation's power and grayscale minimum when it compiles (`effectiveObjectPowerPercent`,
   `compile-job-raster.ts`). Both Tone Calibration seeds, Tools → Calibrate with the photo selected
   and the Photo engraving window's **Calibrate a material…**, took the operation's power unscaled.
   A 60% operation with a 25% multiplier burned the wedge at S600 while the photo burned at S150. The
   "measured with a different power" notice compared the same unscaled power, so it stayed silent on
   that wedge and flagged one measured at the photo's real 15%. Item 2 says the wedge measures "the
   raw response to those exact settings"; item 7 promises the notice.
2. **Copy and Paste settings (G3-P3-2).** The operation clipboard kept its own list of settings,
   which never gained `photoToneCurve`. A process recipe saved from a calibrated photo puts the curve
   on an operation (item 6 names recipes), so the path is reachable. Pasting a calibrated operation
   left the target uncorrected (about 47% more total S in the audit's repro), and pasting an
   uncorrected one over a calibrated one changed nothing and added no Undo step. Item 6 says curves
   are "captured by operation-settings copies".
3. **Preview (G9-P2-1).** The cached Preview canvas was keyed on every setting that changes its grid
   except the curve. After a curve was applied or changed, Preview kept drawing the old tones while
   the G-code burned the corrected ones. "Verification and limits" lists Preview among the views that
   show a calibration.

### Decision

1. **The wedge burns at the photo's burn power.** Both seeds take the photo's effective operation
   with its power and grayscale minimum power multiplied by the photo's power multiplier
   (`photoBurnSettings`, using `effectiveObjectPowerPercent` and `effectiveObjectMinPowerPercent`),
   as the compile does. Process recipes already capture power this way. The wedge's Power field
   shows that power rounded to two decimals, because a power times a multiplier can carry float
   noise. While the field is unchanged, the wedge keeps the exact value, as the DPI field already
   does. The Photo engraving window checks a chosen calibration against the same burn power. A photo
   without a multiplier seeds and checks exactly as before.
2. **Copy settings carries every operation setting.** The clipboard reads the scene's own list,
   `LAYER_OPERATION_SETTING_KEYS` (the settings `layerOperationSettingsEqual` compares), instead of
   a second list. It still adds visibility, output, sub-operations, the material binding and the CNC
   setup. It now carries the tone curve. It also carries the per-operation scan offset
   (`bidirectionalScanOffsetMm`, `allowUncalibratedBidirectionalScan`), which a material preset or a
   scan-offset coupon can set and which the second list had also missed. A setting the source leaves
   unset is cleared on the target, as ADR-494, ADR-492, ADR-495 and ADR-626 already do for theirs.
   So pasting an uncalibrated operation removes a curve, and power mode follows the source. Curves
   compare by value. A paste that changes anything adds one Undo step; one that changes nothing adds
   none.
3. **Preview keys its canvas on the curve.** The cached Preview canvas key includes the effective
   curve's points. An absent or identity curve keys as none. The label is left out, because it
   changes no pixel. Applying, changing or removing a curve rebuilds Preview, so it shows the tones
   the G-code burns. The other operation settings that change the Preview grid were already keyed:
   adjustments and sharpening, Negative, Pass-through, dither, power range and multiplier, density,
   scan angle, transform and mask. Dot width correction and scan offsets act when G-code is written
   and do not change the Preview grid.

### Consequences

- A project's emitted G-code is unchanged, so `EMITTER_REVISION` does not move. A wedge generated
  for a photo with a power multiplier now burns at that photo's power.
- A calibration saved earlier for a photo with a multiplier was measured at the unscaled power. The
  Photo engraving window now says it was measured with a different power, which is true.
- Tests: `tone-calibration-seed.test.ts` (Tools seed at the burn power, with an artwork override and
  without a multiplier; rounded display, exact burn), `PhotoEngravingDialog.tone-power.test.tsx`
  (notice silent at the burn power, shown at the unscaled power; **Calibrate a material…** seeds the
  burn power), `layer-settings-clipboard.test.ts` (curve pasted and cleared, each with one Undo step;
  an equal curve adds none; scan offset and power mode follow the source) and
  `draw-raster-preview-processing-overrides.test.ts` (Preview rebuilds for an override or operation
  curve and matches the compiled S; a renamed curve reuses the canvas).
- These are code and test results. No wedge was burned and no controller was operated.
