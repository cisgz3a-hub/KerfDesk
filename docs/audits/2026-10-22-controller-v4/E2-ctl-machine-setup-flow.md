# Controller audit v4 — E2 Machine setup flow (`ctl-machine-setup-flow`)

- **When:** 2026-10-22 22:20–23:00   **Tree:** origin/main @ `71ff820ce` (worktree `src/` identical
  to `71ff820ce`; the worktree HEAD only adds audit documents). `origin/main` moved to `d7a42cb06`
  during the audit; `git diff 71ff820ce d7a42cb06` touches none of the scope files, the S30 preset,
  `machine-setup-actions.ts` or `MachineModeToggle.tsx`.
- **Scope:**
  - `src/ui/laser/device-setup/**` (flow reducer, wizard, picker, auto-fill, Find, firmware
    comparison and sync, Review, Summary, Options, CNC steps, controller guide,
    `machine-setup-connection.ts`, `use-machine-setup-save.ts`, dialog store and host).
  - `src/ui/laser/connect-machine.ts`, `src/ui/app/machine-setup-banner-state.ts` (+
    `MachineSetupBanner.tsx`), `src/ui/laser/machine-setup-fill-heat-risk.ts` (+
    `core/job/fill-heat-risk.ts`), `src/ui/laser/NoHomingPosition{Guide,Choices}.tsx`.
  - Read for twins: `ui/state/machine-setup-actions.ts`, `grbl-settings-actions.ts`,
    `machine-settings-write-readiness.ts`, `last-machine-persistence.ts`, `startup-project.ts`,
    `app/use-machine-profile-persistence.ts`, `job-placement.ts`, `machine/MachineModeToggle.tsx`,
    `state/laser-jog-actions.ts`, `job-review/job-review-live-rows.ts`,
    `core/controllers/grbl/parse-settings.ts`, `core/devices/{brand-laser-profiles,preset-corrections,device-profile-patch}.ts`,
    `io/machine-profile/machine-profile-io.ts`.
- **Governing:** ADR-420 (+ Amd 1–4), ADR-637 (+ Amd 1), ADR-500 (+ Amd 1), ADR-416 decision 1
  (mode locked while a job runs), ADR-347, ADR-240 #2, ADR-205/ADR-092 (guarded firmware sync),
  ADR-193 (no-homing default placement), ADR-053/ADR-225 (hand positioning); PROJECT.md "Users and
  roles" and Safety non-negotiables 1 (bounds) and 2 (origin honesty); AGENTS.md "Never invent
  controller settings".
- **Primary sources fetched:**
  - LightBurn "Find My Laser" 2.0 (docs.lightburnsoftware.com/2.0/GetStarted/FindMyLaser/): the
    operator sets the origin ("nearly all GCode systems use" Front Left), confirms the work area,
    and enables Auto-home only with homing/limit switches; nothing is written to the controller.
  - GRBL v1.1 Configuration wiki (github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): `$130`–`$132`
    "maximum travel from end to end", used only with soft limits and homing; `$23` inverts homing
    direction; `$22` homing lock.
  - gnea/grbl master `system.c` L179-180 (`$H` with homing disabled → `STATUS_SETTING_DISABLED`,
    error:5), `protocol.c` L49-54 (sleep re-initialises as ALARM after reset), `main.c` L58-66
    (`HOMING_INIT_LOCK`).
  - Smoothieware edge `Block.h` L96/L110 (`s_value` "1.11 Fixed point", 12 bits) and `Laser.cpp`
    L30-39/L106-109 (config keys `laser_module_enable`, `laser_module_minimum_power`,
    `laser_module_maximum_s_value`, default 1.0).
  - LightBurn forum t/88769 (S30 Pro: "workspace of the S30 Pro is NOT 400x410! It's 380×385";
    factory firmware keeps the larger value) and t/85653 (S30: LightBurn showed 400x410 on connection).
  - Vendor pages for xTool and Ortur were not re-fetched; C7 verified their origin/bed values.
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes, plus L6 inside L4 (Save/sync failure
  paths). L5 limited to the localStorage records (last machine, configured signatures): both are
  validated or parsed defensively.
- **Counts:** 6 raised → refuter: confirmed 6 / plausible 0 / refuted 0 → P1 0 / P2 2 / P3 4
  (+ 6 KNOWN re-encountered). Severity changes: none.
- **Refuter (2026-10-22 22:45–23:10, fresh context):** rebuilt P2-1 and P2-2 as rendered-wizard
  repros (P2-2 against a real streamer held at a tool change) instead of the auditor's reducer
  repros; re-ran the P3 repros; fetched the LightBurn forum threads t/88769 and t/189309 itself
  (sculpfun.com returned HTTP 429 on every attempt, so the vendor page was not re-read).

## Headline

