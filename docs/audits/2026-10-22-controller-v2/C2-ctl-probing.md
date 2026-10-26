# Controller audit v2 — C2 Probing (`ctl-probing`)

- **When:** 2026-10-22 08:26   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD `db59d99a9`;
  only audit docs differ from `99a2e64b7`)
- **Scope:**
  - Core builders: `src/core/controllers/grbl/probe.ts`, `corner-probe-geometry.ts`,
    `surface-grid-probe.ts`, `work-offset-readback.ts`.
  - Store: `src/ui/state/laser-probe-actions.ts`, `laser-probe-policy.ts`,
    `laser-probe-recovery.ts`, `probe-actions.ts`, `probe-failure-alarm.ts`,
    `laser-surface-probe-actions.ts`, `surface-probe-transaction.ts`, `work-z-recovery-actions.ts`,
    `work-z-zero-evidence.ts`.
  - UI: `src/ui/laser/ProbeControls.tsx`, `ProbePanel.tsx`, `CornerProbeGeometryFields.tsx`,
    `surface-probe/SurfaceProbeDialog.tsx`, `zero-z-guard.ts`, `use-zero-z-action.ts`.
  - Consumers followed: Frame WCS normalization (`frame-wcs-selection.ts`,
    `frame-controller-readiness.ts`, `use-frame-action.ts`, `frame-cnc-preparation.ts`), CNC Start
    and tool-change gates (`cnc-start-advisories.ts`, `laser-store-helpers.ts`).
  - Governing documents: ADR-103 G2, ADR-375 decision 1, ADR-571 (surface measurement), WORKFLOW
    F-CNC20, F-CNC-PROBE and the CNC tool-change flow, AGENTS.md (probing is hardware-sensitive).
- **Lenses run:** L1, L2, L3, L4, L6 and L7 as separate passes. L5 is light: probing has no
  untrusted input beyond controller replies (covered under L2/L6) and is not reachable from the
  phone remote or MCP (no `probe`/`measureSurfaceGrid` caller outside the PC UI).
- **Primary sources fetched this session:**
  - LinuxCNC G-code reference (G38.x, G10 L2/L20).
  - GRBL v1.1 interface wiki (`[PRB:]`, `$13`, ALARM 4/5).
  - gnea/grbl `bfb67f0` `motion_control.c` (`mc_probe_cycle`), `report.c`
    (`report_probe_parameters`), `gcode.c` (G10 L20, incremental targets, probe update),
    `protocol.c` (alarm handling).
  - grblHAL core `motion_control.c`, `report.c`, `config.h`.
  - FluidNC `MotionControl.cpp`, `Report.cpp`, `Logging.h/.cpp`.
- **Counts:** 5 raised → refuter: confirmed 5, plausible 0, refuted 0 → P1 1 / P2 1 / P3 3
  (+ 6 KNOWN re-observed). No severity changes. One P3-3 sub-claim (ADR-103 "retract 2 mm") was
  refuted; the finding stands on its other items.

## Headline

The probe G-code itself is right. A physical model (stock, flush corner plate, cylindrical end mill,
GRBL G90/G91/G10 L20/G92.1 semantics) ran the emitted Z and XYZ cycles for all four corners, five
hand-picked geometries with and without a G92, and 400 random valid geometries. Work zero landed on
the stock corner and top every time, and no rapid came within 0.5 mm of the plate or stock.

The two real problems are in how probe results join the rest of the machine state:

1. **P1:** during a CNC tool-change hold, the XYZ corner probe is still enabled. It rewrites the XY
   origin (`G92.1` + `G10 L20 P0 X Y Z`), and Continue then streams the rest of the job in the new
   XY frame. Set origin is disabled in the same hold.
2. **P2:** every probe selects G54 but never updates `store.activeWcs`. When the store knew a
   G55–G59, the next Frame "re-selects" G54, discards the fresh probe Work-Z evidence, and prompts
   for Zero Z while the bit is parked 20 mm above the stock.

## Probe flow map

