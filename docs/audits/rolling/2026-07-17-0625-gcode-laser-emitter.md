# Rolling audit — G-code emit pipeline (laser GRBL strategy + preflight boundary)

- **When:** 2026-07-17 06:25 (+08)
- **Tree:** `1705ac41` on the audit branch (files identical to main at audit time)
- **Scope:** `src/io/gcode/{emit-gcode,prepare-output}.ts`, `src/core/output/grbl-strategy.ts`, the non-finite/laser-on-travel preflight wiring (`src/core/preflight`), power-mode plumbing (`layer.powerMode` → `CutGroup.powerMode`), and the load-boundary validation it depends on.
- **Method:** static read + consumer/producer tracing + test-coverage cross-check. **Not verified:** no emission executed or snapshot diffed this iteration; the CNC emitter (`cnc-grbl-strategy.ts`) is a separate future iteration; no hardware behavior.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P2-1 — the between-pass re-arm ignores the group's power-mode override and desyncs the emitter's modal tracker

`emitGroup` re-arms the laser between passes with `${laserModeWord(dialect.cutPowerMode)} S0` ([grbl-strategy.ts:123](../../src/core/output/grbl-strategy.ts)) — and every shipped dialect's `cutPowerMode` is `'constant'` ([gcode-dialects.ts:76,90,103,115](../../src/core/devices/gcode-dialects.ts)), so this is always `M3 S0`. But a cut layer can carry a per-layer dynamic override: `layer.powerMode` flows to `CutGroup.powerMode` ([vector-group-fields.ts:20](../../src/core/job/vector-group-fields.ts)) and is honored when the group is *armed* (`powerModeForGroup`, [grbl-strategy.ts:385-392](../../src/core/output/grbl-strategy.ts)). Two consequences for a dynamic-override cut group with `passes ≥ 2`:

1. **Inconsistent passes:** pass 1 burns under M4 dynamic power; the pass-2 re-arm emits `M3 S0`, so passes 2+ burn constant-power — a different energy profile on identical geometry, over-burning accel zones exactly as the ADR-036 small-text defect describes.
2. **Cross-group desync:** `emitJob`'s `mode` tracker ([grbl-strategy.ts:356-377](../../src/core/output/grbl-strategy.ts)) is not told about the intra-group `M3 S0`, so after such a group it still believes `'M4'`. A following fill group (fill defaults to M4 per ADR-036) then gets **no re-arm at all** and silently runs its entire body in constant power — the small-text over-burn defect returning through a side door, invisible in the emitted file unless you know the modal state is wrong.

Test gap that lets this live: `grbl-strategy.fill-power-mode.test.ts` pins the cross-group mode state machine thoroughly, but **every group in the suite is `passes: 1`** — the between-pass re-arm is never exercised against an override.

Fix direction (maintainer's call): re-arm with the group's *effective* mode (the same resolution `powerModeForGroup` performs), or move the between-pass re-arm up into `emitJob` where the modal tracker lives; plus a multi-pass dynamic-override test.

---

## P3-2 — a single-point polyline emits a bare rapid

`emitSegment` with a one-point polyline emits only the `G0` travel to that point and no `G1` ([grbl-strategy.ts:95-111](../../src/core/output/grbl-strategy.ts)) — a pointless rapid in the output if a degenerate segment ever survives compile. It carries `S0` so no invariant breaks; the fill path already defends the analogous case explicitly (`sweepSpanLines`' emit-precision head tracker, lines 240-269). Defense-in-depth gap only.

---

## Verified clean (checked, no finding)

- **The 2026-07-06 open item "no NaN guard before emit" is CLOSED:** `findNonFiniteCoords` is a documented last-line-of-defense ([preflight.ts:424-440](../../src/core/preflight/preflight.ts)) wired into **all three** preflight entry points — laser ([preflight.ts:131](../../src/core/preflight/preflight.ts)), CNC ([cnc-preflight.ts:97](../../src/core/preflight/cnc-preflight.ts)), and standalone CNC ([standalone-cnc-preflight.ts:97](../../src/core/preflight/standalone-cnc-preflight.ts)) — with a dedicated test suite (`non-finite-preflight.test.ts`). `fmt()`'s `NaN.toFixed(3)` output ("NaN") is exactly what the scanner catches.
- **Feeds fail loudly at emit:** `roundedPositiveFeed` throws on non-finite/non-positive speeds ([grbl-strategy.ts:51-57](../../src/core/output/grbl-strategy.ts)).
- **Power percent is defended upstream:** `requirePercent` on `layer.power` and a literal-union check on `layer.powerMode` at the load boundary ([project-layer-validator.ts:23-25](../../src/io/project/project-layer-validator.ts)), so unclamped `scaleS` cannot see >100 from a loaded file.
- **Laser-off-on-travel (#3):** every rapid carries `S0` per dialect; preflight additionally scans for laser-on-travel and long blank-feed moves.
- **Preamble pins G54+G94** — the modal-WCS/feed-mode displacement class (F41/F50/F10) is defended at emit; this composes with iteration 1's stale-`activeWcs` finding (the advisory) rather than depending on it.
- **What-you-preview-is-what-you-burn:** `prepareOutput` is the single compile→origin→optimize pipeline for Save/Start/Preview/Estimate, budget-guarded before compile ([prepare-output.ts](../../src/io/gcode/prepare-output.ts)); preflight runs on the motion body only so the provenance header can't mask a verdict ([emit-gcode.ts:119-125](../../src/io/gcode/emit-gcode.ts)).
- **A CNC group reaching the laser strategy emits a visible comment marker, not motion** ([grbl-strategy.ts:319-323](../../src/core/output/grbl-strategy.ts)); raster trailing-M5 bookkeeping is handled consistently in both the re-arm logic and the postamble.

## Not verified

- No G-code was emitted or diffed against snapshots this iteration; the P2's wire-level consequence is traced from code, not observed on a controller (M3/M4 modal behavior on real GRBL is firmware-documented but unexercised here).
- `cnc-grbl-strategy.ts`, `emit-raster.ts`, and the Ruida/Smoothieware/Marlin strategies remain unaudited — future iterations.
