# Controller audit v4 — E3 CNC routines (`ctl-cnc-routines`)

- **When:** 2026-10-22 23:05–23:55   **Tree:** origin/main @ `71ff820ce` (worktree `src/` identical
  to `71ff820ce`; the worktree HEAD only adds audit documents). `origin/main` moved to `76b994dd0`
  during the audit. On that tree the finding sites are unchanged: `surfacing.ts:196`,
  `tile-plan.ts:213` and the review's M0 warning are byte-identical, and `external-run.ts` still sends
  `toolChangePause: false` (now at line 253).
- **Scope:**
  - Surfacing: `src/core/cnc/surfacing.ts`, `src/ui/machine/{save-surfacing-program,surfacing-seed,surfacing-save-write,use-surfacing-save,surfacing-worker-runtime}.ts`,
    `SurfacingPanel.tsx`, `SurfacingFields.tsx`, `src/core/preflight/standalone-cnc-preflight.ts`.
  - Tool change: `src/core/output/tool-change-labels.ts`, `src/core/output/cnc-grbl-{transitions,strategy}.ts`
    (bit-change block), `src/ui/state/tool-change-hold-entry.ts`, `tool-change-probe-alarm.ts`, the
    streamer's M0 hold (`src/core/controllers/grbl/streamer.ts`), the Continue gate
    (`laser-store-helpers.ts`), the tool queue (`laser-job-actions.ts`).
  - Tiling: `src/ui/machine/CncTilingDisclosure.tsx`, `src/core/cnc/{effective-cnc-tile-grid,plan-tiles,tile-plan,tile-registration,tile-registration-plan,tile-registration-passes}.ts`,
    `src/ui/app/{save-tiled-gcode,tile-emission,tiled-output-preparation}.ts`,
    `src/ui/laser/device-setup/{DeviceSetupCncTilingFields,DeviceSetupRegistrationFields}.tsx`.
  - Read for twins: `src/core/cnc/depth-passes.ts`, `src/core/job/job-origin.ts` (`placeCncParks`),
    `src/io/gcode/prepare-output.ts` (`bedToProgramTranslation`), `src/ui/job-placement.ts`,
    `src/ui/app/file-actions.ts`, `src/ui/gcode-inspector/external-run.ts`,
    `src/core/external-program/external-program-review.ts`, `src/core/job/toolpath-cnc.ts`,
    `src/ui/commands/multi-file-trace-action.ts`, `src/platform/web/web-adapter.ts`,
    `src/ui/laser/cnc-z-travel-warnings.ts`.
