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
| S4 | Marlin: protocol module + simulator + output strategy (inline/fan dialects) + UX | done — `core/controllers/marlin/` (text-vocabulary classifier incl. busy/Resend/Error:, M114→Idle status synthesis, G91/G0/G90 jog, G90+G0 framing, G28 X Y homing, M400 settle, M5+M107 stop lines, M112 console E-stop, M500/M502 blocked); queued M114 polling gated on outstanding acks + pending controller commands (gate bug caught by lifecycle test: `done` streams must poll or post-job settle deadlocks); marlin-inline strategy = GRBL wire shape @ S 0–255, marlin-fan = M106/M107 transform (invariant #3 checker taught M107-as-off); readiness relaxed to explicit power-scale-unverified warning for non-$$ firmwares; UI capability gating landed (OriginRow hidden w/o WCS, jog-cancel row, stream-side pause copy, unlock hidden, GRBL panels gated, console quick commands + validation from driver); catalog Generic Marlin profile (250000 baud, ping-pong). 11 Marlin lifecycle integration tests green. Simulator-verified ONLY — no Marlin hardware touched. |
| S5 | Smoothieware: protocol module + simulator + strategy (0–1 S scale) + UX | done — `core/controllers/smoothieware/` (GRBL realtime bytes ?/!/~/Ctrl-X kept; no $J/$$/$X/$SLP; G28.2 homing; M999 halt recovery; `!!`/text errors terminal; config-set blocked); fractional-S strategy (virtual-1000 emit rescaled to profile max — S0.500 at max 1.0, integer at large scales; invariants #3/#5/#7 tested); realtime pause allowed WITHOUT $32 proof on non-dollar firmwares (laser module ties beam to motion); catalog Generic Smoothieware profile (maxPowerS 1, ping-pong); Smoothie simulator + 9 lifecycle integration tests (incl. halt→M999 recovery and pause-without-$32). Simulator-verified ONLY — no Smoothieware hardware touched. |
| S6 | Ruida: .rd encoder + file export; pure UDP session state machine | done — `core/controllers/ruida/`: swizzle (round-trip-tested every byte), 35-bit coord + 14-bit power encodings (round-trip incl. negatives), minimal command vocabulary (move/cut/layer speed/power/color/bounds/framing), deterministic `.rd` encoder that REFUSES raster groups; decoder test-instrument proves encode→decode geometry/power/speed fidelity; io/rd emitRdFile (shared prepareOutput pipeline + geometric preflight) + Save-.rd routing with a repeated EXPERIMENTAL toast; `transport: 'file-only'` capability disables Connect + hints; pure UDP session machine (checksum framing, ACK/ERR retry) sim-tested. HONESTY: encoding follows public research (MeerK40t/EduTech, clean-room); NO file has been accepted by a real Ruida controller; live UDP socket/IPC (Electron main) NOT built — profiles stay file-only until it is. |
| S7 | Docs sync (PROJECT/WORKFLOW/DECISIONS ADR-094..097), final full-suite pass, ledger truth check | done — ADR-094 (driver seam + capability gating, supersedes ADR-006's GRBL-only scope), ADR-095 (Marlin), ADR-096 (Smoothieware), ADR-097 (Ruida experimental) appended to DECISIONS.md; PROJECT.md Phase H section + hardware truth table; WORKFLOW.md F-H1..F-H4 flows. Final gate below. |

## What is NOT done (honest remainder)

1. **Hardware passes** — nothing in Phase H has been burned on real hardware this
   session. The Falcon A1 Pro can verify GRBL + grblHAL immediately; Marlin /
   Smoothieware / FluidNC need borrowed boards or community verification (the
   diagnostic-bundle export exists for that); every non-GRBL profile carries
   `unverified` evidence.
2. **Ruida real-controller validation** — the .rd encoder round-trips through this
   repo's own decoder only. Next: obtain a reference .rd (or a real RDC644x),
   compare/validate, only then wire the Electron UDP socket + IPC to the pure
   session machine in `ruida-udp-session.ts`.
3. **Wizard controller-family step** — profiles select the family today (catalog +
   Machine Setup); a dedicated wizard step with detection-driven suggestions is
   polish, not blocking.
4. **Small copy/labels** — "Save G-code…" menu label also saves .rd for Ruida;
   ConsolePanel aria-label still says "GRBL console"; Marlin dialect picker is
   profile-JSON only (no dropdown UI yet).
5. **Suite flake diagnosis** — two full-suite runs (once after S2c, once at the S7
   gate) showed 1–2 five-second-timeout failures in unrelated heavy tests (trace
   end-to-end, grbl fuzz determinism). Both times the run was ~5× slower than
   normal (366s vs ~75s) with a saturated vitest worker pool; the same files pass
   in isolation and the immediate full-suite re-run on a quiet machine is green
   (422 files / 2648 tests). Diagnosis: machine-load timeouts, not product bugs.
   If it recurs in CI, raise testTimeout for those two suites.
