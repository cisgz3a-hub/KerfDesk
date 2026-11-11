## ADR-704 - JCZ LMC galvo lasers over USB (2026-11-11)

**Status:** Accepted. Builds on ADR-702 (the shared USB link) and follows the Ruida pattern of
ADR-697 (a separate link and store beside the line store). ADR-702 moved EZCad2 galvo boards into
scope; this ADR is `PROJECT.md` Phase I item I.8. Keeps PROJECT.md non-negotiable 21
and ADR-565 (frame-first Start) unchanged. Takes project schema 24. **Simulator-tested only; not
qualified on hardware.** | **Date:** 2026-11-11

### Context

A competitor scorecard rated KerfDesk's laser-controller coverage 7/10 against LightBurn's 10, and
the maintainer asked for the missing controllers to be built. Fiber, MOPA, UV and CO2 galvo
markers mostly run a JCZ "LMC" board (the EZCad2 class). Its protocol has one permissively
licensed public reference: MeerK40t's `balormk` module (MIT). Its README says the module was
rewritten from scratch rather than from the GPL Balor code. This ADR reimplements that reference
in TypeScript. No GPL Balor code was read. EZCad3 (DLC) boards have no public protocol and are not
built.

A galvo is not a gantry. Two mirrors steer the beam across a lens field, addressed 0..0xFFFF, and
the board runs lists of binary commands it receives over USB bulk transfers. The line store speaks
G-code, so it cannot drive a galvo, just as it cannot drive a Ruida.

### Primary sources

meerk40t at `d511944e08788e88077727f682957759884ff5ca` (`meerk40t/balormk/` and `core/view.py`),
read for this decision:

- `usb_connection.py` L13-17: vendor 0x9588, product 0x9899, bulk OUT 0x02, IN 0x88.
  L272-274: a packet is 0xC (one command) or 0xC00 (a list) bytes. L297-301: a reply is 8 bytes.
- `controller.py` L23-24: an empty list is 256 copies of `02 80 00…` (End of List), the filler of
  an unused slot. L26-112: list opcodes (0x8001 Jump To … 0x8051 Ready Mark) and single commands
  (0x0002 … 0x0062). L206-208: status bits Busy 0x04, Ready 0x20, Axis 0x40 in reply word 3.
  L421-441: `send` writes and, unless told not to, reads 8 bytes as four uint16. L443-445:
  `status()` is word 3 of Get Version. L464-481: `rapid_mode` ends a program: End of List, the
  last list, Execute List if not yet, wait while Busy, close the master oscillator (MO), port bit 0
  off. L486-532: `program_mode` opens one: Reset List, port bit 0 on, MO open (fiber), Ready Mark,
  the fiber open-MO dwell (`delay_openmo × 100`), Write Port, Jump Speed. L534-561: `light_mode`
  opens a red-light program with port bit 0 off and the light bit on. L567-587: each list waits for
  Ready, is sent with no reply read, is followed by Set End Of List 0, and Execute List follows the
  third list. L594-617: commands are packed `<6H` into the list. L643-708: `set_settings` order.
  L714-756: mark/goto/light/dark skip a move to the current position. L821-851: `abort` (Stop
  Execute, MO closed, Reset List, one empty list, port off), `pause` (Stop List), `resume`
  (Restart List). L853-935: `init_laser` order and parameters, including the fourth FPK word
  repeating the third (L869). L937-989: power (fiber 12-bit current; CO2/UV ratio 200 × % / kHz),
  frequency (fiber period 20000 / kHz, CO2/UV 10000 / kHz), CO2/UV first-pulse killer
  2000 / kHz. L1020-1050: speed is galvo units per ms; frequency to period; power to current.
  L1056-1141: `.cor` files: a UTF-16 label, then a float64 table (`LMC1COR_1.0`, after 0x1FA header
  bytes) or an int32 table (after 0xE), 65 × 65 (dx, dy) pairs, negatives as magnitude + 0x8000,
  sent as Write Cor Table 1 and one Write Cor Line per pair, the third word 0 then 1, with no reply
  read. L1147-1206: jump/mark carry angle 0 and the distance word. L1208-1300: speeds and delays,
  delays as magnitude plus a sign word, the polygon delay in 10 µs units. L1496-1514: Get List
  Status word 3 bit 2 running, bit 3 paused.