- **Governing:** ADR-103 G8 / WORKFLOW F-CNC25 (surfacing), ADR-316 clause 6 and ADR-656 (surfacing
  save), ADR-457 Amd 1 (surfacing starters), ADR-416 (CNC's own Max feed), ADR-209 (spin-up),
  WORKFLOW F-CNC14 / F-CNC15 (M0 bit change, Continue gate), ADR-375 Amd 3 (no XY origin writes in
  the hold), ADR-310 (clearing before profiles), WORKFLOW F-CNC19 (tiling), ADR-392 and Amd 1 (CNC
  park is a bed position), ADR-491 (park height), ADR-399 (CNC output is GRBL-only), ADR-630 (Run
  G-code file), PROJECT.md non-negotiables 1 (bounds), 9 (abort) and 21 (Frame-first, warnings not
  blocks).
- **Primary sources fetched:**
  - gnea/grbl master `gcode.c`: M-code switch accepts 0, 1, 2, 30, 3, 4, 5, 7, 8, 9 (56 optional);
    every other M, including M6, fails `STATUS_GCODE_UNSUPPORTED_COMMAND` (error:20). T is parsed and
    tracked only. The M0 block: "can only be resumed by the cycle start run-time command", then
    `system_set_exec_state_flag(EXEC_FEED_HOLD)` and `protocol_execute_realtime(); // Execute suspend.`
  - gnea/grbl master `protocol.c`: `protocol_execute_realtime()` calls `protocol_exec_rt_suspend()`
    while `sys.suspend` is set, and that routine loops `while (sys.suspend) {`, so the main loop reads
    no further line (no `$J=`, no `G10`) until cycle start or reset. The cycle-start block guards
    against auto-cycle-start resuming a hold "without an explicit user-input".
  - GRBL v1.1 Jogging wiki: "A jog command will only be accepted when Grbl is in either the 'Idle'
    or 'Jog' states."
  - grblHAL core wiki "Manual, semi-automatic and automatic tool change": `$341` modes 0–4 for M6
    (0 = program must handle spindle/coolant/position itself; 1–3 move and touch off; 4 ignores M6).
    The page says nothing about M0 or jogging during the hold.
  - Sienci gSender `src/app/src/features/Surfacing/utils/surfacingGcodeGenerator.js` (via `gh api`):
    the zig-zag/spiral perimeter runs the bit centre over `0..x`, `0..y` (same convention as
    KerfDesk), stepover is clamped to 80 %, the entry ramps into the material, and M3 is issued before
    the Z lift.
  - Fusion 360 / Vectric / Carbide Create surfacing and tool-change posts were not fetched (see Not
    verified).
- **Lenses run:** L1, L3, L4, L5, L7 as separate passes; L2 for the GRBL M0/M6/jog claims; L6 folded
  into the save paths (surfacing cancel/abort, tiled write failure).
- **Method:** every routine was generated with the real code and read line by line:
  - surfacing through `buildSurfacingProgram` (12 parameter sets);
  - tiles through `prepareOutput` → `finalizeTiledOutput` (the production tiled-save core) for three
    two-tile projects: one bit plus a configured park; a separate registration cutter plus the park;
    a two-bit job with no park; each tile file was also passed through `normalizeExternalProgram`,
    `buildGcodeRenderModel` and `reviewExternalProgram`, as the Run G-code file dialog does;
  - the streamer and the setup gate with `toolChangePause` false (Run G-code file) and true (project
    Start) on the exact bit-change block a tile writes.

  The repros are archived in this session's scratchpad (`…/scratchpad/e3-repros/`), not in the repo.
- **Counts:** 5 raised → 0 refuted (refuter: 5 CONFIRMED, 0 PLAUSIBLE, no severity changes) → P1 0 /
  P2 2 / P3 3 (+ 11 KNOWN re-observed).

## Headline

Inside KerfDesk the multi-bit routine is sound: the project's own Start never sends the M0; it holds
host-side and lets the operator re-zero Z only, and Continue waits for a fresh Idle and new work-Z
evidence before `G0 Z<safe>`, `M3` and the dwell. The two P2s are both in **tiled export**, which
writes files that only the Run G-code file path can run:

- A tiled job whose tiles need more than one bit (a two-bit job, or a registration cutter different
  from the job's bit) writes `M0` bit changes into every tile. Run G-code file sends that `M0` to the
  controller. Stock GRBL then reads no further line until cycle start, KerfDesk refuses jog and Zero Z
  because a job is active, and the lines after the `M0` (`G0 Z`, `M3 S`, `G4`) are already in the
  controller's buffer. The file's own instruction "re-zero Z on the stock top, then cycle-start"
  cannot be followed, and cycle start cuts with the new bit on the old bit's Z zero.
- Tiled export ignores the job placement and translates only the passes into each tile's frame. A
  configured bed park (ADR-392) is written as raw bed numbers in tile coordinates, at every bit change
  and tile end. ADR-392 says a park whose zero is set by hand must be set aside. With 200 mm tiles
  zeroed at bed (100, 100), a park of X0 Y380 lands at bed (100, 480), 80 mm past a 400 mm bed. That
  is audit CO-1 again, in tile files.

Surfacing is safe as saved. It lifts before M3, dwells, plunges at the corner, retracts, and ends
`M5`. Every zero, negative, NaN or huge field is refused. Its depth ladder has no epsilon, so common
pairs such as 0.3/0.9 run one whole extra raster at the final depth.

## Routine → emitted lines → source

CNC output is one GRBL-family dialect (ADR-399): the bytes are identical for GRBL 1.1, grblHAL and
FluidNC. Marlin and Smoothieware refuse CNC Start and Frame, and export carries an advisory. KerfDesk
never emits `T` or `M6`. Stock GRBL rejects `M6` with error:20 and only tracks `T`. grblHAL's `$341`
modes and FluidNC's `atc` are therefore never engaged.

| Routine | Emitted lines (in order) | Source |
|---|---|---|
| Surfacing preamble | `; KerfDesk spoilboard surfacing`, `; area W x H mm, bit D mm, stepover P%`, `; zero X/Y at the front-left corner of the area, Z0 on the surface to face`, `G21` `G90` `G54` `G94` `G17`, `; depth requested-total-mm …`, `G0 Z<safe>`, `M3 S<round(min(rpm, spindleMax))>`, `G4 P<spinup>` (none at 0 s) | `surfacing.ts:150-168`; caps `save-surfacing-program.ts:118-142` |
| Surfacing pass (per depth) | `G0 X0.000 Y0.000` (at safe Z), `G1 Z-<d> F<plunge>`, then per row `G1 Y<y> F<feed>` (rows after the first) and `G1 X<W or 0> F<feed>` (serpentine), `G0 Z<safe>` | `surfacing.ts:169-178` |
| Surfacing end | `M5`, `G0 X0.000 Y0.000`; no M2/M30 | `surfacing.ts:179-180` |
| Surfacing geometry | row centres `0, s, 2s, …, H` (far edge pushed exactly); depths `t, 2t, …` then `total` pushed exactly (**P3-1**: no epsilon); bit centre covers `0..W × 0..H`, so the cut reaches `r` past every edge (gSender uses the same convention) | `surfacing.ts:102-114, 187-199` |
| Surfacing save | bed-envelope, feed/RPM, non-finite, plunged-travel and spindle-clearance preflight; any enabled no-go zone blocks (KNOWN); whole program staged before the picker (ADR-656) | `standalone-cnc-preflight.ts:23-137`; `save-surfacing-program.ts:44-116` |
| Job start (CNC) | `G21 G90 G54 G94 G17`, `; tool: <first> (load before starting)` (multi-tool only), `G0 Z<safe>`, `M3 S`, `G4 P`, `[M7\|M8]` | `cnc-grbl-strategy.ts:118-139` |
| Bit change | `G0 Z<park ≥ safe>`, `M5`, `[M9]`, `G0 X<park> Y<park>`, `; tool change: load <next bit>`, `; re-zero Z on the stock top, then cycle-start to resume`, `M0`, `G21 G90 G54 G94 G17`, `G0 Z<max safe>`, `M3 S`, `G4 P`, `[M7\|M8]` | `cnc-grbl-transitions.ts:90-120` |
| Bit change, project Start | `M0` is never sent: `fillBuffer` stops at it and the stream enters `tool-change`. Entry voids work-Z evidence, bumps the epoch, re-arms fresh Idle and names the next bit from the compiled tool plan. Continue needs a drained queue, fresh Idle, reported Idle, new Z evidence for the pending tool ID and plate removal. XY origin writers are refused for the whole hold | `streamer.ts:200-247`; `tool-change-hold-entry.ts:55-84`; `laser-store-helpers.ts:97-157`; `laser-job-actions.ts:269-292` |
| Bit change, Run G-code file | `toolChangePause: false`: the `M0` and the lines after it are streamed into the controller's buffer, and the setup gate stays shut (**P2-1**) | `external-run.ts:242-244`; repro below |
| Tiled export | Per tile: provenance header, `; tile: row r, column c`, then the clipped job translated by the tile's min corner. Parks are **not** translated (**P2-2**). Registration bores are added per tile in stock-identical positions (peck when hole = cutter, else centre plunge and full-circle `G2` rings) | `tile-emission.ts:61-95`; `tile-plan.ts:172-215, 320-357`; `tile-registration.ts:29-92`; `tile-registration-passes.ts` |
| Tiling disclosure | `Overlap X mm · tile step X a mm / Y b mm.` or the requested/effective pair. Same `effectiveCncTiling` as planning | `CncTilingDisclosure.tsx:11-33`; `effective-cnc-tile-grid.ts:47-63` |

## Findings

### P2-1 — Multi-bit tile files can only run through Run G-code file, which sends the bit-change `M0` to the controller; the new bit cannot be re-zeroed, and cycle start cuts it on the old bit's Z zero

- **Where:**
  - `src/core/output/cnc-grbl-transitions.ts:99-101` writes the bit-change block with
    `; re-zero Z on the stock top, then cycle-start to resume` and `M0`, into every tile that needs a
    second bit.
  - `src/core/cnc/tile-registration.ts:38-50` gives the registration bores their own cutter
    (`registration.tool`), so a registration cutter different from the job's bit makes every seam
    tile multi-tool. Any multi-bit job does the same.
  - Tiled export is file-only (`src/ui/app/save-tiled-gcode.ts`). Project Start ignores tiling, so
    a tile is run in KerfDesk only through **Run G-code file**.
  - `src/ui/gcode-inspector/external-run.ts:242-244` sets `toolChangePause: false`, so the `M0` is
    streamed to the controller.
  - `src/ui/state/laser-store-helpers.ts:97-101` (`setupBlockingJobCommandBlockMessage`) refuses
    jog, probe and Zero Z while that stream is `streaming`.
- **Anchor:**
  - **Contract:** WORKFLOW F-CNC15. The bit change is a hold where the operator re-zeroes Z, and
    Continue waits until "the new tool's Z zero has been established". The file's own comment tells
    the operator to re-zero Z, then cycle-start.
  - **Ground truth:** gnea/grbl `gcode.c`: M0 sets a feed hold, then `protocol_execute_realtime();
    // Execute suspend.` `protocol.c` loops `while (sys.suspend) {`, so no line is parsed until cycle
    start. GRBL Jogging wiki: a jog is accepted only in Idle or Jog.
  - **Twin:** project Start withholds the same `M0` host-side and opens the setup gate in the hold
    (`streamer.ts:212`, `laser-store-helpers.ts:97-101`). Run G-code file does neither for
    KerfDesk's own tile.
- **Scenario:**
  1. CNC project on stock GRBL. One pocket and one profile on a 1/8" end mill. Tiling is on (200 mm
     tiles, 20 mm overlap), with registration holes on a 1/4" end mill (6.35 mm dowel holes). Or:
     no registration, but the pocket uses a 1/4" bit.
  2. Save G-code writes `job_tile-r1-c1.nc` and `job_tile-r1-c2.nc`. Each holds two bit changes
     (`; tool change: load 6.35 mm (1/4") end mill`, `M0`, … `; tool change: load 3.175 mm (1/8") end
     mill`, `M0`).
  3. The operator opens a tile, Frames, and Starts it with Run G-code file. The review shows only
     the generic notice: "The program stops with M0 or M1. The controller holds there until the
     machine's own cycle start is pressed; KerfDesk's Resume does not release a stop the program
     asked for."
  4. At the `M0`, GRBL sits in its suspend loop. KerfDesk has already streamed `G21 … G0 Z3.810`,
     `M3 S12000`, `G4 P3.000` into the RX buffer behind it. Jog and Zero Z are refused with "A job
     is active. Request ABORT…". GRBL would not parse them anyway.
  5. The operator swaps the bit and presses the machine's cycle start (the only release the review
     names). The spindle starts, and the 1/4" bit cuts on the 1/8" bit's Z zero, deeper or
     shallower by the stick-out difference. The next change back to the 1/8" bit repeats the error
     for the profile.
  6. The alternative is ABORT. That throws away the rest of the tile, and CNC Start-from-line is
     refused.
