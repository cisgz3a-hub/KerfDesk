# Rolling audit v2 — Web platform adapter (19 `platform-web`)

- **When:** 2026-10-21 22:55–23:40   **Tree:** origin/main @ `902f1d0c0` (audit worktree HEAD
  `639ff4216`; `git diff 902f1d0c0 HEAD -- src electron WORKFLOW.md` is empty)
- **Scope:** `src/platform/web/**` (Web Serial window transport, native worker transport and
  handover, File System Access save/open/directory targets, Recent Projects handles, launch queue,
  camera adapter, camera bridge client), `src/platform/types.ts`, and the Electron twin
  (`src/platform/electron/desktop-serial.ts`, `desktop-project-files.ts`, `src/ui/app/main.tsx:59-80`).
  Storage was followed to its browser-facing modules (`src/ui/recent-projects/*-storage.ts`,
  `src/ui/state/preference-persistence.ts`, `browser-local-storage.ts`, `persistent-storage-request.ts`);
  autosave/recovery IndexedDB is area 13's. Save-picker callers were read where the adapter's
  behaviour decides the outcome. Governing: ADR-011, ADR-060, ADR-248, ADR-331, ADR-334,
  ADR-354 (+ Amd 1–3), ADR-356, ADR-366, ADR-378 (+ Amd 1), ADR-420, ADR-550, ADR-552, ADR-600;
  WORKFLOW F-A9, F-A9a, F-A11, F-CNC25; PROJECT.md "Delivery targets". Prior audits:
  `docs/audits/rolling/2026-07-17-0715-platform-adapters.md`,
  `docs/audits/2026-09-25-controller-full-audit.md` (track TC), reports 04, 12, 13 and 17 here.
- **Lenses run:** L2 (WICG Web Serial `index.bs`, WICG File System Access `index.bs`, Chromium
  `serial_port.cc`, `serial_port_underlying_sink.cc`, `serial_port_underlying_source.cc`,
  `serial.cc`, `serial_io_handler_win.cc`/`_posix.cc`, `file_system_access_manager_impl.cc`,
  `chrome_file_system_access_permission_context.cc`, `user_activation_state.h`, Electron
  `file_system_access_permission_context.cc` — all fetched), L6, L4, L3, L7 as separate passes;
  L1 folded into L3/L6 (each ADR/WORKFLOW clause checked where its code runs). L5 skipped: the
  only untrusted inbound data here is serial bytes (framing caps verified clean) and the camera
  bridge (KNOWN, report 04).
- **Counts:** 4 raised → refuter: 3 CONFIRMED, 1 PLAUSIBLE, 0 REFUTED → P1 0 / P2 1 / P3 3
  (+ 2 KNOWN). No severity changes (P2-1 held at P2 against P1; reasons in its verdict).

## Headline

The serial transports are in good shape: framing, line-error recovery, port release on every
read-side ending, and two-tab refusals all match the Web Serial spec and Chromium. The defect that
matters is on the file side. Chromium's `showSaveFilePicker` empties the chosen file the moment the
picker returns, so every save that does fallible or cancellable work after picking (surfacing,
SVG and other artwork exports, `.rd`, timelapse video, processed bitmap) leaves an existing file at
0 bytes when that work fails or the operator presses Cancel. That breaks F-CNC25's explicit promise
that existing contents survive. The adapter's own test certifies "does not truncate" against a mock
picker that cannot truncate. A smaller twin gap: line errors are recovered on the read side, but one
non-fatal write error disables writing for the rest of the session on both transports.

## Findings

