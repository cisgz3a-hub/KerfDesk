## ADR-703 - Lihuiyu M2/M3 Nano (stock K40): .egv export and a USB link (2026-11-11)

**Status:** Accepted (maintainer request, 2026-11-11: build the laser controllers a competitor
scorecard found missing). Builds on ADR-702 (the shared USB link and CH341 bridge) and follows the
Ruida pattern of ADR-097 and ADR-697. Keeps PROJECT.md non-negotiable 21 and ADR-565 (frame-first
Start) unchanged. **Simulator-tested only; not qualified on a real board.** | **Date:** 2026-11-11

### Context

The stock K40 CO2 laser ships with a Lihuiyu M2 Nano (or M3 Nano) board. It speaks LHYMicro-GL, a
binary packet protocol, through a CH341 USB-to-parallel bridge; it has no serial G-code port, so
KerfDesk could not run a K40 at all. LightBurn supports it. The protocol has a permissively
licensed public reference: MeerK40t (MIT). K40 Whisperer and the balor plugin are GPL and were not
read.

### Primary sources

MeerK40t at `d511944e08788e88077727f682957759884ff5ca`, read for this decision (MIT; notice in
`docs/licensing/meerk40t-lihuiyu.txt`):

- `meerk40t/lihuiyu/laserspeed.py` L158-249 (`get_code_from_speed`): the speed code
  `CV<value:6><accel:1>[<step:3><diagonal:6>][C][W<power:3>]`, value = 65536 − (m·T + b) for the
  period T in ms of one 1/1000 in step; L367-401 the acceleration bands (25.4, 60, 127 mm/s);
  L404-418 suffix C below 7 mm/s on M2/M3/B2; L421-457 the b and m constants per board
  (M2/M3/M/M1 12120, B2 twice that, A/B/B1 2000, suffix C m/12 with b 8); L360-364 the two
  3-digit bytes. `test/test_laser_speeds.py` holds vendor-software codes MeerK40t matches within 1.
- `meerk40t/lihuiyu/driver.py` L41-108 (`lhymicro_distance`): 'z' = 255, three digits for 52-254,
  'a'..'y' for 1-25, '|a'..'|z' for 26-51. L157-163: B right, T left, L top, R bottom, M diagonal,
  D beam on, U beam off. L491-534 rapid and finished modes ("FNSE-", "@NSE", "I"); L608-672
  `program_mode` (speed code, "N", declared directions, "S1E"; twitchless suffix C by default);
  L674-696 home "IPP"; L318-361 pause and resume "PN", reset "I"; L479-489 the M3 PWM power packet
  "AT1" with value/254 and value%254; L1294-1304 rapid moves "I…S1P"; L1306-1346 program moves as
  Bresenham lines grouped into orthogonal and diagonal runs; L1469-1547 `_goto_xy` and
  `_goto_octent`, which write a direction letter only when the direction or engaged axis changes.
- `meerk40t/lihuiyu/controller.py` L22-32 the status codes (OK 206, BUSY 238, ERROR 207, FINISH
  236, M3-finished 204, low power 239); L82-142 the one-wire CRC-8 of the 30-byte payload;
  L644-835 `process_queue`: a payload is at most 30 bytes or up to a newline, padded with 'F'
  (0x00 for "AT"), sent as 0x00 + payload + CRC, confirmed by reading status until OK (BUSY waits,
  ERROR resends, FINISH is no confirmation); L855-904 `wait_until_accepting_packets` and
  `wait_finished` (status bit 1 clear).
- `meerk40t/lihuiyu/parser.py` L128-427: the board's state diagram (compact program mode, the
  finished state that ignores everything until 'I', two P's in one packet home).
- `meerk40t/lihuiyu/device.py` L900-919: the `.egv` header ("Document type : LHYMICRO-GL file" …
  "%0%0%0%0%"); board list M2, M3, B2, M, M1, A, B, B1; M3 PWM needs firmware 2024.01.18g; default
  bed 310 × 210 mm, `max_vector_speed` 140 mm/s, `power_scale` 30 %.
- `meerk40t/ch341/libusb.py` and `mock.py`: EPP data 0xA6, status 0xA0 then six bytes in, status
  `[255, code, 0, 0, 0, 1]`.

### Decision

1. **A new controller kind, file-only for the line store.** `ControllerKind` gains `'lihuiyu'`
   (`KNOWN_CONTROLLER_KINDS`, `select-controller-driver.ts`). `lihuiyuDriver` has
   `transport: 'file-only'`, so the line-based store's Connect, jog, console and Start stay off,
   as for Ruida. It declares `fileFormat: 'egv'` (Save routes on it, not on the kind, ADR-094) and
   `usbLink: LIHUIYU_USB_CAPABILITIES`. An optional `DeviceProfile.lihuiyuBoard` (absent = M2)
   picks the speed-code equations; `'M3-pwm'` is an M3 with PWM firmware. Two catalog profiles:
   K40 300 × 200 with an M2 Nano and with an M3 Nano (PWM, Full-power S 300 per mille).

