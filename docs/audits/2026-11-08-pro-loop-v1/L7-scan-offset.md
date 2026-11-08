# Pro loop v1 — L7 Bidirectional scan offset

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108`
- **Scope:** `src/core/job/scan-offset.ts`, `fill-sweep-plan.ts`, `src/core/raster/emit-raster-sweep.ts`,
  `job/toolpath-raster-steps.ts`, `job/first-process-point.ts`, `job/job-start-bounds.ts`,
  `job/job-bounds.ts`, the scan-offset UI (`ScanOffsetEditor.tsx`,
  `ScanOffsetMeasurementFormatControls.tsx`, `ScanOffsetCalibrationDialog.tsx`)
- **Governing:** ADR-052 and Amendment 1
- **Lenses run:** L1, L2 (LightBurn Scanning Offset guide), L3 (seven twins of the row shift).
- **Counts:** 1 raised → P2 1. **Not fixed: held for the maintainer** (reverses an explicit ADR
  decision and moves every calibrated machine's fills and images).

## Headline

A calibrated two-way fill or image burns half its scan-offset value off the design, and off every
vector cut in the same job, along the forward scan direction. KerfDesk moves reverse rows by the
whole measured gap and leaves forward rows where they were commanded; LightBurn moves every row by
half the gap, which puts both directions on the design.

## Finding

### L7-P2-1 — Reverse-only scan compensation leaves the whole engraving half the gap off the design

- **Where:** `src/core/job/fill-sweep-plan.ts:84-93` (`segmentsWithScanOffset` shifts `reverse`
  segments only); `src/core/raster/emit-raster-sweep.ts:52` (`rowShiftX: reverse ? -offset : 0`);
  the same rule in `toolpath-raster-steps.ts:97`, `first-process-point.ts:98,175`,
  `job-start-bounds.ts:140` and `job-bounds.ts:244,276`.
- **Anchor:** Ground truth. The delay that makes the zipper (tube or driver firing time, belt and
  drive slack) displaces each row along its own travel, forward rows one way and reverse rows the
  other. LightBurn's guide: "At 100 mm/sec, if your power supply and tube take 1 millisecond to fire,
  your engraving will be offset by a full dot width", and "You will need to enter half the measured
  distance between lines — LightBurn moves each line by the amount you specify, so each pair of lines
  only needs to move half the distance". Its Initial Offset exists for an engraving still "shifted
  relative to vector cuts or engravings"
  ([LightBurn 2.2, Scanning Offset Adjustment](https://docs.lightburnsoftware.com/latest/Guides/ScanningOffsetAdjustment/),
  fetched 2026-11-08). ADR-052's premise, "forward rows and all vector cuts stay at exact design
  coordinates", holds for the commanded coordinates but not for where forward rows burn.
- **Scenario:** a diode or CO₂ machine whose rows each land d = 0.15 mm late along their travel at
  the engrave speed. The coupon shows a 0.3 mm gap; the operator enters it. KerfDesk commands forward
  rows at design (they burn at +0.15 mm) and reverse rows 0.3 mm against their travel (they burn at
  design + 0.3 − 0.15 = +0.15 mm). The zipper closes, and the whole fill sits 0.15 mm off its Line
  outline. With LightBurn's rule both directions burn at design.
- **Evidence:** SOURCE (above) and READ. The repository's own pins show the emitted rule:
  `emit-raster-scan-offset.test.ts` "shifts only reverse rows by scan offset" (forward row stays at
  X 0–2, reverse row moves by the table value), and `grbl-strategy-scan-offset.test.ts` "leaves
  forward fill sweeps unchanged".
- **Severity reasoning:** wrong physical position of a calibrated engraving relative to the design
  and to cuts, silently, typically 0.05–0.25 mm (half a LightBurn-style table entry). Rated P2 here
  rather than P1 because the size is set by the operator's own calibration and the result is
  registered between directions; a refuter applying METHOD §3 strictly may raise it to P1.
- **Fix direction (prototyped, then withdrawn):** in a two-way scan, move every row half the stored
  value along its own travel (forward +s/2, reverse −s/2 in the scan frame). The stored table keeps
  its meaning (full signed gap) and a LightBurn Line Shift, saved doubled, then moves each row by the
  Line Shift, as LightBurn does. All seven twins must move together. The prototype passed typecheck
  but changed 42 assertions in 20 test files that pin today's contract, including Frame and placement
  suites, so it needs the maintainer's decision and an ADR-052 amendment before it lands.

## Verified clean

The table lookup (from-rest below the first point, clamped above the last), shifting along the
sweep's own vector at any hatch angle, the emitted-feed lookup, and Amendment 1's placement rule.

## Not verified

Asymmetric machines (one direction lags more than the other), which neither rule fully corrects;
LightBurn's Initial Offset is its remedy.
