## ADR-357 - Controller audit fixes: no wedged owners, no silent refusals, visible speed ceilings (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends the motion-owner settlement of ADR-230/232, the pause/resume confirmation of ADR-179/180,
the hosted-refill abort ordering of ADR-334, and WORKFLOW.md F-A7 (speed input out of range).
Leaves the frame-first Start contract (ADR-228) unchanged: nothing here adds a Start guard or turns
a warning into a block.

### Context

The maintainer reported that "the whole controller side of the laser and CNC is broken and not
working" and that "when I change feed speed, laser speed is stuck and doesn't want to increase".
A 15-dimension audit of the controller stack ran against origin/main 57a5a55a7, the build
kerfdesk.com served at the time. It covered transport, connect, status, streaming, realtime
commands, jog/home/origin, the job lifecycle, CNC, settings/console, the firmware drivers, UI
wiring, recent-PR regressions, recovery and the Electron serial path. Every finding had at least
one independent refuting verifier, and critical and high findings also had a reproducing
verifier. Result: 84 findings, 76 confirmed, 3 disputed, 5 refuted. No hardware was available, so
the evidence is code traces, simulator tests and upstream firmware sources.

Existing tests on that main were green (3,530 tests), except for one timing flake. The
"everything is broken" experience came from states the tests did not exercise. A refused line
could leave the app waiting forever, so every later command refused as busy. The rail then
swallowed each refusal, so every button looked dead.

### Decision

This change set fixes the confirmed findings listed below. The rest of the audit is tracked for a
follow-up change set; see Consequences.

1. **A refused or abandoned motion owner is released, never wedged.** A jog/Frame line the
   controller rejects (`error:15` soft limit), a failed write, or a Cancel that gave up used to
   leave the owner `cancelRequested` forever. Background polling also stopped, so the DRO froze
   and Jog, Frame, Home and Start refused on an Idle machine.
   - Polling now pauses only while a live Cancel attempt owns the marker → stamped-query boundary.
   - An abandoned owner is settled automatically on the next fresh Idle through the same causal
     proof Cancel uses. At most two attempts are made.
   - A release during a hold-jog's fresh-Idle check now cancels the pending jog through a
     per-store cancel generation, so no boundary-length `$J=` is sent after the operator let go.
   - A Home refused with `error:N` keeps the DRO: no homing cycle ran.
   - A stale Alarm reply to a `?` sent before `$H` no longer aborts Home. GRBL services realtime
     requests before executing the line.
   - Marlin sends `M114` for freshness instead of refusing.
2. **A line the wire cannot carry owes no acknowledgement.** safe-write now validates that the
   line is encodable before it reserves an ack, and refuses with a clear reason. Before, a
   console line containing a character above U+00FF stranded a reserved `ok`, and every later
   command refused.
3. **The serial transport survives line errors and tears down cleanly.**
   - Web Serial's non-fatal read errors (Break, Framing, Parity, BufferOverrun) re-acquire the
     reader, as the spec allows, instead of being treated as a cable pull.
   - The worker transport releases its locks and closes the port after an unplug.
   - The worker transport drains its queued M5/M9 cleanup on Disconnect, as the main-thread
     transport does.
4. **CNC tool-change holds** are entered through one shared patch from every site, including the
   Resume refill. Before, a Resume refill that reached `M0` left the previous bit's Z0 armed, so
   Continue cut with the wrong tool length. Operator `$J=` jogs are allowed inside a drained hold.
5. **Pause, Resume, Fire and Abort follow the firmware.**
   - grblHAL's `Door:4` counts as resume progress, alongside GRBL/FluidNC `Door:3`.
   - A laser Resume refused while the door or lid is still open keeps the job instead of
     fail-dark resetting.
   - Pause proves that the laser or spindle is off. Coolant (air) no longer counts, because
     grblHAL's keep-coolant door option leaves it running.
   - Momentary Fire sends `G1 F<n> M3 S<n>`. In GRBL laser mode, only a G1/G2/G3 block may
     energize the laser.
   - Abort posts the soft reset before taking back the hosted refill.
6. **Firmware drivers.**
   - Smoothieware homes with `$H`. `G28.2` only parks when `grbl_mode` is off.
   - Smoothieware shell replies are completed by their real terminal line, and `M115` is no longer
     taken for a reboot. Jog feed no longer changes the G0 seek rate.
   - 4+-axis `$#` work offsets are parsed.
   - Probing accepts the `Ov:`/`A:` proof that the spindle is off on builds that report `F:`
     instead of `FS:`.
7. **No silent refusals in the rail.** One reporter, `reportControllerActionFailure`, turns a
   refused Jog, Z jog, Home, Unlock, Wake, Reset, override, Manual Air, Abort, Disconnect or
   Reconnect into a toast that names the reason. Deliberate cancellations stay quiet.
8. **Speed ceilings are visible and reachable** (F-A7).
   - A Speed above the machine's Output max feed shows an inline note that names the ceiling and
     offers one click to raise it to the requested speed. A stored speed above the ceiling shows
     the note too.
   - The Job Review Speed cell warns when it caps a value.
   - The Falcon A1 Pro catalog ceiling follows Creality's rated 600 mm/s (36000 mm/min). The
     vendor command set cannot read `$110/$111`, and the firmware still limits each move to them.
9. **Job Review speed edits reach artwork that owns its speed** (ADR-317). The row shows the
   value the artworks run when they all agree. An edit also patches each artwork override that
   already owns the field, so the number the operator types is the number that compiles.

### Consequences

- Operators get a reason for every refusal and cannot be left with a controller that looks
  connected but refuses everything.
- Motion owners now have an automatic settlement path. It uses the existing Cancel proof, so no
  new ambiguity enters the ack ledger.
- Saved projects keep their stored Output max feed. The Speed-field note is how an operator raises
  it; nothing is migrated silently.
- Not yet addressed; each has its audit id and a verified reproduction, and they are tracked for
  the follow-up change set:
  - connect and qualification hangs: connect-2/3/5, settings-console-3/4, cnc-controller-3,
    connect-6;
  - console wedges and classification: settings-console-2/7/8/9/10, regressions-1,
    cnc-controller-1, transport-2;
  - stream accounting of `error:N`/ALARM: streaming-3/4/5, recovery-5/6/7, cnc-controller-2;
  - controller-aware resume: recovery-3/4, after #860;
  - the remaining UI items: ui-panel-3/4/5/6/8, realtime-2, jog-home-origin-3,
    cnc-controller-6;
  - grblHAL `$SLP` (drivers-4) and the Electron items (electron-native-1..4).
