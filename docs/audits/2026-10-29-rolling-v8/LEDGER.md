# Rolling audit v8 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| N1 | Fix: jobs stream off the window (#1500) | origin/main @ 33bc394c6 | [N1-fix-window-stall.md](N1-fix-window-stall.md) | 5 | 0 | 1 | 1 | 3 | 4 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| N1-P1-1 | N1 | **One Marlin `echo:Unknown command` that does not match the line in flight hands the job's refill back to the window for the rest of the run, with no notice.** The worker stops refilling on every unknown-command echo; the main thread records the skip only when the echoed command matches the line in flight, so a corrupted line (serial noise drops the `G` of a `G1`) is ignored there, yet the refill stays with the window. A later window stall leaves the beam lit over a stopped head: 1,020 ms (inline) and 1,392 ms (fan) on a 1.6 s block. Job Review still reads `jobStreamHost` = worker. KerfDesk's own G-code never triggers it | **READ** (main `33bc394c6`): `hosted-refill.ts:28-30` (every `unknown-command` stops the refill), `worker-refill-handover.ts:80-90` (`refill-stopped` → phase `main`, nothing logged), `laser-unknown-command.ts:44-48` (`echoedCommandMatchesLine` gate), `laser-stream-ack.ts:138-147` (window writes refills), re-arm only at Start / Resume / tool-change Continue. Auditor REPRO (injected echo) + refuter REPRO (modelled UART byte loss) | fix card proposed |
| N1-P2-1 | N1 | **Marlin Abort and Disconnect wait for the worker's `released` reply before writing the stop lines**; the worker stops refilling at once, but the reply queues behind every line the window has yet to process, so after a stall the stop is delayed by the backlog. Matters for the fan dialect only (inline is already bounded by ADR-395's ~1 s). PLAUSIBLE: the lit stop at a real per-line cost was not reproduced | **READ** (main): `laser-job-stop.ts:159-161` and `laser-disconnect-stop.ts:70-72` await `releaseHostedRefillBeforeStop` before the freeze; `serial-worker-core.ts:221-232` drops the streamer and posts `released`. Auditor + refuter READ; refuter measured the mechanism, not a lit stop | fix card proposed |