| Flow | Entry | Lines sent | Result used by |
|---|---|---|---|
| Z touch plate | ProbeControls → `probe({kind:'z'})` | `M5 M9 G54 G21 G94 G91 G38.2 Z-25 F150, G0 Z2, G38.2 Z-3 F25, G10 L20 P0 Z<t>, G0 Z5, G90`, settle dwell, 2 fresh Idle | `workZZeroEvidence` (source `probe`, tool id, plate not removed) → CNC Frame/Start/tool-change gates |
| XYZ corner | same, `kind:'corner'` | Z contact, `G0 Z5`, X leg and Y leg (clear sideways, drop to flank, two-stage G38.2, retreat 4, lift), `G90`, `G92.1`, one `G10 L20 P0 X Y Z`, park | the above, plus `workOriginSource='g54-persistent'`, `workOriginVersion+1`, Frame evidence voided |
| Surface grid | Super console → SurfaceProbeDialog → `measureSurfaceGrid` | `$G $# $G`, tool-off, `G21 G90 G94`, per point `G90 G1 Z<clear>`, `G90 G1 X Y`, `G91 G38.2 Z-<max>`, `G90 G1 Z<fast+2>`, `G90 G38.2 Z<fast-1>`, `G90 G1 Z<clear>`, settle, fresh Idle+WCO, `$G` | review table and CSV only; no compensation, no offset write (ADR-571) |
| Work-Z recovery | WorkZRecoveryControl | `$G $# $G` | `workZZeroEvidence` source `controller-readback` |
| Zero Z guard | JogPad Zero Z | `G54 G92 Z0` after `zeroZOverwriteWarning` | replaces evidence with `manual-zero` |

No height-map compensation exists, so question 4's interpolation part does not apply
(ADR-571: "does not ... compensate toolpaths").

## Findings

### P1-1 — The XYZ corner probe runs inside a tool-change hold and moves the XY origin of the job being continued

- **Where:**
  - `src/ui/state/laser-probe-policy.ts:115` (`setupBlockingJobCommandBlockMessage` returns null in
    a drained hold, `laser-store-helpers.ts:95-98`).
  - `src/ui/state/laser-store-helpers.ts:121` (`toolChangeContinueBlockMessage` checks Z evidence,
    plate removal and tool id, but not the XY origin or `workOriginVersion`).
  - `src/ui/laser/ProbeControls.tsx:156` (Run is enabled whenever connected, Idle and not busy).
  - `src/ui/laser/LaserWindow.tsx:140` (ProbePanel is in the Origin tools at all times).