Machine Setup itself writes to the controller only at final Save, only queued `$30`/`$31`/`$32`
rows, each confirmed and re-read (C4 covered this path). The two real problems sit beside it:

- **The automatic fill writes the controller's `$130`/`$131` over a listed machine's sourced bed.**
  Choose the Sculpfun S30 (380 × 385 mm, chosen because its firmware's 400/410 "can drive X into the
  frame"), then press Connect: the draft becomes 400 × 410 mm, the S30 row stays chosen, no preset
  correction fires, and Job Review's travel check now agrees with the controller, so nothing warns
  again. ADR-420 rule 8 itself says `$130`/`$131` are travel limits, not the bed.
- **Save has no job guard, so it can switch Laser/CNC during a held CNC job**, the switch ADR-416
  locks on the toolbar because "a CNC tool-change jog lost its safe-Z lift". The Machine Setup button
  sits next to the locked toggle and stays enabled.

## Setup step → what it reads and writes → source

| Step | Reads | Writes | Source |
|---|---|---|---|
| Open (any entry point) | `project.device`, `project.machine`, `cachedCncMachine`, CNC library tools; laser store `detectedSettings`, `detectedControllerKind`, `lastSettingsReadAt`, connection; localStorage configured signatures (decides `newMachine`) | Draft only | `DeviceSetupWizard.tsx:56-84`, `MachineSetupDialogHost.tsx` |
| Explicit first Connect | configured signature of `project.device` + mode | Opens setup; starts the normal connect (handshake: banner, `$I`, `$$`, `$G`) | `connect-machine.ts:19-37` |
| Machine list (choose a row) | catalog, detected family (firmware hint) | Draft: `apply-preset` replaces it verbatim, `machineKinds` from the preset | `machine-picker-entries.ts:241-273`, `device-setup-flow.ts:300-324` |
| Connection strip: Connect / Choose port / Try other speeds / Reconnect | draft controller, baud, command set | Serial connect/disconnect only; remembered port (ADR-420 rule 1). No settings written | `use-find-machine.ts:118-169`, `device-setup-baud-scan.ts` |
| Read again | guide command lists | Sends `$I`, `$$` (GRBL/grblHAL); `$I`, `$CD`, `$$` (FluidNC); `M115`, `M503`, `M114`, `M400` (Marlin); `version`, `M114` (Smoothieware) through the Console path. All reads | `use-find-machine.ts:306-326`, `machine-setup-controller-guide.ts` |
| Automatic fill (new machine, or the connection Find opened) | `$11`, `$30`, `$31`, `$32`, `$110/$111` (max), `$120/$121` (min), `$130/$131`, `$132`; banner family; answering baud | Draft: controller family, baud, machine type from `$32` (not for a listed machine), and the whole mapped patch incl. **bed from `$130/$131`** (re-applied on every later settings read) | `device-setup-auto-fill.ts:94-111`, `parse-settings.ts:148-177`, `use-controller-auto-fill.ts:54-61` |
| Use detected values (machine already set up) | same patch | Draft, explicit click | `DeviceSetupDetectedApply.tsx` |
| Essentials | guide `homeCommand` | Draft: name, bed, origin, Home on/off, recorded home corner, laser feeds. Never reads `$22`/`$23` | `DeviceSetupConfirmStep.tsx:19-91` |
| Machine output / CNC limits / Options / CNC setup | draft; raster diagnostics compile the project scene with the draft device | Draft only. Exception: CNC "Save current draft" stores a named CNC setup in the library immediately (by design) | `DeviceSetupMachineStep.tsx`, `DeviceSetupOptionsStep.tsx`, `DeviceSetupRasterDiagnostics.tsx:13-35` |
| Review: Controller settings | `grblSettingsRows` (`$30`, `$31`, `$32`, `$130`, `$131` only) | Draft: backup attestation; per-row typed confirm + queue, only `writeRisk === 'common'` and only at Idle with no job/motion/operation | `device-setup-firmware-diff.ts:56-130`, `DeviceSetupFirmwareStep.tsx:153-399` |
| Save | draft | 1) project (`replaceMachineSetup`/`replaceCncStartupSetup`: device, machine, workspace size, CNC scene/tools, job placement, cached CNC, one undo step); 2) localStorage last machine (store subscription, then again from `onConfigured`) and configured signature; 3) for each queued row `$id=value` then `$$` verify, stopping at the first failure | `use-machine-setup-save.ts:29-89`, `machine-setup-actions.ts:62-138`, `MachineSetupDialogHost.tsx:39-65`, `use-machine-profile-persistence.ts`, `grbl-settings-actions.ts:198-292` |
| Cancel / Escape / Discard | — | Nothing. Close is blocked while Save runs | `DeviceSetupShell.tsx`, `DeviceSetupWizard.tsx:100-105` |
| Restart | localStorage last machine (validated as a machine-profile document, `'restore'` mode) | Startup project device + mode | `startup-project.ts`, `last-machine-persistence.ts:51-75` |
| First-run banner | `project.device`, configured signatures, last machine | "Use *name*" → `replaceDeviceProfile` | `machine-setup-banner-state.ts:141-163`, `MachineSetupBanner.tsx` |
| No-homing guide (rail) | `device.homing.enabled`, status, work origin | `$SLP`, wake (soft reset), `$X`, Set origin here, placement → Verified Origin | `NoHomingPositionGuide.tsx:80-219` |

