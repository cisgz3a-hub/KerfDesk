# Rolling audit v6 — K2 Watchdog timing against UI-thread blocks

- **When:** 2026-10-28, afternoon +0800   **Tree:** origin/main @ `ef52782a6`.
  - Re-fetched at the end: main is now `8815e8aab` (#1492, #1494, #1495).
  - `git diff --stat ef52782a6 8815e8aab` over every cited source file, ADR-356 and its Amd 1, and WORKFLOW.md touches only WORKFLOW.md. Its cited line 1985 is unchanged, so every finding holds on `8815e8aab`.
  - Repros ran in the `j7-main` copy of `ef52782a6` (node_modules by junction), one Vitest file at a time, with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048"`.
  - Browser-ordering probes ran in the repo's own Electron **44.5.1 / Chromium 152.0.7977.130** (`node_modules/electron/dist/electron.exe`, an `app://` `protocol.handle` route as the desktop app uses). They were repeated in a second Chromium 152 (152.0.7977.167, the Claude desktop browser pane, over loopback HTTP).
- **Scope:** every timer that can end, reset or abort a running job, and how each one behaves when the renderer's main thread is blocked.
  - Poll and heartbeat: `laser-connection-actions.ts`, `laser-stream-heartbeat.ts`, `laser-stream-heartbeat-containment.ts`, `laser-status-poll-schedule.ts`.
  - Stall, hold, lost replies: `laser-stream-stall.ts`, `laser-stream-hold.ts`, `laser-lost-ack-reconcile.ts`.
  - Pause/Resume: `laser-pause-resume-transition.ts`, `laser-job-pause-resume.ts`, `laser-pause-resume-confirmation.ts`.
  - Transports: `platform/web/serial-read-loop.ts`, `serial-read-slice.ts`, `worker-serial-connection.ts`, `serial-worker-core.ts`, `platform/electron/desktop-machine-network*.ts`, `electron/machine-network-{session,bridge}.ts`, Electron `unresponsive` handling.
  - ADRs: ADR-212, ADR-356 (and Amd 1), ADR-345, ADR-354, ADR-601, ADR-180 Amd 3.
  - Ground truth: Chromium 152 `base/task/sequence_manager` and Blink scheduler at tag `152.0.7977.130`; HTML Living Standard event loop.
- **Lenses run:** L6 (what each watchdog does when it fires), L4 (block length × tick phase × reply timing × transport), L2 (browser task ordering, by source and in a real Chromium), L3 (heartbeat against its Pause/Resume stand-in and against the network request timer), L7 (which edges have tests). L5 not run (no trust boundary).
- **Counts:** 5 raised → 0 refuted → P1 0 / P2 3 / P3 2 (+ 6 KNOWN re-observed). The suspected mechanism as stated in AREAS is **refuted on both USB transports** and **confirmed on the network transport**.
  - Auditor: P1 2 / P2 1 / P3 2.
  - **Refuter (fresh context, 2026-10-28, main `f1d919fbf`):** 5 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED.
  - **Severity changes:** K2-P1-1 P1 → P2 and K2-P1-2 P1 → P2. Both are on effect: the containment is a fail-dark stop that is announced, not wrong physical output. Reach played no part (see each finding). K2-P2-1 stays P2, with a coordinator note.
  - **Sub-claims refuted:** two reach examples, the 8,000-object drag frame and the "phone Resume while someone drags" case. #1488 removed them (see Refuted).
  - **Main has moved.** `git diff ef52782a6 origin/main` (`f1d919fbf`) over every cited source file, the cited tests, ADR-356 and its Amd 1 is empty. WORKFLOW.md:1985-1986 is unchanged. So every finding is judged on main's current code.
  - **#1488 merged after the audited SHA** (`24e1d2b61`, also after `8815e8aab`). It makes large-selection edits linear, which removes the reach examples K2-P1-1 and K2-P1-2 cite.

## Headline

- **Refuter summary.**
  - Every mechanism reproduced independently, the network ordering end-to-end through KerfDesk's real `app://` machine-network route, bridge, session and renderer connection over a real TCP socket.
  - Both P1s are rated **P2**. The false heartbeat reset and the false Resume deadline each end a healthy job with a fail-dark reset. The notice is wrong, but the output is not: nothing burns at a wrong power or position, and recovery records the reset.
  - After #1488 no app-caused in-job UI task of about 1.5 s or more is known. The remaining candidates are unmeasured: GC on a large job heap, OS paging, canvas repaint, and worker-result hydrate.
- **The suspected false fire does not happen on USB in Chromium 152.** Chromium gives a timer that fell due inside a long task its queue position only when that task ends. Serial and worker messages that arrived during the block are already queued ahead of it.
  - In Electron 44, all 379–381 worker messages queued during a 1.9 s block ran before the overdue 250 ms poll tick, in 16 of 16 trials.
  - So on the default worker transport, and by source on the window Web Serial transport, the overdue tick sees the reply that arrived during the block. The heartbeat then fires only after about 2 s of real silence on the wire.
- **The network transport (desktop FluidNC/grblHAL over Wi-Fi or Ethernet) behaves the other way.** A long-poll `fetch` delivers the reply's body one task later. That task is queued behind the overdue timers.
  - In Electron 44 with an `app://` route, the body of a response that arrived 60 ms into the block resolved **after** the overdue interval tick, in 6 of 6 trials.
  - **K2-P1-1.** If a status reply was ≥ 250 ms late (one tick saw nothing new), a UI block of 1.75–1.99 s resets a healthy job. The window widens to 1.5–1.99 s after two late ticks and 1.25–1.99 s after three. The reset sends `0x18`, then M5/M9, then closes the port (store REPRO).
  - **K2-P2-1.** A single block of about 4–5 s or more makes the network request's own 5 s `AbortController` timer abort a read whose reply arrived early in the block (Electron REPRO). The renderer then closes the session mid-job. It sends no stop and shows "Network connection was lost during an active job".
- **K2-P1-2: the Pause/Resume confirmation deadline was not made host-aware.** It is a plain 2 s `setTimeout`, while the code comment says it "takes over the same silence deadline" as the heartbeat. During a block no status query is written. So a block that ends past 2 s fails the transition even on USB with data-first ordering.
  - On **Resume** the fail-dark reset lands with the controller in `Run` (store REPRO): a reset in motion.
  - On Pause the reset lands on a parked machine.
  - Remote Resume from the phone reaches this path too (`remote-control/machine-actions.ts:234-238`).
- **Late detection is bounded in the number of blocks, not in time.** For a silent controller the worst case is 3 × (B + 1.75 s) + max(2 s, B + 1.75 s), about **4 × B + 7 s** (REPRO).
  - That is 15.0 s at B = 2.0 s, 16.2 s at 2.3 s, 19.4 s at 3.1 s and 47.0 s at 10 s.
  - The AREAS and J10 estimate was "3 × block + 2 s". ADR-356's wording is "after at most three further gaps".

## Watchdog table

Thread "UI" is the renderer main thread. Every transport feeds these watchdogs on the UI thread. The ADR-354 worker only reads, refills and relays lines (`serial-worker-core.ts:5-16`), and it has no timers of its own.

| Watchdog | Threshold | Clock | Thread | Action when it fires | ADR | False-fire window (block after the last on-schedule tick) | Worst detection |
|---|---|---|---|---|---|---|---|
| **Active-stream heartbeat** `laser-stream-heartbeat.ts:7,13,19,64-73`; containment `laser-stream-heartbeat-containment.ts:103-134` | 2 s with no new status report or ack. A tick ≥ 2 s after the previous one re-opens the window, at most 3 times per unchanged observation | `Date.now()` at each `setInterval` 250 ms tick (`laser-connection-actions.ts:81,422-427`; containment `:117`) | UI | `stream-stalled` notice, `0x18` reset transaction, M5/M9, then the port is closed (quarantine `:181-234`) | ADR-212 Decision; ADR-356 Decision 2 | **Worker:** none (REPRO E1/E5, data first). **Window Web Serial:** none (SOURCE, one-hop delivery). **Network:** blocks of [2000 − 250u, 2000) ms after u ≥ 1 ticks with no new reply (REPRO A + E2) | 2.25 s with no block. With blocks of B ≥ 2 s: 3(B + 1.75) + max(2, B + 1.75) s, i.e. 4B + 7 s (REPRO C). Unbounded in B |
| **Ack stall / stream hold** `laser-stream-stall.ts:18-19,38-72`; `laser-stream-hold.ts:36-64` | Hold bar at 3 s, containment at 90 s (`STREAM_HOLD_NOTICE_MS`) | `Date.now()` at the tick | UI | Bar and log. At 90 s: freeze, then `0x18` (GRBL family) or the driver's stop lines (`containStalledStreamAcknowledgements`, `laser-stream-heartbeat-containment.ts:53-80`) | ADR-345; ADR-356 Decision 3 | None to containment. On the network transport a transient false "holding" bar is possible after ≥ 1 s without a fresh Run report (READ, not raised) | The clock restarts at **every** ≥ 2 s gap with no cap (`:70-72`). Repeated stalls < 90 s apart postpone containment of a genuine hold indefinitely (READ; accepted by ADR-356 Decision 3) |
| **Lost-reply probe / sustained Idle** `laser-lost-ack-reconcile.ts:65-71,339-346,421-433` | 1 s / 15 s Idle; 2 s for the probe's own `ok`; 10 s give-up | `Date.now()` + host-aware schedule | UI | Finishes the job from Idle evidence. No reset | ADR-610 Amd 1–2; ADR-356 Amd 1 | Needs positive Idle reports, so a block cannot invent them. The 2 s `[GC:`→`ok` grace could expire if the two lines straddle a block (READ, end of job only, not raised) | n/a |
| **Pause/Resume transition liveness** `laser-pause-resume-transition.ts:48-55,98-102,259-264` | 2 s (CNC Door progress refreshes it); 30 s maximum | Plain `setTimeout`; not host-aware | UI | **Laser:** `stream-stalled` notice plus `failDarkStop()` reset (`laser-job-pause-resume.ts:343-361`). CNC: notice only | ADR-212 Decision (transitions); ADR-180 Amd 3 (laser fail-dark) | **Any transport:** a block that ends > 2 s after the click, before the confirming report was processed (REPRO: 2.1 s fails, ≤ 1.71 s confirms) | n/a |
| **Network request abort** `desktop-machine-network-api.ts:8-9,29-31` | 5 s per read/write (8 s open) | `setTimeout` | UI | `AbortError` closes the connection: read loop `desktop-machine-network.ts:109-110`, write `:68-71`. The result is a mid-job link loss with no stop line | None sets the value (ADR-571/601 describe the adapter) | A single block ending > 5 s after the request was issued. Reads are re-issued at most 1 s apart, so blocks of about 4–5 s (REPRO E3 + store) | n/a |
| **Network session lease** `electron/machine-network-bridge.ts:60-67` | 15 s since the last renderer request | Node `setTimeout` | Electron main | Main closes the session and destroys the socket | ADR-601 ("renderer leases") | A renderer stall ≥ 15 s (READ; KNOWN-adjacent, D7 Not verified) | n/a |
| Network read hold `electron/machine-network-session.ts:57-68` | 1 s | Node `setTimeout` | Electron main | Returns an empty read. It does not judge anything | — | — | — |
| Status-silence deadlines: post-job settle 30 s, fresh Idle 8 s, recovery 8 s / 120 s (`laser-status-poll-schedule.ts:37-70`; `controller-recovery-status.ts:22-26,97`; `laser-post-job-settle.ts:36`) | as listed | `setTimeout`, re-checked against the poll schedule | UI | Settle failure (run recorded interrupted), recovery verdict | ADR-356 Amd 1 | None for ≥ 2 s gaps (host-aware). Sub-2 s blocks share the heartbeat's ordering dependence (clean on USB) | Waits while the poll is off schedule (by design) |
| Link loss | Event: port `close`, worker `closed`, network `closed`/read error | — | UI | `disconnect-during-job` notice and link-loss record | ADR-398 | — | Event latency |
| Electron `unresponsive` (Chromium hang monitor) | Chromium's | — | Electron main | Support-log line and close-guard state only (`support-log.ts:246-249`, `window-close-guard.ts:56-57`) | — | No job action | — |

## Findings

### K2-P1-1 (P2 after the refuter) — On the network transport, a reply that arrived during a sub-2 s UI block reaches the store only after the overdue poll tick, so the heartbeat resets a healthy job

- **Where:**
  - `src/platform/electron/desktop-machine-network.ts:92-111`: one long-poll read at a time; lines are delivered only after `await response.text()` inside `request` (`desktop-machine-network-api.ts:11-18`).
  - `src/ui/state/laser-stream-heartbeat.ts:64-73`: the grace needs a tick gap of ≥ 2 s; the deadline counts from the last changed tick.
  - `src/ui/state/laser-connection-actions.ts:424-427`: the heartbeat runs at the top of the tick, before this tick's own `?`.
- **Anchor:**
  - **Contract.** ADR-356 is titled "A page stall is not controller silence". Decision 2 resets only on two seconds of silence "while the host is polling on schedule". Its Consequences say "Waiting out a page stall no longer ends the job by itself."
  - **Twin.** The same block on the worker transport is harmless (REPRO E1).
- **Scenario:**
  1. Desktop FluidNC or grblHAL over Wi-Fi is cutting a long segment (no acks, so only status reports prove the link).
  2. One status reply is ≥ 250 ms late, so the tick at T+250 saw nothing new (`at` = T, `checkedAt` = T+250).
  3. A UI task of 1.75–1.99 s starts. The replies arrive at Electron main during it, and the pending read's response reaches the renderer.
  4. After the block, Chromium runs the response task, then the overdue tick, then the body task (E2). The tick sees no change. Its gap is < 2 s, so there is no grace, and `now − at` ≥ 2 s gives **LOST**.
  5. The containment then:
     - writes `0x18`, M5 and M9;
     - cancels the streamer;
     - shows `stream-stalled`;
     - closes the port.
  6. A soft reset during motion loses position (GRBL raises ALARM:3; see KNOWN D-1). The workpiece is ruined, and the operator is told the controller stopped responding.
  7. Wider windows: two late ticks give 1.5–1.99 s; three give 1.25–1.99 s. Blocks of this length are reachable in a job: J10 measured one 8k-object drag frame at 1.9–2.3 s in Node (`J10-scale-performance.md:62`).
- **Evidence:** **REPRO** (two parts).
  - **Store**, `zz-k2-heartbeat-block.test.ts`: real store, real poll and heartbeat, real containment, fake GRBL link; u ticks with held replies, then a block of d ms. Rows:
    - **Timer-first** (the network order). u=0: no reset at any d. u=1: reset at d = 1750, 1800, 1900, 1990 and 1999; none at 1749, 2000 or 2100. u=2: reset at 1500–1999. u=3: reset at 1250–1999.
    - Every reset row reads `reset=true M5=true streamer=cancelled notice=stream-stalled conn=disconnected closes=1`.
    - **Data-first** (the worker order): no reset in any of the 52 rows.
  - **Chromium ordering**, `zz-k2-order.html` E2/E3 in Electron 44.5.1 (Chromium 152.0.7977.130), `app://` route answering after 60 ms, block 1,500 ms, interval 250 ms, abort timer 1,000 ms:
    - The order was `fetch1-response, interval-tick, abort-timer, fetch-error:AbortError`, 3 of 3. The same in Chrome 152.0.7977.167 over HTTP, 3 of 3.
    - Control: a `blob:` fetch completed body and second fetch before the tick, 3 of 3. So this behaviour belongs to network bodies.
  - **SOURCE** (Chromium `152.0.7977.130`, `base/task/sequence_manager`):
    - An immediate task gets its order at post time: `EnqueueOrder sequence_number = sequence_manager_->GetNextSequenceNumber();` (`task_queue_impl.cc`, `PostImmediateTaskImpl`).
    - Ripe delayed tasks get a fresh one when moved: `EnqueueOrder delayed_task_group_enqueue_order = GetNextSequenceNumber();` (`sequence_manager_impl.cc`, `MoveReadyDelayedTasksToWorkQueues`, called from `SelectNextTaskImpl`).
    - Same-priority queues run oldest first: `ChooseImmediateOrDelayedTaskWithPriority`, `task_queue_selector.h`.
    - Timers, posted messages and networking are all `kNormalPriority` in a visible page (`frame_scheduler_impl.cc`, `ComputePriority`).
    - So a body task posted after the block runs after the timer batch.
    - URLs: `https://github.com/chromium/chromium/blob/152.0.7977.130/base/task/sequence_manager/{task_queue_impl.cc,sequence_manager_impl.cc,task_queue_selector.h}`. The fetch tool gave no line numbers, so functions are named instead.
  - **Not reproduced:** the late Wi-Fi reply (an input). Real FluidNC/grblHAL reply latency was not measured.
- **Refuter: CONFIRMED (two independent REPROs plus SOURCE). P1 → P2 on effect.**
  - **What would make it false.**
    - The heartbeat discounting the block: it does not. The grace needs a tick gap of 2 s or more (`laser-stream-heartbeat.ts:64-66`).
    - An event-ordering artefact of the auditor's stand-in `app://` route.
    - A transport difference in the real bridge.
  - **REPRO 1: Electron 44.5.1 / Chromium 152.0.7977.130, through the real bridge path.**
    - Main side: `electron/machine-network-{routes,bridge,session,telnet,protocol}.ts` and `app-route-guard.ts`, transpiled unchanged from `f1d919fbf`. They run under `protocol.handle('app', withMachineNetworkRoutes(...))` with the app's scheme privileges (`standard, secure, supportFetchAPI, stream`).
    - Renderer side: the real `createDesktopMachineNetwork` connection and the real `detectActiveStreamHeartbeatLoss`. The window uses the app's `webPreferences` (sandbox, contextIsolation, `backgroundThrottling: false`; `visibilityState` reported `visible`).
    - The network: a real loopback TCP socket to a fake grblHAL (`grblhal-raw`) that answers each `?` in FIFO order after 15 ms. One answer is held for 400 ms, so the next tick sees nothing new (u = 1).
    - The block: a 250 ms poll interval, with a MessageChannel task that blocks for d ms right after the unchanged tick. Two replies were sent during every block.
    - **Results:**
      - d = 1,800, 1,900 and 1,950 ms: **LOST** at the overdue tick, 9 of 9.
      - d = 1,600 ms: no loss, 3 of 3.
      - u = 0 control with d = 1,900 ms: no loss, 3 of 3.
      - In all 15 trials the overdue tick ran before either reply reached `onLine`. The lines landed 0–1 ms after the tick. So the order the auditor measured holds on the real route.
  - **REPRO 2: store, `zz-k2r-heartbeat-store.test.ts`.**
    - Real store, poll, heartbeat and containment, with fake timers. The block is modelled with `vi.setSystemTime` (as `laser-stream-heartbeat-fault.test.ts` does), so no tick or read runs during it.
    - **Timer-first order:** u=1 resets at d = 1,750, 1,800, 1,900 and 1,999 ms. It does not reset at 1,700, 1,749, 2,000 or 2,100. u=2 resets at 1,500 and 1,900 but not at 1,499. u=0 never resets.
    - **Data-first order:** no reset in any of the 12 rows.
    - **Every reset row:** `0x18`, then `M5`, `M9`; `streamer=cancelled`, `notice=stream-stalled`, `conn=disconnected`, `closes=1`.
  - **SOURCE.** The auditor's Chromium quote was re-fetched at the pinned tag: `EnqueueOrder delayed_task_group_enqueue_order = GetNextSequenceNumber();` in `MoveReadyDelayedTasksToWorkQueues`, which is called from `SelectNextTaskImpl` (`https://raw.githubusercontent.com/chromium/chromium/152.0.7977.130/base/task/sequence_manager/sequence_manager_impl.cc`).
  - **Window correction.** The condition is on the gap between ticks, not the block alone: LOST when 2,000 − 250u ≤ gap < 2,000.
    - A block that starts s ms after the unchanged tick needs d = gap − s. So with u=1, blocks from about 1.5 s qualify, provided the late reply is still unread when the block starts.
  - **What the reset does mid-burn.**
    - The same poll tick sets the `stream-stalled` notice and the `streamReset` record (`laser-stream-heartbeat-containment.ts:121-127`).
    - `runGrblDisconnectTransaction` then writes `0x18` and waits for the reset banner. It cleans up with `M5`, `M9` (`laser-disconnect-transaction.ts:155-166`), then closes the port.
    - **No warning precedes it.** The notice and the reset are decided in the same task.
  - **Why P2, not P1 (§3: "the output is not wrong").**
    - Nothing burns at a wrong power, position, depth or scale. `0x18` stops motion and the beam at once, and `M5`/`M9` follow.
    - The stop is announced. The recovery record carries the reset, and a stop that may have killed the steppers mid-motion is marked position-lost (`checkpoint-interruption.ts:20-27`, ADR-215 Amd 1). So no later output inherits a lost position silently.
    - What is wrong is a false abort of a healthy job, with a notice that blames the controller or link. That is §3 P2: a misleading result, and a broken contract (ADR-356 title; Consequences: "Waiting out a page stall no longer ends the job by itself") with a clear failure scenario.
    - The ruined workpiece is the cost the code already accepts for a laser fail-dark reset: the comment at `laser-job-pause-resume.ts:334-339` cites ADR-180 Amd 3 (cited as code, not as ADR text).
  - **Reach (asked; it does not set the rating).**
    - #1488 (`24e1d2b61`, merged after the audited SHA) made large-selection edits linear. `zz-k2r-edit-timing.test.ts` measured the real store and drag path at the 10,000-object limit, in Node:
      - drag frame 5–38 ms (J10: about 3.1 s);
      - nudge 8–21 ms; Undo 7–8 ms; Redo 5–7 ms;
      - Duplicate 116 ms.
    - So J10's 2–3 s editing stalls are gone on main, and no app-caused in-job task of 1.5–2 s is known.
    - Unmeasured candidates remain:
      - GC on the 1.4–2.6 GB heap J10 measured for a 4M-line job;
      - OS paging (this PC is memory-starved);
      - canvas repaint of dense artwork;
      - worker-result hydrate;
      - archive staging (≈0.4 s in Node; Chromium 2–3× would be about 0.8–1.2 s, which reaches only the u=3 window from 1.25 s).
    - The late reply (u ≥ 1) is a Wi-Fi input that was not measured on hardware.
    - If the coordinator judges a 1.5–2 s renderer stall during a network job unreachable today, §3 makes this P3 (latent).
  - **Novelty:** new. No earlier report covers the `fetch` body ordering. No open PR touches the cited files: `gh pr list` shows only #1478, which is unrelated.
  - **K1 overlap:** the K1 card (no lit beam on a window stall) targets the beam during the stall, not this watchdog's judgement. A fix that moves network streaming into Electron main would not change where the heartbeat decides.
- **Fix direction:**
  - Do not judge silence on a tick that ran before the transport had a turn after a gap. For example, after any tick gap ≥ 500 ms, re-query and wait one more tick before declaring loss.
  - Or have the network read loop record that a response is in flight, and treat that as evidence the link is alive.

### K2-P1-2 (P2 after the refuter) — The Pause/Resume confirmation deadline is a plain 2 s timer: a UI block ≥ 2 s right after Resume resets the controller while it is in Run

- **Where:**
  - `src/ui/state/laser-pause-resume-transition.ts:48-50`: the comment says it "takes over the same silence deadline".
  - `laser-pause-resume-transition.ts:98-102,259-264`: a plain `setTimeout`, no host gap.
  - `src/ui/state/laser-job-pause-resume.ts:343-361`: a laser deadline leads to `recordPauseResumeStall`, then `failDarkStop()`.
  - Remote entry: `src/ui/remote-control/machine-actions.ts:234-238`.
- **Anchor:**
  - **Twin.** The heartbeat this deadline stands in for grants a re-query after a host gap (ADR-356 Decision 2, `laser-stream-heartbeat.ts:59-73`). The status-silence deadlines got the same treatment in ADR-356 Amd 1. This one got neither.
  - **Contract.** ADR-356's title; ADR-212 Decision: Resume waits for "a fresh post-command `Run`".
- **Scenario:**
  1. Resume (desktop button or phone) sends `~`.
  2. The Resume's own `?` is answered before the controller is back in `Run` (`Door:3`, still restoring, in the fake). The firmware's exact order of the `~` and `?` realtime flags was not checked, so the confirmation may also need the next poll reply.
  3. The UI thread blocks for ≥ 2 s. No poll tick runs, so no `?` is written.
  4. After the block, the poll tick and the 2 s liveness timer are in the same ripe batch. The tick writes `?`, but the `Run` reply is a new task behind the liveness timer.
  5. The transition fails: "Resume did not complete within the controller safety deadline…".
  6. A fail-dark reset is sent to a controller that is in `Run` (moving, beam on).
  7. A laser Pause hit the same way gets a reset on a parked machine: Door:0, no motion. The job is cancelled with a wrong notice (P2 on its own).
  8. This is transport-independent. Data-first ordering does not help, because the confirming query is written only after the block.
- **Evidence:** **REPRO**, `zz-k2-pause-block.test.ts` (real store and real Pause/Resume; the fake GRBL parks for 300 ms, or restores for 100 ms, then answers Door:0 or Run).
  - **Pause:** blocks 0, 1500, 1690 and 1710 confirmed. **2100** was rejected with `0x18` written, `streamer=cancelled`, `notice=stream-stalled`, controller `Door`.
  - **Resume:** 0 and 1500 confirmed (`streaming`, `Run`). **2100** was rejected with `0x18` written, `streamer=cancelled`, **controller state `Run`**.
  - Model note: the fake lets ticks run during the "block" but holds their replies until after it. The outcome is the one Chromium's batch order gives: no reply before the expired timer.
- **Reach:** a main-thread task of about 2 s or more within about 0.25–0.5 s of Resume, before the first `Run` report is processed. Examples: a phone Resume while someone drags a large selection on the PC (J10: 1.9–2.3 s per 8k-object frame in Node), or a GC or paging stall.
- **Refuter: CONFIRMED (independent REPRO plus READ). P1 → P2 on effect. The window is wider than the report says.**
  - **What would make it false:** Resume confirming from a reply that arrived during the block. On the worker or USB, data-first ordering processes that reply before the ripe timer.
  - **READ.** Confirming is not completing.
    - The 2 s liveness timer is cleared only when the whole transition resolves (`laser-job-pause-resume.ts:308-310`, `laser-pause-resume-transition.ts:213-221`).
    - After the `Run` report, Resume still writes the refill and awaits its settlement (`laser-pause-resume-refill.ts`, `writeWhilePauseResumeOwner`). It then awaits the worker handshake (`armHostedRefill`).
    - A worker write resolves only on the worker's reply message (`worker-serial-connection.ts:159-160,349`). Any write issued after the block therefore settles behind the ripe timer batch.
    - For a laser, a `Run` report does not refresh the deadline. Only Door restore progress does (`laser-pause-resume-confirmation.ts:163-169`).
  - **REPRO: `zz-k2r-resume-block.test.ts`.**
    - Setup: real store and real laser Resume (GRBL, `$32=1`, M4), using the repo's `cnc-pause-resume-store` fixture.
    - The controller is in `Run` after `~`. Its reply is held, then delivered 1 ms **before** the 2 s deadline, as data-first order would deliver it.
    - Every later write settles 4 ms later, on its own task, as a worker write does.
    - **Result:** `rejected`, "Resume did not complete within the controller safety deadline…". The store had just recorded `Run` from the reply; one refill line had been written; then `0x18`, `streamer=cancelled`, `notice=stream-stalled`.
    - **Controls:** the same reply delivered at 1,900 ms resolves (`streaming`, no `0x18`); so does no block.
    - Pause has no post-confirmation writes. It fails only when the settled Door report has not been processed before the deadline (auditor REPRO).
  - **Corrected window.**
    - Not "within about 0.25–0.5 s of Resume, before the first `Run` report is processed". A block that ends past the current deadline fails Resume **anywhere before the transition completes**, including after `Run` was confirmed.
    - The transition normally lasts tens of ms. With air assist on, it lasts about as long as the controller's coolant restore delay, during which Door restore reports re-arm the 2 s deadline (`laser-pause-resume-confirmation.ts:163-169`; `laser-store-laser-door-pause-resume.test.ts:45-49`).
  - **Confirmed:** the fail-dark reset lands while the controller reports `Run`, and the notice wrongly says Resume did not complete. The path is transport-independent.
  - **Why P2, not P1:** same effect as K2-P1-1.
    - `0x18` halts motion and the beam (dark, not lit), and the stop is announced.
    - A reset in motion makes GRBL raise ALARM:3, and the interruption record marks such a stop position-lost (`checkpoint-interruption.ts:20-27`).
    - Wrong notice plus an abort of a good job is §3 P2: misleading result, broken ADR-212 / ADR-356 contract.
    - A laser Pause hit the same way resets a parked machine (P2 at most).
  - **Reach.** The example of a phone Resume while someone drags a large selection is refuted on main: #1488 cut a 10,000-object drag frame to 5–38 ms in Node (see Refuted).
    - The trigger now needs a ≥ 2 s renderer stall from an unmeasured source (GC, paging, repaint), coinciding with the transition. That is narrower than K2-P1-1's trigger.
    - The phone Resume path is confirmed (`remote-control/machine-actions.ts:230-238` calls the same `resumeJob`).
  - **Novelty:** new. J10 listed this timer as READ only (`J10-scale-performance.md:367`). No open PR touches it.
- **Fix direction:**
  - Arm the deadline with the poll-schedule rule (`armSilenceTimer`, ADR-356 Amd 1): count only time the poll ran on schedule.
  - Alternatively, on expiry after a host gap, issue one fresh query and wait one reply window before failing dark.

### K2-P2-1 — On the network transport, one UI task of about 4–5 s or more aborts the in-flight read by its own 5 s timer, and the renderer closes the session mid-job without a stop

- **Where:**
  - `src/platform/electron/desktop-machine-network-api.ts:8-9,29-31`: per-request `AbortController` at 5 s.
  - `src/platform/electron/desktop-machine-network.ts:109-110`: any read error closes the connection.
  - `desktop-machine-network.ts:68-71`: any write error closes it too.
  - `electron/machine-network-bridge.ts:60-67`: 15 s lease.
- **Anchor:**
  - **Contract.** ADR-356 (title; Consequences: "Waiting out a page stall no longer ends the job by itself").
  - **Twin.** The heartbeat and ack watchdog share `HOST_SCHEDULING_GAP_MS` "so neither blames the controller for the host's gap" (`laser-stream-heartbeat.ts:9-13`). This request timer blames the link for it.
- **Scenario:**
  1. The read was issued at r. Main answers within ≤ 1 s, and the reply lands 60 ms into a block that ends after r + 5 s.
  2. After the block, the response task runs. The body task comes after the ripe abort timer, so `text()` rejects with `AbortError`.
  3. `readLoop` closes the connection, and main is asked to close the socket.
  4. In the store:
     - the streamer becomes `disconnected`;
     - the notice reads "Network connection was lost during an active job. … Use physical E-stop …";
     - **no stop line is written**.
  5. The controller runs out its buffer. Under M3 the beam then stays lit at S on the stopped head (K1-P1-3) with no host to resume, until the operator acts.
  6. Chains of shorter frames do not trigger it: each gap between frames lets the body land (E4).
- **Evidence:** **REPRO**.
  - **Electron 44 / Chromium 152, `app://`, E3.** The verbatim timer/fetch/`text()` steps of `machineNetworkRequest` (its JSON checks after `text()` omitted). The route answers after 60 ms.
    - A 4.0 s block **resolved**; 5.3 s **rejected: AbortError**, 2 of 2.
    - The same in Chrome 152.0.7977.167 over HTTP.
  - **E4 (Electron).** rAF frame chains of 3 × 3,000 ms, 4 × 2,000 ms and one 4,500 ms frame all resolved.
  - **Store,** `zz-k2-network-abort.test.ts`: the real `createDesktopMachineNetwork` connection; main's read semantics modelled; the pending read rejected with `AbortError` mid-job. Result:
    - `connection: disconnected`, `streamer: disconnected`, `notice: disconnect-during-job`;
    - writes after the abort `[]`;
    - main actions `["close"]`.
- **Why P2, not P1:** the effect (a false abort of a healthy job, and a lit stopped head under M3) is P1-class. But the trigger needs one main-thread task of about 4–5 s during a network job.
  - J10's longest in-limit in-job task was about 3.1 s at the 10,000-object limit, measured in Node; Chromium time was not measured.
  - WORKFLOW asks for responsiveness on this transport: "Keep the app open and responsive; TCP streaming is not hosted in a background worker." (`WORKFLOW.md:1985-1986`).
  - ADR-356's own Context records a production 11.95 s longest task (since sliced).
  - **Raise to P1** if a ≥ 4–5 s in-job task is shown in the desktop app.
- **Refuter: CONFIRMED (independent REPRO through the real bridge, plus READ). Stays P2.**
  - **REPRO.** The same real-bridge Electron probe as K2-P1-1: the real routes, bridge, session and TCP socket, and the real `machineNetworkRequest` with its 5 s `AbortController`. Status queries went out every 250 ms and the block started right after a tick.
    - **5,400 ms block:** the renderer closed the connection 0–4 ms after the block, 2 of 2. No line was delivered after the block, although a reply was sent about 15 ms into it, and main's socket closed.
    - **4,000 ms block:** the connection survived and six status lines were delivered, 2 of 2.
  - **READ.**
    - `close()` sets `closed` before the handlers run (`desktop-machine-network.ts:76-91`). Every later `write` therefore rejects with "Network connection is closed." (`:60`), so no stop line can be sent.
    - Main destroys the socket on the renderer's close request (`machine-network-bridge.ts:48-54`).
  - **Reach: none found on main.**
    - The trigger is one renderer task ending more than 5 s after the pending read or write was issued. With replies every 250 ms, that is a block of about 4.75–5 s.
    - After #1488 the largest in-job edit at 10,000 objects is Duplicate, at 116 ms in Node (`zz-k2r-edit-timing.test.ts`).
    - Native `alert`/`confirm`/`prompt` turn into toasts during any active job, including paused and `done` (`job-aware-dialogs.ts:20-46`, `isActiveJobStatus` at `laser-store-helpers.ts:76-80`). So no operator-held native dialog can produce the block.
    - Closing the window during a job stops the job first (`desktop-close-runtime.ts:77-89`).
    - No ≥ 4.75 s in-job task was found, so the auditor's raise condition is not met.
  - **Coordinator note (§3).**
    - Under M3, the effect is P1-class: the head drains, then stays lit with no host.
    - The stated reason for P2 is reach. §3 allows reach to lower a P1 only to P3, and only when the case is shown unreachable.
    - So this is P1 if any ≥ ~5 s in-job renderer stall is shown (GC or paging on a large-job heap is the open measurement), or P3 if one is shown impossible.
    - It is kept at P2 here because neither was shown. Under M4 (the GRBL default) the effect alone is P2: a false link loss, no stop, and a dark stopped head.
  - **K1 overlap:** the lit dwell is K1-P1-3's mechanism (card "No lit beam on a stopped head when the window stalls"). A K1 fix that keeps network streaming going during a stall, for example by moving the refill into Electron main, does not remove this abort. The session would still close after the block, and under M3 the drained head would then stay lit.
  - **Novelty:** adjacent to D7's Not-verified 15 s lease and to rolling-v2 04-P3-23. D7 records the 5 s abort as a table fact only (`D7-ctl-network-link.md:80`).
- **Fix direction:**
  - Do not abort a request that has already received its response headers.
  - Or measure the request timeout in on-schedule time (as ADR-356 Amd 1 does for status deadlines).
  - Or treat an abort that follows a host gap as retryable, not as link loss.
  - Main's 15 s lease (KNOWN-adjacent) needs the same reasoning.

### K2-P3-1 — The late-detection bound is 4 × block + 7 s, not "3 × block + 2 s" or "after at most three further gaps"

- **Where:** `src/ui/state/laser-stream-heartbeat.ts:15-19,64-73`.
- **Anchor:** **Contract.** ADR-356 Decision 2: "A silent controller behind a host that keeps stalling is still declared lost after at most three further gaps"; J10 Refuted note and AREAS K2 ("3 × the block + 2 s").
- **Scenario:**
  - The controller goes silent.
  - Each block of B ≥ 2 s grants one grace. The declaring tick after the third grace can itself wait behind a fourth block.
  - Worst case: 3(B + 1.75) + max(2, B + 1.75) s after the last change, i.e. 4B + 7 s.
  - Each block's length adds directly; no bound in time exists.
  - Beam: the heartbeat only helps a link that still carries the reset, so a longer delay mainly delays telling the operator. On the window and network transports the stall itself drains the controller (K1).
- **Evidence:** **REPRO,** `zz-k2-heartbeat-block.test.ts` part C. Time from the last delivered reply to `0x18`:

  | Blocks | Detected after |
  |---|---|
  | None | 2,249 ms |
  | 1.0 s | 2,749 ms |
  | 1.9 s | 3,649 ms |
  | 2.0 s, spaced 1.75 s | 14,999 ms |
  | 2.3 s, spaced 1.75 s | 16,199 ms (4 blocks) |
  | 2.3 s, three blocks only | 14,149 ms |
  | 2.3 s, back to back | 11,499 ms (5 blocks counted from the reply) |
  | 3.1 s | 19,399 ms |
  | 5 s | 26,999 ms |
  | 10 s | 46,999 ms |
- **Refuter: CONFIRMED (REPRO with the real detector). P3 kept.**
  - `zz-k2r-heartbeat-walk.test.ts` walks `detectActiveStreamHeartbeatLoss` for a silent controller, blocking for B ms just before each tick that would declare loss. Loss was declared after:
    - **B = 2.0 s:** 15.0 s with any number of blocks; 13.25 s with three blocks.
    - **B = 2.3 s:** 16.2 s; three blocks 14.15 s.
    - **B = 3.1 s:** 19.4 s; three blocks 16.55 s.
    - **B = 5 s:** 27.0 s; three blocks 22.25 s.
    - **B = 10 s:** 47.0 s; three blocks 37.25 s.
  - All times are measured from the last observed change. They equal 4B + 7 s exactly (3B + 7.25 s when only three blocks occur).
  - The grace count does cap at three. ADR-356's "after at most three further gaps" is accurate about graces but silent about the fourth gap, which delays the declaring tick.
  - No beam effect: the heartbeat only helps a live link.
- **Fix direction:** state the real bound in ADR-356 (a fourth gap delays the declaring tick), and pin it with a test. If a time bound is wanted, cap the graces by elapsed time as well as by count.

### K2-P3-2 — Heartbeat correctness on USB rests on an unspecified browser ordering, with no guard, no test, and a wall clock

- **Where:**
  - `src/ui/state/laser-stream-heartbeat.ts:64-73`;
  - `src/ui/state/laser-connection-actions.ts:424,432-433`;
  - `src/ui/state/laser-stream-heartbeat-containment.ts:117`;
  - `src/ui/state/laser-stream-heartbeat.test.ts` (no 1.75–1.99 s case).
- **Anchor:** **Ground truth.** HTML Living Standard, event loop processing model: "Let taskQueue be one such task queue, chosen in an implementation-defined manner."
  - Live: `https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model`, fetched 2026-10-28, page "Last Updated 26 October 2026".
  - Snapshot of that commit: `https://html.spec.whatwg.org/commit-snapshots/939677714df7379fee3667040113b41c91c851e7/` (whatwg/html `93967771`, 2026-10-26).
  - The same section says every task source "must be associated with a specific task queue". Timers (timer task source), serial data and posted messages are different sources, so no cross-source order is promised.
- **Scenario:**
  - The no-false-fire result on worker and window holds because Chromium 152 orders an immediate task posted during a block ahead of the ripe timer batch (SOURCE above; REPRO E1).
  - A scheduler change (for example, delayed tasks ordered by their due time), or another engine, turns REPRO A's timer-first rows (reset at 1.75–1.99 s) into USB behaviour. Nothing in the code or tests would notice.
  - `Date.now()` is a wall clock (`laser-connection-actions.ts:424`, `heartbeat-containment.ts:117`).
    - A forward step of 1.75–1.99 s after an unchanged tick looks like such a block.
    - A backward step delays detection by its size. `laser-stream-stall.ts:74` already guards a stepped-back clock for the busy time.
- **Evidence:** SOURCE + REPRO (the timer-first rows show the consequence if the order flips).
- **Refuter: CONFIRMED (SOURCE re-fetched, REPRO of the ordering, READ). P3 kept.**
  - **HTML.** Re-fetched live on 2026-10-28 (page "Last Updated 26 October 2026"). Both quotes are verbatim:
    - "Let taskQueue be one such task queue, chosen in an implementation-defined manner." (event loop processing model);
    - "For each event loop, every task source must be associated with a specific task queue."
  - **Chromium.** The delayed-batch enqueue order was re-fetched at tag `152.0.7977.130` (see K2-P1-1).
  - **USB worker spot-check (REPRO, Electron 44.5.1).** A dedicated worker posts every 5 ms. After a 1,900 ms block, all 380 messages queued during the block ran before the overdue 250 ms tick, 4 of 4. The tick ran 1–2 ms after the block. The auditor's "USB is clean" therefore holds for the worker in today's Chromium, by ordering alone.
  - **READ.**
    - No guard: a tick after a gap shorter than 2 s still declares loss (`laser-stream-heartbeat.ts:64-73`).
    - No test covers u=1 with 1.75–1.99 s (`laser-stream-heartbeat.test.ts`).
    - `Date.now()` is used at `laser-connection-actions.ts:424,432-433` and `laser-stream-heartbeat-containment.ts:117`. The step-back guard exists only for the stall's busy time (`laser-stream-stall.ts:74-77`).
  - Latent; it stays P3.
- **Fix direction:** the K2-P1-1 guard (a tick after a gap ≥ ~0.5 s may not declare loss) removes the dependence. Use `performance.now()` for these intervals, and add a store test for u=1 with d = 1.8–1.99 s.

## KNOWN re-observed

- **J10 refuter "one edge, not raised"** (`J10-scale-performance.md:376-381`): the origin of this area.
  - Refuted here for the worker and window transports.
  - Raised as K2-P1-1 for the network transport, where the condition "a browser that runs the overdue interval before an earlier-queued serial read" holds for `fetch` bodies.
- **K1-P1-3** (network FluidNC/grblHAL stream from the window; M3 lit during a stall): K2-P2-1 adds that a stall of about 5 s or more also ends the session, so the stream never resumes.
- **controller-v3 D7, Not verified** ("Lease expiry under a long renderer stall", `D7-ctl-network-link.md:576-579`) and **rolling-v2 04-P3-23 / J2 K-04-P3-23** (the 15 s lease): adjacent to K2-P2-1. The 5 s request abort fires three times sooner than the noted lease.
- **2026-10-20 controller design audit D-1:** the heartbeat stop sends Ctrl-X at once, mid-motion (ALARM:3, position lost). This is why K2-P1-1's false fire costs position.
- **controller-v3 D7-P3-3:** stall and link-loss notices say "USB" on a TCP session. The false notices of K2-P1-1 and K2-P2-1 inherit this.
- **rolling-v3 H2-P2-1:** heartbeat-loss containment records `stream-stalled` without the planner backlog. It applies to false fires as well.

## Refuted

- **"After a status check that saw no new reply, a 1.8–1.99 s UI block trips the 2 s heartbeat and resets a healthy job" (the AREAS mechanism), on the worker transport.** Refuted by REPRO.
  - Electron 44 / Chromium 152, E1: a worker posting every 5 ms. A 1.9 s block was started from a MessageChannel task, a rAF callback, or inside the tick itself, 8 trials. All 379–381 queued messages ran before the overdue `setInterval` tick, which ran 1.6–2.1 ms after the block. Chrome 152.0.7977.167 gave the same in 8 of 8.
  - E5: between back-to-back rAF frames (4 × 900 ms; 3 × 1,900 ms) every gap ran all queued messages, 180 or 379–381, plus one tick.
  - So the overdue tick sees every line the worker relayed during the block. LOST then needs no output for about 2 s after queries written on schedule. That is the same rule as with no block, so it is not a false fire.
- **The same on the window Web Serial transport.** Refuted by SOURCE: Chromium `152.0.7977.130` `serial_port_underlying_source.cc`.
  - The data-pipe watcher's task (`OnHandleReady` → `ReadDataOrArmWatcher`) does `controller_->enqueue(...)` and resolves the pending pull in that same task. The app's `await reader.read()` continuation and its first 8 ms slice (`serial-read-loop.ts:103-110`, `serial-read-slice.ts:21`) therefore run before the ripe timer batch.
  - Only later slices, which yield by MessageChannel, come after the tick. The first slice always holds the earliest acks or status lines.
  - Not run with a real port (Not verified).
- **"Detection may run as late as 3 × block + 2 s"** is corrected by K2-P3-1 to about 4 × block + 7 s.
- **"A false heartbeat fire needs a status reply more than one tick late" (J10's first condition) on USB.** Refuted: with data-first ordering a late reply still lands before the overdue tick, provided it arrived during the block.
- **Refuter: the reach example "J10 measured one 8k-object drag frame at 1.9–2.3 s" (K2-P1-1 step 7 and K2-P1-2 Reach) no longer holds on main.**
  - #1488 (`24e1d2b61`, merged after the audited SHA) writes one drag frame as one `setObjectTransforms` call.
  - At 10,000 selected objects (Node, real store and drag path, `zz-k2r-edit-timing.test.ts`): drag frame 5–38 ms, nudge 8–21 ms, Undo 7–8 ms, Redo 5–7 ms, Duplicate 116 ms.
  - The findings stand on other, unmeasured stall sources. Neither rating depends on this example.
- **Refuter: "K2-P1-2 needs the block before the first `Run` report is processed."** Too narrow, so the window is wider, not refuted. Resume also fails when `Run` was already processed before the ripe deadline, because the refill write and the worker handshake settle on later tasks (`zz-k2r-resume-block.test.ts`).

## Verified clean

- **Ack stall / hold containment (90 s)** cannot be reached by a sub-2 s block on any transport. The probe restarts on every ≥ 2 s gap (`laser-stream-stall.ts:70-72`) and on every fresh Run report (`:91-98`). READ, plus REPRO A: no hold containment in any row.
- **Status-silence deadlines** (post-job settle, fresh Idle, recovery) are host-aware (`laser-status-poll-schedule.ts:37-70`, ADR-356 Amd 1). READ.
- **Lost-reply reconciliation** acts only on positive Idle evidence. It never resets (`laser-lost-ack-reconcile.ts:12-41,95-130`). READ.
- **The worker thread has no watchdog.** It reads, refills and relays every line by `postMessage` (`serial-worker-core.ts:5-16`; `worker-serial-connection.ts:291`). Reads are off the UI thread; every judgement is on it. READ.
- **Frame chains do not merge into one block.** E4 and E5 (Electron): each gap between frames runs the queued I/O and one poll tick. A canvas drag of many ~1–2 s frames therefore behaves as separate blocks, both for the heartbeat and for the network abort.
- **Electron `unresponsive`** only records a support-log line and close-guard state. It takes no job action (`support-log.ts:246-249`, `window-close-guard.ts:56-57`). READ.
- **A pause of under 2 s is safe.** Pause blocks up to 1.71 s and Resume up to 1.5 s confirmed (REPRO).

## Not verified

- **Web Serial in a real browser.** There is no serial device. The window-transport ordering rests on Chromium source, not a run.
- **Real Wi-Fi reply latency** of FluidNC and grblHAL: how often a status reply is ≥ 250 ms late, which is K2-P1-1's precondition. No hardware was operated.
- **Main-thread task lengths in the desktop app.** Whether a ≥ 4–5 s single task (K2-P2-1) or a ≥ 2 s task right after Resume (K2-P1-2) occurs in Chromium within project limits. J10's times are Node; GC and paging stalls were not measured.
- **KerfDesk's real `app://` handler.** The probe used a minimal `protocol.handle` stand-in in the same Electron. Renderer-side body delivery is Chromium's in both cases.
- **A minimised desktop window** (backgroundThrottling off). The Electron probe window reported `visible`.
- **Chromium source line numbers.** The fetch tool could not resolve them; functions are named at the pinned tag instead.
- **Refuter: stall sources after #1488.** None was measured in Chromium:
  - GC pauses on a 1.4–2.6 GB job heap;
  - OS paging;
  - canvas repaint of dense artwork;
  - worker-result hydrate;
  - archive staging and its IndexedDB put.
  - These decide whether K2-P1-1/P1-2 are reachable today (P2 against latent P3) and whether K2-P2-1 is P1 or P3. A large-heap Electron GC probe was not run, because this PC is low on memory.
- **Refuter: the real KerfDesk window.** The real-bridge probe ran the real route, bridge, session and connection code, but not the full app. The other protocol wrappers (licence, camera, remote, project routes) pass the request through in main, and none of them changes renderer-side task order.

## Repro files

All were created in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and **deleted at the end**. No other file under `j7-main` was touched; the `zz-j7-*` and `zz-k3r*` files were left alone.

| File | What it did |
|---|---|
| `src\ui\state\zz-k2-heartbeat-block.test.ts` | **A:** real store, poll, heartbeat and containment against a fake GRBL link (Run replies, G1 never acked). u ∈ {0..3} ticks with held replies, then blocks of 1,000–2,100 ms, with the queued replies delivered before (data-first) or after (timer-first) the overdue tick. **C:** silent controller under repeated blocks (0–10 s, spaced 0 / 1.5 / 1.75 s), time to `0x18`. |
| `src\ui\state\zz-k2-pause-block.test.ts` | Real laser Pause and Resume (GRBL, `$32=1`) with a fake that parks (Door:2 → Door:0 at 300 ms) or restores (Door:3 → Run at 100 ms); blocks of 0–2,100 ms. |
| `src\ui\state\zz-k2-network-abort.test.ts` | Real store over the real desktop network connection, with main's read semantics modelled. The pending read is rejected with `AbortError` mid-job, and the store outcome is recorded. |
| `zz-k2-order.html` | Browser probe. **E1:** worker messages vs an overdue `setInterval` after a 1.9 s block. **E2:** fetch response, body and a second fetch vs overdue timers. **E3:** the request steps of `machineNetworkRequest` vs its 5 s abort. **E4:** the same under rAF frame chains. **E5:** messages and ticks between back-to-back frames. |
| `zz-k2-electron-main.cjs` | Runs `zz-k2-order.html` in the repo's Electron 44.5.1 from an `app://` `protocol.handle` route (hidden window, backgroundThrottling off) and prints the JSON. Command: `node_modules/electron/dist/electron.exe zz-k2-electron-main.cjs [--k2query=?e3only\|?e45only]`. |
| `zz-k2-server.mjs` | Loopback-only HTTP server (127.0.0.1) serving the probe and a `/slow` route, for the browser-pane run. |

Vitest command: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`.

**Refuter repro files** (all deleted at the end).
- The Vitest files were in `j7-main` refreshed to `f1d919fbf`.
- The Electron probe was in the session scratchpad `zz-k2r-probe\`, outside `j7-main`.
- No other file under `j7-main` was touched.

| File | What it did |
|---|---|
| `src\ui\state\zz-k2r-heartbeat-store.test.ts` | Real store, poll, heartbeat and containment. u ∈ {0,1,2} unchanged ticks, then a block of d ms modelled with `vi.setSystemTime`. Replies were read after (timer-first) or before (data-first) the overdue tick. 24 rows, all as predicted. |
| `src\ui\state\zz-k2r-resume-block.test.ts` | Real laser Resume (fixture `cnc-pause-resume-store`). The `Run` reply was delivered 1 ms before the deadline, and later writes settled one task later. Controls: 1,900 ms and no block. |
| `src\ui\state\zz-k2r-heartbeat-walk.test.ts` | Real `detectActiveStreamHeartbeatLoss` walk for a silent controller under blocks of 0–10 s: 4B + 7 s. |
| `src\ui\workspace\zz-k2r-edit-timing.test.ts` | Real store and drag path at 10,000 selected objects after #1488: drag frame, nudge, Undo, Redo, Duplicate. |
| `zz-k2r-probe\zz-k2r-build.cjs` | Transpiles `electron/machine-network-{routes,bridge,session,telnet,protocol}.ts`, `app-route-guard.ts` and the renderer's `desktop-machine-network*.ts`, `serial-wire-encoding.ts` and `laser-stream-heartbeat.ts` from `f1d919fbf`. TypeScript `transpileModule` only strips types. |
| `zz-k2r-probe\zz-k2r-main.cjs`, `zz-k2r-page.html`, `zz-k2r-page.js` | Electron 44.5.1 main with the app's scheme privileges and `protocol.handle('app', withMachineNetworkRoutes(...))`, plus a fake grblHAL (`grblhal-raw`) on a 127.0.0.1 TCP server. Page experiments: **EB**, the end-to-end heartbeat (15 trials); **EC**, the 5 s abort (4 trials); **ED**, worker messages against an overdue tick (4 trials). The server was closed and the app exited on completion. Command: `electron.exe zz-k2r-main.cjs --k2q=only=eb\|ec\|ed`. |

```json
[
  {"id":"K2-P1-1","severity":"P2","severity_auditor":"P1","area":"watchdog-timing","file":"src/platform/electron/desktop-machine-network.ts","line":95,"anchor":"Contract: ADR-356 title + Decision 2 ('while the host is polling on schedule') + Consequences ('Waiting out a page stall no longer ends the job by itself'); Twin: the same block on the ADR-354 worker transport is harmless; Ground truth: Chromium 152.0.7977.130 sequence_manager enqueue order (immediate at post, delayed batch when moved) and frame_scheduler_impl ComputePriority (timers, posted messages, networking all normal)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED on f1d919fbf (cited files unchanged since ef52782a6). REPRO 1, Electron 44.5.1 through the REAL app:// machine-network route/bridge/session (transpiled from main) over a real loopback TCP socket to a fake grblHAL, real renderer connection + real detectActiveStreamHeartbeatLoss: u=1 then d=1800/1900/1950 ms -> LOST at the overdue tick 9/9; d=1600 0/3; u=0 d=1900 0/3; in all 15 trials the overdue tick ran before either reply reached onLine. REPRO 2, store (real poll/heartbeat/containment, vi.setSystemTime block): timer-first u=1 resets at 1750-1999 not 1700/1749/2000/2100, u=2 at 1500+ not 1499; data-first never; reset rows 0x18 then M5,M9, cancelled, stream-stalled, disconnected, closes=1. SOURCE re-fetched: sequence_manager_impl.cc@152.0.7977.130 'EnqueueOrder delayed_task_group_enqueue_order = GetNextSequenceNumber();'. Window is on the tick gap (2000-250u <= gap < 2000), so blocks from ~1.5 s qualify at u=1 if the late reply is still unread. P1 -> P2 on effect (not reach): fail-dark announced stop, nothing burns at wrong power/position, interruption record carries the reset/position-lost (checkpoint-interruption.ts:20-27); defect = false abort + misleading notice = P2 broken ADR-356 contract. Reach: #1488 removed the cited 8k drag-frame trigger (10k drag frame 5-38 ms Node); remaining ~1.5-2 s sources (GC, paging, repaint, hydrate) unmeasured; P3 if judged unreachable","known":"origin: J10 refuter edge note (not raised); network transport is new","summary":"Network FluidNC/grblHAL: a reply that arrived during a UI block is delivered only after the overdue poll tick (Electron 44 app:// fetch body after the ripe interval, 6/6), so after u>=1 ticks with no new reply (a status reply >=250 ms late) a block of [2000-250u, 2000) ms makes the heartbeat declare a live link lost: 0x18, M5/M9, streamer cancelled, stream-stalled, port closed (store REPRO: u=1 resets at 1750-1999 ms, u=2 at 1500-1999, u=3 at 1250-1999; data-first never)"},
  {"id":"K2-P1-2","severity":"P2","severity_auditor":"P1","area":"watchdog-timing","file":"src/ui/state/laser-pause-resume-transition.ts","line":263,"anchor":"Twin: heartbeat host-gap grace (ADR-356 Decision 2, laser-stream-heartbeat.ts:59-73) and ADR-356 Amd 1 status-silence deadlines vs this deadline, which 'takes over the same silence deadline' (laser-pause-resume-transition.ts:48-50) as a plain setTimeout; Contract: ADR-212 Decision (Resume waits for a fresh post-command Run), ADR-356 title","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED on f1d919fbf. REPRO zz-k2r-resume-block (real laser Resume, cnc-pause-resume-store fixture): controller Run reply delivered 1 ms BEFORE the 2 s deadline (data-first), later writes settle one task later (as worker writes resolve only on the worker's reply, worker-serial-connection.ts:159-160,349) -> rejected 'Resume did not complete...', store had recorded Run, one refill line written, then 0x18, cancelled, stream-stalled; controls at 1900 ms and no block resolve. Window corrected: a block ending past the deadline fails Resume anywhere before the transition completes (refill write + armHostedRefill), not only before Run is processed; a laser Run report does not refresh liveness (laser-pause-resume-confirmation.ts:163-169). Transport-independent confirmed. P1 -> P2 on effect: 0x18 halts motion and beam (dark), announced, reset-in-motion is ALARM:3 and the interruption record marks position-lost; wrong notice + aborted good job = P2. Reach example (phone Resume during an 8k drag) refuted by #1488; trigger now needs an unmeasured >=2 s stall during the transition. Remote path confirmed (machine-actions.ts:230-238)","known":false,"summary":"Pause/Resume liveness is a plain 2 s setTimeout: during a UI block no status query is written, so a block ending >2 s after the click fails the transition on any transport and a laser gets failDarkStop. REPRO: Resume block 2100 ms -> 'Resume did not complete', 0x18 written with the controller in Run (reset in motion), streamer cancelled; Pause 2100 ms -> 0x18 on a parked Door:0; blocks <=1.5-1.71 s confirm. Reachable from the desktop button and the phone (machine-actions.ts:234-238)"},
  {"id":"K2-P2-1","severity":"P2","area":"watchdog-timing","file":"src/platform/electron/desktop-machine-network-api.ts","line":9,"anchor":"Contract: ADR-356 title + Consequences; Twin: HOST_SCHEDULING_GAP_MS shared so 'neither blames the controller for the host's gap' (laser-stream-heartbeat.ts:9-13) vs a fixed 5 s request abort","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED on f1d919fbf. REPRO through the REAL app:// bridge (Electron 44.5.1, real machineNetworkRequest 5 s AbortController, real TCP socket): 5,400 ms block after a poll tick -> renderer closed the connection 0-4 ms after the block 2/2, zero lines delivered although a reply was sent ~15 ms into the block, main socket closed; 4,000 ms block survived 2/2. READ: close() sets closed first so every later write rejects (desktop-machine-network.ts:60,76-91): no stop line possible. Stays P2: no >=4.75 s in-job task found on main (post-#1488 10k Duplicate 116 ms Node; native dialogs are toasts during any active job, job-aware-dialogs.ts:20-46; window close stops the job first). Coordinator note: under M3 the effect is P1-class; by Sec. 3 reach can only lower to P3 when unreachable, so this is P1 if any >=~5 s in-job stall is shown (GC/paging unmeasured) or P3 if shown impossible. K1 card overlap: a K1 fix that keeps the network stream fed does not remove this abort","known":"adjacent: controller-v3 D7 Not verified (15 s lease under a renderer stall), rolling-v2 04-P3-23","summary":"Network transport: a single UI task ending >5 s after a read was issued (reads re-issued <=1 s apart, so ~4-5 s) aborts it by its own AbortController even though the reply arrived 60 ms into the block (Electron 44 app://: 4.0 s resolved, 5.3 s AbortError 2/2); readLoop closes the connection: streamer disconnected, 'Network connection was lost during an active job', no stop line, main asked to close the socket; under M3 the drained head stays lit with no host to resume (K1-P1-3). Frame chains (3x3 s, 4x2 s) do not trigger it. P2 because no >=4-5 s in-job task was shown in the desktop app (J10 Node max ~3.1 s at 10k objects) and WORKFLOW.md:1985 asks to keep the app responsive; P1 if one is"},
  {"id":"K2-P3-1","severity":"P3","area":"watchdog-timing","file":"src/ui/state/laser-stream-heartbeat.ts","line":19,"anchor":"Contract: ADR-356 Decision 2 ('declared lost after at most three further gaps'); AREAS K2 / J10 Refuted note ('3 x block + 2 s')","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED: walk of the real detectActiveStreamHeartbeatLoss, blocking B just before each would-be-LOST tick: B=2.0/2.3/3.1/5/10 s -> 15.0/16.2/19.4/27.0/47.0 s from the last change = 4B+7 s exactly; three blocks only 3B+7.25 s. Grace count does cap at 3; the fourth gap delays the declaring tick. P3 kept","known":false,"summary":"Silent-controller detection under repeated blocks of B>=2 s is 3(B+1.75)+max(2,B+1.75) s ~ 4B+7 s, not 3B+2 s: 15.0 s at B=2.0, 16.2 at 2.3, 19.4 at 3.1, 27.0 at 5, 47.0 at 10 (no block 2.25 s); bounded in block count, unbounded in time"},
  {"id":"K2-P3-2","severity":"P3","area":"watchdog-timing","file":"src/ui/state/laser-stream-heartbeat.ts","line":64,"anchor":"Ground truth: HTML Living Standard event loop ('chosen in an implementation-defined manner'; each task source has its own queue), commit 939677714df7379fee3667040113b41c91c851e7; L7 test gap","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED: HTML quotes re-fetched live 2026-10-28 (Last Updated 26 October 2026) verbatim ('Let taskQueue be one such task queue, chosen in an implementation-defined manner.'; 'For each event loop, every task source must be associated with a specific task queue.'); Chromium delayed-batch enqueue order re-fetched at 152.0.7977.130; Electron 44.5.1 worker spot-check: all 380 messages queued in a 1.9 s block ran before the overdue tick 4/4 (USB worker clean by ordering alone); READ: no guard, no u=1 1.75-1.99 s test, Date.now() at laser-connection-actions.ts:424,432-433 and containment :117. P3 kept","known":false,"summary":"USB heartbeat correctness depends on Chromium ordering an I/O task posted during a block ahead of the ripe timer batch, which HTML does not guarantee; no guard (a tick after a gap may still declare loss), no test for u=1 with 1.75-1.99 s blocks, and Date.now() wall clock (a 1.75-1.99 s forward step after an unchanged tick looks the same; a backward step delays detection)"}
]
```