- **Anchor:**
  - Twin: `OriginRow.tsx:145` disables Set origin while a job, tool-change hold included, is active
    (`jobControlsBusy` → `jobNeedsRecovery` includes `'tool-change'`). The corner probe is the
    other XY-origin writer, and it stays enabled.
  - Contract: the WORKFLOW CNC tool-change flow lets the operator re-zero **Z** only ("jogs Z to
    touch the stock top, zeros Z (or probes), and resumes").
  - Contract: ADR-375 decision 1 and `laser-probe-actions.ts:121-123` say nothing bound to the old
    XY origin outlives a corner cycle. The held job is bound to it and outlives it.
- **Scenario:**
  1. An operator sets the XY origin (corner probe or Set origin here) and starts a two-bit CNC job.
  2. At the M0 tool-change hold they open Origin → Probe (touch plate) to touch off the new bit.
     The form still shows "XYZ corner" from the morning setup (the draft lasts for the whole
     document and controller session).
  3. They rest the plate on the stock under the bit and press Run probe.
  4. The cycle side-probes the plate wherever it lies and commits `G92.1` +
     `G10 L20 P0 X.. Y.. Z..`.
  5. Continue then unlocks, and the second bit's sections cut displaced by the distance between the
     plate and the original origin. A G92 origin is also dropped. No warning appears.
- **Evidence:** REPRO. A temporary Vitest using the harness of
  `laser-tool-change-probe-alarm.test.ts` reached a drained hold, then switched the stub to auto-`ok`:
  - `probe(corner)` returned `{"kind":"ok"}`.
  - The probe wrote `["G92.1\n","G10 L20 P0 X15.000 Y-5.588 Z20.000\n"]`.
  - The streamer stayed `tool-change`.
  - The origin went from `none` (version 0) to `g54-persistent` (version 1).
  - After plate-removal confirmation (with the evidence's tool id set to the pending bit),
    `toolChangeContinueBlockMessage` returned `null`.
  - `continueToolChange()` set the streamer to `streaming` and sent
    `"G0 Z5\nM3 S12000\nG1 X6 Y6 F800\n"`, the rest of the job in the new frame.
  - The UI path (dropdown never disabled, ProbeControls readiness) is READ.
- **Refuter:** CONFIRMED, severity P1 kept (2026-10-22).
  - Repro: an independent temporary Vitest drove the real store.
    - `connect`, then `startJob` (two-bit CNC job), then ack to M0, then fresh Idle.
      `setupBlockingJobCommandBlockMessage` was `null` in the hold.
    - `probe({kind:'corner', d=3.176})` returned `ok` and wrote `G54`, `G92.1`,
      `G10 L20 P0 X15.000 Y-5.588 Z20.000`. The streamer stayed `tool-change`. The origin went
      from `none` v0 to `g54-persistent` v1.
    - After `confirmProbePlateRemoved()`, `toolChangeContinueBlockMessage` was `null`.
    - `continueToolChange()` sent `G0 Z5\nM3 S12000\nG1 X6 Y6 F800\n` with status `streaming`.
  - Refutation attempts failed:
    - No store guard refuses a corner request in a hold. `probeRequestBlockReason` checks shape
      and geometry only.
    - `safeWrite` gates only `$` payloads (`laser-safe-write.ts:83`).
    - `runContinueToolChange` (`laser-job-actions.ts:341`) checks nothing beyond
      `toolChangeContinueBlockMessage`.
  - UI reachability (read): `ProbeControls.probeControlReadiness` (`:144-163`) never reads the
    streamer. ProbePanel sits in the Origin dropdown, whose triggers are never disabled
    (`MachineToolsDropdowns.tsx`). The XYZ mode persists for the document and controller
    session (`probeFormContextKey`).
  - Intent: corner probing in a hold is not intended.
    - F-CNC15 Success 1 says the operator "zeros Z (or probes)".
    - The hold banner (`JobRunControls.tsx:22`) says "re-zero Z on the stock top (jog, then Zero
      Z)".
    - The M0 comment says "re-zero Z on the stock top".
    - No ADR allows an XY change mid-job.
  - Nuance: the Set origin twin is gated only in the UI. The store's `setOriginHere` goes through
    `assertNoActiveJob`, which uses the same setup gate, so it is also allowed in a drained hold
    (`laser-store-helpers.ts:268`). Only `OriginRow` `streaming={setupBusy}` disables the
    button. The fix should gate both XY writers in the store, not only the probe.
  - Nuance: re-probing the *same* corner reproduces the origin to within probe repeatability. A
    confirm that names the XY shift, or the `workOriginVersion` backstop on Continue, would
    keep that use.
  - P1 holds. The output is silently wrong: the remaining sections cut in a shifted XY frame
    with no warning (METHOD §3).
- **Fix direction:** While a job is held, refuse a corner request in `probeRequestBlockReason` or
  `probeStateBlockReason`, and offer only the Z cycle in ProbeControls. As a backstop, Continue
  could refuse when `workOriginVersion` moved since the job started.

### P2-1 — Probes select G54 without updating `activeWcs`, so the next Frame discards the fresh probe Work-Z and asks for Zero Z at the parked height

- **Where:**
  - `src/core/controllers/grbl/probe.ts:104` and `:179` (`'G54'` first line of both cycles).
  - `src/ui/state/laser-probe-actions.ts:109-162` (reserve/complete never touch `activeWcs`).
  - `src/ui/state/frame-wcs-selection.ts:95-114` (`frameWcsSelectionPatch` sets
    `workZZeroEvidence: null` and bumps `workZReferenceEpoch` whenever the stored WCS was not G54).
  - `src/ui/laser/use-frame-action.ts:174` then `:185` (WCS normalization runs before the CNC
    Work-Z check).
  - `src/ui/laser/frame-cnc-preparation.ts:28-38` (OK runs `zeroZHere()` with no overwrite
    guard).
- **Anchor:**
  - Twin: `store.activeWcs` (fed by `$G` readback and Console WCS words) against the controller's
    real modal WCS after the probe's own `G54`.
  - Contract: `frame-wcs-selection.ts` header says "G54 is written only when another is active".
  - Contract: the Frame warning (`frame-controller-readiness.ts:121`) states
    "Controller was using G55".
  - Contract: WORKFLOW F-CNC-PROBE step 6 says a settled probe is the Work-Z evidence that Frame and
    Start consume.
- **Scenario:**
  1. A controller whose `$N` startup block selects G55 is read at connect (`activeWcs='G55'`), or
     the operator typed `G55` in the Console.
  2. They run a Z probe. The controller is now in G54, the bit is parked at work Z +20, and the
     store still says G55.
  3. They press Frame. KerfDesk "selects" G54 and warns that the controller was using G55, which
     is false since the probe.
  4. Frame voids the probe evidence and asks: "If the bit is touching the stock-top Z reference now,
     choose OK to set Work Z zero".
  5. OK zeroes 20 mm above the stock (an air cut). Cancel means probing again.
  6. Job Review also shows "Active WCS G55 (warning)" between the probe and the Frame.
  7. Zero Z and Set origin (`G54 G92 …`, `laser-origin-actions.ts:95,153`) have the same staleness.
     Their consequence is milder because the bit is at the reference.
- **Evidence:** REPRO. A temporary Vitest on the GRBL simulator (harness of
  `corner-probe-g92.simulator.test.ts`) ran:
  - `sendConsoleCommand('G55')` → `activeWcs: G55`.
  - `probe(Z)` → `{"kind":"ok"}`. The wire carried `"G54\n"` before `G38.2`, and after the probe
    the store still held `activeWcs: G55` with evidence
    `{"source":"probe","referenceEpoch":4,"probePlateRemoved":false}`.
  - `selectPrimaryWcsForFrame()` → `{"kind":"selected","previous":"G55"}`, evidence `null`,
    `workZReferenceEpoch` 5, log `"Frame selected G54 (was G55)"`.
- **Refuter:** CONFIRMED, severity P2 kept (2026-10-22).
  - Repro: an independent temporary GRBL-simulator Vitest gave the same sequence.
    - `activeWcs` was `G54` at connect, and `G55` after `sendConsoleCommand('G55')`.
    - `probe(Z)` returned `ok`. The wire carried `G54` before `G38.2`. `activeWcs` stayed `G55`
      and the evidence was `{"source":"probe","referenceEpoch":4}`.
    - `selectPrimaryWcsForFrame()` returned `{"kind":"selected","previous":"G55"}`, with evidence
      `null`, epoch 5, and log "Frame selected G54 (was G55)".
  - Limitation: the simulator models only G54 (its `$G` always answers G54). The controller-side
    fact therefore comes from the primary source.
  - Primary source: gnea/grbl `bfb67f0` `gcode.c` executes a G5x word as
    `gc_state.modal.coord_select = gc_block.modal.coord_select`, a persistent modal change.
    G10 L20 maps P0 to `gc_block.modal.coord_select` ("Index P0 as the active coordinate
    system"). LinuxCNC's G10 L2 table also lists P0 as "Active".
  - So after the probe's standalone `G54` line, the controller really is in G54, and its
    `G10 L20 P0` wrote G54.
  - No path between the probe and Frame re-reads `$G`. `readUnknownActiveWcs` runs only when
    `activeWcs` is `null`, and the probe never nulls it.
  - Consequences (both confirmed):
    - The false "Controller was using G55" warning.
    - The voided probe evidence, which forces a re-probe.
  - The air-cut path needs the operator to press OK against the dialog's own condition ("If the
    bit is touching the stock-top Z reference now"). P2 rather than P1 is right.
- **Fix direction:** Record `activeWcs: 'G54'` when the probe's (and the origin actions') `G54`
  line is acknowledged, or run `$G` once at settlement.

### P3-1 — Surface-grid XY travel is not checked against the machine envelope KerfDesk already knows

- **Where:**
  - `src/core/controllers/grbl/surface-grid-probe.ts:53-62` (only |coord| ≤ 100 000 and
    0.001 mm precision).
  - `src/ui/state/laser-surface-probe-actions.ts:136-139` (`G90 G1 Z…` / `G90 G1 X Y` at the travel
    feed).
- **Anchor:** Twin. `manual-motion-limits.ts:27-43` bounds hold-jog and Move laser here to the
  verified bed frame or the enforced firmware envelope (ADR-375). Rolling-v2 12-P2-3 is the same
  missing clamp on a different path (head-camera Capture).
- **Scenario:**
  1. A machine has `$20=0` (common without homing) and a verified bed frame.
  2. The operator types a grid that extends past the bed, for example min/max work X 0–400 on a
     300 mm machine.
  3. The grid's G1 XY move drives into the frame at the travel feed and loses steps.
  4. With soft limits on, GRBL raises ALARM:2 instead, which is safe.
- **Evidence:** READ. No envelope reference exists in `laser-surface-probe-actions.ts`,
  `surface-probe-transaction.ts` or `SurfaceProbeDialog.tsx`.
- **Refuter:** CONFIRMED, P3 (2026-10-22).
  - `validateSurfaceGrid` (`surface-grid-probe.ts:48-70`) bounds only |coord| ≤ 100 000, the
    precision and the grid counts.
  - `resolveManualMotionLimits` has only two callers: `JogPad.tsx` and
    `position-laser-click.ts`.
  - ADR-571 sets no envelope requirement, so this is twin drift, not a broken contract.
  - Note for the fix: typed head moves (`head-move-dispatch.ts:5-6`, ADR-232) *warn* on
    configured bounds and let the controller limits decide. A warning, not a refusal, may be the
    consistent fix.
- **Fix direction:** Before motion, convert the four grid corners to machine XY with the captured
  WCO and refuse when `resolveManualMotionLimits` returns bounds that do not contain them.

### P3-2 — No test proves where the corner or Z probe puts work zero; the tests restate the emitted strings

- **Where:** `src/core/controllers/grbl/probe.test.ts:54-157`;
  `corner-probe-geometry.test.ts:115` (inequalities only).
- **Anchor:** METHOD L7. ADR-103 G2 marks the plate model PROVISIONAL. The 2026-09-25 GP audit
  verified the corner arithmetic by hand only (`GP-partial.md:113`).
- **Scenario:** A future edit swaps a sign in `cornerSigns`, in `yAfterRetreat`, or in the
  `G0 X` re-centre. The snapshot tests are updated to match, and every corner zeroes one bit
  diameter off without any test failing.
- **Evidence:** REPRO (of the gap). A temporary physical-model Vitest showed today's code is right:
  - 4 corners × 5 geometries passed, including G92 = (25, 15, 3) and a 12.7 mm bit at the minimum
    offsets.
  - A front-right trace contacted the plate face at X = corner + r (126.575 = 123.4 + 3.175).
  - The Z cycle left the stock top at work Z 0 with a G92 Z of 0, 3.5 and −2.
  - 400 random valid geometries all landed within 1e-6 mm.
  - No such test exists in the repository.
- **Refuter:** CONFIRMED, P3 (2026-10-22).
  - Every test that calls `buildZProbeLines`/`buildCornerProbeLines` (`probe.test.ts`,
    `laser-corner-probe-atomic`, `laser-probe-actions`, `laser-probe-lifecycle`,
    `probe-start-gate-repro`) asserts strings or store state.
  - The GRBL simulator runs G38.2 as a plain move with no plate model; it simulates only the
    failure alarm (`grbl-sim-lines.ts:270-293`).
  - `corner-probe-geometry.test.ts:115` checks the inequalities only.
- **Fix direction:** Add a small physical-twin test that interprets `buildCornerProbeLines` and
  `buildZProbeLines` against a plate, stock and cutter model and asserts the stock corner is
  work (0, 0, 0).

### P3-3 — WORKFLOW probe flows disagree with the code and with each other

- **Where:** `WORKFLOW.md:9052-9053`, `:6299`, `:9104-9106`; `DECISIONS.md` ADR-103 G2.
- **Anchor:** Contract (doc/code drift).
- **Scenario:**
  - F-CNC-PROBE step 2 says the operator "enters positive, finite plate, feed, travel, retract".
    The UI exposes only plate thickness, max travel and corner geometry. Feeds and retract are the
    fixed `DEFAULT_Z_PROBE_PARAMS` (`probe-form-store.ts:48`).
  - F-CNC20 Error 3 says on `error:N` "nothing further is sent". The code (and F-CNC-PROBE
    Error 2) sends a soft reset and waits for the reboot banner
    (`laser-probe-recovery.ts:33-60,116-134`).
  - F-CNC-PROBE "controller-session coordinate truth" item 2 says production XYZ probing "requires
    an owned complete build/settings exchange and a fresh direct MPos ... before any probe motion
    is permitted". `probePreflight` (`laser-probe-policy.ts:36-45,114-154`) checks neither.
  - ADR-103 G2 lists "retract 2 mm" and a "30 s watchdog". The code retracts 5 mm and times out
    after 45 s of status silence.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, P3, with one sub-claim refuted (2026-10-22).
  - Confirmed:
    - Step 2 is wrong: ProbeControls exposes only Plate thickness, Max travel and the corner
      geometry.
    - F-CNC20 Error 3 (`WORKFLOW.md:6299`) is wrong: a non-alarm failure goes to
      `recoverUncertainProbe`, which writes the soft reset (`laser-probe-recovery.ts:116-134`).
    - The watchdog values differ: ADR-103 G2 says 30 s; `PROBE_LINE_TIMEOUT_MS` is 45 000.
  - Refuted: "ADR-103 lists retract 2 mm; the code retracts 5 mm". ADR-103 G2 uses "retract"
    for the move between the two stages ("fast seek, retract, slow re-probe"). That back-off is
    `BACKOFF_MM` = 2 (`G0 Z2.000`) and matches. The 5 mm `retractMm` is the final lift, which
    the ADR does not list.
  - Wording: coordinate-truth item 2 says "still requires". It can be read as a stated open
    prerequisite rather than a claimed gate. Either way `probePreflight` checks neither, so
    the reword in the fix direction is right.
- **Fix direction:** Fix F-CNC20 Error 3 and F-CNC-PROBE step 2 to match the code. Either
  enforce the settings/MPos precondition or reword item 2 as a known gap.

## KNOWN (re-observed, not raised)

| Item | Prior report | State on `99a2e64b7` |
|---|---|---|
| A probe ALARM:4/5 leaves the parser in `G91`. This covers the Z and corner cycles (`zContactLines` sends `G91` before the first G38.2) and the surface grid's `G91 G38.2`. The surface dialog says the cycle "ends in ... absolute positioning", which is true only on success. App motion restates the mode (`$J=G90/G91`, program preambles, post-M0 restate), so only operator Console/macro lines are exposed. | 2026-07-13 setup-probing audit §6.4; `tool-change-probe-alarm.ts` comment | open (only the tool-change path is covered) |
| The corner plate model has no lip/wall XY offset. Many commercial plates hook over the stock edge. | 2026-07-13 setup-probing §4, §6.7 | open; the UI hint says "flush" |
| The Z/corner cycles ignore `[PRB]` and do not read back `$#` after `G10 L20`. They zero at the stopped position (GRBL `gc_sync_position` after `mc_probe_cycle`), which differs from PRB by the deceleration overshoot (about 0.002–0.009 mm at 25 mm/min). | 2026-07-13 §6.4–6.5 | open by design; error negligible at the slow feed |
| grblHAL, FluidNC and Falcon inherit `probing: true`. | 2026-07-13 §6.6; 2026-09-25 CG `:664,681` | open |
| Phone Zero Z skips the overwrite guard. | rolling-v2 01-P2-1 | PR #1347 open |
| Spindle coast-down is not proven before contact. | WORKFLOW F-CNC-PROBE ("does not prove ... spindle coast-down") | accepted limitation |

## Refuted

The refuter (2026-10-22) refuted no raised finding. One sub-claim was refuted and stays recorded so
it is not raised again:

- C2-P3-3 sub-claim "ADR-103 G2 says retract 2 mm but the code retracts 5 mm". ADR-103's "retract"
  is the back-off between the two stages, which is `BACKOFF_MM` = 2 (`G0 Z2.000`) in
  `zContactLines`. The 5 mm `retractMm` is the final lift, which the ADR does not specify.

These candidates were dropped by the auditor before raising:

- `G10 L20 P0 Z…` sent while `G91` is modal. GRBL computes L20 from raw axis words; the
  distance-mode branch is only in the `default` motion case (`gcode.c` 545-552 vs 581-600).
  LinuxCNC says "G91 has no effect on G10 L2".
- An Alarm *status* mid-cycle when the `ALARM:N` line is lost. `laser-status-line.ts:364` cancels
  the lifecycle refs on entering Alarm, so the command rejects. GRBL also answers later G-code with
  `error:9`.
- grblHAL may not emit `[PRB]`. `DEFAULT_REPORT_PROBE_COORDINATES On`, and when it is off the grid
  fails closed ("Expected exactly one contact report").
- Work-Z recovery evidence for G55 surviving into a G54 job. Frame's G54 selection voids it
  (`frame-wcs-selection.ts:111-112`).

## Verified clean

- **G38.x choice and direction:** G38.2 (error on no contact) everywhere. Z seeks are negative,
  side legs point toward the plate for each corner, max travel is ≤ 100 mm, the slow re-touch is
  backoff 2 + 1 mm, and probe feed < seek feed is enforced in both builders and the store.
- **G38 completion:** GRBL, grblHAL and FluidNC all block in `mc_probe_cycle`
  (`protocol_buffer_synchronize` + wait for Idle), so a probe line's `ok` means the move ended.
  Failure order is `ALARM:5`, `[PRB:…:0]`, then `ok`. The arbiter rejects on the ALARM line, and the
  stray `ok` is harmless (2026-09-25 GP).
- **PRB parsing (surface grid):**
  - It needs exactly one `[PRB:…:1]` on the owned line, and rejects `:0`, duplicates and malformed
    input.
  - It allows 3–9 axes (grblHAL/FluidNC extra axes).
  - It scales by `$13` (`printFloat_CoordValue` / `get_axis_values_imperial`).
  - The grblHAL diameter-mode X doubling is excluded by rejecting G7.
  - FluidNC `log_stream` adds the closing `]`.
- **Offset maths:**
  - Z: `G10 L20 P0 Z<t>` after `G54` makes the stock top Z0, with or without a G92 Z.
  - Corner: `G92.1` then one combined `G10 L20 P0 X(sx·off) Y(−sy·(r+4)) Z(t+5)`. Correct for all
    four corners (physical-model REPRO, see P3-2).
  - No partial WCS write on any failed leg.
- **Corner static geometry:** the validator's inequalities (centre offset ≥ r+1, clearance ≥
  max offset + r + 1, flank ≥ 1 mm above the stock, park ≥ r+1) kept every rapid ≥ 0.5 mm clear in
  400 random geometries.
