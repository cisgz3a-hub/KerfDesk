# Full guard/block/alarm inventory — frame-first disposition (ADR-228)

**Date:** 2026-07-18 · **Directive:** maintainer, verbatim: "FRAME IS SOURCE OF TRUTH … when a
frame completes. start can start with no blocks or guards or checks at all. no alarm. frame is
good start is open … no guard will ever be created again."

Disposition legend:
- **DELETED** — the gate is removed from the tree.
- **DEMOTED** — no longer refuses; the same message now appears in the Job Review warnings list.
- **KEPT (transport)** — the serial channel factually cannot accept a stream; Frame cannot run in
  this state either. Not a policy guard. Fix offered in place where one exists.
- **KEPT (compile)** — the program factually cannot be produced or contains unstreamable bytes.
- **KEPT (handoff)** — consistency between the reviewed program/setup and the streamed one.
- **KEPT (input)** — a placement mode literally lacks the origin/position it compiles from; the
  refusal offers the one-click fix (Set origin / Reset origin).
- **KEPT (resume/recovery)** — resume and supervised-recovery integrity, not ordinary Start.
- **UNCHANGED (non-Start)** — outside the Start path (jog/fire/console/origin/probe/etc.);
  inventoried here per the directive, not modified by ADR-228.

## 1. The one Start guard (NEW)

| Gate | Disposition |
|---|---|
| Frame-first gate: Start requires a completed Frame whose bounds signature + origin identity (WCO, custom-origin flag) match the exact compiled job; any drift forces a re-frame. Sole refusal message offers to run the Frame in place. Applies to laser AND CNC, every placement mode. | **THE GUARD** |

## 2. Start-path gates — laser + shared

