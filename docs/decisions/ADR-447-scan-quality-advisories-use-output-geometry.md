## ADR-447 - Scan quality advice uses compiled geometry and names saved assumptions (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Amends the advisory portion of ADR-359 and the image overscan help in ADR-415.
Completed Frame for the exact reviewed job remains the sole ordinary Start policy gate
(PROJECT.md non-negotiable 21; ADRs 228, 230, 232 and 237).

### Context

The speed and quality audit started on an older checkout. Current main already fixes
Smoothieware raster power units, averages tone images when reducing the burn grid, provides
per-operation image overscan, and analyses exact-power runs lost to Dot Width Correction in
Image Studio. Those fixes should be retained, not replaced with another output algorithm.

Three remaining advice problems are independent of the controller's power syntax:

- Job Review did not compare a compiled scan's runway with the profile's saved acceleration.
  At 6000 mm/min and 500 mm/s², a head starting from rest needs 10 mm under the constant
  acceleration model. The default 5 mm runway does not satisfy that model.
- Dot Width Correction shortens each end of an exact-power run. At 0.1 mm horizontal pixel
  pitch, 0.05 mm per end removes an isolated pixel. Pass-Through can have different horizontal
  and vertical pitches, so a row-interval-only check is wrong. The source image also cannot
  show coordinate rounding after a correction leaves a sub-micrometre run.
- The energy advisory used the requested row density for ordinary images and unrepresented
  feed values. A 0.03 mm high image compiled to one row has 33.3 rows/mm, regardless of a
  requested 10 rows/mm. Requested feeds of 1.1 and 1.9 mm/min both emit F1 and must not create
  a spurious 1.7× difference. The nominal profile spot also does not establish material burn
  width or prove that white detail will close.

### Decision

1. Add `scanQualityWarnings` to the existing Job Review warning collection. It reads compiled
   group metadata, never raster rows or a stateful row provider, and never changes output.
   It applies to powered Image and Scan Line Fill groups, with the same calculation across
   supported controller families. CNC and offset Fill are outside this scan advice.
2. Compare `v² / 2a` with the greatest available entry runway under the group's existing
   policy. Reuse the generic Fill and qualified Fill runway resolvers, including the
   qualified 5 mm bound and the generic 25 mm maximum. Use the compiled, represented feed.
   Say explicitly that the estimate starts from rest and uses saved acceleration, not a
   measured machine limit. Gaps can shorten individual entries further. A sufficient maximum
   runway is not a certificate that every entry or physical machine reaches the requested
   speed. Recommend reviewing Overscan or speed and testing scan edges on scrap.
3. Compare Dot Width Correction with half the compiled horizontal pitch. Warn when an
   isolated one-pixel powered run is removed or has at most 0.001 mm left, where coordinate
   rounding can erase it. Describe that conditional feature, not an invented count of erased
   pixels. Image Studio keeps its existing content-aware exact-run-loss analysis; Job Review
   stays O(number of groups) and preserves streaming memory and provider order.
4. Calculate raster row density from the compiled row count and physical height for ordinary
   images and Pass-Through alike. Use the shared represented G-code feed for both the job
   and its preset reference. Keep the existing relative-dose and override advice, without
   changing power automatically. A saved preset remains a settings reference, not proof of
   measured energy or a material result.
5. Call the profile spot nominal, describe its span across row intervals, and state that
   focus and material affect the actual burn width. Image overscan help likewise labels the
   saved motion model and asks for a scan-edge test. Avoid claiming that a software estimate
   guarantees full speed or a particular burn darkness.

### Consequences

- All new findings are warnings. There is no Start refusal, machine write, profile mutation,
  controller-specific workaround, silent power compensation, or fidelity reduction.
- A warning can appear before Image Studio has inspected pixels. That is useful early advice,
  but it does not assert that this image contains the isolated feature described.
- Equal nominal dose is not equal physical quality: material, focus, optics, acceleration,
  laser response, and measured scan-offset calibration still require a machine and material
  test. Saved recipes and nominal spot fields do not replace those measurements.

### Verification

- `scan-quality-warnings.test.ts`: every known controller kind, compiled rather than requested
  feed, sufficient runway, qualified versus generic Fill bounds, half-pitch dot deletion,
  anisotropic Pass-Through, coordinate collapse, deduplication, zero-power and CNC exclusions,
  unchanged streamed providers, and integration into the existing warning collection.
- `raster-energy-warnings.test.ts`: the 0.03 mm rounded-grid case and feeds with the same
  emitted F word, alongside existing preset, artwork override, Pass-Through, dose, and wording
  checks.
- `CutSettingsDialog.cut-extras.test.tsx`: the existing overscan field and operation setting
  flow still pass with the clarified help.
- Existing Smoothieware and Marlin raster power, shared resampler, fine-line, rotated and
  streamed raster, image overscan, Fill runway, threshold warning, Job Review intent, and
  process recipe tests were exercised while revalidating the newer baseline.

No physical burn, controller execution, or material qualification is claimed.
