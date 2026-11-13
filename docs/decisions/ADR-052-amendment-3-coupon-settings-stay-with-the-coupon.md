## ADR-052 Amendment 3 - Coupon settings stay with the coupon (2026-11-13)

**Status:** Accepted on 2026-11-13 |
**Amends:** ADR-052 (scanning offset calibration), with ADR-357 (reusable processes) and ADR-093
(material presets)

### Context

Tools audit T1, tool T04 (Scan Offset Test), findings T04-P2-1 and T04R-P3-1. The Scan Offset Test
coupon marks each swatch's operation `scanOffsetCalibrationMode` (`baseline` or `verification`). A
baseline swatch also sets an explicit 0 mm `bidirectionalScanOffsetMm` and
`allowUncalibratedBidirectionalScan`. Together these let the coupon burn two-way, uncorrected, so the
zipper can be measured, even on a profile whose policy is "require verified offsets"
(`resolveEffectiveScanDirection` returns two-way for a baseline layer before it checks the profile's
calibration status).

Those values describe the coupon, but four ways of reusing settings carried them onto ordinary
artwork:

- **Process recipes** ("Save selected process", retained re-apply, machining templates) copied the
  marker into the recipe step and back onto the new operation. On a require-verified profile with a
  pending table, artwork given a recipe saved from a baseline swatch ran two-way at 0 mm instead of
  the one-way fallback. A recipe from a verification swatch ran two-way with the unverified table.
- **Make Default**, **Copy and Paste settings** and **material presets** dropped the marker (Make
  Default on purpose, for exactly this reason) but kept the coupon's uncalibrated-scan switch and
  0 mm, so on a require-verified profile with no table a new layer ran two-way, uncorrected, instead
  of one-way.

No decision asked for either. ADR-357 says effective settings travel with a process; the coupon's
direction overrides are not the operator's settings but the coupon's.

### Decision

1. **A recipe never carries the calibration marker.** Capturing a recipe step leaves
   `scanOffsetCalibrationMode` out. Applying a step never sets it on the new operation, including
   a step from a recipe saved before this amendment, and a template operation applied over a coupon
   operation does not keep it.
2. **A coupon's direction overrides stay with the coupon.** When settings are taken from an
   operation that carries the marker, for a recipe step, Make Default, Copy settings or a material
   preset, its `allowUncalibratedBidirectionalScan` and `bidirectionalScanOffsetMm` are left out
   (Copy settings writes them as unset, so a paste turns them off on the target). An older recipe
   step that carries the marker has them dropped when applied. One helper,
   `withoutCalibrationCouponOverrides` in `src/core/scene/layer.ts`, holds the rule.
3. **Everything else is unchanged.** The coupon itself burns exactly as before. An ordinary
   operation's own expert switch and local offset still travel with recipes, Make Default, Copy
   settings and presets (ADR-670 Amendment 1). Recipe files keep reading the old field, so saved
   libraries still open.

### Consequences

- Reusing coupon settings gives ordinary artwork the profile's own direction rule: the verified
  offset table, the pending one-way fallback, or the uncalibrated one-way fallback.
- Regression tests: `src/core/material-library/calibration-coupon-reuse.test.ts` covers recipes
  (through the library file), an older recipe with the marker, a template over a coupon operation,
  Make Default, Copy settings and material presets; 8 of its 10 cases fail before this change.