### P2-1 — The save picker empties the chosen file before preparation; a failed or cancelled save leaves it at 0 bytes
- **Where:** `src/platform/web/web-adapter.ts:59-74` (`pickFileForSave` → `window.showSaveFilePicker`,
  returned as an ordinary target); contract text `src/platform/types.ts:519-525` (only
  `reserveFileForSave` is documented as "without creating or truncating", and it has no production
  caller). Callers that pick first and do fallible work afterwards:
  - `src/ui/machine/save-surfacing-program.ts:80-104`: comment "no writable opens until preflight";
    picker at `:87`, preparation awaited at `:93`, blocking preflight throws at `:98`, abort at `:92`/`:99`.
  - `src/ui/app/export-artwork-svg.ts:38-65`: variable-text and raster-embedding failures after the pick.
  - `src/ui/app/export-artwork-format.ts:113-123`: `exportFile` errors after the pick.
  - `src/ui/app/save-rd-action.ts:51-58`: the code itself says a worker failure "leaves a recoverable
    empty target".
  - `src/ui/camera/job-watch/TimelapseResult.tsx:79-91`: encode fails after the pick.
  - `src/ui/app/save-processed-bitmap.ts:57-77`: hydrate/build `too-large`/encode after the pick.
  - `src/ui/commands/multi-file-trace-action.ts:365-371`: `throwIfAborted` after the pick.
- **Anchor:**
  - Contract: WORKFLOW F-CNC25 (`WORKFLOW.md:6448-6458`): "**Cancel surfacing save** stops
    preparation or discards uncommitted file bytes … Existing file contents survive preflight,
    generation, or write failures before the final commit"; "A preflight failure … nothing is written".
  - Contract: F-A9a (`:1300`), failures report an error "without claiming a successful partial export".
  - Ground truth: WICG File System Access `showSaveFilePicker` step "Set entry's binary data to an
    empty byte sequence". Chromium `file_system_access_manager_impl.cc` SELECT_SAVEAS_FILE branch:
    "Create file if it doesn't yet exist, and truncate file if it does exist" (`CreateAndTruncateFile`
    before the handle is returned).
  - Twin: the desktop Save-after-Open path "writes the new bytes beside it and then swaps them in, so
    a failed save leaves the old file as it was" (`WORKFLOW.md:1486`). The G-code Save As path was
    already reordered to prepare first, because "factual failure must never create, open, truncate,
    or modify a final target" (`file-actions.ts:260-264`, commit `17a54fb65`).
- **Scenario:** An operator re-saves the spoilboard program over last week's `surfacing.nc` and
  confirms Replace in the native dialog. They then press **Cancel surfacing save** while it
  generates, or the background preflight refuses the area, or they open another project
  (`use-surfacing-save.ts` aborts on the document epoch). The toast says "Surfacing save cancelled."
  or "Could not save the surfacing program: …", but `surfacing.nc` is now empty. The same holds for
  an existing `.svg`, `.dxf`/format export, `.rd`, timelapse or `.png` whose post-pick step fails.
  A new filename is left as a 0-byte file.
