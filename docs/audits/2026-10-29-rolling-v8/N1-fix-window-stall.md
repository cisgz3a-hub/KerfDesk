# Rolling audit v8 — N1 Fix verification: jobs stream off the window (#1500)

- **When:** 2026-10-29, afternoon +0800   **Tree:** origin/main @ `33bc394c6` (#1513 merged; the desktop 1.0.28 source).
  - #1500 merged as `47ff19d8d` (parent `47ff19d8d^1`, head `e14a7c293`).
  - `git diff --stat 47ff19d8d origin/main` over all 44 source and test files #1500 touched is empty.
  - **Repros ran on main's exact tree.** All 44 source and test files of #1500 in `…\scratchpad\j7-main\` hash-match `origin/main`. Commands: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`, one file at a time. The files are listed at the end and were deleted.
- **Scope:** fix verification of #1500 (ADR-676), which fixed rolling v6 K1-P1-1/2/3. Covered:
  - every transport route in K1's matrix;
  - Pause, Resume, Abort and Ctrl+. on the new worker path;
  - recovery, the Console, air assist, and Marlin's acknowledgement grammar;
  - the interaction with K2's watchdogs;
  - ADR-676 against the code, and test truth.
  - **Coordinator extra item:** whether #1500, #1509 or #1479 can make a desktop quit exit with a non-zero code (release run 40846112322).
- **Lenses run:**
  - L10 (all five steps);
  - L6 (what the beam does when the refill stops, Abort ordering);
  - L9 (USB unique and identical adapters, opt-out, worker unavailable, desktop network worker and fallback, web build by READ, Smoothieware);
  - L4 (injected Marlin replies mid-stream; Abort as a stall ends; Pause/Resume around a stall; CPU load);
  - L2 (Marlin 2.1.2.8 echo format; the Electron 44 `app://` worker fetch).
  - L5 was not run: no trust boundary changed. `trustedAppRequest` was checked only as far as the worker's own requests.
- **Counts:** 5 raised → 0 refuted → P1 1 / P2 1 / P3 3 (+ 4 KNOWN re-observed).
  - **Refuter (fresh context, 2026-10-29):** CONFIRMED 3 (N1-P1-1, N1-P3-2, N1-P3-3), PLAUSIBLE 2 (N1-P2-1, N1-P3-1), REFUTED 0. No severity changes.
  - Corrections are in each finding's **Refuter** line:
    - N1-P2-1 applies to the fan dialect only.
    - Marlin never used ADR-352's batching.
    - #1500's fan test does run Abort as the stall ends.
  - The refuter did not re-check the KNOWN items.

## Headline

**#1500 holds on every route it names.**
- **Re-run of K1 on main.** The controller ran on its own thread, the real store on the test thread, with a synchronous block.
  - The default routes no longer leave a stopped head lit: Marlin fan and inline on a USB worker, and GRBL Compatible M3 on grblHAL raw TCP and on FluidNC through the desktop network worker. Each gave **0 ms** lit during a 1.0–1.6 s block, and every G1 line arrived once and in order.
  - Every route where the window still streams shows the lit stop: identical USB adapters, the profile opt-out, and a network session the worker could not take (683–1,423 ms lit). Each now gets **Job Review's specific warning**. The fallback routes also get a **warning toast**; the opt-out gets a Laser-log line.
- **Test truth.** #1500's regression test fails on the parent's code. With the parent's `laser-connect-action.ts` swapped in, both Marlin "worker" cases fail, and the network case stays lit for 681 ms of a 1 s block.
- **The PR's open item, now checked.** In Electron 44.5.1, a module Worker loaded from `app://app` can fetch the `app://` machine-network route through `protocol.handle`, and the route guard accepts it.

**Two gaps remain on the new Marlin worker path.**
- **N1-P1-1. One unmatched `Unknown command` echo silently moves a Marlin job back to the window for the rest of the run.**
  - The worker hands the refill back on every Unknown-command echo. The main thread ignores an echo that does not name the line in flight (MA-12), and keeps streaming from the window. Nothing re-arms the worker.
  - `jobStreamHost` still says `worker`, so neither the toast nor Job Review speaks.
  - REPRO: after one such echo, a later 1.6 s block left the head lit for **999 ms (inline)** and **1,338 ms (fan)**. That is K1-P1-2 and K1-P1-1 again, with no warning.
  - **Refuter: CONFIRMED.** The refuter used a modelled UART byte loss instead of an injected echo: the `G` of one `G1` dropped, and the Marlin model answered with an echo, then `ok`. Lit: **1,020 ms** inline and **1,392 ms** fan.
- **N1-P2-1. Marlin Abort and Disconnect take the refill back before their stop lines.** The worker stops refilling at once, but its `released` reply queues behind every forwarded line the window has not yet processed.
  - After a stall (when an operator is most likely to press Abort), the stop lines wait for that backlog. Meanwhile the controller drains and stops, still lit.
  - The GRBL path posts its reset first for exactly this reason (`laser-job-stop.ts:310-315`). ADR-676 says the wait is "normally under a millisecond".
  - With a modelled renderer cost of 4 ms per line, the fan stayed at 204 over the stopped head for 226 ms before M107 arrived. Chromium's real per-line cost was not measured.
  - **Refuter:** this matters for the fan dialect only. On inline, every Marlin Abort leaves the cutter lit for about 1 s, as ADR-395 Decision 1 accepts, whatever the backlog. N1-P2-1 is PLAUSIBLE.

**Watchdogs (K2).**
- On the hosted network path, K2-P1-1 (a reply body behind the overdue tick) and K2-P2-1 (the 5 s request abort) no longer apply. The window makes no network request for a hosted session (READ).
- Both remain on the network fallback and opt-out routes, which use unchanged code. K2-P1-2 (the Pause/Resume 2 s timer) is unchanged.

**The quit exit code (coordinator item).** No path was found from #1500, #1509 or #1479 (Refuted).
- #1500 changes no main-process code and creates no worker until a machine connects. The qualification run connected none.
- #1509 and #1479 change only renderer code.
- The failing phase's exit code was never recorded: the harness throws before saving it.

## Matrix

"Before" figures come from K1 (`K1-in-window-stall-beam.md:46-60`) and from the controls re-run on main, which take the same window route. "After" figures are this audit's REPRO (`zz-n1-stall.thread.test.ts`), with a 1,600 ms block for Marlin and 1,000 ms for GRBL, 0.7 s into a fine engrave.

| Transport | Firmware | Power | Before #1500 | After #1500 | Verdict |
|---|---|---|---|---|---|
| USB, unique identity (default) | Marlin, fan dialect | `M106 S204` | Window. Lit 2,160 ms of a 2.3 s stall (K1); control on main: lit **1,423 ms** of 1.6 s | Worker, `acks: marlin`. **Lit 0 ms**; 360/360 G1 once and in order; no warning | **Fixed** |
| USB, unique identity (default) | Marlin, inline (default) | `M3 I` + `S204` | Window. Lit 999 ms (K1); control **1,025 ms** | Worker. **Lit 0 ms**; 360/360 G1 in order | **Fixed** |
| USB, unique identity | GRBL 1.1 | M3 (GRBL Compatible) | Already a worker (ADR-354) | Worker, `acks: grbl`. **Lit 0 ms**; 420/420 G1 | Clean (unchanged) |
| Desktop network, grblHAL raw TCP | grblHAL | M3 | Always the window; lit by K1's static table | Network worker. **Lit 0 ms**; 420/420 G1 | **Fixed** |
| Desktop network, FluidNC telnet | FluidNC (ping-pong) | M3 | Always the window | Network worker. **Lit 0 ms**; 420/420 G1 | **Fixed** |
| Desktop network, worker could not take the session | grblHAL | M3 | Window, Laser log only | Window. **Lit 683 ms**. Toast "Background streaming is unavailable: a busy window can stop the head with a constant-power beam on. Job Review flags affected jobs."; Job Review warning (E-stop wording) | **Warned** |
| Desktop network, Background streaming off | grblHAL | M3 | Window (forced) | Window. **Lit 677 ms**. Log "Background streaming is off in Machine Setup…"; Job Review warning | **Warned** |
| USB, two identical adapters | Marlin inline / fan | `M3 I` / `M106` | Window, no notice | Window. **Lit 996 / 1,370 ms**. Toast + Job Review warning (`LASER_SAFETY_TIMEOUT_MS` / E-stop wording) | **Warned** |
| USB, two identical adapters | GRBL 1.1 | M3 | Window, Laser log only | Window. **Lit 698 ms**. Toast + Job Review warning | **Warned** |
| USB, Background streaming off | Marlin fan / inline; GRBL M3 | constant | Window, no notice (GRBL: none) | Window. **Lit 1,423 / 1,025 / 718 ms**. Log line + Job Review warning | **Warned** |
| USB, worker cannot start | any | constant | Window, Laser log only | Same `backgroundStreamingUnavailable` flag as identical adapters (`web-serial.ts:121-132`), so toast + warning (READ) | **Warned** (READ) |
| Web build, USB | Marlin | constant | Window always | `tryOpenNativeSerialConnection` for Marlin too (`laser-connect-action.ts:307-321`, `web-serial.ts:121-127`); browser toast asks to keep KerfDesk visible (READ) | Fixed (READ); hidden tab not verified |
| any | Smoothieware | any | Window, dark at a stop (K1 refuted the lit claim) | Window, `jobStreamHost: window`, no warning (`window-stream-lit-stop-warnings.ts:56-59`) | Clean |
| any | GRBL family | M4 | Dark | No warning (`stopped-head-power.ts:73-92`; unit test) | Clean |
| **USB worker, after one unmatched `echo:Unknown command`** | **Marlin inline / fan** | constant | (Window anyway) | **Window for the rest of the job. Lit 999 / 1,338 ms.** `jobStreamHost` still `worker`; no toast, no notice | **N1-P1-1** |
| **USB worker, Abort as a stall ends** | **Marlin fan** | `M106` | Head already lit for the whole stall | Worker. The refill stops at +1 ms, but M107 is written only after the backlog: +10–21 ms in Node, no lit stop. With a modelled 4 ms/line, **lit 226 ms** | **N1-P2-1** |

## Findings

### N1-P1-1 — One `echo:Unknown command` that does not match the line in flight hands a Marlin job's refill back to the window for the rest of the run, with no notice; a later stall leaves the beam lit over a stopped head

- **Where:**
  - `src/core/controllers/marlin/hosted-refill.ts:26-30`. `marlinLineStopsHostedRefill` returns true for every `unknown-command` echo, whatever command it names.
  - `src/platform/web/serial-worker-core.ts:254-277`. The worker drops its streamer and program (`stopRefill`), forwards the line, then posts `refill-stopped`.
  - `src/platform/web/worker-refill-handover.ts:80-90`. `refill-stopped` sets `handedOver = false` and the phase to `main`. Nothing is logged.
  - `src/ui/state/laser-unknown-command.ts:38-50` (and header `:8-9`, "any other line's echo stays in the log"). The main thread records the skip only when the echo matches the line in flight (`echoedCommandMatchesLine`). Otherwise the stream goes on.
  - `src/ui/state/laser-stream-ack.ts:138-147`. With the refill no longer armed, `advanceStream` writes each refill itself, from the window.
  - Re-arming happens only at Start, Resume and tool-change Continue (`laser-initial-job-transmission.ts:42`, `laser-job-pause-resume.ts:251`, `laser-job-actions.ts:387`).
  - `jobStreamHost` is set once, at connect (`laser-connect-action.ts:291`), and Job Review reads only that (`window-stream-lit-stop-warnings.ts:35`).
- **Anchor:**
  - **Contract.** ADR-676 Decision 5: "Job Review names a lit stop wherever the window still streams". Consequences: the window routes "now get a connect notice and a Job Review warning before Start, for every job whose power would stay lit".
  - **Contract.** ADR-676 Decision 1 says that after a handback, "The main thread then handles the following `ok` exactly as on the window transport". It does, and it stays the window transport for the rest of the job.
  - **Twin.** Every other reason the Marlin worker hands back ends or pauses the job: `Error:`, `Home XY First`, `Printer stopped…`, `Resend:` and `start`. Their REPRO gave `streamer` null or errored, and no job move after the line. An unmatched unknown-command echo is the only one after which the job keeps streaming.
  - **Ground truth.** Marlin 2.1.2.8 (`1cd56c4c`) echoes the line from its command letter: parser.cpp L390-L392, `SERIAL_ECHO_MSG(STR_UNKNOWN_COMMAND, command_ptr, "\"");`, with `command_ptr = p;` at L133.
    - Over serial, a line that does not start with `N` gets no checksum or line-number check: queue.cpp L473 sets `npos` only for an `N` line, L475-L510 check only `if (npos)`, and L552 queues the line as is. KerfDesk sends no line numbers.
    - So a byte corrupted in the command letter on the UART is queued and echoed under a name that differs from the line KerfDesk sent.
- **Scenario:**
  1. A default Marlin profile (inline `M3 I`, or the fan dialect) on a USB adapter with a unique identity. The job streams from the worker, and Job Review showed no lit-stop warning.
  2. Mid-burn, electrical noise from the laser PSU or the air pump corrupts the `G` of a move on the board's UART. Marlin answers `echo:Unknown command: "1 X99.000 Y50.000"`, then `ok`.
  3. The worker hands the refill back. The main thread sees no match with the line in flight, so it leaves the echo in the console and keeps streaming, now from the window.
  4. Later in the same job the operator drags a selection, presses Undo, or the window stalls for any other reason. The controller runs out of moves.
  5. Result: inline stays lit at S204 until the 1 s safety timeout; fan output stays at 204 for the rest of the stall, or until the E-stop. The operator was told nothing at any point.
- **Evidence:** REPRO, `zz-n1-stall.thread.test.ts`, cases `marlin-inline-nomatch-stall` and `marlin-fan-nomatch-stall`.
  - Same method as #1500's test: the Marlin FIFO model and the production serial worker core on their own `worker_threads` thread, real clock; the real store on the test thread.
  - The echo `echo:Unknown command: "1 X99.000 Y50.000"` was injected 0.5 s into a 360-move engrave; then 300 ms of normal running; then a 1,600 ms synchronous block.
    - Inline: `{"statusAfterInject":"streaming","done":true,"litDuringStall":999,"jobStreamHost":"worker","armAcks":["marlin"],"workerKinds":["write"],"toasts":[],"notice":null,"allLinesOnceInOrder":true}`.
    - Fan: the same, with `"litDuringStall":1338`.
    - After the echo, the only window-to-worker messages were `write`: the window wrote every refill.
  - Controls on the same build:
    - With no echo, the worker path is lit 0 ms (`marlin-inline-worker`, `marlin-fan-worker`).
    - A matching or fatal reply ends the job: `Error:` → job ended, notice `controller-error`, then `M107`, `M410`, `M5 I`; `echo:Home XY First` → the same; `start` → `controller-reboot`. Each had 0 job moves after the injected line.
    - An unmatched echo with no stall (`marlin-inject-unknown`) → `streaming`, 175 more moves written from the window.
  - The trigger was modelled. The echo was injected; corruption on real hardware was not observed.
- **Severity:** P1. The lit stationary beam is wrong physical output (power at a point), and no warning reaches the operator. Job Review said the job runs from a worker, no toast is raised, and the echo is only a console line.
  - It is reachable today: Marlin lines carry no checksum, so any corrupted command letter produces such an echo.
  - §3 has no reach clause, and reach lowers a P1 only when the case is unreachable.
  - The corrupted move itself is silently skipped on both transports (MA-12). That is pre-existing, and not part of this finding.
- **Novelty:** new. `docs/audits/**` has no report of a mid-job handback or a re-arm (searched "Unknown command", "refill-stopped", "re-arm" and ADR-676). No open PR touches these files (only #1478, which is unrelated).
- **Refuter: CONFIRMED, P1 kept.** I tested four ways the finding could be false. None holds.
  - **Marlin's grammar (SOURCE).** I fetched `MarlinFirmware/Marlin` at tag 2.1.2.8, SHA `1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d`.
    - parser.cpp L133 sets `command_ptr = p;` after skipping spaces and an `N` word.
    - A first byte other than G, M or T hits `default: return;` (L266). That leaves the command letter unset.
    - gcode.cpp L1119 then calls `unknown_command_warning()`, which echoes `command_ptr` (parser.cpp L390-L392). L1122 answers `ok`.
    - A corrupted code number (for example `G7`) takes the `G` branch's `default` (gcode.cpp L478) instead.
    - queue.cpp L473-L520 checks a line number and checksum only for a line that starts with `N`. KerfDesk sends neither: `src/core/controllers` has no `M110` and no checksum writer.
    - Result: the echo names the bytes Marlin read, not the line KerfDesk sent.
  - **Modelling artefact (REPRO with a different trigger).** I did not inject an echo. My copy of the thread entry (`zz-n1r-thread-entry.ts`) drops the `G` of the 20th `G1` that the production worker core writes, which models UART byte loss.
    - The FIFO model reads `1 X14.000 Y50.000`. It emits the Marlin echo of that text, then `ok`, and skips the move.
    - Then 1,600 ms of synchronous block, with the real store on the test thread.
    - Inline: lit **1,020 ms**. Fan: lit **1,392 ms**.
    - `jobStreamHost` stayed `worker`. Toasts: none. Safety notice: none. Job Review's lit-stop warnings: 0 before Start and 0 after.
    - After the corruption, the only window-to-worker messages were 343 `write`s. 359 of the 360 `G1` lines arrived; the missing one is the corrupted line, which Marlin skipped. The job ended `done`.
    - Only the block was counted. After it, this PC's ~15 ms Windows timer floor made both the reply delay and each move about 15 ms, so the window path left short lit gaps between moves. That is a model artefact, so those gaps were not counted.
  - **KerfDesk's own output (REPRO, `zz-n1r-marlin-words.test.ts`).** I emitted a 2-pass cut, a raster and a cut through `marlinStrategy`, in both dialects, then ran `createStreamer(...).queued`. The streamed commands are only:
    - `M5 I`, `G21`, `G90`, `M3 I S0`, `G0`, `G1`, `M106 S…` and `M107`;
    - with `; kerfdesk:laser-off-motion` comments, which Marlin strips (queue.cpp `process_stream_char`);
    - the longest line is 47 characters, under `MAX_CMD_SIZE` 96.
  - **Does a stock build reject any of them?** On a stock `LASER_FEATURE` build, every one is known. `G21` is a no-op without `INCH_MODE_SUPPORT` (gcode.cpp L392).
    - A build that lacks `LASER_FEATURE`, a fan or `AIR_ASSIST` echoes the exact line. The window's MA-12 check therefore matches it, and the job stops with a notice. That is not this finding.
    - So routine output never triggers it. A corrupted command letter or code number does, on any Marlin with a UART leg and no checksum.
    - Unverified: an unknown command that the controller injects itself (from an LCD or custom menu) and whose echo reaches the USB port.
  - **Guard or ADR.** I found no guard and no ADR acceptance.
    - Nothing re-arms the worker mid-job. `armHostedRefill` callers: Start, Resume, tool-change Continue, and the CNC pause re-entry.
    - Nothing logs or raises a notice on a `refill-stopped`.
    - ADR-676 Decision 1 lists the handback, but only for replies that end the job.
  - **Severity.** The output is wrong and no warning comes first, so §3 does not allow lowering it.
- **Fix direction:**
  - Let the worker hand back only an echo that matches its own line in flight. It holds `streamer.inFlight[0]`, so it can run the same `echoedCommandMatchesLine` check.
  - Or re-arm (`armHostedRefill`) once the main thread has handled the line and the stream is still `streaming`.
  - At the least, any handback that leaves a live job on the window should set `jobStreamHost: 'window'` and raise the fallback notice.
  - Add the unmatched-echo case to `serial-worker-core.marlin.test.ts`, and a stall after a handback to the thread test.

### N1-P2-1 — Marlin Abort and Disconnect wait for the worker's `released` reply, which queues behind every line the window has yet to process; the worker stops refilling at once, so after a stall the head can stop lit until the stop lines arrive

- **Where:**
  - `src/ui/state/laser-job-stop.ts:159-161` (`runNoResetStop`) and `src/ui/state/laser-disconnect-stop.ts:70-72`. Both `await releaseHostedRefillBeforeStop` before `freezeAndStopWithoutReset` / `stopWithoutResetBeforeDisconnect` writes `M107`, `M410`, `M5 I`.
  - `src/platform/web/serial-worker-core.ts:221-232`. On `release` the worker sets `streamer = null` at once, so it stops refilling, then posts `released`.
  - `src/ui/state/laser-stream-ack-batch.ts:31-41`. While a worker holds the refill, ADR-352's ack batching is off (`!hostedRefillArmed(refs)`). Each forwarded line is its own message and its own store write.
- **Anchor:**
  - **Twin, in the same file.** The GRBL Abort posts its reset before the release. The reason given is the one that applies here: "awaiting the release first only put the Abort byte behind every line the renderer had yet to process, and behind a handshake timer that closes the port" (`laser-job-stop.ts:310-315`, code comment).
  - **Contract.** ADR-676 Consequences: "Each Marlin Abort and Disconnect waits for one worker handshake before its stop lines. That is normally under a millisecond". After a stall it is the whole backlog.
  - **Contract.** ADR-398 Decision 1 ("no planner drain with an M3 beam lit"), which ADR-676 carries to drains caused by a stalled transport.
- **Scenario:**
  1. A Marlin fan or inline job streams from the worker. The window stalls for 1–2 s while the worker keeps the head moving, which is #1500's fix working.
  2. Seeing the frozen window, the operator presses Abort or Ctrl+. (`use-job-shortcuts.ts:95`, the same `stopJob`).
  3. The input runs as the stall ends, ahead of the queued line messages. This assumes Chromium's input priority; the Node REPRO models it by calling `stopJob()` right after the block.
  4. `release` reaches the worker at once, and the worker stops refilling. Its `released` reply waits behind the stall's backlog: about 145 messages for an 11 ms engrave and about 260 for a 6 ms raster line over 1.6 s.
  5. The controller drains its 16 blocks (K1: raster 48–245 ms, engrave 128–200 ms) and stops, still lit.
  6. The stop lines go out only after the window has processed the whole backlog.
  7. If the worker gives no reply at all, the 2 s handshake timer closes the port with no stop line (`worker-serial-connection.ts:119-123`, `worker-refill-handover.ts:107-112`). The fan output then stays lit until the E-stop, behind a "disconnect during job" notice.
- **Evidence:**
  - **READ:** the ordering above.
  - **REPRO** (`zz-n1-stall.thread.test.ts`, case `abort-after-stall`): Marlin fan, `stopJob()` immediately after a 1,600 ms block.
    - With Node's own per-line cost, the worker got `release` at +0–1 ms and the first stop write at +10–21 ms. Lit after the stall: 0 ms.
    - With a modelled extra 1 ms or 2 ms per delivered line, the stop write came at +107 ms or +213 ms. Still 0 ms lit, because this model's moves run on Windows' ~15 ms timer and its drain was about 240 ms.
    - With 4 ms per line: `{"litAfterStall":226,"litStopsAfter":[{"from":236,"to":462,"beam":204}],"releaseAtMs":6,"firstStopWriteAtMs":455}`. The fan stayed at 204 on the stopped head from +236 ms to +462 ms.
    - Window control (opt-out, 1 ms per line): the stop write was immediate, and the only lit stop was the stall itself (1,393 ms).
  - **Scale, not measured for this path.** ADR-352 measured about 0.4 ms of main-thread time per acknowledged line *with* its batching ("19–21%" busy at "~500 acknowledged lines/s", `ADR-352-streaming-job-ui-cost.md:128-131`). Its Amendment 1 Context records "hundreds of full-store notifications in one task" before that batching. The worker path runs without the batching.
  - At 0.4–1 ms per line, a 1.6 s stall on a 6 ms raster gives a 105–260 ms backlog against a drain of about 50–245 ms.
- **Severity:** P2. Abort is slowed by the backlog. The ADR states a bound ("under a millisecond") that is false after a stall. A lit dwell after Abort was shown only with a modelled per-line cost.
  - **Raise to P1** if a Chromium measurement on the worker path shows backlog time above the drain for any shipped dialect. The effect would then be K1's lit stop, triggered by Abort itself.
- **Novelty:** new. The GRBL-side lesson is recorded only as a code comment (above). K1 and ADR-676 do not discuss Abort after a stall.
- **Refuter: PLAUSIBLE, P2 kept.** The mechanism is confirmed. A lit stop at a real per-line cost was not reproduced.
  - **Ordering (READ).** Confirmed at `laser-job-stop.ts:159-162`, `laser-disconnect-stop.ts:70-73`, `serial-worker-core.ts:221-232` and `worker-refill-handover.ts:144-154,181-186`.
  - **REPRO on the real path in Node** (`zz-n1r-stall.thread.test.ts`, `stopJob()` straight after a 1,600 ms block):
    - `release` was posted at +0–1 ms;
    - `released` was delivered at +1–4 ms, behind 97–100 queued line messages;
    - the first stop write came at +2–6 ms.
    - That is about 0.02–0.04 ms per forwarded line: the store alone, with no React subscribers. The fan was lit 0 ms after Abort.
  - **Correction: batching.** Marlin never used ADR-352's batching on either transport.
    - `mayDeferStreamAck` needs `inFlight.length` greater than deferred + 1 (`laser-stream-ack-batch.ts:40`), and ping-pong has one line in flight.
    - So the worker path costs the same per line as the window path did. It is not a regression.
  - **Correction: inline is unaffected.** For inline, the default dialect, the backlog does not change the lit stop.
    - In the inline Abort run, the stop write came at +6 ms, yet the cutter stayed at S204 from +8 ms to +1,023 ms after the block.
    - The reason: `M410` leaves the cutter untouched, `M5 I` waits out the cleaning second, and the 1 s safety timeout ends it.
    - That is what ADR-395 Decision 1 accepts ("switch the laser off within about a second"), and the Abort notice says so (`QUICK_STOP_UNCONFIRMED_MESSAGE`, `laser-safety-notice.ts:262-267`).
    - So N1-P2-1 matters for the fan dialect only, where `M107` goes first.
  - **Chromium estimate (not measured).** ADR-352 measured about 0.4 ms of main-thread time per acknowledged line in Chrome with the UI mounted (19–21% busy at about 500 lines/s).
    - At that cost, K1's 11 ms engrave gives about 145 lines, so about 58 ms of backlog against a drain of 128–200 ms. No lit stop.
    - A fan raster that alternates `M106` and `G1` lines at a ~3 ms ping-pong pace gives about 530 lines in 1.6 s and a short drain. That is an estimated 100–200 ms lit.
  - **Severity.** P2 stays.
    - A dwell under a second sits inside what the Abort notice tells the operator, although the notice itself waits for the backlog too.
    - A fan dwell of a second or more would need a backlog over 1 s, about 2,500 lines at 0.4 ms each.
    - Raise to P1 if Chromium shows a fan dwell longer than the notice's "about a second".
- **Fix direction:**
  - Write the quickstop lines first, as GRBL posts its reset first. The worker already retires its refill on any Marlin write (`serial-worker-core.ts:177-181`).
  - Have `refill-stopped` or `released` carry the worker's stream position, so the window's ledger accounts for lines the worker sent that it has not yet seen (the F1 concern behind the release-first order).
  - Measure per-line cost on the worker path in the e2e harness, and correct the ADR-676 sentence.

### N1-P3-1 — The 90 s acknowledgement-hold containment freezes a Marlin stream without first taking the worker's refill back (twin of Abort/Disconnect)

- **Where:**
  - `src/ui/state/laser-stream-heartbeat-containment.ts:53-79`: `markErrored` happens synchronously, then `requestQueuedStallStop` writes `noResetStopLines` (`:82-98`).
  - Compare `laser-job-stop.ts:150-161` and `laser-disconnect-stop.ts:68-72`, which release first "so the worker cannot send a line this side's frozen ledger does not hold".
- **Anchor:** Twin with the two release-first stop paths; ADR-676 Decision 2 names the F1 hazard.
- **Scenario:**
  1. After 90 s with no acknowledgement, the window marks the stream errored.
  2. If an `ok` reaches the worker before the first stop line does, the worker writes one more job line, which the frozen ledger lacks.
  3. That line's `ok` then settles the `M107` reservation (`laser-stream-ack.ts:61-81`), so the untracked ledger reaches zero one reply early (audit F1 class).
  4. The worker's write-retire rule (`serial-worker-core.ts:177-181`) narrows the window to the time one message takes to cross.
- **Evidence:** READ. Not reproduced: it needs an `ok` within a sub-millisecond window after 90 s of silence.
- **Severity:** P3, latent.
- **Refuter: PLAUSIBLE, P3 kept.** The path is confirmed by reading:
  - The poll tick calls `containStalledStreamAcknowledgements` (`laser-connection-actions.ts:433-435`).
  - Marlin has no reset byte, so the code goes to `requestQueuedStallStop` (`laser-stream-heartbeat-containment.ts:59,79,91-94`), which never calls `releaseHostedRefill`.
  - The race was not reproduced.
  - A line the worker writes in that instant precedes `M410` on the wire. `M410` acts when Marlin reads it, so the extra move is dropped unless it is already running. What remains is the ledger off-by-one.
- **Fix direction:** take the refill back first here too, or adopt N1-P2-1's position-carrying stop.

### N1-P3-2 — Job Review's lit-stop warning tells a "worker could not start" connection to turn Background streaming on, though it is already on

- **Where:** `src/ui/laser/job-review/window-stream-lit-stop-warnings.ts:26-27` (`WORKER_ROUTE`), the same text for every window route.
- **Anchor:** ADR-676 Decision 5, "It also says how to reach the worker".
- **Scenario:** a desktop network session whose worker answered `network-unavailable`, or a USB worker that could not be created.
  - The warning says to turn Background streaming on and reconnect, and on USB to unplug an identical adapter. The setting is already on, and reconnecting meets the same failure.
  - The REPRO shows the same text on the `network-fallback` route.
- A related wording point: ADR-676 says the warning goes "first in the list". It is second when a Frame work-offset warning is present (`job-review-gate.ts:238-242`).
- **Evidence:** READ + REPRO (warning text captured in `grblhal-m3-netfallback`).
- **Severity:** P3, wording. The risk sentence itself is right, and the toast's wording matches what happens on every route run.
- **Refuter: CONFIRMED, P3 kept.** I checked three things.
  - Every window route gets the same `WORKER_ROUTE` text (`window-stream-lit-stop-warnings.ts:26-27,40`).
  - `job-review-gate.ts:238-242` puts the Frame WCS warning in front of the lit-stop warning.
  - ADR-676 Decision 5 says the warning goes "first in the list".
- **Fix direction:** name the route (`backgroundStreamingUnavailable` vs opt-out) in the advice.

### N1-P3-3 — Test gaps in #1500's regression test: no fallback route end to end, no mid-job handback, and an Abort wait with no diagnostics

- **Where:** `src/ui/state/in-window-stall-beam.thread.test.ts:348-404`.
- **Anchor:** Contract, METHOD L7 / AREAS L10 step 5.
- **What is missing:**
  - The identical-adapter, worker-unavailable and network-fallback routes are never run end to end. Their toast and warning are pinned only by unit tests.
  - A mid-job handback (N1-P1-1).
  - FluidNC over the network worker.
  - Abort as a stall ends (N1-P2-1).
- **The CI timeout at `:394`.** The 5 s wait for `pendingUntrackedAcks === 0` timed out once in CI (run 40821212917 attempt 1, job 123273873075, the test took 8,559 ms).
  - It prints no ledger state, so that failure cannot be classified.
  - Locally it drained in **1.05–1.10 s, 8 of 8** (3 runs, then 5 under four CPU-burning processes). The ledger went 3 → 2 → 1 → 0 exactly as `M107`, `M410` (after the model's 1 s quickstop window) and `M5 I` answered, with 0 job moves after `M410`.
  - No drain bug was found.
  - The model's `M410` quickstops twice (on read, and again in its handler), so the expected drain is 1–2 s.
- **Also:** the harness's moves run on Node timers, so on Windows a move shorter than about 15 ms does not run at its modelled length. Raster-speed drains are not represented.
- **Severity:** P3.
- **Refuter: CONFIRMED, P3 kept, with one correction.**
  - **Correction.** #1500's fan case does run Abort as the stall ends: `runStall(MARLIN_FAN, 'usb-worker', { abortAfterStall: true })` calls `stopJob()` straight after the block (`:326`, `:384-395`).
    - What it lacks is any lit-time measure past +50 ms (`:331`), and the stop-write delay.
  - The other gaps hold: no fallback route end to end, no mid-job handback, and no FluidNC network case.
  - CI job 123273873075 is "Unit tests (2/4)", attempt 1, conclusion failure, on `da96551ff`. Its log could not be fetched (`gh api …/logs` returned no log), so the 8,559 ms figure was not re-checked.
  - Add the fallback, handback and Abort-after-stall cases.
  - Note the Windows timer floor in the fixture.

## KNOWN re-observed

- **K2-P1-1 and K2-P2-1** (`2026-10-28-rolling-v6/K2-watchdog-timing.md`, card not started).
  - **Removed on the hosted network path (READ).** The window makes no `fetch` for a hosted session: reads and the 5 s `AbortController` run in the worker (`network-serial-worker-runtime.ts:205-269`). Lines reach the window as worker messages, which Chromium orders ahead of an overdue timer (K2 E1).
  - **Unchanged on the network fallback and opt-out.** `desktop-machine-network.ts:123-143` still long-polls from the window through `machineNetworkRequest` (`desktop-machine-network-api.ts:187-213`). The card is still needed for those routes.
  - **The 15 s lease.** The worker's requests now renew it while the window is hung, so a hung window no longer ends a hosted session. That matches ADR-354's accepted USB behaviour.
- **K2-P1-2** (Pause/Resume 2 s plain timer): transport-independent and untouched by #1500.
- **K1-P3-1** (the buffered-motion advisory never names the lit stop): partly addressed. The new warning names the lit stop on every window route. The throughput advisory's text (`stream-throughput-warnings.ts`) is unchanged.
- **MA-12 design** ("any other line's echo stays in the log", `laser-unknown-command.ts:8-9`): an unmatched echo was never a stream error. N1-P1-1 is about what it now does to the transport.

## Refuted

- **"#1500's worker hosting can make a desktop quit exit with a non-zero code"** (coordinator item, release run 40846112322, phase `historical-reinstall-reopen`). Refuted by READ.
  - #1500 adds no main-process code; its only `electron/` change is a test.
  - The renderer creates a network worker only inside `createNetworkSessionOpener`'s returned function (`network-serial-connection.ts:36-45`), and a USB worker only on connect (`web-serial.ts:121-127`).
  - The qualification phase connects no machine ("No hardware is connected or operated", the phase's `result.json`). Workers in a renderer cannot set the main process's exit code.
  - Electron main has no `worker_threads`, and nothing sets `process.exitCode`. The only `app.exit(1)` calls are a refused debug switch and a failed window creation (`electron/main.ts:118,566`). Neither fits a window that opened, saved and closed.
  - #1509 and #1479 change only `src/` renderer files (`gh pr view`: Design Studio, `use-unsaved-changes-guard.ts`, `desktop-close-*.ts`, `crash-recovery.tsx`).
  - The only main-process quit-time change in 1.0.28 is the camera bridge rewiring (`main.ts:210-217,573-576`, `desktop-camera-bridge.ts`). Its `close` is fire-and-forget in `will-quit` (`application-final-cleanup.ts:16-23`). It is outside N1 and was not verified.
  - **Harness gap.** `Close-UpgradeAppNormally` throws before it records `$app.ExitCode` (`scripts/installed-upgrade-profile.ps1:108-113`), so the failing code is unknown. Recording it would separate a crash (for example `-1073741819`) from a clean `1`.
- **"Status polls or Console lines retire the Marlin refill mid-job"** (ADR-676 Decision 1's main-thread-write rule).
  - Marlin's `M114` poll is sent only with no unsettled stream acknowledgement (`laser-status-polling-policy.ts:28-30`).
  - During a job the Console accepts only `M112` and recovery lines (`console-command-readiness.ts:73-101`; `marlin/console-command.ts:49-56`).
  - Manual air is blocked (`laser-store.ts:494-507`).
- **"Marlin can stream character-counted through the worker"**: Marlin is forced to ping-pong (`controller-streaming-mode.ts:8-21`).
- **"A Worker cannot fetch `app://` in Electron"** (the PR's Not-verified item). REPRO probe in the repo's Electron 44.5.1 / Chromium 152.0.7977.130, with the app's scheme privileges, its CSP and `sandbox`/`contextIsolation`:
  - A module Worker loaded from `app://app/assets/` POSTed to `app://app/api/machine-network/read` with the route header, and got 200.
  - The window's own request also got 200.
  - The copied `trustedAppRequest` check passed for both: `Origin` and `Sec-Fetch-Site` were null.
- **"The flaky `:394` wait is a drain bug after Abort"**: not reproduced, 8 of 8 (see N1-P3-3). The CI cause stays under Not verified.

## Verified clean

- **Test truth.** With the parent's `laser-connect-action.ts` and `desktop-machine-network.ts` swapped in by `vi.mock` (`zz-n1-parent.thread.test.ts`, `N1_PARENT=1`):
  - both Marlin "worker" cases fail: Marlin gets no worker, so the harness never reaches Idle;
  - the network case streams from the window, lit **681 ms** of 1 s, against the test's 25 ms tolerance.
  - Unchanged, #1500's file passes 6/6 on main. On the parent commit it would not even import (`stall-thread-entry.ts` and the network modules are new).
  - **Refuter spot-check: CONFIRMED** for the two Marlin cases. Method: `zz-n1r-parent.thread.test.ts`, a copy of #1500's file with `vi.mock('./laser-connect-action')` pointing at `git show 47ff19d8d^1:…`. The exports are identical.
    - Both Marlin worker cases fail ("timed out", 2 failed, 4 skipped).
    - They time out at the 8 s Idle wait (`in-window-stall-beam.thread.test.ts:313-316`), not at a lit-time assertion. The parent requests no worker for Marlin, so the harness's `usb-worker` thread never forwards a line.
    - The network case was not re-run.
  - **Refuter spot-check of the matrix's "lit 0 ms" on the Marlin USB worker: CONFIRMED.**
    - Fan: 0 ms of a 1,600 ms block.
    - Inline: 0 ms during the block. Its only lit interval begins 8 ms after the block ends, and comes from Abort's quickstop (see N1-P2-1).
- **The Marlin grammar.**
  - `ok` and `ok N.. P.. B..` are acknowledgements; `echo:busy` and position or echo lines are not.
  - `Error:`, `Resend:`, unknown-command, `start`, `FIRMWARE_NAME:`, `Home XY First` and `Printer stopped…` hand back before forwarding (`hosted-refill.ts:22-30`, `response.ts:35-64`).
  - The worker and the window run the same classifier and the same `onAck`/`step`, so their ledgers agree (360/360 lines once and in order in every worker run).
  - No line numbers or checksums are used, so no Resend replay exists to break.
  - `M400`/`M5 I` teardown: the stream is released when it leaves `streaming` (`laser-stream-ack.ts:138-139`), before the post-job settle writes.
- **Pause and Resume.** The worker is released on Pause and re-armed on Resume with `acks: marlin` (`armAcks: ["marlin","marlin"]`). A 1.6 s block after Resume left the head lit 0 ms, with 360/360 G1 in order. Tool-change Continue re-arms through the same `armHostedRefill` (`laser-job-actions.ts:387`).
- **Abort and Ctrl+.** Ctrl+. calls the same `stopJob` (`use-job-shortcuts.ts:95`). Abort after a stall:
  - the worker held the head lit 0 ms during the stall;
  - `M107` came directly before `M410`;
  - 0 job moves came after `M410`;
  - the ledger settled in 1.05–1.10 s (8 runs).
- **Recovery and resume-from-line.** Both start through `laser.startJob` (`start-job-resume-stream.ts:62`, `laser-recovery-flow.ts:307`), so the initial transmission arms with the driver's grammar (`laser-hosted-refill.ts:45-51`; READ).
- **Air assist.** Keep-alive repeats are lines of the emitted program (`grbl-strategy.ts:508`, `air-keep-alive.ts`), so they stream through the worker like any move. Manual air is blocked during a job.
- **The fallback toast's wording against what happens.** On every fallback route run, the toast appeared, the window really streamed, the stall really left the head lit, and Job Review flagged the job. The opt-out logs and does not toast, as ADR-676 Decision 4 says.
- **ADR-676 Decisions 1–4 and 6** match the code, except as noted in N1-P1-1 (Decision 1's handback consequence and Decision 5's "wherever the window still streams") and N1-P2-1 (the Consequences' "under a millisecond").
  - Minor drift: `network-serial-connection.ts:33` says the first read "waits up to a second", while `NETWORK_ATTACH_READ_TIMEOUT_MS` is 2,500 ms.
- **Smoothieware** never requests the worker (`hosted-stream-acks.ts:49-52`) and gets no warning, which is right because it stops dark.
- `armHostedRefill` picks its grammar with its own test (`laser-hosted-refill.ts:50`) rather than `hostedStreamAcknowledgements`. They agree for every driver that can be hosted.

## Not verified

- Hardware: no Marlin, GRBL, grblHAL or FluidNC board. All firmware behaviour comes from the repo's models and pinned Marlin source.
- Chromium's per-line cost on the worker path, which decides whether N1-P2-1 is P1. Also Chromium's input-before-message ordering assumed in its scenario.
- The worker's `app://` fetch in a packaged 1.0.28 build (Electron 44.9.1). The probe used the repo's unpackaged Electron 44.5.1.
- The web build with a hidden or minimised tab on the Marlin worker.
- How often UART corruption produces an unmatched Unknown-command echo on real Marlin laser machines.
- The CI timeout at `in-window-stall-beam.thread.test.ts:394`.
- The non-zero exit code of release run 40846112322 (the code was not recorded; the camera bridge quit path was not examined).

## Repro files (all deleted)

| File | What it did |
|---|---|
| `…\scratchpad\j7-main\src\ui\state\zz-n1-thread-entry.ts` | A copy of `stall-thread-entry.ts` with two additions: a harness `inject` (the controller emits a chosen line) and a FluidNC banner. It also records every window-to-worker message with a timestamp. |
| `…\scratchpad\j7-main\src\ui\state\zz-n1-stall.thread.test.ts` | Ran #1500's method across 22 cases, selected with `N1_CASES`. They cover the USB worker, identical adapters, opt-out, the network worker (grblHAL, FluidNC), network fallback and opt-out, Pause/Resume, injected `Error:`, unknown-command, `start` and `Home XY First`, an unmatched echo then a stall, Abort ×3/×5, and Abort as a stall ends with a modelled per-line cost. |
| `…\scratchpad\j7-main\src\ui\state\zz-n1-parent.thread.test.ts` | The same file, with `vi.mock` swapping in the parent's connect action and desktop network adapter when `N1_PARENT=1` (test truth). |
| `…\scratchpad\j7-main\src\ui\state\zz-n1-parent-laser-connect-action.ts` | `git show 47ff19d8d^1:src/ui/state/laser-connect-action.ts`. |
| `…\scratchpad\j7-main\src\platform\electron\zz-n1-parent-desktop-machine-network.ts` | `git show 47ff19d8d^1:src/platform/electron/desktop-machine-network.ts`. |
| `…\scratchpad\j7-main\zz-n1-cpuhog.mjs` | Burned one CPU core, for the Abort runs under load (four copies). |
| `…\scratchpad\zz-n1-electron\main.cjs` (+ its `userdata\`) | The Electron 44.5.1 probe: a module Worker fetching an `app://` route under `protocol.handle`, with the app's privileges and CSP. |
| `…\scratchpad\zz-n1-ci-job.log` | The CI log of job 123273873075, with escape sequences stripped. |
| `…\scratchpad\j7-main\src\__fixtures__\controllers\zz-n1r-thread-entry.ts` | Refuter. A copy of `stall-thread-entry.ts` that drops the `G` of the Nth `G1` the controller reads, so the Marlin model answers it as a Marlin read error. |
| `…\scratchpad\j7-main\src\ui\state\zz-n1r-stall.thread.test.ts` | Refuter. Five cases, selected with `N1R_CASES`: the corruption plus stall (inline and fan), and Abort straight after the block with message delivery times (inline and fan). |
| `…\scratchpad\j7-main\src\core\output\zz-n1r-marlin-words.test.ts` | Refuter. The commands KerfDesk streams to Marlin in both dialects. |
| `…\scratchpad\j7-main\src\ui\state\zz-n1r-parent.thread.test.ts` + `zz-n1r-parent-laser-connect-action.ts` | Refuter. The test-truth spot-check. |
| `…\scratchpad\zz-n1r-marlin\` | Refuter. Marlin `1cd56c4c` `parser.cpp`, `queue.cpp`, `gcode.cpp`, `parser.h`, `Configuration.h`, `Configuration_adv.h` and `Conditionals_adv.h`, fetched with `gh api` at the SHA. |

Also run unchanged: `src\ui\state\in-window-stall-beam.thread.test.ts` (6/6 on main, 141 s).

```json
[
  {"id":"N1-P1-1","severity":"P1","area":"fix-window-stall","file":"src/core/controllers/marlin/hosted-refill.ts","line":29,"anchor":"Contract: ADR-676 Decision 5 ('Job Review names a lit stop wherever the window still streams') + Consequences (window routes get a connect notice and a Job Review warning); Twin: every other Marlin handback ends or pauses the job; Ground truth: Marlin 1cd56c4c parser.cpp L390-L392 + L133 (echo from command letter), queue.cpp L473-L510, L552 (no checksum without N)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P1: independent REPRO with a modelled UART byte loss (G dropped from the 20th G1, model answers echo then ok) instead of an injected echo: inline lit 1,020 ms / fan 1,392 ms of a 1,600 ms block, jobStreamHost worker, no toast/notice/warning, 343 window writes after; Marlin 1cd56c4c parser.cpp L133/L266/L390-392, gcode.cpp L1119/L1122, queue.cpp L473-L520 re-read; KerfDesk's own Marlin output (M5 I, G21, G90, M3 I S0, G0, G1, M106, M107) never triggers it, corruption does","known":false,"summary":"The Marlin worker hands the refill back on every echo:Unknown command; the main thread ignores an echo that does not match the line in flight and keeps streaming from the window with no re-arm, while jobStreamHost stays 'worker'. After one unmatched echo, a 1.6 s block lit the stopped head 999 ms (inline) / 1,338 ms (fan) with no toast, notice or Job Review warning"},
  {"id":"N1-P2-1","severity":"P2","area":"fix-window-stall","file":"src/ui/state/laser-job-stop.ts","line":159,"anchor":"Twin: GRBL Abort posts its reset before the release because 'awaiting the release first only put the Abort byte behind every line the renderer had yet to process' (laser-job-stop.ts:310-315, code comment); Contract: ADR-676 Consequences ('normally under a millisecond'); ADR-398 Decision 1","evidence":"READ + REPRO (modelled per-line cost)","verdict":"PLAUSIBLE","refuter":"PLAUSIBLE P2: ordering confirmed (Node REPRO: released delivered behind 97-100 line messages, stop write +2-6 ms, fan lit 0 ms); fan dialect only, since inline Abort stays lit ~1 s by ADR-395 Decision 1 whatever the backlog (REPRO +8 to +1,023 ms at S204); Marlin never had ADR-352 batching (ping-pong); Chromium estimate from ADR-352's ~0.4 ms/line: engrave no lit stop, M106+G1 raster ~100-200 ms, inside the Abort notice's 'about a second'; raise to P1 only if Chromium shows a fan dwell longer than that","known":false,"summary":"Marlin Abort/Disconnect await the worker's released reply before writing M107/M410/M5 I; the worker stops refilling at once but its reply queues behind the window's backlog after a stall, so the head drains and stops lit until the stop lines arrive. Node: stop write +10-21 ms, no lit stop; modelled 4 ms/line: fan 204 lit 226 ms. Raise to P1 if Chromium's per-line cost on the worker path exceeds the drain"},
  {"id":"N1-P3-1","severity":"P3","area":"fix-window-stall","file":"src/ui/state/laser-stream-heartbeat-containment.ts","line":66,"anchor":"Twin: Abort and Disconnect take the Marlin refill back before freezing (laser-job-stop.ts:150-161, laser-disconnect-stop.ts:68-72); ADR-676 Decision 2 (F1)","evidence":"READ","verdict":"PLAUSIBLE","refuter":"PLAUSIBLE P3: path confirmed by READ (laser-connection-actions.ts:433-435 -> requestQueuedStallStop, no release for Marlin); race not reproduced; the extra line precedes M410, which acts on read, so the residue is the ledger off-by-one","known":false,"summary":"The 90 s acknowledgement-hold containment freezes a worker-hosted Marlin stream and writes stop lines without releasing first; an ok crossing in that instant lets the worker send a line the frozen ledger lacks (F1 class). Latent"},
  {"id":"N1-P3-2","severity":"P3","area":"fix-window-stall","file":"src/ui/laser/job-review/window-stream-lit-stop-warnings.ts","line":26,"anchor":"Contract: ADR-676 Decision 5 ('It also says how to reach the worker')","evidence":"READ + REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P3: one WORKER_ROUTE text for every route (window-stream-lit-stop-warnings.ts:26-27,40); job-review-gate.ts:238-242 puts the Frame WCS warning first, against ADR-676 Decision 5","known":false,"summary":"For a worker that could not start (network-unavailable, USB worker failure) the warning advises turning Background streaming on and reconnecting, though it is on and reconnecting fails the same way; the lit-stop warning is second, not first, when a Frame WCS warning exists"},
  {"id":"N1-P3-3","severity":"P3","area":"fix-window-stall","file":"src/ui/state/in-window-stall-beam.thread.test.ts","line":394,"anchor":"Contract: METHOD L7 / AREAS L10 step 5","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P3 with a correction: #1500's fan case does Abort straight after the block (:326, :384-395) but measures lit only to +50 ms and not the stop-write delay; the other gaps hold; CI job 123273873075 failure confirmed, its log could not be fetched","known":false,"summary":"#1500's test covers no fallback route end to end, no mid-job handback, no FluidNC network case and no lit measure after an Abort-after-stall; the 5 s ledger wait that timed out in CI prints no diagnostics (locally 8/8 drain in 1.05-1.10 s, 3->2->1->0, no drain bug); Node timers on Windows cannot model sub-15 ms moves"}
]
```
