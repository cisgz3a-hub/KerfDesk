## ADR-630 - Run an external G-code file through Frame and Start

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-18 ("running external G-code files"). Amends PROJECT.md "Out of scope" and the LightBurn gap audit's "Running an external G-code file is out of scope" line. Keeps PROJECT.md non-negotiable 21 and ADR-565: a completed Frame remains the only ordinary Start gate.

## Context

KerfDesk opens `.nc`, `.gcode` and `.tap` files in the G-code Inspector and can only look at them. Router owners usually design in Fusion, VCarve or Carbide Create and need a program to *send* the result; that is how gSender, UGS and CNCjs win them, and LightBurn runs a G-code file too. A KerfDesk operator with a program from elsewhere has to close KerfDesk and open a different sender.

KerfDesk's Start contract fits this well: the Inspector already knows where the program moves, so the operator can Frame that outline over the real stock before anything cuts.

## Decision

### Where it starts

The G-code Inspector shows **Run on machine...** for a file the operator opened (not for the project's own program, which already has Frame and Start). The button is enabled while a controller that runs ordinary jobs is connected and Idle and no job is running; otherwise its tooltip says why. It opens the **Run G-code file** dialog for that file.

### What is sent

The program the controller receives is the opened file with comments (`(...)` and `;` to the end of the line), `%` tape markers, blank lines and surrounding ASCII spaces and tabs removed. Nothing else is changed: no line is added, reordered, rescaled or rewritten. The normalized bytes are parsed and timed again by the cancellable Inspector worker; the Run review, Frame envelope and Start all use that executable, rather than the original file's model. Removing a comment can join numeric fragments, so the original model is not interchangeable. The dialog shows the number of lines and bytes that will be sent, and the run streams exactly those bytes. Comments are removed because the controller would still receive them, they use buffer space, and characters such as `!`, `~` and `?` inside a comment are realtime commands to GRBL.

Factual refusals, because the program cannot be streamed as written (no policy refusal is added):

- no line is left to send;
- a line is longer than the connected controller accepts (ADR-375's limits) or than its receive window;
- a line holds a byte the controller treats as a realtime command (`?`, `!`, `~`, Ctrl-X, or any byte at or above 0x80);
- a line is a `$` controller command (`$H`, `$X`, `$J=`, a `$` setting). GRBL runs those only while Idle and answers `error:8` mid-job, and the Frame cannot trace what they move. They belong in the Console.
- the file is not text (it holds a NUL byte);
- the Inspector cannot construct a finite motion envelope for the Frame to visit.

### The Frame

The dialog's **Frame** traces the program's XY motion envelope at the current work origin with the tool off, using the ordinary Frame motion (queue, work-coordinate and report-unit preparation, completion settlement and return position). The envelope comes from the Inspector's reading of the program: rapid, linear and arc moves, absolute and relative distance, millimetres and inches, in the active work coordinates.

A clean completion records a Frame for this exact program: its fingerprint, its envelope, the controller session, the trusted position and the work origin. Any Jog, Home, origin or probe change, reset, alarm, reconnect, or another Frame clears it, exactly as it clears an ordinary Frame. Start stays unavailable until that Frame completes.

### Review and Start

The **Run** dialog is the one review for the file: name, lines and bytes to send, estimated time, the envelope and its size, the units the program declares, and the machine mode it will run in. Findings are warnings that never refuse:

- moves in machine coordinates (`G53`), a work coordinate change away from `G54`, `G92`, `G28`/`G30`, or work-offset writes (`G10 L2`/`G10 L20`), which the Frame could not trace against the current work origin. Offset writes carry an explicit displacement warning, including compact and padded numeric aliases; their bytes remain unchanged and they do not add a refusal;
- relative moves (`G91`): the Inspector reads them from the work origin, while the program really starts wherever the head is;
- a program in inches (`G20`), which also leaves the controller in inches until the next program sets `G21`;
- the laser or spindle still on at the end of the program (no `M5`);
- a program that looks like the other machine mode (spindle speeds above the laser's S range in Laser mode, or no Z motion in CNC mode);
- tool changes (`M6`), which stock GRBL does not support;
- zero XY extent: Frame visits a point rather than tracing an XY outline and does not prove Z clearance or cutting depth. When no X/Y position is declared, the Inspector assumes X0 Y0 while the real program keeps the current XY position;
- the Inspector's Program Health notices and warnings.

In CNC mode the existing workholding and exclusive-access attestation applies; in Laser mode the existing `$32` laser-mode acknowledgement applies when the controller reports `$32=0`. Confirming **Start** checks the Frame is still the current one for this exact program, consumes it, and streams the program with the ordinary streamer. External M0/M1 pauses are sent unchanged to the controller; they are not intercepted as KerfDesk project bit changes. The controller then holds until the machine's own cycle start, which KerfDesk's Resume does not replace, so the review warns about them. The Live Motion bar's Pause, Resume and **ABORT JOB** work as for any job (non-negotiable 9).

### Not in this decision

- Running the same file again needs another Frame (one Frame, one run). Reusing the Frame across runs, as ADR-565 does for the project, can follow once the external run keeps ADR-565's evidence.
- Interrupted-job resume, the second pass and job history are project features; an interrupted external run reports where it stopped and offers no resume.
- The file is never edited, imported into the drawing or saved into the project.

## Consequences

- KerfDesk can be the sender for programs made in other CAM software, behind the same physical Frame as its own jobs.
- The canvas and project are untouched by an external run.
- The streamed bytes differ from the file only by removed comments, tape markers, blank lines and surrounding ASCII spaces/tabs, with line endings normalized to LF. The dialog always states those transformations.

## Verification

Unit tests cover program normalization (comments, `%`, blank lines, spaces), each factual refusal, the envelope across absolute and relative moves, arcs and `G20`, each warning, the Frame record's invalidation by a changed program, moved head or changed origin, and that Start streams exactly the normalized bytes once and refuses without a current Frame. A component test drives the dialog through Frame, review and Start against the store. No hardware qualification is claimed.

A point envelope is constructable by the ordinary Frame builder. Zero XY extent is therefore a warning, not an additional Start refusal (PROJECT.md non-negotiable 21). Completing that point Frame still satisfies the ordinary Frame requirement; it does not qualify physical Z motion.
