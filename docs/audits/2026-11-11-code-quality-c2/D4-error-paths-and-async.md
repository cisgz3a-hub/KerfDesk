# D4 — error paths and async (code quality audit C2)

**Question.** Do failures surface, and do async steps stay in order?
**Tree.** `origin/main` @ `5c351a6b3` (git archive `j30-main`), read-only.
**Method.**
- Grep inventory of swallowed errors, `void` calls, fixed waits, workers and cancellation, then triage by risk: saving, project load, export, controller links, camera, licence/update, phone, recovery.
- Each suspect was driven to its failure with Node scripts on the real modules (`zz-d4/register.mjs` loader). The scripts used:
  - the repo's simulators: `LihuiyuSimulator` behind the real CH341 EPP driver and opener, and `MoshiSimulator`;
  - fault injection: a USB transfer that throws, slowed USB writes, an injected worker that fires `error`, and a fake `navigator.wakeLock`.
- No Vitest or browser run: free memory stayed at 0.6–1.9 GB.

## Headline

One P1, from a race between two merges. The K40 (Lihuiyu, ADR-703, #1724) USB link merged three minutes before #1753, which made Moshi and Ruida link jobs count as machine work. #1753's registry names only those two, so a running K40 job is invisible to every always-mounted guard:
- `Ctrl+.` does nothing;
- the job bar never shows;
- the desktop close and Update handshakes answer "ready" and send no stop;
- project drop, Machine Setup Save and session end proceed;
- the job-aware dialogs open a *native* confirm that freezes the only thing streaming packets to the board.

The board gets no more packets once the window closes, so the burn stops part-way.

Two P2s are the same "a guard reads only the line-based laser store" shape, in places #1753 did not reach:
- the job keep-awake (ADR-117) is never requested for a Moshi, Ruida or K40 job;
- the crash screen's software ABORT (F60/F65) is hidden during a link job, and pressed it would stop only the laser store.

Two P3s:
- a K40 link that fails mid-job or at Connect is never closed (the D1-P3-1 rule, fixed for Moshi and WebUSB but not here);
- the Inspector's carved-stock and burn workers have no `error` listener, so "Save as STL…" can wait for ever.

The rest of the inventory is in good shape:
- the 146 `.catch(() => undefined)`-style swallows are queue tails, best-effort cleanup or advisory reads;
- the controller waits that follow motion already time on status silence, not wall-clock;
- every save path reports its failure.

## Inventory

Counts are over `src/` and `electron/`, excluding tests, `__fixtures__` and test-support files.

| Pattern | Count | Triage |
|---|---|---|
| `.catch(() => undefined \| null \| false \| {})` | 146 | 11 are promise-queue tails (`tail = next.catch(…)`), which is correct. 43 are close, cancel, release or unlink cleanup. The other ~92 were read by area; see the triage below. |
| `catch {` blocks (no binding) | 523 | Most return a fallback value or a typed failure. ≥32 are empty or comment-only (the multiline search timed out). The ones read (autosave, web-serial, desktop-project-files, prepare-output-async, compilation bridges) are documented best-effort paths. |
| `catch (e) {` blocks | 592 | Sampled on the risk paths below. |
| `void <call>(` | 691 | The risk-path ones were read: the panel buttons (`void board.abort()` and similar) and the remote and settlement idioms. |
| `setTimeout(` | 223 | — |
| Fixed `*_MS` / `TIMEOUT` constants on machine and file paths | 164 | See the timeout table. |
| `new Worker(` clients | 42 | 4 set no `error` handler: `burn-worker-client`, `stock-worker-client`, `cut3d-offscreen-worker-client` (delegates to its session) and `canvas-compilation-main-bridge` (delegates). The first two are D4-P3-2. |
| `AbortSignal` mentions (158 `signal.aborted` checks) | 284 | Cancellation was read for trace, import, nesting, G-code save and output preparation; see Verified clean. |
| Electron `ipcMain` | 0 | The renderer reaches main over guarded `app://` routes. |

### Swallow triage (risk paths)

| Path | Site | Verdict |
|---|---|---|
| Autosave | `autosave-durable.ts:127` (the claim is started early; the queued clear awaits the same promise) | Clean. The failure reaches the queued op. `use-autosave.ts` toasts failures and feeds `background-save-health`. |
| Project open from the OS | `external-project-open.ts:90` | Clean. `handleExternalProjectOpen` toasts its own errors, and `initialLicenceStatus()` never rejects (`edition.ts:87-95`). |
| Pro-gated STL import | `import-dispatch.ts:343` | Clean. `importStlFiles` toasts each failure (`stl-import-action.ts:82-88`). |
| Text-render advisories in output | `prepare-output-snapshot.ts:357`, `render-variable-text.ts:47` | Clean. Advisory only; the output is never refused or changed. |
| Close handoff stop | `desktop-close-controller.ts:234,259` | Clean for the laser store; `stopForAttempt` shows the failure. The link-job half is D4-P1-1 (K40). |
| Recovery broadcast refresh | `recovery-window-link.ts:54` | Clean. A best-effort cross-window refresh. |
| Remote (phone) settlement | `machine-execution.ts:77,181` | Clean. Pre-handled promises, awaited later. |
| Camera feed / head capture | `machine-frame-feed.ts:100`, `head-capture-store.ts:72` | A frame decode drop is benign. A failed `cancelJog` raises the store's own write-failed notice. |
| Licence background refresh | `desktop-licensing.ts:174,180`, `licensing-schedule.ts:58` | Clean. The runtime records its own status. |
| Machine-link cleanup | `moshi-usb-store.ts:128,134,174`, `lihuiyu-usb-store.ts:160`, `desktop-ruida-network.ts:77,111` | Correct where reached. **But** the K40 store never reaches `closeLive` on a failure: D4-P3-1. |
| Frame modal pop (Smoothieware `M121`) | `laser-frame-modal-restore.ts:66` | Not a defect found. The counter is zeroed before a write that a live port does not refuse; a failed write is a port fault with its own notice. |

### Fixed waits on machine and file work

| Wait | Where | Follows the work? |
|---|---|---|
| Fresh-Idle wait, 8 s | `laser-interactive-command.ts:324-363` | **Yes.** Re-armed on every status report, so it measures silence. |
| Frame status burst, 3 s | `frame-status-wait.ts:13` | Yes. It waits for a report field, not for motion. |
| Abort turn-back | `abort-rotary-turn.ts` | KNOWN Z2-P2-1 (fixed), and Z4-P3-1 (slow `$11x` axis, open). |
| Moshi ready/finish polls | `moshi-link-session.ts:98-116` | Yes. No cap (`maxPolls` unset), and Abort stays reachable. |
| Ruida ACK, 1 s per datagram | `ruida-udp-session.ts:32` | A protocol verdict (MeerK40t), not motion. |
| K40 silent reads | `lhy-link.ts:64,141-143` | 500 status-0 reads with pauses growing to 100 ms (~45 s); counts silence. |
| Autosave worker, 60 s | `autosave-preparation-client.ts:66` | Announced: "Autosave preparation timed out" toast. Not measured on a huge project (Not verified). |
| CNC pause lift, 60 s / reset 8 s | `cnc-pause-lift-commands.ts:43-47` | Plausible for a Z lift. Not measured. |
| Electron project save rename retry | `desktop-project-save.ts:22-23` | 5 tries with a growing wait, for a scanner holding the file. Clean. |

## Findings

### D4-P1-1 — A running K40 (Lihuiyu USB) job is invisible to Abort, close, Update and every other machine-work guard

- **Where:**
  - `src/ui/state/link-machine-work.ts:14`: `LinkMachineSource = 'moshi-usb' | 'ruida-network'`.
  - `src/ui/state/lihuiyu-usb/lihuiyu-usb-store.ts:64-77`: the store never calls `reportLinkMachineWork`; compare `moshi-usb-store.ts:292-305`.
  - Readers of the registry that therefore miss the K40:
    - `use-job-shortcuts.ts:99` (`Ctrl+.`);
    - `LinkMachineWorkBar.tsx:27`;
    - `desktop-close-runtime.ts:37` (close and Update) and `:85` (`abortAllLinkMachineWork`);
    - `desktop-session-end.ts:60`;
    - `dropped-project-open.ts`, `restore-unsaved-work.ts`, `restore-local-snapshot.ts`;
    - `use-machine-setup-save.ts:54`;
    - `job-aware-dialogs.ts:24-27`.
  - The K40 Abort lives only in `LihuiyuUsbDetails.tsx` (a collapsed `<details>` in the Machine details popover), and `LihuiyuUsbPanel.tsx:26-27` unmounts it when the profile's controller changes.
- **Anchor:** PROJECT.md non-negotiable 9 (Abort reachable from any window state during a job); ADR-705 Amendment 3 (link jobs count as machine work); H13 (`job-aware-dialogs.ts`: no native modal during a job).
- **Evidence:** REPRO `zz-d4/a1-lihuiyu-guards.mts` → `out/a1.txt`. A K40 job runs on the repo's `LihuiyuSimulator` through the real opener and CH341 EPP driver (USB writes slowed to 15 ms), at phase `running` with 2 of 21 packets sent. During the job:
  - `activeLinkMachineWork() = null`, `anyMachineJobActive() = false`, and the dropped-project guard `jobActive = false`;
  - `jobAwareConfirm(…)` **opened the native `window.confirm`** (a Moshi or laser job gets a toast instead);
  - `Ctrl+.` through the real capture-phase listener: `handled=false`, 0 board resets, still `running`;
  - `desktopCloseController.prepareForUpdate` and `.prepare` both answer `{"status":"ready"}` with no notice;
  - the close handoff's `abortAllLinkMachineWork()`: 0 resets, and packets keep going;
  - Control: the panel Abort resets the board (1 reset, `idle`).
- **Scenario:** A K40 engraving is running. The operator does any of these:
  - presses `Ctrl+.`: nothing happens;
  - closes the desktop window: it closes at once, the renderer stops streaming, and the board stops after its few-packet FIFO, part-way through the piece;
  - presses Update: same;
  - drops a project on the window: it is replaced mid-job;
  - presses File > New with unsaved work: a native confirm freezes the renderer, so no packet goes out until it is answered;
  - switches the device profile: the only Abort unmounts.
- **Severity:** **P1.**
  - It ruins the piece (a burn truncated by a close or Update that asked nothing).
  - It is the same non-negotiable 9 gap the coordinator rated P1 in D1-P2-5.
- **Announced?** No. The panel says "experimental" and "not qualified on hardware", but nothing says that `Ctrl+.`, close or Update ignore the job.
- **Novelty:** New. #1724 (Lihuiyu) merged at 20:27:48 and #1753 (the registry) at 20:30:54 on 2026-11-11, so neither PR saw the other. D1 did not review #1724.
- **Fix direction:**
  - add `'lihuiyu-usb'` to `LinkMachineSource` and `activeLinkMachineWork`;
  - give the K40 store the same `subscribe → reportLinkMachineWork` block as Moshi, with its `abort` and the phases `framing`, `running`, `paused` and `stopping`;
  - add a test that every store with a `running` phase registers. A type-level list of link stores would make the next one fail to compile.

### D4-P2-1 — The job keep-awake (ADR-117) is never requested for a Moshi, Ruida or K40 job

- **Where:** `src/ui/app/use-active-job-wake-lock.ts:45-53` subscribes to `useLaserStore` only (`isActiveJob(state.streamer)`). Nothing else in `src/` or `electron/` keeps the system awake: there is no `powerSaveBlocker`.
- **Anchor:** ADR-117 and Amendment 1. The file's own header says "OS display-sleep can't suspend the tab / renderer mid-stream". ADR-705 Amendment 3 says link jobs count as machine work.
- **Evidence:** REPRO `zz-d4/a3-link-job-wake-lock.mts` → `out/a3.txt`. The real `installActiveJobWakeLock` was given a counting fake `navigator.wakeLock`:
  - a Moshi job (`running`, link work registered): 0 requests;
  - a K40 job (`running`, 2 of 21 packets): 0 requests;
  - control, a line-based laser job: 1 request, released when the job ends.
  - Ruida: READ, the same subscription.
- **Scenario:** A long K40 or multi-program Moshi job, on a laptop with "sleep after 15 minutes". The host is the stream: the K40 store sends every packet, and Moshi sends each program in turn. The OS sleeps the display and then the system, so packets stop and the job is cut off part-way. The laser path gets a lock, or the console line "Keep-awake unavailable" when it cannot. The link paths get neither.
- **Severity:** P2. A broken contract with a clear failure: a truncated job, with no wrong position or power. It is reachable whenever the OS sleep timeout is shorter than the job.
- **Announced?** No.
- **Novelty:** New. It is the D1-P2-3 shape (a guard reading only the laser store), in a guard #1753 did not list.
- **Fix direction:** subscribe the keep-awake to `anyMachineJobActive()` (laser store plus the link registry, including the K40 once D4-P1-1 is fixed). Optionally hold an Electron `powerSaveBlocker('prevent-app-suspension')` for the same span.

### D4-P2-2 — The crash screen's software ABORT is hidden during a link job, and would stop only the laser store

- **Where:**
  - `src/ui/app/crash-recovery.tsx:24-45`: `machineSoftwareAbort.isMotionLive` and `.trigger` read only `useLaserStore`.
  - `src/ui/common/ErrorBoundary.tsx:224`: the ABORT button renders only when `isMotionLive()` is true.
  - `LinkMachineWorkBar` sits inside `AppWorkspace` (`App.tsx:131`), so a workspace crash unmounts it.
- **Anchor:** F60/F65 (the crash screen keeps a software Abort because a render crash unmounts the Live Motion bar); NN 9; ADR-705 Amendment 3.
- **Evidence:** REPRO `zz-d4/a4-crash-screen-abort.mts` → `out/a4.txt`. During a Moshi job (`running`, link work registered, laser store disconnected):
  - `isMotionLive() = false`;
  - the real `ErrorBoundary` rendered in its crashed state has **no ABORT button**;
  - `machineSoftwareAbort.trigger()` resolves with 0 estops written, and the job stays `running`;
  - Control, a laser-store job: `isMotionLive` is true and the ABORT button is present.
- **Scenario:** A render error during a Moshi, Ruida or K40 job.
  - **Workspace boundary:** the job bar is gone and the crash screen shows no ABORT. Only `Ctrl+.` remains, which `AppProtections` still mounts. For the K40, `Ctrl+.` misses too (D4-P1-1).
  - **Root boundary:** nothing at all can stop the job.
- **Severity:** P2. It needs a render crash, and `Ctrl+.` still reaches Moshi and Ruida after a workspace crash. The refuter may weigh it against D1-P2-5 (P1).
- **Announced?** No.
- **Novelty:** New. #1753 wired `Ctrl+.`, the bar and the close handoff, but not the crash screen.
- **Fix direction:** have `isMotionLive` and `trigger` consult `activeLinkMachineWork()` and call its `abort`, as `stopShortcutAction` does (`use-job-shortcuts.ts:96-100`).

### D4-P3-1 — A K40 link whose USB transfer fails is never closed: the board stays claimed until the page closes

- **Where:**
  - `src/ui/state/lihuiyu-usb/lihuiyu-usb-store.ts:80-88` (`guarded`) routes every thrown transfer to `linkClosed` (`:148-155`). That function unsubscribes and resets state but never calls `current.close()`.
  - `closeLive` (`:157-161`) runs only on Disconnect and on a status-0 Connect.
- **Anchor:** D1-P3-1's rule ("the link releases what it opens"), fixed for Moshi (`moshi-usb-store.ts:126-128`) and `web-usb-link.ts:111-113`.
- **Evidence:** REPRO `zz-d4/a2-lihuiyu-link-leak.mts` → `out/a2.txt`.
  - (a) The first status read at Connect throws: the phase goes to `disconnected`, with 0 `close()` calls on the session and the device left open.
  - (b) A USB write throws mid-job: the same, with 0 closes and the device open. The message is shown ("The USB link to the board closed: …").
- **Scenario:** A USB stall or babble on the CH341. KerfDesk shows the link closed but keeps the device claimed, so MeerK40t or K40 Whisperer cannot take the board until KerfDesk's window closes.
- **Severity:** P3, as D1-P3-1.
- **Announced?** The failure is shown; the held claim is not.
- **Novelty:** New, the K40 twin of KNOWN D1-P3-1.
- **Fix direction:** in `linkClosed`, `void closed.close().catch(() => undefined)` after unsubscribing. Also the message has a doubled full stop ("stall..").

### D4-P3-2 — The Inspector's carved-stock and laser-burn workers have no `error` path: "Save as STL…" can wait for ever

- **Where:**
  - `src/ui/gcode-inspector/stock-worker-client.ts:24-28` and `burn-worker-client.ts:14-18`: `WorkerLike` has no `onerror` or `onmessageerror`.
  - `stock-worker-client.ts:95-100`: `stl()` resolves only on a `stl` reply or `dispose`.
  - `InspectorStockSave.tsx:21-25` sets `saving` and "Making the STL…" and awaits it.
- **Anchor:** ADR-487. Z1-P3-1's rule that a worker that fails or never answers must surface.
- **Evidence:** REPRO `zz-d4/a5-stock-burn-worker-fail.mts` → `out/a5.txt`. An injected worker fires `error` instead of answering:
  - stock: the `error` event fired once, the client set no `onerror`, and `stl()` was still **pending after 2 s**;
  - burn: `error` fired, the client set no handler, and `busy` stays true, so later `burn()` calls are never posted.
- **Scenario:** The stock worker fails to load or throws (the grid is capped at about 1 M cells, so a load or chunk failure is the realistic case). The STL button stays disabled behind "Making the STL…", and the 3D stock view stays empty with no failure note (`use-carved-stock.ts` `failed` stays false).
- **Severity:** P3. A preview and export convenience, not machine output.
- **Novelty:** New; the same class as KNOWN Z1-P3-1.
- **Fix direction:** add `onerror`/`onmessageerror` to `WorkerLike`. On error, resolve the waiting `stl()` calls with an error, call `onResponse({ kind: 'none' })` (which already sets `failed`) and terminate.

## KNOWN (not re-reported)

- **D1-P2-3 / D1-P2-5** (link jobs outside the laser store's guards): fixed for Moshi and Ruida by #1753. D4-P1-1, D4-P2-1 and D4-P2-2 are its residue.
- **D1-P3-1** (a USB device left claimed): fixed for Moshi and `web-usb-link`. D4-P3-1 is the K40 twin.
- **Z1-P3-1** (the picture worker that fails or never answers).
- **Z2-P2-1 / Z4-P3-1** (the turn-back wait).
- **D3R-P2-1** (Cancel during the Confirm re-prepare).
- **D3-P3-7** (simulators with no motion time and no open-port write failures). D4's repros slowed the USB writes by hand for that reason.

## Refuted (candidates dropped)

- **The K40 Frame/Start double click.** `run()` re-checks `live` and `phase === 'idle'` after its status await (`lihuiyu-usb-store.ts:219-220`), so a second click returns.
- **A stale yes on the in-app Frame offers (ADR-707).** `askMachineOffer` re-checks the controller session and a per-offer predicate after the answer (`machine-offer.ts:36-50`). "Set origin here" keeps the default predicate, which matches its wording ("where the head is now").
- **A thrown Moshi transfer leaving the job `running`.** `runMoshiPrograms` turns any throw into `link-failed` (`moshi-link-session.ts:88-91`).
- **The Ruida Abort racing the monitor.** `cancelSend` plus `monitor.stop()` plus `await sendDone`, then Stop Process (`ruida-network-store.ts:321-340`). `watchToEnd` refuses to start after an Abort.
- **The K40, Moshi and Ruida panels' `withJob` throwing without a message.** `prepareOutput` returns a failure for every known throw (`prepare-output.ts:131-138`), and the glyph check catches a font that does not load (`prepare-output-snapshot.ts:327-329`). No reachable throw was found.
- **Ruida UDP send failure without a stop (main process).** `RuidaNetworkSession.write` closes without Stop Process on a socket error, but the window's store then reports that the stop was not acknowledged and names the panel. This is announced and was not reproducible without a network.

## Verified clean

- **Saving:**
  - the Electron project save is a temp file, `fsync`, then rename with retry (`desktop-project-save.ts`);
  - G-code save never leaves the flow claimed and toasts every error (`gcode-save-flow.ts:79-88,186-194`);
  - `.egv` and `.rd` saves catch compile and write failures (`save-egv-action.ts:41-46,67-86`; `save-rd-action.ts:77,100,123`);
  - autosave failures toast and feed the save-health strip.
- **Output preparation worker:** `onerror` and `onmessageerror` reject every pending request. It has no watchdog, by design (`output-preparation-worker-client.ts:23-24`), and Cancel is wired through `AbortSignal`.
- **Controller waits:** the Idle and command waits are silence-based (see the timeout table); the Moshi waits have no cap and keep Abort reachable.
- **Cancellation:**
  - trace: cancel aborts the signal and the rejection is owned (`trace-preparation.ts:37-48`);
  - production nesting settles once on error or cancel;
  - G-code save cancel drops a late result (`gcode-save-flow.ts:124-130`);
  - STL import reports a cancellation as such.
- **Phone remote:** operations re-assert ownership; settlement promises are pre-handled and awaited later.
- **In-app dialogs:** pending dialogs resolve as cancelled when the host unmounts (`app-dialogs.ts:103-109`).

## Not verified

- Real CH341/K40 behaviour when the host stops mid-stream (does the beam stay on with `D` active?), real OS sleep timing, and real Ruida behaviour on a UDP send error.
- The autosave worker's 60 s deadline on a very large project, and the CNC pause-lift 60 s budget on slow Z rates.
- Browser runs: free memory was 0.6–1.9 GB, so no Vitest or Playwright run.
- An exhaustive read of all 523 `catch {` blocks and 691 `void` calls: the risk paths were sampled and the rest counted.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d4\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file>` from that folder. Output is in `out\`.

- `a1-lihuiyu-guards.mts`: D4-P1-1
- `a2-lihuiyu-link-leak.mts`: D4-P3-1
- `a3-link-job-wake-lock.mts`: D4-P2-1
- `a4-crash-screen-abort.mts`: D4-P2-2
- `a5-stock-burn-worker-fail.mts`: D4-P3-2
- `register.mjs`, `ts-resolve.mjs`: the loader (copied from `zz-d2`, pointed at `j30-main`)

No security findings; `SECURITY-DETAILS.md` was not needed.

```json
[
  {"id":"D4-P1-1","severity":"P1","area":"error-paths-and-async","pr":[1724,1753],"file":"src/ui/state/link-machine-work.ts","line":14,"anchor":"PROJECT.md NN 9; ADR-705 Amd 3; H13 job-aware dialogs","evidence":"REPRO","known":false,"summary":"Lihuiyu (K40) USB jobs never register as link machine work: Ctrl+., job bar, close/Update handoff, session end, project drop, Machine Setup Save miss them; jobAwareConfirm opens a native confirm mid-stream; close answers ready and sends no reset"},
  {"id":"D4-P2-1","severity":"P2","area":"error-paths-and-async","file":"src/ui/app/use-active-job-wake-lock.ts","line":45,"anchor":"ADR-117 (+Amd 1); ADR-705 Amd 3","evidence":"REPRO","known":false,"summary":"Screen wake lock is requested only for laser-store jobs; Moshi, Ruida and K40 link jobs (host-streamed) get none and no notice"},
  {"id":"D4-P2-2","severity":"P2","area":"error-paths-and-async","file":"src/ui/app/crash-recovery.tsx","line":25,"anchor":"F60/F65 crash-screen software Abort; NN 9","evidence":"REPRO","known":false,"summary":"Crash screen ABORT hidden during a Moshi/Ruida/K40 job (isMotionLive reads laser store only) and trigger() sends no link stop"},
  {"id":"D4-P3-1","severity":"P3","area":"error-paths-and-async","file":"src/ui/state/lihuiyu-usb/lihuiyu-usb-store.ts","line":148,"anchor":"D1-P3-1 rule (link releases what it opens)","evidence":"REPRO","known":false,"summary":"A thrown USB transfer (Connect status read or mid-job) ends the K40 link without closing the session; the board stays claimed"},
  {"id":"D4-P3-2","severity":"P3","area":"error-paths-and-async","file":"src/ui/gcode-inspector/stock-worker-client.ts","line":27,"anchor":"ADR-487; Z1-P3-1 class","evidence":"REPRO","known":false,"summary":"Carved-stock and burn worker clients have no error/messageerror path: Save as STL waits forever on a failed worker; burn view stops silently"}
]
```

Auditor counts: raised 5, P1 1, P2 2, P3 2, known 7

## Refuter (2026-11-12)

**Tree.** The same `j30-main` export of `origin/main` @ `5c351a6b3`, read-only.
**Harness.**
- My own Node scripts in `zz-d4r\`, run with `node --no-experimental-webstorage --import ./register.mjs <file>`. The loader is the auditor's `register.mjs` and `ts-resolve.mjs`, copied unchanged.
- The auditor's `zz-d4` scripts were read only for API shape.
- No Vitest and no browser: free memory was 1.5–1.8 GB, and every claim could be driven in Node.
- Simulators only: `LihuiyuSimulator` behind the real CH341 EPP driver and opener, `MoshiSimulator`, and fake USB, UDP, TCP, vault and worker objects.
- One outside read, for D4-P2-1: Electron's `powerSaveBlocker` page and Chromium's `power_save_blocker_win.cc`.

### Verdicts

| Finding | Verdict | Severity |
|---|---|---|
| D4-P1-1 K40 job invisible to every machine-work guard | **CONFIRMED**, and it reaches further than the auditor said | **P1** kept |
| D4-P2-1 no keep-awake for link jobs | **CONFIRMED** for K40 and Moshi. Narrowed for Ruida | P2 kept |
| D4-P2-2 crash-screen ABORT hidden during a link job | **CONFIRMED**, K40 included | P2 kept |
| D4-P3-1 K40 link not closed after a failed transfer | **CONFIRMED** at a third failure point (during Frame) | P3 kept |
| D4-P3-2 stock and burn workers have no error path | **CONFIRMED**. The 3D stock view also freezes | P3 kept |

#### D4-P1-1: CONFIRMED, P1

**Reachable on main? Yes. Nothing gates it.**
- READ, the catalogue: `src/core/devices/profile-catalog.ts:226-231` lists `K40_M2_NANO_PROFILE` and `K40_M3_NANO_PWM_PROFILE` beside every other machine. The only label is the "EXPERIMENTAL … simulator-tested only" note.
- READ, the panel: `src/ui/laser/LihuiyuUsbPanel.tsx:26-27` mounts whenever `usePlatform().usbLink` exists and the driver carries `LIHUIYU_USB_CAPABILITIES`. It is mounted from `ControllerConnectionControls.tsx:156`.
- READ, the USB link exists on both platforms:
  - web: `src/platform/web/web-adapter.ts:332-338` (`webUsbLink()` wherever Chromium has `navigator.usb`);
  - desktop: `electron/laser-usb-devices.ts:14-16` lists 1a86:5512 as "K40 controller (CH341: Lihuiyu M2/M3 Nano, Moshiboard)", and `electron/desktop-usb-devices.ts` routes the chooser.
- No feature flag was found.
- One real-world limit: on Windows the board needs WinUSB in place of the stock driver (`LIHUIYU_DRIVER_HELP`, `lihuiyu-usb-opener.ts:10-11`). METHOD §3 has no reach clause, so this does not lower the rating.

**Driven again with my own repro, on guards the auditor did not drive.** REPRO `r2-k40-other-guards.mts` → `out/r2.txt`. A K40 job runs at 2 of 26 packets. During it:
- `jobWouldBeCutOff()` = **false** and `desktopJobReport()` = `{"busy":false}` (`desktop-session-end.ts:56-63`). Windows session end therefore tells main that nothing is running.
- the crash screen's `isMotionLive()` = **false**;
- keep-awake requests = **0**;
- browser tab close: the `beforeunload` and `pagehide` listeners from `installUnloadStop` send **0 board resets**. `bestEffortStop` (`desktop-close-controller.ts:231-236`) reads a snapshot whose `active` (`desktop-close-runtime.ts:37`) leaves out the K40. Packets kept going (3 sent after `pagehide`).
- Control: the panel Abort sends 1 reset and the store goes `idle`.

The auditor's readers were also confirmed by READ: `link-machine-work.ts:14` and `:48` name only `'moshi-usb'` and `'ruida-network'`, and no file under `src/ui/state/lihuiyu-usb/` imports `reportLinkMachineWork`.

**What a K40 does when the host stops mid-job.** I used only the repo's notes, ADR-703 and the repo's own decoder.
- The repo does not say whether a starved Lihuiyu board drops the beam. ADR-703 §Consequences (lines 129-131) lists hardware qualification as owed, including "that … 'I' stops".
- The repo's own operator text treats an orphaned board as possibly still running:
  - `lihuiyu-usb-messages.ts:39-44`: "A job the board already holds may keep running without the link — stop the machine with its power switch if needed."
  - `failRun` (`lihuiyu-usb-store.ts:302`): "The board may already run what it received: reset it."
  - Close, Update, session end and tab close send no "I" for a K40.
- REPRO `r1-k40-starve-beam.mts` → `out/r1.txt`. It encodes real jobs, cuts them into the payloads the link sends (`lhyPayloads`) and decodes them payload by payload with the repo's MeerK40t-derived decoder. The decoder's beam state is **ON ('D' active) at the cut point**:
  - for 18 of 20 packet boundaries in the auditor's zigzag;
  - for 6 of 19 in a six-square cut;
  - for 1 of 4 in a single 150 mm line.
- So a stop at a typical boundary leaves the board in program mode with the beam flag on and no further motion queued. That happens on a window close or an Update, and for as long as a native `jobAwareConfirm` dialog is open.
- Whether the tube then fires at a standing head cannot be decided from the repo. That is listed under Not verified. A stationary lit beam, which is a fire risk, cannot be ruled out. Even at best, the piece is truncated and the head stops part-way with no reset.

**Does anything else stop it?**
- READ: only the panel Abort in `LihuiyuUsbDetails.tsx:140`, inside a `<details>` in the Machine details popover. It unmounts on a profile change (`LihuiyuUsbPanel.tsx:26-27`).
- Electron main's stop paths (`desktop-machine-stop.ts`, ADR-697 §7) cover network machine sessions and Ruida UDP sessions, not WebUSB. A K40 therefore also gets no stop after a renderer crash.

**Rating.** P1 kept. It is the same non-negotiable 9 gap as D1-P2-5, which the coordinator rated P1 for Moshi and Ruida. The K40 case is no milder: no stop reaches it from `Ctrl+.`, the job bar, close, Update, session end, the crash screen or tab close, and the board's state after a host stop is unqualified.

#### D4-P2-1: CONFIRMED, P2 kept, narrowed for Ruida

- REPRO `r2` (K40): 0 wake-lock requests during a running job. READ: `use-active-job-wake-lock.ts:45-54` subscribes to `useLaserStore` only. The hidden-page notice (ADR-117 Amendment 1) is laser-only for the same reason.

**Does a screen wake lock prevent system sleep, or only display sleep?** In Chromium and Electron on Windows, it keeps the system awake while the page is visible.
- Chromium's `power_save_blocker_win.cc` maps `kPreventDisplaySleep` (the Screen Wake Lock) to `PowerRequestDisplayRequired`.
- Before Windows 11 it adds `PowerRequestSystemRequired`. The source comment says the Windows owners recommended both, and that on Win11+ "only a display request is needed".
- Electron's `powerSaveBlocker` docs describe `prevent-display-sleep` as "Keeps system and screen active".

**So the laser path's protection is not only display-level.** It holds while the page is visible. The browser releases it when the page is hidden, which ADR-117 Amendment 1 already announces for laser jobs. The link paths get neither the lock nor the notice.

**Does sleep cut the stream?**
- K40 and Moshi: yes, by construction. The renderer sends every K40 packet (`lhy-link.ts:99-113`) and every Moshi program (`moshi-link-session.ts`), and a suspended renderer sends nothing. What the USB stack does on resume (re-enumeration, which arrives as `onDisconnect`) was not run.
- **Ruida: mostly not.** "A Ruida runs a job from its own memory" (ADR-697 §7, lines 87-91), so a sleep after the upload does not cut the burn; only a sleep during the upload truncates it.

**Rating.** P2 is right for K40 and Moshi: a truncated job, a real defect, with the K40 beam caveat above. The Ruida share is limited to the upload window.

#### D4-P2-2: CONFIRMED, P2 kept

- READ: `crash-recovery.tsx:25-45` reads only `useLaserStore`, and `ErrorBoundary.tsx:238` renders ABORT only when `live`.
- REPRO `r2`: `isMotionLive()` = false during a K40 job too. The auditor's `a4` covered Moshi.
- READ, `App.tsx:84-92`:
  - the workspace boundary wraps `AppWorkspace`, which holds the job bar and every link panel;
  - `AppProtections`, which holds `Ctrl+.`, sits beside it;
  - the root boundary in `main.tsx:115` wraps both.
- So after a workspace crash, `Ctrl+.` is the only stop left for Moshi and Ruida (none for the K40, D4-P1-1). After a root crash there is none.

**Rating.** P2 kept. It needs a render crash, and `Ctrl+.` still reaches Moshi and Ruida in the common case, a workspace crash. The coordinator may weigh the root-crash case against D1-P2-5.

#### D4-P3-1: CONFIRMED, P3 kept

- REPRO `r4-k40-frame-fail-leak.mts` → `out/r4.txt`. A status read throws while the store is `framing`:
  - the phase goes to `disconnected` with the link-lost message;
  - `session.close()` is called **0** times;
  - pressing Disconnect afterwards also closes nothing, because `live` is already null (`lihuiyu-usb-store.ts:163-165`).
- So the operator has no path to release the claim short of closing the page. READ: `linkClosed` (`:148-155`) never calls `closed.close()`.
- The doubled full stop is real: the message ends "timed out." plus the template's ".".

#### D4-P3-2: CONFIRMED, P3 kept

REPRO `r5-stock-worker-throw.mts` → `out/r5.txt`. The worker answers `start` and one `carve`, then throws in its `stl` handler. The real `stock-worker.ts:17-41` has no try/catch, so any throw becomes a Worker `error` event.
- The client sets no `onerror`, and `stl()` is still **pending after 1.5 s**.
- **Additional:** `busy` stays true, so a later `carve` is never posted, and the 3D stock view stops following the playhead.
- `dispose()` resolves the waiting `stl()` with `null`. `InspectorStockSave.tsx:26-28` then says "Nothing of the stock is left to save.", which wrongly blames the stock.
- P3 is right: preview and export only.

### Swallow spot-checks

These are five `.catch(() => …)` sites the auditor did not name, each driven to its failure. REPRO `r6-swallow-spot-checks.mts` → `out/r6.txt` (S1–S4) and `r7-recent-record-swallow.mts` → `out/r7.txt` (S5). There were 0 unhandled rejections.

| # | Site | Failure driven | Result |
|---|---|---|---|
| S1 | `laser-status-poll-writer.ts:8` (status poll) | (a) the write rejects; (b) the write never settles | Clean by design. (a) The next poll is written. (b) No later poll is written (one in flight by design). A never-settling transport write is a transport fault; web-serial writes are bounded (`web-serial.ts:348`). The job's silence handling was not driven. |
| S2 | `ruida-link-exchange.ts:97` (UDP command chain) | the first `send` rejects | Clean. The caller gets `{"ok":false,"failure":"send-failed"}`, and the next command is still sent. |
| S3 | `desktop-machine-network.ts:129` (desktop TCP writes) | main refuses write 1, with write 2 queued behind it | Clean. Write 1 rejects; write 2 is refused without being sent ("an earlier write may not have arrived"); a stop byte issued after the failure goes out (ADR-398 Amd 6). |
| S4 | `remembered-camera-addresses.ts:40,48,53` (camera login vault) | the secure-storage vault refuses writes and reads | Clean for secrets: plain storage holds only `rtsp://192.168.1.50:554/`, never the password. The login works this run and is **silently gone after a restart**. A convenience loss, not raised. |
| S5 | `recent-project-record.ts:23` (Recent Projects record) | (a) storage `update` always rejects; (b) the real fallback storage over a failing primary | Clean. (a) The failure is dropped, so the entry is not listed. (b) Production's fallback lists all 4 entries, and `onUnavailable` (the toast) fires once. |

- Also READ, not driven: `laser-job-stop.ts:335,375`. The Abort's reset write is pre-handled and then awaited (`settleResetWrite`, `await resetWrite`), so a failed reset still reaches the stop outcome. Clean.
- **Harness note.** With an invalid `ref.kind` (my own typo, `'desktop'`), `recordRecentProjectFile`'s uncapped `for (;;)` (`recent-projects-store.ts:105`) spun on microtasks and starved the event loop once storage was unavailable. This is unreachable from stored data, because `recent-project-storage.ts:299-307` drops unknown kinds. It is not raised. A cap on that loop would be cheap insurance.

**The "146 swallows are benign" triage holds** for every site sampled. None hid a failure the operator needed.

### New findings

#### D4-P2-3: In a browser tab, closing during a Moshi job with unsaved work shows "Leave site?" after the job's estop has already been requested

- **Where:**
  - `src/ui/app/use-unsaved-changes-guard.ts:42` gates the prompt on `isActiveJob(useLaserStore…)` only;
  - `src/ui/app/use-unload-stop.ts:28-35` calls `bestEffortStop()`, whose snapshot counts link work since #1753 (`desktop-close-runtime.ts:37,83`).
- **Anchor:** the guard's own header (`use-unsaved-changes-guard.ts:9-15`) says the prompt is "deliberately gated OFF during an active job" because "If we blocked unload mid-job and the user chose 'Stay', the job would already have been stopped". Also ADR-705 Amendment 3: link jobs count as machine work.
- **Evidence:** REPRO `r3-moshi-stay-prompt.mts` → `out/r3.txt`. A Moshi job is running, the project is dirty, and one `beforeunload` goes to both App listeners:
  - the "Leave site?" prompt is shown (`preventDefault` called);
  - 1 Moshi estop is written;
  - the phase is `idle`.
  - Control: `shouldWarnBeforeUnload({dirty:true, jobActive:true})` = false, which is the gate the laser path gets.
- **Scenario:** Chromium web app, Moshi over WebUSB. The operator presses Ctrl+W by mistake mid-job and answers **Stay**. The tab stays, but the job has already been estopped: the piece is ruined by a dialog that offered to keep it. With the Ruida (desktop only) or the K40 (D4-P1-1) this does not arise.
- **Severity:** P2. A real defect, a guard #1753 did not reach, contradicting its own documented design. The harm is limited: the operator started a close, and on the laser path a close also stops the job.
- **Novelty:** new. It is the D1-P2-3 shape in a guard neither D1 nor #1753 listed.
- **Fix direction:** gate the prompt on `anyMachineJobActive()`. The K40 joins it once D4-P1-1 is fixed.

#### D4-P3-3: The project seal key is the only secret main writes in place, so a power cut right after first use costs the key

- **Where:** `electron/project-seal-key.ts:53`: `writeFile(file, …, { flag: 'wx' })` with no temp file and no `fsync`. Every other secret store writes a temp file, calls `sync()`, then renames:
  - licence: `licensing-store.ts:179-180`;
  - AI credentials: `ai/credential-store.ts:38-43`;
  - remote credentials: `remote-access/credential-store.ts:78-85`;
  - camera addresses: `camera-address-store.ts:115-120`.
- **Anchor:** ADR-592 §4. Without Pro, a project holding Pro work opens only when its seal verifies on this computer.
- **Evidence:** REPRO `r8-seal-key-truncated.mts` → `out/r8.txt`. The real `createProjectSealKey` runs with a fake `safeStorage` in a scratch folder. The first run mints a key; then the file is left empty, or half-written, as a power cut before the bytes reached disk would leave it. The next start:
  - treats it as `unreadable`;
  - sets it aside (`project-seal.v1.unreadable-<time>`);
  - mints a **different** key.
  - Projects sealed with the first key no longer verify.
- **Scenario:** A desktop user saves Pro work in the first session that created the key. Then the power goes, or Windows crashes, before the file was flushed. After the trial ends, those projects open only with Pro (ADR-592 "Consequences"). Nothing is deleted, and the set-aside file is kept.
- **Severity:** P3. A narrow window (power loss soon after the key's first creation), nothing lost, and Pro recovers it. It is a structural gap against the store pattern used everywhere else.
- **Fix direction:** write a temp file with `wx`, `sync()`, then `link` or `rename`, keeping the EEXIST race semantics. Or reuse the licence store's writer.

**Missed-class candidates checked and dropped:**
- Double-click / re-entrancy on Connect: the K40, Moshi and Ruida stores each check `phase !== 'disconnected'` and set `connecting` synchronously (`lihuiyu-usb-store.ts:96-102`; `ruida-network-store.ts:120-121`).
- Save As is covered by the transactional-save tests.
- Electron window placement and the project-token key: placement writes a temp file and renames. The token key is written in place, but losing it "only means choosing those files again" (`desktop-project-token.ts:7-8`).
- An `AbortSignal` checked only at entry in import or nesting was not re-examined beyond the auditor's Verified clean list.

### Not verified

- Real Lihuiyu behaviour when the host stops mid-program with 'D' active: does the tube fire at a standing head? Also whether "I" stops it. ADR-703 says hardware qualification is owed.
- Real OS sleep: USB re-enumeration on resume, and whether Electron main's 15 s Ruida read lease sends Stop Process after a resume.
- Chromium's macOS and Linux wake-lock mapping (only the Windows source was read).
- A real browser `beforeunload` ordering for D4-P2-3 (driven in Node through the real listeners).
- Vitest and Playwright: not run. Memory was 1.5–1.8 GB, and no claim needed them.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d4r\`, with output in `out\`.

- `r1-k40-starve-beam.mts`: K40 beam state at packet boundaries (D4-P1-1)
- `r2-k40-other-guards.mts`: session end, crash screen, keep-awake and tab close during a K40 job (D4-P1-1, D4-P2-1, D4-P2-2)
- `r3-moshi-stay-prompt.mts`: D4-P2-3
- `r4-k40-frame-fail-leak.mts`: D4-P3-1
- `r5-stock-worker-throw.mts`: D4-P3-2
- `r6-swallow-spot-checks.mts`: S1–S4
- `r7-recent-record-swallow.mts`: S5 (`r7b-debug.mts` is the loop probe)
- `r8-seal-key-truncated.mts`: D4-P3-3
- `register.mjs`, `ts-resolve.mjs`: the loader, copied from `zz-d4`

```json
[
  {"id":"D4-P1-1","verdict":"CONFIRMED","severity":"P1","evidence":"REPRO r2: jobWouldBeCutOff=false, desktopJobReport busy=false, crash isMotionLive=false, 0 wake-lock requests, tab-close beforeunload/pagehide 0 resets during a running K40 job; REPRO r1: repo decoder leaves the beam flag ON at 18/20 (zigzag), 6/19 (squares) packet boundaries; READ: catalogue profile-catalog.ts:226-231, panel LihuiyuUsbPanel.tsx:26-27, web-adapter.ts:332-338, laser-usb-devices.ts:14-16, no flag; link-machine-work.ts:14,48"},
  {"id":"D4-P2-1","verdict":"CONFIRMED","severity":"P2","evidence":"REPRO r2 (K40 0 requests); outside read: Chromium power_save_blocker_win.cc maps the screen lock to DisplayRequired (+SystemRequired before Win11), Electron docs 'Keeps system and screen active', so the laser path's protection is system-level while visible; Ruida runs from controller memory (ADR-697 s7), so only its upload window is exposed"},
  {"id":"D4-P2-2","verdict":"CONFIRMED","severity":"P2","evidence":"REPRO r2: isMotionLive=false during K40 job; READ crash-recovery.tsx:25-45, ErrorBoundary.tsx:238, App.tsx:84-92"},
  {"id":"D4-P3-1","verdict":"CONFIRMED","severity":"P3","evidence":"REPRO r4: thrown status read while framing -> disconnected, 0 session.close(); Disconnect afterwards closes nothing"},
  {"id":"D4-P3-2","verdict":"CONFIRMED","severity":"P3","evidence":"REPRO r5: throw in stl handler -> stl() pending 1.5 s, later carve never posted (busy stuck), dispose resolves null -> misleading 'Nothing of the stock is left to save.'"},
  {"id":"D4-P2-3","verdict":"NEW","severity":"P2","area":"error-paths-and-async","pr":[1753],"file":"src/ui/app/use-unsaved-changes-guard.ts","line":42,"anchor":"use-unsaved-changes-guard.ts:9-15 (prompt gated off during a job); ADR-705 Amd 3","evidence":"REPRO r3","known":false,"summary":"Browser tab close during a Moshi job with unsaved work: bestEffortStop estops the Moshi (link work counted) but the unsaved-changes prompt gates on the laser store only, so 'Leave site?' is shown and 'Stay' keeps an already-stopped job"},
  {"id":"D4-P3-3","verdict":"NEW","severity":"P3","area":"error-paths-and-async","file":"electron/project-seal-key.ts","line":53,"anchor":"ADR-592 s4 (seal verifies on this computer); temp+fsync+rename pattern of the other secret stores","evidence":"REPRO r8","known":false,"summary":"Project seal key written in place without fsync; an empty or half-written key file after a power cut is set aside and a new key minted, so projects sealed that session need Pro to reopen"}
]
```

Refuter counts: raised 7, refuted 0, P1 1, P2 3, P3 3, known 7
