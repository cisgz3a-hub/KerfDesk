## ADR-398 Amendment 4 - A banner that greets every connection does not prove a restart (2026-10-22)

**Status:** Accepted. Amends ADR-398 Amendment 3 Decision 2 (which sign settles a lost link) and
corrects its Consequences, and words the link-loss notices by transport. | **Date:** 2026-10-22

### Context

Controller audit v3, area D7 (network link), finding D7-P2-1, confirmed by a refuter and the
coordinator on `origin/main`, and the related D7-R1, rated plausible
(`docs/audits/2026-10-22-controller-v3/D7-ctl-network-link.md` on the audit branch).

Amendment 3 read a startup banner before the first status report as proof that the controller
restarted, on every transport. Its Consequences said: "A board that neither resets when its port
opens nor loses power shows no banner on reconnect". That is false for grblHAL:

- grblHAL greets every new network client. In core `stream.c` (`master` @ `4ec1ae44`,
  2026-10-15), `stream_select` sets `send_init_message = add && sys.driver_started` for a
  Telnet, WebSocket or Bluetooth stream, then calls `grbl.report.init_message(stream->write)`.
  That is the same `GrblHAL 1.1f ['$' or '$HELP' for help]` line `report.c`
  `report_init_message` prints at boot. Plugin_networking `telnetd.c` (`master` @ `0b665ee0`)
  connects that stream for each accepted client.
- A disconnect only flushes the Telnet rings (`streamClose`); it neither holds nor resets the
  controller. A board that lost its Wi-Fi link mid-job keeps running its planner.
- On native USB, `stream_usb_linestate_changed` queues the same welcome 200 ms after DTR rises
  (`task_add_delayed(output_welcome_message, NULL, 200)`), without a reset. The RP2040, STM32F4xx
  (and F1/F3/F7), ESP32 and LPC176x drivers call it from their CDC line-state handlers. Chromium
  asserts DTR when it opens a port. KerfDesk's handshake listens passively for 250 ms, so the
  welcome arrives before its first status query.
- grblHAL reports nothing that tells a greeting from a boot. Neither `$I` nor the status report
  carries an uptime or a reset cause. A cold boot clears `sys.position` (`grbllib.c`), but
  `hal.get_position` lets a driver restore it, and the last position before the drop is not kept
  across an app restart. So machine position is not proof either.
- A board on Wi-Fi or Ethernet that did restart printed its boot banner before its network came
  up, so the reconnecting client never sees it. FluidNC sends its banner only after a reset
  (`Protocol.cpp`), and greets no Telnet client. Over the network, a banner settles nothing either
  way.

The refuter ran main's real tracking, settle and restart code over loopback TCP against a
modelled grblHAL that never reset. The reconnect read `boot-banner`. With 400 of 600 lines
acknowledged and a last status backlog of 31 blocks, Automatic restarted 36 lines early, over
moves that had burned. With no status snapshot the bound is grblHAL's 100-block default. The
Review also said the board "had restarted, as an Arduino-based board does" after a "USB
connection" loss, on Wi-Fi. The step back is reviewed and the operator confirms Start, so the
finding is P2. Only a loss that surfaces as a socket close reaches it: more than 2 s of silence
ends as `stream-stalled`, which awaits no verdict.

### Decision

1. **A banner proves a restart only where it cannot be a greeting.** That is a USB session whose
   controller is not grblHAL: stock GRBL, FluidNC, Marlin or Smoothieware, as before. A banner
   does not settle the verdict on a network session (`serialPortInfo.transport === 'tcp'`), or
   on a grblHAL session on any link, whether the banner names grblHAL or the profile runs grblHAL
   (a build reporting itself as "Grbl 1.1f"). There the first status report or Alarm decides:
   - An `ALARM:` line or an Alarm status means motion was stopped, as in Amendment 3.
   - `Run` or `Hold` means the controller kept running. A controller that had restarted has no
     job to run or hold. `Door` and `Jog` can follow a restart, so they do not count.
   - Anything else is **unknown**.

   A network session without a banner reads the same way, because a network board cannot show
   a restart at all. A USB session without a banner and without an Alarm still means the board
   did not reset when its port opened, and it kept running.
