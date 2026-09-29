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
     keeps a margin on top of any switch inset: 0.01 mm, or where a step is coarser half a step
     (`$100`, `$101`) plus 0.002 mm, and 0.05 mm when the step size was not read. KerfDesk measures
     a jog from the reported MPos, which the status report rounds to three decimals
     ([config.h L142-L143](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L142-L143)),
     while the firmware adds it to its own position, which after a move that ran to its end is
     that move's unrounded target, up to half a step from the step the motors reached
     ([gcode.c L863-L864](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L863-L864);
     only a jog cancel syncs the two,
     [protocol.c L385-L390](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L385-L390)).
     The 2026-09-29 re-audit found the first version's margin inside a switch inset rather than on
     top of it, which left the box on grblHAL's own envelope, already a pull-off inside both
     edges, so a hold toward an edge was refused from about half of all positions.
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
     unparsed lines, and on such a driver Cancel first waits for the last line to leave the
     transport (within the 8 s cancel bound), then at most 250 ms for every owed reply, then writes
     `0x85`; a grace counted from the press could run out before a line still being written
     arrived (2026-09-29 re-audit). Jog and Frame keep at most one line in flight, and an idle main
     loop parses it within a serial round trip. A reply still owed after
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

9. **Console commands that only read, write settings, or wait their turn** (C-6, C-4, C-5).
   - GRBL's `$` (help) and `$N` (startup lines) only print
     ([system.c L237-L246](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L237-L246)), and so do grblHAL's enumeration, help, pin,
     limit, homing-switch, spindle, port and extended build-info reports
     ([grblHAL system.c L1013-L1047](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L1013-L1047)), but the Console took them for
     G-code with an unknown effect and voided the completed Frame and the position evidence. They
     are now read-only report queries, by exact match only: `$HELP <topic>`, `$N0` and anything
     with `=` stay cautious. grblHAL's `$DWNGRD`, which rewrites the settings in non-volatile
     storage, joins the blocked persistent commands.
   - Stock GRBL stores a non-axis setting as an 8-bit integer and still answers `ok`
     ([settings.c L229](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L229)), so a Console `$22=0.5` turned homing and soft limits
     off while KerfDesk reported the write as done. On the stock GRBL driver the Console now
     refuses, before its confirmation prompt, a value the firmware would store as something else,
     with the check the Machine Settings dialog already applies (#923). grblHAL refuses such
     values itself. Every acknowledged Console setting write is read back with `$$`, not only a
     `$13` write, so the settings table shows what the controller stored.
   - GRBL answers lines strictly in order ([protocol.c L88-L104](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L88-L104)), and an
     owned Console exchange takes the next reply as its own, so a `$$` sent while a `$H` still owed
     its `ok` ended on the homing reply with an empty dump. An owned Console `$$` or `$n=` now
     waits, as the M115 identity read already did, until every earlier line is acknowledged; `$X`
     stays exempt as recovery.
   - No refusal of Frame, Start, Save G-code or output.

10. **Abort for motion nothing in KerfDesk started** (C-2).
    - A Console move, `$J=` or `$H` has no owner in KerfDesk, so the Live Motion popup, Ctrl+. and
      the crash screen's software abort offered no stop for it: Disconnect was the only one. While
      the controller reports Run, Jog, Home, Hold or Door and nothing here owns it (no job,
      controller operation, jog, Frame, Fire or grblHAL pendant), the popup now shows it with
      **ABORT MOTION** and still no Resume, and Ctrl+. and the crash screen offer the same Abort.
    - A reset sent into a cycle, jog or homing kills the steppers and raises `ALARM:3`
      ([motion_control.c L380-L386](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L386)), while a completed feed hold
      keeps position until cycle start or a reset
      ([protocol.c L377-L381](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L377-L381)). So Abort gives such motion the stop that
      keeps position: a jog gets jog cancel `0x85` and no reset (feed hold `!` where the driver has
      no jog cancel); a run gets feed hold `!`, then the reset once a fresh report shows the hold
      complete, at most 2 s later; a hold or door state gets the reset once the hold has settled;
      homing gets the reset at once. In laser mode GRBL and grblHAL turn the laser off by default
      once a hold has stopped ([config.h L583-L587](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L583-L587)). A page that is closing and a driver
      without a feed hold (Smoothieware) keep the immediate reset. A machine that needs longer
      than 2 s to decelerate, such as a heavy CNC gantry at a high feed, gets the reset before its
      hold completes, which raises `ALARM:3`, and KerfDesk treats the position as lost, as every
      Abort did before.
    - A door or lid switch wired to the controller's door input puts GRBL in its door state when
      opened while idle, so the popup now names that state until cycle start or Abort. Stock GRBL
      answers no status query while it homes, so a Console `$H` there still shows nothing until
      homing ends.
    - This narrows ADR-207's "Software Abort remains an immediate controller-specific
      reset/de-energize request" for motion nothing in KerfDesk started only: a jog ends with jog
      cancel and no reset, and a run's reset waits for its feed hold to complete, at most 2 s. Abort
      of a job or of an operation KerfDesk owns still resets at once.
    - No new refusal.

11. **Origins the controller restored, and which origin is active** (M-4/A-6, M-8, A-3).
    - grblHAL at its default compatibility level keeps a Set origin here (G92) origin through a
      reset and, unless `$384=1`, restores it at power-up
      ([grblHAL gcode.c L833-L838](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L833-L838)); every GRBL-family controller loads a
      saved G54 at power-up; and machine position restarts at zero wherever the head stands
      ([grblHAL grbllib.c L358](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/grbllib.c#L358), [main.c L47](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L47)). So an origin
      can already be on the controller when KerfDesk connects, and without Home it need not be
      where it was set. KerfDesk records what the first work-offset report of each connection
      showed. When a User or Verified Origin job would run from that same origin (no origin action
      since, and the controller still reporting the same XY offset) on a machine not homed in this
      session, Job Review's unverified bed-mapping warning adds that the origin was already on the
      controller when KerfDesk connected, what this firmware keeps, read from `$384` in this
      session's `$$` read (never written), and to check the Frame or Set origin here again. No new
      refusal.
    - The copy that said a reset, Wake or power loss clears Set origin here now says stock GRBL
      and FluidNC clear it ([gcode.c L42-L49](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L42-L49)) and grblHAL keeps it, through a
      power loss too unless `$384=1`.
    - The status panel's Origin row names the origin after its offset: "G92, set this session",
      "persistent G54", "restored by controller" or "reported by controller" (one KerfDesk cannot
      attribute, for example after a reset or a Console command); a Z-only offset still reads
      "custom". The G92 label avoids "temporary", since grblHAL keeps G92.
    - Since #923, Wake ends when the controller comes back locked in Alarm, as GRBL and grblHAL do
      after Sleep ([protocol.c L52-L54](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L52-L54)); the Sleep banner and the Release
      motors copy now say Unlock or Home comes next.
    - Correction to ADR-021: G92 is "cleared by GRBL on alarm, soft reset, power-cycle, or
      `$RST=#`", and "each session starts with a clean origin", only on stock GRBL and FluidNC, and
      a failed probe's `ALARM:4`/`5` resets nothing (decision 1). grblHAL keeps G92 through a soft
      reset and, unless `$384=1`, through a power cycle. The same holds for ADR-021's
      cache-invalidation paragraph ("Together these match GRBL's actual behaviour") and its note
      that grblHAL confirms vanilla GRBL 1.1 behaviour.

12. **The connection, the serial link, a refused `$HX` and Print and Cut capture** (T-4, T-3, A-7,
    R-5).
    - GRBL prints its banner only at the end of its start-up
      ([main.c L102](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L102)), so a board
      that resets when the port opens and needs more than the 2 s handshake window was reported
      as "No controller response ... Check baud rate", failed qualification, and Find my machine
      offered other speeds; the banner then qualified it moments later. After 2 s of silence the
      log now says KerfDesk is still listening, qualification stays pending while the status poll
      keeps asking, and it fails only after 10 s in all: the 2 s window plus the 8 s poll wait
      queued-poll controllers already had, the same 10 s LaserGRBL allows
      ([GrblCore.cs L2029](https://github.com/arkypita/LaserGRBL/blob/1f9337b3af27133f8b1696e41cc110f2af74d04f/LaserGRBL/Core/GrblCore.cs#L2029)).
      The baud rate is named only when nothing arrived or nothing that arrived decoded; readable
      lines point at the device and profile. Any status report counts as an answer, an Alarm or
      Sleep report included.
    - Web Serial's break, buffer-overrun, framing and parity errors leave the port open and reading
      goes on, but the bytes at the error are lost, and GRBL answers every line with exactly one
      `ok` or `error:N` ([interface.md L9](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L9)),
      so a lost reply leaves its line unacknowledged and the stream waiting. Both transports now
      report each line error to the store. The Console shows it, at most once every 5 s with a
      count of the rest; a stream hold in the same job names it in the live bar, the hold log line
      and the safety notice; and a silent connect that saw only line errors names the baud rate.
    - Stock GRBL enters its homing state before it checks a `$H` suffix and, built without
      single-axis homing (the default), answers `$HX` with `error:3` and stays in that state,
      reporting Home and running nothing until a soft reset
      ([system.c L179-L194](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L179-L194)).
      The Falcon command set on the stock driver homes with `$HX`. A Home report from the stock
      GRBL driver that no Home line still owed a reply accounts for now sets ADR-393's reset latch
      to a homing-state value: the Alarm banner says the controller is stuck in its homing state
      and offers Reset (Ctrl-X), and the Live Motion popup names it HOMING STATE with ABORT MOTION.
      A real cycle answers no status query until just before its `$H` reply, while that reply is
      still owed, so it never qualifies. Unlike the critical-event latch this one holds nothing.
    - GRBL reports MPos or WPos as `$10` selects, never both
      ([report.c L522-L527](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L522-L527)),
      so with WPos reports Print and Cut's **Capture head** stayed off with no reason. It now takes
      the position the status panel shows, MPos or WPos plus the work offset, converted to
      millimetres once. While the controller is connected and Idle without a known position, the
      dialog says why: no work offset reported yet, a position KerfDesk withholds after Unlock,
      Release motors or an unfinished Home, or report units unconfirmed after a `$13` write. A
      withheld position is never captured.
    - No new refusal.

### Consequences

- The GRBL simulator models more stock GRBL behaviour: `G10 L20` with an active G92, a failed
  `G38.2` (`probeFailure`), and, both off by default, the power-up lock into Alarm with homing on
  (`homingInitLock`) and the `error:15` check of a `$J=` target once `$20=1`. An opt-in
  `jogCancelFlushesInput` mode plays grblHAL's `0x85`, which discards lines not parsed yet, and
  `storedOffsets` loads the G54 and, on grblHAL with `$384` not 1, the G92 an earlier session
  stored. It also plays stock GRBL's stuck homing state after a refused `$HX`, answers a status
  query asked during a homing cycle once at the end of the cycle, and raises `ALARM:6` for a
  reset in the homing state.
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
- Still open for restored origins: a power loss inside one connection looks like any reset, so
  an origin restored then reads as re-learned; the recovery review's work-origin match does not
  know about a power-up restore without Home; after Reset origin, a restored G54 that remains
  reads "reported by controller".
- Still open for the connection and capture work: a head-mounted camera (ADR-449) still reads
  only MPos, so with WPos reports it has no head position; after the reset out of the stuck
  homing state the log line names Sleep or a critical alarm, not the homing state; with the
  Falcon command set on the stock GRBL driver, Home sends `$HX` again after that reset and gets
  stuck again, so Unlock is the way out; the simulator does not model `$10` WPos reports.
