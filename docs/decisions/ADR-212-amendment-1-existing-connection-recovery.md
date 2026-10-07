## ADR-212 Amendment - Recover controller information through the existing connection

**Status:** Accepted by the maintainer's request to build the recovery fix. **Date:** 2026-10-07.

An incomplete job does not establish a lost connection. Controller information,
serial response ownership, physical position authority and an interrupted job
remain distinct. Pause/Resume without a controller reset and clean completion
keep the current connection and do not trigger another settings read. The
existing reset-based CNC Pause and lift still revalidates information through
that connection.

Abort and recoverable information refresh use the current serial connection.
A missing reset greeting alone does not justify replacing a responsive port.
Automatic information recovery waits for owned cleanup, real command/write
and acknowledgement ownership, and fresh current-session Idle. Successful
reset-byte delivery or a later Idle report cannot erase earlier response debt;
an observed reset boundary can resolve it. Explicit read-only settings queries
retain the existing supported Alarm-read behavior and the same ownership fences.

Abort, controller-error reset and disconnect share one commanded reset owner.
Its operation persists while cleanup transport writes are pending, even after
the pending cleanup object has been dispatched. Alarm/Sleep and numbered ALARM
still invalidate their required coordinate evidence, but cannot cancel that
owner or detach its outstanding writes from the ledger. A completed failed
transaction releases its shared registration while retaining failed recovery
in state, so a subsequent explicit Abort can own a fresh reset.

A rejected reset write or missing greeting still receives the bounded
best-effort beam/spindle-off and coolant-off attempt. That delivery does not
resolve response ownership or establish a physical stop. A later observed
reboot performs its own causal cleanup. An ordinary cleanup write still
crossing that boundary keeps the response fence until a later stable boundary.
Disconnect joins the same transaction using its current writer. Failed canonical
Wake releases only its completion lease, so later confirmed cleanup can finish
without clearing a newer operation or newer completed Frame.

Fresh communication is tracked separately from trusted position evidence.
Responsive Alarm/Sleep and other non-Idle reports keep automatic recovery
waiting. Actual silence may fail readiness; a later valid response may resume
that readiness flow. An empty or rejected settings dump requires explicit Retry.
Retry uses the store's actual read gate and checks it again when clicked.
Reconnect depends on current communication or unresolved ownership, rather
than the presence of a historical safety notice, and checks again at click time.

At the sustained acknowledgement-stall threshold, this amends ADR-345's
telemetry-only choice: host refill is frozen before reset or queued beam-off.
The existing dwell/busy suppression and warning threshold remain in effect.
Late acknowledgements cannot refill an abandoned job. Queued shutdown on a
controller without realtime reset does not establish physical containment.

A CNC transition confirmation timeout retains its paused job and has a separate
nonterminal notice. Saved recovery records retain their exact artifact and
active state through that guidance. A preliminary reset-owned host freeze is
not archived before accepted Abort, actual Disconnect or a real fault supplies
the terminal cause. Intentional Disconnect retains that provisional freeze
until closure; automatic transport faults keep their established semantics.
Existing durable handoffs and first-terminal ownership remain in force.

A reboot after the final job acknowledgement but before the drain marker and
stable Idle settlement interrupts the run. New-session reports cannot convert
that interrupted run into successful completion.

This amendment preserves ADR-565's reusable spatial Frame evidence and exact
one-use execution claims. It adds no ordinary Start policy gate, automatic
unlock, homing, job resume, licence check or firmware-setting write. Existing
controller-specific Abort and quickstop behavior remains. Machine-safety
warnings still require operator acknowledgement. An acknowledgement made while
connection closure is pending remains effective; a subsequent failure receives
its own new notice. Simulation and build results
do not qualify physical hardware.

### Bounded response ownership and provisional stop display

After the reset cleanup owner finishes, outstanding write and acknowledgement ledgers get an eight-second diagnostic window. Fresh Idle reports prove communication but do not extend the missing acknowledgement's window. Completing a status-poll write is not progress on a cleanup acknowledgement. Real owned operations, including manual Home, retain their existing busy allowance; each remaining ledger only gains another window when that ledger actually advances. The independent communication-silence window may expire before a ledger's extended window. A timeout reports failed controller-information recovery and offers Reconnect while preserving the actual outstanding write counts and reply reservations. Reconnect guidance also waits during normal sending, paused or draining jobs and owned manual operations; a terminal errored host freeze remains eligible for recovery. Its guidance distinguishes writes still in transport from unresolved acknowledgement reservations; an unaccepted transport write does not prove that the controller owes a reply. Actual transport settlement, a later real reply or an observed reboot can resolve that ownership and resume the same-port refresh. The timeout proves no physical stop or recovered position.

The reset-owned errored sender freezes host refill before the first transport await. Its canvas timing becomes unavailable without publishing a terminal lifecycle or end timestamp. Late replies and Alarm/Sleep status invalidations cannot promote that provisional freeze into a fault. Accepted Abort supplies stopped, actual port closure supplies disconnected, and a rejected or timed-out reset write supplies errored. Existing genuine fault notices retain their terminal cause. This allows the first-terminal canvas guard to stay strict rather than requiring a later stopped patch to overwrite an earlier provisional errored patch.