- **Evidence:** REPRO + SOURCE.
  - Repro: `src/ui/machine/zz-19-surfacing-truncate.test.ts` (deleted). It runs the real
    `webAdapter.pickFileForSave` and `saveSurfacingProgram`, with `window.showSaveFilePicker`
    modelled on Chromium: truncate at pick, swap-file writable. The surfacing worker client is
    mocked to (a) reject with a preflight refusal, (b) hang until abort.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/machine/zz-19-surfacing-truncate.test.ts`.
    Output: 2 passed. In both cases `saveSurfacingProgram` rejects and the pre-existing
    `surfacing.nc` content (`'G21\nG90\n(previous good surfacing program)\n'`) reads back as `''`.
  - SOURCE: spec `index.bs` (showSaveFilePicker algorithm); Chromium
    `content/browser/file_system_access/file_system_access_manager_impl.cc` lines ~2065-2087 (main).
  - L7: `src/platform/web/web-adapter.test.ts:44` "does not open or truncate the file until prepared
    data is written" passes only because its mock picker cannot truncate; it asserts
    `createWritable` was not called, which is not the truncation point.
  - Not run in a real browser: the native dialog cannot be automated here.
- **Refuter:** CONFIRMED, kept at **P2**.
  - Sources, fetched myself: the WICG spec's `showSaveFilePicker` empties the entry before it
    resolves, and Chromium's SELECT_SAVEAS_FILE branch runs `CreateAndTruncateFile`
    (`CreateAndTruncateLocalFile` on POSIX) first. MDN is silent on this.
  - Code: all seven callers pick before failable or cancellable work. My separate repro
    (deleted `zz-19r-picker-truncate.test.ts`) ran the real adapter and processed-bitmap save
    with a failing encoder, and the existing PNG read back `''`.
  - Electron 44 spreads `webAdapter.pickFileForSave`, so it truncates the same way.
  - `.lf2` Ctrl+S never opens the picker. It writes through a swap file, and the repro kept
    the old bytes. Project Save As and recovery export prepare before picking, so only a
    write I/O failure can empty the chosen `.lf2`, and there is no Cancel window.
  - Why P2, not P1: the operator confirmed Replace, the outputs can be regenerated from the open
    project, and the toast is misleading rather than silent. The coordinator may still raise it
    for a wrong-file pick that the operator then cancels.
- **Fix direction:** Make the adapter contract say plainly that `pickFileForSave` replaces the
  chosen file on pick. Then move every fallible step before the picker, as G-code and project Save
  As already do, or pick a non-destructive reservation and create the file only at commit. The
  unused `reserveFileForSave`, or a fresh "Choose file…" click after preparation, is already in the
  codebase. Replace the web-adapter test with one whose fake picker empties the file.
- **Severity note:** Proposed P2 because the operator had confirmed replacing that one file. The
  coordinator may weigh it as P1 under "loses user data", since Cancel and failure promise the old
  contents survive.

### P3-1 — One non-fatal serial write error disables writing for the rest of the session; the fresh `port.writable` is never taken
- **Where:**
  - `src/platform/web/web-serial.ts:203-219` (`ConnectionContext.writer` is taken once, `readonly`)
    and `:285-289` (`write` always uses that writer).
  - `src/platform/web/serial-worker-core.ts:231-233` (writer taken at `attach`), `:342-345`
    (`writeBytes`).
  - `src/platform/web/native-serial-worker-runtime.ts:186-206`: re-reads after a read error, but
    has no write analogue.
- **Anchor:**
  - Twin: the read side replaces a failed reader with the port's fresh stream
    (`serial-read-loop.ts:121-138`, `native-serial-worker-runtime.ts:186-206`). The stated reason
    (`serial-read-recovery.ts:15-18`, ADR-354 §7) is that a teardown "closed the writer too, so Stop
    could no longer reach a controller that was still running".
  - Ground truth: Chromium `SendErrorIsFatal(SYSTEM_ERROR)` returns false (`serial_port.cc:50-59`).
    `SerialPortUnderlyingSink::SignalError` rejects with "UnknownError: An unknown system error has
    occurred." and calls `UnderlyingSinkClosed()`, which sets `writable_ = nullptr`. `writable()`
    then builds a fresh stream unless `write_fatal_` (`serial_port.cc:232-237`).
  - Spec divergence: the WICG spec's UnknownError write branch does not run "handle closing the
    writable stream". Chromium, the only target, does.
- **Scenario:** During a job the OS reports a transient write error. On Windows that is any
  `WriteFile` error other than `ERROR_GEN_FAILURE`; on POSIX, any `errno` other than EIO/ENXIO
  (`serial_io_handler_win.cc` `OnIOCompleted`, `serial_io_handler_posix.cc` `OnFileCanWriteWithoutBlocking`).
  What follows:
  - The refill write rejects, and `containActiveStreamWriteFailure` runs the GRBL disconnect
    transaction (`laser-stream-heartbeat-containment.ts:135-200`).
  - Its soft reset `0x18`, and any `!`, reject at once with the same stored error, although Chromium
    already offers a fresh writable.
  - The port is then closed with the controller still executing its planner and RX buffer.
  - Outside a job, the session stays "connected" with live status lines while every command fails
    until the operator disconnects.
- **Evidence:** REPRO.
  - Repro: `src/platform/web/zz-19-write-error.test.ts` (deleted). A Chromium-modelled port's sink
    fails one write with `UnknownError` and nulls its writable.
  - Window transport results:
    - First write `UnknownError`; then `write('\x18')` → `UnknownError` and `write('!')` → `UnknownError`.
    - `onClose` count 0, and a status line was still delivered.
    - `port.writable` is non-null and unlocked, and nothing reached the port.
  - Worker core: write ids 1 and 2 → `['write-error','write-error']`, and no `closed`.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/platform/web/zz-19-write-error.test.ts`
    → 2 passed.
  - L7: `SerialPortDouble` (`serial-port-double.test-support.ts`) has no write-failure mode, so
    neither transport's write-error path is tested against port behaviour.
