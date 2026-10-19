## ADR-630 - Run an external G-code file through Frame and Start

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-18 ("running external G-code files"). Amends PROJECT.md "Out of scope" and the LightBurn gap audit's "Running an external G-code file is out of scope" line. Keeps PROJECT.md non-negotiable 21 and ADR-565: a completed Frame remains the only ordinary Start gate.

## Context

KerfDesk opens `.nc`, `.gcode` and `.tap` files in the G-code Inspector and can only look at them. Router owners usually design in Fusion, VCarve or Carbide Create and need a program to *send* the result; that is how gSender, UGS and CNCjs win them, and LightBurn runs a G-code file too. A KerfDesk operator with a program from elsewhere has to close KerfDesk and open a different sender.

KerfDesk's Start contract fits this well: the Inspector already knows where the program moves, so the operator can Frame that outline over the real stock before anything cuts.

## Decision

### Where it starts

The G-code Inspector shows **Run on machine...** for a file the operator opened (not for the project's own program, which already has Frame and Start). The button is enabled while a controller that runs ordinary jobs is connected and Idle and no job is running; otherwise its tooltip says why. It opens the **Run G-code file** dialog for that file.

### What is sent

The program the controller receives is one baseline line, `G21G90` (millimetres, absolute distance), then each line of the opened file in the form stock GRBL itself collects it: comments (`(...)` and `;` to the end of the line), spaces, tabs and the `/` block-delete mark removed, because GRBL discards them while reading a line. `%` tape markers and blank lines are dropped. Nothing else is changed: no other line is added, reordered, rescaled or rewritten. The canonical form makes the review parse exactly the words the controller runs: `G 1 X1 0 0` is read and run as `G1X100`, and `/$J=…` is recognised as the `$` command it is. The baseline means a millimetre or absolute mode left by an earlier program or a Console command cannot change what was framed; a program's own `G20` or `G91` still applies from where it appears. The normalized bytes are parsed and timed again by the cancellable Inspector worker, from where the head stands (below); the Run review, Frame envelope and Start all use that executable, never the original file's model. A large file is normalized a slice of lines at a time so the dialog stays responsive. The dialog shows the number of lines and bytes that will be sent, and the run streams exactly those bytes. Comments are removed because the controller would still receive them, they use buffer space, and characters such as `!`, `~` and `?` inside a comment are realtime commands to GRBL.

Factual refusals, because the program cannot be streamed as written (no policy refusal is added):

- no line is left to send;
- a line is longer than the connected controller accepts (ADR-375's limits) or than its receive window. The dialog checks this against the connected controller before offering Frame, as Start would refuse it anyway;
- a line holds a byte the controller treats as a realtime command (`?`, `!`, `~`, Ctrl-X, or any byte at or above 0x80);
- a line is a `$` controller command (`$H`, `$X`, `$J=`, a `$` setting), also behind a `/` or spaces. GRBL runs those only while Idle and answers `error:8` mid-job, and the Frame cannot trace what they move. They belong in the Console.
- the file is not text (it holds a NUL byte);
- the Inspector cannot construct a finite motion envelope for the Frame to visit.

### The Frame

The program is read from where the head stands: the Inspector's parse starts at the head's current work position, so the first approach, relative moves and arcs are measured from the real start, not from the drawn origin. While the head moves, the program is read again from each new resting position; while framing, and while the resulting Frame holds, that start is pinned. Until a connected machine reports a position, the review reads from the work origin and Frame is unavailable.

The dialog's **Frame** traces the program's XY motion envelope at the current work origin with the tool off, using the ordinary Frame motion (queue, work-coordinate and report-unit preparation, completion settlement), and then returns to the start position, so Start begins exactly where the program was read from. The envelope covers rapid, linear and arc moves from that start, absolute and relative distance, millimetres and inches, in the active work coordinates.

A clean completion records a Frame for this exact program: its fingerprint, its envelope, the controller session, the trusted position and the work origin. Any Jog, Home, origin or probe change, reset, alarm, reconnect, or another Frame clears it, exactly as it clears an ordinary Frame. Start stays unavailable until that Frame completes.

### Review and Start

The **Run** dialog is the one review for the file: name, lines and bytes to send, estimated time, the envelope and its size, the units the program declares, and the machine mode it will run in. Findings are warnings that never refuse:

- moves in machine coordinates (`G53`), a work coordinate change away from `G54`, `G92`, `G28`/`G30`, or work-offset writes (`G10 L2`/`G10 L20`), which the Frame could not trace against the current work origin. Offset writes carry an explicit displacement warning; they do not add a refusal. Every command warning is found with the shared G-code word scanner, so `G+91`, `G91.0` or `G 91` cannot hide one, and `G28.1`/`G30.1` are told apart from a move to a stored position;
- relative moves (`G91`), read from where the head stands; Start runs them from that same spot;
- program stops (`M0`/`M1`), sent to the controller unchanged;
- a program that ends in inches (`G20`), which leaves the controller in inches until the next program sets `G21`; a program that switches back to `G21` is described as such instead;
- the laser or spindle still on at the end of the program (no `M5`);
- a program that looks like the other machine mode (spindle speeds above the laser's S range in Laser mode, or no Z motion in CNC mode);
- tool changes (`M6`), which stock GRBL does not support;
- zero XY extent: Frame visits a point rather than tracing an XY outline and does not prove Z clearance or cutting depth. An axis the program never sets runs where the head stands now;
- the Inspector's Program Health notices and warnings.

In CNC mode the existing workholding and exclusive-access attestation applies; in Laser mode the existing `$32` laser-mode acknowledgement applies when the controller reports `$32=0`. Confirming **Start** checks the Frame is still the current one for this exact program and that the head still stands at the program's start, consumes the Frame, and streams the program with the ordinary streamer. The final handoff, after controller preparation, checks the controller session, origin, head position and machine mode once more, because the Laser/CNC switch stays usable while Start arms. External M0/M1 pauses are sent unchanged to the controller; they are not intercepted as KerfDesk project bit changes. The controller then holds until the machine's own cycle start, which KerfDesk's Resume does not replace, so the review warns about them. The Live Motion bar's Pause, Resume and **ABORT JOB** work as for any job (non-negotiable 9).

### Not in this decision

- Running the same file again needs another Frame (one Frame, one run). Reusing the Frame across runs, as ADR-565 does for the project, can follow once the external run keeps ADR-565's evidence.
- Interrupted-job resume, the second pass and job history are project features; an interrupted external run reports where it stopped and offers no resume.
- The file is never edited, imported into the drawing or saved into the project.

## Consequences

- KerfDesk can be the sender for programs made in other CAM software, behind the same physical Frame as its own jobs.
- The canvas and project are untouched by an external run.
- The streamed bytes differ from the file only by the `G21G90` baseline line first, removed comments, spaces, tabs, `/` marks, tape markers and blank lines, and LF line endings: the line as GRBL itself collects it. The dialog always states those transformations.

## Verification

Unit tests cover program normalization (the baseline line, comments, `%`, blank lines, spaces inside words, `/` marks, slice-at-a-time input), each factual refusal, the envelope across absolute and relative moves, arcs and `G20`, each warning, the Frame record's invalidation by a changed program, moved head, changed origin or changed machine mode, the Frame's return to the program's start, and that Start streams exactly the normalized bytes once and refuses without a current Frame. A component test drives the dialog through Frame, review and Start against the store. No hardware qualification is claimed.

A point envelope is constructable by the ordinary Frame builder. Zero XY extent is therefore a warning, not an additional Start refusal (PROJECT.md non-negotiable 21). Completing that point Frame still satisfies the ordinary Frame requirement; it does not qualify physical Z motion.
