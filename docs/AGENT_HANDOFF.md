# Agent Handoff

This file captures the current continuation state for Claude Code or any other
AI coding agent that picks up the LaserForge roadmap work without access to the
chat transcript.

## Current State

- Branch: `master`.
- Repo state at handoff: clean; local `master` equals `origin/master`.
- Current HEAD when this handoff was written: hash-fill commit on top of
  `5d19289` (`test(controller-matrix): T3-43 family-agnostic operation-gate
  matrix`). Always verify live HEAD with `git log --oneline -1` before editing.
- Last shipped roadmap item: `T3-43` Controller simulator / test matrix
  (first slice).
- Next roadmap item: `T3-44` Generic progress model — line / byte / percent /
  device-reported.

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

## T3-43 — what shipped, what was deferred

The first slice covers four of the five T3-43 categories using pure capability
fixtures plus the existing operation gate (`canExecuteOperation` / T2-40):

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

Deferred to future T3-43 slices:

- Profile / controller-family transport mismatch (T2-30 Falcon WiFi as real
  transport) — still blocked on real WiFi controller plumbing.
- Live `FakeMarlinController` / `FakeBinaryController` production stubs —
  capability fixtures cover the contract surface without duplicating
  controller plumbing. Add only when a non-GRBL controller actually ships.

If the next agent thinks a future T3-43 slice is needed (e.g., new controller
shapes appear, T2-30 unblocks), file it as a fresh T3-43 follow-up commit
rather than re-opening the master-checklist line.

## Continuation Notes

- Do not merge Dependabot PRs blindly. Most open Dependabot PRs had failing
  checks at the prior handoff.
- Dependabot PR #3 was green on GitHub, but a local no-commit test merge was
  aborted because full `npm test` timed out, and a direct run of
  `tests/end-to-end-workflows/end-to-end-workflows.test.ts` also timed out.
- On clean `master`, `npm ci` completed and
  `npx tsc --noEmit --pretty false` passed.

## Expected Next Step

Continue strict roadmap order with **T3-44 — Generic progress model** at
[docs/ROADMAP.md] line ~17178. The ticket replaces the GRBL-shaped
`JobProgress` interface (`linesSent` / `linesAcknowledged` / `bufferFill`
/ `ackRateHz` / `expectedAckRateHz` / `healthStatus`) with a multi-domain
discriminated `JobProgress` that supports `phase`, `percentComplete`,
`elapsedMs`, optional `unit`/`sent`/`acknowledged`/`total`, and a GRBL-only
`grblHealth` sub-record. GrblController populates `grblHealth`; UI
conditionally renders health UI only when `grblHealth` is present;
file-upload / device-reported controllers populate the appropriate phase
and unit. Pinned by a new `tests/progress-model-multi-domain.test.ts`.
~1-2 sessions; depends on T2-24 (controller interface split) but does not
require it to be fully landed for the headline change.
