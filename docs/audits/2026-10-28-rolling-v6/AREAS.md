# Rolling audit v6 — follow-up areas

**Asked for by** the user on 2026-10-28: "You said worth auditing next round a few places lets do those audits."

**What this round audits.** Each area is a mechanism that an earlier refuter documented but did not raise as its own finding. Finding IDs are `K<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full.
- §3 clarifications from 2026-10-23 and 2026-10-27: P1 has no reach clause, and Frame is not a warning.
- §4: pinned citations; ADR quotes only from `docs/decisions` or `DECISIONS.md`.
- Each area gets an auditor, then a fresh refuter. The coordinator re-verifies every P1/P2 in main's code.

**Security rule:** a remotely reachable hole is held until fixed, as in v4/v5.

## Areas

| # | Area id | Origin | Scope | Lenses |
|---|---|---|---|---|
| K1 | `in-window-stall-beam` | J10 refuter (and an earlier refuter) | UI-thread stalls on the in-window transport, and the beam. See below. | L6, L2, L4 |
| K2 | `watchdog-timing` | J10 refuter | Job-time watchdogs against UI-thread blocks. See below. | L6, L4, L2 |
| K3 | `falcon-a1-pro-truth` | J8 refuter | The Falcon A1 Pro and other grblHAL Falcon presets against the published A1 Pro `$I`/`$$` dump and Creality's A1 Pro documents. See below. | L2, L1 |

### K1 `in-window-stall-beam`

**The suspected mechanism.** On the in-window transport, any stall of the UI thread drains the controller's buffer. Under constant power (M3) that may leave the beam lit on a stopped head.

**Which connections stream from the window thread.** Marlin, Smoothieware, network machines and ambiguous ports.

**What the auditor checks.**
- What happens to the controller's buffer during a UI stall.
- The beam state when motion stops under each power mode:
  - M3;
  - M4;
  - Marlin `M3 I` inline;
  - the Marlin fan (`M106`);
  - Smoothieware.
- The dose at the stop point.
- Which real stalls are long enough to drain the buffer.
- Whether any guard exists.

**Sources:** firmware source, pinned.

### K2 `watchdog-timing`

**The suspected false fire.** After a status check that saw no new reply, a UI block of 1.8–1.99 s may trip the 2 s controller-silence watchdog and reset a healthy job.

**The miss latency.** Detection may run as late as 3 × the block + 2 s.

**What the auditor checks.**
- The timer against serial-read ordering in Chromium.
- What a false fire does to a burn in progress.

### K3 `falcon-a1-pro-truth`

**What the auditor checks.**
- Homing: `$22=43` against the preset's homing off.
- Travel: 363 × 273 against 358 × 268.
- `$30`, `$31` and `$32`, soft and hard limits, rates and acceleration.
- CoreXY.
- Every other `$` setting KerfDesk writes or advises on these machines.
- Why ADR-370 hides `$$` on the Falcon.

**Owner's machine.** The maintainer owns an A1 Pro. If it is safe, end with a read-only checklist the maintainer can run on it.

## Batching

- Twelve fix sessions are running and the PC is low on memory, so at most two audit subagents run at a time.
- K3 is mostly source research, so it may run beside K1.
- K2 starts after K1's refuter.