- `driver.py` L379-430 (`plot_start`): settings per cut, then goto/mark. L598: the end dwell
  `delay_end / 10`. L315, L525: the beam parks at 0x8000, 0x8000. L764-786: pause/resume call the
  controller's Stop List / Restart List.
- `livelightjob.py` L183-197, L218-267: the red-light trace jumps at the red-light speed with the
  light bit switched by Write Port and never marks.
- `device.py` L143-146 (lens 110 mm), L183-213 (flip X false, flip Y true, swap XY true), L345-347
  (light pin 8), L453-475 (red-light speed 3000, delays 1), L573-597 (30 kHz, 2000 mm/s jump),
  L607-640 (MOPA pulse widths), L653-703 (laser on/off/polygon 100 µs, end 300 µs), L753-755
  (open MO 8 ms), L768-950 (init parameters), L1133-1160 (`realize`: field → 0..0xFFFF, flips,
  swap).
- `core/view.py` L119-130, L244-293: the field maps 0..L to 0..0xFFFF, then flip X, flip Y, swap.

### Decision

1. **The bed is the lens field.** A `'jcz-lmc'` profile's bed is square, `bedWidth` =
   `bedHeight` = the field size, with origin `'center'`, the lens centre, as EZCad and LightBurn
   number a galvo field. A machine point maps back to the scene frame with the profile's own
   origin, scales so the field spans 0..0xFFFF, then takes MeerK40t's flip X, flip Y and swap in
   that order (`galvo-field.ts`). A setup copied from MeerK40t therefore maps the same way. Rotate
   is not offered: flips and the swap already give all eight orientations. Built-in profiles cover
   110, 150 and 200 mm fiber lenses with MeerK40t's defaults. The bounds and Job Review checks see
   an ordinary square bed.

2. **Absolute placement only.** A galvo has no head position and no controller-held origin, so
   User Origin, Verified Origin and Current Position are refused, with the reason, at Frame and
   Start. Absolute marks the artwork where it sits in the field.

3. **The program is MeerK40t's.** `encodeLmcJob` takes the prepared machine-space Job (preview =
   output) and writes Ready Mark, the fiber open-MO dwell, port bit 0, the jump speed, then per
   layer the settings in `set_settings` order, writing each word only when it changes, then each
   pass of each segment as a jump and marks, then the end dwell and End of List. Line groups and
   Fill hatch groups are vectors and encode directly. A galvo has no inertia, so hatch scanlines are
   marked as the burn spans they are, with no overscan. Image rasters, CNC groups, a rotary, a point
   outside the field and a speed the board's word cannot carry are refused as factual failures. A
   CO2/UV power word is rewritten when only the frequency changes, unlike MeerK40t, because the
   ratio depends on the frequency.

4. **Galvo layer settings, schema 24.** An operation may set `galvoFrequencyKhz` and
   `galvoPulseWidthNs` (MOPA). Absent means the galvo setup's default. Every other controller
   ignores them, so G-code and `.rd` output are byte-identical. The machine carries a `galvo` setup:
   source (fiber, MOPA, UV, CO2), flips/swap, default frequency and pulse width, jump speed, laser
   on/off/polygon/end delays, open-MO delay, red-light speed and output bit. Schema 24 makes an
   older build refuse such a project. It would otherwise drop the unknown controller kind and treat
   the galvo as a GRBL machine. A malformed galvo setup is dropped on load, and the link then refuses
   to mark until the machine is set up again. A galvo field outside what the board can carry
   refuses the file.

