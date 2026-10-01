## ADR-355 Amendment 1 - Acknowledged override baseline

**Status:** Accepted repair of the existing per-job baseline and Fire ceiling contracts.
**Date:** 2026-10-02

**Context.** The power audit reproduced two independent timing failures in the actual controller
store using a stock-GRBL flag-order oracle. An intermittent Ov cache can retain a previous 100%
observation after a decrease. Even a newly requested report can print 100% before pending override
flags are applied. When decrease and reset flags enter the same accessory batch, the firmware
applies reset first and then decrease: the next burn remains at 90%. The corresponding increase
and Fire reset can leave its power multiplier at 110%, exceeding the intended capped S value.

GRBL removes realtime bytes from its receive buffer on arrival, but it applies their flags at
realtime processing checkpoints. Arrival is not completed execution. This corrects ADR-355's
earlier immediate-execution explanation and supersedes its known-100% reset omission. It also
amends ADR-375's corresponding Fire optimization.

**Decision.** A laser Start on a controller advertising realtime overrides validates the
executable first window, then uses an owned acknowledged driver settlement command to process
previously admitted flags. Ordinary framed Start obtains its fresh live-controller report after
that boundary. The supported channel always writes the standalone feed, rapid and spindle reset
bytes before its first program window. The exclusive Start reservation prevents another operator
override from entering this transaction. Each await retains controller, connection, request and
execution ownership; an overtaking Abort, reboot or replacement session cannot send the old
program or clear its replacement's reservation. A failed or silent command is a factual transport
failure, not an additional machining policy gate.

The realtime reset is distinct from an attempted program write. A known reset-only failure or
cancellation before the first program window reports an unaccepted Start and preserves the
previous recovery source. Manual recovery restores only its own in-flight checkpoint marker;
sealed recovery does not infer acceptance from a preinstalled streamer. A rejected actual program
write still retains the attempted run because it may have delivered a prefix, even if the port
closes before rejection. Existing transport quarantine remains in effect.

Low-power Fire uses the same owned acknowledgement boundary before the standalone spindle reset
and capped Fire-on command. Its activation latch and release/session fences keep the beam-on
command owned by that exact press. The requested percentage and the existing absolute cap are
unchanged. Controllers without realtime overrides receive neither the reset bytes nor this
override boundary. CNC keeps its existing override policy. Pause/Resume and adjustments during
an accepted running job remain unchanged.

An admitted override write also retires the old Ov observation before the transport's first
await. Refused writes do not change it; a later same-session report can restore an observation.
No command predicts a percentage, and no late write completion overwrites a newer report.

**Evidence.** The regression oracle follows ISR flag accumulation, status-before-override
ordering, reset-before-adjustment ordering and realtime processing before queued-command
acknowledgement. The output audit separately checks configured S maxima, scoped artwork power,
project persistence and selected M3/M4 modes. Software and protocol-model checks cannot establish
emitted optical watts or qualify every firmware build.

**Primary source.** [GRBL realtime processing](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c)
and [serial realtime flags](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c).
