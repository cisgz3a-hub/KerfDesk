## ADR-674 Amendment 1 - The rail offers the step-jog queue, and a Console line is followed by one status query (2026-11-11)

**Status:** Accepted; software-verified through the real store, the real machine rail and the
repo's fake GRBL connection. Not hardware-tested. | **Date:** 2026-11-11

Follows fix group F7 of the user annoyance audit A1
(`docs/audits/2026-11-11-annoyance-a1/`, findings A3-P2-2, A3-P2-4, A3-P3-1, A3-P3-4 and
A3-P3-5). That audit was a static read, so each finding was reproduced with a failing test before
it was changed. No hardware was operated.

Nothing here changes the Frame-first Start contract (PROJECT.md non-negotiable 21, ADR-565), Job
Review, Abort's immediate reset or the Fire and jog refusal of ADR-664. No G-code that KerfDesk
emits changes. No refused command becomes allowed.

### Context

- **The queue of Decision 2 could not be reached from the jog pad (A3-P2-2).** The machine rail
  passed the pad `stepJogsOnly` only when `canQueueStepJog` was true and no jog or Frame block
  applied (`jogFrameCommandBlockMessage` returned nothing). `canQueueStepJog` needs a running jog
  operation. `jogFrameCommandBlockMessage` reports a block whenever any motion operation runs. The
  two could never hold together, so the arrows greyed out for the whole of every step and a second
  quick tap, or an XY jog key, was lost. The store's own `jog(..., { queueStep: true })` worked, and
  the pad's test passed the prop directly, so neither test saw the rail. The line had read this way
  since the commit that added it.
- **A Console line blocked the next one for up to a second (A3-P2-4).** After a Console command
  that can change the machine, the store forgets the last status report (`consoleObservationPatch`):
  a write is no proof that the motion or mode change it asked for has finished. On an idle machine
  the background poll asks once a second (`STATUS_POLL_MS` 250 ms, every fourth tick), so Send and
  the jog pad stayed off until then. Send's tooltip said "Controller status is not known yet. Wait
  for an Idle status report before jogging or framing.", which is the jog pad's sentence.
- **Enter did nothing on a blocked command (A3-P2-4).** The form dropped the submit, and a browser
  does not submit a form at all through a disabled default button. The reason was only a hover
  tooltip.
- **Controls were off with no reason (A3-P3-4).** A disabled Home, jog arrow, Set origin here,
  Disconnect or Review recovery kept the tooltip that says what the button does.
- **Internal wording reached the operator (A3-P3-1, A3-P3-5).** Five messages, listed below.

### Decision

1. **The rail offers the queue exactly when the store would take a step.** `LaserWindow` now sets
   `stepJogsOnly` from `canQueueStepJog` alone. That rule already refuses everything the removed
   condition was there for: a running job, a tool-change hold, Fire or the laser dot, a controller
   operation, auto-focus, an MPG pendant, a lost connection and a controller that reports neither
   Idle nor Jog. A user-interface gate that mirrors a store rule calls the store's predicate; it
   does not rebuild it. The XY jog keys follow the same prop, so they are fixed with the arrows.

2. **Z focus steps stay out of the queue.** This was asked and decided, not left over. The reasons:
   - The queue's checks are XY only. `stepJogQueue.plannedEnd` holds X and Y, and the warn-only
     bounds and no-go checks of a queued step start from it. A queued Z step would have no planned
     start to check from.
   - On a CNC, Z- lowers the bit toward the stock. Each Z step should be one deliberate press
     that starts from a proved Idle at a place the operator can see. A Z step queued behind XY
     steps would run later, somewhere the head has not reached yet.
   - Z focus has its own step and feed, and in a tool-change hold it is the touch-off move. The
     queue is refused in that hold anyway.
   - No finding asks for it. A3-P2-2 is about the arrows.

   So while a step jog runs, the Z buttons, press-and-hold, the step and speed rows and every
   other control still wait, as Decision 2 says.

3. **The phone remote is unchanged.** Its jog is an owned jog, which starts no queue (Decision 2),
   and it waits for each move to settle before it reports. It never had the contradictory
   condition. It shows the store's block message, so it picks up the new wording below.

