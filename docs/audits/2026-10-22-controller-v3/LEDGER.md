# Controller audit v3 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| D2 | Focus and Z | 7cd526213 | [D2-ctl-focus-z.md](D2-ctl-focus-z.md) | 5 | 0 | 0 | 1 (P3-3 raised) | 4 | 3 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| D2-P3-3 (P2) | focus-z | Auto-focus accepts a `G38.2`–`G38.5` probe with no F word and no feed cap (even `F100000` passes): GRBL reuses the last modal feed, so after a 6000 mm/min job the probe drives toward the bed at up to `$112` and overruns contact by ~3.5 mm (vs 0.14 mm at F100) | **READ**: `autofocus-command.ts:139-146` `probeIssue` makes F optional and only checks `F > 0`; KerfDesk's own probes always write F. **SOURCE**: gnea/grbl `gcode.c:418-421` (no F → last feed; `error:22` only if none since reset), `planner.c:389`, `probe.c:64`. Refuter REPRO (a fill job ends `F6000`, next probe inherits it) | open |
