# Rolling audits v3 and v4 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md), plus L8 and L9 from [AREAS.md](AREAS.md). Plan: [AREAS.md](AREAS.md).

## v3 — change audit

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| G1 | Job output | 9a2bf6b13 | [G1-job-output.md](G1-job-output.md) | 2 | 0 | 0 | 1 (P3-2 raised) | 1 | 1 |

## v4 — workflow audit

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| G1-P3-2 (P2) | G1 | Tone calibration (ADR-670) ignores the photo's object power scale. A 60% operation with a 25% multiplier seeds and burns the wedge at S600 while the photo burns at S150, and no notice appears. A calibration measured at the photo's real power is flagged "measured with a different power". This breaks ADR-670 item 7 | **READ**: `effectiveOperationForObject` (`effective-output.ts:14`) applies overrides only. Compile uses `effectiveObjectPowerPercent` (layer × `powerScale`, `:54-57`; `compile-job-raster.ts:161`). The seed is `tone-calibration-store.ts:51`; the notice is `tone-calibration-library.ts:93`, fed `effective.power` (`PhotoEngravingDialog.tsx:66`). Auditor + refuter REPRO | fix card proposed |
