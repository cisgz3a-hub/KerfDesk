## ADR-697 Amendment 1 - A short Ruida run finishes (2026-11-11)

**Status:** Accepted. Amends ADR-697 decision 5 (when a Frame counts as completed). Fixes code
quality audit C2 D1-P2-2. **Simulator-tested only; not qualified on a real controller.** |
**Date:** 2026-11-11

### Context

ADR-697 counted a Frame, or a job, as finished only after a status read saw the controller busy
and then idle twice. The first read came 400 ms after the last datagram's ACK. A Frame shorter
than that, such as a small tag near the head, was never seen busy. The store then stayed in
framing with no time limit, Start was ignored, and Abort followed by a new Frame met the same
wait.

### Decision

1. The first status read goes out as soon as the last datagram is acknowledged. Reads then
   follow every 400 ms as before.
2. A run seen busy still finishes after two idle reads in a row.
3. A run no read ever saw busy finishes after four idle reads in a row (0, 0.4, 0.8 and 1.2 s).
   By then the controller has acknowledged the whole file and reports idle. Its Frame counts,
   and the panel says that the frame was too short for any read to catch it moving.
4. While paused, nothing finishes, as before.

A controller that has not yet begun a received job could read idle for 1.2 s. In that case a
Frame would count early, but Start still reads the status first, and a busy controller is sent
nothing (ADR-697 decision 5).

### Evidence

`ruida-network-store.test.ts`, against the repo's `RuidaUdpSimulator` with a controller already
idle at the first read (`runReads: 0`):

- after three reads the store is still framing;
- after the fourth read the Frame counts and the message says why;
- a short job no read caught running also finishes;
- the job's warnings show from its Frame on.

The earlier test that pinned the never-ending state was replaced.
