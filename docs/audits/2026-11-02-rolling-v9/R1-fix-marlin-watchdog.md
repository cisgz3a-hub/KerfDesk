# Rolling audit v9 — R1 Fix verification: the Marlin worker and the watchdogs (#1515, #1527)

- **When:** 2026-11-02 +0800   **Tree:** origin/main @ `e617025eb` (#1527 merged).
  - Merge commits: #1515 `7f34370cd` (parent `08b5c669b`), #1527 `e617025eb` (parent `32faf9fd1`).
  - **Main moved during the audit** to `945aa837b` (#1478, #1531). `git diff --stat e617025eb origin/main` over the Marlin, platform, stop, heartbeat, Pause and fixture files cited here is empty, so every finding holds on `945aa837b`.
  - **Repros ran on main's exact tree.** The scratchpad `j7-main` copy hash-matches the cited files. Commands: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run --config zz-r1-vitest.config.ts <file> --silent=false --disableConsoleIntercept`, one file at a time. The files are listed at the end and were deleted.
- **Scope:** fix verification of #1515 (ADR-676 Amd 1) and #1527 (ADR-356 Amd 2, ADR-398 Amd 6), which fixed v8 N1-P1-1 / N1-P2-1 and v6 K2-P1-1 / P1-2 / P2-1 / P3-1 / P3-2. Also the flaky `in-window-stall-beam.thread.test.ts`.
- **Lenses run:**
  - L10 (all five steps);
  - L6 (what the beam does when a stop or a watchdog acts);
  - L9 (USB worker, window, identical adapters and opt-out by unchanged code, network worker, network window);
  - L4 (injected replies, corrupted lines, stalls of 1.9–9 s, stalls in chains, failed reads and writes).
- **Counts:** 6 raised → 0 refuted → P1 1 / P2 2 / P3 3 (+ 6 KNOWN re-observed, not re-tested by the refuter). Refuter: CONFIRMED 5, PLAUSIBLE 1 (R1-P2-1), REFUTED 0. Severity changes: none.
- **Refuter tree:** `origin/main` `f862d0d8d` (#1528 merged after the audit). It adds a grblHAL held-resume warning and touches `laser-job-pause-resume.ts`, so that file's release line moved from `:105` to `:106`, and `WORKFLOW.md`'s bound moved from `:3381` to `:3396`. No Marlin, worker or network file changed.

## Refuter summary

- **R1-P1-1 stands at P1.** Marlin's own source confirms the skip, and an independent REPRO on KerfDesk's real emitted G-code burns a straight line on both dialects, with the job at `done` and no notice. Nothing warns the operator first.
- **R1-P2-1 is PLAUSIBLE at P2.** The ordering is real, but the auditor's 4 and 8 ms per line are 10–20 times ADR-352's figure. At about 1 ms per line a real fan raster stays lit for 24–80 ms. At Node's own cost it stays lit for 0 ms.
- **R1-P2-2 stands at P2, with one gap closed.** A main-process stall of 5 s or more is now shown in real Electron 44.5.1: a synchronous dialog held for 8.6 s, and the worker-style read aborted at 5,001 ms. The only route found during a job is the "App controls unavailable" dialog, and that dialog names the E-stop first. The "failed write" half is narrower than the auditor wrote.
- **R1-P3-2's cause is stronger than the auditor could show.** The **unmodified** Marlin model hangs by itself on real timers, with no injected early wake and no clock step: 123 of 18,000 trials, in 7 of 15 processes. With the re-armed wake-up: 0 of 12,000.

## Headline

**Both PRs fix what they name, in every repro I re-ran.** Neither introduced a regression, and they do not interfere with each other. What remains is on routes and lines next to the fix.

- **#1515.**
  - A corrupted Marlin line followed by a 1.6 s stall leaves the head lit **0 ms** on both dialects, and the job stays on the worker.
  - Abort and Disconnect put their stop lines on the wire **+0–5 ms** after a 1.6 s stall, at a modelled 0, 4 and 8 ms per forwarded line. Before the fix this was +400 ms at 4 ms per line.
  - No job move follows `M410` in any of 18 runs.
- **#1527.**
  - A healthy job survives stalls of 1.9, 5.4 and 9 s on all three GRBL-family routes, with no reset.
  - Pause and Resume survive 2.1 s and 5 s stalls.
  - A silent controller is still reset: 2.1–2.3 s on USB and the network worker, 4.27 s on the network window route.
  - A controller's boot banner during a 3 s stall is read 10 ms after it ends.
  - The Electron 44 probe, real `app://` bridge and real TCP socket, passes on main.
  - **The "5B + 7 s" bound holds only for stalls of one length.** The worst case by exhaustive search is **5B + 14 s**, and the window network route adds up to 2 s (R1-P3-1).

**Three things are still wrong.**

- **R1-P1-1 (P1).** #1515 keeps the refill through a stray echo, but the echo means Marlin skipped the line. Nothing tells the operator.
  - When the skipped line is the beam-off, a **31 mm line burns across the workpiece**, and the job ends `done` with no notice. Both dialects and both transports do this.
  - When every `G1` is corrupted, 360 echoes arrive, nothing burns, and the job still ends `done`.
  - The code's own comment says the echo "belongs to the oldest line still owed an answer".
- **R1-P2-1 (P2).** Marlin **Pause** still waits for the backlog. N1-P2-1 was fixed for Abort and Disconnect only. Lit over the stopped head: **119 ms and 501 ms** on the fan, at a modelled 4 and 8 ms per line.
- **R1-P2-2 (P2).** The stop-first fix of ADR-398 Amd 6 reaches the **window** network route only. On the default **worker** route a failed read or write closes the session with no reset, and M3 stays lit until the sampling ended.

**The flaky test (R1-P3-2).** Not shown to be a production drain or stop bug, and **not a test too sensitive to general load**: in the failed CI runs the other seven cases ran at normal speed.

- All four failures are the same wait in the same case, after every wire-order and lit-time assertion in that case had passed.
- The test's Marlin model has a one-shot wake-up. If it wakes before the quickstop window ends, `M410` and `M5 I` hang for good (`pending: 2`, ring `["M410","M5 I"]`), which matches the CI timing.
- **What triggers that early wake on CI was not proved.** The test prints nothing when it times out.
- The fix direction is concrete, and I verified the model fix under a modelled early wake.

## Matrix

"Before" figures are from N1 and K2, or from this audit's swap of the parent's source files. "After" figures are this audit's REPRO on main's tree.

| Transport | Firmware | Scenario | Before fix | After fix | Verdict |
|---|---|---|---|---|---|
| USB worker | Marlin fan | 20th `G1` loses its `G`, then a 1.6 s stall | Window for the rest of the job; lit 1,392 ms (N1); parent swap: lit 1,386 ms | Worker; lit **0 ms**; 0 window job writes; `jobStreamHost: worker` | **Fixed** |
| USB worker | Marlin inline | Same | Lit 1,020 ms (N1) | Lit **0 ms** | **Fixed** |
| USB worker | Marlin fan | Abort after 1.6 s, 0 / 4 / 8 ms per line | Parent swap: `M107` +400 ms at 4 ms per line | `M107` **+2 / +1 / +1 ms**; lit 13 / 5 / 7 ms; `stopJob` returns at 8 / 384 / 769 ms | **Fixed** |
| USB worker | Marlin inline | Abort after 1.6 s, 0 / 4 / 8 ms per line | Lit about 1 s (ADR-395 accepts) | Stop lines +0–1 ms; lit 1,007 / 1,002 / 1,005 ms | **Fixed** (accepted residue) |
| USB worker | Marlin fan / inline | Disconnect after 1.6 s, 0 / 4 / 8 ms per line | Behind the backlog (N1) | `M107` +1–4 ms; fan lit 16 / 1 / 12 ms; inline 1,000–1,017 ms | **Fixed** |
| USB worker | Marlin fan | **Pause** after 1.6 s, 0 / 4 / 8 ms per line | Same code | `M107` at **+8 / +384 / +769 ms**; lit **0 / 119 / 501 ms** | **R1-P2-1** |
| USB worker | Marlin inline | **Pause** after 1.6 s, 0 / 4 / 8 ms per line | Same code | `M5 I` at +5 / +385 / +762 ms; lit 4 / 131 / 483 ms | **R1-P2-1** |
| USB worker, window | Marlin fan / inline | **Beam-off line** corrupted | Same on both transports | Echo logged, job `done`, no notice; **31 / 31.2 mm burned on the travel** (clean control 0 mm) | **R1-P1-1** |
| USB worker, window | Marlin fan / inline | Every `G1` corrupted | Same on both transports | 360 echoes, **0 lit blocks, job `done`, no notice** | **R1-P1-1** |
| USB worker | Marlin fan | Injected `Error:`, `Resend:`, `Home XY First` | Ends the job (N1) | Ends the job; stop lines follow; notice `controller-error` | Clean |
| USB worker | Marlin fan | Injected `start`, `FIRMWARE_NAME:` | Ends the job (N1) | Notice `controller-reboot` | Clean |
| USB worker | Marlin fan | Injected `echo:busy`, other `echo:` text | Streams on | Streams on from the worker; 0 window writes | Clean |
| Network window | grblHAL | Healthy job, stall 1.9 / 5.4 / 9 s | Reset at u ≥ 1 (K2); session closed at about 5 s | `streaming`, no reset (M3 lit during the stall: K1, warned) | **Fixed** |
| Network worker, USB worker | grblHAL, GRBL | Healthy job, stall 1.9 / 5.4 / 9 s | Clean by ordering | `streaming`, no reset, lit 0 ms | Clean |
| Network window, USB worker | grblHAL, GRBL | Pause, Resume with a 2.1 s / 5 s stall | Reset with the controller in `Run` (K2) | Confirmed, no reset | **Fixed** |
| Network window, USB worker | grblHAL, GRBL | Pause with a silent controller | Reset at 2 s | Reset at 2,005 / 2,003 ms | Clean |
| USB worker / network worker / network window | GRBL family | Silent controller, no stall | 2.25 s (K2) | Reset at 2,084 / 2,314 / **4,271 ms** | Holds; window route **R1-P3-1** |
| Same three routes | GRBL family | Silent controller, repeated stall B = 2 s | 15.0 s, 4B + 7 s (K2) | 15.5 / 15.5 / 16.3 s | Holds |
| Same three routes | GRBL family | Silent controller, repeated stall B = 5 s | 27 s (K2) | 27.5 / 27.5 / 28.3 s | Holds |
| Network window | grblHAL | Boot banner during a 3 s stall | n/a | `controller-reboot` 10 ms after the stall | Clean |
| Network window | grblHAL | Read fails mid-job | Closed, no stop (K2) | `0x18` at +32 ms, then M5, M9, closed; notice says a reset was requested | **Fixed** |
| **Network worker (default)** | grblHAL | Read fails mid-job | Same | **No `0x18`; M3 lit 2.1 s+ until sampling ended** | **R1-P2-2** |
| **Network worker (default)** | grblHAL | Write fails mid-job | Same | **No `0x18`; M3 lit** | **R1-P2-2** |
| Network window | grblHAL | Write lost before the main process saw it | Closed, no stop | Reset refused out of sequence; session closed; M3 lit | **R1-P3-1** (second part) |
| Window, identical adapters, opt-out, worker cannot start | any | Stall | Lit, warned (N1) | Controls in the unchanged test still lit and warned; routes' code unchanged since `33bc394c6` (`web-serial.ts`, `window-stream-lit-stop-warnings.ts`, `laser-connect-action.ts`) | KNOWN, warned |

### Every timer that declares a job or link lost, after both PRs

| Timer | Applies to | Stall behaviour now | Worst case with the beam on |
|---|---|---|---|
| Active-stream heartbeat, 2 s (`laser-stream-heartbeat.ts:96-100`) | GRBL family only (`laser-stream-heartbeat-containment.ts:110-113`) | A tick ≥ 500 ms late defers its verdict; a gap ≥ 2 s re-opens the window, 3 times | No stall: 2.1–2.3 s (window network 4.3 s). Chained stalls: 5B + 14 s, window network up to 2 s more (R1-P3-1). A frozen page cannot stop the controller sooner |
| Read horizon `inputReadThrough` | Window network only | Silence counts only up to the last completed read's issue time | Adds up to about 2 s, not "about a second" (R1-P3-1) |
| Pause/Resume liveness, 2 s; maximum 30 s | All | Counts on-schedule polling, at most 500 ms per tick; any accepted report restarts it; the 30 s maximum stays wall-clock | Silent controller: 2.0 s. A stall of 30 s or more still fails the transition (not raised) |
| Window request deadline, 5 s / 8 s (`desktop-machine-network-api.ts:22-35`) | Window network | Counts running time, at most 500 ms per step | 5 s of running time |
| Worker request timeout, 5 s (`network-serial-worker-runtime.ts:48-49,245`) | Network worker | Plain timer, unchanged; the worker's thread does not stall with the page. A stall of the Electron main process does reach it | Closes with no stop (R1-P2-2) |
| Failed-read stop wait, 3 s (`desktop-machine-network.ts:12,174-186`) | Window network | Running time | Reset at +32 ms in the REPRO |
| Handover handshake, 2 s (`worker-serial-connection.ts:55`) | Workers | Plain timer; the `released` reply queues ahead of a ripe timer in Chromium (K2 E1) | Stop lines were posted first (READ). A silent worker closes the port |
| Ack hold bar 3 s, containment 90 s | All; the only silence watchdog for Marlin | Unchanged | Marlin reports nothing to poll during a stream, so a hung Marlin gets the bar, then the stop lines at 90 s (KNOWN K2 table) |
| Main-process lease, 15 s | Window network | Unchanged | A page stall ≥ 15 s still closes the socket with no stop (KNOWN) |

## Findings

### R1-P1-1 — An unmatched `echo:Unknown command` means Marlin skipped the job line in flight, yet the job runs on to `done` with no notice; a skipped beam-off burns a straight line across the workpiece

- **Where:**
  - `src/ui/state/laser-unknown-command.ts:48`. `if (!echoedCommandMatchesLine(event.command, line)) return;` drops the echo.
  - `src/core/controllers/marlin/hosted-refill.ts:39-45`. The worker applies the same test and keeps refilling (ADR-676 Amd 1).
  - `src/core/controllers/controller-event.ts:61-72`. The match compares the normalised text. A line that lost a byte can never match its own echo.
- **Anchor:**
  - **Twin, in the same file.** `laser-unknown-command.ts:4-5` says Marlin "runs lines in order, so the echo belongs to the oldest line still owed an answer". Under ping-pong one line is in flight, so that line is the one skipped. The match test then discards this evidence because a corrupted line reads differently.
  - **Contract.** ADR-395 Decision 4: "\"Unknown command\" is a skipped line." It goes on: "During a job the `ok` after it counts as an error". The match test narrows that to echoes that read the same as the line.
  - **ADR-676 Amd 1 Decision 1** records the gap: "The corrupted move itself is still skipped on both transports". An ADR note is not a warning to the operator (METHOD §3).
  - **Ground truth.** Marlin 2.1.2.8 echoes the bytes it read and answers `ok`; a line without `N` has no checksum. N1-P1-1's refuter pinned this at `1cd56c4c` (`parser.cpp` L133, L266, L390-L392; `gcode.cpp` L1119, L1122; `queue.cpp` L473-L520). Not re-fetched here.
- **Scenario:**
  1. A Marlin job with two cut segments, on any transport.
  2. Noise on the UART removes the first byte of the line that ends the first segment: `M107` on the fan dialect, or `G0 X10.000 Y80.000 F6000 S0` on inline.
  3. Marlin answers `echo:Unknown command: "107"`, skips the line and answers `ok`.
  4. KerfDesk logs the echo in the Console and sends the next line.
  5. **Fan:** the travel is planned at fan 204, so the beam burns the 31 mm travel. **Inline:** the travel is gone, and the next `G1 … S204` cuts from the old position to the new one, burning 31.2 mm.
  6. The job ends `done`, with no notice.
- **Evidence:** **REPRO** (`zz-r1-marlin.thread.test.ts`, cases `skip-line`, `every-line`, `every-line-window`). FIFO Marlin model and the production worker core on their own thread, real store, real clock. Lines lose their first byte in the model's write path.
  - Control, nothing corrupted: `burnedMm: 0`.
  - Fan: `{"echoes":["echo:Unknown command: \"107\""],"burnedMm":31,"longest":31,"status":"done","notice":null,"host":"worker"}`.
  - Inline: `{"echoes":["echo:Unknown command: \"0 X10.000 Y80.000 F6000 S0\""],"burnedMm":31.2,"status":"done","notice":null}`.
  - A lost `M106 S204` (fan): half the job is dark, 40 lit blocks of 80, `done`, no notice.
  - **Every `G1` corrupted:** `{"echoes":360,"cuttingBlocksPlanned":0,"status":"done","completed":367,"notice":null}`. The same on the window transport.
  - The trigger is modelled. Real corruption rates were not measured.
- **Severity:** P1. A wrong burn with no warning. §3 has no reach clause. Corruption reachable as N1-P1-1's refuter showed is a live input today.
- **Novelty:**
  - Pre-existing, not a regression of #1515. The window transport behaves the same.
  - N1-P1-1 noted the skip as "pre-existing, and not part of this finding"; ADR-676 Amd 1 repeats it.
  - The 2026-10-20 design audit D-3 (repeated in `C6-ctl-other-drivers.md:476`) records that Marlin lines carry no `N` or checksum, as a transport-integrity improvement.
  - No earlier report measures the burn, or raises that the app holds positive evidence of the skip and discards it. Corruption of a non-first byte gives no echo at all; that remains D-3.
- **Fix direction:**
  - While a ping-pong stream owns the next `ok`, treat every Unknown-command echo as the in-flight line being skipped, whatever its text. End the job through the MA-12 path, naming the echoed text. Both sides can drop the match test; the worker then hands back on every such echo, and the job ends, so N1-P1-1's silent move to the window cannot return. An echo the LCD causes would also stop the job, which is the safe direction.
  - At the least, raise a visible notice when such an echo arrives, and mark the run as having skipped a line.
  - D-3 (line numbers and checksums) stops the corrupted line from running at all.
- **Refuter: CONFIRMED, P1 kept.** The finding would be false if Marlin ran part of the line, if the beam-off were not its own line, if the echo could be matched, or if anything told the operator. None of these holds.
  - **Marlin's source (SOURCE, fetched at `1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d`, tag 2.1.2.8).**
    - [`parser.cpp` L80](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/parser.cpp#L80) starts every line with `command_letter = '?'`. [L133](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/parser.cpp#L133) sets `command_ptr = p`. A first letter other than G, M or T reaches `default: return` ([L266](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/parser.cpp#L266)), so no part of the line runs.
    - [`gcode.cpp` L352](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/gcode.cpp#L352) switches on that letter, the `default` at L1119 warns, and `ok_to_send` follows. So the line is echoed, skipped whole and answered `ok`, as the finding says.
    - `G1` with its digit lost (`G X40…`) also bails with no command letter (parser.cpp, "Bail if there's no command code number"), so it echoes too.
    - [`queue.cpp` L473-L520](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/queue.cpp#L473-L520) checks a checksum only on a line that starts with `N`. KerfDesk sends none.
  - **KerfDesk's output (REPRO, real `marlinStrategy.emit`, two segments).** The beam-off is its own line on both dialects.
    - Fan: `M106 S204 | G1 X40.000 Y50.000 F1500 | M107 | G0 X10.000 Y80.000 F6000 | M106 S204 | …`.
    - Inline: `G1 X40.000 Y50.000 F1500 S204 | G0 X10.000 Y80.000 F6000 S0 | G1 X40.000 Y80.000 F1500 S204 | …`.
  - **Independent REPRO (`zz-r1r-echo.test.ts`).** The real store and the repo's `createMarlinSimulator` with its power oracle, a different harness from the auditor's. The target line was swallowed at the port and answered with the echo and `ok`.
    - Fan, second `M107` lost: burns `[10,50→40,50]`, **`[40,50→10,80]` at 204**, `[10,80→40,80]`. Status `streaming → done`, `safetyNotice: null`.
    - Inline, second `G0` lost: burns `[10,50→40,50]`, **`[40,50→40,80]` at 204**, and the segment at Y80 is never cut. Status `done`, `safetyNotice: null`.
    - The extra length follows the geometry: 42.4 mm and 30 mm here, against the auditor's 31 mm. The effect is the same.
    - Real worker thread (`runStall`, `dropCommandLetterOfMove: 20`): `{"echoes":["echo:Unknown command: \"1 X14.000 Y50.000\""],"status":"done","notice":null,"host":"worker"}`.
  - **What the operator gets.** One Console line of kind `message`. The end state, the notice and the log's `[lf2]` lines say nothing. `WORKFLOW.md:2083-2085` documents this as intended behaviour.
  - **Why the echo cannot match.** Marlin echoes the bytes it read, and the test compares those bytes with the line that was sent. Under ping-pong with `streamOwnsTerminalAck` already true, the oldest owed line is the one line in flight, so reading the text adds nothing. The only other source I can name is a command the LCD injected, which was not measured. The fix direction holds.
  - **The GRBL twin ends the job.** With `error:1` delivered for a line that lost its first byte, the status went `streaming → errored`, the notice was `controller-error`, and `0x18`, `M5`, `M9` went out (REPRO). GRBL answers that way because [`gcode.c` L121](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L121) fails on a word that does not start with a letter. So on GRBL the same byte loss is caught and stopped, whatever the text. Marlin alone runs on. (The repo's `grbl-simulator` accepted `0 X10…` with no error, so I injected the reply. That is a fixture gap and has no effect on production.)
  - **New or KNOWN: new as a finding, adjacent to known items.**
    - The match test dates from `d1928d3d4` (2026-09-25), so it predates #1515, and this is not a regression.
    - ADR-676 Amd 1 Decision 1 says "The corrupted move itself is still skipped on both transports" and Context says "Any other echo stays in the log". That records the behaviour and puts nothing in front of the operator, so METHOD §3 does not let it lower the finding.
    - D-3 says such a byte can become "another move or power, or … a rejected command", and rates it Medium. It does not discuss the echo.
    - No open PR touches these files.
  - **Limit of the fix (D-3, KNOWN, not part of this finding).** Most single-byte losses give the app no evidence at all. Run through the repo's power oracle, the losses that give a wrong burn with no echo include:
    - `G1 … S204` → `S20`, `S24` or `S04`: wrong power;
    - `M106 S204` → `M106 204`: 255, because M106 with no S runs at full speed;
    - `X10.000` → `X10000`: a wrong move;
    - `M107` → `M17`: stops nothing, and M17 is always compiled in ([gcode.cpp L520](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/gcode.cpp#L520)).
    - `M07` and `M10` echo only on a build without `COOLANT_MIST` or `AIR_EVACUATION` (L495-L509).
    - A lost `S` or `0` on KerfDesk's `G0 … S0` is **harmless**: a G0 sets inline power to 0 whatever its S word says (gcode.cpp L243-L247). KerfDesk never uses `G1 … S0` as its beam-off.
    - So the echo fix closes the skipped-line case only, and D-3 remains the whole fix.
  - **Not shown:** a real UART corruption rate. METHOD §3 does not let reach lower a P1 that is reachable today, and no checksum guards this path.

### R1-P2-1 — Marlin Pause still waits for the stall's backlog before its beam-off, so the head stops lit (the twin N1-P2-1 did not cover)

- **Where:** `src/ui/state/laser-job-pause-resume.ts:105` awaits `releaseHostedRefill` first. `:130-147` then freezes the stream and queues the beam-off through `queueStreamPauseBeamOff` (`laser-stream-pause-beam.ts:71-76`).
- **Anchor:**
  - **Twin.** `laser-job-stop.ts:149-155`: the release is posted first, then every stop line. The comment gives the reason: the reply "queues behind every line the worker forwarded while this thread was busy", and "the controller can drain and stop with the beam lit".
  - **Contract.** ADR-395's title says Pause switches the beam off. ADR-676 Decision 2 and Amd 1 Decision 2 name Abort and Disconnect only, and Amd 1 does not list Pause among its follow-ups.
- **Scenario:**
  1. A Marlin job streams from the worker, and the window stalls for 1.6 s. The worker keeps the head moving.
  2. The operator presses Pause as the stall ends.
  3. The worker stops refilling at once. Its `released` reply queues behind the backlog.
  4. The controller drains and stops, still lit. The beam-off is written only when the window has worked through the backlog.
- **Evidence:** **REPRO**, `zz-r1-marlin.thread.test.ts` case `pause`, 1.6 s block, modelled window cost per forwarded line.

  | Cost per line | Fan: `M107` written; lit | Inline: `M5 I` written; lit |
  |---|---|---|
  | 0 (Node's own) | +8 ms; 0 ms | +5 ms; 4 ms |
  | 4 ms | +384 ms; **119 ms** at 204 | +385 ms; **131 ms** |
  | 8 ms | +769 ms; **501 ms** at 204 | +762 ms; **483 ms** |

  The notice text describes buffered motion finishing, and nothing says the beam may dwell.
- **Severity:** P2, as N1-P2-1 was. Lit time was shown only with a modelled per-line cost.
  - The N1 refuter's estimate from ADR-352's 0.4 ms per line: an engrave has no lit stop; a fan raster alternating `M106` and `G1` is lit about 100–200 ms.
  - **Raise to P1** if a Chromium measurement on this path shows a lit stop under a stall a user can hit. Unlike Abort, nothing tells the operator about this dwell, and on the fan dialect nothing times it out.
- **Novelty:** new. N1 checked Pause and Resume only for lit time during a later stall. No open PR touches this path.
- **Fix direction:** the Abort order. Post the release, then the beam-off lines, then wait for the reply before freezing. A Pause has more state after the freeze than Abort does, so the F1 ledger reasoning must be re-checked for it. Add this case to the thread test.
- **Refuter: PLAUSIBLE, P2 kept.** The ordering is confirmed, and a lit stop reproduces only with a modelled per-line cost. The finding would be false if the beam-off went out before the release reply, or if the real backlog cost were always below the drain.
  - **READ.** On main, `laser-job-pause-resume.ts:106` awaits `releaseHostedRefill` before `freezeStreamer` and `queueStreamPauseBeamOff`. #1528 did not change this for Marlin.
  - **REPRO (`zz-r1r-pause.thread.test.ts`), production worker, real store, 1.6 s block, Pause straight after it.** The harness spins on `Date.now()`, so **`lineCostMs: 0.4` and `1` both cost about 1 ms per line on this machine**, measured by the arrival time. The fan raster is real `marlinStrategy.emit` output.

    | Job | Line cost | Beam-off written | Lit over the stopped head |
    |---|---|---|---|
    | Engrave, 11 ms moves, fan | Node's own | +2 ms | 0 ms |
    | Engrave, 11 ms moves, fan | about 1 ms | +100 ms | 0 ms |
    | Engrave, 11 ms moves, inline | about 1 ms | +100 ms | 15 ms |
    | Raster, 6 ms moves, fan | Node's own | +2 ms | 0 ms |
    | Raster, 6 ms moves, fan | about 1 ms (two runs) | +102 ms | 80 and 48 ms at 255 |
    | Raster, 3 ms moves, fan | Node's own | +1 ms | 0 ms |
    | Raster, 3 ms moves, fan | about 1 ms | +103 ms | 24 ms at 255 |

  - **How realistic the cost is.**
    - Node's own is about 0.02 ms per line (99–104 lines in 1–2 ms), the store with no React.
    - ADR-352 measured "19–21%" main-thread busy at "~500 lines/s" with the UI mounted, so at most about 0.4 ms per line, and that includes painting.
    - So the auditor's 4 and 8 ms per line are 10–20 times that figure, and its 119 and 501 ms are not realistic estimates.
  - **What the model understates.** Its backlog is about 100 lines whatever the move time, because it runs on Windows' timer floor. A real 3 ms raster would queue about 530 lines (N1's estimate). At 0.4 ms each that is about 212 ms against a drain of about 48 ms, so an estimated lit stop of 100–200 ms on a fan raster. **This is an estimate, not a measurement.** No cheap way to mount the UI in Chromium on this path was available here.
  - **Why not lower it.** The stop is unwarned. The notice says M107 was queued "to switch the laser off once they finish", and on the fan dialect nothing times the dwell out. It stays lit only until the backlog is worked through, and that is bounded.
  - **Keep the auditor's raise condition:** P1 if a Chromium measurement shows a lit stop.

### R1-P2-2 — On the default network worker route a failed read or write closes the session with no reset, so M3 stays lit; ADR-398 Amd 6 fixed only the window route

- **Where:**
  - `src/platform/web/network-serial-worker-runtime.ts:60`. A `closed` or `read-error` from the core closes the runtime.
  - `:192-196`. A failed write closes at once.
  - `:48-49,245`. A 5 s plain-timer abort on every read and write.
  - `src/platform/web/serial-worker-core.ts:317-333`. The read loop ends and closes both streams.
  - Compare `src/platform/electron/desktop-machine-network.ts:174-186` (`stopBeforeClosing`) and `:119-127`.
  - `connection.beforeReadFailureClose` exists only on the window connection (`laser-stream-heartbeat-containment.ts:175`).
- **Anchor:**
  - **Twin.** The window route on the same failure sends `0x18`, M5, M9.
  - **Contract.** ADR-398 Amd 6 Consequences: "A failure of the window's own path no longer leaves the controller without a stop." Its Decision 4 scopes this: "network sessions streamed from the worker, are unchanged". ADR-356 Amd 2 Decision 5 gives the reason ("its thread is not the one that stalls"), but that holds only for a stall of the page. The same 5 s timer, an unusable reply and a refused write can still fail in the worker.
  - **Context.** ADR-676 made the worker the default, so the route the fix leaves out is the common one.
- **Scenario:**
  1. Desktop grblHAL under M3, default settings, so the worker streams.
  2. The Electron main process does not answer a read for 5 s, or answers with an unusable reply.
  3. The worker closes the session. The socket closes with no stop.
  4. The controller runs out its planner and stays lit at S on the stopped head, with no host left.
  5. The operator sees "Network connection was lost during an active job… Use physical E-stop". That is honest, but it comes after the event.
- **Evidence:** **REPRO**, `zz-r1-network.thread.test.ts`, cases `readfail-*` and `writefail-*`. Same model, session route faked in the thread, production runtime.
  - Worker, read rejects: `{"status":"disconnected","notice":"disconnect-during-job","reset":false,"nonJob":[],"litAfter":2141,"beamAtEnd":800}`. Sampling ended at 2.5 s, still lit.
  - Worker, unusable reply: the same, `litAfter: 2150`.
  - Worker, write rejects: `reset:false`, lit at 800.
  - Window, read rejects: `{"reset":true,"nonJob":[[32,"\u0018"],[526,"M5"],[541,"M9"]],"litAfter":478}`.
  - **A stall of the Electron main process was not measured.** The failure was injected at the route.
- **Severity:** P2, the same rating and reasoning as K2-P2-1. The effect under M3 is P1-class, but a notice names the E-stop as the session closes, and no ≥ 5 s main-process stall has been shown. **P1 if one is shown** during a job, and no notice will have come first. Under M4 it is a false link loss with a dark head.
- **Novelty:** new as a finding. The scope line is in ADR-398 Amd 6, but K2-P2-1's fix direction did not name this route, and no audit has run it.
- **Fix direction:** give the worker runtime the same stop before it closes. On a read failure, report it to the window and wait for the store's reset (`beforeReadFailureClose`), bounded by the same 3 s. On a failed write, keep the session open as the window's generation counter does. The worker's 5 s timer can stay, since the failure is real there.
- **Refuter: CONFIRMED, P2 kept, with the scenario corrected.** The finding would be false if closing the socket stopped the beam, if the worker were not the default, or if no worker request could fail while the socket lived.
  - **Closing the socket does not stop the beam (SOURCE).**
    - grblHAL: [`telnetd.c` `streamClose` L239-L249](https://github.com/grblHAL/Plugin_networking/blob/e0131fb21995d8a76be8abaf5cbc8a4bfce1b940/telnetd.c#L239-L249) flushes the rings and calls `stream_disconnect`. In core, [`stream.c` L524-L528](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/stream.c#L524-L528) only deselects the stream. There is no hold or reset. D7 found no plugin hooking `on_stream_changed`, which I did not re-search.
    - FluidNC: [`TelnetClient.cpp` L47-L56](https://github.com/bdring/FluidNC/blob/ffad1dc7df189059abafc5292bd7716f3369696e/FluidNC/src/WebUI/TelnetClient.cpp#L47-L56) queues a kill, and [`Serial.cpp` L205-L213](https://github.com/bdring/FluidNC/blob/ffad1dc7df189059abafc5292bd7716f3369696e/FluidNC/src/Serial.cpp#L205-L213) deregisters the channel. No stop.
  - **The worker is the default (READ).** `src/ui/app/main.tsx:79` passes `createNetworkSessionOpener()`, `laser-connect-action.ts:317-318` asks for hosted streaming unless the option is `false`, and `connect-options.ts:27` passes the profile's opt-out.
  - **Why the routes differ (READ).** The reset is the store's decision, and only the window connection has `beforeReadFailureClose`. ADR-398 Amd 6 Decision 4 scopes the worker out on purpose. ADR-356 Amd 2's reason is "its thread is not the one that stalls". That covers a page stall and does not address a main-process stall. **So this is a twin gap and not a broken contract:** the Consequences sentence the finding quotes is about "the window's own path".
  - **REPRO of the runtime (`zz-r1r-worker.test.ts`, production runtime, faked routes).**
    - Read rejects: `{"writes":["G1 X1 S800\n"],"tailActions":["write","close","close"],"posted":["network-ready","write-ack","closed"],"resetSent":false}`.
    - Unusable reply: the same.
    - Write rejects: `posted` adds `write-error`, then `closed`, with `resetSent: false`.
    - **Overlong line (400,000 bytes with no newline): the session stays open.** So the window route's overlong-line trigger does not apply here.
  - **Correction: "write fails" is narrower than written.** When the main process refuses a write (out of sequence, queue limit, socket error), `MachineNetworkSession` destroys the socket itself (`machine-network-session.ts:69-96`), so **no route can send a stop**. The routes differ only when the request fails between the worker and the main process.
  - **A main-process stall of 5 s or more is now shown (REPRO, Electron 44.5.1).** A probe page ran a worker fetching a `protocol.handle` route with KerfDesk's 5 s `AbortController`, about 9 reads per second.
    - `dialog.showMessageBoxSync` held open: `{"heldMs":8642,"servedDuringDialog":0}`, `{"fail":"AbortError","waited":5001}`, main timer gap 8,695 ms. **Every sync dialog stalls this route, and the read fails at 5 s.**
    - Native window-move loop for 7 s (`GUI_INMOVESIZE` confirmed by `GetGUIThreadInfo`, flags `0x2`): reads steady at 9 per second, no gap. Moving the window is not a trigger.
  - **Which sync dialogs can open during a job (READ).**
    - An ordinary close stops first: `desktop-close-controller.ts:107` runs `stopForAttempt` when the attempt `wasActive`, and the unsaved dialogs open only after the renderer answers `ready`. Not a trigger.
    - `decideUnavailable` (`desktop-window-close.ts:89-102`) opens when the renderer is flagged unresponsive (`window-close-guard.ts:56,101`) and the operator clicks close. A hung page with the worker still streaming is exactly when an operator does that. **This route was read, not run with a job.**
    - That dialog says "Software Abort and saving cannot be confirmed" and names the E-stop, **before** the 5 s runs out. So the one route found has a clear warning first, and METHOD §3 keeps it at P2. No main-process stall with no warning first has been found.
  - **Limit of the fix.** The stalled main process also carries the socket, so nothing reaches the controller until the dialog closes, whichever route streams. A worker-side stop helps only from then on. Refilling also stops during the dialog, so under M3 the head stops lit for that time on any route.
  - **Keep the raise condition:** P1 if a main-process stall of 5 s or more during a job is found with no warning first.

### R1-P3-1 — The late-detection figures in ADR-356 Amd 2 and WORKFLOW are low, and a lost write can still leave ADR-398 Amd 6's stop refused

**Part 1, the bound.**
- **Where:** `docs/decisions/ADR-356-amendment-2-a-late-tick-does-not-judge-its-own-gap.md` (the table and "Other detection costs"), `WORKFLOW.md:3381`, `src/ui/state/laser-stream-heartbeat.ts:96-100`.
- **Anchor:** Contract. WORKFLOW: "delays detection to at most 5B + 7 s". ADR-356 Amd 2: "up to about a second later".
- **Evidence:** REPRO. `zz-r1-walk.test.ts` searches every tick-gap sequence through the real `detectActiveStreamHeartbeatLoss`.
  - **Stalls of one length: the claim is exact.** B = 2 / 3 / 5 / 10 s gives 17.0 / 22.0 / 32.0 / 57.0 s.
  - **Mixed stalls: higher.** A 1,999 ms stall before each grace stall gives **24.0 / 29.0 / 39.0 / 64.0 s**, about **5B + 14 s**: `1999×2 B 1999×2 B 1999×2 B 1999 B×2`. Each late tick under 2 s defers without using a grace, which is new in this PR.
  - **The table's row "500 ms to under 2 s: 1.75 s + 2B"** is low for B above 1.75 s. B = 1,999 ms gives 5,997 ms (3B), against the stated 5,748 ms.
  - **Window network, measured:** silent controller with no stall, reset at **4,271 ms**, against 2,314 ms on the worker. So the cost is up to about 2 s, not about a second. The read horizon is the issue time of the last *completed* read, and an empty read takes up to 1 s. So the horizon passes `at + 2 s` only when a read issued after that time comes back. The PR's own probe shows tick 13.
  - With a real page, the three-route runs at B = 2 and 5 s are within the claim (table above).
- **Severity:** P3. The numbers apply only to a page that is already stalling repeatedly, and such a page cannot stop the controller sooner.
- **Fix direction:** state "5B + 14 s, plus up to 2 s on the window network route", or cap the graces by elapsed time. Add the mixed walk to the test.

**Part 2, the reset that cannot go out.**
- **Where:** `src/platform/electron/desktop-machine-network.ts:112-126`, `electron/machine-network-session.ts:71-74`.
- **Anchor:** Contract. ADR-398 Amd 6 Consequences (quoted above). Its Decision 1 does say the main process closes a session whose write it refused.
- **Scenario:** a write's request fails before the main process handled it. The window has already spent that sequence number. The store's reset goes out numbered after it, the session refuses it as out of order and destroys the socket. The controller gets no stop.
- **Evidence:** REPRO with the session's sequence rule modelled in the thread (case `writefail-network-window`): `{"notice":"write-failed","reset":false,"nonJob":[[5041,"[main closed session: out of sequence]"]]}`, M3 lit. The real session's `write` was read, not run. Whether Chromium can drop such a request before `protocol.handle` runs was not measured.
- **Severity:** P3. Same outcome as before the PR, an honest notice, and a narrow trigger.
- **Fix direction:** let the failed write's number be re-used only when the main process confirms it never saw it, or give the main process a reset route outside the write sequence.

**Refuter: CONFIRMED, P3 kept** (Part 1 by REPRO, Part 2 by READ).
- **Part 1.** My own walk (`zz-r1r-walk.test.ts`) through the real `detectActiveStreamHeartbeatLoss` with the auditor's sequence gave **23,993 / 28,993 / 38,993 / 63,993 ms** for B = 2 / 3 / 5 / 10 s, against 5B + 7 s = 17 / 22 / 32 / 57 s. Three stalls of 1,999 ms gave 5,997 ms against the table's 5,748 ms. On main the WORKFLOW line is `WORKFLOW.md:3396`. The window network figure of 4,271 ms was not re-run. The read-horizon code matches the explanation (`desktop-machine-network.ts`, `readThroughAt = issuedAt` after a completed read).
- **Part 2.** `desktop-machine-network.ts` increments `this.sequence` before the request, and `machine-network-session.ts` closes the session when `sequence !== this.nextWrite`. So a write the main process never saw makes the next write fail, as described. Not run, and the same trigger gap applies: whether Chromium drops such a request was not measured.

### R1-P3-2 — The flaky test: the Marlin model's quickstop has a one-shot wake-up that can hang for good, and the failing wait prints nothing

- **Where:**
  - `src/__fixtures__/controllers/marlin-fifo-model.ts:209,212` (one `setTimeout(service, 1000)` per quickstop), `:291-292` (`drained` reads `Date.now()`), `:314-320` (`runM410`), `:376-379` (`runRing` returns when blocked).
  - `src/__fixtures__/controllers/stall-thread-harness.ts:194-200` (`until` throws a bare `timed out`).
  - `src/ui/state/in-window-stall-beam.thread.test.ts:102`.
- **What CI shows.** I read the failed job logs of four attempts:

  | Run, attempt 1 | PR head | Time (UTC, 2026-10-29) | Line |
  |---|---|---|---|
  | 40821212917 | #1513 `da96551ff` | 05:05 | `:394` (before the harness moved) |
  | 40898162755 | #1520 `0d8c3d8c7` | 15:12 | `:102` |
  | 40905581021 | #1522 `cd874ce6c` | 15:57 | `:102` |
  | 40906526341 | main, #1521 merge `5b4c82caa` | 16:22 | `:102` |

  - **Always** "Marlin fan output over a worker-owned USB port never stops lit, and Abort stops clean", at the `pendingUntrackedAcks === 0` wait, with "Error: timed out". Every wire-order and lit-time assertion before it had passed.
  - The failing case took **8,555 ms** (run 40898162755), so it spent the full 5 s. Its seven neighbours in that file took their usual 4.4–6.2 s. **So the runner was not generally slow.** Normally this wait takes about 0.84 s (20 of 20 locally).
  - `gh run list --workflow CI` shows no re-attempted run after 2026-10-29 in the last 100 runs. All four fell within about 12 hours. The later case with the same wait (`:159`) has not failed, on a small sample. I cannot explain that.
- **Candidate mechanism, shown by REPRO but not proved to be the CI cause.**
  - `quickstop()` sets `discardMovesUntil = Date.now() + 1000` and arms one 1,000 ms timer.
  - If that wake-up runs while `Date.now()` is still short of the deadline, `runM410` returns false and `runRing` returns. Nothing wakes the model again.
  - REPRO (`zz-r1-flaky.thread.test.ts`): the 1,000 ms timer made to fire 40 ms early gives `{"timedOut":true,"waitMs":5017,"pending":2,"status":"cancelled","inFlight":0,"ring":["M410","M5 I"],"discardIn":-4235}`. The wire shows `M107`, `M410`, `M5 I`, as in CI. That is the same failure shape.
  - **The same model with a re-armed wake-up passes:** `{"timedOut":false,"waitMs":858,"pending":0}`.
  - **What I could not show.** A shortfall on a real Linux runner. By my reading of Node's timers, the 1 ms `setTimeout(0)` hop gives a small positive margin when the wall and monotonic clocks agree, so it would need a wall-clock step or a coarse monotonic clock. There is no Linux here (WSL is not installed). Windows' timer floor hides the case: a 3 ms early timer did not hang, and neither did a modelled 5–60 ms preemption.
- **Tried, with no hang:** 20 of 20 under four CPU-burning processes with the controller thread randomly descheduled up to 6 ms; 4 of 4 full-file runs under three burners; 3 of 3 of the case alone.
- **One unexplained local failure.** One of about nine full-file runs on main failed this same case in **3,632 ms**, so not at the 5 s wait. My output filter dropped the assertion text, and 8 further runs passed. A likely candidate, not verified: `litDuringStall < 25` measures to `stall.to + 50`, which includes Abort's own lit residue of 13–21 ms measured here.
- **Verdict.** Test fragility, not a shown production bug. A ledger bug on the main thread cannot be excluded outright, because the test prints no state. The reading above found no path: every reply is reserved before its write (`laser-write-reservation.ts:34-38`), replies settle in order, and every other local run settled at 0.
- **Severity:** P3. It blocks merges, since every merge waits on CI, though CI's re-run clears it.
- **Fix direction:**
  1. In the model, re-arm while the quickstop window is open. In `runRing`, when blocked and `Date.now() < discardMovesUntil`, call `setTimeout(service, remaining + 1)`. I verified this on a copy.
  2. Have `until` take a `describe()` callback, and print `pendingUntrackedAcks`, the stream's `inFlight`, and the model's ring and `discardIn` on timeout. The next failure then classifies itself.
  3. Measure `litDuringStall` to `stall.to` on the Abort case. It uses `+ 50` for the non-Abort runs, and Abort's residue has its own measure in the later case.
  - **Test gaps still open (N1-P3-3 and this audit):** no Pause after a stall, no worker-route read failure, no fallback route end to end, no FluidNC network case, no corrupted beam-off. #1515 added the mid-job handback and the Abort-after-stall cases.
- **Refuter: CONFIRMED, P3 kept, and the candidate mechanism is now shown without injection.** The finding would be false if the unmodified model could not hang by itself, or if re-arming could hide a real ledger bug.
  - **The model hangs by itself (REPRO).** The file was copied byte for byte from `marlin-fifo-model.ts` and run on real timers in plain Node, with `M107`, `M410`, `M5 I` written as Abort posts them. A `setImmediate` loop keeps the event loop from sleeping, which removes Windows' ~15 ms timer floor, so timers fire at millisecond edges.
    - **Unmodified: 123 of 18,000 trials hung, in 7 of 15 processes** (for example 32 of 1,200 and 82 of 1,200; eight processes had none).
    - Every hang had the CI shape: one `ok` (M107), then only `echo:busy: processing`, so M410 and M5 I were never answered.
    - **Re-armed, as the fix direction says: 0 of 12,000, in 10 processes.**
  - **The cause (REPRO in a counted bare-Node copy of the sequence, 7 hangs in 6,000 trials, in 1 of 4 processes, with no clock step).**
    1. The `M410` is read and runs `quickstop()`, arming wake W1.
    2. One hop later the ring's `M410` runs `quickstop()` again. That moves the deadline and arms W2, usually 1 ms later.
    3. W1 fires and `service()` schedules hop H, setting `servicePending`.
    4. **W2 fires while H is pending, and `service()` drops it** (`marlin-fifo-model.ts:363-364`).
    5. H runs inside the same millisecond as the deadline. `Date.now()` reads the wall clock and the timers read the monotonic clock, and their sub-millisecond phase is fixed per process, so H can land just short of the deadline. `runM410` returns false, and no wake-up is left.
    - That phase explains why it comes and goes per process, and why it could cluster.
    - **This replaces the report's "it would need a wall-clock step or a coarse monotonic clock".** That was right for a single wake-up, but it missed the dropped second one.
  - **Not proved:** that this exact path is CI's. CI runs Linux on Node 22 and I ran Windows on Node 25 with the floor removed. The timer code is the same design, and the outcome matches CI's failures.
  - **Re-arming hides nothing.** Real firmware polls: `planner.synchronize()` loops in `idle()` until `Planner::busy()` clears, as the model's own header says, so a re-arming model is closer to Marlin. The wait is on the store's ledger reaching 0, so a ledger bug on the main thread would still time out with the re-armed model. Only the model's own lost wake-up goes away.
  - **"Not a production bug" is supported.** The hang is inside the test fixture, and it is the fixture that stops answering. Production code has no such model. This does not exclude a separate ledger bug, so the `describe()` diagnostic in the fix direction is still worth adding.

### R1-P3-3 — ADR-356 Amd 2 says the fixes were not run in Electron, though its own PR adds and runs a probe

- **Where:** `docs/decisions/ADR-356-amendment-2-…md`, Verification: "These fixes were not run in Electron or Chromium". Compare `electron/machine-network-stall.electron-probe.test.ts` and #1527's body, which reports its results.
- **Evidence:** READ, and REPRO of the probe on main: five trials as the PR states, including `silent controller, 1.9 s stall` lost at tick 13.
- **Severity:** P3, doc drift. The file's cover note understates the verification, which errs the safe way.
- **Fix direction:** one sentence in the amendment.
- **Refuter: CONFIRMED, P3 kept** (two independent READs; the probe was not re-run). The amendment's line 155 says "These fixes were not run in Electron or Chromium". The probe file exists on main (265 lines), and #1527's body says it "runs Electron 44.5.1 (Chromium 152)". The amendment errs on the safe side.

## KNOWN re-observed

- **N1-P3-1** (90 s hold containment takes no release first): unchanged, listed as a follow-up in ADR-676 Amd 1. `laser-stream-heartbeat-containment.ts:55-102`. READ.
- **N1-P3-2** (Job Review's route advice): unchanged, listed as a follow-up.
- **K1 window routes** (lit stop during a stall, warned): the unchanged test's controls still pass. Network window lit 1.6 / 5.1 / 8.7 s of 1.9 / 5.4 / 9 s stalls, with the job kept. That is the ADR-676 warning's case.
- **15 s renderer lease** (controller-v3 D7, rolling-v2 04-P3-23): "Unchanged" in ADR-356 Amd 2. A window-route stall ≥ 15 s closes the socket with no stop. READ, `electron/machine-network-bridge.ts:60-67`.
- **K2-P3-2's clock:** `Date.now()` stays; the ADR says so. A forward step now defers rather than declares (walk). The task-order dependence is gone (Refuted below).
- **Design audit D-3:** no `N` or checksum on Marlin lines. See R1-P1-1. Open PR #1528 was not audited, and nothing here depends on it.

## Refuted

- **"A deferred tick leaves a true controller reset undetected for longer."** Refuted by REPRO. A reset is a line, not a silence: a banner during a 3 s stall gave `controller-reboot` 10 ms after the stall.
- **"A dead link is now undetected for materially longer on the default routes."** Refuted. USB worker 2,084 ms, network worker 2,314 ms, against 2.25 s before. A single stall under 2 s costs one more tick.
- **"A refill line can land after the stop lines."** Refuted. `release` is posted before the stop lines over one ordered port, and the worker clears its streamer on it (`serial-worker-core.ts:221-232`). 0 job moves after `M410` in 18 runs. `M107`, `M410`, `M5 I` are contiguous in each.
- **"The window writes a refill during the backlog of a release."** Refuted by READ. `isArmed` stays true until `released` (`worker-refill-handover.ts:67,181-186`), so `advanceStream` writes nothing.
- **"A job reply can settle a stop line during the backlog."** Refuted. The stream owns terminal acks while `streaming` (`laser-store-helpers.ts:199`, `laser-stream-ack.ts:44-50`), and each run ended with the ledger at 0.
- **"A matching echo, `busy`, `Error:`, `Resend:` or a banner now behaves differently on the worker."** Refuted by the `inject` cases (matrix).
- **"The flaky wait comes from a slow runner."** Refuted as stated: its neighbours ran at normal speed (R1-P3-2).

Refuted by the refuter (sub-claims and candidate triggers; no whole finding was refuted):

- **"The model's early wake needs a wall-clock step or a coarse monotonic clock"** (R1-P3-2, the auditor's "What I could not show"). Refuted by REPRO: the unmodified model hangs with no clock step, because the second wake-up is dropped while a hop is pending.
- **"A lost `S0` on the beam-off line leaves the beam on."** Refuted. KerfDesk's inline beam-off is `G0 … S0`, and a G0 sets inline power to 0 whatever its S word says (`gcode.cpp` L243-L247 at `1cd56c4c`).
- **"The modelled 4 and 8 ms per line are a realistic Pause cost"** (R1-P2-1's table). Refuted as an estimate: they are 10–20 times ADR-352's upper figure. The table stays as a sensitivity sweep.
- **"An unsaved-changes dialog stalls a running network job when the operator closes the window."** Refuted by READ: the close stops the job first, and that dialog opens after the renderer answers `ready`.
- **"Dragging the window stalls the main process, so the worker's read times out."** Refuted on Windows by REPRO: 7 s in the native move loop, reads steady at 9 per second.
- **"An overlong controller line closes the worker's session with no stop."** Refuted by REPRO: 400,000 bytes with no newline left the session open.
- **"A write the main process refused could still carry a stop on the window route."** Refuted by READ: the session destroys the socket itself, so R1-P2-2's write case holds only for a request that fails before the main process answers.

## Verified clean

- **Test truth, #1515.** With the parent's five source files swapped in:
  - the corrupted-line case fails (`expected 1386 to be less than 25`);
  - the Abort case fails (`expected 400 to be less than 100`);
  - `serial-worker-core.marlin.test.ts`, `laser-job-stop-write-race.test.ts` and `laser-disconnect-hosted-handback.test.ts` each fail their new or changed case.
- **Test truth, #1527.** With the parent's ten source files swapped in: heartbeat host-gap 7 of 9 fail; Pause/Resume host-gap 5 of 5; network job-stop 2 of 2; network host-gap 5 of 6; heartbeat 7 of 18; poll schedule 3 of 6. All pass on main.
- **The Electron probe on main.** Late reply with 1.8 / 1.9 / 1.95 s stalls and a 5.4 s stall: not lost, not closed, 15–16 lines after the stall. Silent with a 1.9 s stall: lost at tick 13.
- **ADR-676 Amd 1** matches the code: the echo test on the oldest in-flight line; release, then stop lines before the first await; the freeze after the reply; Disconnect's epoch bump and its write bound after the reply; `releaseHostedRefillBeforeStop` removed. Its statement that the notice and freeze still wait for the backlog is right: `stopJob` returns at 384 / 769 ms at 4 / 8 ms per line.
- **ADR-356 Amd 2** Decisions 1–5 match the code. Its figures are in R1-P3-1. The 500 ms step cap in `runningTimeDeadline` and the 500 ms tick cap in `onSchedulePollTimeAt` are as stated.
- **ADR-398 Amd 6** Decisions 1–4 match the code, including its scope line.
- **Interaction of the two PRs.** They meet only in stop paths for different drivers: #1515's no-reset stop is Marlin's, #1527's containment resets the GRBL family, and `observeTransportFaults` was moved with its behaviour kept for the worker's write error. No case ran differently with both present.
- **Stop lines with a dead worker (READ).** A failed post calls `fail` (`worker-refill-handover.ts:130-142`), and `close` finishes the pending release (`:92-96`), so the stop does not hang. A silent worker closes after 2 s with the lines already posted. Each failed line is reported. Not run.
- **Air assist and keep-alive through a stall (READ).** Keep-alive lines are program lines and stream with the job. `noResetStopLines` adds `M9` when the program has `M7` or `M8`, and it is posted with the others. On a read failure, M5 and M9 went out at +526 / +541 ms behind the banner deadline. Neither PR changed these.
- **Marlin tool change and teardown (READ).** The stream is released as soon as it leaves `streaming` (`laser-stream-ack.ts:138-139`); unchanged.

## Not verified

- Hardware: no Marlin, GRBL, grblHAL or FluidNC board. Firmware behaviour comes from the repo's models.
- A real renderer's cost per forwarded line, which decides whether R1-P2-1 is P1. The per-line costs used are modelled.
- A stall of the Electron main process of 5 s or more during a job, which decides whether R1-P2-2 is P1.
- A real UART corruption rate, and any LCD-caused Unknown-command echo reaching USB (R1-P1-1's fix would stop such a job).
- The CI cause of the flaky wait (R1-P3-2): no Linux here, and the failing wait prints no state. The one local 3,632 ms failure was not captured.
- A backlog longer than the 2 s handshake. An attempt at 20 ms per line finished the job before the stall, so it says nothing. Chromium's order is K2's finding, not re-measured.
- The packaged desktop app. The Electron probe ran the real routes, bridge, session and connection, on the repo's Electron.
- The USB worker's non-recoverable read end, which also closes with no stop line (`serial-worker-core.ts:327-333`). READ only: there the port itself has usually gone.
- **Refuter:**
  - a real job through the "App controls unavailable" dialog (R1-P2-2's route was read, and the stall was measured on a probe page);
  - the flaky hang on Linux and Node 22;
  - a Chromium per-line cost with the UI mounted;
  - any plugin hook on grblHAL's `on_stream_changed` (D7's search not repeated);
  - the six KNOWN items, which were not re-tested.

## Refuter method

Fresh context, no sight of the auditor's reasoning beyond the report. Run on `j7-main` at `f862d0d8d` with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048"`, one file at a time, with a `zz-r1r-vitest.config.ts` alias for `fflate`. No hardware was operated.

| File (all deleted, by literal path) | What it did |
|---|---|
| `src\ui\state\zz-r1r-echo.test.ts` | Real `marlinStrategy` and `grblStrategy` output. Lost each byte of each line through the repo's power oracle. Real store with `createMarlinSimulator` and a swallowed beam-off. GRBL twin with `error:1`. |
| `src\ui\state\zz-r1r-pause.thread.test.ts` | Production worker, real store, `runStall` with Pause in Abort's place. Engrave and real fan raster at Node's own cost and about 1 ms per line. Worker echo case. |
| `src\platform\web\zz-r1r-worker.test.ts` | Production network worker runtime on a fake route: read rejects, unusable reply, write rejects, overlong line. |
| `src\ui\state\zz-r1r-walk.test.ts` | The auditor's mixed stall sequence through the real heartbeat. |
| `src\__fixtures__\controllers\zz-r1r-wake.test.ts`, scratchpad `zz-r1r-wake\` (`model-real.ts`, `model-fixed.ts`, `run.mjs`) | The model byte for byte, and with the re-armed wake-up, on real timers across processes. |
| Scratchpad `zz-r1r-order.mjs`, `zz-r1r-timer.mjs` | Counted bare-Node copy of the wake sequence. Timer lateness against `Date.now()`. |
| Scratchpad `zz-r1r-electron\` | Electron 44.5.1 probe: a worker's 5 s fetch to a `protocol.handle` route, through a native move loop and a sync dialog, driven from outside with `PostMessage`. |
| Scratchpad `zz-r1r-marlin\`, `zz-r1r-fw\` | Marlin `1cd56c4c`, grblHAL core `4ec1ae44`, Plugin_networking `e0131fb2`, FluidNC `ffad1dc7` and GRBL `bfb67f0c` files, fetched with `gh api` at the SHA. |

## Repro files (all deleted)

Under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\`. Each was removed by literal path. `j7-main`'s junction and the `zz-r7*` files were not touched.

| File | What it did |
|---|---|
| `j7-main\zz-r1-vitest.config.ts` | The repo's config, plus the `fflate` alias, one worker, and the parent-swap plugin. |
| `j7-main\zz-r1-parent-plugin.ts` | With `R1_PARENT=1515` or `1527`, resolves a PR's source file to its parent copy. |
| `j7-main\zz-r1-hog.mjs` | Burned one CPU core. |
| `j7-main\src\**\zz-r1-p1515-*.ts`, `zz-r1-p1527-*.ts` | `git show` of the parents' source files (5 for #1515, 10 for #1527), for test truth. |
| `j7-main\src\__fixtures__\controllers\zz-r1-marlin-model.ts` | Copy of the FIFO model that exposes the running block and ring, and has an optional wake-up fix. |
| `j7-main\src\__fixtures__\controllers\zz-r1-thread-entry.ts` | Copy of the thread entry: corrupts chosen lines, injects replies, silences the controller, fails session routes, models the window network session, records every write and block. |
| `j7-main\src\__fixtures__\controllers\zz-r1-harness.ts` | Copy of the harness, plus the real window network connection with a fetch body delivered behind overdue timers. |
| `j7-main\src\__fixtures__\controllers\zz-r1-model-wakeup.test.ts` | The model alone, with a modelled preemption before its service tick. |
| `j7-main\src\ui\state\zz-r1-marlin.thread.test.ts` | Cases: `echo-stall`, `abort`, `disconnect`, `pause`, `every-line`, `every-line-window`, `skip-line`, `inject`. |
| `j7-main\src\ui\state\zz-r1-network.thread.test.ts` | Cases per route: `healthy`, `silent`, `silentstall`, `banner`, `readfail`, `writefail`, `pause`, `pausesilent`. |
| `j7-main\src\ui\state\zz-r1-walk.test.ts` | Exhaustive search of tick gaps through the real heartbeat. |
| `j7-main\src\ui\state\zz-r1-flaky.thread.test.ts` | The flaky case with diagnostics: an early wake-up and a natural loop under load. |
| `j7-main\src\ui\state\zz-r1-truth.thread.test.ts` | #1515's thread test on the swap harness. |
| `zz-r1-gen.mjs`, `zz-r1-gen2.mjs` | Generated the three fixture copies. |
| `zz-r1-probe.log`, `zz-r1-run1..4.log`, `zz-r1-ci\run-*.log` | Run output and the failed CI logs. |

Also run unchanged on main: `src\ui\state\in-window-stall-beam.thread.test.ts`, about 9 full runs (see R1-P3-2), and `electron\machine-network-stall.electron-probe.test.ts` with `KERFDESK_ELECTRON_PROBE=1`.

```json
[
  {"id":"R1-P1-1","severity":"P1","area":"fix-marlin-watchdog","file":"src/ui/state/laser-unknown-command.ts","line":48,"anchor":"Twin: laser-unknown-command.ts:4-5 ('runs lines in order, so the echo belongs to the oldest line still owed an answer') vs the text match that discards it; Contract: ADR-395 Decision 4; ADR-676 Amd 1 Decision 1 records the skip; Ground truth: Marlin 1cd56c4c parser.cpp L133/L266/L390-392, gcode.cpp L1119/L1122, queue.cpp L473-L520 (as pinned by the N1 refuter)","evidence":"REPRO","verdict":"CONFIRMED","known":"adjacent: N1-P1-1 note, design audit D-3; burn not measured or raised before","summary":"An unmatched echo:Unknown command means Marlin skipped the ping-pong line in flight, yet the worker and the window run on to done with no notice. Corrupted beam-off: 31 mm (fan M107) / 31.2 mm (inline G0 S0) burned across the workpiece; every G1 corrupted: 360 echoes, 0 lit blocks, done, no notice. Both transports. Pre-existing, trigger modelled","refuter":"P1 kept. Marlin 1cd56c4c parser.cpp L80/L133/L266, gcode.cpp L352/L1119 re-fetched: a line whose first letter is lost is echoed, skipped whole and answered ok. Independent REPRO on real emitted G-code with the repo simulator and oracle: fan [40,50->10,80] at 204, inline [40,50->40,80] at 204, status done, notice null; real worker G1 case done, notice null. GRBL twin errored with reset (gcode.c@bfb67f0c L121). Only a Console line reaches the operator. Match test from d1928d3d4 predates #1515; the ADR note is no warning. Silent byte losses (S digits, M106 no S, M17) are D-3, not this finding; a lost S0 on G0 is harmless"},
  {"id":"R1-P2-1","severity":"P2","area":"fix-marlin-watchdog","file":"src/ui/state/laser-job-pause-resume.ts","line":106,"anchor":"Twin: laser-job-stop.ts:149-155 (release, then stop lines, because the reply queues behind the backlog); ADR-395 title; ADR-676 Amd 1 Decision 2 covers Abort and Disconnect only","evidence":"REPRO (modelled per-line cost)","verdict":"PLAUSIBLE","known":false,"summary":"Marlin Pause awaits the worker's released reply before freezing and writing its beam-off, so after a 1.6 s stall the head stops lit: fan 119 ms / 501 ms and inline 131 ms / 483 ms at a modelled 4 / 8 ms per forwarded line; 0-4 ms at Node's own cost. P1 if Chromium shows it under a reachable stall","refuter":"P2 kept. Ordering confirmed at laser-job-pause-resume.ts:106 on main. REPRO: Node own cost about 0.02 ms/line, lit 0 ms; about 1 ms/line (harness 0.4 and 1 both spin about 1 ms) real fan raster 24-80 ms lit at 255, engrave fan 0 ms, inline 15 ms. Auditor 4/8 ms are 10-20x ADR-352 upper figure. Estimate 100-200 ms on a 3 ms raster at 0.4 ms/line, not measured. Raise to P1 if Chromium shows a lit stop"},
  {"id":"R1-P2-2","severity":"P2","area":"fix-marlin-watchdog","file":"src/platform/web/network-serial-worker-runtime.ts","line":60,"anchor":"Twin: desktop-machine-network.ts:174-186 stopBeforeClosing; Contract: ADR-398 Amd 6 Consequences and Decision 4; ADR-676 made the worker the default","evidence":"REPRO (failure injected at the route)","verdict":"CONFIRMED","known":false,"summary":"On the default network worker route a failed read or write closes the session with no reset: no 0x18, M3 lit 2.1 s+ until sampling ended, notice disconnect-during-job. The window route on the same failure sends 0x18 at +32 ms, then M5, M9. P1 if a >=5 s Electron main stall during a job is shown","refuter":"P2 kept, scenario corrected. No firmware stop on close (telnetd.c@e0131fb2 L239-249, stream.c@4ec1ae44 L524-528, FluidNC TelnetClient.cpp@ffad1dc7 L47-56, Serial.cpp L205-213). Worker default confirmed. Runtime REPRO: resetSent false on read, unusable reply and write failure; overlong line does not close. A main-refused write destroys the socket on both routes. Twin gap, not a broken contract (Amd 6 D4). Electron 44.5.1: sync dialog held 8,642 ms, 0 reads served, AbortError at 5,001 ms; native move loop no stall. Only job-time route found: decideUnavailable (READ, not run with a job), which names the E-stop first, so P2"},
  {"id":"R1-P3-1","severity":"P3","area":"fix-marlin-watchdog","file":"src/ui/state/laser-stream-heartbeat.ts","line":96,"anchor":"Contract: WORKFLOW.md:3381 ('at most 5B + 7 s'); ADR-356 Amd 2 table and 'up to about a second later'; ADR-398 Amd 6 Consequences","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"5B+7 s holds only for stalls of one length; mixed stalls give about 5B+14 s (B=2 s: 24.0 s vs 17.0 s); the 1.75 s+2B row is low above 1.75 s (3B); window network silent controller 4,271 ms vs worker 2,314 ms, so about 2 s not 1 s. Separately, a write lost before the main process saw it makes the following reset out of sequence: session closed, no stop (modelled sequence rule)","refuter":"P3 kept. Part 1 REPRO through the real heartbeat: 23,993 / 28,993 / 38,993 / 63,993 ms for B = 2 / 3 / 5 / 10 s; 5,997 ms against 5,748 ms. WORKFLOW line is now :3396. Part 2 READ only"},
  {"id":"R1-P3-2","severity":"P3","area":"fix-marlin-watchdog","file":"src/__fixtures__/controllers/marlin-fifo-model.ts","line":212,"anchor":"Contract: METHOD L7 / AREAS L10 step 5; CI runs 40821212917, 40898162755, 40905581021, 40906526341 attempt 1","evidence":"REPRO of the hang shape; CI cause not proved","verdict":"CONFIRMED","known":"N1-P3-3 (the same wait, cause open)","summary":"Four CI failures, all the same wait after all wire and lit assertions passed, 8,555 ms with neighbours at normal speed, so not general load. The model's quickstop arms one wake-up; waking early hangs M410 and M5 I for good (pending 2, ring [M410, M5 I]); a re-armed wake-up passes. Refuter shows the unmodified model hanging with no injection; CI path itself unproved; no production drain bug found; the wait prints no state. Also test gaps: Pause after a stall, worker read failure, fallback routes, FluidNC, corrupted beam-off","refuter":"P3 kept. The unmodified model hangs on real timers with no injection: 123/18,000 trials in 7/15 processes, CI shape; re-armed 0/12,000 in 10 processes. Cause: a second quickstop wake is dropped by servicePending while a hop is pending, and the hop lands just short of the deadline (wall/monotonic phase is per process). Windows, Node 25, timer floor removed; not proved on CI. Re-arming hides nothing: firmware polls in idle, and a ledger bug would still time out"},
  {"id":"R1-P3-3","severity":"P3","area":"fix-marlin-watchdog","file":"docs/decisions/ADR-356-amendment-2-a-late-tick-does-not-judge-its-own-gap.md","line":156,"anchor":"Contract: the amendment's Verification vs electron/machine-network-stall.electron-probe.test.ts and #1527's body","evidence":"READ + REPRO of the probe","verdict":"CONFIRMED","known":false,"summary":"ADR-356 Amd 2 says the fixes were not run in Electron or Chromium, though its PR adds and ran a probe, which passes on main","refuter":"P3 kept. ADR line 155 against the probe file and #1527 body; probe not re-run"}
]
```