- **Refuter:** CONFIRMED, stays P3 (reach unproven).
  - Chromium sources, fetched myself:
    - `serial_port.cc` has `SendErrorIsFatal(SYSTEM_ERROR)=false`, and `writable()` rebuilds unless `write_fatal_`.
    - The sink's `SignalError` calls `UnderlyingSinkClosed()`.
    - `serial_port_impl.cc` resets `in_stream_` on a send error, so `StartWriting` accepts a new pipe.
  - Independent repro (deleted `zz-19r-write-error.test.ts`): a port double that fails one write
    gave `UnknownError` for the next three writes, including `\x18` and `!`. Close count stayed 0,
    and a fresh unlocked `port.writable` was available.
  - Windows `OnIOCompleted` maps CH340-style unplug errors (`ERROR_BAD_COMMAND`/`ACCESS_DENIED`)
    on write to the non-fatal SYSTEM_ERROR. In that case the read side sees DEVICE_LOST and ends
    the session anyway, so only a truly transient write error is left. Its frequency is unmeasured.
- **Fix direction:** On a write rejection whose name is not `NetworkError`, release the dead writer
  and take `port.writable` once, within a budget like the read side's, so containment's reset and
  Stop bytes can go out. Keep the failed line's acknowledgement quarantined as now. Add a
  write-error mode to the port double.
- **Reach:** Unproven. Whether USB serial drivers report non-fatal write errors on a live port in
  practice was not measured.

### P3-2 — The first Save over an opened project can be refused as "KerfDesk may not change …" without the browser ever asking
- **Where:** `src/platform/web/web-adapter.ts:188-199` (`requestWritePermission`: the `catch`
  treats a thrown request as "a refusal like any other" and throws the may-not-change message).
  Reached after worker preparation on the reuse path: `src/ui/app/large-project-save.ts:74-80`
  (`if (reuseTarget) … await pick()` with no fresh click), `src/ui/app/prepare-project-save.ts:42-46`.
- **Anchor:**
  - Contract: ADR-550 / WORKFLOW F-A11 (`WORKFLOW.md:1480-1481`): "In a browser the first Save asks
    once whether KerfDesk may change the file. Refusing shows …".
  - Ground truth: Chromium refuses a permission request without transient activation
    (`chrome_file_system_access_permission_context.cc:1075-1079`, `kNoUserActivation` → SecurityError
    "User activation is required to request permissions."). Activation lasts
    `kActivationLifespan = base::Seconds(5)` (`user_activation_state.h:23`).
- **Scenario:** A web user opens a large photo-engraving `.lf2` (images or ≥ 250 objects take the
  worker path) and presses Ctrl+S. Worker preparation takes more than 5 s, then the write asks for
  readwrite permission. Chrome rejects without showing a prompt, and the toast reads "Could not save
  project: KerfDesk may not change photo.lf2. Use Save As to save a copy." Every Save repeats this,
  and the operator believes they refused something. Save As still works, and nothing is lost.
- **Evidence:** READ + SOURCE.
  - Test pin: `opened-project-save-target.test.ts:66` lists
    `new DOMException('No gesture', 'SecurityError')` among the refusals that produce this message.
  - Not measured: real preparation times.
