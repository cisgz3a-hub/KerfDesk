## ADR-705 - Moshiboard over a CH341 USB link (2026-11-11)

**Status:** Accepted. Builds on ADR-702 (the shared USB link and CH341 EPP driver). Follows the
pattern of ADR-697 (a controller outside the line-based store, with its own link and store). Keeps
PROJECT.md non-negotiable 21 and ADR-565 (frame-first Start) unchanged. **Simulator-tested only;
not qualified on hardware.** | **Date:** 2026-11-11

### Context

A competitor scorecard rated KerfDesk's laser-controller coverage 7/10 against LightBurn's 10. The
maintainer asked for the missing controllers to be researched and built where a public protocol
reference allows it. Moshiboards (MS10105 "V.4.XX", older Chinese CO2 machines) have one:
MeerK40t's Moshi module, MIT-licensed, reverse-engineered from a donated board. A Moshiboard
speaks swizzled binary programs through a CH341 USB bridge in EPP mode. It has no G-code, no
serial console, no settings, no power value and no job storage.

### Primary sources

MeerK40t at `d511944e08788e88077727f682957759884ff5ca` (`meerk40t/moshi/`, `meerk40t/ch341/`),
read for this decision and reimplemented in TypeScript (no source copied; the MIT notice ships in
`docs/licensing/meerk40t-moshi.txt`):

- `builder.py` L9-298: the 16 x 16 swizzle table; L300-317: command numbers (Set Offset 0,
  Termination 2, Move Vertical 3, Raster Speed 4, Vector Speed 5, Move Horizontal 6, Move Absolute 7,
  Cut Vertical 11, Cut Horizontal 14, Cut Absolute 15; realtime Estop/Free Motor 1, Epilogue 2,
  Prologue 6). L755-788: `_swizzle`, `convert` (two bit permutations by parity) and `reconvert`.
  `moshi-swizzle.test.ts` checks every table entry against KerfDesk's computed inverse.
- `builder.py` L376-412: vector speed (mm/s, 1..256, byte - 1, then the travel speed) and raster
  speed (cm/s, rounded); L414-429: Set Offset (an always-zero int16, then absolute x, y);
  L431-442: seven termination bytes; L444-553: moves and cuts relative to the offset as int16
  little-endian, negatives clamped to 0 for the absolute forms; L555-683 `debug`: each command's
  length, which the decoder follows.
- `controller.py` L35-38: status codes 205 OK, 207 processing, 237 error, 239 reset; L277-284: the
  Moshi CH341 opens with `bulk=False`, so the status is `ch341/libusb.py`
  `CH341GetStatusControlTransfer` L317-335 (vendor read 0x52, 8 bytes) and the code is byte 1
  (L780, L823). L597-695 `_thread_data_send`: wait for OK, prologue address write, data in
  32-byte packets with no status between them (L697-734), a status read, the epilogue address
  write, then `wait_finished` L793-838 (poll every 0.5 s until OK). L381-402 `realtime`: the estop
  goes out at once as an address write and every queued program is dropped.
- `driver.py` L717-762: a program opens with its speed, Set Offset at the first position and a
  move there; L304-313: a speed change ends a program; L481-493 `home`: a program moving to 0,0 at
  40 mm/s ("merely a move to 0,0"); L521-539 `finished_mode`: a raster program is followed by
  that home; L817-845 `_goto_absolute`: in raster mode only horizontal or vertical steps are
  written; L736: the travel speed equals the cut speed; L200-220: no laser on/off in place.
- `device.py` L332: native units are mils (`View(..., dpi=1000.0)`); L74-99: bed 330 x 210 mm by
  default; L436-452 `save_job`: MeerK40t's raw program dump, a debugging aid, not a format a
  Moshiboard or its vendor software reads; L533-545: diagonal, spiral and greedy rasters are
  unsupported. `controller.py` L425-441: `pause` only stops sending further programs.

### Decision

1. **A separate link and store, as for Ruida.** `ControllerKind` gains `'moshi'`. The driver is
   `transport: 'file-only'` for the line-based store, so its Connect, jog, console and Start stay
   off, and it lists the optional `usbLink` capabilities ADR-703 adds (`MOSHI_USB_CAPABILITIES`). The
   Moshi USB store (`ui/state/moshi-usb/`) drives `core/controllers/moshi/moshi-link-session.ts`
   over the shared CH341 EPP driver (ADR-702), opened with `openCh341Epp(session, { status:
   'control' })` — MeerK40t's `bulk=False` status read for a Moshiboard. The panel mounts only
   when the platform has the USB link (Chromium browsers and the desktop app) and the driver lists
   `usbLink`; because the Lihuiyu driver (ADR-703) lists it too and has its own panel, the
   driver's `kind` picks the Moshi panel. It loads lazily: the encoder, run loop and store stay
   out of the boot bundle (`vite.config.ts` `LAZY_CONTROLLER_LINKS`). Connect shows the device
   chooser every time instead of reopening a granted device: a Lihuiyu board has the same CH341
   chip, so a silent reopen could pick the wrong machine. A device Windows has not given WinUSB
   says so and points to Help → "Can't connect?".

