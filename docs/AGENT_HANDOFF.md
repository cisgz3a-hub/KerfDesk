# Agent Handoff

This file captures the current continuation state for Claude Code or any other
AI coding agent that picks up the LaserForge roadmap work without access to the
chat transcript.

## Current State

- Branch: `master`.
- Repo state at handoff: clean; local `master` equals `origin/master`.
- Current HEAD when this handoff was written: hash-fill commit on top of
  `56d87ff` (`feat(connection): T3-48 navigator.serial.getPorts device-
  reuse flow`). Always verify live HEAD with `git log --oneline -1`
  before editing.
- Last shipped roadmap item: `T3-48` device-reuse flow — production
  change to `WebSerialPort.close` (no longer revokes the persistent
  permission grant) plus the `connectKnownPortOrPrompt` /
  `forgetActiveDevice` / `forgetKnownPorts` API. Hardware verification
  needed before release tagging. Recent slices: T3-47 safety-routing
  audit in `01f0948`, T3-46 split-profile schema in `72f30b5`, T3-44
  generic progress model in `aa08f44`, T3-43 controller-matrix in
  `5d19289`.
- Next roadmap item: `T3-50` Device identity verification on connect —
  require `$I` firmware response (T3-49 navigator-disconnect already
  shipped in `66c3e7c`).

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

Continue strict roadmap order with **T3-50 — Device identity
verification on connect**. The headline change is requiring an `$I`
firmware response within the connect handshake window so a non-GRBL
USB-serial device cannot pass the welcome predicate via banner-only
or `[VER:]`-only signals. T3-51 (reconnect-same-machine
verification) builds on the same `$I` snapshot.

T3-49 (navigator disconnect event handling) already shipped in
`66c3e7c`; the master checklist line confirms.

T3-48 ships a real production change in `WebSerialPort` —
hardware verification on Falcon A1 Pro is **needed** before release
tagging: connect, disconnect, reconnect; confirm the second connect
prompt is not shown.
