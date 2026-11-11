# Rolling audit v14: verify the v13 camera and rotary fixes

**Requested by** the maintainer on 2026-11-10. When rolling v13 closed, they chose "Verify the open fixes".

**Scope.** The v13 fix PRs, each audited once it has merged. They come from three sessions:
- **Camera:** the UI-thread picture work and the overlay (Y4-P1-1, Y4-P1-2 via #1691, Y4-P2-1).
- **Rotary A/Z resume:** Y5-P1-1, Y5-P1-2 and Y5-P1-4.
- **Rotary surface feed:** Y5-P2-1, Y5-P1-3 and Y5-P2-2.

The same rule as v12 applies: the maintainer's round-glass goal ("put in a round glass … and burn perfect burn while it rotates") is the yardstick. Finding IDs are `Z<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full. Each area gets an auditor and then a fresh refuter, and the coordinator re-verifies every P1/P2 in main's code.

The lenses are L10 (fix verification), L12 (untested merges, since several fix PRs touch the same files) and L3 (twin routes: Y port vs A/Z, window vs worker streaming, PC vs phone).

## Areas (run order, each once its fixes have merged)

| # | Area id | Fixes | Original findings | Lenses |
|---|---|---|---|---|
| Z1 | `camera-thread-verify` | #1691 and the job-watch worker PR | Y4-P1-1, Y4-P1-2, Y4-P2-1 | L10, L12; Abort latency measured with the watch on, at 4K and 24 MP; window and worker routes |
| Z2 | `rotary-resume-verify` | The rotary-axis session's PRs | Y5-P1-1, Y5-P1-2, Y5-P1-4 | L10, L3; Abort re-run, Start from line and lost-link recovery on A, Z and Y; the per-axis rate cap |
| Z3 | `rotary-feed-verify` | The rotary-speed session's PRs | Y5-P2-1, Y5-P1-3, Y5-P2-2 | L10; the taper clamp warning, row-step rounding, the old-project notice |
| Z4 | `round-glass-journey` | All of the above together | The maintainer's goal | L10, L12, L4; a full journey on simulated GRBL (Y), grblHAL (A), A1 Pro (A) and FluidNC: set up, camera placement, Frame, burn text, fill and photo, Abort mid-job, re-run, Start from line, a tapered tumbler, save and reopen; camera watch on throughout |

## Rules

The same as v13:
- one audit agent at a time;
- stub cameras only;
- simulated controllers only;
- the memory gates;
- never `pnpm`;
- security findings redacted until fixed;
- fix PRs use auto-merge with the MERGE method and Auto-fix.

**Status:** DONE 2026-11-11. All four areas ledgered; round result in [LEDGER.md](LEDGER.md#round-result-2026-11-11).