- **Evidence:** REPRO.
  - `…/e3-repros/src_ui_app_zz-e3-tiles.test.ts`, case `park+regTool6350`: tile r1-c1 lines 89-93
    `G0 Z3.810` / `M5` / `G0 X0.000 Y380.000` / `; tool change: load 6.35 mm (1/4") end mill` /
    `; re-zero Z on the stock top, then cycle-start to resume` / `M0`. Its sendable text keeps `M0`
    (`sendable has M0 true`). The review warnings are only the M0 notice. Case `noPark+multiTool`
    gives the same with no registration cutter.
  - `…/e3-repros/src_ui_state_zz-e3-extrun.test.ts`: with `toolChangePause=false` the first window
    is `…G0 X0.000 Y380.000\nM0\nG21\nG90\nG54\nG94\nG17\nG0 Z3.810\nM3 S12000\nG4 P3.000\n`, and
    after the pre-M0 oks `status streaming`, `inFlight ["M0\n","G21\n",…,"M3 S12000\n","G4 P3.000\n"]`.
    The setup gate returns "A job is active. Request ABORT…". With `toolChangePause=true` (project
    Start) the M0 is not sent, the status is `tool-change`, and the setup gate is `null`.
  - **Novelty:** ADR-630 decided that M0 in *outside* programs is sent unchanged and warned about. It
    does not cover KerfDesk's own tiled output, which has no other run path. The 2026-07-13 audits
    call the M0 "sender-managed". AC-5 and P2-advcam-1 cover tile seams and holes, not the bit
    change. No open PR touches these files.
