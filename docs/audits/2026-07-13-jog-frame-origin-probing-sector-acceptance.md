# KerfDesk Jog, Frame, Origin, and Probing Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **8.0/10**

**Candidate stack:** PR #58 through PR #81 + `codex/motion-origin-9-acceptance`

**Status:** Software candidate implemented; GitHub CI validation pending; not yet shipped on `main`

## Verdict

The stacked candidate earns **9.1/10** for Jog, Frame, Origin, and Probing after the full release
gate passes. Motion setup now has one shared step and feed contract across pointer, keyboard,
continuous jog, and return-to-zero workflows. Existing frame preflight, verified-origin state, no-go
zones, persistent origins, safe CNC retracts, and two-stage touch-plate probing remain intact.

This is a software acceptance score. It does not replace the Falcon, second-GRBL, and CNC probe
plate physical acceptance matrix.

## Competitive Boundary

LightBurn's Move window provides configurable distance and speed, eight-direction step movement,
continuous jog, keyboard movement, current coordinates, user origin, and return-to-origin
workflows. Its Laser window provides bounding-box and rubber-band framing:
[Move Window](https://docs.lightburnsoftware.com/latest/Reference/MoveWindow/),
[Laser Window](https://docs.lightburnsoftware.com/latest/Reference/LaserWindow/), and
[Coordinates and Job Origin](https://docs.lightburnsoftware.com/2.0/Reference/CoordinatesOrigin/).

Rayforge keeps jog, live position, machine state, and WCS controls together, provides diagonal and
Z movement, warns near soft limits, and separates frame speed, power, dwell, and repeat settings:
[Bottom Panel](https://rayforge.org/docs/ui/bottom-panel/),
[Framing Your Job](https://rayforge.org/docs/features/framing-your-job/), and
[Workpiece Positioning](https://rayforge.org/docs/features/workpiece-positioning/).

Carbide Motion combines precision jogging, rapid positioning, work zero, and guided touch probing:
[Carbide Motion](https://carbide3d.com/carbidemotion/) and
[Movements and Zeroing](https://guides.carbide3d.com/running-shapeoko/movements-zeroing/).

KerfDesk's acceptance target is dependable GRBL-family laser and CNC operation, not every DSP,
galvo, accessory, or controller-specific movement feature in those products.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Step movement | Nine distances from 0.1 to 100 mm share one session preference across pointer and keyboard input | Accepted |
| Jog speed | Selectable 100-12,000 mm/min presets are capped by the active profile maximum and shared with return-to-zero | Accepted |
| Direction mapping | Eight-direction movement maps physical arrows through front/rear and left/right machine origins | Accepted |
| Continuous jog | A 250 ms hold starts one boundary-aware jog toward the configured bed edge | Accepted |
| Continuous cancel | Release, pointer cancel, pointer leave, window blur, and unmount route through controller jog-cancel | Accepted |
| Keyboard safety | Arrow and Page Up/Down movement is disabled during modals, field editing, unsupported Z, or unavailable motion state | Accepted |
| Keep-out safety | Step, diagonal, continuous, click-to-position, and return-to-zero moves retain the central no-go-zone guard | Accepted |
| Live status | Controller state, machine position, cached work-coordinate offset, feed, and spindle output remain visible | Accepted |
| Work origin | Session G92 and persistent G54 workflows remain explicit; return-to-zero requires Idle plus a known WCO | Accepted |
| Job placement | Absolute, current-position, user-origin, and verified-origin placement continue through one output/preflight path | Accepted |
| Framing | Dedicated profile feed, output scope, generated-motion bounds, overscan, bed, no-go-zone, CNC safe-Z, cancel, and verified-frame state are covered | Accepted |
| Probing | CNC Z and four-corner XYZ probing use fast seek, backoff, slow re-touch, typed results, Idle gating, and work-Z proof | Accepted |
| Real-browser workflow | Connect, home, select speed, diagonal jog, keyboard jog, set origin, and return to X0/Y0 all emit the expected GRBL commands | Accepted |

## Verification

- TypeScript: passed before final release verification.
- Focused sector battery: **12 files, 85 tests passed**.
- Chromium acceptance: shared pointer, keyboard, origin, and feed workflow passed.
- Targeted ESLint: passed with no warnings or errors.
- Full repository release gate: typecheck, lint, formatting, licenses, dependency audit, all product
  assertions, 17 Chromium workflows, web build, Electron build, and both size policies passed. The
  exact local command was stopped twice by the untouched outline-nesting wall-clock assertion at
  2.106 s and 2.184 s against a 2.000 s budget while the full suite was contending for CPU. The
  same benchmark then passed three consecutive isolated runs at 1.194 s, 1.032 s, and 1.044 s.
  Uncontended GitHub CI remains the final release-gate authority.

## Why 9.1

The candidate closes every major movement gap confirmed in the July 10 audit: configurable jog
feed, hold-to-jog, keyboard jog, and return to work zero. It also adds diagonal movement and proves
that all input methods share origin mapping, feed selection, motion guards, and the existing
beam-off jog protocol. Frame and probe workflows already had stronger safety depth than their raw
discoverability suggested; the broader battery verifies those contracts alongside the new work.

The score remains below a perfect result because saved positions, direct numeric move-to-position,
multiple selectable WCS slots, rubber-band framing, frame repeat/dwell controls, and the physical
machine/probe matrix remain incomplete.

## Score Boundary

- **Shipped `main`: 8.0/10** until the stacked candidate merges and the acceptance suite passes on
  the resulting `main` revision.
- **Stacked software candidate: 9.1/10** only after the full release gate passes.
- Physical machine runs remain required for hardware-level confidence and do not become complete
  from this software score.
