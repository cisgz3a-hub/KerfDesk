# KerfDesk Onboarding and Device Setup Sector Acceptance

**Date:** 2026-07-14

**Baseline:** 2026-07-11 competitive audit, shipped sector score **7.5/10**

**Candidate stack:** PR #58 through PR #109 + `codex/onboarding-9-acceptance`

**Status:** Software candidate complete; focused, Chromium, and full release acceptance passed

## Verdict

The stacked candidate earns **9.1/10** for software onboarding and device setup. It combines a
discoverable guided entry, automatic controller facts, ranked catalog suggestions, coherent
controller/streaming selection, manual fallback, guarded firmware synchronization, machine-specific
steps, direct checklist repair actions, and draft-only Finish/Cancel semantics.

## Competitive Boundary

LightBurn's official setup path automatically discovers supported connected machines, lets users
choose a recognized device, then confirms identity, work area, origin, and homing. It also preserves
a manual profile route when discovery is unavailable:
[Find My Laser](https://docs.lightburnsoftware.com/latest/GetStarted/FindMyLaser/).
LightBurn's device settings are machine-specific and hide settings that do not apply to the selected
device:
[Device Settings](https://docs.lightburnsoftware.com/latest/Reference/DeviceSettings/).

KerfDesk follows those strong workflow principles while retaining controller readback, explicit
power-scale readiness, controller/profile coherence, and a CNC-specific probing path in the same
offline-first application.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Guided entry | Machine Setup and the machine rail route to one shared wizard; incomplete connected profiles receive a passive setup nudge | Accepted |
| Automatic facts | Connect and re-read use the draft controller family and baud; detected controller identity and `$$` values remain live during setup | Accepted |
| Catalog choice | Ranked suggestions show match reasons, confidence, warnings, dimensions, and laser-head facts; incompatible firmware choices are disabled | Accepted |
| Short laser path | Laser setup omits the irrelevant CNC probe page and reports six meaningful steps | Accepted |
| CNC path | CNC setup retains the optional guarded touch-plate probe as step five of seven | Accepted |
| Reduced interaction | Choosing a catalog profile applies only to the draft and enters confirmation immediately | Accepted |
| Repairable review | Every readiness item returns directly to its relevant profile, confirmation, or safety editor | Accepted |
| Safety gates | Untouched generic work area and power scale block Finish; invalid dimensions cannot advance | Accepted |
| Manual/degraded mode | Disconnected, unsupported-serial, and silent/non-GRBL paths remain editable without pretending values were detected | Accepted |
| Firmware writes | Only allowlisted settings can be written, with explicit confirmation, Idle gating, re-read, and verification | Accepted |
| Transaction semantics | Finish commits once through `replaceDeviceProfile`; Cancel leaves the active profile unchanged | Accepted |
| Browser acceptance | Chromium completes the Creality Falcon A1 Pro workflow at 390 px width, keeps Finish inside the viewport, and saves controller, bed, and fast framing values | Accepted |

## Verification

- TypeScript: passed.
- Setup reducer, wizard, and readiness battery: **3 files, 39 tests passed**.
- Compact Chromium Falcon setup workflow at 390 x 844: **1 passed**.
- Formatting for implementation, tests, workflow contract, ADR, and report: passed.
- Full `pnpm release:check`: passed in 835 seconds, including **4,777 tests passed**, 17 skipped,
  four default Playwright workflows, web and Electron builds, dependency audit, licensing, file-size,
  and public-export ratchet gates.

## Why 9.1

The baseline's concrete usability penalty was that expert and irrelevant concepts appeared too early
in a dense setup path. The candidate now adapts the flow to laser versus CNC, removes an unnecessary
catalog-confirmation click, and turns the final checklist into direct navigation rather than a dead
end. That is backed by pure reducer tests, React behavior tests, and a saved-project browser workflow.

The score remains below a perfect result because physical discovery, homing, firmware writes, and
probe behavior still require the named hardware matrix; network and proprietary controller setup is
less automatic than vendor-specific ecosystems; and the wizard does not replace manufacturer safety
instructions or driver installation.

## Score Boundary

- **Shipped `main`: 7.5/10** until the stacked candidate merges and passes on resulting `main`.
- **Stacked software candidate: 9.1/10** with focused, Chromium, and full release acceptance passed.
- Representative physical laser and CNC setup runs remain required before calling hardware setup
  universally verified.
