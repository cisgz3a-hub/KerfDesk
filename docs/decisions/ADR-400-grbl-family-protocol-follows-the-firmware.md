## ADR-400 - GRBL-family controllers: KerfDesk follows the firmware's own protocol, not a generic one (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends the GRBL, grblHAL, FluidNC and Falcon parts of ADR-094 (drivers), ADR-361 (controller
audit batch 1) and ADR-367 (fix offers), and the connection lifecycle of the transport ADRs. The
Frame-first Start contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232, 237 and 372) is
unchanged: the only new waits are live handoff facts, and nothing here adds a Start guard.

### Context

Controller audit 2026-09-25, GRBL protocol (GP), GRBL streaming (ST), grblHAL/FluidNC/Falcon (HF),
transport (TC) and cross-firmware (CG) tracks, against gnea/grbl `bfb67f0c`, grblHAL core
`d7aaee3d` and FluidNC v4.0.3. Critical events are ADR-393; the work coordinate system after Home
is ADR-396. The defects below share one cause: KerfDesk treated the three firmwares, and every
moment of a session, the same way.

- **The Console could wedge the controller.** GRBL takes `!`, `~` and `?` out of the byte stream
  wherever they appear (serial.c:150-196), so a `!` inside a Console line held the machine and
  the line's `ok` never came (GP-3). `$C` was refused in Check mode, the only way out of it
  (GP-4). FluidNC runs every `$` command under a long name too, so `$Settings/Restore=#` and
  `$NVX` went out unguarded (HF-6).
- **Settings writes lied.** Stock GRBL stores integer settings as `uint8_t` (settings.c:229) and
  prints floats to 3 decimals, and answers `ok` either way (GP-5).
- **Home.** Stock GRBL answers no status query while it homes (limits.c:320), and neither does
  grblHAL at its default settings. KerfDesk timed Home on 120 s of status silence, so a long cycle
  failed while the machine kept homing (ST-4). A Falcon per-axis Home read grblHAL's in-between
  Alarm as a new alarm (HF-1).
- **Status and errors.** Every Alarm report, not only the first, voided owed exchanges, so an
  operator's `$X` was rejected while GRBL went on to unlock (ST-3). grblHAL at its default
  COMPATIBILITY_LEVEL 0 repeats a refused line's error for every later G-code line until an empty
  line (protocol.c:246-286), which failed KerfDesk's own release marker, Set origin, Zero Z and
  jog (HF-7).
- **Tool change.** Continue handed the controller back to the job while an operator jog was still
  moving (GRBL answers G-code in Jog with `error:9`, protocol.c:99-101) or an answer was still
  owed (ST-1).
- **Connection.** The handshake sent one `?` and waited 8 s for an Idle nothing asked for (TC-1).
  Disconnect closed the port in the same millisecond it wrote `M5`/`M9`, and Smoothieware's USB
  flushes unparsed lines on detach (USBSerial.cpp:322-366; TC-3). The main-thread transport never
  closed a port whose read side ended (TC-4). Its comments described UTF-8 writes, while it writes
  one byte per character (TC-2).
- **Identity and advice.** grblHAL at COMPATIBILITY_LEVEL ≥ 1 prints `Grbl 1.1f`
  (report.c:310-314), which KerfDesk read as stock GRBL (HF-8). A refused `$SLP` always advised
  `$62=1`, which the Falcon contract cannot write (HF-4). A Wake that came back in Alarm, as all
  three firmwares do by design, was reported as a failure (HF-5, CG-8). Auto-focus bypassed the
  Console policy, and `$HZ1` ran a full `$H` on Smoothieware (CG-9). Ctrl+. wrote nothing on
  controllers without a jog-cancel byte (CG-12).

### Decision

1. **Console.** A line containing `!`, `~` or `?` is refused with its realtime meaning. A lone `~`
   is sent as the cycle-start byte. `$C` is accepted in Idle or Check mode. `$H` and `$SLP` are
   accepted in Alarm, as the firmware does. FluidNC long names are read as their Grbl names, and
   `$NVX` and `$Settings/Erase` are blocked. Auto-focus goes through the same Console policy, and
   its `$HZ1` preset is offered only for the Falcon command set.
2. **Settings writes.** Stock GRBL integer and on/off values it cannot store are refused before
   sending. A write is verified at the precision the controller prints, and a difference names
   the stored value.