4. **One status query follows a Console command's reply.** After a Console command that is not
   read-only, `requestStatusAfterConsoleReply` (`console-status-follow-up.ts`) waits until every
   line KerfDesk wrote has been answered and nothing is still on its way out, then sends the
   driver's realtime status query once. It runs last, after the `$$` read-back that follows a
   setting write, so it never lands inside that owned exchange. The rule is not weakened:
   - The store still forgets the old report, and the next jog, Frame or Console line still needs a
     report made after the command.
   - The query waits for the reply. GRBL-family firmware acts on a status byte the moment it
     arrives, ahead of the line queue (gnea/grbl `serial.c`, the receive interrupt), so a query
     sent with the command could report the Idle from before the command began. GRBL answers `ok`
     only after it has run the line (ADR-375 Amendment 12, "Firmware order").
   - It sends nothing if a report has already arrived, if the session changed, or after one second,
     which is the idle poll's own period.
   - It stays out of a job, a jog or Frame, auto-focus, a probe and any controller operation.
     Those are polled four times a second already, and some own the status boundary outright
     (`controllerOperationOwnsPolling`).
   - A controller with only a queued status query (Marlin's `M114`) gets nothing new and keeps
     its ordinary poll. `M114` is a line that owes its own `ok`, and it reports the planned
     position, not whether motion has finished. Asking it sooner would end the wait sooner
     without making the answer more true, which would weaken the rule in practice. An unlock
     (`$X`) is followed like any other command: the next report shows whether the alarm cleared.

5. **A blocked Console command says why when it is tried.** Enter, or a submit, on a blocked
   command shows the block reason under the field. The reason follows the live state: it goes
   when the block clears or the draft changes. Before any status report the Console now says
   "Waiting for the controller to report its status. This command can be sent once it reports
   Idle." (or the states a `$` command is accepted in). The store's own Console gate uses the same
   sentence. The jog pad keeps its own.

6. **A control that is off says why.** While disabled, Home, Auto-focus, the jog arrows, Set
   origin here, Disconnect and Review recovery show the message the store would throw
   (`control-block-reason.ts`), instead of their ordinary tooltip. Enabled, they read as before.

7. **Plain words, with one next step.**

   | Where | Before | Now |
   |---|---|---|
   | Console, `$RST=`, `$N…=`, `$I=`, `$DWNGRD` | "This persistent controller command is blocked in the Console. Back up settings and use Machine Settings in a later lane." | "KerfDesk does not send this command. It erases or rewrites settings stored on the controller (a factory restore, a startup line or the build info), so the Console refuses it. To run it you need another sender." |
   | A jog or Frame is running | "A jog or frame operation is active. Wait for GRBL to report Idle, or cancel the operation, before sending another motion command." | "A jog or Frame is still running. Wait for it to finish, or stop it with ABORT MOTION, then try again." |
   | Jog, Frame, origin, Console: no status answer | "Manual motion could not obtain a fresh same-session controller status after its status query. Check the connection and try again." | "The controller did not answer a status check in time, so nothing was sent. Check the connection and try again." |
   | Home, wrong state | "Machine must be known Idle or Alarm before homing (currently …)." | "Home works only when the machine reports Idle or Alarm (it reports …). Wait for it to stop, then press Home again." (for a hold, a door or sleep: "Press Home once it is Idle.") With no report yet: "Home needs to know what the machine is doing, and it has not reported yet. Wait a moment, then press Home again." |
   | Home, no Idle afterwards | "Home finished without fresh session-bound Idle settlement evidence." | "Home ended, but the machine did not report Idle afterwards, so it does not count as homed. Press Home again." |
   | Home, interrupted | "Home evidence was invalidated before confirmation." | "Homing was interrupted before KerfDesk could confirm it, so it does not count as homed. Press Home again." |
   | Controller recovery | "Controller recovery was superseded by another session or operation." | "Recovery stopped because the connection or another machine action took over. Check the machine, then try again." |
   | Interrupted job card | "It is isolated from the current canvas, project, profile, controller settings, origins, and ordinary Start." and "Permanently discard only this isolated recovery capsule." | "It is kept apart from your work: the open design, the machine profile and the origin do not change it, and Start does not use it." and "Delete this saved job record for good. Nothing else changes." |

   The `$RST=`, `$N…=`, `$I=` and `$DWNGRD` commands stay refused. Only the sentence changed.
   The old sentence pointed to Machine Settings "in a later lane"; Machine Settings reads and
   exports settings and writes none of these.

### Consequences

- Quick taps on a jog arrow, or presses of an XY jog key, move the head as many steps as were
  tapped, up to three at a time, as ADR-674 intended. A fourth tap finds the arrows off until a
  step finishes.
- After a Console line, Send and the jog pad come back as soon as the controller has answered and
  reported, not on the next one-second poll.
- A greyed-out control on the machine rail names its reason on hover.

### Verification

- `LaserWindow.step-jog-queue.test.tsx` drives the real rail and the real store through a fake
  GRBL connection. On the code before this amendment four of its tests failed: the second tap was
  dropped, the XY key was dropped, press-and-hold was still offered, and three steps could not be
  queued. Its guard tests hold on both: a jog that takes no queue and a tool-change hold keep the
  arrows off.
- `console-status-follow-up.test.ts` fakes the clock and starts each test just after an idle poll.
  Before the fix no status query followed the reply within the test's window; now one does, and
  only one. None is sent before the reply, when a report arrived first, during a jog, after the
  window, or after a read-only command.
- `ConsoleCommandDeck.blocked-submit.test.tsx`: Enter on a blocked command shows the reason and
  sends nothing; the reason goes when the block or the draft changes.
- `control-block-reason.test.tsx` and the rail tests cover the tooltips.
- `e2e/jog-quick-taps.e2e.ts` runs both journeys in Chrome against the in-page GRBL simulator
  (`e2e/fixtures/journey-grbl-serial.js`), with real pointer and key events. Three taps 150 ms
  apart put three `$J=` lines on the wire. Against the rail before this amendment the same spec
  failed: the arrow was greyed out 150 ms after the first tap. Enter on a Console line typed
  during a jog shows the reason, and the same key sends the line once the jog has finished.
- The existing Marlin simulator test (`laser-marlin-fresh-status.simulator.test.ts`) still sees
  no `M114` after a Console command, which pins the limit in Decision 4.

### Needs a hardware check

- Tap a jog arrow three times quickly on GRBL, grblHAL and FluidNC: the head should move three
  steps. Tap three times and press ABORT MOTION during the first step: no queued step should run.
  (This is ADR-674's own owed check; it could not be done from the jog pad before this fix.)
- Send `G91` then `G0 X1` in the Console as fast as you can type: Send should not stay grey for
  a second between them, and the head should move once.