- **Refuter:** CONFIRMED (REPRO + SOURCE). P2 kept.
  - **Ground truth, fetched from gnea/grbl master:**
    - `gcode.c:1084-1089`: M0 runs `protocol_buffer_synchronize()`, sets `EXEC_FEED_HOLD`, then
      `protocol_execute_realtime(); // Execute suspend.`
    - `protocol.c:208` enters `protocol_exec_rt_suspend()`, which loops `while (sys.suspend)`
      (`:546`). No line is parsed in that loop, so no `$J=` and no `G10 L20`.
    - Only a cycle start from the completed hold clears the suspend (`protocol.c:349-366`).
    - `system.c:132` refuses `$J=` outside Idle and Jog in any case.
  - **Own repro** (temporary `src/ui/app/zz-e3r-tiles.test.ts`, now deleted): 2 × 1 tiles, park at
    X0 Y380, registration on em-6350, the job on a 1/8" bit.
    - Both tiles hold `; tool change: load 3.175 mm (1/8") end mill`,
      `; re-zero Z on the stock top, then cycle-start to resume` and `M0` (lines 50-52).
    - The sendable program was streamed with `toolChangePause: false`. At the `M0`, 12 lines are in
      flight, ending `G0X145.000Y49.763`, `G1Z-1.000F300`, `G1X145.054Y49.352Z-1.000F1000`. The new
      bit's plunge is already in GRBL's RX buffer.
    - The status is `streaming`, and the setup gate returns "A job is active. Request ABORT…".
  - **Guards checked and absent:**
    - The external-run path has no provenance or `; tool change: load` detection, only
      `toolChangePause: false`.
    - The Run review has only the generic M0 notice. No Program Health finding (`finding-checks.ts`)
      names a bit change, and `confirmCncSetup` says nothing about one.
    - The tiled save gives no advisory (`tileAdvisories` is empty) and has no split-per-bit option.
    - The Console refuses every command while a job is active (`console-command-readiness.ts:92`),
      and a lone `~` is meant for holds outside a job (`console-command.ts:113-116`).
    - Start from line is project-only. ADR-630 lists external resume under "Not in this decision".
  - **Not KNOWN:** ADR-630 decides that external M0s are sent unchanged, but it never mentions
    KerfDesk's own tile files.
  - **Severity, P2 kept rather than P1:** the wrong-depth cut needs the operator to release the hold
    after KerfDesk has refused Zero Z and named Abort, so it is not silent. Many stock GRBL routers
    have no cycle-start button, and there the outcome is Abort and a lost tile. The coordinator may
    still raise it: the review and the file comment both name cycle start as the way on, and the
    plunge is already buffered.
- **Fix direction:** either keep tile files single-bit (one file per bit per tile, the Fusion/Vectric
  convention), or let Run G-code file treat KerfDesk-provenance `; tool change: load` blocks as the
  host-side hold project Start uses. At minimum, warn in the tiled save and in the Run review that the
  bit cannot be re-zeroed at that `M0`.

### P2-2 — Tiled export writes the configured bed park as raw bed numbers in each tile's own frame, so the bit-change and end parks move with wherever the operator zeroes the tile (CO-1 again)

- **Where:**
  - `src/core/cnc/tile-plan.ts:209-214`: `clipGroupToTile` returns `{...group, passes:
    passes.map(translatePass)}`. Only the passes move to the tile frame; `parkXMm`/`parkYMm` keep
    their untiled values.
  - `src/core/cnc/tile-registration.ts:64`: the registration group takes `parkFields(machine)`, the
    raw Machine Setup numbers, which never pass through `placeCncParks`.
  - `src/ui/app/save-tiled-gcode.ts:54,151` calls `prepareOutput(hydrated, { outputScope })` with no
    placement. The job is prepared as Absolute with zero offset, so `bedToProgramTranslation`
    (`prepare-output.ts:365-369`) keeps the park in bed numbers.
  - The emitter parks at `group.parkXMm/parkYMm` (`cnc-grbl-transitions.ts:31-36, 94-95`;
    `cnc-grbl-strategy.ts:158-175`).
- **Anchor:**
  - **Contract:** ADR-392 Decision 2: "Unknown means set aside, never guessed." It names "every
    Verified Origin job, whose origin is set by hand", and says "Bed numbers are never written as
    program coordinates". Each tile's zero is set by hand: WORKFLOW F-CNC19 says "slide the stock,
    re-zero XY on the next tile frame".
  - **Twin:** a single-file export of the same project with User Origin and no homed controller sets
    the park aside and warns (`detectCncParkSetAsideWarnings`, ADR-392 Decision 3). The tiled export
    neither sets it aside nor warns.
  - F-CNC19's wording "the tile's corner is the machine origin" would make the park right only if
    every tile were zeroed at bed (0, 0). On a GRBL router the machine origin is the homing corner,
    and nothing in the tile file or the toast says the park depends on that.
- **Scenario:**
  1. Default 400 × 400 mm bed. Machine Setup has **Park at a bed position** on, at X0 Y380 (rear,
     for bit access). Tiling is on with 200 mm tiles and 20 mm overlap, registration on a 1/4" cutter
     (or a two-bit job).
  2. Save G-code: both `job_tile-r1-c1` and `job_tile-r1-c2` park with `G0 X0.000 Y380.000` at each
     bit change and at the end of the tile. That is tile coordinates, translated by nothing.
  3. The operator zeroes each 200 mm tile where the stock sits, say bed (100, 100).
  4. At the first bit change, at park height, the carriage heads for bed (100, 480), 80 mm past the
     back of the bed. Stock GRBL ships with soft and hard limits off (ADR-392 cites
     `DEFAULT_SOFT_LIMIT_ENABLE 0`), so Y runs into its stop and loses steps. The registration bores
     and the profile that follow in that tile are shifted.
  5. Neither the tiled save toasts (`machineWarnings` contained only the two starter-feed notes) nor
     the per-tile preflight flag it, because `Y380` lies inside a 400 mm bed in tile coordinates.
- **Evidence:** REPRO (`…/e3-repros/src_ui_app_zz-e3-tiles.test.ts`).
  - Case `park+regTool6350`: in tile r1-c1, line 89 `G0 X0.000 Y380.000` comes before the first `M0`
    and line 128 before the second. The tail is `G0 Z3.810`, `M5`, `G0 X0.000 Y380.000`. Tile r1-c2
    has the same lines (73/112 and its tail), while its cut motion is translated (xy range 0..133.175).
  - Case `park+sameTool`: both tiles end `G0 X0.000 Y380.000`.
  - `machineWarnings` holds only the generic starter-feed notes, with no park message.
  - The bed-position arithmetic is from ADR-392's own CO-1 context, which gives the same 80 mm
    overrun.
  - **Novelty:** CO-1 / ADR-392 fixed `translateCncGroup` for placement only. Tiling's
    `translatePass` was never touched. No audit names parks in tiles, and no tile test mentions
    `park`.