## Findings

### E2-P2-1 — The automatic fill replaces a listed machine's sourced bed with the controller's `$130`/`$131`; the row stays chosen and every later check then agrees with the wrong value

- **Where:**
  - `src/ui/laser/device-setup/device-setup-auto-fill.ts:107-108` puts the whole reported patch in
    an `accept-detected`, for a listed machine too (only the machine type is protected, `:383-393`).
  - `src/core/controllers/grbl/parse-settings.ts:172-173` maps `$130`/`$131` to `bedWidth`/`bedHeight`.
  - `src/ui/laser/device-setup/use-controller-auto-fill.ts:54-61` with `device-setup-auto-fill.ts:302-315`:
    every later settings read (Read again, Find's reconnect) fills again on top.
  - `src/ui/laser/device-setup/machine-picker-entries.ts:179-187`: a listed laser row stays chosen by
    `profileId` whatever the bed.
  - `src/core/devices/preset-corrections.ts:42`: the S30 correction fires only on exactly 410 × 400.
  - `src/ui/laser/job-review/job-review-live-rows.ts:425-441`: the travel fact warns only when
    `$130`/`$131` differ from the profile bed.
- **Anchor:**
  - Contract: ADR-420 rule 8 ("`$130`/`$131` are the controller's travel limits, not the bed");
    ADR-240 #2 / ADR-637 Amd 1 #1 (generic `$$` values do not establish what a listed machine is);
    PROJECT.md non-negotiable 1 (bounds check against the configured bed).
  - Twin: the S30 preset's own source note (`brand-laser-profiles.ts:111-117`): 380 × 385 mm from
    Sculpfun's product page, and "Sculpfun's firmware sets $130=400 / $131=410 … so larger values can
    drive X into the frame". The found card's own note says "Configured travel is the controller's
    limit, not a measured work area" (`DeviceSetupFoundMachine.tsx:79-81`).
  - Ground truth: GRBL v1.1 wiki, `$130` "maximum travel from end to end", meaningful only with soft
    limits and homing; LightBurn forum t/88769 (S30 Pro work area 380 × 385, firmware keeps 400 × 410).
- **Scenario:** A new S30 owner opens Machine Setup from the banner (not connected), chooses
  **Sculpfun S30** (380 × 385), then presses **Connect** on the strip (Find). The controller reports
  `$130=400`, `$131=410`. The fill sets the draft bed to 400 × 410; the S30 row stays chosen and its
  facts now read 400 × 410; Save stores `profileId: 'sculpfun-s30'` with 400 × 410. No preset
  correction is offered (not 410 × 400), and Job Review's "Travel `$130` × `$131`" now matches the
  profile, so it no longer warns. A design placed at X 380–400 passes the bounds check and runs the
  head into the frame (soft limits off on this firmware). The same happens when the operator connects
  first (fill on the starter), chooses the S30, and any later settings read follows. The change is
  listed once on the Machine stage with Undo, which keeps this at P2.
- **Evidence:** REPRO. `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/device-setup/zz-e2-autofill-listed.test.ts --silent=false --reporter=verbose`
  (copy: scratchpad `e2-repros/zz-e2-autofill-listed.test.ts`):
  - Order A: `chosen bed 380 385` → `filled bed 400 410 row sculpfun-s30 profileId sculpfun-s30`,
    `correction offered []`.
  - Order B: `after choose bed 380 385` → `after re-read bed 400 410 row sculpfun-s30`.
- **Refuter:** CONFIRMED, P2 kept.
  - Rendered repro, newly built: `zz-e2r-autofill-s30.test.tsx` (deleted after the run). New machine,
    offline; choose **Sculpfun S30 (5 W, stock automatic air)**; press the strip's **Connect**; the
    controller reports `$130=400`, `$131=410`; Next, Next, **Save machine setup**. Output:
    `fill card: Filled in from your controller Bed width: 380.000 mm → 400.000 mm Bed height:
    385.000 mm → 410.000 mm … Configured travel is the controller's limit, not a measured work area.
    Undo`; `row still checked true`; `essentials bed 400 410`; `SAVED sculpfun-s30 400 410
    workspace 400 410`; `corrections []`.
  - When it runs: no explicit "read from controller" click is needed. `use-controller-auto-fill.ts:53-61`
    fills whenever a settings read completes and `newMachine || findOwnsConnection`. That covers the
    strip's Connect, an auto-connect or replug while setup is open on an unconfigured machine, and
    **Read again**. A machine that was already set up fills only on the strip's own Connect (Find).
    The most common path is the toolbar's first Connect, which fills the starter. Choosing the S30
    after that keeps 380 × 385, because the fill record has the same `readAt`, until the next
    settings read.
  - Which value to trust: the controller's 400/410 is the firmware's own claim, not a measurement.
    LightBurn forum t/88769 and t/189309 (S30 Pro owners) report a usable 380 × 385. A head sent past
    about 380 mm "rattles" (skips steps) until the limit switches are removed. The catalog is the
    sourced figure, and the preset's own note says the firmware values "can drive X into the frame".
    For a listed machine, KerfDesk should trust the catalog.
  - Soft limits do not save it. With `$20=1`, GRBL bounds travel by the same wrong `$130`/`$131`,
    so X 390 is "inside". Hard limits trip only at the switches at the home end. The result is lost
    steps, and every later burn shifts silently: wrong physical output.
  - Why still P2 and not P1: the fill card does list both changes with Undo, plus a caveat line.
    The art must also be placed in the 380–400 / 385–410 band.
  - Job Review: `travelFact` (`job-review-live-rows.ts:425-441`) gives a warning tone only when
    `$130`/`$131` ≠ the profile bed. After the fill they are equal, so it reads in default tone.
  - Twins: Review's firmware table (`device-setup-firmware-diff.ts:126-127`) also diffs
    `$130`/`$131` against the draft bed, so it matches too.
  - Contrast with the Falcon A1 Pro, filled the same way (358 × 268 → 400 × 400). Its stale-preset
    correction (`preset-corrections.ts:53`) fires in Essentials afterwards. The S30's stale signature
    is 410 × 400, not the firmware's 400 × 410, so the S30 gets nothing.
  - Anchor correction: ADR-420 rule 5 does say the fill adopts "the mapped `$$` values". Rule 8's
    "travel limits, not the bed" sentence sits in the catalog-pick rule, so the code follows rule 5
    to the letter. The contract break is with ADR-637 Amd 1 #1, whose reasoning ("`$$` is a setting
    of its controller") protects only the type. It also breaks ADR-637's consequence that the fill
    "leaves the draft as a machine that isn't listed": here the S30 row stays chosen.
  - Line corrections: `device-setup-auto-fill.ts` has 151 lines. The listed-machine type guard is
    `:141-150`, and the refill on a new `readAt` is `nextAutoFill` `:52-74`, not `:383-393` / `:302-315`.
- **Fix direction:** For a draft that is a listed machine (or any draft whose bed came from the
  catalog), leave `bedWidth`/`bedHeight` out of the fill and show `$130`/`$131` as a travel
  comparison instead (as the Review firmware table already does); keep the bed fill only for the
  starter / "not listed" path. Consider extending the S30 correction to the firmware's 400 × 410.

### E2-P2-2 — Machine Setup's Save switches Laser/CNC during a running or held job; the toolbar switch is locked for exactly that case (ADR-416)

- **Where:**
  - `src/ui/laser/device-setup/use-machine-setup-save.ts:29-63`: `onSave`/`saveAndSync` check no job.
  - `src/ui/laser/device-setup/DeviceSetupShell.tsx:189-199`: Save is gated only by validation and
    `saving`.
  - `src/ui/state/machine-setup-actions.ts:62-77,102-122`: `replaceMachineSetup` /
    `replaceCncStartupSetup` apply the new machine and `modeSwitchState` with no streamer check.
  - `src/ui/laser/device-setup/DeviceSetupControls.tsx:35-42`: the Machine Setup button (in the
    toolbar beside the mode toggle) is never disabled.
  - Twin: `src/ui/machine/MachineModeToggle.tsx:26-35` refuses a switch while `isActiveJob`.
  - Consequence: `src/ui/state/laser-jog-actions.ts:368-388` lifts to safe Z before a point move only
    when the live project mode is CNC.
- **Anchor:** Contract: ADR-416 decision 1 ("the mode toggle is locked while a job runs"; context:
  "The Laser/CNC toggle stayed live during a job, so a CNC tool-change jog lost its safe-Z lift").
  Twin: the toolbar's lock against Setup's Save, which ADR-416 says swaps placement and Output "as the
  Laser/CNC toggle does". `DeviceSetupToolheadChoice` itself says to "switch heads with Laser / CNC
  in the machine toolbar" after saving.
- **Scenario:** A Laser + CNC machine runs a CNC job that stops at a tool change (streamer
  `tool-change`). The operator opens Machine Setup from the toolbar (or the bit-library link), picks
  **Laser** under "Which toolhead will you use?" (or chooses a laser machine from the list) and
  saves. The project is now in Laser mode while the CNC job is held. A Jog to point during the bit
  change no longer lifts to safe Z, so the bit is dragged across the stock or clamps; the mode the
  toolbar refuses to change has changed. (Firmware rows queued in the same Save are still refused by
  the write gate during the job.)
- **Evidence:** REPRO. `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/device-setup/zz-e2-save-during-job.test.ts --silent=false --reporter=verbose`
  (copy: scratchpad `e2-repros/zz-e2-save-during-job.test.ts`): the wizard seeded from a CNC
  hybrid project (`wizard kinds [ 'laser', 'cnc' ] active cnc`), `select-machine-kind laser`, then the
  same `replaceMachineSetup(...)` call Save makes → `result applied mode laser job active true`.
  The toolbar's refusal in the same state is pinned by `MachineModeToggle.hybrid.test.tsx:191-211`.
- **Refuter:** CONFIRMED, P2 kept.
  - Repro, newly built: `zz-e2r-save-hold.test.tsx` (deleted after the run). It reuses the
    `laser-tool-change-jog.test.ts` harness: a GRBL 1.1 stand-in and a real `startJob` of a two-bit
    CNC job, drained into the `tool-change` hold with a fresh Idle.
  - Then the rendered wizard, configured as CNC: choose **Sculpfun S30**; no replace notice
    appeared; Next, Next. **Save machine setup** was enabled. After Save: `mode after laser status
    tool-change active true`.
  - Jog to point (60, 70) then sent only `["$J=G91 G21 X50.000 Y50.000 F1000\n"]`.
  - Control: the same hold with no Save, in CNC mode, with Work-Z evidence, sent
    `["$J=G90 G21 Z3.810 F1000\n","$J=G91 G21 X50.000 Y50.000 F1000\n"]`. The safe-Z lift and the
    Work-Z readiness check (`assertCncPointMoveWorkZReady`) both key on the live project mode
    (`laser-jog-actions.ts:368-388`, `:390`).
  - No guard upstream:
    - `DeviceSetupControls.tsx:35-42`: the button is never disabled.
    - `openMachineSetup` and `MachineSetupDialogHost` have no job check, and the only
      streamer/`isActiveJob` reference in `device-setup/` is the firmware step.
    - `use-machine-setup-save.ts:29-66` is unguarded.
    - `machine-setup-actions.ts:62-138` is unguarded.
    - Jogs are open in a drained hold (`setupBlockingJobCommandBlockMessage`, `laser-store-helpers.ts:97-101`).
  - ADR-416 decision 1 locks only "the mode toggle", but decision 5 lists Machine Setup as a mode
    switch "as the toggle does", and the Context names this exact harm.
  - Why still P2 and not P1: it needs a deliberate, unusual sequence. During a held CNC job the
    operator opens setup and picks a laser machine or the Laser toolhead.
  - Why not P3: it is a broken contract with a clear physical failure (bit dragged through the
    stock or clamps).
- **Fix direction:** Refuse (or disable) Save while `isActiveJob(streamer)` when the save would
  change the active machine kind, ideally in the store action so every caller inherits it; say why,
  as `MODE_LOCKED_DURING_JOB` does. Decide whether any other setup change may land mid-job.

### E2-P3-1 — After choosing a listed machine, "Filled in from your controller" lists the machine's own values as if the controller reported them

- **Where:** `src/ui/laser/device-setup/DeviceSetupFoundMachine.tsx:36-42,56` diffs
  `record.undo` (the draft before the first fill) against the current draft;
  `use-controller-auto-fill.ts:47-61` keeps the `applied` record after a row is chosen.
- **Anchor:** Twin: the card's rows against what the fill actually applied (`device-setup-auto-fill.ts:94-111`);
  ADR-420 rule 5 ("The card lists every change" the fill made).
- **Scenario:** Connected first, the starter is filled with the controller's 400 mm width; the
  operator then chooses **xTool D1 Pro 10 W**. The card, still titled "Filled in from your
  controller", now reads "Bed width: 400.000 mm → **430.000 mm**", although the controller reported
  400 and 430 came from the catalog.
- **Evidence:** REPRO. `zz-e2-found-rows.test.ts` (scratchpad copy) → `ROWS ["Bed width: 400.000 mm -> 430.000 mm"]`.
- **Refuter:** CONFIRMED (P3). Re-ran → same `ROWS ["Bed width: 400.000 mm -> 430.000 mm"]`
  (`chosen … bed 430 400`). Code agrees: `AutoFilled` diffs `record.undo` against the live state
  (`DeviceSetupFoundMachine.tsx:36-42,56`), and choosing a row never clears the record
  (`use-controller-auto-fill.ts:47-73` resets it only on Find or Undo).
- **Fix direction:** Clear or rebase the fill record when a row is chosen, or diff the draft against
  the state right before the latest fill and list only the fill's own fields.

### E2-P3-2 — Setup turns Home on without reading `$22`/`$23`, and doing so moves the default Start from to Absolute; nothing compares the profile's Home with `$22`

- **Where:**
  - `src/ui/laser/device-setup/DeviceSetupConfirmStep.tsx:38-62`: the checkbox depends only on the
    driver having a home command.
  - `src/ui/laser/device-setup/device-setup-firmware-diff.ts:119-130`: Review compares `$30`, `$31`,
    `$32`, `$130`, `$131` only.
  - `src/ui/job-placement.ts:63-73` (via `machine-setup-actions.ts:125-129`): a default User Origin
    becomes Absolute when Home turns on.
  - `src/ui/laser/job-review/job-review-live-rows.ts:381`: "Homing `$22`" is a neutral fact, unlike
    the travel fact beside it.
- **Anchor:** Ground truth: GRBL `system.c:179-180` (`$H` with `$22=0` → error:5); LightBurn Find My
  Laser (enable Auto-home only with homing/limit switches). Twin: the travel fact compares
  `$130`/`$131` with the profile and warns; `$22` is shown but never compared (Super Console compares
  it "for visibility only").
- **Scenario:** A laser with `$22=0` and no switches; the operator ticks **Enable Home** in
  Essentials and saves. The default placement switches from User Origin to Absolute
  Coordinates, so jobs are placed from the power-on position. **Home** sends `$H` and gets error:5.
  Setup, Review and Job Review never point at the `$22` mismatch. The required Frame still shows the
  real position, hence P3.
- **Evidence:** REPRO. `zz-e2-homing.test.ts` (scratchpad copy) → `placement user-origin -> absolute`,
  `compared ids $30,$31,$32,$130,$131 expected 5`. `$H`/error:5 from SOURCE above.
- **Refuter:** CONFIRMED (P3). Re-ran → `placement user-origin -> absolute`,
  `compared ids $30,$31,$32,$130,$131`. Code agrees:
  - The checkbox is gated only on `guide.homeCommand` (`DeviceSetupConfirmStep.tsx:38-62`).
  - `diffedSettings` lists no `$22` (`device-setup-firmware-diff.ts:119-130`).
  - The Job Review `$22` fact has no tone (`job-review-live-rows.ts:381`).
  - The switch to Absolute follows ADR-193's homing default, so on its own it is by design. The
    defect is only that `$22` is never consulted.
- **Fix direction:** When `$22` was read this session, show it next to the Home checkbox and flag a
  mismatch in Review and Job Review (warning tone), as the travel fact does.

### E2-P3-3 — The no-homing card says "No homing switches" for every profile with Home off, including listed machines that home

- **Where:** `src/ui/laser/NoHomingPositionChoices.tsx:5-7` (`HAND_POSITION_INSTRUCTION`), shown
  whenever `device.homing.enabled` is false (`NoHomingPositionGuide.tsx:56`).
- **Anchor:** Twin: every catalog preset ships with Home off (C7 Verified clean), while the Falcon A1
  Pro's own command set homes with `$HX` then `$HY` (`machine-setup-controller-guide.test.ts:13`,
  Creality's bundle macro per C7) and the S30 note claims switches and homing (`brand-laser-profiles.ts:121`).
  Essentials frames Home as "Enable Home only after checking your switches", i.e. off ≠ absent.
- **Scenario:** A Falcon A1 Pro owner keeps the listed profile; the rail card tells them the machine
  has no homing switches and offers hand positioning only, although Machine Setup can turn Home on.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (P3), on two lines of evidence:
  - The card's only gate is `device.homing.enabled` (`NoHomingPositionGuide.tsx:56`), and its text
    asserts "No homing switches" (`NoHomingPositionChoices.tsx:5-7`).
  - No catalog preset ships Home on (`grep "homing: { enabled: true" src/core/devices` finds
    none), while the Falcon contract's Home is `$HX\n$HY` (`falcon-command-contract.ts:25`).
- **Fix direction:** Say "Home is off for this machine" and add a "Set up homing" link (as the Home
  button already does), instead of asserting the hardware has no switches.

### E2-P3-4 — The fill heat-risk check is an unsourced geometric rule, and its island counts ignore passes while the totals beside them count every pass

- **Where:** `src/core/job/fill-heat-risk.ts:76` (`fillSweepCount += emittedPasses`) against
  `:103-121` (`islandShortSweepCount += 1`, "short" = sweep shorter than `2 × overscanMm`); surfaced
  by `src/ui/laser/machine-setup-fill-heat-risk.ts:27-41` and Job Review.
- **Anchor:** Twin: coverage counts in the same summary multiply by passes. Contract: METHOD L2 / the
  brief asks for sourced maths; the threshold has no feed, acceleration or dialect (M3/M4) term and no
  cited source (introduced with "Harden island fill heat margins", 2026-06-28).
- **Scenario:** One short island sweep at 3 passes is reported as 1 short sweep while
  `fillSweepCount` is 3; the warning text "Island Fill has N short sweep(s)" undercounts what burns.
  The rule flags or clears sweeps independently of speed and acceleration, which decide the darkening.
- **Evidence:** REPRO. `zz-e2-heat-passes.test.ts` (scratchpad copy) → `1 pass 1 1 0 0`, `3 pass 3 1 0 0`.
- **Refuter:** CONFIRMED (P3, polish only).
  - Re-ran → `1 pass 1 1 0 0`, `3 pass 3 1 0 0`. `fill-heat-risk.ts:76` adds `emittedPasses`, while
    `:112-120` add 1.
  - Counting distinct island sweeps is defensible for a "which islands look darker" advisory.
    What stands is the inconsistent counting between fields of one summary, and the unsourced
    2 × overscan threshold.
  - In this repro the warning text would not even show: both runway counts are 0.
- **Fix direction:** Count island sweeps per emitted pass (or say "distinct sweeps"), and base
  "short" on the planner's runway need (v²/2a from the group feed and profile acceleration), with
  the source in the comment.

## KNOWN (re-encountered, not raised)

| Item | Prior report | State on `71ff820ce` |
|---|---|---|
| Review offers `$32=0` for a laser with laser mode off; the writer refuses it after the profile is saved | C4-P3-3 | open |
| The store writer has no common-only allowlist (Setup's `writeRisk === 'common'` filter is the only one) | C4-P3-5 | open |
| S30 evidence note claims homing/hard limits on; Sculpfun says homing usually off | C7-P3-2 | open (P3-3 above uses the note only as the code's own claim) |
| The interactive patch clears the whole scan-offset table at the first bed/controller edit | D8 (Known list) | by design |
| Auto-fill swaps an operator-chosen FluidNC for GRBL when the banner reads as GRBL | D6-P3-5 | open |
| Laser finish position is not range-checked on import | rolling-v2 03-P3-6 | open |

## Refuted

None by the refuter: all six findings reproduced or were confirmed on two lines of evidence. The
refuter raised no new P1 or P2. None raised by the auditor. Checked and not raised:

- **Origin is never derived from `$23`.** LightBurn also has the operator choose it; KerfDesk's
  native-bed frame refuses to infer bed position when travel ≠ bed (`native-bed-frame.ts:31-39`).
- **Absolute stays selectable on a no-homing profile.** Matches LightBurn; ordinary Start requires a
  completed Frame (ADR-565), and the no-homing default is User Origin, which refuses to start without
  an origin.
- **Controller-guide read lists are hard-coded strings** (the test restates them). They are the exact
  commands Read again sends (`use-find-machine.ts:306-326`), so the copy and the behaviour agree.

## Verified clean

- **What setup writes.** Only Save writes, in this order: project, localStorage, then queued
  `$30`/`$31`/`$32` rows. Each row needs the backup attestation, a typed per-row confirm and Idle
  with no job/motion/operation at queue time; the write gate re-checks Idle, a this-session `$$`,
  and the machine-kind rule at Save. Any draft edit, re-detect or controller change clears the queue
  (`invalidateFirmwarePlan`). `$130`/`$131` are review-only. FluidNC, Marlin, Smoothieware, Falcon and
  Ruida never write (`writePolicy`). Cancel/Escape/Discard send nothing and change nothing; close is
  blocked while Save runs, and each controller command times out (8 s default).
- **Half-written state.** A failed row stops the sequence; earlier rows stay written (no rollback) and
  the toast says "Software setup was saved, but firmware sync stopped". The profile is never half
  saved: one `set`.
- **Restart.** `canonicalProfile` carries every `DeviceProfile` field (checked field by field against the type); the record is
  re-validated on read (`'restore'` keeps scan status); the store subscription and Save both persist
  it; the mode is stored with it. Desktop is single-instance (`requestSingleInstanceLock`); web tabs
  share localStorage with last-writer-wins and keep separate drafts.
- **Banner.** Shows only on the exact starter, hides when the starter was set up for either head,
  offers the last machine, yields the corner to the G-code bar and jig panel (ADR-500 rules 1-4).
- **No-homing guide.** Release (`$SLP`) → wake (reset) → Unlock → Set origin last matches GRBL:
  `protocol.c:49-54` re-initialises sleep as ALARM, so the Unlock step is required, and Set origin
  comes after the reset that clears G92. Busy, streaming and `$62=0` disable it.
- **Controller guide.** Smoothieware text matches `Block.h` (1.11 fixed point) and `Laser.cpp` keys
  and default; the `$23` note is right for GRBL and grblHAL; Falcon is external-config with
  `$HX`/`$HY`.
- **Bed mismatch.** At job time the profile bed wins; Job Review warns when `$130`/`$131` differ
  (except after P2-1 has made them equal).
- **Twin: Summary / Review / project.** Summary and Review read the draft; Save stores
  `machineSetupProfile(state)`; the store only adds frozen CNC feeds equal to what Review shows
  (`cncMaxFeedMmPerMin`).
- **Raster diagnostics** in setup compile with the draft device, not the saved one.

## Not verified

- No hardware and no browser run; all repros are reducer/store level.
- Real `$130`/`$131` defaults of the xTool D1 Pro and Ortur LM3 were not sourced; P2-1 rests on the
  S30 (the code's own note plus forum reports, not a Sculpfun document).
- Whether LightBurn pre-fills its work area from `$130`/`$131` on GRBL detection: its Find My Laser
  page only says to confirm the dimensions.
- Other live-profile effects of a mid-job Save (air command, finish position, Frame speed during a
  laser pause) were not traced; laser recovery uses the job's own capsule, so it is unaffected.
- FluidNC `$CD` output handling during Read again was not exercised.

```json
[
  {"id":"E2-P2-1","severity":"P2","area":"ctl-machine-setup-flow","file":"src/ui/laser/device-setup/device-setup-auto-fill.ts","line":108,"anchor":"Contract ADR-420 rule 8 ($130/$131 are travel, not bed), ADR-240 #2; Twin brand-laser-profiles.ts:111-117 S30 note (firmware 400/410 drives X into the frame), preset-corrections.ts:42, job-review-live-rows.ts:425; Ground truth GRBL v1.1 wiki $130, LightBurn forum t/88769","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Choosing a listed machine then connecting (or any later settings read) fills the bed from $130/$131: Sculpfun S30 380x385 becomes 400x410, the S30 row stays chosen, no preset correction fires and Job Review's travel check then matches, so a job can run past real travel"},
  {"id":"E2-P2-2","severity":"P2","area":"ctl-machine-setup-flow","file":"src/ui/laser/device-setup/use-machine-setup-save.ts","line":37,"anchor":"Contract ADR-416 decision 1 (mode toggle locked while a job runs, tool-change jog lost safe-Z lift); Twin MachineModeToggle.tsx:26-35 vs machine-setup-actions.ts:62-138; laser-jog-actions.ts:368-388","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Machine Setup Save has no active-job check and switches the project CNC->Laser during a held CNC tool change (toolbar toggle refuses the same switch); point-move safe-Z lift keys on live mode"},
  {"id":"E2-P3-1","severity":"P3","area":"ctl-machine-setup-flow","file":"src/ui/laser/device-setup/DeviceSetupFoundMachine.tsx","line":56,"anchor":"Twin: card rows vs device-setup-auto-fill.ts actions; ADR-420 rule 5","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"After choosing a listed machine the 'Filled in from your controller' card lists catalog values as controller fills (Bed width 400 -> 430 for xTool D1 Pro 10 W while the controller reported 400)"},
  {"id":"E2-P3-2","severity":"P3","area":"ctl-machine-setup-flow","file":"src/ui/laser/device-setup/DeviceSetupConfirmStep.tsx","line":38,"anchor":"Ground truth GRBL system.c:179-180 ($H with $22=0 -> error:5), LightBurn Find My Laser auto-home guidance; Twin job-review-live-rows.ts:381 vs travelFact :425","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Setup turns Home on without reading $22/$23; doing so moves default Start from User Origin to Absolute; Review compares only $30/$31/$32/$130/$131 and Job Review shows $22 without comparing it to the profile"},
  {"id":"E2-P3-3","severity":"P3","area":"ctl-machine-setup-flow","file":"src/ui/laser/NoHomingPositionChoices.tsx","line":5,"anchor":"Twin: presets ship Home off while Falcon A1 Pro homes with $HX/$HY and the S30 note claims switches; Essentials treats off as not yet enabled","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"The rail card says 'No homing switches' for every Home-off profile, including listed machines that home"},
  {"id":"E2-P3-4","severity":"P3","area":"ctl-machine-setup-flow","file":"src/core/job/fill-heat-risk.ts","line":112,"anchor":"Twin: fillSweepCount counts passes (line 76), island counts do not; L2: 2x overscan threshold has no feed/accel term or source","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Fill heat-risk island short-sweep counts ignore passes (3 passes -> 1 short sweep, fillSweepCount 3) and 'short' is an unsourced 2x-overscan rule with no speed or acceleration term"}
]
```