3. **Home on stock GRBL and grblHAL** (capability `statusWhileHoming: false`). grblHAL answers `?`
   while homing only with "report when homing" (bit 12 of `$10`) on, and it is off by default
   (machine_limits.c:336-337). Each Home line waits for the longest cycle the `$$` settings allow.
   For each axis on stock GRBL: a 1.5 × `$130-$132` search and two `$27` pull-offs at `$25`, a
   5 × `$27` locate at `$24`, and a `$26` debounce per move. grblHAL locates at 10 × `$27`, `$43`
   times, with a pull-off before and after each locate. That sum is × 1.5 plus 30 s, and never
   less than 120 s. Without `$$`, a 30-minute backstop applies. A status report during the wait
   still restarts it. The firmware raises `ALARM:8/9` itself when a switch is not found. FluidNC
   homes from its main loop, keeps answering `?`, and keeps the 120 s status-activity budget. A
   Home that ends without the controller's answer raises "Home did not finish"; only `error:N` is
   reported as a rejection.
4. **Alarm reports.** Only the report that enters Alarm or Sleep voids owned exchanges, owed
   acknowledgements and position evidence. The Falcon's per-axis Home reopens that window before
   each further axis.
5. **grblHAL's latched error** (capability `stickyLineError`). After an `error:N` to a line
   outside a job stream, KerfDesk writes one empty line once every line in flight has its answer.
   That is the firmware's own way to clear the error. Stock GRBL and FluidNC parse every line on
   its own and get nothing extra.
6. **Tool-change Continue** waits for no motion or controller operation, no owed acknowledgement
   and a current Idle report. These are handoff facts, not a Start policy.
7. **Connection.**
   - The handshake repeats `?` every 250 ms while it waits for Idle, and after 8 s hands a busy
     controller to the qualification scheduler instead of failing. Fresh non-Idle reports keep
     the scheduler waiting.
   - Disconnect without a realtime reset waits up to 1 s for its stop lines' acknowledgements
     before closing the port, except while a job stream owns the acknowledgements.
   - A port whose read side ends is closed.
8. **Identity and advice.**
   - `Grbl 1.1f` on the grblHAL driver identifies grblHAL; any other GRBL version keeps the
     mismatch warning.
   - `$62=1` advice appears only where KerfDesk can write `$62`, and `$62=0` only when `$$`
     reported it.
   - A Wake that comes back in Alarm completes, and the Alarm banner offers Unlock or Home.
   - Ctrl+. sends Abort where the controller has no jog-cancel byte.
   - Alarm and error texts follow each firmware: ALARM:4 names both probe directions, error:7
     points at `$#` as well as `$$`, error:11 gives the 79-character limit, and grblHAL codes
     above 38 use grblHAL's wording.
   - Work-Z recovery converts a `$#` read under `$13=1` to millimetres.
9. **Simulator.** The GRBL simulator answers like GRBL 1.1h (15 planner blocks, a 128-byte RX
   ring, `error:9` in Jog, no status while homing, silence after `ALARM:1/2`, CR and LF each ending a
   line), with a grblHAL mode for its differences, the latched error included. That mode answers
   `?` while homing only when "report when homing" is set, as grblHAL does.

### Consequences

- The Console and auto-focus can no longer strand an owed acknowledgement with a realtime
  character.
- Long Home cycles on stock GRBL and grblHAL complete; a hung one is still bounded.
- Disconnect on Marlin and Smoothieware can take up to 1 s longer.
- Tests that disconnect those controllers on a fake clock advance it (`laser-disconnect-testing.ts`).
- Regression tests: `console-command.test.ts`, `laser-store-console-realtime.test.ts`,
  `autofocus-action.test.ts`, `laser-autofocus-console-policy.test.ts`,
  `fluidnc-console-command.test.ts`, `grbl-setting-storage.test.ts`,
  `grbl-settings-write-precision.test.ts`, `grbl-homing-duration.test.ts`,
  `laser-home-silent-grbl.test.ts`, `laser-alarm-report-repeat.test.ts`,
  `laser-home-falcon-relock.test.ts`, `laser-parser-rearm.test.ts`,
  `tool-change-continue-during-jog.test.ts`, `tool-change-continue-owed-ack.test.ts`,
  `laser-controller-handshake-busy.test.ts`, `laser-controller-qualification-alarm-wait.test.ts`,
  `laser-disconnect-stop.test.ts`, `web-serial-line-errors.test.ts`,
  `laser-banner-identity.test.ts`, `controller-sleep.test.ts`, `laser-wake-into-alarm.test.ts`,
  `use-job-shortcuts.test.ts`, `response-presentation.test.ts`,
  `work-z-controller-recovery.test.ts`, `grbl-simulator-fidelity.test.ts`.
