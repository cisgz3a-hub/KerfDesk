## ADR-606 - A job whose last replies were lost finishes without a controller reset (2026-10-17)

**Status:** Accepted. | **Date:** 2026-10-17

Amends the acknowledgement watchdog of ADR-345, and narrows ADR-600 decision 3
("never synthesize or replay a lost acknowledgement"), for one case only. The
serial readers keep ADR-600's rule exactly: damaged bytes are discarded through
the next delimiter and never become a reply. What changes is the store: a stream
whose every line is on the wire may finish on the controller's own status
evidence, not on any byte the reader recovered. The Frame-first Start contract
(ADR-565) and the stream ownership rules of ADR-334 and ADR-352 are unchanged.

### Context

The maintainer reported that the Pause and Abort bar often stays up after a job
has visibly finished, and that the controller then keeps asking to be
reconnected or re-read, something no other laser sender they use does.

The streamer counts `ok`/`error:N` replies in order: GRBL answers every line with
exactly one of them. A reply lost on the link (a UART line error from laser EMI,
already recorded by `laser-serial-line-errors.ts` under ADR-375, after which the
ADR-600 reader deliberately discards the damaged record) is therefore
never attributed to the line it answered. Every later reply shifts one line
forward, so the stream always ends one reply short: the machine has run the
whole program and parked, while the host still holds the last line in flight.

A simulator replay with one `ok` dropped mid-job shows what followed. The job
stayed `streaming` with the controller Idle for 90 s. The watchdog then raised
"The controller stopped acknowledging job commands", sent a soft reset, and
recorded the run as cancelled. On real hardware that reset reboots the
controller, so the settings are read again and the Controller information
notices and Reconnect offer appear. One lost reply on a long job was enough to
produce both reported symptoms.

ADR-345 records why Idle alone cannot prove a lost reply: a Creality Falcon A1
can sit Idle for about a minute with lines waiting in its own buffer, then
continue.

### Decision

On each status-poll tick, `laser-lost-ack-reconcile.ts` applies the missing
replies as acknowledgements when all of these hold:

- every line of the program is on the wire and only job lines are owed replies
  (no untracked acks, no transport writes, no controller or motion operation,
  no pause transition, no MPG);
- the controller has a realtime status query (not Marlin's queued poll);
- fresh status reports from the current controller session, received after
  the last acknowledgement, say Idle;
- when the report carries `Bf`, the receive buffer and planner are as empty as
  this session's quiescent Idle baseline showed them, for at least 8 s and two
  reports. A report showing unread input, or one with no baseline, proves
  nothing. This is what separates a held program from a lost reply;
- without `Bf` (stock GRBL and FluidNC at `$10=1`), Idle has held for 15 s and
  three reports;
- a G4 still in flight extends either window by its programmed time.

The windows are deliberately longer than any plausible delayed reply. GRBL
writes a line's `ok` before it can report the Idle that follows it, so a reply
missing behind several seconds of empty-buffer Idle has been lost, not delayed.
The existing hold tests still model a reply that arrives about six seconds late,
and those jobs complete through the reply as before.

The stream then reaches `done` through the ordinary acknowledgement path, so
the existing post-job settle runs. Its own settle marker and stable Idle confirm
completion as for any other job. The log names how many replies were lost and
on what evidence, and says that a lost reply may have been an error, so the
result should be checked.

Nothing here writes a reset or refuses anything. Every case the conditions
exclude keeps the ADR-345 watchdog unchanged, including a lost reply mid-job,
which is not proven by an idle machine.

### Evidence and limits

`laser-lost-ack-reconcile.simulator.test.ts` drives the real store against the
GRBL simulator through a link that drops one `ok`:

- without `Bf`, the job finishes after about 15 s with no reset, no safety
  notice and qualification intact;
- with an empty `Bf`, it finishes after about 8 s;
- with `Bf` showing unread input, it is still waiting after 30 s;
- an undisturbed job completes as before.

Without the change, the first two cases never release. No machine was operated.
How often replies are lost on a given machine depends on its wiring and USB
link, and remains for hardware qualification.
