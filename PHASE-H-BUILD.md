# PHASE-H-BUILD.md — Fable 5 operating charter for the multi-controller build

Authored 2026-07-02 by Claude Fable 5 at the maintainer's direction ("create your own
md rules and follow your own instructions"). This file is the ruleset and the live
build ledger for Phase H. It supersedes process ceremony from earlier docs for the
duration of this build; it does NOT supersede physics or honesty.

## Mission

Every controller family — GRBL v1.1, grblHAL, FluidNC, Marlin, Smoothieware, Ruida —
works start-to-finish through the whole app: connect → identify → configure → jog/frame
→ run/pause/resume/stop → recover, with output generation, streaming, console, settings,
and UI all capability-aware. Verified end-to-end against protocol simulators.

## Rules I hold myself to

1. **Safety invariants are absolute.** Laser off on travel, bounds honesty, power-scale
   honesty, deterministic output, no partial output, E-stop always reachable. Every new
   strategy gets property tests for these. No exceptions, ever.
2. **Honest labels.** Only GRBL/grblHAL can be hardware-verified (Falcon A1 Pro).
   Marlin/Smoothieware/Ruida ship simulator-verified and say so in profile evidence and
   docs. I never write "works on hardware" for anything I could not burn.
3. **Simulator before firmware code.** No controller merges without a scripted firmware
   simulator and a full lifecycle integration test (connect→jog→frame→start→pause→
   resume→stop→error→disconnect) driving the REAL store.
4. **Capability gating, never kind-checking, in UI.** Components read a declarative
   capabilities object. `kind === 'grbl'` in ui/ is a bug.
5. **The seam before the fan-out.** The ControllerDriver refactor lands with byte-proof:
   G-code snapshots unchanged, sim transcripts identical, before any new firmware lands.
6. **Green CI is table stakes, not proof.** pnpm test+lint+typecheck before every commit.
   They prove structure; the lifecycle sims prove behavior; hardware proves fidelity
   (rule 2 says which we have).
7. **Commit per stage.** Each stage below commits when its tests pass, so progress
   survives process death. Conventional-commit messages.
8. **Small files, pure core.** Mirror the existing `core/controllers/grbl/` many-small-
   files layout; protocol logic is pure (no I/O, no clocks, no throws for control flow).
9. **Reuse over invention.** Extend the existing streamer/status-parser/store patterns
   instead of parallel implementations. Read before writing; never reference an API I
   haven't opened.
10. **Ledger stays current.** I update the ledger below when a stage lands, including
    what is NOT verified.

## Build ledger

| Stage | Scope | Status |
|---|---|---|
| S0 | Charter + task tracking | done |
| S1 | FakeSerialConnection + GRBL simulator + lifecycle integration tests (baseline) | done — `src/__fixtures__/controllers/` (fake port, pure GRBL v1.1 reducer, timing glue; 15 sim tests) + `src/ui/state/laser-lifecycle.simulator.test.ts` (13 store-level lifecycle tests: connect/handshake, poll, jog, frame, home, stream, pause/resume, stop→alarm→unlock, error:N terminal ×2, cable yank, G92 origin, console). Characterized finding: with an `errored` streamer, `unlockAlarm` is gated behind Stop by design. Not verified: real hardware. |
| S2 | ControllerDriver seam: types, GRBL driver, store/line-handler/console via driver, per-profile baud | done — `src/core/controllers/` (ControllerEvent superset incl. busy/resend, ControllerCapabilities, ControllerDriver, selectControllerDriver) + `grbl/driver.ts` byte-identical assembly (driver.test.ts pins bytes). Store/line-handler/console/settings/safe-write/transcript all firmware-neutral; `capabilities` snapshot in LaserState; connect takes `{controllerKind, baudRate}`; `DeviceProfile.baudRate` optional field (not yet persisted/editable — S4). Proof: lifecycle sim transcripts unchanged, 526 state+controller tests green, full suite 2576 green ×3. UI capability GATING deferred to S4 where non-GRBL caps make it observable. Flake note: one full-suite run showed 2 unreproducible failures right after S2c; 3 subsequent full runs green; culprit unidentified — watch in later stages. |
| S3 | grblHAL + FluidNC: detection, code tables, catalog, sims | done — ControllerKind grows (grblhal, fluidnc); variant drivers (FluidNC: settings readonly-dump + no grbl-laser panel; write path store-blocked); banner detection registry (FluidNC checked before generic Grbl; GrblHAL welcome-regex fix in grbl classifier); `detectedControllerKind` in state + mismatch advisory log; grblHAL alarms 11–13 decoded; 2 catalog starters; `.lf2` round-trips kinds + baud and drops junk (guard centralized in device-profile). Verified via simulator variants (banner-only deltas) + lifecycle tests. grblHAL is hardware-verifiable on the Falcon — NOT yet burned in this session. |
| S4 | Marlin: protocol module + simulator + output strategy (inline/fan dialects) + UX | pending |
| S5 | Smoothieware: protocol module + simulator + strategy (0–1 S scale) + UX | pending |
| S6 | Ruida: .rd encoder + golden fixtures + file export; UDP session (Electron) + sim | pending |
| S7 | Docs sync (PROJECT/WORKFLOW/DECISIONS ADR-094+), final full-suite pass, ledger truth check | pending |
