## ADR-633 - Auto-connect stays quiet and respects Disconnect; the lost-link banner needs motion (2026-10-19)

**Status:** Accepted. | **Date:** 2026-10-19

This amends ADR-420 (auto-connect) and ADR-212's fail-dark disconnect with its P0-B Safety Notice
banner. Frame, Start, output, the saved "Connect automatically" preference and the
interrupted-job checkpoint do not change. No guard is added (ADR-228).

### Context

A read-only controller behaviour audit on 2026-10-19 found three operator-facing problems in
the connection path:

1. **F-1: a background auto-connect that failed looked like a failed click.** When the remembered
   port was held by LightBurn or LaserGRBL, or unplugged mid-open, the automatic connect set the
   connection to failed and published an incident, so the rail showed the red "Couldn't connect"
   alert although nobody had clicked Connect.
2. **F-2: Disconnect did not stop auto-connect.** Auto-connect checked only the live state, so
   after the operator clicked Disconnect the next Web Serial `connect` event (a power-cycled
   machine, a reseated cable) reconnected by itself and took the port from another program.
3. **F-3: "Connection lost mid-job" without motion.** The port-close patch raised the
   disconnect-during-job notice for every controller operation except the handshake. Powering the
   machine off during a settings read, a build-info read or a recovery wait showed the red E-stop
   banner titled "Connection lost mid-job".

### Decision

1. **A failed automatic open is quiet.** With `portSelection: 'automatic'` a failed open leaves the
   connection `disconnected`, writes one log line (`[lf2] Automatic connect skipped: <reason>`)
   and publishes no incident. The rail stays "Not connected" and shows a muted one-line hint (not
   `role="alert"`) that the port is in use by another program, or the reason when it is something
   else. Any later connect attempt clears the hint. A Connect the operator clicked keeps the red
   alert and the incident.
2. **Disconnect and Forget Controller pause auto-connect for this run.** The pause lives in a
   small session-only store (`auto-connect-session.ts`), never in storage, so a restart starts
   unpaused and the saved preference is untouched. Auto-connect does nothing while it is set. Any
   connect other than `'automatic'` lifts it, and so does a remote-control Connect, which uses
   `'automatic'` only to avoid a picker. While it is set and the preference is on, the menu reads
   "Connect automatically (paused until you connect)".
3. **Only a link lost while the machine may move raises the banner.** The port-close patch raises
   a notice for a running job, Fire, a jog or Frame (`motionOperation`), and a controller
   operation that can move: Home, auto-focus, probe, the start mark, a post-job settle, the
   fence before Start, the stop a Disconnect writes, and any owned command not marked
   `movesNothing`. Owned commands stay motion-capable by default because a console line or a
   motion settlement can move. Settings and build-info reads, `$` setting writes, the firmware
   report and the laser module check are marked `movesNothing`; with the handshake, a recovery
   wait and the work-Z reads, they log the incident and land in the ordinary disconnected state.
4. **A drop during motion has its own title.** It keeps the `disconnect-during-job` kind, so every
   physical-stop and recovery rule that reads that kind is unchanged, and adds `cause: 'motion'`.
   The banner titles it "Connection lost while moving", with a message naming jog, Frame, Home,
   probe and auto-focus. A job, post-job settle or Start fence keeps "Connection lost mid-job",
   and a stored or replayed notice without `cause` still renders that title.

### Consequences

- Leaving KerfDesk open beside another sender no longer flashes an alert or fills the incident
  history each time the machine is plugged in.
- After Disconnect the machine stays free for another program until the operator connects
  again. A page reload or restart lifts the pause.
- An unexpected close during a read still records its incident; only the E-stop banner is
  withheld, because nothing was moving.
- An idle non-GRBL Disconnect whose port drops during its own stop lines still shows the moving
  notice: the stop replaces the operation it stops, so it is treated as motion.
