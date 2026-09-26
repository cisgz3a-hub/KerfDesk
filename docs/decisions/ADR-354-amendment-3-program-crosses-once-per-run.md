## ADR-354 Amendment 3 - The program crosses to the worker once per run (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

Supersedes the size-scaled arm deadline of Amendment 2. Port ownership, line order, the ready
barrier and the refill algorithm are unchanged.

### Context

Every arm carried the whole streamer, and its `queued` array is the entire program, sent lines
included. The main thread copied it with a structured clone and the worker decoded the copy
before it could reply. Amendment 2 kept that copy from closing the port by stretching the arm
deadline by 5 µs for each queued line. That left three costs:

- the copy still ran inside the deadline, covered only by a margin that counts lines, not bytes;
- it was repeated at Start, at every Resume and at every tool-change Continue;
- a worker that never answered a large job's arm was noticed late, 27 s after the arm for 5M
  lines.

Measured in Chrome 153, headless on the development machine, with a worker that answers each
message it receives: posting the old arm for 5M short raster lines took 312-506 ms of main-thread
copy, and the reply came 736-893 ms after the post. For 1M lines those figures were 47-68 ms and
96-134 ms. The audit measured Node's copy of 5M lines at about 2 s.

### Decision

1. The handover sends a run's program in its own `program` message: the UTF-8 bytes of every
   queued line, back to back, and a Uint32 table of line offsets. Both ArrayBuffers are in the
   postMessage transfer list, so they move to the worker instead of being copied. The native
   bridge in `native-serial-connection.ts` and the transferred-stream bridge both pass the list
   through.
2. An `arm` names the program by id and carries only the stream position: status, mode, indices,
   counters, window size and the in-flight lines. The controller's receive window bounds the
   in-flight lines at 4,096 bytes.
3. The streamer's `queued` array identifies the program. A run keeps that array for its whole
   life, because Pause, Resume and tool changes copy the state around it. A new run or a changed
   program has a new array. The handover keeps each program's id in a WeakMap keyed by that array,
   so it never keeps a finished job's lines alive. When the worker already holds the queue, Resume
   and Continue send only the arm. A new run always sends its program, even with identical lines.
4. The worker stores the buffers as they arrive, in constant time. It reads lines through a
   read-only array view that decodes only the line the refill asks for. It adopts an arm by
   pairing the position with the program it holds. If it does not hold the named program, it
   answers `refill-stopped` before any held line. The main thread then keeps the refill, and no
   line is sent twice or skipped.
5. The worker holds at most one program. It lets go of it when a newer program arrives, when it
   posts `refill-stopped`, when it releases a stream that has ended, and when the session closes.
   The main thread forgets its record on the same `refill-stopped`, or on the `released` reply
   that names the retired program, so its next arm sends the program again.
6. The deadline stops while the main thread encodes and posts a program. It restarts at the plain
   `WORKER_HANDSHAKE_TIMEOUT_MS` (2 s) just before the arm is posted. The 5 µs-per-line extension
   of Amendment 2 is removed. The deadline now covers the copy of a bounded arm, the worker storing
   a transferred program, and the worker adopting a bounded position. None of that grows with the
   job, so scaling the deadline would only delay noticing a silent worker. A worker that does not
   answer still fails the handover and closes the port.
7. The worker must refill exactly the bytes the main thread would have sent. A program whose
   lines UTF-8 cannot reproduce exactly (only a lone UTF-16 surrogate can fail) is not handed over.
   The same applies to a queue that is not all text. The main thread keeps the refill, as on a
   transport that cannot host it, and logs a warning. No such line can reach a controller anyway.

### Consequences

- Copying a large program can no longer outrun the deadline and close the port, on any machine.
  A silent worker is noticed after 2 s, whatever the job size.
- Resume and tool-change Continue no longer copy the program. In the same Chrome measurement the
  program's transfer took at most 0.2 ms to post, and the arm's reply came 0.3-0.7 ms after the
  arm was posted, for 1M and 5M lines alike.
- The main thread still encodes the program once per run, at the first arm's barrier. That took
  57-69 ms for 1M lines and 171-221 ms for 5M lines in Chrome, and no lines cross the barrier
  meanwhile. A very large job can therefore still pause briefly at Start, for less than half as
  long as before and once per run. Encoding before the first window is written would remove that
  pause, but it needs a change to Start and remains a follow-up.
- After the transfer the worker owns the program's bytes: about the program's size plus 4 bytes
  per line. It keeps them until the run ends, a newer program arrives, the refill stops, or the
  connection closes. A job aborted while paused keeps its program in the worker until the next job
  or disconnect. The main thread keeps no copy of the buffers.
- The protocol changed. `arm` carries `programId` and `position` instead of `streamer`, and
  `program` is new. `released` can name a retired program, and `refill-stopped` also answers an
  arm whose program the worker does not hold. Both worker shells run `serial-worker-core.ts`, so
  both follow the same rules.

### Evidence

- `worker-refill-handover.test.ts` checks the message sequence and transfer list: the program
  goes once with both buffers transferred, and the arm carries only the position. The arm for
  200,000 lines is no larger than the arm for 3 lines. A post costing 1 ms per copied kilobyte
  cannot fail the handshake. Neither can a program encode that takes ten deadlines. A silent
  worker still fails at the plain deadline for 200,000 lines. Resume re-arms without resending the
  program, and a new run or a retired or stopped program sends it again. A program that cannot
  be encoded leaves the refill on the main thread.
- `serial-worker-program.test.ts` checks that lines read back exactly, including multi-byte text,
  and that a lone surrogate is refused. It covers the array reads the refill uses, refused writes
  and malformed buffers. In the worker core it covers refilling from the named program, refusing
  an unknown program before any held line, and keeping the program across Pause. It also covers
  retiring the program after an ended stream or a reset, and keeping only the newest program.
- `native-serial-program-transfer.test.ts` runs the production native path over a real Node
  `MessageChannel` that honours transfer lists: 60 lines with a Pause and Resume. The program
  crossed once, and both buffers were empty on the main thread after the transfer. The two arms
  named it without carrying lines, every line reached the port double exactly once and in order,
  and the final release retired the program.
- The Resume and tool-change Continue tests in `src/ui/state/` run through the real store and
  re-arm with the program the worker already holds.
- In real Chrome, `serial-worker-handover.e2e.ts`, `serial-worker-framing.e2e.ts` and
  `native-serial-background.e2e.ts` pass. The handover spec now asserts that the program crossed
  once and was detached, and that every arm stayed under 1,000 characters.
- 23 of the new and extended tests fail against the implementation before this change. The
  encode-deadline test passes there, because that implementation has no encode step. It fails
  once the deadline hold is removed from this one.
- Not verified on hardware or in a packaged desktop build.