- **Refuter:** PLAUSIBLE, stays P3.
  - Fetched Chromium myself:
    - `chrome_file_system_access_permission_context.cc:1074-1080` returns `kNoUserActivation`
      without transient activation.
    - `file_system_access_handle_base.cc:324-328` maps that to SecurityError.
    - `kActivationLifespan` is 5 s (`user_activation_state.h:23`).
  - The code supports the premise. On the reuse path, `requestWritePermission` runs only inside
    `write`, after the awaited worker preparation. Nothing else asks for readwrite. And
    `large-project-save.ts:26-28` itself says a slow worker can outlast picker activation.
  - Not reproduced: no project was measured past 5 s of preparation. Persistent "allow on every
    visit" grants skip the prompt entirely.
- **Fix direction:**
  - Ask for readwrite permission at the Save click, before preparation, when `queryPermission`
    says `prompt`.
  - Or, when the request throws for lack of activation, show a "Save now" button (a fresh click)
    instead of the refusal text.
- **Twin:** Electron's context has the same activation check
  (`file_system_access_permission_context.cc:346-349`). It runs only while the status is ASK, and
  ADR-550 says the desktop app allows without asking. Not verified.

### P3-3 — Folder-reserved saves create the destination before writing; a failed write leaves an empty file
- **Where:** `src/platform/web/web-adapter.ts:130` and `:136`.
  `directory.getFileHandle(displayName, { create: true })` runs before `createWritable()`, the write
  and `close()`.
- **Anchor:**
  - Ground truth: File System spec `getFileHandle` with `create: true` creates the child file
    entry immediately, empty.
  - Contract: `types.ts:200-201` ("Merely reserving the directory never creates or truncates a file").
    That is true of the reservation, but the per-file write creates the file before its bytes are
    staged.
- **Scenario:** Multi-file trace (`traceFileWriterForDirectory`) or tiled G-code into a reserved
  folder. A permission loss or disk error at `createWritable`/`write` leaves `<stem>-trace.svg` at
  0 bytes. The next attempt then avoids that name and writes `-trace-2`, so the folder collects
  empty decoys.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, stays P3.
  - The WHATWG `fs` spec `getFileHandle` with `create:true` appends a child whose binary data is
    empty (fetched `index.bs:874-880`).
  - Repro (deleted `zz-19r-dir-decoy.test.ts`): the real `reserveSaveDirectory` plus
    `traceFileWriterForDirectory`, with the first write failing. It left
    `{'logo-trace.svg': '', 'logo-trace-2.svg': '<svg/>'}`.
  - Narrower than stated: tiled G-code (`save-tiled-gcode.ts:178-182`) skips the `exists` probe,
    so an existing tile is kept on failure. Only new names get empty files. Triggers are disk or
    permission failures only.
- **Fix direction:** On write failure, remove the entry the target created (`directory.removeEntry`),
  only when it did not exist before the write.

## Known (not re-raised)

- **04-P2-1**: `src/platform/web/camera-bridge.ts:11` fixed loopback origin with no server identity
  check (report 04).
- **UnknownError read ends the session.** `serial-read-recovery.ts:18-26` treats it as fatal,
  although spec and Chromium (`ReceiveErrorIsFatal(SYSTEM_ERROR)` = false) keep the port open. The
  2026-09-25 controller audit (track TC, "Checked and correct") accepted this as defensible, because
  Windows raises read SYSTEM_ERROR for a CDC-ACM unplug. The port is now closed when this happens
  (TC-4 fix). Not re-raised; P3-1 is the write-side analogue, which that audit did not cover.

## Refuted

The refuter refuted none of the four findings above.

Candidates this auditor raised and dropped (refuter not run on these):

- **Native-worker open has a 2 s deadline, so a slow-opening port can never connect while
  background streaming is on.** Dropped. The worker path needs valid, unique USB VID/PID
  (`native-serial-connection.ts:115-140`). Slow-opening ports such as Bluetooth SPP COM ports report
  none and take the window path before any native open.
- **"Use a different port…" awaits the old connection's disconnect before `requestPort`, so the
  picker's 5 s activation can expire.** Dropped. The waits are a 500 ms banner and 500 ms writes
  (`laser-reset-cleanup.ts:20`, `laser-reset-ownership.ts:41`); only a wedged close reaches 5 s.
