# Agent Handoff

This file captures the current continuation state for Claude Code or any other
AI coding agent that picks up the LaserForge roadmap work without access to the
chat transcript.

## Current State

- Branch: `master`.
- Repo state at handoff: clean; local `master` equals `origin/master`.
- Current HEAD when this handoff was written: hash-fill commit on top of
  `3541292` (`feat(output): T3-15 streaming G-code output type
  foundation`). Always verify live HEAD with `git log --oneline -1`
  before editing.
- Last shipped roadmap item: `T3-15` streaming G-code type foundation.
  This run shipped 5 unblocked tickets: T3-89 / T3-90 / T3-91 / T3-24 /
  T3-15. Combined with prior runs this session (T3-43..T3-48 then
  T3-50..T3-88), 20 Tier-3 tickets advanced in this session arc.
- Next roadmap item: there are no fully unblocked Tier-3 tickets left.
  The remaining open lines hit external blockers (see "What's blocked
  and why" below).

## What To Read First

1. `CLAUDE.md`
2. `.cursor/rules/laserforge.md`
3. `docs/ROADMAP.md`
4. `docs/ROADMAP-shipped-audit.md`
5. `PROJECT_MAP.md`

The roadmap is current through T3-43 (first slice). Use the master checklist
at the bottom of `docs/ROADMAP.md` for current open-ticket counts. Some
historical "Open" sections in `docs/ROADMAP-shipped-audit.md` are audit
evidence from 2026-04-30 and must not be treated as current planning counts —
the planning note at the top of that file (commit `bcd31c2`) explains.

## T3-43 / T3-44 — what shipped, what was deferred

**T3-43** first slice covers four of the five T3-43 categories using pure
capability fixtures plus the existing operation gate (`canExecuteOperation`
/ T2-40):

- Operation routing (T2-26): `GrblController.operations.{jog,home,unlockAlarm,
  frame,testFire,laserOff}` source-pinned as semantic methods.
- Capability gating (T2-25): per-family allow/refuse decisions across GRBL,
  Marlin-shape, Ruida-shape, file-upload, and no-output fixtures.
- Output-format gating (T2-29): `job-start` refuses when no executable output
  is advertised.
- Profile-override propagation (T2-25): `applyProfileOverrides` flips
  capability decisions without mutating static capabilities.
- GRBL regression: `grblCapabilities` still advertises gcode-text/line-stream/
  M3+M4/M5/ok-line and the full operator operations set.

T3-43 deferred: profile / controller-family transport mismatch (T2-30 Falcon
WiFi as real transport — still blocked on real WiFi controller plumbing) and
live `FakeMarlinController` / `FakeBinaryController` production stubs (the
capability fixtures cover the contract surface without duplicating controller
plumbing; add only when a non-GRBL controller actually ships).

**T3-44** first slice ships only the type foundation in
`src/controllers/JobProgressMultiDomain.ts`: `JobPhase`, `ProgressUnit`,
`GrblHealth`, `MultiDomainJobProgress`, plus three constructors / converters
(`toMultiDomainGrblProgress` losslessly maps the legacy GRBL shape;
`makeUploadProgress` builds the `unit:'byte'` upload shape with input
clamping; `makeDeviceReportedProgress` builds the Ruida-style
`unit:'device-reported'` shape with percentComplete clamped to [0, 100]) and
type-narrowing guards (`hasGrblHealth`, `hasCountProgress`, `isActivePhase`,
`isTerminalPhase`). The module is intentionally type-only — the test file
source-pins that it does not import from `GrblController` or `MachineService`.

T3-44 deferred: migrating `GrblController` progress emission to the
multi-domain shape, threading the new shape through
`MachineService.onProgress` callbacks, and replacing UI rendering in
`ConnectionPanel` / `Progress.tsx` to gate the GRBL-health panel on
`hasGrblHealth(progress)`. Same gating rule as T3-43: do these only when a
non-GRBL controller actually ships, and file each as a fresh T3-44
follow-up commit rather than re-opening the master-checklist line.

## Continuation Notes

- Do not merge Dependabot PRs blindly. Most open Dependabot PRs had failing
  checks at the prior handoff.
- Dependabot PR #3 was green on GitHub, but a local no-commit test merge was
  aborted because full `npm test` timed out, and a direct run of
  `tests/end-to-end-workflows/end-to-end-workflows.test.ts` also timed out.
- On clean `master`, `npm ci` completed and
  `npx tsc --noEmit --pretty false` passed.

## What's blocked and why

After this session's run, the remaining open lines on the master
checklist all hit a real blocker. A future session that wants to
make further progress needs one of the following inputs:

**Hardware verification (10 T1 tickets):** T1-17, T1-28, T1-31,
T1-34, T1-36, T1-39, T1-40, T1-41, T1-42, T1-51. Each has code
shipped and pinned by tests; the close-out gate is a Falcon A1 Pro
burn / connect / frame test that a software-only agent cannot
perform.

**Hardware investigation required:** T2-30 Falcon WiFi as real
controller, T3-17 Wi-Fi safety model, T3-12 hardware-in-the-loop
test framework. These need someone to capture the real Falcon WiFi
protocol (HTTP + WebSocket message shapes, file-upload semantics,
progress callbacks) on real hardware before any production code
can land safely.

**External / business decisions:** T3-4 (code-signing certs from
Apple / Microsoft), T3-84 (Linux packaging — explicit "defer until
business decides"), T3-85 (release-time installer QA matrix),
T2-95 (real trial model — gated on monetization decision).

**Multi-week refactor:** T2-6 App.tsx file split (still 1987 lines
after 19 phases). Each remaining phase is a discrete extraction
that needs careful before/after verification — not safe to ship
quickly. T3-34 (stripe-based raster) depends on the live emitter
migration of T3-15 (multi-week itself).

## Expected Next Step

Pick one of the blockers above with the right input, or take a
T2/T3 follow-up not in the master checklist (e.g., wire the
T3-91 banner into `ConnectionPanelMain`, or wire the T3-90
Settings UI checkbox).

## Hardware verification still owed before release tagging

- T3-48 device-reuse flow: connect, disconnect, reconnect on
  Falcon A1 Pro; confirm second connect prompt is not shown.
- T3-50 device identity capture: confirm `[VER:1.1h:]` parses on
  the real Falcon and `getDeviceIdentity()` returns expected
  fields after a real connect.
- T3-55 Falcon autofocus firmware gate: once a profile-load
  caller threads the live firmware version through, confirm
  autofocus is correctly gated on a known-old firmware build.
- T3-90 auto-M5: enable `autoM5OnConnect` in a profile, connect,
  and confirm M5 lands shortly after the first idle status.

## Foundation slices shipped without caller migration

Many of this session's slices landed only the contract surface
(types + comparators + selectors + helpers) with explicit caller-
migration follow-ups deferred. Watch for those in future sessions:

  - T3-44 progress emission: `GrblController` emit + UI render.
  - T3-46 split-profile storage migration when a non-GRBL
    profile lands.
  - T3-50 mandatory-fail handshake when T2-32 ConnectionManager
    lands.
  - T3-51 IdentitySnapshot persistence + ConnectionManager wiring.
  - T3-55 profile-load callers thread live firmware version.
  - T3-57 `runPreflight` threads `getDeviceIdentity` through
    `PreflightContext`.
  - T3-83 signed-token / clock-rollback / monkey-patch defenses
    once T2-90 / T2-91 / T2-94 ship.
  - T3-86 Playwright runner once T2-98 CI runners land.
  - T3-87 wire selectors into `JobLog.ts` / `JobReplay.ts`.
  - T3-88 behavioral end-to-end fuzz once T2-122 typed-IPC.
  - T3-89 dedicated `.github/workflows/security-checks.yml` once
    T2-99 / T2-100 release signing infrastructure ships.
  - T3-90 Settings UI checkbox + explanatory text in the
    device-profile editor.
  - T3-91 wire `<UnsafeAtConnectBanner>` into `ConnectionPanelMain`
    and the recovery-action handler dispatcher.
  - T3-24 bundled calibrated curves once a contributor with
    real material data submits via the now-shipped pipeline.
  - T3-15 live emitter / ticket / controller / preview
    migration to `AsyncIterable<GcodeChunk>` (multi-week each).
