## ADR-354 Amendment 2 - The worker handover deadline grows with the program it carries (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

ADR-354 made the native worker the default transport for GRBL-family connections. At Start, and
again on every Resume and tool-change Continue, the refill handover starts a
`WORKER_HANDSHAKE_TIMEOUT_MS` (2 s) deadline when it asks the worker to prepare. It then posts an
`arm` message carrying the whole streamer. That streamer's `queued` array is the entire program,
sent lines included.

The copy runs synchronously on the main thread, and the worker decodes it before it can reply. A
missed deadline terminates the worker, which closes the port. The 2026-09-25 audit of PRs
#845-#904 timed Node's `structuredClone` of that shape at about 0.4 µs a line: about 2 s for 5M
short lines. A slower machine crosses 2 s with fewer lines. So a multi-million-line raster or
relief job could lose its connection right after Start (SER-1).

### Decision

1. When the snapshot is posted, the deadline restarts at `WORKER_HANDSHAKE_TIMEOUT_MS` plus 5 µs
   for each queued line. That is about ten times the measured copy rate, so it leaves room for a
   slow laptop. The restart happens before the post, so the new deadline covers the copy, the
   worker's decode and its reply.
2. The prepare round trip, release, and a small program keep the plain 2 s deadline. A worker that
   never answers still fails the handover, closing the port as before.

### Consequences

- A large job no longer loses its connection because copying its program took more than 2 s.
- The copy still takes time, and no new lines reach the controller until the worker adopts the
  snapshot, so a very large job can still pause briefly at Start and Resume.
- The better fix is to send the program to the worker once per run as a transferable buffer, and
  hand over only indices and in-flight state. That needs a protocol change and measurement in a
  real browser, and remains a follow-up.
- Verified with unit tests on the handover, not in Chrome or on hardware.