- **Settlement and failure:**
  - Success needs every line `ok`, the dwell, and 2 fresh Idle reports.
  - ALARM:4/5 keeps the origin and position (ADR-375). Toasts name the alarm.
  - A non-alarm failure sends a soft reset and stays locked until banner + Idle.
  - A disconnect raises the physical-stop notice.
- **Surface grid:**
  - Serpentine order with exact endpoints. Every XY move is at the captured clearance Z.
  - The fast contact must lie inside [clearance − max, clearance].
  - The retouch plan stays inside the envelope at 0.001 mm.
  - WCO, units, WCS, origin version and session are re-checked at every line. Z must return to
    clearance (±0.02).
  - No offset writes. No compensation is applied, as ADR-571 says.
- **Zero Z guard:** warns at |work Z| > 0.5 mm above or below a current zero. It names a
  probe-established zero, and asks for confirmation when the height is unknown. Frame's own
  Zero Z runs only when no evidence exists.
- **Work-offset readback:** exactly one `[GC:]` with one G54–G59 word is required, and G59.1 fails
  closed. `$#` gets ≥ 3 finite axes with the grblHAL rotation suffix, and inches are converted.

## Not verified

- No hardware run: plate wiring, real overshoot, spindle coast-down, and grblHAL/FluidNC reply
  timing on a probe failure.