2. **An unknown verdict does not step back.** The held-back backlog becomes
   `unconfirmedPlannerBacklog`, and the automatic restart stays at the first unacknowledged line,
   where a board that kept running needs it. The restart hint adds the line a step back over that
   backlog would use: "The reconnect did not show whether the controller restarted. If it did, …
   restart from line N to replay them." The operator chooses that line by typing it, as with any
   other line. The record is revised once, as in Amendment 3, and stays a `disconnect` with its
   `sentLines`. Continue from where the head stopped is unchanged.
3. **The Review and the notices name the link.** The verdict carries the reconnect's link:
   `usb`, or `network` for a TCP session. A restart or Alarm detail says "The USB connection was
   lost" or "The network connection was lost". The USB restart text names the general cause (a
   board that resets when its port opens, or loses USB power), not "Arduino-based". The unknown
   detail says why the reconnect could not tell, in the link's own terms. The port-close notices
   (job, motion, Fire) say "Network connection was lost" and point to the network connection
   form on a TCP session (audit D7-P3-3). The stall notice says "check the network link", and the
   reboot notice drops "USB cable". A silent TCP controller is pointed at its target and network
   service, not a baud rate or a cable (audit D7-P3-2). The USB texts are unchanged.

### Consequences

- A grblHAL board that kept running through a Wi-Fi drop, or a native-USB grblHAL board
  reopened by auto-connect, is no longer recut over a planner that burned. The Review no longer
  states a false cause.
- A grblHAL board, or any network board, that really did restart and comes back Idle without an
  Alarm reads as unknown, not as restarted. Its automatic restart skips the backlog, and the hint
  names the line that replays it. ADR-398 Decision 2 prefers a step back under uncertainty. Here
  the uncertainty is the whole question, so the operator decides with the exact line in hand. A
  board that requires homing at boot starts in Alarm and still steps back automatically.
- Stock GRBL on USB is unchanged: the Arduino-class reset at port open still reads as a restart
  and steps back.
- The `LinkLossRestartEvidence` passed to `settleLinkLossRestart` is now `{ sign, link }`. The new
  record field is optional, so older records read without it. An older app reading a record that
  has it ignores the field and keeps the automatic line.
- Regression tests:
  - `src/core/recovery/link-loss-restart.test.ts`: the unknown verdict keeps line 41 and names
    line 26, the Review texts by link, and the stored field.
  - `src/ui/app/link-loss-restart-tracking.test.ts`: a grblHAL Telnet greeting waits for the
    status (Idle reads unknown, Run kept running). A network reconnect without a banner, the
    grblHAL USB greeting (D7-R1) and a "Grbl 1.1f" grblHAL build are covered too, and stock GRBL
    and FluidNC banners on USB still read as a restart.
  - `src/ui/laser/recovery-link-loss-restart.simulator.test.tsx`: the GRBL simulator drops the
    link with its planner full. It reconnects over a Telnet-style session and greets with
    grblHAL's banner. The record does not step back, and the hint names a line at or before the
    first discarded move. The stock-GRBL USB banner case still steps back.
  - `src/ui/state/laser-store-helpers.test.ts` and `src/ui/state/laser-connection-diagnostics.test.ts`:
    the network wording of the port-close notices and the silent-controller failure.

### Not covered

- No grblHAL or FluidNC board was operated. The 200 ms native-USB welcome against the 250 ms
  passive wait is source and code reading only.
- A grblHAL driver without CDC line-state events (none was found in iMXRT1062, Teensy 4) that
  restarted and answers Idle without a banner still reads as having kept running, as Amendment 3
  says of a board that powers up without a DTR reset.
- Whether a grblHAL plugin hooks `on_stream_changed` to hold or reset on a Telnet disconnect was
  not checked. The core and telnetd do neither. Such a build would come back Idle or in Alarm,
  which this rule reads as unknown or as stopped.
- A grblHAL board that refuses a second Telnet client still looks like "connected", then "closed
  unexpectedly" (audit D7-P3-4). That is a separate change.