2. **Only what MeerK40t documents.** Frame, Start, Abort (estop), Home (MeerK40t's move to 0,0)
   and the status byte. Pause and Resume stay off: MeerK40t's hold only stops sending the next
   program while the board finishes the one it holds, which is not a pause. Jog, console,
   settings, origin and overrides stay off.

3. **Programs.** Each Line or Fill group is one vector program at the group speed (travel at the
   same speed, as MeerK40t). Fill scan lines burn between laser-off runways of the group's
   overscan. Each Image group is one raster program (horizontal cuts across dark pixels,
   horizontal moves across light ones, a vertical move between rows, bidirectional unless the
   layer says otherwise) followed by MeerK40t's home program. Passes repeat inside the program.
   Coordinates are absolute mils from the home corner; a position below 0 or above 32767 mils
   (832 mm) is refused rather than clamped, and a scan angle is refused (horizontal rasters only).
   A CNC job is refused.

4. **No power value.** A Moshiboard fires at the power set on the machine. A layer above 0 % cuts;
   a 0 % layer keeps its path as laser-off moves, so nothing fires where none was asked. An image
   with more than one burning level gets a Job warning that grey pixels burn as black (dither for
   shading). Speeds above the 256 mm/s vector byte are written at 256 with a warning.

5. **Frame-first Start, unchanged.** The Frame is a vector program of laser-off moves around the
   job's footprint (the union of every planned move) at the profile's framing feed. Start runs
   only when the last Frame completed on this connection traced the same footprint. A Frame counts
   as completed when the board reports OK after the epilogue, which is MeerK40t's own end of a
   program. Abort clears the Frame: the head stopped somewhere along its path. Job warnings come
   from the same `runPreflight` a G-code save runs over the planned moves and never refuse.

6. **Factual refusals only.** A board that answers 237 before a program, or no status (0), is sent
   nothing. A link that fails mid-run stops the run and says a program the board holds may keep
   running. Placement is absolute: a Moshi program has no relative origin and the board does not
   report its head position, so other Start From choices are refused with that reason.

7. **No file export.** No public Moshi file format exists; MeerK40t's `save_job` dump is not one.
   Save G-code on a Moshi profile says to run the job from Machine details instead.

### Evidence

- `moshi-swizzle.test.ts`: all 256 swizzle-table entries and the permutation's inverse.
- `moshi-job-encoder.test.ts`: golden bytes derived by hand from MeerK40t's builder for a
  two-pass line; programs decoded back to moves and laser states for Line, Fill (runways), Image
  (bidirectional rows, horizontal cuts, then home); refusals; determinism.
- `moshi-link-session.test.ts` against `src/__fixtures__/controllers/moshi-simulator.ts`, a
  scripted board that answers status, collects data between prologue and epilogue, decodes and
  runs each program and takes the estop: MeerK40t's send order, a laser-off Frame, refusals on
  237 and on a dead status, cancellation between packets, a failed transfer.
- `moshi-usb-store.test.ts` drives the real store over the same board: Start refused without a
  Frame and after the job moves; Start sends exactly the encoded programs; Abort mid-run sends the
  estop, no data after it, and voids the Frame; an error status sends nothing; a lost link warns
  that a held program may run on; Home.
- `moshi-usb-store.usb.test.ts` runs the same store end to end through the ADR-702 foundation:
  the real opener and CH341 EPP driver (A6/A7 framing, vendor 0x52 status, never bulk A0) over
  the fake USB device, with the board behind `moshi-usb-simulator.ts`: Frame then Start, Abort
  mid-run with the estop on the wire and no data after it, an unplug, and the open failures.
- `MoshiUsbPanel.test.tsx`: the panel is absent without the USB link and for other controllers,
  and through its buttons frames first, then runs the project's own programs.

None of this is evidence that a real Moshiboard accepts these bytes.

### Consequences

- KerfDesk can frame, run, home and stop a Moshiboard over USB, labelled experimental and not
  qualified in the panel, the profile, `PROJECT.md` (I.9) and the README.
- Hardware validation is owed: that a board runs these programs, that its status reads 207 while
  it runs and 205 after, that the estop stops it, and that the Frame traces where the job burns.
- The generic profile uses MeerK40t's 330 x 210 mm default bed with a rear-left (top-left) home;
  owners set their own bed size.
- Trocen, TopWisdom, EZCad3 and BSL remain unbuilt: no public protocol source exists.
