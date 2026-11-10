## ADR-696 - A dropped motion reply is proven by an ordered `$G` and released in place (2026-11-10)

**Status:** Accepted. Amends ADR-640 decision 2 (a missing reply no longer needs a reconnect on a
GRBL-family controller) and extends ADR-375 finding 6 (M-6). Reuses the proof of ADR-610
Amendment 1. | **Date:** 2026-11-10

### Context

ADR-640 made Cancel wait for the jog's reply before the jog-cancel byte `0x85`, because grblHAL
answers that byte, in any state, by discarding every line it has received but not read
(`hal.stream.cancel_read_buffer()` in
[protocol.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L896-L899)),
and never answers those lines. The wait is bounded at 500 ms so that stopping comes first. A line
still unread after that grace is discarded. Its reply never comes, Cancel reports the missing reply
after 8 s, and the cancelled owner stays: the FIFO reply ledger
(`laser-untracked-ack-ledger.ts`) cannot tell a dropped reply from a late one.

ADR-640 left Disconnect and Connect available on an Idle machine for this case. Disconnect is a soft
reset on GRBL-family controllers, so it clears a work origin set with G92 and leaves a machine with
homing enabled locked in Alarm. ADR-640 named the in-place alternative and left it for a separate
decision because it touches the ledger that job streaming also uses.

### Primary sources

Checked at the commits ADR-375 pins (gnea/grbl `bfb67f0c`, grblHAL/core `d7aaee3d`, FluidNC
`fdc17a2c`):

- **Stock GRBL** reads one line at a time in `protocol_main_loop` and reports its status
  (`report_status_message(system_execute_line(line))`) before it reads the next character. `$G`
  (`system.c`) calls `report_gcode_modes()`, which prints `[GC:...]`, then returns `STATUS_OK`, so
  `ok` follows. Only `$$` and the settings, homing and EEPROM commands have a state gate. `0x85` in
  `serial.c` only sets motion cancel while jogging and flushes nothing.
- **grblHAL** has the same main loop: the line's status is printed before the next read. `$G` is
  `{ "G", output_parser_state, { .noargs, .allow_blocking, .allow_redirect } }` with no state check,
  printing `[GC:...]` then `ok`. The `0x85` flush discards what is buffered at that moment. A complete
  line that arrives after it is read and answered normally.
- **FluidNC** keeps one line in flight per channel (`CMD_QUEUE_DEPTH` "keeps the strict
  one-line-in-flight flow control"; `Channel::pollLine` completes no new line while one awaits its
  ack). `$G` is `ReportCommand("G", ..., anyState)`, and `[GC:` and the `ok` from `Channel::ack`
  leave through the same output queue.

So a `[GC:` answering a `$G` written after the cancel can only arrive once every earlier line has
been read and answered. A reply still owed by an older write at that moment will never come.

`[GC:` also has unsolicited sources. grblHAL prints it for its `CMD_GCODE_REPORT` realtime byte and
in MPG mode, and FluidNC prints it on a modal change when auto-report is on for the channel.
KerfDesk never sends that byte, never turns on auto-report, and does not probe while the pendant
owns the machine. An operator who turned on FluidNC auto-report from the Console could produce one.
That case is covered below.

### Decision

1. **One `$G` for a stranded owner.** A cancelled jog or Frame owner that no Cancel is settling,
   with its writes on the wire and a reply still owed, gets one `$G` once the controller has
   reported Idle long enough. The proof rule is the job probe's (`lostReplyProofRule`): 1 s of Idle
   on firmware that identified itself as GRBL, grblHAL or FluidNC this session, the 15 s
   sustained-Idle window on a GRBL-family profile whose firmware did not identify itself, and no
   probe where `$G` is not known to be ordered (Smoothieware, Marlin, the Falcon command set without
   `$G`). Windows count only on-schedule poll time (ADR-356 Amendment 1). A busy report restarts the
   window.
2. **Only when nothing else is in play.** No active job, and no job that claims the next reply. No
   pending transport write, controller operation, pause/resume transition, pendant, command,
   Idle wait, status wait or job probe. A reply counter with no ledger reservation behind it names
   no line, so it gets no probe. The job stream's ledger is never touched. `$G` is a setup-only line,
   and that gate refuses only during an active job, so it passes here unchanged.
3. **The `[GC:` drops what was discarded.** When the probe's `[GC:` arrives, every reservation
   written before the oldest owed `$G` is dropped, and the reply counter drops by what they owed
   (`dropUntrackedAcksAheadOf`). The `ok` that follows settles the probe's own reservation through
   ordinary settlement. The existing automatic release (`releaseAbandonedMotionAtIdle` →
   `settleAbandonedMotionOperation`) then crosses its settle marker, confirms a fresh Idle and
   releases the owner. A reply that was only late arrives before the `[GC:`, settles the jog
   normally, and nothing is dropped.
4. **Bounded.** One probe per owner. If its `ok` is lost after `[GC:`, the probe's reservation is
   released 2 s after the proof. If `$G` is not answered within 10 s of being written, the attempt
   ends with a log line, and the owner stays with Disconnect and Connect available, as ADR-640
   provides. Cancel's message now says that KerfDesk confirms and releases on its own, and that
   Disconnect is the fallback.

### Alternatives

- **Treat any Idle with an owed reply as proof after a timeout.** ADR-345 records a Falcon A1 Idle
  for about a minute with lines still unanswered. A timer cannot tell held lines from dropped ones,
  and ADR-610 Amendment 1 withdrew timed proofs for the same reason.
- **Send a bare newline instead of `$G`.** An empty line also answers `ok`, but that `ok` cannot be
  told apart from the late reply it is meant to rule out, and a newline can complete a truncated
  line that is still in the controller's buffer.
- **Reconcile the reply counter to the ledger on the proof.** That would also clear owed replies
  that have no reservation, which no line proves. Only reservations the proof covers are dropped.

### Consequences

- After a grblHAL flush strands a jog, the jog pad and Frame unlock about 1 s after Cancel's
  failure on an identified controller, on the same session: no soft reset, the G92 origin and homed
  state kept. The failure message stays, since the stop really was unconfirmed for 8 s.
- On unordered firmware the worst case is a late jog reply that arrives after the `[GC:`. It then
  settles the probe's reservation, and the probe's own `ok` is unowned and ignored. The release that
  follows still needs a fresh Idle after its stamped status query, and re-sends `0x85` on a `Jog`
  report, so a late-parsed jog is still stopped before the owner is released. An unsolicited `[GC:`
  has the same bound.
- No new refusal and no new write during a job. Not seen on hardware: the evidence is primary
  source and the simulator.

### Verification

- `src/ui/state/laser-motion-reply-probe.test.ts`: a board that greets as GRBL but flushes unread
  input on `0x85` (`jogCancelFlushesInput`), with its main loop busy past the 500 ms grace
  (`lineParseDelayMs: 600`). The jog line is discarded, Cancel fails, exactly one `$G` follows the
  byte, and the owner is released with no `0x18`. Jog, Frame and setup are usable again on the same
  connection. Ledger unit tests pin which reservations are dropped.
- `src/ui/laser/JogPad.hold-release-flush.test.tsx`: the same failure through the real JogPad on
  the Falcon-compatible profile frees the pad without a reconnect.
- `src/__fixtures__/controllers/grbl-sim-jog-cancel-flush.test.ts`: the simulator's flush model
  answers a `$G` written after the flush with `[GC:...]` then `ok`, as grblHAL's main loop does.
- Both store tests fail with the probe disabled.
