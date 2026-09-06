# CNC spindle-review corrections

## Scope and ownership

Authorized follow-up to the Neotronics 4040 Max profile-on-path investigation. Base main:
`5918ef53fd91f6b33a4cd0766f2a3b7ba6991acc`; implementation branch:
`codex/cnc-review-spindle-facts-20260906`. The original dirty checkout is not edited.

This repairs two reproduced review-information defects plus associated misleading copy. It does
not diagnose or correct physical slippage, add motion features, rewrite controller settings, alter
compilation/emission, or add a Frame/Start guard. Existing ADR-111/224/228/306 ownership applies;
there is no new architecture or product policy.

## Corrections

1. `JobReviewControllerSection` selects the active CNC machine's `spindleMaxRpm` for the live
   controller S-maximum comparison. Laser mode retains `device.maxPowerS`. The store subscription
   follows machine switching, setup edits, and live settings refreshes.
2. `detectCncMachineLimitWarnings` retains the configured spindle-ceiling advisory without a
   controller snapshot. Missing live values do not become known or trigger invented live limits.
3. Both spindle warnings distinguish requested/compiled values from physical RPM. The local
   warning describes the existing compilation limit; the live warning describes the requested
   layer value and GRBL's conditional PWM saturation without asserting that the emitted command
   exceeds the live scale or that the physical spindle is slower.

Primary source: [GRBL configuration, spindle mapping](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration#30---max-spindle-speed-rpm).
The documented mapping saturates PWM for commands above the configured maximum. It is not
tachometer evidence and does not identify the affected machine's actual controller configuration.

## Reproduction and focused evidence

- Before implementation, the new tests produced 9 failures / 8 passes: the actual React/store
  controller section had the reversed CNC match/mismatch, the local advisory disappeared with
  null settings, and warning text overstated physical speed.
- After implementation, six focused Vitest suites passed 82 tests, including laser regressions,
  readiness, the actual review dialog, and both new suites.
- Independent Astra review found no further actionable issue and passed 60 tests across five
  suites, including CNC compilation and the exact Frame/Job Review handoff.
- `pnpm typecheck:e2e` passed. The new real-Chrome review fixture passed 1/1 in 15.7 seconds:
  CNC 12000/live 12000 match, live 1000 mismatch, configured 6000 warning with unread controller
  settings, and advisory-only enabled Start. No Start/Frame/connection action was invoked.
- Browser screenshots were inspected; warning values were visible and readable. No page or
  console errors and no serial fixture events were captured in the passing run.
- The first browser attempt used the wrong dialog accessible name. Its type-only app imports also
  pulled app-specific globals into the separate E2E TypeScript project. Both harness defects were
  corrected without changing application behavior or widening the E2E configuration.

The browser fixture seeds a review model and store snapshots in a disposable browser profile; it
does not prepare a real job or qualify actual controller communication. Unit tests separately
exercise the production warning collector and existing compiler/handoff contracts.

## Release and remaining limits

Full local release and hosted exact-head check results belong in the PR/merge receipt after they
complete; this source document records focused evidence only. No new installer, packaged runtime,
macOS, firmware, hardware motion, physical spindle speed, or material cut was qualified here.
The exact failing project, emitted program, controller settings and operator measurements are
still needed to investigate the permanent circle departure. These disclosures are not an
anti-slip mechanism or evidence that the physical complaint is solved.
