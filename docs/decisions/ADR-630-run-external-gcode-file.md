## ADR-630 - Run an external G-code file through Frame and Start

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-18 ("running external G-code files"). Amends PROJECT.md "Out of scope" and the LightBurn gap audit's "Running an external G-code file is out of scope" line. Keeps PROJECT.md non-negotiable 21 and ADR-565: a completed Frame remains the only ordinary Start gate.

## Context

KerfDesk opens `.nc`, `.gcode` and `.tap` files in the G-code Inspector and can only look at them. Router owners usually design in Fusion, VCarve or Carbide Create and need a program to *send* the result; that is how gSender, UGS and CNCjs win them, and LightBurn runs a G-code file too. A KerfDesk operator with a program from elsewhere has to close KerfDesk and open a different sender.

KerfDesk's Start contract fits this well: the Inspector already knows where the program moves, so the operator can Frame that outline over the real stock before anything cuts.

## Decision

### Where it starts

The G-code Inspector shows **Run on machine...** for a file the operator opened (not for the project's own program, which already has Frame and Start). The button is enabled while a controller that runs ordinary jobs is connected and Idle and no job is running; otherwise its tooltip says why. It opens the **Run G-code file** dialog for that file.

### What is sent

The program the controller receives is one baseline line, then each line of the opened file in the form stock GRBL itself collects it: comments (`(...)` and `;` to the end of the line), spaces, tabs and the `/` block-delete mark removed, because GRBL discards them while reading a line. `%` tape markers and blank lines are dropped. Nothing else is changed: no other line is added, reordered, rescaled or rewritten. The canonical form makes the review parse exactly the words the controller runs: `G 1 X1 0 0` is read and run as `G1X100`, and `/$J=…` is recognised as the `$` command it is. The baseline sets every mode the review reads the program in that the controller keeps between programs: `G17G21G90G94G0` on GRBL, grblHAL and FluidNC (XY plane, millimetres, absolute distance, feed per minute, rapid motion), `G17G21G90G0` and then `M221 S100` on Smoothieware, whose laser keeps its power scale between programs (Amendment 3), and `G21G90` on Marlin, which stops a job at a command its build lacks and keeps no plane or motion mode. A plane, unit, distance, feed or motion mode, or a Smoothieware power scale, left by an earlier program, a Console command or the Frame therefore cannot change what was framed; a program's own `G20` or `G91` still applies from where it appears. The normalized bytes are parsed and timed again by the cancellable Inspector worker, from where the head stands (below); the Run review, Frame envelope and Start all use that executable, never the original file's model. A large file is normalized a slice of lines at a time so the dialog stays responsive. The dialog shows the number of lines and bytes that will be sent, and the run streams exactly those bytes. Comments are removed because the controller would still receive them, they use buffer space, and characters such as `!`, `~` and `?` inside a comment are realtime commands to GRBL.

Refusals. All but two are factual, because the program cannot be streamed as written; the `$` command refusal (Amendment 1) and the shell, file and stored-program command refusal (Amendment 5) are policy refusals:

- no line is left to send;
- a line is longer than the connected controller accepts (ADR-375's limits) or than its receive window. The dialog checks this against the connected controller before offering Frame, as Start would refuse it anyway;
- a line holds, outside a comment, a byte a GRBL-family controller acts on instead of reading it as text: a realtime command (`?`, `!`, `~`, Ctrl-X, or any byte at or above 0x80), grblHAL's Ctrl-C, Ctrl-T after ESC and Ctrl-Y, or backspace and DEL, which grblHAL takes as a line edit. Other control characters (a DOS end-of-file Ctrl-Z, a form feed) are dropped, as stock GRBL discards them (Amendment 1);
- a line is a `$` controller command (`$H`, `$X`, `$J=`, a `$` setting), also behind a `/` or spaces, or FluidNC's bracket form of one (`[J]`, `[Jog]`, which FluidNC runs as `$J=`). This one is policy: GRBL runs those only while Idle and answers `error:8` mid-job, so whether one runs depends on timing, and the Frame cannot trace what they move. They belong in the Console.
- a line the connected controller hands to its shell, its files or a program stored on it: on Smoothieware a line that starts with a lowercase letter, `M1000`, and the SD-card and config-file M-codes; on Marlin the SD-card write, SD print, EEPROM save and firmware update commands; on grblHAL a stored macro or subprogram call. `M30` with a file name is refused, a bare `M30` is not. This one is policy too: the Frame cannot trace what such a line runs (Amendment 5).
- a line is one a GRBL-family controller rejects whole: two commands from one modal group (`error:21`, such as `G90G91`), two commands that both take the axis words (`error:24`) or a repeated value word (`error:25`). The Inspector would still apply it, so the traced outline would differ from what runs (Amendment 1);
- on FluidNC or grblHAL, a line holds a `#` parameter, a `[ ]` expression or O-word flow control, which the controller works out as it runs and the Inspector cannot, so the traced outline would differ from what runs. `X[5*2]` is named as an expression, not as a checksum (Amendment 7);
- the file is not text (it holds a NUL byte);
- the Inspector cannot construct a finite motion envelope for the Frame to visit. A program that never moves is not this case: it runs where the head stands, so its Frame visits that point (Amendment 1).

### The Frame

The program is read from where the head stands: the Inspector's parse starts at the head's current work position, so the first approach, relative moves and arcs are measured from the real start, not from the drawn origin. While the head moves, the program is read again from each new resting position; while framing, and while the resulting Frame holds, that start is pinned. Until a connected machine reports a position, the review reads from the work origin and Frame is unavailable.

The dialog's **Frame** traces the program's XY motion envelope at the current work origin with the tool off, using the ordinary Frame motion (queue, work-coordinate and report-unit preparation, completion settlement), and then returns to the start position, so Start begins exactly where the program was read from. The envelope covers rapid, linear and arc moves from that start (arcs in the XY, XZ and YZ planes, Amendment 2), absolute and relative distance, millimetres and inches, in the active work coordinates. It holds only the motion the program places in the work coordinates it starts in (Amendment 1).

A clean completion records a Frame for this exact program: its fingerprint, its envelope, the controller session, the trusted position and the work origin. Any Jog, Home, origin or probe change, reset, alarm, reconnect, or another Frame clears it, exactly as it clears an ordinary Frame. Start stays unavailable until that Frame completes.

### Review and Start

The **Run** dialog is the one review for the file: name, lines and bytes to send, estimated time, the envelope and its size, the units the program declares, and the machine mode it will run in. Findings are warnings that never refuse:

- moves in machine coordinates (`G53`), a work coordinate change away from `G54`, `G92`, `G28`/`G30`, or work-offset writes (`G10 L2`/`G10 L20`), whose moves the Frame outline leaves out because it cannot place them in the work coordinates the program starts in (Amendment 1). Offset writes carry an explicit displacement warning; they do not add a refusal. Every command warning is found with the shared G-code word scanner, so `G+91`, `G91.0` or `G 91` cannot hide one, and `G28.1`/`G30.1` are told apart from a move to a stored position;
- relative moves (`G91`), read from where the head stands; Start runs them from that same spot;
- program stops (`M0`/`M1`), sent to the controller unchanged. Stock GRBL and FluidNC ignore `M1`, so the review says the program runs straight through it; grblHAL holds there unless optional stop is turned off (Amendment 7);
- a program that ends in inches (`G20`), which leaves the controller in inches until the next program sets `G21`; a program that switches back to `G21` is described as such instead;
- the laser or spindle still on at the end of the program (no `M5`, and no `M2`/`M30` after the last `M3`/`M4`, since GRBL switches it off at a program end);
- a program that looks like the other machine mode (spindle speeds above the laser's S range in Laser mode, or no Z motion in CNC mode);
- tool changes (`M6`), which stock GRBL does not support;
- zero XY extent: Frame visits a point rather than tracing an XY outline and does not prove Z clearance or cutting depth. An axis the program never sets runs where the head stands now;
- the Inspector's Program Health notices and warnings, and the words it does not interpret;
- probing (`G38.2` to `G38.5`), and an `M3`/`M4` that runs before any `S` (on its own block or an earlier one): a later `S` does not cover the moves before it;
- a Frame outline that leaves the configured machine bounds or overlaps an enabled no-go zone (Amendment 1);
- the connected controller's `$30`/`$32` findings, from the same readiness check and in the same words as Job Review, and on a laser whose `$32=0` is reported or unconfirmed, the `G0` moves the program makes with the laser on (Amendment 4).

In CNC mode the existing workholding and exclusive-access attestation applies; in Laser mode the existing `$30`/`$32` acknowledgement applies under the same condition as project Start, citing the Run review and leading with any lit rapids (Amendment 4). Confirming **Start** checks the Frame is still the current one for this exact program and that the head still stands at the program's start, consumes the Frame, and streams the program with the ordinary streamer. The final handoff, after controller preparation, checks the controller session, origin, head position and machine mode once more, because the Laser/CNC switch stays usable while Start arms. External M0/M1 pauses are sent unchanged to the controller; they are not intercepted as KerfDesk project bit changes. The controller then holds at an `M0` (and at grblHAL's `M1`) until the machine's own cycle start, which KerfDesk's Resume does not replace, so the review warns about them; it says stock GRBL and FluidNC run straight through an `M1` (Amendment 7). The Live Motion bar's Pause, Resume and **ABORT JOB** work as for any job (non-negotiable 9). As the stream is installed, the store drops what the program's own words may change. A `G54`-`G59` word that selects another system makes the active WCS unknown, so the next Frame reads it before selecting `G54`. A Z-offset or tool word (the Console's rule) makes Work Z stale (Amendment 6).

### Not in this decision

- Running the same file again needs another Frame (one Frame, one run). Reusing the Frame across runs, as ADR-565 does for the project, can follow once the external run keeps ADR-565's evidence.
- Interrupted-job resume, the second pass and job history are project features; an interrupted external run reports where it stopped and offers no resume. Once its program may have reached the controller, an external run retires the project's recovery card, Run again receipt and second-pass offer, because the project's last job is no longer the last thing the machine ran (ADR-341 Amendment 10).
- The file is never edited, imported into the drawing or saved into the project.

## Consequences

- KerfDesk can be the sender for programs made in other CAM software, behind the same physical Frame as its own jobs.
- The canvas and project are untouched by an external run.
- The streamed bytes differ from the file only by the baseline line first, removed comments, spaces, tabs, `/` marks, tape markers and blank lines, and LF line endings: the line as GRBL itself collects it. The dialog always states those transformations.

## Verification

Unit tests cover program normalization (the baseline line, comments, `%`, blank lines, spaces inside words, `/` marks, slice-at-a-time input), each factual refusal, the envelope across absolute and relative moves, arcs and `G20`, each warning, the Frame record's invalidation by a changed program, moved head, changed origin or changed machine mode, the Frame's return to the program's start, and that Start streams exactly the normalized bytes once and refuses without a current Frame. A component test drives the dialog through Frame (its motion stubbed: the Frame motion itself is covered by the store's own external-Frame tests), review and Start against the store, which receives the exact bytes once. No hardware qualification is claimed.

A point envelope is constructable by the ordinary Frame builder. Zero XY extent is therefore a warning, not an additional Start refusal (PROJECT.md non-negotiable 21). Completing that point Frame still satisfies the ordinary Frame requirement; it does not qualify physical Z motion.

## ADR-630 Amendment 1 - Placement, bed checks, honest refusals and the CNC start height (2026-10-20)

An audit of this decision's first implementation found the Frame outline, some warnings and some refusals did not say what the program does. The Decision text above is corrected in place; this records what changed and why.

1. **The outline holds what the program places in its starting work coordinates.** The review's model is built with `boundsFromStart`. Stock GRBL (`gcode.c`) moves in machine coordinates for `G53`, stops a probe (`G38.2` to `G38.5`, a motion mode that lasts until another motion command) where it touches, sends `G28`/`G30` to a stored position, and takes the axis words beside `G10` and `G92` as an origin, not a move. So: `G53` and probe targets and a `G30` move are left out of the outline, and the axes they move count again once the program sets them in work coordinates; `G10 L2`/`L20` and `G92` axis words move nothing, and moves after a write to the `G54` origin the Frame used (or after `G92`/`G92.1`) on the axes written are left out; moves in `G55`-`G59` are left out. `G28.1`/`G30.1` axis words stay ordinary moves, as GRBL makes them. Before this, `G53 G0 X-400 Y-5` read from work X50 Y50 framed a corner at work X-400 Y-5, a point the program never visits. The warnings now say those moves are not in the Frame outline and that the head still makes them. The Inspector's own view and Size are unchanged.
2. **Bed and no-go zones.** The outline is placed on the bed the way a jog's path is (the controller's offset, then a verified native-to-bed frame, or bed coordinates on a machine never homed). Leaving the configured bounds, or overlapping an enabled no-go zone, adds a review warning; neither refuses (ADR-232). Where the bed position is unknown, the review says the outline was not compared. A typo such as `G1 X6000` is now named.
3. **More warnings.** Probing, the words the Inspector does not interpret (Program Health lists them as notes), and an `M3`/`M4` before any `S` (GRBL keeps `S` across programs, so the first powered moves would run at a leftover value) are named.
4. **Refusals.** Control characters stock GRBL discards (`protocol.c` drops every byte at or below a space) are dropped instead of refused; the bytes a GRBL-family controller acts on stay refused (Ctrl-X everywhere; grblHAL's Ctrl-C, Ctrl-T after ESC, Ctrl-Y, backspace and DEL, per its `grbl.h` and `protocol.c`). The `$` command refusal is kept and recorded as policy. A program that never moves (`M3 S10000`, `G4 P60`, `M5`) frames the point where the head stands, with a warning, instead of being refused: the ordinary Frame builder frames a point, as for zero XY extent.
5. **The CNC start height.** A CNC Frame begun below work Z0 leaves the bit at safe Z (ADR-192). The program is then read again from that height and Start compares with it, so the head check still covers all three axes; before, Start stayed locked.
6. **The Run on machine button** is enabled only while connected, Idle and with nothing else running, as this decision always said; its tooltip gives the reason otherwise.
7. **Units text.** An undeclared program runs in millimetres: the `G21` baseline goes first.
8. **Program end.** GRBL switches the spindle or laser off at `M2`/`M30`, as the Inspector's parser does, so the "still on at the end" warning counts a program end as off until a later `M3`/`M4`.
9. **Arcs.** The outline holds each arc's exact extent. The display samples arcs in coarser chords than a controller's `$12` interpolation, and a chord can cut inside the arc's outermost point, which the head still reaches.
10. **Start arming.** The dialog cannot be closed while Start prepares the controller: closing does not cancel the Start, so the program could begin streaming with no dialog showing. Close returns once the job streams or Start stops; ABORT JOB stays on the Live Motion bar.
11. **Rejected blocks and bracket commands.** A line a GRBL-family parser rejects whole (`error:21`, `error:24`, `error:25`) is refused: the Inspector applies it, so `G90G91G1X10` would be framed relative while GRBL rejects it and stays absolute, with later lines already buffered when Start stops on the error. The coolant group is not checked, as firmware differs on `M7` with `M8` and coolant does not move the head. FluidNC's bracket commands (`[J]`, `[Jog]`, run as `$J=`) are refused like the `$` form.
12. **All assumed modes, checksums and comments.** The baseline sets the plane, feed and motion modes as well as units and distance (the controller form above): GRBL keeps all of them between programs, and a bare axis line moves in the kept motion mode, so a `G19` or modal `G2` left by the Console bent a path the review read as straight. A line with a checksum (`N1 G1 X10*42`) is refused: GRBL rejects the `*`, and normalizing breaks the checksum Marlin would verify. A realtime byte inside a comment is not refused: the comment, with it, is removed before sending, so it never reaches the controller, and refusing would also turn away the many CAM files with accented or symbol characters in their comments.

Verification: unit tests cover each placement case above, the bed and zone warnings, the probe, unsupported-word and `S` warnings, the dropped and refused control characters, the point Frame for a program that never moves, the CNC start height after a Frame, and the button's enablement; a component test drives the dialog through Frame and Start. No hardware was run.