| # | Gate (old behavior) | Disposition |
|---|---|---|
| 1 | Job already active (streamer) | KEPT (transport) |
| 2 | Jog/Frame motion operation active | KEPT (transport) |
| 3 | Controller operation active | KEPT (transport) |
| 4 | Auto-focus running | KEPT (transport) |
| 5 | Controller alarm (alarmCode / status Alarm) | KEPT (transport) — Unlock/Home offered in place |
| 6 | No status report yet | KEPT (transport) |
| 7 | Machine not Idle | KEPT (transport) |
| 8 | Pending console write at wire (drains first) | KEPT (transport) |
| 9 | G-code line exceeds controller RX buffer | KEPT (compile) |
| 10 | Double-Start staging race | KEPT (handoff) |
| 11 | Controller settings unknown / $30 absent / $32 absent | DEMOTED (warnings; #284 started this, ADR-228 completes it for CNC too) |
| 12 | $30 mismatch vs profile (laser) | DEMOTED |
| 13 | $32=0 on laser (the past latched-$32=0 firing incident gate) | DEMOTED — carried by the Job Review $32 acknowledgement banner |
| 14 | $32=0 wire-boundary re-check (laser-mode-start-evidence) | DELETED |
| 15 | Evidence-changed wire re-check (settings changed mid-Start) | KEPT (handoff) |
| 16 | Unverified-$32 unacknowledged wire re-check | KEPT (handoff — the review acknowledgement satisfies it) |
| 17 | Ordinary-Start controller qualification (qualifying/failed/stale) | DELETED (both machine kinds; #284 had removed laser only) |
| 18 | Absolute-home gate (homing-capable + Absolute + not homed; hard-disabled Start button AND refused Frame) | DELETED (module removed) |
| 19 | Camera placement gates at Start/Frame (absolute-only, geometry, home/position-epoch) | DELETED from Start and Frame; camera panel keeps its own in-panel confirmation UI |
| 20 | User Origin without "Set origin here" | KEPT (input) — offers Set origin |
| 21 | User Origin WCO unknown | KEPT (input) |
| 22 | Absolute with custom origin active | KEPT (input) — offers Reset origin |
| 23 | Current Position without live position | KEPT (input) |
| 24 | Verified-origin frame requirement | SUBSUMED by the universal frame gate |
| 25 | Compile failure (raster budget, variable eval, registration, etc.) | KEPT (compile) |
| 26 | Emit preflight: non-finite coordinate / empty output / relief-needs-CNC / no output layer | KEPT (compile) |
| 27 | Emit preflight: out-of-bed (incl. relative span > bed, overscan note) | DEMOTED |
| 28 | Emit preflight: no-go-zone collisions (incl. hand-set-origin uncheckable case) | DEMOTED |
| 29 | Emit preflight: laser-on-travel, long blank feed, layer power/speed/passes, mode mismatch, raster transform, rotary raster | DEMOTED |
| 30 | Placement-bounds check (origin would place job off-bed / through no-go) | DEMOTED |
| 31 | "Setup changed while Start was being prepared" post-review re-check | KEPT (handoff) |
| 32 | Execution-signature / external-environment / completed-receipt re-checks | KEPT (handoff) |
| 33 | Job Review dialog (ADR-224) — Confirm streams the exact reviewed program | KEPT — the single warning popup the directive names |
| 34 | Blocked-Start fix offers for deleted gates (Zero-Z, probe-plate, override reset, absolute-home Home offer, apply-$30) | DELETED with their gates |

## 3. Start-path gates — CNC-only

| # | Gate (old behavior) | Disposition |
|---|---|---|
| 35 | CNC dialect gate (CNC_REQUIRES_GRBL) | DEMOTED |
| 36 | Missing work-Z zero at Start | DEMOTED — warning; Zero-Z remains available in the panel |
| 37 | Unknown first tool / tool-vs-Z-evidence mismatch | DEMOTED |
| 38 | Probe-plate removal at Start | DEMOTED (mid-job tool-change probe-plate check kept — resume/recovery class) |
| 39 | Override observation missing / values >100% / reduced-override acknowledgement | DEMOTED (reduced-override warning text kept in review) |
| 40 | Accessory observation missing / spindle-coolant active / secondary spindle / encoder fault / firmware tool-change latch | DEMOTED |
| 41 | Fresh Ov:/A: live-state fence (3 s loop) at wire | DEMOTED to one fresh status report (transport liveness only) |
| 42 | MPG pendant owns control | KEPT (transport) |
| 43 | CNC wire connection/alarm/status/Idle asserts | KEPT (transport) |
| 44 | CNC setup attestation binding (exact program + controller epoch) | KEPT (handoff — the Job Review CNC confirmation IS the attestation) |
| 45 | Start reservation epochs (trusted position / work-Z) | KEPT (handoff) |
| 46 | Tool-plan vs M0 pause-count mismatch | KEPT (compile) |
| 47 | CNC $30≠spindle-RPM / $32=1 / absent settings readiness errors | DEMOTED |

## 4. Resume / recovery gates (not ordinary Start) — all KEPT (resume/recovery)

Checkpoint fingerprint match; checkpoint-changed re-checks; CNC automatic line-restart disabled;
CNC Resume manual-recovery block; laser resume review confirm; supervised CNC recovery
(qualification, physical checklist items, runway proofs, package hashing, policy assessment,
manifest match, claim/staging integrity); pass-boundary recovery review (cutter clear, spindle
stopped, workholding, tool, retained-WCO proofs); tool-change mid-job holds (Idle wait, new-bit
Z zero, bit-identity, probe plate). Rationale: these prove a re-entry matches physical reality
and exact bytes; Frame proves placement of a fresh job, not mid-program state. Deleting them is
a separate decision the maintainer has not asked for.

## 5. Non-Start surfaces (inventoried per the directive; unchanged by ADR-228)

- **Jog:** busy/idle/status gates, no-go-zone jog block, CNC point-move work-Z block, jog-to-point
  position requirement.
- **Fire:** Labs flag, capability/profile/device-profile enablement, connection/alarm/Idle/
  position/busy gates, positive-S computation.
- **Home/Unlock/Wake:** capability + busy gates.
- **Pause/Resume:** $32-confirmed pause gate, CNC resume block, transition serialization,
  fail-dark timeouts.
- **Origin actions:** ready-state asserts (connect/Idle/busy/acks), persistent-origin confirms,
  release-motors confirm.
- **Console/settings:** busy/Idle/ownership gates, non-GRBL $-write refusal, machine-kind $
  mismatch, persistent-write confirm, settings-backup-before-write, value validation.
- **Autofocus:** connection/Idle/busy/command-shape gates.
- **Probe:** preflight (busy/idle/spindle-off/dwell) gates.
- **Camera:** marker-burn prepare/confirm path (now inherits frame-first demotions), bed-coordinate
  confirm in Overlay panel.
- **Abort/stop:** no gates (Abort is always available); post-hoc safety notices inform only.
- **Safety notices:** all inform-only.

These were NOT touched because framing does not substitute for them (a frame proves job
placement; it proves nothing about a jog vector, Fire, or a $-setting write) and most are
transport/busy interlocks. Under CLAUDE.md rule 7 they may be narrowed or removed at the
maintainer's request at any time — say the word per item.

## 6. Hard rule

CLAUDE.md rule 7, PROJECT.md non-negotiable #21, and ADR-228 now state: **no guard will ever be
created again; Frame is the only guard and the source of truth.** New findings become Job Review
warnings, never refusals.
