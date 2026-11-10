## ADR-676 Amendment 5 - Job Review's lit-stop advice names why the window streams, and the warning leads the whole list (2026-11-10)

**Status:** Accepted on 2026-11-10 |
**Amends:** ADR-676 decision 5 ("It also says how to reach the worker", and "first in the list");
keeps the risk sentences, the scan (`core/gcode/stopped-head-power.ts`) and the advisory-only rule
unchanged

### Context

Rolling audit v8 area N1 (`docs/audits/2026-10-29-rolling-v8/N1-fix-window-stall.md`,
refuter-confirmed) raised **N1-P3-2 (P3, wording)**.

- Every window route got the same advice: turn Background streaming on in Machine Setup and
  reconnect, and on USB leave only one adapter of this kind plugged in.
- Some connections stream from the window because their worker could not start: a desktop
  network session whose worker answered `network-unavailable`, or a USB worker that could not be
  created or could not reach the port. There the setting is already on, and reconnecting meets the
  same failure. The audit's REPRO captured that text on the network-fallback route.
- Decision 5 says the warning goes first in the list. The gate put the Frame's WCS note ahead of it,
  and the live controller-identity disclosure, added after both, went ahead of it too.

### Decision

1. **The connection says why the worker did not take it.** `SerialConnection.backgroundStreamingUnavailable`
   is now a reason, not a flag:
   - `adapter-not-unique`: the window could not prove the picked USB adapter is the only granted
     port with its vendor and product IDs (an identical adapter, or one that reports no IDs), before
     the worker probe or on the recheck after it;
   - `worker-unavailable`: the USB worker could not be created, did not answer its probe, or could
     not reach the port; or the desktop network worker could not take the session.

   `tryOpenNativeSerialConnection` reports the first through a new `onFallback` callback; its null
   answer is unchanged.
2. **The live session records it beside `jobStreamHost`.** `windowStreamReason` is set at connect:
   null on a worker; `opted-out` when the profile turned Background streaming off; otherwise the
   connection's reason, or `no-worker` for a transport that offers none. Disconnect and port loss
   clear both through one shared patch (`NO_JOB_STREAM_HOST`).
3. **The advice follows the reason.**
   - `opted-out`: Background streaming is off for this machine; turn it on and reconnect.
   - `adapter-not-unique`: it is on, but the worker could not tell this adapter apart; leave only
     one adapter of this kind plugged in and reconnect.
   - `worker-unavailable`: it is on, but its worker could not start for this connection, so
     reconnecting is likely to end the same way.
   - `no-worker` (and an unknown reason): this connection has no background worker.

   Every route ends by asking the operator not to edit the project while the job runs.
4. **The warning leads the whole list.** The gate places it last of all its steps
   (`leadWithLitStop`), so the Frame's WCS note, no-go findings and the controller-identity
   disclosure follow it.
5. **Not adopted:** retrying the worker on reconnect, or telling the operator to restart KerfDesk.
   Neither is shown to help on any measured route.

### Consequences

- Job Review gives each window route advice that can work from there.
- `src/platform/types.ts` keeps its line count: the field's type changes in place.
- **Tests.**
  - `window-stream-lit-stop-warnings.test.ts`: each route's text, and the order helper.
  - `job-review-gate.reuse.test.ts`: through the gate, the warning leads a Frame WCS note and a
    controller-identity mismatch, with the `worker-unavailable` advice.
  - `laser-background-streaming-notice.test.ts`: the reason recorded at connect for each route, and
    cleared on disconnect.
  - `native-serial-connection.test.ts`: which reason each USB fallback reports;
    `native-serial-identical-adapters.test.ts`: two identical granted adapters report
    `adapter-not-unique`.
- **Not verified:** hardware, and the desktop network-fallback route end to end (unit-level only).