- The Device-Setup wizard host of ProbeControls was not exercised.
- FluidNC's `G38.6–G38.9` / single-axis `P` forms are not emitted, so they were not audited.
- Surface grid on grblHAL with `$10` probe-coordinate reporting off: read only (fails closed).
- The UI reachability in P1-1 is from reading `LaserWindow.tsx`, `JobControls.tsx`,
  `MachineToolsDropdowns.tsx` and `ProbeControls.tsx`, not from a browser run.

```json
[
  {"id":"C2-P1-1","severity":"P1","area":"ctl-probing","file":"src/ui/state/laser-probe-policy.ts","line":115,"anchor":"Twin: OriginRow.tsx:145 disables Set origin during a tool-change hold; Contract: WORKFLOW tool-change flow re-zeroes Z only; ADR-375 decision 1 corner cycle voids what is bound to the old XY origin","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED: independent store repro (corner probe ok in drained hold; origin none v0 to g54-persistent v1; Continue streams G1 X6 Y6). Store Set origin is also allowed in the hold (UI-only gate).","known":false,"summary":"XYZ corner probe is allowed in a drained tool-change hold, rewrites the XY origin (G92.1 + G10 L20 X Y Z), and Continue resumes the held job in the new XY frame"},
  {"id":"C2-P2-1","severity":"P2","area":"ctl-probing","file":"src/ui/state/laser-probe-actions.ts","line":148,"anchor":"Twin: store.activeWcs vs the controller modal WCS after the probe's own G54 (probe.ts:104,179); Contract: frame-wcs-selection.ts header and Frame warning text; WORKFLOW F-CNC-PROBE step 6","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED: simulator repro (activeWcs stays G55 after the probe G54; Frame voids probe evidence) plus gnea/grbl gcode.c (G5x is modal; G10 P0 = active WCS).","known":false,"summary":"Probe selects G54 but leaves a stale G55-G59 activeWcs; the next Frame voids the fresh probe Work-Z, falsely says the controller was using G55, and prompts Zero Z at the parked height"},
  {"id":"C2-P3-1","severity":"P3","area":"ctl-probing","file":"src/ui/state/laser-surface-probe-actions.ts","line":138,"anchor":"Twin: manual-motion-limits.ts:27-43 (ADR-375 clamp for hold-jog and Move laser here); sibling of rolling-v2 12-P2-3","evidence":"READ","verdict":"CONFIRMED","refuter":"CONFIRMED by code read; ADR-232 head moves warn rather than clamp.","known":false,"summary":"Surface-grid G1 XY moves are not checked against the verified bed frame or enforced firmware envelope"},
  {"id":"C2-P3-2","severity":"P3","area":"ctl-probing","file":"src/core/controllers/grbl/probe.test.ts","line":54,"anchor":"METHOD L7; ADR-103 G2 PROVISIONAL plate model","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED: no plate model in the tests or the simulator.","known":false,"summary":"Corner/Z probe tests restate emitted strings; no physical-model test proves work zero lands on the stock corner (a temporary one passed 4x5 + 400 random geometries)"},
  {"id":"C2-P3-3","severity":"P3","area":"ctl-probing","file":"WORKFLOW.md","line":9052,"anchor":"Contract: WORKFLOW F-CNC20 Error 3, F-CNC-PROBE step 2 and coordinate-truth item 2; ADR-103 G2 defaults","evidence":"READ","verdict":"CONFIRMED","refuter":"CONFIRMED; the ADR-103 retract-2-mm sub-claim is refuted (it is the inter-stage back-off).","known":false,"summary":"WORKFLOW claims editable probe feeds/retract, 'nothing further is sent' on error:N, and a settings/MPos precondition that the code does not have; ADR-103 retract/watchdog values differ"}
]
```
