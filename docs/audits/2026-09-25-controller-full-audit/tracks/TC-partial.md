# Track TC (serial transport and connection lifecycle) - partial findings

Status: in progress (checkpoint 1, 2026-09-25). Repro tests live in `src/__audit_repro__/TC/`.

## Findings

### TC-1 - The connect handshake asks for status once, then waits 8 s for an Idle nothing solicits

- severity: medium
- verdict: CONFIRMED (busy-at-connect case, reproduced); PLAUSIBLE for the reboot-with-boot-text trigger (board wiring not settled by firmware source)
- status: new (ADR-362 decision 3 / connect-2/3 fixed only Alarm and Sleep at connect)
- failure scenario:
  1. A GRBL-family controller that is still busy when the port opens (buffered motion draining on a board whose USB port does not reset it, a Jog, a Home, a Hold or Door) answers the handshake's `?` with `<Run|...>`. No further `?` is sent. 8 s later the handshake fails with "Timed out waiting for fresh Idle.", qualification latches `failed`, `lastWriteError` is set, and nothing re-runs qualification when the machine reaches Idle 3 s after connect (repro: queries at 250 ms, 555 ms, then 9,560 ms; status Idle, qualification still `failed` at 20 s).
  2. A board that reboots on open and prints boot text before its banner (FluidNC v4.0.3 logs `[MSG:INFO: ...]` in setup and only polls input after setup) consumes the handshake's one `?` before it can answer. Banner at 1.2 s, first status query after it at 9,450 ms, qualified at 9,750 ms: about 8.5 s with the `connection-handshake` operation holding the UI.
- kerfdesk evidence:
  - `src/ui/state/laser-controller-handshake.ts:341-379` `waitForHandshakeIdle`: `await safeWrite(realtimeQuery, undefined, 'system'); await idle;` - one query only.
  - `src/ui/state/laser-interactive-command.ts:278-300,330-354` `waitForFreshIdle` / `observeControllerIdleWait`: 8 s timer restarted only by a status report ("the timeout measures status silence").
  - `src/ui/state/laser-connection-actions.ts:170-202`: the status poll starts only in the handshake's `.finally`; the `.catch` writes `failedControllerQualificationPatch(... message)` and `lastWriteError`.
  - `src/ui/state/laser-controller-qualification.ts:207-212` `waitingOnOperator` keeps waiting only for Alarm/Sleep; a terminal `failed` is never re-armed by a later Idle.
- upstream evidence:
  - GRBL reports status only when asked: `grbl/grbl/protocol.c` `if (rt_exec & EXEC_STATUS_REPORT) { report_realtime_status(); ...}` https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L250-L253
  - FluidNC v4.0.3: `protocol_main_loop()` calls `start_polling()` (FluidNC/src/Protocol.cpp#L240-L242); `protocol_reset()` does `allChannels.flushRx(); report_init_message(allChannels);` (Protocol.cpp#L396-L397); setup logs `[MSG:INFO: FluidNC ...]` before (FluidNC/src/Main.cpp#L53). https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Protocol.cpp
- reproduction: `src/__audit_repro__/TC/tc-1-handshake-one-shot-idle-probe.test.ts` - both cases FAIL on current code.
- fix (local): while the handshake waits for its fresh Idle, repeat the realtime `?` on the status-poll cadence (or start the ordinary poll before the idle wait); on timeout hand over to `scheduleControllerQualification` instead of latching `failed`, and count any fresh non-Idle report (Run/Jog/Home/Hold/Door/Check) as a live controller that keeps the wait open, as Alarm/Sleep already do.

### TC-2 - Transport comments still describe UTF-8 writes and a TextDecoderStream

- severity: low
- verdict: CONFIRMED
- status: new
- failure scenario: a maintainer following the header "Write pipeline: string -> UTF-8 -> port.writable" could reintroduce TextEncoder, re-breaking the single-byte realtime commands (jog cancel 0x85, overrides 0x90-0xA2) that M12 fixed.
- kerfdesk evidence: `src/platform/web/web-serial.ts:7-8`; `src/platform/types.ts:132` ("Write a string (UTF-8)"). The code actually uses `encodeWireBytes` (one byte per char, `src/platform/web/serial-wire.ts:19-25`) and `new TextDecoder('utf-8')` with `{ stream: true }` (`serial-read-loop.ts:67,75`).
- upstream evidence: GRBL takes bytes above 0x7F as realtime commands: `grbl/grbl/serial.c` ISR `if (data > 0x7F) { // Real-time control characters are extended ACSII only.` https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c
- reproduction: traced only.
- fix (local): correct the three comments.

## Checked and correct (so far)

- Line framing: LF/CRLF, splits across chunks, 64 KiB cap with discard-to-newline; invalid UTF-8 becomes U+FFFD without swallowing following ASCII bytes (node TextDecoder check); GRBL/grblHAL/FluidNC/Marlin all terminate with LF or CRLF (grblHAL stream.h `ASCII_EOL "\r\n"`, FluidNC Channel.cpp `print_msg` writes msg then "\n", Marlin serial.h `SERIAL_EOL() SERIAL_CHAR('\n')`).
- No mid-line status interleave on FluidNC v4.0.3: every line goes through one output task queue (Protocol.cpp output_loop / Channel.cpp sendLine).
- Web Serial read errors: Break/Framing/Parity/BufferOverrun recover on a fresh `port.readable` (spec readable getter steps; Chromium `ReceiveErrorIsFatal` returns false for them). UnknownError treated as fatal is defensible: Chromium raises SYSTEM_ERROR on the read side for a CDC-ACM unplug on Windows (serial_io_handler_win.cc OnIOCompleted comment).
- Disconnect cleanup (ADR-361 item 3): both transports close the writer with the bounded drain before closing the port, so the GRBL-family transaction's 0x18 + M5/M9 reach the OS; GRBL/grblHAL/FluidNC resets kill spindle and coolant themselves (grbl motion_control.c mc_reset; FluidNC Protocol.cpp protocol_do_late_reset).
- A reset banner later than the 2 s window still ends qualified (tc-check-late-reset-banner.test.ts, passing check).
- DTR/RTS: KerfDesk never calls setSignals/getSignals; Chromium asserts DTR and RTS on open on Windows (serial_io_handler_win.cc ConfigurePortImpl: DTR_CONTROL_ENABLE, RTS_CONTROL_ENABLE). grblHAL USB prints its welcome 200 ms after DTR without rebooting (grblhal-core stream.c#L328-L333); Smoothieware prints "Smoothie\r\nok\r\n" on DTR attach (USBSerial.cpp#L324-L333). KerfDesk's first-banner adoption handles both.
- Electron: no device permission handler (ADR-366), matching Electron docs ("If this handler is not defined, the default device permissions as granted through device selection ... will be used").

## Still to check

- Worker/main-thread parity details (close-subscriber isolation, port.close after a fatal read end on the main thread).
- Electron window close / quit during a job: stop handoff ordering and air/laser off.
- Smoothieware DTR-detach RX flush vs queued Disconnect cleanup lines (USBSerial.cpp on_main_loop).
- FluidNC alarm_msg 500 ms delay vs KerfDesk's 500 ms reset-banner wait (cleanup lines flushed; reset already de-energizes).
