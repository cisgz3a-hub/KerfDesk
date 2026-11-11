## ADR-702 - USB laser link for K40 and galvo boards (2026-11-11)

**Status:** Accepted. Revises the `PROJECT.md` line "Trocen/TopWisdom/galvo stay out of scope" and
the out-of-scope list's Trocen/TopWisdom entry. Foundation for ADR-703 (Lihuiyu M2/M3 Nano),
ADR-704 (JCZ LMC galvo) and ADR-705 (Moshiboard). Keeps `PROJECT.md` non-negotiable 21 and ADR-565
(frame-first Start), ADR-366 (only the picked device is granted) and the Job Review rules unchanged.
**Simulator-tested only; no board has been driven by this link.** | **Date:** 2026-11-11

### Context

A competitor scorecard rated KerfDesk's laser-controller coverage 7/10 against LightBurn's 10.
LightBurn 2.1 lists DSP controllers (Ruida, Trocen, TopWisdom), galvo controllers (EZCAD2, EZCAD2
Lite, EZCAD3, BSL) and G-code controllers. MeerK40t, the open-source K40 program, also drives the
stock K40 boards (Lihuiyu M2/M3 Nano) and Moshiboards. The maintainer asked for the controllers to be
researched and built.

None of these boards is a serial port. The K40 boards put a CH341 USB bridge in EPP 1.9 parallel
mode in front of their processor, and the JCZ LMC galvo boards speak bulk USB packets. Web Serial
cannot reach either. WebUSB can: Chromium browsers and Electron's window both have it.

### Research: which controllers have a public protocol source

| Controller | Public source | Decision |
| --- | --- | --- |
| Lihuiyu M2/M3 Nano (stock K40) | MeerK40t `lihuiyu/`, `ch341/` (MIT) | Build, ADR-703 |
| JCZ LMC / EZCad2 galvo | MeerK40t `balormk/` (MIT; its README says it was rewritten from scratch, not from the GPL balor code) | Build, ADR-704 |
| Moshiboard | MeerK40t `moshi/` (MIT) | Build, ADR-705 |
| Trocen AWC608/708 | None found: no spec, code or capture; the vendor manual covers only LaserCAD | Out of scope |
| TopWisdom TL-410C | None published; one 2019 LightBurn forum thread reports private, unpublished work | Out of scope |
| EZCad3 (DLC2), BSL galvo | None public; a different protocol from EZCad2 | Out of scope |

Building a controller without a source would mean sending guessed bytes to a laser. The out-of-scope
four stay out until a public source exists or the maintainer supplies a USB or network capture from
the vendor software.

GPL sources are not read: the `balor-meerk40t` plugin (GPL-3.0), Bryce Schroeder's balor and K40
Whisperer. MeerK40t is MIT; its protocol facts are reimplemented here in TypeScript and cited by
file and line, as ADR-697 did for Ruida.

### Primary sources

meerk40t at `d511944e08788e88077727f682957759884ff5ca`:

- `meerk40t/ch341/libusb.py`:
  - L6-9: CH341A VID 0x1A86 / PID 0x5512, bulk OUT 0x02, bulk IN 0x82.
  - L12-27: the parallel command bytes, including A0 status, A6/A7 data/address write, 0xB1 parallel
    init, 0x5F version and 0x52 status.
  - L264-288 (`CH341InitParallel`): vendor OUT 0xB1, value `mode << 8 | 2`, for EPP 1.9 mode 1.
  - L317-336 (`CH341GetStatusControlTransfer`): vendor IN 0x52, eight bytes.
  - L338-365 (`CH341GetStatusBulk`): bulk A0, then a six-byte read.
  - L367-386 (`CH341GetVerIC`): vendor IN 0x5F, two bytes, little-endian.
  - L425-446 (`CH341EppWrite`): an A6 (data) or A7 (address) byte before every 31 data bytes.
- `meerk40t/lihuiyu/controller.py` L247 (`bulk=True`) and `meerk40t/moshi/controller.py` L283
  (`bulk=False`): which status read each board family uses. In both, the status code is byte 1.
- `meerk40t/balormk/usb_connection.py` L13-17: JCZ LMC VID 0x9588 / PID 0x9899, bulk OUT 0x02,
  bulk IN 0x88.
- LightBurn's galvo driver guide (docs.lightburnsoftware.com/2.1/Guides/GalvoDriverInstallation):
  on Windows the board's EZCad driver is replaced, by LightBurn's installer or by Zadig with WinUSB;
  "macOS users do not need to install a driver"; uninstalling the device and deleting its driver
  restores EZCad.

