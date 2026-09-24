## ADR-362 - Controller audit follow-up: owned console exchanges, alarms that end only what they stopped, recovery that restarts where the machine stopped (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Continues ADR-361 with the confirmed controller-audit findings it left open. Amends ADR-233
decision 4 (`$30` no longer lowers automatic spindle speeds; ADR-322 item 6 governs), ADR-117 (the
desktop window keeps its page visible while minimized) and the laser recovery defaults of ADR-341.
Leaves the frame-first Start contract (ADR-228) unchanged: nothing here adds a Start guard or turns
a warning into a block. The two refusals below are output facts: a resumed program the builder
cannot make correct, and a `$SLP` the firmware is known to reject.

### Context

ADR-361 fixed the audit's wedged motion owners, silent rail refusals and speed ceilings, and
listed the remaining findings by id. Each was confirmed by at least one independent verifier
against the code and the upstream firmware sources. No hardware was available, so the evidence
is code traces, simulator tests and upstream sources, as before.

### Decision

1. **The Console finishes its exchanges** (settings-console-2/7/8/9/10, regressions-1,
   cnc-controller-1, transport-2). `$X`, `$$` and `$N=` settings writes from the Console are owned
   exchanges that finish on their `ok` or `error`, like the rail buttons, so a refused `$X` no
   longer clears the alarm. A Console `$13=` re-reads `$$` itself. An empty `$$` is logged, and
   every `$RST=` form is blocked. FluidNC read-only reports (`$CD`, `$S`, `$L`, ...) are allowed. A
   pasted non-breaking space or a character above ASCII is refused before it reaches the wire,
   where GRBL would execute a byte of 0x80 or above as a realtime command.
2. **Keyboard and hold-jog** (realtime-2, jog-home-origin-3, cnc-controller-6). Ctrl+. aborts a
   running Home, Probe or Auto-focus and turns a latched Fire off. PageUp/PageDown scroll a
   focused list or the Artwork panel instead of jogging Z. Press-and-hold jog uses the
   controller's native travel, not the profile bed.
3. **Connect and qualification** (connect-2/3/5/6, settings-console-3/4). Qualification waits
   for an operator who is unlocking or waking the controller instead of failing. The rail's
   Connect passes the profile's worker-streaming option. A Marlin board that prints no startup
   banner qualifies on its first `M114` poll, and only a board that answers no poll within 8 s is
   reported as silent.
4. **Rail feedback** (ui-panel-3/4/5/6/8). Manual Air is disabled with the store's reason. Zero Z
   reports success and refusal. Overrides stay reachable through a finishing tail. The Alarm
   banner names the commands the active driver sends (Smoothieware `M999`, the Falcon's `$HX` then
   `$HY`).
5. **Stream accounting** (streaming-3/4/5, recovery-5, cnc-controller-2).
   - `ALARM:N` acknowledges no line.
   - A reboot banner keeps the `ALARM:3` that the reset itself raised. GRBL prints it before the
     banner, and the simulator now does too. Any report that is not Alarm or Sleep clears a stale
     alarm code.
   - A touch-off probe that misses (ALARM:4/5) during a drained CNC tool-change hold keeps the
     job. `$X` is allowed in exactly that hold, and Continue still needs a fresh Idle and new
     work-Z evidence.
   - The program restates `G21 G90 G54 G94 G17` after every tool-change M0.
   - A CNC recovery default never rewinds across an acknowledged tool change.
6. **Automatic spindle suggestions** (cnc-controller-3). `$30` is the S value for full output.
   With `$32=0` it was published as a live RPM cap, so a stock router reporting `$30=1000` got
   1000 RPM operations with chip-load feeds about 12x too slow. Only the feed ceilings
   (`$110/$111/$112`) are live caps now.
7. **Firmware drivers** (drivers-4, drivers-6). On grblHAL with `$62=0` reported, Release motors
   is disabled with that reason. A refused `$SLP` keeps the origin. The latent Ruida UDP session
   unswizzles its reply byte, retries on NAK `0xCF` and ignores ENQ.
8. **Laser recovery** (recovery-3, recovery-4, recovery-6).
   - A new resume is refused for Smoothieware and Marlin programs: the GRBL-dialect builder
     zeroed their power commands, so the rest of the job ran dark. Archived resume steps still
     replay byte-for-byte.
   - A manual restart uses the placement of the newest run the project reproduces exactly, so a
     Current Position job is not re-anchored where the head stopped. With none, the confirmation
     says so.
   - After a stop that discards the planner, the automatic restart steps back over the moves the
     last status report showed waiting in the planner.
9. **Desktop** (electron-native-1..4, transport-5).
   - With no port, Connect explains the usual causes and offers Retry for a port plugged in
     meanwhile.
   - The picker shows USB IDs in hex.
   - The window keeps `backgroundThrottling` off, so a minimized job keeps its ADR-117 wake lock.
     No main-process powerSaveBlocker is added.
   - Closing the window turns a latched Fire off first; a Fire it cannot confirm off leaves an
     acknowledgeable warning with Retry.

### Consequences

- A refused Console command no longer changes controller state as if it had run, and the
  automatic recovery default no longer skips lines the controller never ran.
- Recovery trades a skipped burn for a possible re-burn of a few moves after a planner-discarding
  stop; the picker says which, and the operator's chosen line still wins.
- Resume on Smoothieware and Marlin is unavailable until a dialect-aware builder is written and
  proven against firmware models for those dialects.
- Still open from the audit's gap sweep, pending verification: the Marlin laser Start's final
  status query, a hung preparation worker with no Cancel, an unanswered advisory `$G` readback
  that strands an owed ack, variables advancing after a failed post-job settle, autofocus's fixed
  timeout, the Frame-expiry reason and main-thread preparation errors, and the no-homing guide's
  unbounded wait after Unlock. The unused runCheckpointResumeFlow remains for its tests.
