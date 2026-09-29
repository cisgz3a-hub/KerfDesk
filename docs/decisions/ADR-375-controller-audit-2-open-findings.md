## ADR-375 - Controller audit 2: the controller faults main still had (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

A second audit of the controller layer and the controller settings (requested 2026-09-24), checked
line by line against pinned firmware source: gnea/grbl v1.1h at `bfb67f0c`, grblHAL/core at
`d7aaee3d` and FluidNC at `fdc17a2c`. It found 36 faults. A separate controller audit on
2026-09-25 (`docs/audits/2026-09-25-controller-full-audit.md`; ADR-393, ADR-400, #923 and #932)
fixed nine of them and part of four more on main before this work landed, so this decision records
only what main still lacked. Each fix below was reproduced with a focused test against the store
or the GRBL simulator before it was made. No hardware was available, so none of this is hardware
evidence.

Builds on ADR-361 and ADR-362 (the first controller audit), ADR-393 (critical events offer Reset)
and ADR-400 (GRBL-family protocol). The frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: every refusal added below names its kind, (a) the transport cannot
carry the work or (c) the handoff is inconsistent, and everything else is a Job Review warning.

### Context

GRBL 1.1h and grblHAL at its default `COMPATIBILITY_LEVEL 0` differ in ways KerfDesk's controller
layer had flattened into one model: whether soft limits apply before homing, whether a failed probe
resets anything, and when the work offset is reported. Several manual-motion and placement paths
therefore sent moves the firmware refuses, or trusted values the controller had not reported yet.

### Decision

1. **Origins that outlive a failed probe and a corner probe** (M-1, M-2).
   - A failed probe, `ALARM:4` (the probe was already triggered, or on grblHAL is not connected) or
     `ALARM:5` (no contact within the travel), stops only the probe move and resets nothing: GRBL
     and grblHAL do not count either as critical, FluidNC only enters Alarm, and `$X` only returns
     to Idle, so the machine position and every work offset, a G92 included, still hold
     ([motion_control.c L273-L298](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L273-L298),
     [system.c L160-L165](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L160-L165)).
     These two alarms now keep the XY origin, and an Unlock that clears one of them (the Alarm
     banner's or a Console `$X`) no longer hides the reported position or drops the origin. Work Z,
     Home and Frame evidence are still cleared, as for every alarm, and a position that was already
     untrusted before the probe stays untrusted. The alarm an Unlock clears is read before `$X` is
     sent, because the first report out of Alarm clears `alarmCode` and can be handled before the
     `ok`. Frame's blocked-start Unlock offer then says the position and origin were kept and
     continues the Frame once the controller reports Idle.
   - Other probe alarms still count as a reset: grblHAL's `ALARM:13` (probe protection) marks the
     position lost when the motors were stepping, and FluidNC's `ALARM:18` (probe hard limit)
     stops stepping at once
     ([grblHAL protocol.c L568-L571](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L568-L571),
     [FluidNC MotionControl.cpp L439-L445](https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/MotionControl.cpp#L439-L445)).
     A text alarm (Smoothieware) names no code and keeps the reset behaviour.
   - `G10 L20` stores the work offset as MPos - G92 - WPos
     ([gcode.c L550-L553](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L550-L553)),
     so a corner probe run while Set origin here's G92 was active stored a corner that moved by
     that G92 at the next reset on stock GRBL and FluidNC. The corner cycle now sends `G92.1` right
     before its single `G10 L20 P0` commit, after the sixth contact, so a failed contact still
     leaves the operator's origin as it was. A settled corner cycle is recorded as a saved G54
     origin and trusts status reports again, as Set origin here does; its start makes anything
     bound to the old origin, such as a Place Board registration, stale.
   - The Z touch-off keeps any G92: `G10 L20` works per axis and Set origin here writes only
     `G92 X Y`, so a `G92.1` there would drop the operator's XY origin, and every reset or `G92.1`
     that later drops a G92 Z already voids work-Z evidence.
   - No new refusal.

2. **Work offsets not reported yet** (R-2, R-3).
   - GRBL puts `WCO:` in only some status reports: the first after a reset, the next after an
     offset change, then every 10th Idle or 30th busy report
     ([interface.md L561-L568](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L561-L568)).
     Before the first one, an Absolute or single-position Current Position placement assumed a
     zero offset, and a Frame's `$J=G90` work-coordinate targets traced somewhere else when the
     controller held a stored G54 or a G92 grblHAL kept through a reset
     ([jogging.md L23](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/jogging.md#L23),
     [grblHAL gcode.c L787](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L787)).
     Frame now runs the existing bounded status burst (`?` every 100 ms, at most 3 s), homed or
     not, when the driver's reports carry WCO (GRBL, grblHAL, FluidNC), none has arrived, no custom
     origin is known, reported positions are not being discarded and the placement would assume
     zero. A WCO that arrives is used for the placement. When none does, nothing is refused: the
     Frame proceeds at the assumed zero, Job Review warns that zero was assumed, and the status
     row reads "Origin: not reported yet" instead of "machine 0,0". Start never runs a Frame
     (ADR-372), so it has nothing to wait for. No new refusal.
   - A first WCO report equal to the zero a Frame was placed with no longer throws away the
     finished Frame, its permit or the Start handoff, because GRBL reports any offset change in
     the very next report
     ([system.c L280-L286](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L280-L286)).
     Frame completion, the split-Frame trace (ADR-353), the final Start handoff and the verified
     Frame now compare the effective offset: the reported WCO or, before any report and while no
     custom origin is known, that assumed zero. This extends to completion and the handoff the
     equivalence ADR-343 Amendment 1 gave preparation, and replaces its sentence that "completion
     and the final Start handoff retain their existing exact-offset contract". A first non-zero
     report, Z-only included, still voids them as an inconsistent handoff (NN21 (c)).

3. **Manual motion inside the firmware's limits** (M-3, M-5).
   - With `$20=1`, stock GRBL checks every jog target against its travel whether or not it is
     homed, from its own machine position, and refuses the whole line with `error:15`
     ([jog.c L35-L37](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/jog.c#L35-L37),
     [system.c L346-L349](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L346-L349)).
     When this session's `$$` shows soft limits on, press-and-hold jog is clamped in machine
     coordinates to the envelope from `$130`/`$131`, `$23` and this session's `[OPT:]` Z, with or
     without a verified bed frame and whatever the profile's homing setting. Each enforced edge
     stays 0.01 mm inside, because the status report rounds MPos to three decimals
     ([config.h L142-L143](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L142-L143)).
   - After Unlock without Home (or Release motors, a failed Home, an origin write that ended
     unknown) KerfDesk hides the reported position, but stock GRBL still checks from its own MPos
     and `$X` leaves that position as it was. On stock GRBL with this session's `$20=1`, the hold
     then aims from the controller's MPos in the latest status report. Only the hold clamp reads
     that number (`withheldControllerMPos`); placement, Frame, Start, the bed mapping, Move laser
     here and the position readout still see no position.
   - grblHAL enforces soft limits on homed axes only, so its clamp applies after this session's
     Home, from grblHAL's own envelope
     ([machine_limits.c L114-L136](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L114-L136)).
     Without a `$$` read (the Falcon's vendor command set), on FluidNC, Marlin, Smoothieware and
     Ruida, or with WPos-only reports after Unlock, the hold is unchanged: it asks for full travel
     and relies on release plus the jog-cancel byte.
   - With hard limits on (or `$21` unread), hold-to-jog and Move laser here stop `$27` short of the
     homing switch on each axis's homing side (1 mm when `$27` is unread, as gSender does). Homing
     rests the pull-off inside the switch edge so the switch does not trip again, and a hard limit
     resets the controller into `ALARM:1` with the position lost
     ([limits.c L366-L384](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L366-L384),
     [limits.c L110-L128](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L110-L128)).
     No inset with `$21=0` or with HOMING_FORCE_SET_ORIGIN, whose homing edge is already the rest
     point.
   - Both only shorten a move KerfDesk already sends. Step jogs, typed head moves and Frame corners
     are unchanged (ADR-232 leaves those limits to the controller). No new refusal.

4. **Fire at the power it shows** (P-2).
   - GRBL and grblHAL scale every S word by the spindle override, and an override raised during a
     job stays set until a reset
     ([spindle_control.c L195](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c#L195),
     [grblHAL spindle_control.c L867-L868](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/spindle_control.c#L867-L868)), so the low-power Fire
     dot ran at 7.5% or 10% after a 150% or 200% override. When the controller has overrides and
     its last `Ov:` power value is unknown or not 100%, Fire now writes the override reset byte
     `0x99` before the Fire-on line, the rule Start already applies (ADR-355), for that one
     override. Both firmwares apply pending realtime commands before they run the next line
     ([protocol.c L81](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L81)). A release, a lost Idle or a failed write during the
     reset keeps Fire-on off the wire. With a known 100% the press is unchanged.
   - The capped Fire S now rounds down, so the absolute 5% ceiling (ADR-162) holds on small S
     ranges: 5% of S255 is S12, not S13.
   - No new refusal.

5. **What the receive buffer and the line buffer can take** (P-3/S-2, S-3).
   - grblHAL prints the free receive count as a 16-bit number, so the Falcon A1 Pro's idle
     `Bf:512,65535` is only the field's largest value, and a stream may report a fixed size
     whatever it buffers ([report.c L1342-L1347](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L1342-L1347)). KerfDesk had counted it
     as 4096 proven bytes, and Job Review told the operator to raise the RX window. A `Bf:` receive
     report above 4104 bytes (the 4096-byte streamer cap plus its 8-byte margin) now proves only
     grblHAL's default 1024-byte ring ([stream.h L52-L53](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/stream.h#L52-L53)), so 1016 usable
     bytes, recorded as the window source `oversized-report`, and Job Review names that ring
     instead of suggesting a larger window. A stock `$I` ring size still wins. The window only
     narrows.
   - Stock GRBL keeps 79 significant characters of a line and grblHAL 256, and both answer a
     longer line with `error:11` without running it
     ([protocol.c L141-L143](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L141-L143)); KerfDesk checked lines only against the RX
     window and FluidNC's own limit. For a connected stock GRBL or grblHAL driver, such a line is
     now refused at Frame preparation, beside the RX-window refusal, and again at Start before a
     byte is sent, which also covers resume and recovery streams. The message names the line, its
     count and the limit. This is refusal kind (a): the controller cannot take the line. The
     limits are the stock builds' sizes, because no report names a custom build's own, and the
     count can only err low. KerfDesk's own lines stay under 60 characters today, so this is a
     latent guard.

6. **Jog cancel on grblHAL** (M-6).
   - grblHAL handles the jog-cancel byte `0x85` in every state: it drops the partial line and
     flushes its input buffer ([protocol.c L896-L899](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L896-L899)), so a `$J=` it had
     not parsed yet was never answered, Cancel timed out, and Jog, Frame and Disconnect stayed
     locked until ABORT MOTION. The grblHAL driver now declares that its jog-cancel byte drops
     unparsed lines, and on such a driver Cancel first waits briefly, at most 250 ms, for every
     owed reply and pending write, then writes `0x85`. Jog and Frame keep at most one line in
     flight, and an idle main loop parses it within a serial round trip. A reply still owed after
     the grace belongs to a line already parsed, which the flush cannot drop, so the byte goes
     anyway: stopping motion comes first, grblHAL builds with the kinematics API (CoreXY among
     them) cancel a jog from the byte at once
     ([protocol.c L900-L903](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L900-L903)), and the settlement then waits for that
     reply as before. Stock GRBL, which acts on `0x85` only while jogging, FluidNC and the Falcon
     command set are unchanged. Not seen on hardware.
   - No new refusal.

7. **The Falcon command set and the identity advice** (P-1, P-4).
   - Connect binds the driver and its command set from the profile (ADR-322), but Job Review
     compared only the controller family. A Falcon A1 Pro profile on a connection made with the
     generic grblHAL commands passed silently, and a saved A1 Pro copy made before the preset had
     its vendor command set always connected that way. The generic Frame ends with `M5` then `M9`
     just before Start, and `M9` turns off every coolant output
     ([grblHAL gcode.c L1865-L1866](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L1865-L1866)), which on the A1 Pro left the first
     air-assisted operation without air (ADR-323). Job Review now warns when the profile's command
     set differs from the one the connection bound, with reconnect advice, and names a saved copy
     of a built-in preset that lacks the preset's command set, with re-apply advice. Machine Setup
     shows such a copy's card unselected with a notice, so one click re-applies the preset. Nothing
     migrates without that click.
   - grblHAL's banner is fixed when the firmware is built
     ([report.c L311-L315](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L311-L315)), so the advice "Reconnect using the selected
     profile" could never clear a difference in the banner alone. Job Review now says the banner is
     identity evidence and advises choosing that firmware in Machine Setup if the machine runs it.
     Find my machine separates a driver or command-set mismatch (Reconnect) from a banner-only
     difference (no Reconnect; Read again stays available). **Use detected** lists every other
     draft value the choice changes (RX window, streaming, output dialect, vendor commands, baud,
     power range, and a scan-offset calibration it clears) and applies them only on
     **Apply to draft**.
   - No new refusal.

8. **grblHAL settings bitfields and the settings write gate** (C-7, C-8).
   - grblHAL prints `$21` and `$22` as bitfields whose bit 0 is Enable
     ([settings.c L2377-L2385](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2377-L2385)), so a grblHAL `$22=5` read as unknown.
     Both are now read by bit 0 of a non-negative integer. Stock GRBL and FluidNC print 0 or 1 and
     read as before.
   - The Machine Settings write gate checks only that the settings were read in this connection,
     but its message asked the operator to read and export a backup. The message now says what the
     gate checks, and the panel no longer calls itself read-only. Requiring an export first would
     be a new refusal outside NN21, so none was added. Each `$x=` is stored at once with no
     firmware undo ([settings.c L301](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L301)), so the copy still asks for an export.

### Consequences

- The GRBL simulator models more stock GRBL behaviour: `G10 L20` with an active G92, a failed
  `G38.2` (`probeFailure`), and, both off by default, the power-up lock into Alarm with homing on
  (`homingInitLock`) and the `error:15` check of a `$J=` target once `$20=1`. An opt-in
  `jogCancelFlushesInput` mode plays grblHAL's `0x85`, which discards lines not parsed yet.
- Still open for work offsets: transient Frames (the camera calibration target, the recovery
  area, the second pass) get no burst; a controller whose reports never carry WCO waits 3 s at
  every Frame while no offset is known, and with a real offset it cannot earn a permit (the
  existing return check fails, as before).
- Still open for the origin: FluidNC enters Alarm before it prints the alarm line, so an
  `<Alarm|>` report that arrives before `ALARM:5` still drops a G92 origin; a Console `$X` with
  no alarm active still hides the position.
- Still open: grblHAL keeps an axis homed through `$X` and resets, but KerfDesk clamps only after
  this session's Home; per-axis pull-off settings in some grblHAL builds are not modelled.
- Still open for the Falcon and settings work: the camera calibration's one-off review lacks the
  command-set warnings; the automatic fill for a new machine (ADR-420) names only the controller
  it sets, not the RX window, command set or calibration the same choice changes (its Undo covers
  them); the settings reference still labels `$21` and `$22` "0/1".
