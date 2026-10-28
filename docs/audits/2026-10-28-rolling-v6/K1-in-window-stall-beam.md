# Rolling audit v6 — K1 In-window stall and the beam

- **When:** 2026-10-28, morning +0800   **Tree:** origin/main @ `9e20cc061` (#1485 merged).
  - `git diff --stat 93334429e origin/main -- src electron services` is empty, so the source is `93334429e`'s.
  - **Refuter re-check on `ef52782a6`** (main after #1486, #1487 and #1489). I ran `git diff --stat 93334429e origin/main` over every file the verdicts rely on:
    - transport selection, network connect, streaming mode;
    - the dialects, profiles and emitters;
    - the Job Review advisory, Pause beam-off, fallback notice and job-aware dialogs;
    - ADR-354, -356, -395, -398 Amendment 1 and -552.
    - Only `device-profile.ts` changed: comment text on Falcon air settings. Of the other 47 changed files, `laser-stream-hold.ts` changes only the Falcon air hint in the hold sentence.
    - **All four findings hold on `ef52782a6`.** No open PR touches these files: #1492–#1495 were checked, and #1488 and #1491 are discussed under the findings.
  - **Repros ran on main's exact tree,** in the verified `git archive 93334429e` copy (`…\scratchpad\j7-main\`, node_modules by junction), one Vitest file at a time, with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`. The temporary files are listed at the end and were deleted.
- **Scope:** which connections stream from the renderer's UI thread, what the controller still holds when that thread stalls, and what the beam does when the head stops.
  - Transport selection: `laser-connect-action.ts`, `platform/web/web-serial.ts`, `native-serial-connection.ts`, `desktop-machine-network.ts`, `MachineNetworkConnect.tsx`, `connect-options.ts`, `controller-streaming-mode.ts`, `laser-job-effective-stream-options.ts`.
  - Output dialects: `gcode-dialects.ts`, `profile-catalog.ts`, `CutPowerModeField.tsx`.
  - Guards: `stream-throughput-warnings.ts`, `laser-stream-pause-beam.ts`, `laser-background-streaming-notice.ts`, Electron main.
  - ADRs: ADR-354 (decision 4, Amd 1), ADR-398 (Decision 1, Amd 1), ADR-395 (Decision 3).
  - Firmware: GRBL 1.1, grblHAL, FluidNC v4.0.3, Marlin 2.1.2.8 (and 2.1.2.6), Smoothieware edge. All pinned below.
- **Lenses run:**
  - L6 (failure path: the beam when the stream stops being refilled);
  - L2 (firmware ground truth at pinned SHAs);
  - L4 (interleaving: a stall during a burn, at J10's measured stall lengths);
  - L1 (ADR-398 "no planner drain with the beam lit", ADR-395's Pause beam-off as the twin);
  - L7 in part (what the lit-drain checkers and the Job Review advisory cover).
  - Not run: L5 (no trust boundary is involved), L3 beyond the Pause twin. K2 owns the watchdogs after the stall.
- **Counts:** 4 raised → 0 refuted → P1 3 / P2 0 / P3 1 (+ 9 KNOWN re-observed). Refuter (fresh context, 2026-10-28): 4 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity change. One K1-P3-1 sub-claim refuted, and two citation or wording corrections (K1-P1-3).

## Headline

- **The mechanism is real and reproduces on main's code.** On the window transport, a UI-thread stall stops the refill. The controller runs out its planner (and receive buffer) and stops the head. Under constant power the beam stays on over that one spot.
- **Marlin always streams from the window** (ADR-354 decision 4), and both Marlin dialects are constant power:
  - **Fan dialect (K1-P1-1):** the beam stays at the last `M106` power for the rest of the stall. A 2.3 s stall (one canvas drag frame at 8,000 selected objects in J10) left a stopped head lit at 204/255 for **2,160 ms**. No firmware timeout exists.
  - **Inline dialect, the default (K1-P1-2):** the beam stays at the block's power until Marlin's `LASER_SAFETY_TIMEOUT_MS` (1,000 ms stock). The same stall left it lit for **999 ms**, and a 400 ms stall for 260 ms.
- **GRBL-family machines reach the window too:** network FluidNC/grblHAL, a USB port without a unique identity, the profile opt-out, or a worker that cannot open. With constant power (GRBL Compatible, the Neotronics 4040 cuts, or any layer set to **Constant (M3)**), the beam stays at S for the rest of the stall (K1-P1-3). A 1 s stall gave **832 ms** lit at S800/1000. GRBL has no laser idle timeout.
- **How little the controller holds.** It holds **20–250 ms** of a dithered raster and **120–340 ms** of fine vector engraving. A 0.5 mm-chord cut at 600 mm/min gives about **0.75–1.05 s**. J10's measured stalls (0.1–3 s) exceed all three.
- **What stays dark at a stop:**
  - default GRBL Dynamic (`M4`), grblHAL and FluidNC with a Laser spindle;
  - Smoothieware in every mode;
  - the default GRBL-family USB connection, whose ADR-354 worker keeps refilling.
- **The operator is told nothing.** No warning names the risk. After the stall the job resumes with no notice or log line, and Abort cannot run during the stall.

## Matrix

Drain time: the motion the controller still holds when the host stops, from the static table below (constant feed, so a lower bound), confirmed by the end-to-end repro where marked. The ranges are p10–p90 over every stop point in the burn.

| Transport | Firmware | Power mode | Buffer drain time | Beam at stop | Guard |
|---|---|---|---|---|---|
| ADR-354 worker (GRBL-family USB, unique identity; the default) | GRBL 1.1, grblHAL, FluidNC | any | Not drained: the worker keeps acknowledging and refilling while the renderer is blocked | — | Worker transport (control REPRO `laser-hosted-refill-abort.test.ts` 2/2) |
| Window (always) | **Marlin, fan dialect** (`M106`/`M107`) | constant (fan PWM) | 15 blocks + 1 line: raster 48–245 ms; engrave 128–200 ms; cut 0.75–0.8 s. REPRO drain 140 ms | **LIT** at the last `M106 S` for the rest of the stall; **forever** if the renderer never recovers | **None.** No fan timeout in Marlin. |
| Window (always) | **Marlin, inline dialect** (default, `M3 I`) | continuous | Same as fan; REPRO drain 140 ms (engrave), 860 ms (cut) | **LIT** at the block's S until `LASER_SAFETY_TIMEOUT_MS`: 1,000 ms stock, unbounded on a build that sets 0 | Firmware timeout only. The Job Review advisory says "may stop and restart mid-burn" for fine programs and never names the beam. |
| Window (always) | Marlin inline with `LASER_POWER_TRAP` (build option) | continuous, ramped | Same | Lit at about S × final/nominal rate (at least the floor) until the timeout (READ) | Firmware timeout only |
| Window (always) | Smoothieware | `M221 P0` proportional or `P1` constant | 32 blocks + 1 line: raster 57–167 ms; engrave 265–337 ms; cut 1.56–1.86 s | **Dark** within one 1 ms tick | Firmware (Laser.cpp) |
| Window: network FluidNC (telnet), USB ambiguous / no identity, opt-out, worker unavailable | FluidNC (Laser spindle) | **M3** (GRBL Compatible, Neotronics 4040 cuts, layer Constant (M3)) | Ping-pong + 15 blocks: raster 25–125 ms; engrave 128–200 ms; cut 0.8 s | **LIT** at S for the rest of the stall | **None** |
| Same | FluidNC (Laser spindle) | M4 (default GRBL Dynamic) | Same | Dark (rate-adjusted block) | Firmware |
| Window: USB ambiguous / no identity, opt-out, worker unavailable | GRBL 1.1 (`$32=1`) | **M3** | 120 B + 15 blocks: raster 38–138 ms; engrave 160–232 ms; cut 1.0–1.05 s. REPRO drain 168 ms | **LIT** at S for the rest of the stall (REPRO 832 ms of a 1 s stall) | **None** |
| Same | GRBL 1.1 (`$32=1`) | M4 (default) | Same | Dark (REPRO control) | Firmware |
| Window: network grblHAL (raw TCP), USB ambiguous / no identity, opt-out | grblHAL | **M3** | 1024 B + 99 blocks: raster 0.42–0.54 s; engrave 1.26–2.08 s; cut 2.9–7.8 s (stock-fallback 120 B: raster 0.29–0.33 s) | **LIT** at S for the rest of the stall | **None** |
| Same | grblHAL | M4 | Same | Dark | Firmware |
| — | Ruida | — | No stream: export only (`ruida/driver.ts:1-7,15-17`) | — | — |
| Web build | As above | As above | As above, plus a hidden or minimised tab as a further stall source (ADR-354 Context, operator report; not reproduced) | As above | GRBL-family fallback toast only. Marlin and Smoothieware get none. |

**Refuter spot-check of the dark rows** (sources re-fetched at the same SHAs):
- **Smoothieware, every mode: holds.**
  - `get_laser_power` returns false with no running G1/G2/G3 block (Laser.cpp L238-L258).
  - The tick then calls `set_laser_power(0)` (L260-L287), which writes PWM 0 and drops TTL with no minimum applied (L288-L303).
  - `M221 P` only sets `disable_auto_power` (L207), so the constant mode stops dark too.
- **M4 rows: hold, with one citation fix.**
  - GRBL turns PWM off at an empty segment buffer only for `is_pwm_rate_adjusted` (stepper.c L397), set only for a CCW block in laser mode (L741-L746).
  - FluidNC does the same: Stepper.cpp L233-L241 and L437-L442. `Laser::isRateAdjusted` returns true (LaserSpindle.cpp L16-L18), so a non-Laser PWM spindle stays lit under M4 as well. The auditor already lists that caveat.
  - grblHAL stepper.c L578-L586 needs `dynamic_rpm && cap.laser`. **Citation fix:** the motion-path rule is gcode.c **L4424** (`laser && !gc_parser_flags.laser_disable && laser->state.on && laser->state.ccw`). L4024 is the `$J=` jog branch. The conclusion is unchanged.
- **Marlin with `LASER_POWER_TRAP`: holds.**
  - The last block is planned to `MINIMUM_PLANNER_SPEED` (planner.cpp L1249-L1250). `final_rate` is clamped to at least `MINIMAL_STEP_RATE`, 120 steps/s (L726, L795).
  - So the trap ramps to about S × 120 / nominal_rate. That is roughly 6 % of S at 25 mm/s and 15 % at 10 mm/s on an 80 steps/mm axis (estimate, Not verified on hardware).
  - The beam stays dim-lit until the timeout, not dark. `LASER_POWER_TRAP` is off in stock builds (Configuration_adv.h L3466).

**Real stalls against those drains.** J10 measured these UI-thread stalls on this PC (`J10-scale-performance.md:62-66`, REPRO). All are reachable during a job, because editing is not locked (J10 refuter, `:140`):
- one canvas drag frame: 1k objects 85–121 ms; 2k 0.20–0.24 s; 4k 0.57–0.73 s; 8k 1.9–2.3 s;
- nudge of all selected: 8k 0.30 s; Undo 8k 0.33–0.39 s;
- Duplicate: 4k 0.16–0.19 s; 8k 0.82 s;
- flip or rotate 90°: 8k 0.23–0.26 s.

Which of them drain the controller:
- a raster drains at a 1k-object drag frame, and at the code's own "ordinary" 50 ms host scheduling (`stream-throughput-warnings.ts:38-45`);
- fine engraving drains at a 2k drag frame or any 8k edit;
- a 0.5 mm-chord cut at 600 mm/min drains at about a 5k drag frame (≈ 1 s by J10's fit).

Recovery archive staging runs on the UI thread right after Start (≈ 0.86 µs per line, 200k lines → 0.17 s). Whether it lands on a lit move was not reproduced (Not verified).

## Findings

### K1-P1-1 — Marlin fan-mosfet laser: any UI stall longer than about 0.1–0.8 s leaves the beam on at full burn power over a stopped head for the rest of the stall, with no firmware timeout and no warning

- **Where:**
  - Transport: `src/ui/state/laser-connect-action.ts:294-307`. `serialOpenRequest` asks for the worker only when `isGrblFamilyDriver(driver)`, which is `['grbl-v1.1', 'grblhal', 'fluidnc']` (`laser-disconnect-transaction.ts:41-45`). A Marlin connection always opens the window port (`platform/web/web-serial.ts:119-133`).
  - Streaming: ping-pong (`src/core/devices/controller-streaming-mode.ts:8-12`), refilled only by the window's `ok` handler.
  - Dialect: `src/core/devices/gcode-dialects.ts:38-44`, `marlin-fan`, the `M106 S`/`M107` power between moves. No per-layer power mode (`src/ui/layers/CutPowerModeField.tsx:9-16`).
- **Anchor:**
  - **Twin.** KerfDesk's own deliberate stream stop on Marlin fixes exactly this state. ADR-395 Context (MA-1): "In the fan dialect the fan speed stays applied to the idle fan header". ADR-395 Decision 3: "Pause switches the beam off behind the accepted moves … queues `M107` (fan dialect, fan above 0)". Code: `laser-stream-pause-beam.ts:1-13` ("a laser left on stays on over the stopped head"). A UI stall is the same stopped stream, with no beam-off behind it.
  - **Contract.** ADR-398 Decision 1, "No planner drain with an M3 beam lit". Amd 1 Decision 1 "Marlin output is held like M3", whose Context says "The idle fan output behaves the same way until `M107`" and calls a ≈100 ms lit stop "a dot at each such boundary".
  - **Ground truth.** Marlin 2.1.2.8 (`1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d`):
    - With no block queued the fan follows the current speed: [planner.cpp L1388-L1399](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/planner.cpp#L1388-L1399), "const uint8_t spd = thermalManager.scaledFanSpeed(i);".
    - `LASER_SAFETY_TIMEOUT_MS` acts on the cutter only: [temperature.cpp L3516-L3521](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/temperature.cpp#L3516-L3521), "cutter.power = 0; … cutter.apply_power(0);".
    - Planner: [Configuration_adv.h L2390-L2398](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration_adv.h#L2390-L2398), `BLOCK_BUFFER_SIZE 16`. `LASER_SYNCHRONOUS_M106_M107` is off ([L3504](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration_adv.h#L3504)).
- **Scenario:**
  1. A Marlin fan-laser profile engraves a vector logo (0.2 mm chords, 1,500 mm/min, 80% → `M106 S204`).
  2. Mid-burn the operator drags a large selection on the canvas, or presses Undo after a whole-selection edit. In the web build, hiding the tab is another route (ADR-354 Context).
  3. The window stops refilling. Marlin runs out its 15 planned moves in about 0.13 s and stops.
  4. The fan output stays at 204 until the window recovers and sends the next line, about 2.2 s later. After a hang it stays on until the physical E-stop: ABORT runs on the same blocked thread.
  5. The job then resumes with no notice. The burn has a pit or char spot at the stop point. At 25 mm/s a 2.16 s dwell puts ≈ 2.16 × 25 / 0.15 ≈ 360 × the energy of a 0.15 mm spot in motion into that spot (estimate).
- **Evidence:** REPRO, `src\ui\state\zz-k1-stall-beam.test.ts` (10/10). It drives the real store, connected with `controllerKind: 'marlin'` and ping-pong, to the time-faithful Marlin FIFO model (`__fixtures__/controllers/marlin-fifo-model.ts`).
  - The stall is modelled at the transport: no lines in, writes held, and the controller keeps its own clock. The program is the real `marlinStrategy.emit` output with `marlin-fan`. The fan state at the stop comes from the repo's Marlin oracle (`marlin-laser-power-model.ts`) over the bytes sent before the stall.
  - Stall 2,300 ms, 3 s into the job:
    `{"blocksAtStallStart":17,"drainMs":140,"headStoppedAt":{"x":73.238,"y":101.171},"headAtStallEnd":{"x":73.238,"y":101.171},"fanAtStop":204,"fanDwellMs":2160,"heldLines":1,"streamerAfter":"streaming","safetyNoticeAfter":null}`.
  - Stall 400 ms: `"drainMs":140,"fanAtStop":204,"fanDwellMs":260`.
  - Static table, `zz-k1-drain-table.test.ts`: the stop lands on a lit move at 94% of stop points for a cut, 98% for engraving and 49% for a dithered raster. Drain p10–p90: cut 801 ms; engrave 128–200 ms; raster 48–245 ms.
- **Severity:** P1. A reachable, unannounced stationary lit beam: wrong physical output (power at a point) with burn-through and fire risk, and no firmware bound. No warning reaches the operator:
  - the desktop fallback notice exists only for a requested GRBL-family worker (`laser-connect-action.ts:280-289`);
  - Job Review's buffered-motion advisory names "stop and restart mid-burn" on host or USB delays, not a lit stop, and only for fine programs (K1-P3-1).
- **Novelty:** KNOWN as a mechanism, never raised: rolling v3 H8 refuter (`H8-remote-automation.md:172-178,603-608`); rolling v5 J10-P2-1 coordinator note (`J10-scale-performance.md:162-166`); v5 LEDGER "Candidate for the next round". H8 named only stock GRBL M3. No report has run the Marlin fan or inline case under a stall. ADR-395's fix (MA-1) covers Pause only. No open PR touches these files.
- **Refuter: CONFIRMED (independent REPRO, pinned SOURCE and a project twin). P1 kept.**
  - **Firmware (would make it false if the fan blanked at an empty planner): it does not.**
    - Re-read at `1cd56c4c` (tag 2.1.2.8, `Version.h` L31). With no block queued the fan takes `thermalManager.scaledFanSpeed(i)` (planner.cpp L1386-L1399, L1394).
    - The safety timeout writes only `cutter` (temperature.cpp L3517-L3521). Configuration_adv.h has no fan idle timeout; `HOTEND_IDLE_TIMEOUT` (L510) is for heaters and is off.
    - Second line: ADR-395 Context (MA-1) says the same in KerfDesk's own decision record: "In the fan dialect the fan speed stays applied to the idle fan header".
  - **Transport: Marlin never gets the worker.**
    - `serialOpenRequest` adds `hostedStreaming` only for `isGrblFamilyDriver` (`laser-connect-action.ts:303`; kinds at `laser-disconnect-transaction.ts:41`).
    - ADR-354 decision 4: "Marlin and Smoothieware retain their existing transport."
  - **Model (would make it false if a real block still let writes through): it does not.**
    - Every refill write comes from the window's `ok` handler (`web-serial.ts:285-289`).
    - The project's real-Chrome probe counted 1 write by the window-owned port during a 2 s window block, against 201 by the in-worker port (`docs/audits/2026-09-23-background-serial.md:12-21`).
  - **Refuter REPRO** (own model, not the auditor's FIFO fixture): `zz-k1r-stall-thread.test.ts` + `zz-k1r-controller-worker.mjs` on `j7-main`, real timers.
    - The real store connects as Marlin. The program is the real `marlinStrategy.emit` output: 0.2 mm chords at 1,500 mm/min, 80 %, giving `M106 S204`.
    - The controller runs on its own `node:worker_threads` thread with a wall-clock 15-block planner and the fan rule above. The store's thread is blocked by a **synchronous busy loop**.
    - Block of 2,300 ms: 0 writes during it, last line 0.2 ms before it, planner empty at +127 ms. **Fan 204 on the stopped head from +127 ms to +2,300 ms (2,173 ms)**, until the next line.
    - Afterwards the streamer is still `streaming`, there is no safety notice, and the log holds only `ok`.
  - **Drain re-derived:** 15 planner blocks (`BLOCK_BUFFER_SIZE 16`, L2396) plus 1 line awaiting its `ok` gives 16 moves × 8 ms = 128 ms at constant feed. That matches 127 ms here, and 140 ms in the auditor's run with deceleration.
  - **Guards: none missed.**
    - The fan transform writes `M106` once per run and no keep-alive (`marlin-fan-transform.ts:59-63`).
    - ADR-395's beam-off is Pause only. The fallback notice is GRBL-family only. Job Review never names the beam (K1-P3-1).
    - A second twin: `job-aware-dialogs.ts:1-11` (H13) made native dialogs non-blocking during a job for exactly this reason ("halts motion with M3 holding the beam at cut power on a stationary head"). It removed one stall source, not the class.
  - **Reach:** §3 has no reach clause, and the case is reachable today. The fan dialect ships, editing is not locked during a job (J10), and ADR-356 Context records a field task of 11.95 s on a window transport.
    - Open PR #1488 (linear large-selection edits) would shorten J10's edit stalls, but it is not merged and other stall sources remain.
- **Fix direction:**
  - Take the Marlin refill off the UI thread: extend the ADR-354 worker to Marlin's ping-pong `ok` (the window keeps the picker), or relay it through Electron main for desktop.
  - Until then, Job Review should name the fan dialect's unbounded lit stop when the stream runs from the window (Job Review is the single warning surface, NN21).
  - After any refill gap longer than the planner's estimated hold, log and tell the operator that the head stopped with the beam lit.

### K1-P1-2 — Marlin inline dialect (the Marlin default): a UI stall leaves the beam on over a stopped head for up to Marlin's 1 s safety timeout per stall, with no warning

- **Where:** as K1-P1-1 (transport, ping-pong). Dialect: `gcode-dialects.ts:31-37,47`, `marlin-inline` is the default (`M3 I`, continuous). Built-in starter: `profile-catalog.ts:96-108` (`generic-marlin-laser`, `marlin-inline`, ping-pong).
- **Anchor:**
  - **Contract.** ADR-398 Amd 1 Context: at an empty planner "continuous power stays lit while stopped", and a ≈100 ms lit stop is "a dot at each such boundary". Decision 1: "Marlin output is held like M3".
  - **Twin.** ADR-395 Decision 3: Pause queues `M5 I` "(inline mode active)" behind the accepted moves (`laser-stream-pause-beam.ts:1-13`).
  - **Ground truth.** Marlin 2.1.2.8 (`1cd56c4c…`):
    - Only dynamic mode blanks the cutter with no block: [stepper.cpp L2341-L2346](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/stepper.cpp#L2341-L2346), "if (cutter.cutter_mode == CUTTER_MODE_DYNAMIC) cutter.apply_power(0);".
    - Continuous mode applies each block's power as the block starts: [L2570-L2580](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/stepper.cpp#L2570-L2580).
    - The safety timeout ([temperature.cpp L3516-L3521](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/temperature.cpp#L3516-L3521)) runs from the last time blocks were queued: [MarlinCore.cpp L428-L429](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/MarlinCore.cpp#L428-L429), "if (has_blocks) gcode.reset_stepper_timeout(ms);".
    - Its stock value: [Configuration_adv.h L3432](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration_adv.h#L3432), "#define LASER_SAFETY_TIMEOUT_MS     1000   // (ms)". The same line is in 2.1.2.6 (`5554ccb52f4d449d97ef88b28d03b53d9d63ba70`, L3432), the version the dialect targets.
- **Scenario:**
  1. The same logo on the default Marlin profile (`G1 … S204` under `M3 I`).
  2. A 400 ms UI stall (Undo after an 8k-object edit) stops the head after 140 ms and holds the beam at 204 for 260 ms.
  3. Any stall of 1.14 s or more holds it for the full ≈1 s, at one spot.
  4. A 0.5 mm-chord cut at 600 mm/min drains in 0.86 s, so a 2.3 s drag frame lights a stopped head for 998 ms.
  5. A build with `LASER_SAFETY_TIMEOUT_MS` 0 has no bound, as in K1-P1-1.
  6. Each further stall in the same job leaves another spot.
- **Evidence:** REPRO, `zz-k1-stall-beam.test.ts`, as above with `marlin-inline`. The FIFO model ports the continuous-mode power and the 1,000 ms timeout.
  - Engrave, stall 400 / 1,000 / 2,300 ms: `drainMs` 140; `inlineOutputAtStop` 204; `inlineBeamOnAfterStopMs` 260 / 860 / 999; head position unchanged from stop to stall end.
  - Cut @600, stall 1,000 / 2,300 ms: `drainMs` 860; lit 140 / 998 ms.
  - Every run: `streamerAfter: "streaming"`, `safetyNoticeAfter: null`, and only `ok` lines in the log.
- **Severity:** P1. A lit stationary beam that KerfDesk did not command, at full burn power, for up to 1 s per stall. ADR-398 Amd 1 treated 100 ms of the same state as a defect. The firmware timeout bounds the dose but does not make the output right. The partial advisory is discussed under K1-P1-1.
- **Novelty:** as K1-P1-1. The Marlin inline case under a stall was never run before.
- **Refuter: CONFIRMED (independent REPRO and pinned SOURCE). P1 kept.**
  - **Inline is KerfDesk's Marlin default.**
    - `DEFAULT_MARLIN_DIALECT` is `marlin-inline` (`gcode-dialects.ts:47`), and any non-Marlin id falls back to it (`:49-56`).
    - A Marlin profile defaults to it (`controller-profile-compatibility.ts:214`), and so does the built-in Generic Marlin profile (`profile-catalog.ts:108`). The emitted program opens with `M3 I S0` and puts `S204` on the first G1 (REPRO head).
  - **Firmware, re-read at `1cd56c4c`:**
    - `M3 I` selects continuous mode (M3-M5.cpp L84-L86).
    - At an empty planner only `CUTTER_MODE_DYNAMIC` blanks (stepper.cpp L2341-L2346). Continuous mode applies each block's power when the block starts (L2570-L2580).
  - **Timeout:** `LASER_SAFETY_TIMEOUT_MS`, stock **1000 ms**. It is at Configuration_adv.h L3432 in both 2.1.2.8 (`1cd56c4c`) and 2.1.2.6 (`5554ccb5`, re-fetched).
    - It sits behind `#if LASER_SAFETY_TIMEOUT_MS > 0` (temperature.cpp L3517). So **0 disables it**, and so does a vendor `Configuration_adv.h` that lacks the define (the expression evaluates to 0).
    - It counts from `previous_move_ms`, which is refreshed only while blocks are queued (MarlinCore.cpp L428-L429).
  - **Refuter REPRO,** same harness as K1-P1-1 with the inline rule (and 1,000 ms timeout), on a genuine synchronous block of the store's thread:
    - 0.2 mm @ 1,500 mm/min, 2,300 ms block: drain at +128 ms; **S204 on the stopped head for 1,000 ms** (cut by the timeout); no write during the block.
    - Same program, 400 ms block: drain at +122 ms; **lit 278 ms**.
    - 0.5 mm chords @ 600 mm/min, 2,300 ms block: drain at +801 ms (16 × 50 ms); **lit 1,000 ms**.
    - Every run: the streamer is still `streaming` and there is no notice.
  - **Severity:** the firmware bound limits the dose, not the error.
    - ADR-398 Amendment 1 Context calls a ≈100 ms lit stop "a dot at each such boundary".
    - The controller audit rated the same 1 s inline state "critical" for Pause (`2026-09-25-controller-full-audit/tracks/MA.md:78-84`).
    - No warning names it before output.
- **Fix direction:**
  - As K1-P1-1: a worker or main-process refill.
  - A dialect-level guard is possible. Marlin's `M4 I` dynamic mode blanks at an empty planner (stepper.cpp L2343-L2344). However, `gcode-dialects.ts:10` notes it "derives power from feedrate and is not GRBL dynamic power", so it needs its own decision.

### K1-P1-3 — A GRBL-family job on the window transport with constant power (GRBL Compatible, Neotronics 4040 cuts, or any layer set to Constant (M3)) leaves the beam on over a stopped head for the rest of any UI stall longer than about 0.03–1 s

- **Where:** window routes for a GRBL-family driver:
  - Network FluidNC (telnet) and grblHAL (raw TCP): `desktop-machine-network.ts:28-29` (`backgroundStreamingUnavailable = true`), `MachineNetworkConnect.tsx:40-44` and `machine-setup-connection.ts:42` (`hostedStreaming: false`), protocols at `electron/machine-network-protocol.ts:2`.
  - A USB port whose VID/PID is missing or matches another granted port: `native-serial-connection.ts:115-140` returns null and `web-serial.ts:121-132` opens the window port.
  - The profile opt-out: `connect-options.ts:26-27`.
  - A worker that cannot be created or probed: `native-serial-connection.ts:31-39,44-50,61-64`.
  - Constant power: `gcode-dialects.ts:109-118` (`grbl-compatible`, all groups `M3`); `:142-145` (`neotronics-4040-safe`, cuts `M3`), the built-in Neotronics 4040 profile (`device-profile.ts:417-433`); and the per-layer **Constant (M3)** option (`CutPowerModeField.tsx:35-40`).
- **Anchor:**
  - **Contract.** ADR-398 Decision 1: "No planner drain with an M3 beam lit." Its Context: "Under M3 the beam keeps its last power while the head is stopped" … "burn-through and fire risk. The Neotronics 4040 cuts in M3 by default."
  - **Contract (transport).** ADR-354 decision 4 makes the worker the default for GRBL-family connections. Amd 1 Consequences accept that "A busy KerfDesk window can still delay sending after a fallback". Neither considers the beam.
  - **Ground truth:**
    - GRBL 1.1 ([gnea/grbl `bfb67f0c`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/stepper.c#L392-L397)): stepper.c L392-L397, "if (st.exec_block->is_pwm_rate_adjusted) { spindle_set_speed(SPINDLE_PWM_OFF_VALUE); }". Only `M4` (CCW) blocks are rate-adjusted in laser mode ([L741-L746](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/stepper.c#L741-L746)). RX 128 ([serial.h L27](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.h#L27)); planner 16 ([planner.h L27-L31](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/planner.h#L27-L31)).
    - grblHAL core ([`4ec1ae44`](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/stepper.c#L578-L586)): stepper.c L578-L586 turns PWM off only for `dynamic_rpm` laser blocks. `is_rpm_rate_adjusted = spindle->state.ccw && spindle->hal->cap.laser` ([gcode.c L4024](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/gcode.c#L4024)) (refuter: L4024 is the `$J=` jog branch; the motion-path rule is [gcode.c L4424](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/gcode.c#L4424), `laser && !gc_parser_flags.laser_disable && laser->state.on && laser->state.ccw`). Planner 100 ([config.h L907-L908](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/config.h#L907-L908)); RX 1024 ([stream.h L53](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/stream.h#L53)).
    - FluidNC v4.0.3 ([`25ae119b`](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Stepper.cpp#L233-L241)): Stepper.cpp L233-L241, "if (st.exec_block != NULL && st.exec_block->is_pwm_rate_adjusted) { spindle->setSpeedfromISR(0);". Rate adjustment needs `Ccw` and `isRateAdjusted()` ([L437-L442](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Stepper.cpp#L437-L442)). `_planner_blocks = 16` ([MachineConfig.h L98](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Machine/MachineConfig.h#L98)).
    - None of the three has a laser idle timeout in the files read. J2 found that only a reset or `M5` turns a GRBL M3 beam off (`J2-failure-paths.md:126-128`).
- **Scenario:**
  1. A Neotronics 4040 owner also has a 3D printer on a CH340 adapter. Both ports are granted, so the identity is not unique and the laser falls back to the window (desktop: Laser log line only). Equally, a FluidNC owner on telnet sets an engrave layer to Constant (M3).
  2. Mid-engrave the operator nudges or drags a large selection. The controller runs out 15 blocks plus 120 bytes in about 0.17 s.
  3. The head stops lit at S800/1000 until the window resumes. Abort is on the same blocked thread.
  4. A hang leaves it lit until the E-stop.
- **Evidence:**
  - REPRO, `zz-k1-stall-beam.test.ts`: the real store with char-counted 120 B, against the GRBL simulator (`plannerBlocks: 15`, `rxBufferBytes: 128`, 8 ms per block = 0.2 mm at 1,500 mm/min), on the real `grblStrategy.emit` output. The beam at the stop comes from the repo's GRBL laser-mode oracle (`grbl-laser-power-model.ts`) over the bytes sent before the stall.
    - GRBL Compatible, stall 1,000 ms: `{"blocksAtStallStart":15,"rxAtStallStart":{"pending":"G1 X94.086 Y102.156\n…G1 X93.442 Y102.631\n","peakBytes":116},"drainMs":168,"mposAtStop":{"x":93.442,"y":102.631},"mposLastSampleInStall":{"x":93.442,"y":102.631},"spindleModeAtStop":"cw","beamAtStop":800,"litDwellMs":832,"streamerAfter":"streaming","safetyNoticeAfter":null}`.
    - Stall 400 ms: `litDwellMs` 232.
    - Control, GRBL Dynamic: `"spindleModeAtStop":"ccw","beamAtStop":0`.
  - Static table (lower bounds): GRBL M3 engrave 160–232 ms, raster 38–138 ms, cut 1.0–1.05 s; FluidNC M3 128–200 / 25–125 / 801 ms; grblHAL M3 at 1024 B + 99 blocks 1.26–2.08 s / 0.42–0.54 s / 2.9–7.8 s. Lit at the stop: 92–98% of vector stop points, 49% of raster.
  - Control for the default path: the existing `laser-hosted-refill-abort.test.ts` (2/2) asserts more than 50 worker messages during a 1 s renderer stall (`:188-190`).
- **Severity:** P1 by effect. The reach (a constant-power choice plus a window route) is narrow, but §3 has no reach clause.
  - Every route is reachable today: built-in profile, a shipped per-layer option, and the shipped network connect.
  - On the desktop the fallback is written only to the Laser log (ADR-354 Amd 1 item 2; `laser-background-streaming-notice.ts:14-27`). The network connect says nothing.
- **Novelty:** the H8 refuter documented the stock GRBL M3 half of this, without a repro or the routes (KNOWN, never raised). Q1-P2-1 is the GRBL Compatible raster over-dose from the planner-limited head speed, a different mechanism. Not elsewhere.
- **Refuter: CONFIRMED (independent REPRO and pinned SOURCE). P1 kept: reachable today.**
  - **Firmware,** re-read at the same SHAs:
    - GRBL stepper.c L392-L397 and L741-L746.
    - grblHAL stepper.c L578-L586. **Citation fix:** use gcode.c **L4424**, not L4024 (the jog branch).
    - FluidNC Stepper.cpp L233-L241 and L437-L442.
    - No cycle-stop path read turns the spindle off. GRBL's `EXEC_CYCLE_STOP` handler ends in `sys.state = STATE_IDLE` (protocol.c L370-L399), and the grblHAL and FluidNC cycle-complete handlers have no spindle call in the lines read.
  - **Is it reachable today? Yes, by several routes, so §3 keeps P1.**
    - **Desktop network FluidNC (telnet) or grblHAL (raw TCP), always the window.**
      - The connection always reports `backgroundStreamingUnavailable` (`desktop-machine-network.ts:29`), and connect passes `hostedStreaming: false` (`MachineNetworkConnect.tsx:40-44`).
      - The form is offered to every FluidNC and grblHAL profile in the desktop app: `machineNetwork` is wired on `app://` (`main.tsx:77`), the form is chosen per profile (`machine-network-profile.ts:39-45`) and rendered at `ControllerConnectionControls.tsx:108`.
      - This is the most direct route: no fallback is needed.
    - **Two identical USB adapters: an accepted design consequence.**
      - ADR-552 Consequences: "Picks of two identical adapters now persist until Forget Controller. While both are attached, … background streaming uses the window port (ADR-354)".
      - **Correction:** since ADR-552 and ADR-607, desktop picks survive a restart as Chrome's do. ADR-366's "until an app restart" no longer narrows this route.
    - **The remaining routes:** a port with no VID/PID (a non-USB COM port), the Machine Setup opt-out (`connect-options.ts:26-27`), or a worker that cannot be created or probed.
    - **Constant power:** GRBL Compatible (opt-in), the built-in Neotronics 4040 (a USB `grbl-v1.1` profile whose cuts are M3 by default, so it needs one of the fallback routes), or any layer set to Constant (M3).
    - **How common:** this cannot be measured from code. The fallback leaves only a Laser-log line.
      - **Correction:** the report says "The network connect says nothing". It writes that same log line, because `reportBackgroundStreaming` (`laser-connect-action.ts:167,285-286`) sees `backgroundStreamingUnavailable`. There is no toast on desktop.
      - The opt-out route logs nothing at all.
      - No text names the lit stop, so §3's warning test is not met.
  - **Refuter REPRO,** same thread harness (worker controller with 15 blocks, 128 B RX and the GRBL rule above). The real store is connected as `grbl-v1.1` with `hostedStreaming: false` (window, character-counting) and runs real `grblStrategy.emit` output, GRBL Compatible, `S800`. The store's thread is blocked synchronously for 1,000 ms:
    - drain at +159 ms (about 5 lines in RX plus 15 blocks, roughly 20 moves × 8 ms);
    - **S800 on the stopped head for 854 ms**, until the first line after the block at +1,013 ms;
    - no notice.
    - Control, GRBL Dynamic (M4): drain at +167 ms, **no lit stop**.
  - **Overlap with open PRs.** #1491 ("Constant-power (M3) advice and 4040 exit runway", Q1/Q6) adds Job Review advice to move GRBL Compatible and 4040 Line cuts to M4 for burn quality.
    - It never mentions the window transport or a stall, and skips layers set to Constant by hand.
    - It is not merged. The remedy partly overlaps; the defect is not fixed.
- **Fix direction:**
  - Prefer the worker or main-process refill for every streaming transport, including the network bridge, which Electron main already owns.
  - Failing that, when the live connection reports `backgroundStreamingUnavailable` (or is a network target), Job Review should warn about constant-power layers and offer `M4` (GRBL Dynamic) for the run.

### K1-P3-1 — The Job Review buffered-motion advisory ignores the planner and never names the beam; no checker or test models a host-starved stream under constant power

- **Where:**
  - `src/ui/laser/job-review/stream-throughput-warnings.ts:81-96` and `:113-116`. `linesInFlight` counts one line for ping-pong and RX-window lines otherwise, not the planner's 15–99 blocks. The text is "Host or USB delays longer than that drain the planner, so the machine may stop and restart mid-burn."
  - Test side: `__fixtures__/controllers/grbl-lit-drain-checker.ts:1-25` and `marlin-lit-drain-checker.ts:1-15` find only the program's own synchronizing drains.
- **Anchor:** Contract: NN21 makes Job Review "the single warning surface". Twin: ADR-398's lit-drain checkers cover the program's drains, but nothing covers the transport's.
- **Scenario:** REPRO (`zz-k1-drain-table.test.ts`, real `detectStreamThroughputWarnings` with the real `resolveStartStreamWindow`):
  - It fires for Marlin engrave (≈11 ms per line), Marlin raster (6.1 ms), FluidNC engrave and GRBL raster (≈22 ms in 120 B).
  - It is silent for a Marlin 0.5 mm-chord cut and for GRBL engrave and cut, all of which drain in under about 1 s (matrix).
  - Where it fires, it describes stop-and-go, not a lit stationary beam, and it blames host or USB delays rather than the operator's own editing.
- **Severity:** P3: advisory accuracy and a test gap. The P1s above do not rest on it.
- **Refuter: CONFIRMED as P3 (a missing warning and a missing test). One sub-claim REFUTED (see Refuted).**
  - **Confirmed, by reading the code:**
    - No Job Review text names a lit stop on a window transport (`stream-throughput-warnings.ts:88-95`).
    - `grbl-lit-drain-checker.ts` and `marlin-lit-drain-checker.ts` check only the program's own synchronizing drains.
    - The phrase "Host or USB delays longer than that drain the planner" overstates a single delay: the planner still holds 15–99 blocks behind the window.
  - **Refuted: "the advisory ignores the planner" as a defect of this advisory.**
    - The advisory is a steady-state throughput check (ADR-331, header `:5-9`). Ping-pong delivers one line per acknowledgement round trip, and a character-counting window delivers W lines.
    - So the planner runs dry whenever W × ms-per-line is shorter than the round trip, however deep the planner is. Depth only absorbs a one-off outage.
    - Counting the planner there (fix direction 1 as written) would make the throughput advisory under-warn.
    - The stall risk needs its own advisory: planner plus window, compared with plausible stall lengths, naming the lit stop under constant power on a window transport.
- **Fix direction:**
  - (Refuter: apply the planner depth to a new stall advisory, not to `linesInFlight`; see above.) Compute the hold from the planner depth (ADR-398 Decision 2 already lists 15 / 100 / 15 / 32 / 15) plus the window.
  - Name the lit stop under constant power on a window transport.
  - Add a checker that starves the stream at every line and asks the oracles for the beam at the stop, as `zz-k1-drain-table` does.

## KNOWN re-observed

- **Rolling v3 H8 refuter** (`H8-remote-automation.md:165-185`, `:543-550`, `:603-608`). It split H8-P1-1: the worker keeps streaming, and the window transport starves. It noted stock GRBL M3 keeps PWM at buffer-empty, left Marlin, Smoothieware, grblHAL and FluidNC unchecked, and raised nothing. This report answers those open items.
- **Rolling v5 J10-P2-1 coordinator note** (`J10-scale-performance.md:162-166`), **J10-P3-1's archive staging** (`:231`) and the v5 LEDGER's "Candidate for the next round" (`LEDGER.md:71-74`). Same mechanism, never raised.
- **ADR-354 Amd 1 Consequences.** A busy window delays sending after a fallback. Documented; the beam was not considered.
- **Rolling v2 04-electron-main P3-20** (renderer crash prompt). A crash is the unbounded stall: under M3 "the beam stays lit on one spot". It is partly re-observed in K1-P1-1/P1-3's hang case.
- **Controller audit MA-1** (fixed by ADR-395 Decision 3): the deliberate stream-side Pause twin of K1-P1-1/P1-2.
- **J2-P2-1** (`J2-failure-paths.md:111-128`): a GRBL M3 beam left on at Idle has no off control on a laser profile. A drained stall is the transient form of that state.
- **Q1-P2-1** (P1 after its refuter): GRBL Compatible burns images with M3 and over-doses through the look-ahead. Its refuter notes "A starved link would only slow the head further, which makes M3 worse" (`Q1-raster-tone.md:308-309`).
- **2026-07-10 full sweep** (`:795`) listed "a cable yank mid-M3-cut leaves a stationary beam after buffered motion drains" among its firmware assumptions.
- **H13, job-aware native dialogs** (added by the refuter; `src/ui/state/job-aware-dialogs.ts:1-11`, which cites AUDIT-2026-06-10, a report not in this repo).
  - Native `alert`/`confirm`/`prompt` turn into toasts during a job. The stated reason is this mechanism: "GRBL drains its buffers in under a second at cut feed and halts motion with M3 holding the beam at cut power on a stationary head".
  - That fixed one stall source. Edits, Undo, imports and GC are other stall sources and stay unguarded.

## Refuted

- **"Smoothieware keeps the beam on at an empty queue."** Refuted. Smoothieware edge `38e2cc083db0e4f768535a9bf2d32cdf104ea980`:
  - [Laser.cpp L238-L258](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L238-L258) returns power only "if(block != nullptr && block->is_ready && block->is_g123)";
  - [L260-L287](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L260-L287) runs every tick (≤ 1 kHz, L119-L121), and `else if(laser_on)` calls `set_laser_power(0)`.
  - This holds in both `M221 P` modes (constant only sets `ratio = 1`) and with `laser_module_minimum_power`. Smoothieware stops dark.
- **"M4 leaves residual power at a stop on GRBL, grblHAL or FluidNC."** Refuted by the cited stepper lines, and by the REPRO control (`beamAtStop: 0`) on GRBL. Caveat: a FluidNC laser configured as a plain PWM spindle is not rate-adjusted (Not verified).
- **"`LASER_SAFETY_TIMEOUT_MS` also bounds the fan dialect."** Refuted. It writes `cutter.power` only (temperature.cpp L3518-L3520). The fan follows `thermalManager` (planner.cpp L1388-L1399).
- **"Archive staging at Start can starve a worker-hosted stream."** Refuted. Staging runs after `startJob` resolves (`start-job-transmission.ts:98-101`), which happens after `armHostedRefill` (`laser-initial-job-transmission.ts:40-43`).
- **"Long straight cuts drain in a realistic stall."** Refuted. The planner alone holds tens of seconds of them; 15 × 100 mm at 10 mm/s is 150 s.
- **"The stall is noticed afterwards: heartbeat, stream hold or a notice."** Refuted for Marlin, at stalls up to 2.3 s, and for GRBL at stalls up to 1 s: the stream resumes with no notice and no log line (REPRO). K2 owns longer GRBL-family stalls against the 2 s heartbeat.
- **"The buffered-motion advisory should count the planner"** (K1-P3-1 sub-claim, fix direction 1). Refuted by the refuter.
  - That advisory tests steady-state throughput. In that test the planner's depth does not matter: one line per round trip under ping-pong, W lines per round trip in a window.
  - Planner depth decides only how long a single outage can be absorbed, which needs a separate stall advisory.
- **Refuter's attempts to falsify the P1s.** None succeeded.
  - "The firmware blanks at an empty planner": false for the Marlin fan, Marlin continuous, and GRBL-family M3.
  - "Marlin or the network routes use the worker": false.
  - "A real thread block still lets the refill write": false. The real-Chrome probe and a synchronous block on a separate-thread controller both show it does not.
  - "No real stall is long enough": false. J10's measured edit stalls and ADR-356's 11.95 s field task both exceed the drain times.
  - "A guard exists": none was found (K1-P1-1 Refuter).
- **"Remote edits stall the PC long enough."** Not raised. Phone and MCP selections are capped at 200 ids (J10). Remote DXF and SVG parsing moved to workers (#1465, #1481).

## Verified clean

- **Transport selection.** Only `grbl-v1.1`, `grblhal` and `fluidnc` request the worker (`laser-connect-action.ts:303`, `laser-disconnect-transaction.ts:41`). The worker opens only for a unique, valid VID/PID among granted ports, rechecked before open, and never chooses between identical adapters (`native-serial-connection.ts:115-140`). Network connections are always window (`desktop-machine-network.ts:29`).
- **The worker path under a renderer stall.** It keeps refilling (existing test 2/2; ADR-354 Consequences). The program crosses once (ADR-354 Amd 3).
- **The beam after the stall.** On Marlin inline, the next block re-applies its own power (stepper.cpp L2570-L2580), so the burn resumes at the programmed S after a safety-timeout cut. Nothing is skipped or doubled (REPRO `streamerAfter: streaming`).
- **Smoothieware and every default `M4` path stop dark** (Refuted, above).
- **Electron main has no beam path on an unresponsive renderer.** It only logs (`support-log.ts:246`) and guards close (`window-close-guard.ts:56`). Nothing in main writes to a network socket on its own.

## Not verified

- **Hardware:** none. The Marlin and GRBL behaviour come from the repo's models plus the pinned source. The GRBL simulator retires blocks at a fixed 8 ms, and the static table uses constant feed. Real drains are a little longer because of the final deceleration.
- **Chromium itself:** the stall is modelled at the transport, not with a real blocked event loop. ADR-354's Chrome reproduction ("The ordinary path sends one line during the block") supports the model.
  - The refuter's repro does block a real JS thread (Node, synchronous busy loop) running the real store, with the controller on another thread. It is still not Chromium.
  - The real-Chrome probe in `docs/audits/2026-09-23-background-serial.md:12-21` (1 write by the window port during a 2 s block) is the browser evidence.
- **Web build hidden or minimised tab:** ADR-354 Context records an operator report that streaming pauses while Chrome is minimised. That would be an unbounded stall for Marlin in the browser with no notice. Not reproduced, and the scheduling cause was not traced.
- **Stall sources beyond J10's measured edits:** not measured. These include GC pauses, applying large worker results (trace or import hydrate), a canvas repaint at 10k objects, and archive staging landing on a lit move right after Start under GRBL Compatible.
- **Firmware options:**
  - Marlin `LASER_POWER_TRAP` residual power at the stop (planner.cpp L893-L898, READ). The refuter derived about S × 120 / nominal_rate, from the `MINIMAL_STEP_RATE` clamp at L726 and L795; that is not measured;
  - vendor Marlin builds with the timeout at 0, or before 2.1;
  - a FluidNC laser configured as a non-Laser PWM spindle (M4 would then also stay lit, Stepper.cpp L437-L442, READ);
  - grblHAL's actual network-stream RX size (taken as stream.h's 1024 bounded by `Bf:`).
- **Steady-state starvation** (a link that cannot keep up, as opposed to a stall) is the Job Review advisory's domain and was not measured here.

## Repro files (all deleted)

| File (under `…\scratchpad\j7-main\`) | What it did |
|---|---|
| `src\ui\state\zz-k1-stall-beam.test.ts` | Real store against the Marlin FIFO model (inline and fan) and the GRBL simulator (15 blocks, 128 B). Starts a real emitted job, blocks the window at the transport for 400–2,300 ms mid-burn, and records drain time, head position, and beam at the stop and during the stall. 10/10. |
| `src\ui\state\zz-k1-drain-table.test.ts` | Static drain-time and beam-at-stop table over real `grblStrategy`/`marlinStrategy`/`smoothiewareStrategy` output (cut, engrave, raster) for each firmware's buffer, using the repo's GRBL and Marlin power oracles. Also runs the real Job Review buffered-motion advisory on the same programs. 2/2. |
| `…\scratchpad\k1-src\` (outside `j7-main`) | Pinned firmware sources fetched for reading: Marlin `1cd56c4c` and `5554ccb5`, GRBL `bfb67f0c`, grblHAL `4ec1ae44`, FluidNC `25ae119b`, Smoothieware `38e2cc08`. |

Also run, unchanged: `src\ui\state\laser-hosted-refill-abort.test.ts` (2/2), the worker-path control.

**Refuter's repro files (all deleted):**

| File (under `…\scratchpad\j7-main\`) | What it did |
|---|---|
| `src\ui\state\zz-k1r-controller-worker.mjs` | An independent controller written for this check, not the auditor's FIFO model. It runs on its own `node:worker_threads` thread and uses wall-clock time (a spin loop with sub-millisecond timing).<br>Planner: 15 blocks; GRBL also gets a 128 B receive buffer.<br>Beam rules: Marlin continuous with the 1,000 ms timeout; the Marlin fan rule; GRBL M3/M4.<br>It records every interval with the head stopped and the beam above 0. |
| `src\ui\state\zz-k1r-stall-thread.test.ts` | Runs the real store with real timers, connected to that worker, on real `marlinStrategy`/`grblStrategy` output.<br>It blocks the store's thread with a synchronous busy loop 2.5 s into the burn. Six runs, each 1/1:<br>• inline 2,300 / 400 ms;<br>• fan 2,300 ms;<br>• inline cut 2,300 ms;<br>• GRBL Compatible 1,000 ms;<br>• GRBL Dynamic 1,000 ms (control).<br>Command: `K1R_CASE=<case> K1R_STALL=<ms> NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run src/ui/state/zz-k1r-stall-thread.test.ts --silent=false --disableConsoleIntercept` |
| `…\scratchpad\k1r-src\` (outside `j7-main`) | Firmware files re-fetched at the same pinned SHAs (Marlin `1cd56c4c`, plus 2.1.2.6 `5554ccb5` for L3432; GRBL `bfb67f0c`; grblHAL `4ec1ae44`; FluidNC `25ae119b` = tag v4.0.3; Smoothieware `38e2cc08`). Deleted after reading. |

```json
[
  {"id":"K1-P1-1","severity":"P1","area":"in-window-stall-beam","file":"src/ui/state/laser-connect-action.ts","line":303,"anchor":"Twin: ADR-395 Decision 3 (Pause queues M107 behind accepted moves; Context MA-1 'fan speed stays applied to the idle fan header'), laser-stream-pause-beam.ts:1-13; Contract: ADR-398 Decision 1 + Amd 1 Decision 1/Context ('The idle fan output behaves the same way until M107'); Ground truth: Marlin 1cd56c4c planner.cpp L1388-L1399 (fan follows current speed with no block), temperature.cpp L3516-L3521 (safety timeout is cutter-only)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED. Refuter REPRO (own wall-clock controller on a separate worker_threads thread; real store thread blocked by a synchronous busy loop 2,300 ms; real marlinStrategy fan output): 0 writes in the block, planner empty +127 ms, fan 204 on the stopped head 2,173 ms until the next line, streamer still streaming, no notice. SOURCE re-read at 1cd56c4c: planner.cpp L1386-L1399 (fan follows current speed with no block), temperature.cpp L3517-L3521 (timeout is cutter-only), no fan idle timeout. Twin: ADR-395 Context MA-1; job-aware-dialogs.ts:1-11 (H13). Transport: worker only for GRBL family (laser-connect-action.ts:303; ADR-354 d4). Chrome probe 2026-09-23-background-serial.md:17-19 (1 write in a 2 s block). P1 kept","known":false,"summary":"Marlin always streams from the window (worker only for GRBL family); with the fan dialect a 2.3 s UI stall drained 15 blocks in 140 ms and left M106 S204 on over a stopped head for 2,160 ms, no firmware timeout, job resumed with no notice"},
  {"id":"K1-P1-2","severity":"P1","area":"in-window-stall-beam","file":"src/core/devices/gcode-dialects.ts","line":47,"anchor":"Contract: ADR-398 Amd 1 Context ('continuous power stays lit while stopped', 100 ms = 'a dot') and Decision 1; Twin: ADR-395 Decision 3 (Pause queues M5 I); Ground truth: Marlin 1cd56c4c stepper.cpp L2341-L2346 (only dynamic blanks), L2570-L2580, temperature.cpp L3516-L3521 + MarlinCore.cpp L428-L429 + Configuration_adv.h L3432 (LASER_SAFETY_TIMEOUT_MS 1000)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED. marlin-inline is the default (gcode-dialects.ts:47-56, controller-profile-compatibility.ts:214, profile-catalog.ts:108). LASER_SAFETY_TIMEOUT_MS 1000 at Configuration_adv.h L3432 in 2.1.2.8 and 2.1.2.6; #if > 0 (temperature.cpp L3517) so 0 or an absent define disables it. Refuter REPRO (thread harness): 2,300 ms block lit S204 1,000 ms; 400 ms block lit 278 ms; 0.5 mm @ 600 mm/min drain +801 ms then lit 1,000 ms. LASER_POWER_TRAP stops dim-lit (final_rate >= 120 steps/s, planner.cpp L726/L795). P1 kept (ADR-398 Amd 1 ~100 ms = a dot; MA-1 rated it critical)","known":false,"summary":"Default Marlin inline (M3 I) on the window transport: a 400 ms stall lit a stopped head at S204 for 260 ms, a 2.3 s stall for 999 ms (safety timeout); a 0.5 mm-chord cut at 600 mm/min drains in 0.86 s; no warning names it"},
  {"id":"K1-P1-3","severity":"P1","area":"in-window-stall-beam","file":"src/platform/web/native-serial-connection.ts","line":136,"anchor":"Contract: ADR-398 Decision 1 ('No planner drain with an M3 beam lit') and Context (Neotronics 4040 cuts M3; burn-through and fire risk); ADR-354 decision 4 + Amd 1 Consequences (busy window delays sending after a fallback); Ground truth: gnea/grbl bfb67f0c stepper.c L392-L397, L741-L746; grblHAL 4ec1ae44 stepper.c L578-L586, gcode.c L4424 (refuter fix; L4024 is the jog branch); FluidNC 25ae119b Stepper.cpp L233-L241, L437-L442","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED. Reachable today: desktop network FluidNC/grblHAL always streams from the window (desktop-machine-network.ts:29, MachineNetworkConnect.tsx:40-44, main.tsx:77); identical adapters fall back by design (ADR-552 Consequences; picks now persist across restarts); plus no-VID/PID, opt-out, worker unavailable. Refuter REPRO: GRBL Compatible S800, window char-counting 128 B, 1,000 ms synchronous block: drain +159 ms, lit 854 ms on the stopped head; GRBL Dynamic control dark. Corrections: grblHAL motion-path rule is gcode.c L4424 (L4024 is the jog branch); the network connect does write the Laser-log fallback line (laser-connect-action.ts:167,285-286). Open PR #1491 overlaps only in M4 advice for quality, not the stall. P1 kept","known":false,"summary":"GRBL family on the window transport (network FluidNC/grblHAL, ambiguous or missing USB identity, opt-out, worker unavailable) with constant power (GRBL Compatible, Neotronics 4040 cuts, layer Constant (M3)): a 1 s stall drained 15 blocks + 116 B in 168 ms and left S800/1000 on a stopped head for 832 ms; desktop fallback is log-only"},
  {"id":"K1-P3-1","severity":"P3","area":"in-window-stall-beam","file":"src/ui/laser/job-review/stream-throughput-warnings.ts","line":113,"anchor":"Contract: PROJECT.md NN21 (Job Review is the single warning surface); Twin: ADR-398 lit-drain checkers (grbl-lit-drain-checker.ts, marlin-lit-drain-checker.ts) cover program drains only","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED as P3 (no warning names the lit stop; lit-drain checkers cover program drains only). Sub-claim refuted: the throughput advisory is right to ignore the planner (steady state: 1 line per round trip under ping-pong, W lines in a window). The planner depth belongs in a separate stall advisory, not in linesInFlight","known":false,"summary":"Buffered-motion advisory counts one line (ping-pong) or the RX window, never the planner, and says 'may stop and restart mid-burn' without naming the lit stop; silent for a Marlin 0.5 mm-chord cut and GRBL engrave/cut that drain in under ~1 s; no checker starves the stream"}
]
```