- **Refuter:** CONFIRMED (REPRO). P2 kept. The auditor rated it P2 because it needs two opt-in
  settings (bed park and tiling).
  - **Not KNOWN:** ADR-392 fixed CO-1 inside `prepareOutput` (`placeCncParks`), and tiling translates
    the passes after that (`tile-plan.ts:209-214`). No audit or open PR mentions parks in tiles.
  - **Not `G53`:** no tile file contains `G53`. The park is a plain `G0 X0.000 Y380.000` in G54 work
    coordinates (tile r1-c1 lines 49 and 153; r1-c2 lines 49 and 105).
  - **Twin reproduced:** the same project saved as one file parks at `G0 X0.000 Y0.000` and warns
    that the park was set aside, under User Origin and Verified Origin. Under Absolute it keeps
    `X0 Y380`, as ADR-392 Decision 1 intends.
  - **Why tiles differ:** the tiled save passes no placement, so `prepareOutput` treats the job as
    Absolute (`prepare-output.ts:250,366`), although each tile is zeroed by hand (F-CNC19: "re-zero XY
    on the next tile frame").
  - **Mitigation, not a refutation:** the Run G-code file envelope is `programBounds`, travel
    included. A tile's Frame outline is X 0..200, Y 0..380, although its cuts reach only Y 150. So the
    Frame drives to the park extent before any cut:
    - With soft limits on, GRBL refuses the jog (error:15) and Start stays locked.
    - On a homed machine whose bed position is placed, `externalOutlineBedWarnings` warns that the
      outline leaves the bed.
    - On stock GRBL defaults (no homing, soft limits off), the review only says it cannot place the
      outline. The Frame itself then runs into the end of travel, with the tool off at safe Z, before
      the first bit change. The lost steps shift the whole tile, and GRBL still reports the Frame
      complete.
  - **Severity, P2 kept:** Frame-first makes it visible (the Frame is far larger than the tile), it
    needs two opt-ins, and it needs a hand zero away from the bed origin.
  - **F-CNC19's wording:** "corner is the machine origin" makes the park right only if every tile
    corner sits at bed (0, 0). Side rails make that impossible for X tiling on many routers.
- **Fix direction:** drop a configured park from tile groups, including the registration group's
  `parkFields`, so tiles park at their own X0 Y0 as ADR-392 Decision 2 prescribes, and toast the
  set-aside. Or translate it only when the export knows each tile's bed position. Add a tile test that
  asserts park coordinates.

### P3-1 — The surfacing depth ladder and row ladder accumulate floating-point steps with no epsilon, so 0.3/0.9 (and 0.15/0.45, 0.7/2.1) runs a whole extra raster at the final depth

- **Where:** `src/core/cnc/surfacing.ts:196` (`for (let depth = step; depth < total; depth += step)`
  then `depths.push(total)`), and the same pattern for rows at `:111`.
- **Anchor:** **Twin:** `src/core/cnc/depth-passes.ts:43-47` (`zPassCount` uses
  `Math.ceil(depth/perPass - DEPTH_EPS)`). Rolling-v2 09 verified that the job emitter lands 0.9/0.3
  exactly, with no extra pass. ADR-316 clause 6 / DECISIONS "Surfacing keeps requested spacing/depth".
- **Scenario:** depth per pass 0.3, total 0.9 on the default 400 × 400 area with a 25.4 mm cutter.
  `0.3+0.3+0.3 = 0.8999999999999999 < 0.9`, so the ladder is −0.3, −0.6, −0.9, −0.9. The program
  faces the whole board a fourth time at the same depth: about 6.7 more minutes at 2500 mm/min, plus
  an extra plunge. The toast reports "4 pass(es)". Rows: height 0.9 with a 0.3 step gives a
  duplicate final row (gap 0).
- **Evidence:** REPRO (`…/e3-repros/src_core_cnc_zz-e3-surfacing.test.ts`):
  `0.3/0.9 {"passes":4,"plunges":["G1 Z-0.300 F600.000","G1 Z-0.600 F600.000","G1 Z-0.900 F600.000","G1 Z-0.900 F600.000"]…}`,
  and `h=0.7 d=1 30% … "lastRowYs":[0.6,0.9,0.9],"minRowGap":0`. Control: 0.2/0.6 gives 3 passes and
  0.1/0.7 gives 7. The existing test (`surfacing.test.ts:108`) uses 0.5/1.2, which does not
  accumulate error.
- **Refuter:** CONFIRMED (REPRO). The exact loops of `depthLadder` (`surfacing.ts:196-197`) and
  `surfacingRowYs` (`:111-112`) were replayed in node.
  - Depth: 0.3/0.9 gives 0.300, 0.600, 0.900, 0.900. 0.15/0.45 and 0.7/2.1 also repeat the final
    depth. Controls 0.5/1.2, 0.2/0.6 and 0.1/0.7 are exact.
  - Rows: height 101.6 with a 25.4 mm bit at 40 % (10.16 step) ends 101.59999…, 101.6, a duplicate
    final row.
  - This agrees with the auditor's `buildSurfacingProgram` repro. No earlier audit names it.
- **Fix direction:** count passes and rows as `ceil(span/step − ε)` and generate `i·step`, or reuse
  `zPassDepths`. Add a 0.3/0.9 case.

### P3-2 — Tiled save writes into the chosen folder without checking for existing tile names, silently replacing older files and leaving stale tiles of a larger grid beside the new set

- **Where:** `src/ui/app/save-tiled-gcode.ts:179` (`directory?.file(displayName)` for every tile),
  `src/platform/web/web-adapter.ts:136-137` (`getFileHandle(displayName, { create: true })`, then a
  truncating `createWritable`).
- **Anchor:** **Twin:** the multi-file trace writer uses the same `SaveDirectoryTarget` but calls
  `freeDirectoryName` (`multi-file-trace-action.ts:396-412`) so an existing file is never replaced.
  `SaveDirectoryTarget.exists` is documented "so a caller that must not replace files can pick another
  name first" (`platform/types.ts:196-198`).
- **Scenario:**
  1. Export a 2 × 2 tiled job, then change the tile size and export it again to the same folder as
     a 1 × 3 grid. Or export two unsaved projects, both named `job`.
  2. `job_tile-r1-c1`/`r1-c2` are overwritten without a prompt, and `job_tile-r2-c1`/`r2-c2` from
     the old grid stay.
  3. The toast says "Saved all 3 tile files. Cut them in index order…" while the folder holds five
     `job_tile-*` files from two different grids.
- **Evidence:** READ. `exists` has one production caller (`multi-file-trace-action.ts:402`), and the
  tiled path never calls it.
- **Refuter:** CONFIRMED (READ, two lines; not run in a browser).
  - `exists` has one production caller (`multi-file-trace-action.ts:402`). The tiled loop mints
    ``directory.file(`${file.name}.nc`)`` for fixed names (`save-tiled-gcode.ts:177-179`).
  - `directoryFileTarget.write` opens the entry with `{ create: true }` and writes. Its own comment
    keeps the old contents only when the write fails.
  - The web adapter is the only one that defines `reserveSaveDirectory`, so this is the tiled save
    path.
- **Fix direction:** check `exists` for the whole set before writing. Ask once to replace, or write
  to a fresh subfolder or suffix, and name stale `*_tile-*` files left from another grid.

### P3-3 — WORKFLOW F-CNC25 describes the old four-field surfacing panel with fixed feeds capped by the device profile

- **Where:** `WORKFLOW.md` F-CNC25 Success 1 (around line 6525): "width/height …, stepover % of the
  active bit, total depth … serpentine rows per 0.5 mm depth step … Fixed feeds are capped to the
  device-profile maximum."
- **Anchor:** **Contract / doc drift.**
  - `SurfacingFields.tsx:106-157` has eight fields (Feed, Plunge, Spindle RPM and Depth per pass
    besides the four).
  - The depth step is the Depth per pass field (default 0.5).
  - Feeds are editable starters (ADR-457 Amd 1), capped by CNC's own Max feed
    (`cncMaxFeedMmPerMin`, ADR-416), not the device profile's.
- **Scenario:** an operator or maintainer reading F-CNC25 expects 0.5 mm steps and fixed
  2500/600 feeds. The panel lets any value through below the CNC Max feed and spindle maximum.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (READ).
  - `WORKFLOW.md:6526-6530` still lists four fields, "serpentine rows per 0.5 mm depth step" and
    "Fixed feeds are capped to the device-profile maximum".
  - `SurfacingFields.tsx:109-152` has eight fields, and `save-surfacing-program.ts:130,134` caps by
    `cncMaxFeedMmPerMin`.
  - The 2026-07-25 survivors note found the document right for the four-field panel of that time.
    This is drift since ADR-457 Amd 1, not KNOWN.
- **Fix direction:** update F-CNC25 Success 1 to the current fields and to the ADR-416 cap.

## KNOWN (re-observed on this tree, not raised)

- **K-1, AC-5 (2026-09-24, open 2026-09-29).** Registration holes sit at fixed 25 %/75 % points of
  the tile and can leave the board or land on the face. Tile files name only `; tile: row r, column c`,
  not where to re-zero. Re-observed: `tile-registration.ts:16,75-92`. The header claim in
  `tile-plan.ts:7-8` ("dowel pins re-index the stock physically") still has no procedure. Each
  adjacent tile bores the same stock point *after* it has been zeroed, so the bore cannot index the
  slide. Same root as AC-5.
- **K-2, P2-advcam-1 (2026-09-29).** Tiling turns helices into `path3d` at the cutting feed and adds
  seam plunges (`tile-plan.ts:192-195`).
- **K-3, P2-preview-2 (2026-09-29).** Preview, 3D pane and Cut 3D draw no bit-change park visit and
  no park height. `toolpath-cnc.ts` still has no park step; the comment at `:31-34` notes the park
  without drawing it.
- **K-4, CO-2 (2026-09-24).** Surfacing assumes the Front-left layout whatever the origin setting
  says (`surfacing.ts:4-6`).
- **K-5, MC-4 (2026-09-24, partly fixed).** The bit-change stop is only safe Z (3.81 mm) up unless
  a park height is set.
- **K-6, July full-chain 2.1 / FS-4.** Without a stock material the Spindle RPM field seeds at the
  machine maximum (`SurfacingFields.tsx:31-34`), and nothing checks surfacing values against the bit.
- **K-7, D4-P2-1.** Running the saved surfacing file through Run G-code file in CNC mode never
  checks `$32`/`$30`.
- **K-8, 2026-07-25 rule-7 note.** Surfacing save is refused whenever any no-go zone is enabled
  (`standalone-cnc-preflight.ts:97-108`). A documented legacy refusal.
- **K-9, 2026-09-27 gap audit ("Needs your decision").** One GRBL dialect with an M0 pause per bit:
  no `T`/`M6`, no grblHAL `$341` or FluidNC `atc` path. P2-1 is a consequence specific to tile files.
- **K-10, D4-P3-5.** The motion invariants keep the pre-`M0` modal Z.
- **K-11, by design (2026-09-27 gap audit).** Every program selects `G54`. The surfacing comment
  names the corner and Z0 but not the WCS.

## Refuted

Candidates the auditor checked and dropped:

- *Stock GRBL auto-resumes an M0 when more lines arrive, so a saved bit change would not stop.*
  False. `gcode.c` enters `protocol_exec_rt_suspend` (`while (sys.suspend)`) inside the M0 line
  itself. The cycle-start guard refuses an auto-cycle-start without user input.
- *Surfacing leaves the area edges uncut by the bit radius.* No. Row centres run `0..H` and X runs
  `0..W`, so the cut reaches `r` past every edge. gSender's perimeter uses the same bit-centre
  convention.
- *Adjacent tiles bore registration holes at different stock points.* No. A right-seam hole is at
  `rect.maxX − o/2 = rect.minX + step + o/2`, and the neighbour's left-seam hole is at
  `rect'.minX + o/2 = rect.minX + step + o/2`. The row and column fractions use the same `minY`/`minX`,
  and corner tiles match pairwise.
- *Registration bores plunge at the cutting feed.* No. Pure-vertical `path3d` segments ride the
  plunge feed (`cnc-grbl-strategy.ts:422-423`), and a peck group's feed is `min(feed, plunge)`.
- *A Pause-and-lift re-entry can rewind across a bit-change M0 and consume the next bit's label.*
  No. The resume index is the motion block the bit stopped in, and the lift height is taken only
  after the last M0 (`cnc-pause-reentry.ts:144,189-196`).
- *The tiling disclosure disagrees with the export.* No. Both read `effectiveCncTiling`, and numeric
  edits persist the effective overlap (`cncTilingAfterEdit`).
- *A surfacing zero, negative, NaN, Infinity or pathological field reaches G-code.* No. Every field
  is checked positive and finite, spin-up is ≥ 0, stepover is ≤ 100 %, and rows and passes are
  capped at 100 000. Depth per pass above the total gives one pass at the total.

## Verified clean

- **Surfacing as saved.** `G0 Z<safe>` before `M3`. `G4 P` in seconds (GRBL `mc_dwell`, per D4).
  Every XY travel at safe Z. The plunge at work (0, 0) is fed at the plunge rate. The last pass
  retracts, then `M5`, then `G0 X0 Y0`. The far row and the final depth are exact. Feed and plunge
  are capped by CNC's own Max feed (ADR-416), and RPM by Spindle max. The panel's "Output uses …
  after machine limits" note uses the same caps as the file. The origin and Z0 are stated in the
  file comment and the success toast. The toast's pass and row counts equal the emitted ladder.
- **Surfacing save lifecycle.** Preflight and generation finish before the picker opens (ADR-656).
  Cancel aborts the worker. A document change retires the pending save. Writers are serialised.
- **Bit change, project Start.** The `M0` is withheld host-side on every fill path
  (`fillBuffer`). All four hold-entry sites go through `steppedStreamerPatch`. Continue requires a
  drained queue, fresh and reported Idle, current work-Z evidence for the pending tool ID, and
  plate-removal confirmation. XY origin writers are refused in the hold. A probe ALARM:4/5 in a
  drained hold keeps the hold. Labels and IDs come from the compiled tool plan, and a count mismatch
  with the M0s throws.
- **Bit change, emitted.** Retract to park height, then `M5`, `M9`, park, `M0`, a modal restate,
  `G0 Z<max safe>`, `M3`, `G4` and coolant, as in the table. The next pass always re-emits its `G0 X Y`
  because head XY/Z are voided. Labels name the incoming group's bit; tile files show
  `load 6.35 mm (1/4") end mill` before the bores and `load 3.175 mm (1/8") end mill` after.
- **Tiling geometry.** Tiles are row-major. Passes are clipped by Liang–Barsky with Z interpolated
  and translated by the tile's min corner, and registration bores are translated by the same corner.
  Registration is clearing work, so it runs before profiles within each tile file (ADR-310). Every
  registration field must be finite and positive, and the cutter must be a flat end mill no wider
  than the hole.
- **Trust boundary.** Tool names in comments are sanitised (09). Tile file names come from the
  project name, and the File System Access directory API rejects separators.

## Not verified

- **grblHAL and FluidNC during an M0.** Whether jogging or `G10` is accepted in their program-pause
  hold was not checked. P2-1's ground truth is stock GRBL only. grblHAL's tool-change wiki is silent
  on M0.
- **Third-party senders.** Whether gSender, UGS or Candle intercept `M0` sender-side was not
  checked, so the saved file's behaviour there is unknown.
- **Post conventions.** Fusion 360 (OpenBuilds/Autodesk GRBL), Vectric and Carbide Create surfacing
  and tool-change posts were not fetched. Only the gSender surfacing generator was read.
- **Plunge entry.** Whether a straight surfacing plunge is safe for non-centre-cutting facing cutters
  was not checked against a source. gSender ramps; KerfDesk plunges at the corner.
- **Stepover ceiling.** gSender clamps stepover to 80 %; KerfDesk allows 100 %. Not raised, because
  no source on corner-radius ridges was fetched.
- **Physical checks.** No hardware, air cut or registration-pin procedure was tried.
- **Rendered UI.** The surfacing panel and the tiled save were not exercised in a browser or the
  Electron build.
- **CNC Pause, then Resume, at a program `M0` (refuter).** Not checked: whether this releases an
  external program's `M0` hold on stock GRBL.
  - CNC Pause sends the safety-door byte (`laser-job-pause-resume.ts:105-116`). `protocol.c`
    suggests a door resume ends the same `while (sys.suspend)` loop the `M0` runs in.
  - If it does, the review's "KerfDesk's Resume does not release a stop the program asked for" is
    wrong, and P2-1 has an in-app path to the old-zero cut.
  - Not traced through ADR-411 Pause-and-lift.

```json
[
  {"id":"E3-P2-1","severity":"P2","area":"ctl-cnc-routines","file":"src/ui/gcode-inspector/external-run.ts","line":244,"anchor":"Contract: WORKFLOW F-CNC15 (re-zero Z in the bit-change hold before continuing); Ground truth: gnea/grbl gcode.c M0 -> feed hold + protocol_execute_realtime 'Execute suspend', protocol.c while (sys.suspend) blocks line parsing; GRBL Jogging wiki (jog only in Idle/Jog); Twin: project Start withholds M0 and opens the setup gate","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Multi-bit tile files (two-bit job or a separate registration cutter) can only run via Run G-code file, which streams the M0 and the post-M0 G0 Z/M3/G4 into GRBL; jog and Zero Z are refused, the file's 're-zero Z then cycle-start' cannot be followed, and cycle start cuts the new bit on the old bit's Z0"},
  {"id":"E3-P2-2","severity":"P2","area":"ctl-cnc-routines","file":"src/core/cnc/tile-plan.ts","line":213,"anchor":"Contract: ADR-392 Decision 2 (zero set by hand -> park set aside; bed numbers never written as program coordinates); Twin: single-file User Origin export sets the park aside and warns (ADR-392 D3)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Tiled export translates passes but not parkXMm/parkYMm (and the registration group takes raw parkFields), so every tile parks at the bed numbers in its own hand-zeroed frame at each bit change and tile end; 200 mm tiles zeroed at bed (100,100) send a park of X0 Y380 to bed (100,480), 80 mm past a 400 mm bed, with no warning"},
  {"id":"E3-P3-1","severity":"P3","area":"ctl-cnc-routines","file":"src/core/cnc/surfacing.ts","line":196,"anchor":"Twin: depth-passes.ts zPassCount DEPTH_EPS (job emitter lands 0.3/0.9 exactly, rolling-v2 09)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Surfacing depth and row ladders accumulate float steps with no epsilon: 0.3/0.9 emits Z-0.900 twice (a whole extra facing raster), and the toast reports 4 passes"},
  {"id":"E3-P3-2","severity":"P3","area":"ctl-cnc-routines","file":"src/ui/app/save-tiled-gcode.ts","line":179,"anchor":"Twin: multi-file trace freeDirectoryName never replaces an existing file; SaveDirectoryTarget.exists contract (platform/types.ts:196-198)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Tiled save replaces existing *_tile-* files in the chosen folder without asking and leaves stale tiles of a previous larger grid beside the new set, while the toast says to cut them in index order"},
  {"id":"E3-P3-3","severity":"P3","area":"ctl-cnc-routines","file":"WORKFLOW.md","line":6525,"anchor":"Doc drift: SurfacingFields.tsx eight fields; ADR-457 Amd 1 editable starters; ADR-416 CNC own Max feed","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"F-CNC25 still describes four fields, 0.5 mm depth steps and fixed feeds capped by the device profile"},
  {"id":"E3-K-1","severity":"P3","area":"ctl-cnc-routines","file":"src/core/cnc/tile-registration.ts","line":16,"anchor":"2026-09-24 CNC audit AC-5","evidence":"READ","verdict":"KNOWN","known":"AC-5 (open 2026-09-29)","summary":"Registration holes at fixed 25/75% points can leave the board; tile files do not say where to re-zero; 'dowel pins re-index' has no procedure"},
  {"id":"E3-K-2","severity":"P2","area":"ctl-cnc-routines","file":"src/core/cnc/tile-plan.ts","line":192,"anchor":"2026-09-29 P2-advcam-1","evidence":"READ","verdict":"KNOWN","known":"P2-advcam-1","summary":"Tiled helices become path3d at cutting feed; seam plunges unannounced"},
  {"id":"E3-K-3","severity":"P2","area":"ctl-cnc-routines","file":"src/core/job/toolpath-cnc.ts","line":31,"anchor":"2026-09-29 P2-preview-2","evidence":"READ","verdict":"KNOWN","known":"P2-preview-2","summary":"Preview/3D draw no bit-change park visit or park height"},
  {"id":"E3-K-4","severity":"P3","area":"ctl-cnc-routines","file":"src/core/cnc/surfacing.ts","line":5,"anchor":"2026-09-24 CO-2","evidence":"READ","verdict":"KNOWN","known":"CO-2","summary":"Surfacing assumes the Front-left layout regardless of the origin setting"},
  {"id":"E3-K-5","severity":"P3","area":"ctl-cnc-routines","file":"src/core/output/cnc-grbl-transitions.ts","line":91,"anchor":"2026-09-24 MC-4","evidence":"READ","verdict":"KNOWN","known":"MC-4 (partly fixed)","summary":"Bit-change stop only safe Z up unless a park height is set"},
  {"id":"E3-K-6","severity":"P3","area":"ctl-cnc-routines","file":"src/ui/machine/SurfacingFields.tsx","line":31,"anchor":"July full-chain 2.1 / FS-4","evidence":"READ","verdict":"KNOWN","known":"2.1 / FS-4","summary":"Surfacing RPM seeds at the machine maximum without a stock material; values not checked against the bit"},
  {"id":"E3-K-7","severity":"P2","area":"ctl-cnc-routines","file":"src/ui/gcode-inspector/external-run.ts","line":218,"anchor":"controller-v3 D4-P2-1","evidence":"READ","verdict":"KNOWN","known":"D4-P2-1","summary":"Running the surfacing file via Run G-code file never checks $32/$30"},
  {"id":"E3-K-8","severity":"P3","area":"ctl-cnc-routines","file":"src/core/preflight/standalone-cnc-preflight.ts","line":97,"anchor":"2026-07-25 legacy refusal","evidence":"READ","verdict":"KNOWN","known":"2026-07-25 full-chain audit","summary":"Surfacing save refused whenever any no-go zone is enabled"},
  {"id":"E3-K-9","severity":"P3","area":"ctl-cnc-routines","file":"src/core/output/cnc-grbl-transitions.ts","line":101,"anchor":"2026-09-27 gap audit (maintainer decision)","evidence":"SOURCE","verdict":"KNOWN","known":"2026-09-27 gap audit","summary":"One GRBL dialect with an M0 per bit; no T/M6, grblHAL $341 or FluidNC atc path"},
  {"id":"E3-K-10","severity":"P3","area":"ctl-cnc-routines","file":"src/core/invariants/cnc-motion.ts","line":101,"anchor":"controller-v3 D4-P3-5","evidence":"READ","verdict":"KNOWN","known":"D4-P3-5","summary":"Motion invariants keep the pre-M0 modal Z"},
  {"id":"E3-K-11","severity":"P3","area":"ctl-cnc-routines","file":"src/core/cnc/surfacing.ts","line":156,"anchor":"2026-09-27 gap audit (G54 by design)","evidence":"READ","verdict":"KNOWN","known":"by design","summary":"Programs always select G54; the surfacing comment does not name the WCS"}
]
```
