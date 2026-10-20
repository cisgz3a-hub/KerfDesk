## ADR-610 Amendment 2 - A board that printed no banner is asked only after sustained Idle, and an owed reply no longer hides a silent controller (2026-10-20)

**Status:** Accepted by the maintainer's request to fix the audit findings. **Date:** 2026-10-20.

Amends ADR-610 Amendment 1 and ADR-611 Amendment 1. Everything else in both
stands: nothing acts until the whole program is on the wire and only job lines
are owed replies, the missing replies are applied as acknowledgements, the
ordinary post-job settle confirms completion, and nothing resets the controller.

### Context

An audit of Amendment 1 found four problems.

- **A held tail could still be finished early.** Amendment 1 sends the `$G`
  probe only when the firmware identified itself this session: by its banner,
  or by a stock GRBL `$I` reply. grblHAL, FluidNC and both Falcon command sets
  have no `$I` the repository treats as identifying (`buildInfoQuery: null`;
  their `$I` grammar is not the stock shape the parser accepts). A board that
  does not reboot when the port opens prints no banner: native-USB grblHAL, a
  Falcon that does not reset on open, or any board reconnected after
  KerfDesk's own Disconnect reset it (that reboot's banner went to the closing
  port). Such a session stayed unidentified and fell back to finishing the job
  after 15 s of Idle, with no other check. ADR-345 records a Falcon A1 sitting
  Idle for about a minute with lines unacknowledged; Amendment 1 itself names
  that as the reason a timer cannot prove a lost reply. A simulator replay of a
  no-banner grblHAL and Falcon session holding the tail of its program
  reproduced it: the job was reported done after about 15 s while every reply
  was still held.
- **The documents overclaimed.** Amendment 1 and `WORKFLOW.md` said the
  probe covers GRBL, grblHAL and FluidNC "(the Falcon included)" and that a
  held program is "never finished early". `WORKFLOW.md` omitted the
  identification requirement and the 15 s fallback. Nothing in the repository
  tests the Falcon's own firmware, which is a vendor build; the claim rests on
  its GRBL-family command contract.
- **The sustained-Idle rule had no behavioural test** after Amendment 1
  replaced ADR-610's simulator cases; only the rule table was asserted.
- **"Not responding" could be suppressed for the whole session.** ADR-611
  Amendment 1 does not apply while a sent line is still owed its reply, so that
  a Console `$H` (GRBL answers neither `?` nor the `$H` while it homes) is not
  called silent. A Console reply lost to a UART line error (the premise of
  ADR-600 and ADR-610) never arrives, so the line stays owed for the session,
  and a controller that later truly went quiet kept a green "Connected".

### Decision

- **Unidentified GRBL-family firmware is asked only after sustained Idle.**
  When the profile is GRBL, grblHAL or FluidNC (the Falcon command sets
  included) with `$G` as its modal query, and the firmware did not identify
  itself, KerfDesk waits for the sustained-Idle window (15 s and three Idle
  reports, plus any G4 in flight, counted on the status-poll schedule) and
  then sends the same single `$G` probe. The job finishes only on the probe's
  ordered answer, exactly as for identified firmware.
  - On GRBL-family firmware, which every such profile is meant for, a held
    tail is answered only after its lines, so it is not finished early.
  - On firmware that is not ordered after all (a GRBL profile on another
    board), the job finishes no earlier than the sustained-Idle rule
    Amendment 1 already gave it.
  - `$G` is not a new command for these profiles: the connection handshake
    already sends it on every connect (`requestTerminalOwnedActiveWcsReadback`).
    No `$I` or other new query is sent to grblHAL, FluidNC or the Falcon.
- **Identified firmware is unchanged.** A banner naming GRBL, grblHAL or
  FluidNC, or a stock GRBL `$I` reply, still gives the probe after 1 s of Idle.
  Firmware identified as one whose `$G` ordering is not established
  (Smoothieware, or a banner naming non-GRBL firmware on a GRBL profile) keeps
  the sustained-Idle rule with no probe.
- **An owed reply excuses silence only as long as homing could last.** The
  connection bar reads Not responding after 8 s of silence as before. While a
  sent line is owed its reply, the window is instead the Home button's own
  wait for its reply (`homeLineTimeoutMs`): 120 s for a controller that
  reports while it homes; for one that does not (stock GRBL, grblHAL), the
  longest cycle its `$$` settings allow, with margin, or the existing
  30-minute backstop when those settings were not read, as on the Falcon,
  whose settings KerfDesk never reads. The window never shortens the
  ordinary 8 s. A tighter rule (excusing only an owed `$H`) was not taken:
  replies are matched to lines in order, so after one lost reply the ledger
  cannot say which line is still owed.

### Trade-off

The two failure directions are not equal. A job reported finished while the
controller still holds lines lets the operator open the lid, move the work or
start another job while the laser has burning left to do. A job that waits
longer than necessary only keeps the live bar up. So on an unidentified board
a lost final reply now ends the job after about 15 s instead of about 2 s, and
the live bar names the wait from 3 s. Two alternatives were rejected:

- **Identify the board with a read-only `$I` (or `$I+`) in the handshake.**
  The Super Console's firmware report sends those to grblHAL and FluidNC, but
  only on the operator's request, and the drivers deliberately do not treat
  their answers as identity. The Falcon command sets have no documented report
  at all. Sending a new automatic query to them has no evidence behind it.
- **Never finish on sustained Idle for these profiles.** That brings back the
  90 s watchdog, its soft reset and the Reconnect offer for every lost final
  reply on a board that printed no banner: the symptom ADR-610 removed.

### Evidence and limits

`laser-lost-ack-reconcile.simulator.test.ts` drives the real store against the
GRBL simulator running as grblHAL with no banner, under the grblHAL and the
Falcon A1 Pro profiles:

- a controller holding the tail of its program is still streaming after 30 s,
  sent exactly one `$G`, and completes through its real replies with no "lost"
  log (this failed before the change: the job was done after about 15 s);
- one dropped `ok` sends no probe during the first 14 s, then finishes on the
  probe's ordered answer;
- stock GRBL with no banner is identified by `$I` and still finishes in under
  5 s after one `$G`;
- Smoothieware with its last `ok` dropped finishes after the sustained Idle
  with no `$G` and no reset.

`laser-lost-ack-reconcile.test.ts` pins the rule table, and
`controller-recovery-status.test.ts` pins the bounded owed-reply window.

What is verified is code and simulator behaviour only. The GRBL simulator
models stock GRBL and grblHAL; the Falcon cases run its command contract on
that simulator, not its vendor firmware. That the Falcon's firmware answers
`$G` in order behind job lines, and that FluidNC does over USB serial, rests
on the GRBL-family sources cited in Amendment 1 and on these profiles'
command contracts, not on a hardware test. Smoothieware's `$G` ordering remains
unverified, so it keeps the timed rule, which a Smoothieware board holding its
program for longer than 15 s at Idle could still defeat. On the Falcon, a
controller that goes quiet while a reply is still owed reads Not responding
only after the 30-minute backstop. No machine was operated.
