# Agent Handoff

This file captures the current continuation state for Claude Code or any other
AI coding agent that picks up the LaserForge roadmap work without access to the
chat transcript.

## Current State

- Branch: `master`.
- Repo state at handoff: clean; local `master` equals `origin/master`.
- Current HEAD when this handoff was written: hash-fill commit on top of
  `30fb369` (`feat(ipc): T3-88 IPC fuzz coverage manifest + dialog
  handler guards`). Always verify live HEAD with `git log --oneline -1`
  before editing.
- Last shipped roadmap item: `T3-88` IPC fuzz coverage manifest. This
  session shipped a 10-ticket run: T3-50 / T3-51 / T3-54 / T3-55 / T3-57
  / T3-59 / T3-83 / T3-86 / T3-87 / T3-88, on top of an earlier 5-ticket
  run (T3-43 / T3-44 / T3-46 / T3-47 / T3-48). Hashes are filled in
  the master checklist + shipped audit.
- Next roadmap item: `T3-89` Production security build CI checks
  (extends T1-81); other open T3 items still gated on external work
  (T3-84 business decision, T3-85 release-time QA, T3-90 / T3-91
  T1-25 dependency).

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

## Expected Next Step

Continue strict roadmap order with **T3-89 — Production security
build CI checks (extends T1-81)**. The headline change is wiring
mechanical CI gates that catch the kinds of regressions T1-81
already detects in source (`__forceProUnlock`, source maps in
production, dev-only IPC handlers in preload, relaxed CSP). T1-81
already has the verifier; T3-89 extends to a CI-runnable set of
checks plus a GitHub Actions workflow.

Hardware verification still owed before release tagging:
- T3-48 device-reuse flow: connect, disconnect, reconnect on
  Falcon A1 Pro; confirm second connect prompt is not shown.
- T3-50 device identity capture: confirm `[VER:1.1h:]` parses on
  the real Falcon and `getDeviceIdentity()` returns expected
  fields after a real connect.
- T3-55 Falcon autofocus firmware gate: once a profile-load
  caller threads the live firmware version through, confirm
  autofocus is correctly gated on a known-old firmware build.

This session's 10-ticket run was deliberate-foundation slices. Many
landed only the contract surface (types + comparators + selectors)
with explicit caller-migration follow-ups deferred. Watch for
those in future sessions:

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
