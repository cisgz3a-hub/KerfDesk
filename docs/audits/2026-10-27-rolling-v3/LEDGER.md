# Rolling audits v3 and v4 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md), plus L8 and L9 from [AREAS.md](AREAS.md). Plan: [AREAS.md](AREAS.md).

## v3 — change audit

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| G1 | Job output | 9a2bf6b13 | [G1-job-output.md](G1-job-output.md) | 2 | 0 | 0 | 1 (P3-2 raised) | 1 | 1 |
| G2 | Job state | 9a2bf6b13 | [G2-job-state.md](G2-job-state.md) | 1 | 0 | 1 | 0 | 0 | 1 (M3-P3-4) |

## v4 — workflow audit

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| G1-P3-2 (P2) | G1 | Tone calibration (ADR-670) ignores the photo's object power scale. A 60% operation with a 25% multiplier seeds and burns the wedge at S600 while the photo burns at S150, and no notice appears. A calibration measured at the photo's real power is flagged "measured with a different power". This breaks ADR-670 item 7 | **READ**: `effectiveOperationForObject` (`effective-output.ts:14`) applies overrides only. Compile uses `effectiveObjectPowerPercent` (layer × `powerScale`, `:54-57`; `compile-job-raster.ts:161`). The seed is `tone-calibration-store.ts:51`; the notice is `tone-calibration-library.ts:93`, fed `effective.power` (`PhotoEngravingDialog.tsx:66`). Auditor + refuter REPRO | fix card proposed |
| G2-P1-1 | G2 | CNC pass/supervised recovery streams the saved CNC job whatever project is open. With the toolbar switched to Laser (or a Laser project opened without running it), the real card → wizard → Start runs the CNC job to its bit-change hold. The job lock then pins the Laser project. Laser-mode hold controls apply, including a Z jog where the profile has powered Z. The point move sends `$J=G91 G21 X50 Y50` with no Z lift and no Work-Z check; CNC mode refuses the same move. Zero Z is hidden, so only Abort ends it. No dialog mentions the open project | **READ**: the wizard opens on `capsule.artifact.machineKind` only (`CheckpointResumeBanner.tsx:70`); the start passes `machineKind: 'cnc'` with no open-project check (`cnc-supervised-recovery-stream.ts:96-110`). The older fingerprint path refuses unless `project.machine?.kind === 'cnc'` (`cnc-recovery-preview-model.ts:177`). Refuter REPRO through the real UI with a fake GRBL 1.1 | fix card proposed |
