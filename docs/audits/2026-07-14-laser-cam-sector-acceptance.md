# KerfDesk Laser CAM Sector Acceptance

**Date:** 2026-07-14

**Baseline:** 2026-07-11 competitive audit, shipped sector score **8.5/10**

**Candidate stack:** PR #58 through PR #138 + `codex/laser-cam-9-acceptance`

**Status:** Software candidate complete; focused, broad, and full release acceptance passed

## Verdict

The stacked candidate earns **9.1/10** for Laser CAM. The existing cut, fill, raster, kerf, tabs,
air-assist, ordering, framing, preflight, and prepared-output workflows now include a persisted
per-layer vector power-mode decision with default-preserving output semantics.

## External Contracts

- GRBL documents laser mode and M4 dynamic power scaling with actual motion speed:
  [GRBL](https://github.com/gnea/grbl) and
  [settings](https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md).
- LightBurn documents Variable Power as its G-code default and Constant Power as the M3 compatibility
  alternative in per-layer Cut Settings:
  [Shared Settings](https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/SharedSettings/).

## Evidence

| Contract | Candidate evidence | Result |
| --- | --- | --- |
| Default stability | Missing/Auto power mode adds no job field and follows the existing dialect cut/fill decision | Accepted |
| Per-layer control | Line and Fill Cut Settings expose Auto, Constant (M3), and Dynamic (M4) | Accepted |
| Raster isolation | Image mode hides the vector control and raster remains group-managed | Accepted |
| Modal correctness | Mixed explicit modes switch before the affected group and avoid laser-on travel | Accepted |
| Project integrity | Supported values round-trip; unknown values fail project validation | Accepted |
| Material reuse | Captured recipes and linked snapshots retain explicit power mode | Accepted |
| Composition | Layer and sublayer settings compile into the same immutable Job consumed by preview/export/Start | Accepted |

## Verification

- Focused compiler, output, UI, project, and material battery: **6 files, 46 tests passed** on the
  rebased candidate.
- Broad output, job, project, material, and layer UI battery: **113 files, 665 tests passed**.
- TypeScript: passed.
- Formatting and diff whitespace validation: passed.
- Full `pnpm release:check`: passed in **884.9 seconds**, including **4,908 tests passed**, 17
  skipped, web and Electron builds, dependency audit, licensing, formatting, TypeScript, file-size,
  and public-export ratchet gates.
- Default Playwright browser smoke: **4 workflows passed**.

## Why 9.1

The baseline already rated the core highly. Its concrete specialist gap was the inability to choose
constant versus dynamic power per layer. The candidate closes that gap through the typed settings,
persistence, reusable materials, compiler, UI, and output state machine instead of adding a cosmetic
checkbox that can diverge from emitted G-code.

The score remains below a perfect result because M4 behavior depends on controller firmware and laser
mode configuration, Ruida does not share M3/M4 semantics, and representative physical-controller burn
validation is still required before universal hardware claims.

## Score Boundary

- **Shipped `main`: 8.5/10** until the stacked candidate merges and passes on resulting `main`.
- **Stacked software candidate: 9.1/10** with focused, broad, and full release acceptance passed.
- Physical burn validation remains outside this software score.