- **A second tab's stale-port sweep could close the first tab's live port.** Refuted. SerialPort
  objects belong to their own realm, and tab B's are not open (`web-serial.ts:102`). Chromium refuses
  B's open with "Failed to open serial port." (`serial_port.cc` `kOpenError`). `connectionFailureText`
  (`ConnectionBar.tsx:356-370`) explains it, naming "another KerfDesk window". Auto-connect
  reports it quietly (ADR-639).
- **IndexedDB `onblocked` rejection leaks a late-opening connection.** Dropped as harmless. Both
  databases use a constant version 1 (`recent-project-storage.ts:16`, `local-snapshot-storage.ts:104`),
  so `blocked` cannot fire in practice.

## Verified clean

- **Framing** (`serial-wire.ts`, both transports):
  - LF and CRLF, including a CR and LF split across reads.
  - Multi-byte UTF-8 split across reads (`TextDecoder` streaming).
  - 64 KiB cap with discard to the next LF.
  - After a line error, a fresh reader starts unsynchronised, so a damaged tail is never taken as `ok`.
  - Bursts are bounded by `bufferSize` 4096 (Chromium data-pipe capacity, `serial_port.cc` `CreateDataPipe`).
  - Dispatch yields every 8 ms on a MessageChannel, so hidden tabs are not throttled.
- **Line errors:** Break, Framing, Parity and BufferOverrun are recovered on a fresh `port.readable`
  in both transports. This matches the spec's `readable` getter and Chromium's `ReceiveErrorIsFatal`
  (OVERRUN and BUFFER_OVERFLOW → `BufferOverrunError`, `serial_port_underlying_source.cc:125-129`).
  The 8-recovery-without-data budget is shared.
- **Port release:**
  - Read end, `disconnect` event and explicit close all close the OS port once, on both transports
    (`web-serial.ts:258-276`, `native-serial-worker-runtime.ts:228-246`).
  - Locks are released before `port.close()`; the writer drains with a bounded close before any abort.
  - `closingPorts` ownership refuses a reconnect while a close is still settling (ADR-600).
  - A throwing line, line-error or close subscriber never ends the session.
- **Picker and open errors:**
  - `requestPort` cancel is `NotFoundError` "No port selected by the user." (`serial.cc:425`) and maps to null.
  - Open failure "Failed to open serial port." is explained as a busy port, with the Linux group
    hint (ADR-607).
- **Hosted native path:** identity is unique on both sides and revalidated before open. Once open is
  requested there is no fallback owner. Close and Forget wait for real release (ADR-354 §2-3, §6).
- **Wire encoding:** one byte per character. Characters above 0xFF, and high bytes inside queued
  lines, are refused before any byte is written. The program buffer round-trips exactly
  (`serial-program-buffer.ts`).
- **FSA writes after the pick:**
  - `createWritable` writes to a swap file.
  - `writeAndClose` and `writeSaveChunks` abort on failure or cancel, so no partial bytes are
    ever committed over the target.
  - The project and G-code Save As paths do all fallible work before the picker
    (`prepare-project-save.ts:59-61`, `large-project-save.ts`, `file-actions.ts:260-280`).
- **Write permission for an opened project (ADR-550):** a denied or prompt answer gives the
  documented refusal text and no `createWritable`.
- **Recent Projects (ADR-378):**
  - `probe` never prompts.
  - NotFoundError maps to `missing`; NotAllowed and Security errors map to `denied`.
  - A `DataCloneError` falls back to name-only storage.
  - After three refusals, a session-only list with one notice.
  - Updates run in a single transaction, so concurrent windows both land.
- **Preferences:** a localStorage getter denial or quota error keeps the value pending, with a
  warning toast and Retry. A persistent-storage request exists (`persistent-storage-request.ts`).
- **Camera:**
  - `NotAllowedError` resolves null; device errors propagate.
  - Track mute, unmute and end move the status.
  - `sourceId` and `resizeMode` come from the actual track settings, so a substitute camera chosen
    by `ideal` deviceId is visible to calibration binding.
