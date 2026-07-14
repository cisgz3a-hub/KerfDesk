# KerfDesk Output Correctness and Safety Sector Acceptance

**Date:** 2026-07-14

**Baseline:** 2026-07-11 competitive audit, shipped sector score **8.0/10**

**Candidate stack:** PR #58 through PR #136 + `codex/output-safety-9-acceptance`

**Status:** Software candidate complete; focused and full release acceptance passed

## Verdict

The stacked candidate earns **9.1/10** for output correctness and safety. The existing single
prepared-output pipeline, fail-closed preflight, emitted-text invariants, CNC safety checks,
byte-pinned production corpus, and firmware lifecycle simulators are now joined by symmetric
generated-job coverage for GRBL, Marlin inline/fan, and Smoothieware output.

This is a software and simulator acceptance result. It does not claim that every firmware build,
wiring choice, or physical controller has been validated.

## External Contracts

The acceptance rules come from controller-owned documentation rather than inferred syntax:

- GRBL v1.1 documents `G0` through `G3`, `M3`/`M4`/`M5`, `S` words, laser mode, and dynamic laser
  power: [GRBL](https://github.com/gnea/grbl) and
  [settings](https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md).
- Marlin documents inline laser power on movement commands and configurable PWM ranges:
  [M3 - Spindle CW / Laser On](https://marlinfw.org/docs/gcode/M003.html).
- Marlin documents synchronous fan-laser control with `M106`, `M107`, and an `S0..255` scale:
  [M106 - Set Fan Speed](https://marlinfw.org/docs/gcode/M106.html).
- Smoothieware documents `G0` as laser-off travel, `G1`/`G2`/`G3` as laser motion, and fractional
  `S0..1` power:
  [Smoothie Laser module](https://smoothieware.github.io/Webif-pack/documentation/web/html/laser.html).

## Evidence

| Contract | Candidate evidence | Result |
| --- | --- | --- |
| One output truth | Preview, estimate, export, and Start consume the same prepared output; production snapshots call `emitGcode` directly | Accepted |
| Determinism | GRBL, Marlin inline, Marlin fan, and Smoothieware emit byte-identical output for repeated generated jobs | Accepted |
| Laser-off travel | Shared emitted-text predicate passes generated cut/fill jobs for all four G-code modes | Accepted |
| Motion bounds | Generated in-bed cut jobs remain in the configured bed for every G-code mode; arc bounds include the analytic bulge | Accepted |
| Finite coordinates | Emitted-text checks reject non-finite X/Y/Z/I/J words before output can be accepted | Accepted |
| GRBL power | Power percentage remains tied to the selected `$30` / maximum S scale | Accepted |
| Marlin inline power | Generated motion power remains on the configured 0..255 scale | Accepted |
| Marlin fan power | Generated output uses only `M106 S0..255` and `M107`; motion lines contain no S words | Accepted |
| Smoothieware power | Generated output stays in the documented fractional `S0..1` range | Accepted |
| Production composition | Representative Marlin fan and Smoothieware vector/fill jobs are byte-pinned through the shipped Save/Start pipeline | Accepted |
| CNC output | Z-safe rapid, controlled plunge, spindle-start, depth, arc, tool-change, and standalone-output checks remain in the focused battery | Accepted |
| Controller lifecycle | Fake-serial GRBL, Marlin, and Smoothieware workflows cover connect, stream, pause/stop, error, alarm, and disconnect behavior | Accepted |

## Verification

- Cross-dialect and production snapshot battery: **4 files, 49 tests passed**, two snapshots added.
- Output, invariant, CNC output, and controller lifecycle battery: **30 files, 234 tests passed**.
- TypeScript: passed.
- Focused ESLint: passed.
- Diff whitespace validation: passed.
- Full `pnpm release:check`: passed in 792 seconds, including the complete test suite, four default
  Playwright workflows, web and Electron builds, dependency audit, licensing, file-size, and
  public-export ratchet gates.

## Why 9.1

The baseline already recognized unusually strong internal safety architecture but penalized uneven
controller validation. The candidate closes the software asymmetry: the most divergent power
encodings now consume one generated job corpus, apply firmware-specific conformance checks, and flow
through byte-pinned production output. Existing lifecycle simulators then exercise those controller
families beyond pure text generation.

The score remains below a perfect result because firmware configuration is variable, the named
physical GRBL-family, Marlin, and Smoothieware hardware matrix is not complete, and the experimental
Ruida file encoder has not passed trusted external decoding or real-controller acceptance. Those
limitations remain explicit rather than being converted into a software-only parity claim.

## Score Boundary

- **Shipped `main`: 8.0/10** until the stacked candidate merges and passes on resulting `main`.
- **Stacked software candidate: 9.1/10** with generated, snapshot, invariant, CNC, simulator, and full
  release-gate evidence.
- Physical-controller acceptance remains required before describing any profile as universally
  hardware-verified.
