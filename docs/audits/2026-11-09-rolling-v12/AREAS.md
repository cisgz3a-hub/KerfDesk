# Rolling audit v12: verify the fixes merged 2026-11-05 to 2026-11-09

**Requested by** the maintainer on 2026-11-09, who chose "Verify the new fixes" when rolling v11 closed.

**Scope.** Main is `29e3406e0`; its code is identical to `743d37bc4`, and the commits since then are docs only. The live desktop app is still 1.0.29 (`df2279e26`). About 30 code PRs merged in one train between 2026-11-05 and 2026-11-09, mostly on 2026-11-08 once CI came back:
- the v10 fixes (#1614–#1620);
- the W3 fix (#1628);
- the performance and UX P3 sweeps;
- another agent's relief change (#1622).

None has been re-audited. Some merged on CI results from before the outage, or close enough together that no CI ran on the combined result. Finding IDs are `X<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full:
- §3 with its clarifications;
- §4.

Each area gets an auditor and then a fresh refuter. The coordinator re-verifies every P1/P2 in main's code.

The lenses are L10 (fix verification, [v8](../2026-10-29-rolling-v8/AREAS.md)), L11 (returning user, [v9](../2026-11-02-rolling-v9/AREAS.md)) and L12 (untested merges, [v10](../2026-11-07-rolling-v10/AREAS.md)). For speed fixes, the [performance audit](../2026-11-02-performance-s1/AREAS.md) rule holds: the burn must not change.

**CI is available again.** Each area reads main's CI history for its PRs (`gh run list`) and states which required checks ran on the merged result. Local runs fill the gaps.

## Areas (run order)

| # | Area id | PRs | Original findings | Lenses |
|---|---|---|---|---|
| X1 | `fix-job-safety` | #1615, #1616, #1620, #1628, #1612 | V8-P2-1, V9-P3-1, V1-P1-1, V3-P2-1/2, W3-P1-1, W3-P2-1 | L10, L6, L4, L12 |
| X2 | `returning-user` | #1617, #1618, #1619, #1601, #1622 and everything else since 1.0.29 | V2-P2-1/2, V7-P1-1, V7-P2-1/2 against projects and profiles saved by 1.0.29 | L11, L9 |
| X3 | `fix-design-text-import` | #1614, #1617, #1601, #1602, #1592 | V7-P2-3, S7-P2-3, N4-P3-2 | L10, L3, L4 |
| X4 | `fix-perf-sweep` | #1593, #1594, #1597, #1606, #1607, #1608, #1611 | S2/S5/S8/S9 P3s, the tracer speed round | L10, burn identity, L12 |
| X5 | `fix-ux-sweep` | #1595, #1598, #1599, #1604, #1605, #1609 | U-audit P3s | L10, L9 (truthful wording), L12 |
| X6 | `fix-cnc-relief` | #1603, #1606, #1607, #1622 | S8-P2-1 and P3s, F6/16 relief findings | L10, L3, L6 |
| X7 | `cross-fix-journeys` | All of the above together | Whole jobs end to end; main's CI over the merge train | L10, L4, L9, L12 |
| X8 | `rotary-complete` | Rotary code as a whole (added 2026-11-09 at the maintainer's request) | "Put in a round glass … and burn perfect burn while it rotates": LightBurn parity, wrap accuracy on simulated controllers | L1, L3, L4, L9, LightBurn parity |

X1 runs first because it covers Abort, Pause, crashes and shutdown. X2 runs second because returning users are where the v10 P1s came from.

## Overlap with other work

The following are other work. Treat what they fix or have already found as KNOWN, and do not audit their diffs:
- open PRs #1623 and #1626, and another agent's pro-loop audits in `docs/audits/2026-11-08-pro-loop-v1` to `-v3`; read those audits before raising anything, because they cover controllers, tools and imported geometry;
- the open v11 fix cards: W2, W4, W5, W6, W7 and W9.

## Batching and rules

- **Agents and tools:**
  - One audit agent at a time.
  - Repros run on a scratchpad export of main whose `node_modules` is a junction to the main checkout's. Never delete it recursively.
  - Browser runs use a Vite alias for `fflate`, and the cached Chrome for Testing build.
  - Never run `pnpm` and never download anything.
- **Memory gates:** Vitest needs 1.5 GB or more available. A browser run needs 2 GB or more, headless, with one worker and one spec.
- **Safety:**
  - Never operate hardware; use simulated controllers only.
  - Never launch the installed KerfDesk.
  - Never call a live external service.
- **Security findings:** redacted in committed text until fixed.
- **Fix PRs:** opened with Auto-fix on and auto-merge using the MERGE method.

**Status:** DONE 2026-11-10. 37 raised, 0 refuted: P1 7, P2 9, P3 21, 15 KNOWN. See the round result in [LEDGER.md](LEDGER.md).