- **Web/Electron twin:** Electron reuses the web pickers, serial and camera verbatim
  (`main.tsx:59-80`). Only `picksEndOnRestart` and the desktop-path recent/save targets differ, and
  the desktop-path save is atomic in main.
- **No download fallback:** by design (PROJECT.md "Delivery targets"; WORKFLOW `:1273`, `:1512-1513`).
  Missing APIs give explicit errors on open and save; the July P3-2 is fixed (`web-adapter.ts:39`).
  The Brave WebSerial hint is shown (`ControllerConnectionControls.tsx:147`).

## Not verified

- **Picker truncation in a live browser.** The native Save dialog cannot be automated here. P2-1
  rests on Chromium source, the spec and a modelled repro.
- **P3-1 reach:** how often real USB serial drivers report a non-fatal write error on a live port.
- **P3-2 reach:** real worker preparation times for large projects, and whether Electron's handler
  grants before its activation check.
- **PWA precache completeness:** no production build was run. Whether every emitted chunk stays
  under Workbox's 8 MB `maximumFileSizeToCacheInBytes` (`vite.config.ts:190`), and so loads
  offline, is unmeasured.
- **Camera resolution changes mid-stream:** the adapter snapshots track settings once. Area 12 owns
  the calibration consequences.
- **Multi-window IndexedDB contention** and real quota exhaustion were not run. A remembered port is
  stored as one global VID/PID, not per machine profile (ADR-420, UI area), and was not assessed.

```json
[
  {"id":"P2-1","severity":"P2","area":"platform-web","file":"src/platform/web/web-adapter.ts","line":59,"anchor":"Contract WORKFLOW F-CNC25 (existing contents survive preflight/generation/write failure; Cancel discards uncommitted bytes) and F-A9a; Ground truth WICG FSA showSaveFilePicker 'Set entry's binary data to an empty byte sequence' + Chromium file_system_access_manager_impl.cc CreateAndTruncateFile on SELECT_SAVEAS_FILE; Twin desktop-path save keeps old file (WORKFLOW:1486), G-code Save As prepares first","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"showSaveFilePicker empties the chosen file at pick time; surfacing, SVG/format export, .rd, timelapse, processed bitmap and multi-file trace do fallible or cancellable work after picking, so a failure or Cancel leaves an existing file at 0 bytes; adapter test certifies 'does not truncate' against a non-truncating mock"},
  {"id":"P3-1","severity":"P3","area":"platform-web","file":"src/platform/web/web-serial.ts","line":285,"anchor":"Twin: read side recovers a fresh port.readable (serial-read-loop.ts:121, native runtime :186) for the stated reason that Stop must still reach the controller; Ground truth Chromium SendErrorIsFatal(SYSTEM_ERROR)=false, SignalError -> UnderlyingSinkClosed (writable_=nullptr), writable() makes a fresh stream","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"One non-fatal UnknownError write leaves both transports holding the dead writer; every later write including containment's 0x18 and '!' fails while a fresh port.writable is available and reads continue"},
  {"id":"P3-2","severity":"P3","area":"platform-web","file":"src/platform/web/web-adapter.ts","line":188,"anchor":"Contract ADR-550 / WORKFLOW:1480 (first Save asks once; refusing shows the may-not-change text); Ground truth Chromium permission context requires transient activation (kNoUserActivation), kActivationLifespan 5 s","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"First Save over an opened large project runs worker preparation before requestPermission; past 5 s Chrome rejects without prompting and the adapter reports it as the user's refusal"},
  {"id":"P3-3","severity":"P3","area":"platform-web","file":"src/platform/web/web-adapter.ts","line":130,"anchor":"Ground truth File System spec getFileHandle({create:true}) creates the empty entry immediately; Contract types.ts:200 reservation never creates a file","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Folder-reserved writes create the file before createWritable/write; a failed write leaves a 0-byte file that later exports avoid as taken"}
]
```