5. **A separate USB link and store.** The driver stays `transport: 'file-only'` for the line store,
   with a separate `galvoUsb` capability object (`JCZ_GALVO_USB_CAPABILITIES`). The galvo store
   (`ui/state/jcz-usb/`) drives ADR-702's `UsbLinkSession` through `LmcLink`: one exchange at a
   time; a reply deadline of 2 s; Write Cor Line and list packets unread, as MeerK40t sends them.
   Connect shows the browser's or desktop's device chooser for 9588:9899 and runs `init_laser` with
   MeerK40t's defaults, sending the optional `.cor` table chosen for that connection. The table
   belongs to the physical lens, not to a project carried to another machine, so it is not saved.
   Save refuses a galvo project: there is no job file.

6. **Frame is the red pointer; Start needs it.** The Frame is a list program in light mode: port
   bit 0 off, the light bit switched by Write Port, jumps only, at the red-light speed. It holds no
   Mark, no Laser On Point and no power, frequency or pulse word. MeerK40t loops its trace until
   stopped. This build writes about 5 s of loops, so the Frame ends on its own and can gate Start.
   A Frame counts as completed only after its Execute List was acknowledged and the board then
   reported not Busy, with its list not running, on two polls in a row. Start runs only a program
   whose galvo-unit footprint equals the last completed Frame's (non-negotiable 21, ADR-565). Its
   advisories are warnings. A board that reports Busy, or does not answer, is sent nothing.

7. **Only what MeerK40t documents.** Start (lists with Ready flow control, Execute List), Pause
   (Stop List), Resume (Restart List), Abort (MeerK40t's abort) and status (Get List Status, plus
   Get Version's Busy bit for completion). A run that fails part-way gets the abort sequence at
   once. A lost link says a held program may keep running. Jog, home, console, settings, origin and
   overrides stay off.

8. **Unchanged.** Job Review, the line store's frame-first Start, every G-code and `.rd` byte, and
   the boot bundle apart from the driver, the setup model and the two form groups. The encoder,
   link, store and panel body load lazily.

### Evidence

- `lmc-encoder.test.ts`: golden decoded programs (opening, settings words, jump/mark coordinates
  and distance words, end dwell) for a fiber square; passes; per-layer frequency; MOPA and CO2
  words; Fill hatch; refusals; determinism; multi-list spill.
- `lmc-frame-job.test.ts`: the Frame contains no Mark, no Laser On Point, no laser word, never port
  bit 0, and only footprint corners.
- `lmc-packets.test.ts`: packet bytes, list filler, replies, half-even rounding, both `.cor`
  layouts.
- `galvo-usb-store.test.ts` drives the real store over `src/__fixtures__/controllers/jcz-lmc-simulator.ts`,
  a scripted board behind the USB transfer calls. Connect runs `init_laser`, and a `.cor` sends
  4225 lines. Start is refused before a Frame and after the job moves. The Frame never raises bit 0
  or opens the MO. Start's program decodes on the board to the job's marks and closes its outputs.
  Status reads Get List Status. Pause/Resume send Stop/Restart List. Abort sends Stop Execute.
  Unplugging says a held program may keep running.
- `project-galvo.test.ts`: schema 24 round trip, schema 23 migration, invalid fields.

None of this is evidence that a real JCZ board accepts these packets, marks where the field
mapping says, or fires at the power the words ask for.

### Consequences

- KerfDesk can mark on a JCZ fiber/MOPA/UV/CO2 galvo over USB where the platform offers ADR-702's
  link, labelled experimental and not qualified in the panel, `PROJECT.md` and the README.
- Real-board qualification is owed and is the first galvo follow-up. It should confirm the init
  sequence, the Ready/Busy bits during a run, the field orientation against the red pointer, and
  power and frequency on a test grid. On Windows the board may need the WinUSB driver (Zadig), as
  for MeerK40t.
- Image rasters on a galvo (MeerK40t marks them dot by dot) are not built. Neither are rotary, a
  continuous red-light preview, EZCad3 (DLC) boards, or a red-pointer offset.
