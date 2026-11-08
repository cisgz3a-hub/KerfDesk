# Rolling audit v10 — V3 Fix: controller

- **When:** 2026-11-08 +0800   **Tree:** origin/main @ `5f09e1110` (repros in the scratchpad tree `j10-main`; the worktree's `src` is identical to `5f09e1110`).
- **Scope:** #1558 (ADR-637 Amd 6), #1559 (ADR-420 Amd 5), #1567 (ADR-637 Amd 7), #1568 (ADR-341 Amd 11, ADR-367 Amd 2, ADR-232 Amd 2), #1569 (ADR-393 Amd 1), #1595 (U5 P3s), #1599 (toolbar "No answer"). Entry points: the rail's Alarm and Abort cards, the toolbar's connection bar and **Reconnect now**, Machine Setup's Save and laser-mode card, Job Review's **Send $32=1**, the Console `$X`, Frame.
- **Lenses run:** L10 (all five steps), L6, L9, L4.
  - L12 was run only partly. The PRs' own unit and simulator suites ran (14 files, 116 tests, all pass on main). No e2e ran: available memory was 1.2–1.7 GB all session, under the 3 GB browser gate.
  - Controllers were simulated only: the repo's GRBL simulator through the real store, plus esbuild Node bundles. No hardware was used.
- **Counts:** 5 raised → refuter pending → P1 0 / P2 2 / P3 3 (+ 1 KNOWN: V2-P2-2). 4 candidates were dropped by the auditor (see Refuted).

## Headline

The seven PRs fix what they set out to fix, and the safety core holds:
- Every new `$` write needs a click and a confirm. Machine Setup's laser-mode write also needs a saved backup.
- The origin restore after Abort writes one G92 and moves the head only when it homes first.
- Reset and Unlock skip no homing requirement the firmware enforces.
- Save does not switch drivers during a job.

Two gaps remain, both in the new buttons' failure paths:
- **V3-P2-1.** The toolbar's **Reconnect now** is offered and enabled while a job runs. Its hover says "Nothing moves", yet pressing it soft-resets the controller and ends the burn. Save refuses in the same state ("a job is running").
- **V3-P2-2.** On a GRBL machine set to `$10=0` (WPos-only reports, which KerfDesk's own code calls LightBurn's advice), the Abort card's main action **Restore saved origin** sends `$X` and then fails. Unlock has already cleared the alarm, so the card is gone and its failure text never shows. There is no toast. The beginner is back in U4-P2-3: the origin is cleared, and the next step offered is Set origin here.

## Findings

### V3-P2-1 — Toolbar "Reconnect now" ends a running job: it skips Save's in-flight blocker, and its hover says "Nothing moves"

- **Where (5f09e1110):**
  - `src/ui/laser/ControllerConnectionControls.tsx:85-88`: `reconnectWithProfile` runs `disconnectController()` then `connectController(...)` with no check.
  - `:118-127`: the notice is passed whenever the drivers differ, with `disabled={!supportsSerial || controlsBusy || isFileOnlyProfile}`.
  - `:207-219`: `connectionControlsBusy` ignores the streamer.
  - `src/ui/laser/ConnectionBar.tsx:160-171`: a primary button in `role="alert"`, hover "Close the port and reconnect with this machine profile's commands. Nothing moves."
  - The twin, `src/ui/laser/device-setup/save-driver-switch.ts:39-60`, refuses on `isActiveJob` ("a job is running"), on motion, on an operation, and on any state other than Idle or Alarm.
  - The GRBL-family disconnect soft-resets the controller: `src/ui/state/laser-disconnect-stop.ts:61-66` → `laser-disconnect-transaction.ts:136`.
- **Anchor:**
  - **Contract, ADR-637 Amendment 6 Decision 1** (`docs/decisions/ADR-637-amendment-6-save-switches-the-live-driver.md:28-29`): the reconnect "runs only when nothing is in flight: no job, no motion or controller operation of KerfDesk's".
  - Decision 3 (`:38-39`) shows the notice "whenever a connected session's driver is not the profile's, however that happened", so the button is the same reconnect reached from a second entry point (L9).
  - **Twin:** `saveDriverSwitchBlocker` against the toolbar's `connectionControlsBusy`.
- **Scenario:**
  1. Machine Setup's Save is deferred. For example, after Release motors the controller reports Sleep, so the toast says "Press Reconnect now". The toolbar keeps "Connected with the generic GRBL v1.1 commands… Reconnect now".
  2. The operator wakes the machine, sets the origin and starts the job. Starting is allowed: Job Review only names the mismatch.
  3. Mid-burn they press the highlighted **Reconnect now**, reading "Nothing moves".
  4. KerfDesk soft-resets the controller, which stops the job mid-motion, and reconnects with the new driver. The piece is half burned. The beam goes off and nothing fires, so this is not a P1.
- **Evidence:** REPRO.
  - Node, real modules (`zz-v3\twin.mjs`, output `tasks\b9c23ng0g.output`): `saveDriverSwitchBlocker({streamer:{status:'streaming'},…})` returns `"a job is running"`. For a paused job it returns the same. `connectionControlsBusy(null, null)` returns `false`, so the button is enabled.
  - Vitest on the real store and the GRBL simulator (`zz-v3\zz-v3-abort-card.test.tsx` "V3 B", log `zz-v3\repro-log.txt`): with a framed job streaming and the profile switched to grblHAL, the mismatch notice shows. Running exactly `reconnectWithProfile`'s two calls gave:
    - `reset sent true`;
    - after the reconnect: `connection connected driver grblhal streamer null`;
    - `safetyNotice undefined`, so after the reconnect nothing on the toolbar says the job was stopped.
- **Severity:** P2.
  - It breaks the amendment's own contract with a clear failure scenario, and the wording is misleading ("Nothing moves").
  - It is not P1: the reset turns the beam off and stops motion. No unexpected motion or firing happens. The wrong output is a stopped job, not a wrong burn.
  - The toolbar's plain **Disconnect** behaves the same mid-job (by design, `docs/audits/2026-10-16-controller-reconnect-audit.md:97`). Its hover does not promise that nothing moves, and it is not a highlighted alert button.
- **Novelty:** new. U2-P2-1's fix direction proposed the button. Neither U2 nor the PR checked a job in progress. No open PR touches these files (#1592, #1596, #1597, #1601, #1605–#1613 checked by file list).
- **Fix direction:** give **Reconnect now** the same `saveDriverSwitchBlocker` guard: disabled with its reason while a job is running, held or settling. Optionally, hide the notice while a job runs.
- **Refuter:** PENDING.

### V3-P2-2 — On `$10=0`, the Abort card's Restore saved origin unlocks and then fails; the alarm is cleared, so the card and its error vanish with no toast

- **Where (5f09e1110):**
  - `src/ui/laser/AbortStoppedCard.tsx:42-55`: `run` reports failure only through `setFailure` in the card. Its own comment at `:48` notes "The alarm is cleared by now, so this card is gone".
  - `src/ui/laser/abort-alarm-recovery.ts:36-42` and `:50-59`: `clearAbortAlarm` runs Unlock first and waits for Idle, and only then writes the origin.
  - `src/ui/state/laser-origin-restore.ts:183-186`: the aim point is the live MPos or, after Unlock, the withheld MPos. When neither exists it throws `RESTORE_ORIGIN_POSITION_UNKNOWN_MESSAGE` before any transaction, so nothing is logged and `lastWriteError` is not set.
  - `src/ui/state/laser-status-position.ts:97-103`: the withheld MPos is kept only when the report has `MPos`. A `$10=0` report has `WPos`, so none is kept, and `wcoCache` is cleared while the position is withheld.
  - `src/ui/laser/LaserWindow.tsx:102` with `:295-312`: the card is shown only while `alarmCode !== null || state === 'Alarm'`.
  - That `$10=0` is common: `src/core/controllers/grblhal/status-report-mask.ts:6` (" `$10=0` (LightBurn's advice for GRBL CNC lasers)").
- **Anchor:**
  - **Contract, ADR-341 Amendment 11** Decision 3 (`docs/decisions/ADR-341-amendment-11-the-abort-card-restores-the-origin.md:33-34`): Restore "sends Unlock, waits for a fresh Idle report and writes the saved offset back with one G92". Decision 5 (`:42-46`) relies on "the MPos withheld from the latest report", which a WPos-only report never has.
  - **L6:** the operator must be told the truth when an action fails.
  - **Twin:** the same card on `$10=1`, which works.
- **Scenario:**
  1. A stock-GRBL diode laser has `$10=0` and no homing. The operator sets the origin, starts, and presses ABORT JOB.
  2. The card reads "You stopped the job… your origin was cleared. It was at X 20, Y 30 mm from machine zero", with **Restore saved origin** as its main button.
  3. They press it. `$X` goes out, the controller reports Idle, and the card disappears.
  4. The restore then fails. No success toast appears and no error shows anywhere. The origin is still cleared and the position is still withheld.
  5. The next Frame refuses with "Position is unknown after Unlock… move the head to where the job should start and use Set origin here". That is the U4-P2-3 outcome the PR set out to fix.
- **Evidence:** REPRO. Vitest on the real store and checkpoint tracker against the GRBL simulator, with its reports rewritten to `$10=0` form (WPos with WCO on every report, which is more generous than real GRBL's one in ten). Test `zz-v3\zz-v3-abort-card.test.tsx` "V3 A", log `zz-v3\repro-log.txt`.

  | | `$10=1` (control) | `$10=0` |
  |---|---|---|
  | Abort record | `originAtStopMm {20,30}` | `originAtStopMm {20,30}` |
  | `restoreOriginAfterAbort` | resolves | throws "KerfDesk does not know where the head is in machine coordinates yet…" |
  | Wire after the click | `$X`, `G54 G21 G92 X0.000 Y38.000` | `$X` only |
  | Afterwards | alarm null, card hidden, simulator WCO `{20,30}` | alarm null, card hidden, simulator WCO `{0,0}`, `lastWriteError null`, toasts `[]` |

  - Node (`twin.mjs`): `statusPositionPatch` on a withheld `<Idle|WPos:…>` report keeps `withheldControllerMPos = null`. The `MPos` form keeps `{41.2,63.5,0}`.
  - READ: the failure text is lost the same way for every post-Unlock failure: `ABORT_ALARM_NOT_IDLE_MESSAGE` (which itself begins "The alarm was cleared"), an origin-readiness block, a G92 refusal. The card's tests (`AbortStoppedCard.test.tsx`) render the card alone and never cover a failure.
- **Severity:** P2.
  - The fix's main action does not work for a common configuration, and fails silently, which is misleading.
  - It is not P1: nothing moves or fires, and the next Frame refuses rather than burning in the wrong place. The fallback (Set origin here wherever the head stopped) is U4-P2-3's own scenario, which U4 rated P2.
  - The "Home, then restore origin" path on `$10=0` probably fails the same way when the first post-Home report has no `WCO:`. That was not reproduced: the simulator wrapper sent WCO on every report.
- **Novelty:** new. It is a regression of the fix's intent, not of 1.0.29.
- **Fix direction:**
  - Report a failure after the alarm is cleared with a toast, which `run` already uses for success.
  - On a WPos-only report, aim from WPos plus the WCO that the Abort recorded, or from a fresh WCO, instead of refusing. Alternatively, check before `$X` that an aim point will exist, and say why when it will not.
- **Refuter:** PENDING.

### V3-P3-1 — Save's driver switch soft-resets the controller, clearing a G92 origin on stock GRBL and FluidNC; the toast and ADR say only that nothing moves

- **Where:**
  - `src/ui/laser/device-setup/save-driver-switch.ts:89-107`: disconnect then connect. The success toast at `:103-105` is "Reconnected with …, as the saved machine uses."
  - The disconnect soft-resets every GRBL-family controller (`laser-disconnect-stop.ts:61-66`).
- **Anchor:**
  - **Contract, ADR-637 Amendment 6 Decision 1** (`:27-28`): "the same reconnect as step 1's button, which sends no motion". That is true, but incomplete.
  - ADR-341 Amendment 11 Context (`:15-20`): a cleared G92 origin, followed by Frame's "set origin here", put the re-run 5–69 mm off.
- **Scenario:** the operator sets the origin, then fixes the machine in Machine Setup in a way that changes the driver, and saves. The board is reset. The origin is gone, and nothing says so. If they jogged in between, the Frame or the "set origin here" offer then lands at the head.
- **Evidence:** REPRO ("V3 C"). After `setOriginHere` at (20, 30), the same disconnect and connect leaves simulator WCO `{0,0}` and the store's `workOriginSource none`.
- **Severity:** P3. The driver differs almost only on a first setup, before any origin is set. KerfDesk's own state is correct (`none`), so Frame and Job Review do not trust a stale origin.
- **Novelty:** new; it follows from #1558. Plain Disconnect has always done this.
- **Fix direction:** when a G92 origin is active, have Save's toast and Review's switch line say "Reconnecting resets the controller, which clears the origin you set", or record and offer it back as the Abort card does.
- **Refuter:** PENDING.

### V3-P3-2 — ADR-637 Amendment 7's status line promises a saved backup before every write; Job Review's Send $32=1 writes without one

- **Where:**
  - `docs/decisions/ADR-637-amendment-7-laser-mode-off-asks-instead-of-making-a-cnc.md:8`: "writes no controller setting without the operator's click, a saved backup and a confirm."
  - `src/ui/laser/job-review/SendLaserModeButton.tsx:41-56`: confirm only, then `writeLaserModeOn()`, with no backup.
- **Anchor:** Contract (L10 step 4: the ADR must match the code). Decision 4 (`:61-66`) itself describes only "a confirm … and the same guarded write", as the twin **Send $32=0** has.
- **Scenario:** the row's button writes `$32=1` after one confirm, with no backup file. The write itself is the guarded, read-back one, and `$32` is easy to reverse.
- **Severity:** P3, doc/code drift. Every write still needs a click and a confirm.
- **Novelty:** new.
- **Fix direction:** reword the status line ("Machine Setup's write saves a backup first; Job Review's, like Send $32=0, confirms"), or give Job Review the backup step too.
- **Refuter:** PENDING.

### V3-P3-3 — The Abort card records the origin only when KerfDesk set it as G92 in this session; an origin learned at connect is cleared by the reset with no word

- **Where:**
  - `src/ui/state/laser-job-stop.ts:370-377`: `g92OriginAtStop` requires `workOriginSource === 'g92'`.
  - A non-zero WCO first seen after a reconnect, or after Home, is `'unknown'` (`laser-status-position.ts:90`, `laser-home-action.ts:228-232`).
  - `src/ui/laser/AbortStoppedCard.tsx:177-187`: with no saved origin the card says "Stopping reset the controller, which locked it. Unlock it, then move the head to where the job should start."
  - Its Unlock button's hover (`:167`) says "without changing the origin", although on stock GRBL the reset has already cleared it.
- **Anchor:**
  - **Contract, ADR-341 Amendment 11 Decision 1** (`:24-27`): records "when a G92 origin was set".
  - **Ground truth:** stock GRBL and FluidNC clear G92 at any soft reset, as ADR-375 says and the simulator models (`grbl-sim-machine.ts:336-339`). That includes a G92 KerfDesk learned rather than wrote.
- **Scenario:** the origin was set before a reconnect on a board that does not reset when the port opens, or set before Home. A job is aborted. The card neither offers the origin back nor says it was cleared.
- **Evidence:** READ. The paths are in the code cited above. No simulator repro: the simulator's reconnect itself resets the board (V3 C).
- **Severity:** P3. The card's wording is not wrong, and the interrupted job's Review recovery still offers the archived origin (Amendment 5).
- **Novelty:** new; a sibling path of U4-P2-3.
- **Fix direction:** record any non-zero XY WCO at Abort on drivers that clear G92 at reset, whatever its source. Change the Unlock hover to say the origin is already cleared.
- **Refuter:** PENDING.

### KNOWN

- **V2-P2-2** (a laser that 1.0.29 made a CNC). Not re-raised. On L9, no other path on main takes the machine type from `$32`:
  - `machineKindFromLaserMode` is removed.
  - `profilePatchForSetup` keeps a laser's expectation.
  - The detected-settings toast only describes; it applies nothing.

## Refuted

Candidates the auditor dropped:

- **"A restore without homing puts the origin off by the steps lost at the reset."** True in principle, and ADR-341 Amendment 11 Consequences (`:52-54`) states it. On a machine without homing no better reference exists: Set origin here at the stopped head is strictly worse. Not a finding.
- **"The detected-settings banner still copies `$32=0` into a laser profile (Amendment 7 parity)."** `DetectedSettingsToast.tsx` only uses `describePatch`. The only caller of `applyDetectedSettingsPatch` in the UI is `HomedBedCorrectionOffer.tsx:45`, which applies the bed only.
- **"Machine Setup's Save can switch drivers mid-job."** `use-machine-setup-save.ts:48-51` refuses Save while `isActiveJob`, and `saveDriverSwitchBlocker` refuses again (job, held job, motion, operation, any state other than Idle or Alarm, or TCP).
- **"Reset or Unlock skips homing."** Reset is a soft reset and the controller comes back locked. Unlock (`$X`) is accepted by GRBL in Alarm whatever `$22` is. Plain Unlock was offered before these PRs. **Home, then restore origin** is the default whenever homing is on (`AbortStoppedCard.tsx:39`). Set origin here after Unlock re-establishes XY evidence only and never work Z (`laser-origin-transaction.ts:58-60`; `restoredOriginPatch` leaves `workZZeroEvidence`).

## Verified clean

**#1558 (ADR-637 Amd 6):**
- The blocker covers a job (including paused, done and errored), motion, operations, TCP, a missing platform, and Hold, Door, Sleep, Run and Jog.
- The reconnect uses the profile's kind, command set and baud through the remembered port (`resolveSerialPort`), so it never opens a picker for another port.
- A failed reopen leaves the session disconnected and toasts. Firmware writes go out on the old session first.
- Review and step 1 no longer say "internally consistent".
- Tests pass on main.

**#1559 (ADR-420 Amd 5):**
- No "Laser Log" is left in `src`.
- `error:N` and `ALARM:N` are decoded from the Console's tables. A refused `$` line no longer carries home advice. `$J=` lines run in the jog context, so they are unaffected.
- Home refused with homing off names Machine Setup.
- An empty or cancelled picker sets `noPortChosen` and names CH340/CP210x.

**#1567 (ADR-637 Amd 7):**
- `$32` never sets the type. A laser draft keeps its laser-mode expectation.
- The card writes only after a backup, when there are settings rows, and after a confirm (`DeviceSetupLaserModeOff.tsx:160-185`). The write goes through the guarded `writeGrblSetting` with read-back.
- On a CNC project the button is disabled.
- The FluidNC and Falcon wording is correct. Job Review's button confirms first.
- G-code is unaffected (the PR's byte test passes).
- No new unconfirmed `$` write path was found. The firmware-diff row 0 → 1 in Review is written only when queued and confirmed (`device-setup-flow.ts:238-250`).

**#1568:**
- **Restore** writes `G54 G21 G92 X(m−s) Y(m−s)`, which is exact whatever G54 holds. The simulator confirms simulator WCO equals the saved origin and the head does not move.
- The card requires `alarmCode 3`, the current stream's operator request and a recorded reset, so a stale request from an earlier stream never shows it.
- `waitForControllerStatus` gives up on a new session or on disconnect. `assertOriginActionReady` refuses during a job, motion, an operation, MPG or non-Idle.
- grblHAL's "kept" wording is correct.
- Frame refusals while the position is withheld name Home or Set origin here (rail Unlock and Console `$X`).
- The bed-edge Frame warning is advisory and reaches Job Review.

**#1569 (ADR-393 Amd 1):**
- `error:79` (GRBL family only), an E-stop pin in Alarm (not FluidNC), and an acknowledged `$X` followed by Alarm all latch Reset.
- The reboot banner clears the latch and the refused-`$` notice.
- The card names the physical step before Reset.

**#1595:**
- Alarm 8 and 9 put Unlock and Machine Setup first.
- Alarm 1 and 2 no longer say "press Reset" after the reset.
- The toolbar shows Alarm or Halted.
- Use detected keeps the baud that answered.
- A second refused idle command replaces the first notice.

**#1599:** the toolbar shows "No answer". The long form stays in Machine Setup.

**PR suites on main:** 14 files and 116 tests pass (`zz-v3\vitest-prs.txt`):
- `abort-unlock-frame.simulator`, `AbortStoppedCard`, `save-driver-switch`, `live-driver-mismatch`;
- `DeviceSetupWizard.laser-mode-off`, `JobReviewWarnings`, `controller-reset-required`, `AlarmBanner`;
- `controller-messages-u5`, `ConnectionBar.compact`, `controller-rejection-text`, `frame-position-withheld`;
- `DeviceSetupConnectHelp`, `device-setup-auto-fill`.

**Test truth:** each PR's regression test imports a module or asserts wording added by the PR, so it fails on the pre-fix commit. The first-connect e2e asserts `$HX`/`$HY` (not run here).

## Not verified

- **L12 e2e.** `first-connect-machine-setup.e2e.ts`, `controller-recovery-toast.spec.ts` and the connection, toast and Machine Setup specs listed in #1599 were not run: available memory never reached the 3 GB browser gate (peak about 1.7 GB).
  - In particular, #1595 (merged 7 minutes after #1599, no CI on the combined main) adds " · Alarm" and " · Halted" to the same toolbar status line whose width #1599 had to shrink (ADR-642). Whether "Connected · Halted" widens the row at 1920 px was not measured.
- **The rendered card.** The failure path of V3-P2-2 was shown at store level, with the card's visibility predicate read from `LaserWindow.tsx`. The rendered DOM was not checked.
- **"Home, then restore origin" on `$10=0`** (needs a simulator that drops WCO after homing); FluidNC's Abort behaviour; Marlin and Smoothieware sibling paths of the Abort card. The card is GRBL-family only.
- **A second window, and a port vanishing mid-restore.** Only read: `waitForControllerStatus` returns false and the error is lost as in V3-P2-2.
- **Hardware:** none, by instruction.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v3\`:

| File | What it does |
|---|---|
| `zz-v3-abort-card.test.tsx` | Vitest repro. To run it, copy it into `j10-main\src\ui\laser\`, run it, and remove it afterwards. V3 A is V3-P2-2 (`$10=0` vs `$10=1`), V3 C is V3-P3-1, V3 B is V3-P2-1. Run V3 B alone with `-t "V3 B"`: it leaks timer state when it runs after V3 C. |
| `repro-log.txt` | Output of the last run (V3 B; the V3 A and V3 C output is quoted above from the previous run) |
| `vitest-out2.txt`, `vitest-out3.txt` | Vitest output |
| `entry.ts`, `bundles\v3.mjs`, `twin.mjs` | Node twin repro: blocker vs button guard, withheld MPos on `$10=0`. Output in `tasks\b9c23ng0g.output` (the script prints, then keeps the event loop alive; it was stopped) |
| `vitest-prs.txt` | The PRs' own suites on main |

```json
{
  "area": "V3",
  "id": "fix-controller",
  "tree": "5f09e1110",
  "raised": 5,
  "findings": [
    {"id": "V3-P2-1", "severity": "P2", "area": "V3", "file": "src/ui/laser/ControllerConnectionControls.tsx", "line": 85, "anchor": "Contract ADR-637 Amd 6 D1 (no job in flight) + L9 twin saveDriverSwitchBlocker", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Toolbar Reconnect now is enabled during a running job (connectionControlsBusy ignores the streamer); its hover says 'Nothing moves', but the disconnect soft-resets and ends the job; Save refuses the same state with 'a job is running'"},
    {"id": "V3-P2-2", "severity": "P2", "area": "V3", "file": "src/ui/laser/AbortStoppedCard.tsx", "line": 51, "anchor": "Contract ADR-341 Amd 11 D3/D5 + L6; twin $10=1", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "On $10=0 (WPos-only) Restore saved origin sends $X then throws (no withheld MPos); the alarm is cleared so the card and its failure text are gone, with no toast; origin stays cleared (U4-P2-3 outcome). Any post-Unlock failure is lost the same way"},
    {"id": "V3-P3-1", "severity": "P3", "area": "V3", "file": "src/ui/laser/device-setup/save-driver-switch.ts", "line": 89, "anchor": "Contract ADR-637 Amd 6 D1 wording; ADR-341 Amd 11 context", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Save's driver-switch reconnect soft-resets GRBL-family boards, clearing a G92 origin on stock GRBL/FluidNC; toast and ADR say only that nothing moves"},
    {"id": "V3-P3-2", "severity": "P3", "area": "V3", "file": "docs/decisions/ADR-637-amendment-7-laser-mode-off-asks-instead-of-making-a-cnc.md", "line": 8, "anchor": "Contract (ADR vs code)", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Amd 7 status line promises a saved backup before every write; Job Review's Send $32=1 confirms but takes no backup (like its Send $32=0 twin)"},
    {"id": "V3-P3-3", "severity": "P3", "area": "V3", "file": "src/ui/state/laser-job-stop.ts", "line": 370, "anchor": "Contract ADR-341 Amd 11 D1; ground truth GRBL G92 cleared at reset", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Abort records the origin only for workOriginSource 'g92'; an origin learned at connect or kept through Home ('unknown') is cleared by the reset with no offer and no mention; Unlock hover says 'without changing the origin'"}
  ]
}
```

## Refuter (2026-11-08)

- **Tree:** `j10-main` (export of `5f09e1110`). All citations below are pinned there.
- **Runs:**
  - Focused Vitest on the real store and the repo's GRBL simulator, 1.59–1.66 GB available.
  - My own test, `zz-v3r\zz-v3r-refuter.test.tsx`, was copied into `src\ui\laser\` for each run and removed afterwards. Logs: `zz-v3r\repro-log.txt`, `vitest-out*.txt`.
  - For `$10=0` I did not reuse the auditor's wrapper, which sends WCO on every report. My wrapper follows GRBL 1.1's real WCO cadence: WCO on the first report after a `0x18` reset (`main.c:75`, `memset(&sys…)`) or after a G92/G10 (`system.c:280-285`), then once every 10 reports at Idle or every 30 while busy.
  - The browser gate (3 GB) was never met, so no e2e ran.

### V3-P2-1: CONFIRMED, P2

**What would refute it, checked one by one:**
- **Is the button disabled or hidden during a job? No.**
  - `ConnectionBar.tsx:160-173` renders it whenever `driverMismatch` is set, as `lf-btn--primary` inside `role="alert"`, with the hover "…Nothing moves."
  - Its only guard is `disabled={!supportsSerial || controlsBusy || isFileOnlyProfile}` (`ControllerConnectionControls.tsx:127`).
  - `connectionControlsBusy` (`:207-219`) reads `motionOperation` and `controllerOperation` and never the streamer.
  - The auditor's run read the guard as `false` from the real store mid-stream.
  - Nothing moves focus to the button: it has no autofocus. But it is the only primary button in the toolbar while the notice shows.
- **Can the mismatch exist when a job starts? Yes.**
  - ADR-637 Amd 6 says the notice shows "however that happened".
  - Save's own deferral (Sleep, Hold, Jog, an operation, TCP) leaves the mismatch in place.
  - Start is not gated by it ("adds no Start guard", `:6`).
  - Save itself cannot be deferred by a job: it refuses outright (`use-machine-setup-save.ts:44-51`). The auditor's Sleep scenario is therefore the realistic route.
- **Does a recovery offer argue for P2? Yes, and it is stronger than the auditor said.**
  - The repro is `zz-v3r` "R1": a framed job streaming 36 of 47 lines, the profile switched to grblHAL, then exactly `reconnectWithProfile`'s two calls.
  - Afterwards the repository holds the run's capsule: `kind disconnect`, `acked 36 of 47`, "The serial connection closed during the job."
  - `disconnect` is in `AUTO_OPEN_KINDS` (`CheckpointResumeBanner.tsx:87-92`), so that Review opens by itself once connected (`:100-123`, read, not rendered).
  - The reconnected controller reports `Alarm`, so the toolbar shows "Connected · Alarm" (#1595).
  - The auditor's line "nothing on the toolbar says the job was stopped" is literally true. But the job and its resume point are kept, and the operator is told.
- **P1 or P2? P2.**
  - METHOD §3 P1 needs unexpected motion or firing, silently wrong power/position/depth/scale, or lost data. None holds:
    - the stop follows the operator's own click;
    - the soft reset turns the beam off;
    - the run is archived with a resume offer.
  - A half-burned piece is an incomplete output that the operator caused and is told about, not a wrong one. §3 has no "harms a job" clause for P1.
  - P2 holds on two grounds:
    - the contract break (Amd 6 D1 limits this reconnect to "nothing in flight", and Save's twin `saveDriverSwitchBlocker:54` refuses "a job is running");
    - the misleading hover.
- **Other routes, checked:**
  - **Ctrl+K Disconnect:** guarded. `machineBusy` includes `activeStreamer` (`use-app-commands.ts:127,231-235`), and `laser-command-family.ts:22-36` disables it with "Machine is busy". That is a second in-code twin against the toolbar button.
  - **Forget Controller:** guarded. `jobAwareConfirm` refuses while a job runs (`job-aware-dialogs.ts:33-39`).
  - **Toolbar Disconnect and "Use a different port…":** unguarded (`ConnectionBar.tsx:195-203`, `:297-303`; `ControllerConnectionControls.tsx:79-82`). Ending the job this way is by design (`2026-10-16-controller-reconnect-audit.md:97`), neither promises that nothing moves, and both predate these PRs. Not a finding.
  - **Machine Setup step 1:** **Reconnect using selected profile** (`DeviceSetupConnectStep.tsx:223-231` → `use-find-machine.ts:152-156`) is the very button Amd 6 D1 calls "the same reconnect". Machine Setup opens in every state (`DeviceSetupControls.tsx:36`), and changing the draft's controller mid-job shows the button.
    - Its only guard is `connectionBlocked`, which blocks network targets only (`machine-setup-connection.ts:25-29`).
    - Step 1's **Disconnect** and **Use a different port…** (`:154-185`) are likewise unguarded.
    - All of this predates #1558 and carries no "Nothing moves" promise, so I fold it into this finding's scope rather than counting it separately.
- **Fix direction:** apply `saveDriverSwitchBlocker` to both reconnect entry points (the toolbar and step 1).

### V3-P2-2: CONFIRMED, P2. "Home, then restore origin" fails the same way (reproduced)

- **R3, Restore saved origin with homing off, on `$10=0` at GRBL's real cadence:**
  - Abort records `{20,30}`.
  - The restore throws `RESTORE_ORIGIN_POSITION_UNKNOWN_MESSAGE`.
  - Wire: `$X\n` only.
  - Afterwards: alarm null, Idle, so the card is hidden (predicate at `LaserWindow.tsx:295-312`); simulator WCO `{0,0}`; `positionEvidenceSuppressed true`; toasts `[]`.
  - This matches the auditor's result under the more generous wrapper.
- **R2, "Home, then restore origin" (profile homing on, `$22=1`), which the auditor did not run:**
  - Wire: `$H`, `G4 P0.01`, `$G`. The head homes, then the restore throws the same message.
  - Afterwards: alarm null, card hidden, simulator WCO `{0,0}`, origin source `none`, `wcoCache null`, toasts `[]`.
  - Cause:
    - `homeOriginPatch` sets `wcoCache: null` (`laser-home-action.ts:225-234`).
    - The next WPos-only reports carry no `WCO:` until GRBL's counter wraps.
    - `inferCurrentMachinePosition` needs WPos plus a WCO (`infer-machine-position.ts:15-20`).
    - The withheld MPos is absent because nothing is withheld after Home.
  - This variant succeeds only when a WCO-bearing report lands between Home's Idle and the G92 aim: about 1 in 10 at Idle.
- **Is this P1, a wrong burn? No.** In both variants the next Frame either:
  - refuses ("Position is unknown after Unlock…", `frame-position-withheld.ts:37-38`), in R3; or
  - asks "User Origin needs a custom work origin. OK: set the work origin at the current head position…" (U4 step 6), in R2, where the head now sits at the home corner.

  That is an explicit, specific message before any output, which is U4-P2-3's P2 outcome. Nothing moves except the Home the button names.
- **Added evidence (L6):**
  - The thrown text says "Wait for a position report and try again".
  - On `$10=0` after Unlock, waiting never helps: position stays withheld until Home or an origin write.
  - The same text is what the interrupted job's Review recovery would show for its own Restore saved origin. It is visible there, but it still points the operator at a retry that cannot succeed.
- **Not verified:** "`$10=0` (LightBurn's advice)" is a KerfDesk code comment (`status-report-mask.ts:6`), not a primary source. I did not fetch LightBurn's documentation, so that clause is UNVERIFIED. The finding does not depend on it, since `$10=0` is a supported GRBL setting.

### V3-P3-1: CONFIRMED, P3

- **Read:** `save-driver-switch.ts:89-91` runs `laser.disconnect()`, which reaches `stopBeforeDisconnect`, which sends a GRBL-family soft reset (`laser-disconnect-stop.ts:61-66`).
- **Reach is narrower than stated.** On a grblHAL board (the Falcon and Ortur cases Amd 6 targets), G92 survives the reset (ADR-375). The loss needs a stock-GRBL or FluidNC board whose profile changes driver or command set.
- KerfDesk's own state goes to `none`. The next User Origin Frame then asks explicitly before using the head.
- It is wording/polish, not a wrong burn.

### V3-P3-2: CONFIRMED, P3 (pin corrected)

- The ADR-637 Amd 7 status line (`:7-8`) promises "a saved backup and a confirm". Decision 4 (`:61-66`) describes only "a confirm … and the same guarded write".
- **Pin correction:** `SendLaserModeButton.tsx` is 42 lines long, so the cited `:41-56` does not exist. The write is at `:20-28`: `jobAwareConfirm` then `writeLaserModeOn()`, with no backup.

### V3-P3-3: CONFIRMED, P3. One of its two routes is mostly unreachable

- `g92OriginAtStop` requires `workOriginSource === 'g92'` (`laser-job-stop.ts:370-377`).
- **The "learned after a reconnect" route is mostly unreachable on stock GRBL and FluidNC.** KerfDesk's own Disconnect soft-resets first (`laser-disconnect-stop.ts:61-66`), which already clears G92. A non-zero WCO seen after the reconnect is therefore G54, and G54 survives the Abort's reset. Only a link lost without a reset, on a board that does not reset when the port opens, keeps it.
- **The "set origin, then Home" route is reachable:**
  - `homeOriginPatch` turns `g92` into `unknown` (`laser-home-action.ts:228-233`).
  - `knownOrUnknownOriginSource` keeps `unknown` on later WCO (`laser-status-position.ts:90`).
  - GRBL keeps G92 through `$H`, so the Abort's reset clears an origin the card never mentions.
- The Review recovery still offers the archived origin, so P3 stands.

### Challenges to "Verified clean"

- **"No `$` write without a click and a confirm":** holds for settings writes.
  - Paths found: Save's queued rows, which need the backup checkbox (`device-setup-flow.ts:234-250`, `use-machine-setup-save.ts:86-101`), `DeviceSetupLaserModeOff.tsx:111`, `SendLaserModeButton.tsx:21-24`, and `SendRouterModeButton.tsx:28`. No others.
  - The Abort card sends `$X` (and `$H`) on one click with no confirm. That matches the plain Unlock (`AlarmRecoveryActions.tsx:70-76`, no confirm), so it is not a regression.
- **"The origin restore never moves without homing":** holds. R3's wire is `$X` only; R2's motion is only the `$H` its label names. `restoreWorkOrigin` writes one G92 (`laser-origin-restore.ts:190,218`).
- **"Reset and Unlock skip no homing requirement":** holds.
  - `homeFirst = homingEnabled && homeFromAlarm` (`AbortStoppedCard.tsx:39`). `homeFromAlarm` is false only on Smoothieware (`smoothieware/driver.ts:56`), and the card is GRBL-family only.
  - A profile with homing off on a `$22=1` board restores without homing. That is the auditor's refuted item #1, and I agree.
- **#1595 × #1599 (merged 7 minutes apart, no CI):** the code composes cleanly.
  - `toolbarStatus` (`ConnectionBar.tsx:94-108`) returns "Not responding", then "No answer", then the " · Alarm/Halted" suffix.
  - "No answer" needs `!controllerHeard` (no status report and no banner), while Alarm needs a status report or `alarmCode`. The two exclude each other.
  - The five toolbar suites pass on main: `ConnectionBar.compact`, `ConnectionBar-info-recovery`, `ConnectionBar-forget-device`, `controller-messages-u5`, `port-open-no-answer`. That is 51 tests (`zz-v3r\vitest-toolbar.txt`).
  - **Gap:** `e2e/controller-recovery-toast.spec.ts` asserts an unchanged row only across the qualification phases, never with Alarm or Halted. "Connected · Halted" is 18 characters against "Reading settings…" at 17, and nothing tests whether it widens the row (ADR-642). That is untested and not measured here. At most it is cosmetic.
- **Test truth for #1558:** the auditor's claim holds, with one gap. `save-driver-switch.test.ts` checks the blocker, but no test covers the toolbar button's guard, which is how V3-P2-1 escaped.

### New findings

None counted separately. The Machine Setup step 1 reconnect is folded into V3-P2-1. The misleading "Wait for a position report" text is folded into V3-P2-2.

### Not verified (refuter)

- **e2e:** `controller-recovery-toast.spec.ts`, `first-connect-machine-setup.e2e.ts` and the Chrome UX toolbar spec. Available memory was 1.59–1.66 GB, under the 3 GB gate. The toolbar width with " · Halted" was not measured.
- **Rendered UI:** the auto-opened recovery Review after Reconnect now, and the Abort card's DOM. Both were read in code, not rendered.
- **LightBurn's `$10=0` advice:** UNVERIFIED, not fetched.

Refuter counts: raised 5, refuted 0, P1 0, P2 2, P3 3, known 1
