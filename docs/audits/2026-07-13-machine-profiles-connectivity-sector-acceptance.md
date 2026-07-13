# KerfDesk Machine Profiles and Connectivity Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **8.0/10**

**Candidate stack:** PR #58 through PR #80 + `codex/machine-profiles-9-acceptance`

**Status:** Software candidate complete; not yet shipped on `main`

## Verdict

The stacked candidate earns **9.1/10** for Machine Profiles and Connectivity. The original audit's
specific defect is closed: detected controller identity can no longer drift from retained streaming
and output-dialect choices without correction or a visible refusal. Catalog selection, guided setup,
connection diagnostics, Start safety, profile persistence, and real-browser evidence now agree on
one controller contract.

This is a software acceptance score. It does not claim that simulator and browser evidence replace
the planned physical machine matrix.

## Competitive Boundary

LightBurn requires a device profile, supports automatic and manual setup, distinguishes controller
types and connection variants, imports manufacturer configuration, and exposes controller settings
through separate Device Settings and Machine Settings workflows:
[LightBurn Find My Laser](https://docs.lightburnsoftware.com/latest/GetStarted/FindMyLaser/),
[Create Manually](https://docs.lightburnsoftware.com/2.1/GetStarted/CreateManually/), and
[Machine Settings](https://docs.lightburnsoftware.com/2.0/Reference/MachineSettings/).

Rayforge provides saved active-machine profiles, profile templates, automatic configuration,
LightBurn device import, explicit driver and baud configuration, connection-state diagnostics, and
firmware-family guidance:
[Rayforge Machines](https://rayforge.org/docs/application-settings/machines/) and
[Connection Issues](https://rayforge.org/docs/troubleshooting/connection/).

KerfDesk's acceptance target is dependable offline setup and streaming for its declared controller
families, not LightBurn's complete commercial hardware ecosystem.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Profile catalog | Twelve built-in profiles cover generic and named GRBL devices plus grblHAL, FluidNC, Marlin, Smoothieware, and Ruida export | Accepted |
| Evidence labels | Every built-in profile identifies hardware-verified, simulator-tested, public-spec, or starter confidence | Accepted |
| Controller selection | Menu, rail, and guided setup derive controller driver and baud from the same active profile | Accepted |
| Firmware detection | GRBL, grblHAL, FluidNC, Marlin, and Smoothieware banners produce an explicit detected identity | Accepted |
| Controller facts | Controller-reported bed, feed, power, acceleration, junction deviation, and Z facts overlay catalog defaults only after a completed settings read | Accepted |
| Compatibility policy | One pure policy normalizes controller kind, streaming mode, receive window, and output dialect | Accepted |
| GRBL-family throughput | Crossing from Marlin/Smoothieware to GRBL-family firmware restores character-counted streaming; compatible custom GRBL ping-pong choices remain intact | Accepted |
| Non-GRBL safety | Marlin and Smoothieware are forced to one-line acknowledged streaming; Marlin receives a Marlin output dialect | Accepted |
| Catalog refusal | Once firmware is detected, catalog profiles for another controller family remain visible but cannot be selected | Accepted |
| Operator visibility | Machine Setup shows configured controller, active connection driver, detected firmware, and streaming behavior, with a mismatch alert | Accepted |
| Start safety | Start and Resume refuse when configured, active, and detected controller identities disagree, including after a profile change without reconnecting | Accepted |
| Diagnostics | A silent-controller timeout reports the baud rate actually used for that connection, including custom Marlin rates | Accepted |
| Profile persistence | The complete catalog validates, selects a driver/output strategy, round-trips through `.lfmachine.json`, and emits a safe fixture job | Accepted |
| Import/export | KerfDesk machine profiles and LightBurn `.lbdev` imports use a review-before-apply workflow | Accepted |
| Real-browser workflow | Connect, detect GRBL, reject a Marlin profile, apply a compatible xTool profile, save, and inspect persisted transport fields | Accepted |

## Verification

- TypeScript: passed before final release verification.
- Compatibility and profile workflow battery: **12 files, 79 tests passed**.
- Chromium acceptance: detected-firmware catalog and persistence workflow passed.
- Full repository release gate: passed on the final code in **570.4 seconds**.

## Why 9.1

The candidate now has a coherent end-to-end contract instead of independent profile fields. A
controller mismatch is visible during setup, incompatible catalog choices are refused, compatible
choices retain controller-reported limits, transport and dialect are normalized together, and Start
cannot stream through a stale driver after the profile changes. The catalog-wide round-trip/output
matrix and the Chromium workflow verify the same behavior at different layers.

The score remains below a perfect result because the built-in hardware catalog is much smaller than
LightBurn's ecosystem, Ruida support is export-focused rather than a complete live sender, network
controller discovery is limited, and the Falcon plus second-GRBL, Marlin, Smoothieware, and FluidNC
physical fault matrix is not complete.

## Score Boundary

- **Shipped `main`: 8.0/10** until the stacked candidate merges and the acceptance suite passes on
  the resulting `main` revision.
- **Stacked software candidate: 9.1/10** after the full release gate passes.
- Physical machine runs remain required for hardware-level confidence and do not become complete
  from this software score.
