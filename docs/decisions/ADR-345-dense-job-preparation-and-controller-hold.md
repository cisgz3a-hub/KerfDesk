## ADR-345 - Dense-job preparation cost, and a controller that holds its own program (2026-09-22)

**Status:** Accepted. | **Date:** 2026-09-22

Follows the 2026-09-22 Falcon A1 Pro report: Frame reacts about ten seconds
after the click, air stops after a few minutes, and the job sits Idle for about
a minute mid-burn before continuing. Hardware qualification remains separate.
The Frame-only Start policy of ADR-228/230/232/237 and the Job Review contract
of ADR-224 are unchanged.

### Context

A 200 mm fill at 0.1 mm line spacing with about ninety ink spans per row — the
reported owl — compiles to 364,009 sendable lines, 9.0 MB. Measured off the
main thread in a Node harness, uncontended, preparing that job for Frame took
35.4 seconds. The emitter itself was 0.7 s of it. The rest:

- **21.5 s in the preflight scanners.** They read the emitted program back
  through a shared word parser that built a fresh `RegExp` on every call, three
  to four times per line, and re-ran two comment-stripping replaces on lines
  that contain no comment.
- **1.7 s deciding coordinate encodability**, because the check materialised a
  `groups[i].segments[j].polyline[k].x` path string for every coordinate in the
  job in order to be able to name one failure.
- **1.1 s scanning for M7**, tokenising every motion line of a program whose
  motion lines contain no `M` word at all.
- **A second full preparation at Start**, because Job Review re-prepares on
  Confirm and that path always recompiled.
- **3.6 s of structured clone** handing the result from the worker to the main
  thread, one object per manifest point, 728,002 of them.

Then, immediately after the first window of the job reached the wire, the
execution archive was packed, built and walked on the main thread for 1.5 s and
discarded as over budget (258 MB estimated against a 64 MiB limit). On a
1024-byte streaming window that is roughly a second of buffered motion, so the
machine stopped once at the start of every dense job.

Separately, when the controller kept answering `?` while the lines already sent
to it went unacknowledged, the live bar read JOB RUNNING over a stopped machine,
and after ten seconds a safety banner said KerfDesk had frozen the stream and
requested a controller soft reset. That path does neither. The operator was
told the app had intervened when the app was, correctly, waiting.

The vendor facts behind the other two symptoms: Creality's wiki defines `$152`
as the wait before the machine enters standby after it decides work has
finished — 0..100, default 30, and 100 meaning the air pump and laser module are
never powered off — and LightBurn staff record the shipped 1.0.6 build dropping
the pump about thirty seconds after `M8`, fixed in the 1.0.7 debug build. This
project's own advisory recommended `$152=0`, which under that definition is
standby immediately: the opposite of what it intended.

### Decision

- The shared G-code word parser caches its compiled patterns per word and per
  command, strips comments through a fast path when a line carries none, and
  scans words with a hand-written loop. The loop is pinned token-for-token
  against `GCODE_WORD_PATTERN` on twenty thousand random inputs, so semantics
  cannot drift; only cost moves.
- `gcodeCoordinateFailure` decides the all-encodable case without materialising
  a path per coordinate, and runs the named walk only once a failure is known to
  exist. `gcodeUsesM7` tokenises only lines that contain both an `M` and a `7`.
- A Start preparation crosses the worker boundary with its motion manifest
  packed in the ADR-118 archive encoding. The client unpacks it and re-registers
  the program source before any caller sees the result, so `StartJobPreparation`
  is unchanged everywhere else. That packing does **not** apply the archive
  size budget: the handoff is not an archive, the archive is written later and
  is best-effort, and enforcing the budget on the handoff would make a large
  job unpreparable — a size-based Start refusal of exactly the kind
  ADR-241/243/244 removed.
- Job Review's re-prepare on Confirm reuses the displayed compile when it is
  provably what a fresh compile would return: the same project object, the same
  execution signature, the same machine inputs the compile reads, current
  controller evidence, and no time-bound input such as variable text or a
  Print-and-Cut registration. Any difference still recompiles, so approval still
  cannot bind to stale bytes or stale live evidence.
- `createExecutionArtifact` settles the over-budget case from the program text
  plus the packed manifest size before allocating or walking anything. The
  outcome and the message are those of the full measurement.
- A controller that answers status queries while its sent lines stay
  unacknowledged is a named, non-refusing state. The live bar reads CONTROLLER
  HOLDING PROGRAM with the count and age of the unacknowledged lines; the log
  records the facts once per episode — window, queue, `Bf`, owed acks, refill
  owner — and its duration when acknowledgements resume; the safety notice
  follows only after the existing 90 s watchdog window, with copy describing
  what the app actually did. Transport loss keeps its immediate
  reset-and-quarantine path unchanged.
- Falcon air guidance names `$152=100`, or firmware past 1.0.6, in the cycling
  advisory, the Machine Setup "Air restart" row, and a new Job Review advisory
  for air-on jobs on a controller flagged `airAssistRestartUnreliable`. Nothing
  new is written to a controller.

### Evidence and limits

The same preparation now measures 13.7 s in the same harness, with the preflight
scanners at roughly a third of their former cost and the emitter unchanged at
0.7 s. What remains is the scanners, the program timeline and the manifest
build; going materially below this needs a deeper change than a parser fix.

A simulator replay of the complete job through the real store — grblHAL-sized
planner, 1024-byte window — never stalled, kept the planner full, and spent at
most 33 ms of main-thread time per 250 ms of simulated streaming.

The one-minute mid-burn hold was **not** reproduced host-side. Every path that
could stop the sender was walked and excluded: a dead link would have tripped
the 2 s transport heartbeat, acknowledgement ownership cannot misroute while
streaming, and the replay above never starved. The surviving explanation is the
controller holding its own program, which the new telemetry will show or refute
on the next burn. No machine was operated for this decision, and the `$152`
value and firmware version on any given machine remain for the operator to
check on the controller itself.
