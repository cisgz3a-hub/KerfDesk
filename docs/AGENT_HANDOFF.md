# Agent Handoff

This file captures the current continuation state for Claude Code or any other
AI coding agent that picks up the LaserForge roadmap work without access to the
chat transcript.

## Current State

- Branch: `master`.
- Repo state at handoff: clean; local `master` equals `origin/master`.
- Current HEAD when this handoff was written: hash-fill commit on top of
  `2f1174a` (`test(capability): T3-59 capability regression coverage
  manifest`). Always verify live HEAD with `git log --oneline -1`
  before editing.
- Last shipped roadmap item: `T3-59` capability regression coverage
  manifest. Recent slices: T3-57 capability-mismatch rules in
  `5103ecb`, T3-55 Falcon autofocus firmware gate in `88d9e20`, T3-54
  connection-lifecycle coverage manifest in `4d75922`, T3-51 identity
  comparator in `06a2941`, T3-50 device identity capture in `7cd31e0`,
  T3-48 device-reuse flow in `56d87ff`, T3-47 safety-routing audit in
  `01f0948`, T3-46 split-profile schema in `72f30b5`, T3-44 generic
  progress model in `aa08f44`, T3-43 controller-matrix in `5d19289`.
- Next roadmap item: `T3-83` Tamper-resistance test suite (T3-60..T3-82
  already shipped per master checklist).

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

Continue strict roadmap order with **T3-83 — Tamper-resistance
test suite**. The headline change is incremental: ship a test
slice that pins the entitlement-tamper protections that are
already in place (token signature verification, clock-tamper
detection, monkey-patch resistance), and explicitly deferred for
work that depends on Tier-2 entitlement tickets (T2-89 / T2-90 /
T2-94) not yet shipped.

Hardware verification still owed before release tagging:
- T3-48 device-reuse flow: connect, disconnect, reconnect on
  Falcon A1 Pro; confirm second connect prompt is not shown.
- T3-50 device identity capture: confirm `[VER:1.1h:]` parses on
  the real Falcon and `getDeviceIdentity()` returns expected
  fields after a real connect.
- T3-55 Falcon autofocus firmware gate: once a profile-load
  caller threads the live firmware version through, confirm
  autofocus is correctly gated on a known-old firmware build.