2. **The encoder** (`src/core/controllers/lihuiyu/`) writes LHYMicro-GL from the prepared job
   (`prepareOutput`, preview = save), in 1/1000 in steps rounded from each job point (never
   accumulated). The stream starts where the head stands — machine zero after Home for an Absolute
   job, the job's zero otherwise — and ends with a rapid move back there, so the head finishes
   where it started and a Frame stays true for the next run. Line groups travel between segments
   in rapid mode; Fill and Image groups cross their gaps in program mode with the beam off. Image
   rows run as program-mode sweeps from the first to the last lit pixel, alternating direction;
   MeerK40t's native raster mode (V…G step codes) is not written yet, scanned images at an angle
   are refused, and pixels burn on or off (no shading). Layers at 0 % are left out. On an M3 with
   PWM, each layer's power is an "AT1" packet; a low byte of 10 would read as a newline, so it
   becomes 11. The machine origin must be rear-left (the board homes there); any other is refused
   with that reason. CNC jobs are refused.

3. **`.egv` export** (`src/io/egv`, Save as `.egv`): MeerK40t's header and the command stream, with
   the same post-compile checks a G-code save runs (bed bounds, no-go zones) as advisories. It needs
   no driver or USB, so it works on the web. Advisories, never refusals: an M2 cannot set power
   (the knob does), so layers below 100 % burn at the knob's power; 0 % layers are left out.

4. **The USB link** (`lhy-link.ts`) is `process_queue` over ADR-702's `Ch341Epp`: wait for OK
   unless the last packet was confirmed, write, read until OK; BUSY waits, ERROR resends (five
   times, then the run fails), a '-' in the stream waits for the board's finish. Each USB exchange
   runs alone, but the waits release the link between reads so a realtime packet can go out while a
   job packet waits. Realtime packets ("PN" pause/resume, "I" reset) do not wait for room, because a
   paused board with a full buffer never makes any.

5. **A separate store** (`src/ui/state/lihuiyu-usb/`) offers only what MeerK40t documents: Home,
   relative jog (rapid moves), Frame, Start, Pause, Resume, Abort and the status byte. Frame is a
   stream of its own: the job's burn bounds traced in program mode with no 'D' anywhere, at the
   profile's framing speed, ending with "FNSE-" so the board's finish says when it is done. Start
   runs only the footprint (burn bounds and start point) the last completed Frame on this connection
   traced — non-negotiable 21 and ADR-565 unchanged. A board that reports BUSY, or no status, is
   sent nothing. Pause holds the stream, then sends "PN"; Resume sends "PN", then releases it.
   Abort stops sending, lets the packet in flight finish, and sends "I". The board reports no
   position, so the store tracks the head from Home, jogs and jobs; an Absolute job needs a Home on
   this connection, and Abort, a failed run, Home or a jog forget the Frame (and Abort the head).
   Current Position placement needs a live position and is refused on the link with that reason.
   The panel body loads lazily; the encoder, link and `.egv` writer stay out of the boot bundle
   (`vite.config.ts`).

### Evidence

- `lhy-protocol.test.ts`: speed codes against MeerK40t's vendor table rows (M2, B2, M1, A, M) and
  its `.egv` rectangle code `CV2490731016000027C`; the CRC-8/MAXIM check value; payload cutting and
  padding; the decoder reads MeerK40t's golden `.egv` rectangle to the expected square.
- `lhy-encoder.test.ts`: a golden stream for a 10 mm square, decoded to the four burns with every
  travel dark and the head back at its start; diagonals within one step of the true line; image
  rows; AT1 powers; refusals; determinism; the Frame decodes with the beam never on.
- `emit-egv.test.ts`: a project through `prepareOutput` to an `.egv` file, read back to the square.
- `lihuiyu-usb-store.test.ts`: the real store against `lihuiyu-simulator.ts` (a simulated M2 Nano
  behind a USB session: EPP framing, CRC check, a small buffer, FINISH after the program ends):
  Home and Frame-first refusals; Frame with the beam off, then Start to the board's finish; Start →
  Pause → Resume → Abort; jog; checksum resend; a pulled cable.

None of this is evidence that a real Lihuiyu board accepts these packets or burns these jobs.

### Consequences

- KerfDesk can export `.egv` files for a K40 anywhere and, where the platform has a USB link,
  frame, start, pause, resume and stop a job on the board — labelled experimental and not qualified
  in the panel, `PROJECT.md`, the README and the profiles.
- Hardware qualification is owed: confirm the status codes while running and paused, that "PN"
  pauses and resumes and "I" stops, the speed calibration, and that the Frame traces where the job
  burns, on a stock K40.
- Not built: native raster mode, MeerK40t's PPI power emulation on the M2, a board picker in
  Machine Setup (the board comes from the profile), the M3 serial-number challenge, and running
  Image layers at an angle.