### Decision

1. **One USB link for every USB laser.** `PlatformAdapter.usbLink` (`src/platform/usb-link-types.ts`)
   opens a device through WebUSB (`src/platform/web/web-usb-link.ts`). `request` shows the chooser,
   limited to the families' USB ids. `reopen` opens a device already granted. The session shape
   (`UsbLinkSession`, `src/core/controllers/usb/usb-link-session.ts`) lives in core, so the
   controller drivers use it without importing platform code. A session claims interface 0 of
   configuration 1, as MeerK40t does. It passes control and bulk transfers through, and rejects any
   transfer status but `ok`. It never retries: a resent packet could run the same laser commands
   twice.

2. **The CH341 bridge is shared.** `src/core/controllers/usb/ch341-epp.ts` sets EPP 1.9, reads the
   chip version, and frames data and address writes. It reads status by bulk (Lihuiyu) or by control
   transfer (Moshiboard). Its framing puts the command byte before every 31-byte packet. That is the
   same bytes as MeerK40t's loop for every write up to 62 bytes. Past that, MeerK40t's loop would
   leave a 32-byte packet without its prefix; this one never does.

3. **Which devices can be opened.** The known boards are listed once in core
   (`src/core/controllers/usb/laser-usb-devices.ts`) and mirrored for the desktop main process
   (`electron/laser-usb-devices.ts`), with a test holding the two equal. In the browser, Chrome's own
   chooser shows only those ids. On the desktop, main answers `select-usb-device` itself
   (`electron/desktop-usb-devices.ts`). It offers only the known boards, says so when none is
   attached, and grants exactly the picked device to the trusted page for this run. A revoke drops
   the grant. Picks are not remembered across restarts. The `usb` permission is allowed for the
   trusted page only (`trusted-renderer-policy.ts`).

4. **One device permission handler.** Electron keeps one device handler per session, and once set
   it decides every device check. Serial (ADR-366, ADR-552) and USB therefore each register their
   decision with `electron/device-permission-router.ts`, and an unregistered device type is denied.
   USB registers only on Windows, macOS and Linux, where serial already sets the handler, so
   Electron's default handling is unchanged wherever serial leaves it.

5. **Drivers are the operator's step, explained in the app.** On Windows, WebUSB needs the WinUSB
   driver. That is the same swap K40 Whisperer requires and LightBurn's legacy galvo setup uses. An
   open that the system refuses is reported as `driver`, with that instruction. Connection help and
   `docs/connection-troubleshooting.md` give the Zadig steps, the way back to LaserDRW or EZCad, the
   Linux udev rule and macOS's no-driver case. A claim refused because another program holds the
   board is reported as `busy`. The `.deb` does not install a udev rule; the help gives it.

6. **Each family keeps its own driver and store.** ADR-703, -704 and -705 build their encoders,
   simulators and live stores on this link, on the Ruida pattern (ADR-697). The line-based
   controller store still sees each of them as `transport: 'file-only'`. Every live path is labelled
   experimental and simulator-tested only.

### Consequences

- Chrome and Edge users, and desktop users, can reach K40 and EZCad2 galvo boards once the family
  ADRs land. Firefox and Safari have no WebUSB; the families' file exports remain where they exist.
- Windows users must swap the board's driver, which stops LaserDRW or EZCad from seeing it until
  they swap back. The help says so before they do it.
- The scorecard's controller coverage can rise only as far as simulator evidence allows. Real-board
  validation of each family is owed (`PROJECT.md`, Anything past Phase F).
- Trocen, TopWisdom, EZCad3 and BSL stay unsupported, and the reason is recorded.

### Verification

- `src/core/controllers/usb/ch341-epp.test.ts`: framing, compared byte for byte with MeerK40t's
  loop for lengths 1 to 62; mode set; version read; both status reads.
- `src/platform/web/web-usb-link.test.ts`: chooser filters, cancel, reopen, claim, error mapping
  (`driver`, `busy`, `gone`), transfer status, disconnect and forget.
- `electron/desktop-usb-devices.test.ts`: the list mirror, labels, the chooser offering only
  lasers, the per-run grant, revoke, and sharing the handler with serial.
- `src/__fixtures__/usb/fake-usb-device.ts`: a scripted session the family ADRs drive their
  simulators through.
