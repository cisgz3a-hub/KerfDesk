# Controller audit v4 — E4 External program normalisation (`ctl-external-normalize`)

- **When:** 2026-10-22 23:15–23:58   **Tree:** origin/main @ `71ff820ce` (the shared audit worktree
  adds only audit docs). `origin/main` moved to `ccc447579` during the audit (#1384, #1390, #1386
  and others). Every finding below was re-read on `ccc447579` with `git show origin/main:<file>`
  and is still present there; the repros ran on `71ff820ce`. One HEAD-only gap that #1384 closed
  is listed under "Verified clean" instead of being raised.
- **Scope:** `src/core/external-program/{normalize-external-program,controller-block-check,external-program-review,marlin-program-reader}.ts`;
  the normalisation and block-check parts of `src/ui/gcode-inspector/{external-run,prepare-external-run,use-external-program,RunGcodeFileDialog,RunGcodeFileControls,RunGcodeFileSummary,external-run-bed}.ts(x)`.
  Twins followed into `src/core/gcode/word-scan.ts`, `src/core/gcode-view/{render-model-words,finding-checks}.ts`,
  `src/core/controllers/{console-state-effect,grbl/line-buffer-limit,grbl/eeprom-write-line,fluidnc/fluidnc-line-limit}.ts`,
  `src/ui/state/{acknowledged-wcs,frame-wcs-selection,laser-console-actions,work-z-zero-evidence,host-recorded-origin,laser-stream-stall,laser-start-program-assertions}.ts`,
  `src/ui/laser/{frame-controller-readiness,cnc-start-advisories}.ts`, `src/core/output/{grbl-strategy,cnc-grbl-transitions}.ts`.
  The `$32`/`$30` readiness and lit-rapid checks (D4-P2-1, D5-P2-2, #1390) were skipped.
- **Governing:** PROJECT.md non-negotiable 21 and ADR-565 (the Frame is the spatial source of
  truth and the only ordinary Start gate); ADR-630 and Amendments 1 (placement, honest refusals,
  item 11 rejected blocks, item 12 baseline), 2 (item 4: an unreadable move is named as "not in the
  Frame outline") and 3 (Smoothieware `M221 S100`); ADR-375 (line limits) and Amendment 3 (active
  WCS follows acknowledged G54–G59); ADR-644 (EEPROM writes stream alone); ADR-653 (Marlin
  interpretation); ADR-416 / F-CNC15 (CNC work-Z evidence).
- **Primary sources fetched** (copies in the session scratchpad `e4-src/`): gnea/grbl
  `bfb67f0` `gcode.c`, `protocol.c`, `gcode.h`, `report.c`, `serial.c`, `config.h`; grblHAL core
  master `gcode.c`, `protocol.c`, `gcode.h`; FluidNC main and **v4.0.3** `GCode.cpp`,
  `Parameters.cpp`, `Protocol.cpp`; Smoothieware edge `GcodeDispatch.cpp`, `SimpleShell.cpp`,
  `SerialConsole.cpp/.h`, `Player.cpp`, `USBSerial.cpp/.h`; smoothieware.org supported G-codes
  page; LightBurn Laser Window docs and forum on Run GCode (it streams a saved file; no review,
  no Frame). Marlin was not re-fetched: its line limit and M30 are KNOWN (C6-P3-4) and the reader
  already names M2/M30 as not interpreted.
- **Lenses run:** L1, L3, L4, L5, L6 (a malicious G-code file), L7 as separate passes; L2 inside
  each (every controller claim below is from the fetched source).
- **Counts:** 9 raised → 0 refuted (refuter: 9 CONFIRMED, 0 PLAUSIBLE; severity change: P1-1 →
  P2) → P1 0 / P2 5 / P3 4 (+ 12 KNOWN). The finding keeps its ID `E4-P1-1`.

## Headline

The normaliser itself is faithful: it collects each line the way stock GRBL does, counts line
length after that, refuses realtime and NUL bytes and `$`/bracket commands, and units, mixed
`G20`/`G21`, relative moves and lines after `M30` all reach the Frame outline correctly. The
serious gap is **after** the run. Streamed external lines never update the store's controller
model, which only KerfDesk's own commands and the Console keep current. A program that leaves
`G55` active (no `M2`/`M30` after it) makes the next project Frame skip its G54 selection and trace
in G55, while the project program's own `G54` burns elsewhere (P1-1; the refuter confirmed it and
rates it P2 for reach). The same gap leaves a probed
work Z0 "current" after a program moved Z0 or set a tool length offset (P2-1). Inside the review,
FluidNC parameters and expressions run but are reported only as "Unreadable lines … skipped", so
the Frame can be 110 mm short (P2-2); `M1` is described as a hold that stock GRBL and FluidNC
ignore (P2-3); and on Smoothieware a lowercase line or `M28` runs a shell or SD-card write with
the same "skipped" wording (P2-4).

## Program feature table

"Sent" is what the Run dialog streams on stock GRBL unless a dialect is named. "Review" is the
Run review after `inspectGcodeText` with the dialog's context (repro `zz-e4-chain`).

| Program feature | Normaliser / block check / review | What the controller does | Source |
|---|---|---|---|
| No units word | Baseline `G17G21G90G94G0` first; Units "not declared; the G21 sent first sets millimetres" | Runs in mm | `gcode.c` modal G21 after baseline |
| `G20` program | Sent as `G20G90`; envelope ×25.4 (X1..2 in → 25.4..50.8 mm); "leaves the controller in inches" warning | Inches until G21; the next KerfDesk job's preamble sends G21 | `gcode.c` [6]; `grbl-strategy.ts:96` |
| `G20` + `G91` from head (10, 20) | Envelope X 10..60.8, Y 20..45.4 | Same | — |
| Mixed `G21`/`G20`/`G21` | Each block in its own units; "Part of the program is in inches" | Same | — |
| `G20` arc `G2 X2 Y0 I1 J0` | Envelope X 0..50.8, Y 0..25.4 (exact arc box in mm) | Same | `gcode.c` I/J converted with block units |
| Marlin `G20` | Reader marks it unsupported, following coordinates unplaced; Units "not declared" | Inches only with `INCH_MODE_SUPPORT` | **P3-3** |
| `G91`, `G93`, `G18`, `G2` left by an earlier program | Baseline resets plane, units, distance, feed mode, motion mode | Reset | ADR-630 Amd 1 item 12 |
| `G55`–`G59` left by an earlier program | Not in the baseline; the Frame selects G54 only when the store says another WCS is active | Stays active | **P1-1** |
| Tool length offset (`G43.1`) left by an earlier program | Not reset (no `G49`); reported WCO includes TLO, so the start Z is consistent | Persists until reset | `report.c:515`; P2-1 |
| `M2`/`M30` mid-file, lines after it | Sent; Inspector resets G1/G17/G90/spindle and keeps drawing; "Lines after the program end … still run on GRBL" | GRBL runs them | `gcode.c:1091-1125` |
| `M0` | Sent unchanged; warning "holds until the machine's own cycle start" | Feed hold until `~` | `gcode.c:1086-1090`; stall watch paused in Hold (`laser-stream-stall.ts:87-89`) |
| `M1` alone | Same warning as `M0` | **Ignored** by stock GRBL and FluidNC; grblHAL stops unless optional stop is disabled | **P2-3** |
| `M6` | Warning "Stock GRBL does not support M6 and stops with an error" | `error:20` on stock GRBL | `gcode.c` default case |
| `G28`/`G30`, `G28.1`/`G30.1`, `G53`, `G92`, `G38.x` | Warned; left out of the outline (ADR-630 Amd 1) | As warned | KNOWN K-9 for the G28 intermediate point |
| `G10 L2`/`L20` | Warned, incl. "Later jobs also start from the changed origin"; streamed alone (ADR-644) | Writes EEPROM | `eeprom-write-line.ts`, `streamer.ts:217` |
| `G10 L1 P1 Z-12.5` on grblHAL | **HEAD:** no warning at all (`G10`, `L` in `EXPLAINED_WORDS`); **origin/main:** named as not interpreted (#1384) | grblHAL tool-table write | Verified clean (fixed) |
| `$N=`, `$H`, `/$J=`, `[J]` | Refused (policy) | — | ADR-630 Amd 1 |
| `G90G91…`, `G0G1…`, `X1X2` | Refused (`error:21/24/25`) | Rejected whole by GRBL/grblHAL/FluidNC | `gcode.c:146-171` |
| `G49 G0 X40 Y40` | **Not refused**; outline includes X40 Y40 | `error:24` on stock GRBL and FluidNC (grblHAL accepts) | **P3-1** |
| `G90G91G1X10` on Smoothieware | Refused "(error:21)" | Smoothie splits at each G/M and runs both | **P3-4** |
| FluidNC `#1=120` / `G1 X#1`, `G0 X[5+5]` | Not refused; Inspector drops the lines as "Unreadable … skipped"; outline short | FluidNC v4.0.3 evaluates them and moves | **P2-2** |
| FluidNC `G0 X[5*2]` | Refused as a "checksum (*)" line | Valid expression on FluidNC | P2-2 |
| Smoothieware `reset`, `M1000reset`, `M28Xconfig` | Not refused; "Unreadable lines … skipped" | Shell reboot; `M28` opens `/sd/config` for writing and stores the rest of the job in it | **P2-4** |
| Smoothieware lowercase `g1x10` | Not refused; framed as a move | Sent to the shell: "error:Unsupported command" | P2-4 |
| Marlin `M92 X40` + `M500` | Generic "unsupported" warnings | Steps/mm changed and saved to EEPROM | P2-4 |
| No `F` ever | "Cutting moves with no feed rate … Most controllers reject" | GRBL runs at the F left by the previous job (error:22 only if no F since reset) | **P3-2** |
| `M3`/`M4` before `S` | "starts at the S value the controller already holds" | Same | ADR-630 Amd 1 item 3 |
| Canonical line of 89 significant chars | Frame blocked: "stock GRBL accepts at most 79 per line … error:11" | `error:11` | `line-buffer-limit.ts`; Start re-checks (`laser-job-actions.ts:247`) |
| 300-byte Smoothieware line | Frame blocked by the 127-byte RX window | Smoothie USB buffer is 256 and flushes an over-long line | `USBSerial.cpp:258-261` |
| `?`, `!`, `~`, Ctrl-X, byte > 0x7F outside a comment; NUL anywhere | Refused | Realtime / binary | `serial.c:150-156` |
| Same bytes inside a comment | Comment removed, line kept | Never sent | ADR-630 Amd 1 item 12 |
| Nested comment `(a (b) c)` | Leaves `c)` (as GRBL does) | `error` on `c)` | `protocol.c` comment flags |
| Lowercase `g1 x10` on GRBL | Sent lowercase | GRBL upcases | `protocol.c` upcase branch |
| `X1 0 0` on GRBL/grblHAL | Sent `X100`, framed as X100 | Runs X100 (bytes sent are canonical) | — |
| Postamble | None; nothing is added after the program except the settle marker `G4 P0.01` / `M400` | — | `laser-post-job-settle.ts:109-115` |

## Findings

### P1-1 (refuter: P2) — An external program that leaves `G55`–`G59` active is not tracked: the next project Frame skips its G54 selection and traces in G55, while the project program's own `G54` runs the job at the G54 origin

- **Where:**
  - `src/ui/laser/frame-controller-readiness.ts:73` returns before any selection when
    `before.activeWcs === 'G54'`; `src/ui/state/laser-console-actions.ts:171` returns
    `already-g54` with no `$G` readback and no write.
  - `src/ui/state/acknowledged-wcs.ts:41-65` updates `activeWcs` only for lines KerfDesk sends
    itself (`laser-origin-transaction.ts:70`, `laser-probe-actions.ts:137`) and the Console
    (`frame-wcs-selection.ts:76-77`). Nothing on the stream or post-job path reads a G54–G59 word
    (`laser-stream-ack.ts`, `laser-post-job-settle.ts` hold no WCS logic).
  - `src/ui/gcode-inspector/external-run.ts:235-260` streams the external bytes; the baseline
    `G17G21G90G94G0` (`normalize-external-program.ts:60`) does not pin a WCS.
  - `src/core/output/grbl-strategy.ts:96` and `cnc-grbl-transitions.ts:52-56`: every KerfDesk
    program writes `G54` in its preamble.
- **Anchor:**
  - **Contract:** PROJECT.md non-negotiable 21 / ADR-565 (the completed Frame is the spatial
    truth for Start); ADR-375 Amendment 3 / controller-v2 C2-P2-1 (the store's active WCS must
    follow every acknowledged G54–G59 word).
  - **Twin:** `acknowledgedWcsPatch` and `trackConsoleWcs` track the WCS for KerfDesk's own
    writes and the Console, but not for external job lines. The preamble comment in
    `grbl-strategy.ts:80-84` names the failure: "the burn lands displaced by a stale G55-G59 offset".
  - **Ground truth:** gnea/grbl `gcode.c:223-227` (G54–G59 is modal), `:504-511` and `:585-597`
    (absolute targets, jogs included, use the active system), `:1101` (`coord_select = 0` only at
    `M2`/`M30`).
- **Scenario:**
  1. A CNC owner has G54 at fixture A and G55 at fixture B (G55 = G54 + X200). They run a
     two-fixture CAM file through Run G-code file. It selects `G55` for the second part and ends
     `M5` without `M30` (a hand-edited or truncated post).
  2. The job completes. GRBL is in G55; KerfDesk's store still says `activeWcs: 'G54'`.
  3. They open a project job and press Frame. `normalizeFrameWorkCoordinateSystem` sees G54 and
     selects nothing. The Frame's `$J=G90 …` jogs trace the outline at fixture B.
  4. Start. The checks compare the Frame's state with the current one, which are both G55, so they
     pass. The program's preamble `G54` switches system, and the job cuts at fixture A, 200 mm from
     what was framed. The same holds for a laser job.
  5. Nothing warns. The external review said "The program switches to G55. The Frame traced
     G54, so moves in another work coordinate system were not traced". It did not say G55 stays
     active. The project's `active-wcs-warnings` read the same stale `activeWcs`.
  - **Reach:** GRBL resets to G54 at `M2`/`M30`, so it needs a program that selects G55–G59 and
    has no `M2`/`M30` after it. Home, a reconnect, a reset or a settings read re-reads `$G` and
    clears the issue.
- **Evidence:** REPRO (store) + SOURCE.
  - `e4-repros/src_ui_gcode-inspector_zz-e4-wcs.store.test.ts` drives the real store, the real
    Frame and the real `startExternalProgram` with a scripted GRBL connection. The program is
    `G17G21G90G94G0 / G55 / G0X10Y10 / M4S500 / G1X20F600 / M5 / G92Z5`. Output:
    - before Start: `{"activeWcs":"G54","zEvidenceCurrent":true}`;
    - after the job: `{"streamer":null,"sent":["G55","G92Z5"],"activeWcs":"G54","zEvidenceCurrent":true}`;
    - next Frame selection: `{"selection":{"kind":"already-g54"},"writes":[]}`.
  - The physical step (the jog follows the active system, then the job's `G54` switches) is from
    `gcode.c`. The GRBL simulator models only G54 (`grbl-sim-lines.ts:378`), so it was not
    simulated.
  - **Novelty:** C2-P2-1 (probe G54 vs a stale store) predates ADR-630, and its fix covers only
    KerfDesk's own writes. 26, D5 and E3 do not cover this. No open PR touches
    `acknowledged-wcs.ts` or `frame-controller-readiness.ts`.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE); **severity P1 → P2**. What would refute it: GRBL
  keeping G54 at program end, KerfDesk appending `M2`/`G54` or reading `$G` after an external
  run, or the Frame or Start reading `$G` when the store says G54. None holds.
  - **Firmware, fetched independently** (gnea/grbl master `gcode.c`). `G54`–`G59` set
    `gc_block.modal.coord_select` (L223-226), which is copied into the parser state (L996-997). Only
    the M2/M30 `PROGRAM_FLOW_COMPLETED` branch sets `coord_select = 0; // G54` (L1091-1101). A
    `$J=G90` target adds the active `block_coord_system` (L585-597). A jog accepts only
    G20/G21, G90/G91 and G53 (L856-857), so the Frame's jogs cannot pin G54 themselves.
  - **Other firmware.** FluidNC `v4.0.3` `GCode.cpp` L1962 resets to G54 the same way.
    Smoothieware edge `Robot.cpp` L726-731 resets `current_wcs` on `M2`, but on `M30` only in
    grbl mode. On a Smoothieware board that is not in grbl mode, a program that ends with `M30`
    also leaves G55 active.
  - **KerfDesk, read on origin/main `76b994dd0`.** The files involved are identical to
    `71ff820ce`. After a completed external run, nothing reads `$G` or a WCS word:
    - `external-run.ts` adds no postamble.
    - `laser-post-job-settle.ts` sends only the settle marker.
    - `finishedJobStateReset` touches no WCS field.
    - `$G` readbacks run only at connect, Home, owned-reset requalification and settings read
      (`grbl-settings-actions.ts:134`).
    - The passive `[GC:` capture (`laser-line-handler.ts:233`) needs a `$G` reply.
    - Stop and the error path soft-reset, and the reset banner nulls `activeWcs`
      (`laser-line-handler.ts:410`). Only a program that runs to completion is affected.
    - `normalizeFrameWorkCoordinateSystem` returns at L73.
    - `frame-lines.ts:13` traces with `$J=G90 G21 X… Y…`.
    - The project preamble pins `G54` (`grbl-strategy.ts:96`, `cnc-grbl-transitions.ts:55`).
    - The start mark (`laser-job-start-mark-actions.ts:143`) and `active-wcs-warnings.ts` read
      the same stale field.
  - **Own REPRO** (written separately from the auditor's and deleted afterwards). The harness uses
    the real store, `startExternalProgram` and `normalizeFrameWorkCoordinateSystem`. The fake GRBL
    applies `G54`–`G59` and the `M2`/`M30` reset to its own modal state and answers `$G` from that
    state.
    - The store learned G54 from a `[GC:G0 G54 …]` line through the real line handler.
    - Then the program `G17G21G90G94G0 / G55 / G0X10Y10 / M4S500 / G1X20F600 / M5 / G92Z5`
      completed: the controller was in `G55` and the store had `activeWcs: "G54"`.
    - The next Frame WCS step returned `{"ok":true}` with **no writes**: no `$G`, no `G54`.
    - Control, the same program ending in `M30`: controller G54, store G54.
  - **Novelty.** This is not KNOWN as C2-P2-1. That finding's fix (#1378, ADR-375 Amd 3 decision 2)
    tracks only "a G54-G59 word KerfDesk sends itself". Its failure also ran the other way: a
    false "was using G55" warning and voided Work-Z evidence, not a displaced cut. The 2026-07-16
    claim verification (C8/A4) predicted this class "the day imported-program streaming ships", for
    resume only. None of the 3 open PRs touches these files.
  - **Severity P1 → P2.** The outcome is real, and silent under Current Position placement: the
    Frame traces around the head in G55, and the job's `G54` moves the cut by G54−G55. But every
    one of these must hold:
    - The setup has a non-G54 system whose offset differs from G54's.
    - An external program selects it and runs to completion with no `M2`/`M30` after the switch.
      FreeCAD's `grbl_post.py` postamble ends in `M2`, and on the ordinary multi-fixture CAM path
      the program end resets to G54.
    - No Home, reconnect, reset or settings read happens before the next project Frame.

    That is an unusual file on an uncommon setup. It is a broken contract (NN21 / ADR-565) with a
    clear failure scenario, which is METHOD §3 P2. It is not a P1 on a common path.
- **Fix direction:** After an external run ends (complete, stopped or errored), set `activeWcs` to
  null, or apply `wcsSelectedByLine` to the acknowledged external lines with GRBL's `M2`/`M30`
  reset. The next Frame then reads `$G` and selects G54. Optionally pin `G54` in the external
  baseline, as the project program already does.

### P2-1 — An external program that moves Z0, sets a tool length offset or changes tools leaves the probed work Z0 "current"; the next CNC project Start skips its Zero-Z gate, though the Console voids the same evidence for the same commands

- **Where:**
  - `src/ui/state/laser-console-actions.ts:340-347`: the Console's `coordinates-z` and `tool`
    effects clear `workZZeroEvidence` and bump `workZReferenceEpoch`.
  - `src/core/controllers/console-state-effect.ts:20-48` classifies `G10`, `G92`, `G54`–`G59`,
    `G43.1`, `G49`, `M6` and `T`.
  - No external-run or stream path applies this classification (`external-run.ts:235-260`).
  - `src/ui/laser/cnc-start-advisories.ts:28-39` and `work-z-zero-evidence.ts:68-85` treat the
    evidence as current while the epoch matches.
  - Marlin variant: `src/ui/state/host-recorded-origin.ts:30-46` derives the machine position from
    KerfDesk's own recorded G92 shift. A G92 inside an external Marlin program is invisible to it.
- **Anchor:**
  - **Twin:** the Console's state-effect invalidation, against a streamed external line with the
    same words.
  - **Contract:** `CNC_NO_WORK_ZERO_START_MESSAGE` (cnc-start-advisories), the depth gate. "Zero
    Z (G92 Z0) or a successful settled probe" alone may satisfy it. ADR-630 says the Frame does
    not prove Z.
  - **Ground truth:** gnea/grbl `gcode.c:1092-1095`. Program end resets neither the G92 offset nor
    the TLO. G92 is cleared only by `G92.1` or reset (`:1039`, `gc_init`). The TLO applies to every
    later absolute Z (`:596`).
- **Scenario:**
  1. The operator probes Z0 on the stock and runs an external CNC program. It begins
     `G92 X0 Y0 Z0` (a common "zero here" idiom), or it sets `G43.1 Z-3`, or it changes bits with
     `M6 T2` on grblHAL.
  2. The program ends. GRBL keeps the G92 shift or the TLO.
  3. Next, a KerfDesk CNC project. Start finds the probe evidence current for the selected bit, so
     it asks for no Zero Z. The job cuts at the shifted Z, for example 5 mm in the air, or 3 mm
     too deep.
  4. The external review named G92 as moving "its own origin" for that program's moves. It did
     not say the shift outlasts the program. It said nothing about G43.1 beyond "does not
     interpret". Only `G10 L2`/`L20` carries "Later jobs also start from the changed origin".
  5. On Marlin, an external `G92` leaves `wcoCache` stale. The bed and zone checks, the jog
     limits and Reset origin's restoring `G92` then use a wrong machine position. This step is
     READ only.
- **Evidence:** REPRO + READ.
  - Same store repro as P1-1. After `G92Z5` streamed and the job settled:
    `"zEvidenceCurrent":true`.
  - `cncWorkZeroStartIssue` would therefore return null.
  - **Novelty:** C5's "Not verified" notes that grblHAL `$TLR`/`$TPW` keep Z evidence (Console
    only). E3-P2-1 covers the M0 bit change *inside* an external tile run, not the evidence left
    for the next job.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE + READ); P2 kept. What would refute it: GRBL
  clearing G92 or the TLO at program end, or a stream or post-job path voiding Work-Z evidence.
  Neither holds.
  - **Firmware.** The gnea/grbl `gcode.c` program-end branch (L1091-1125) resets only modal groups.
    It never touches `coord_offset` (G92) or `tool_length_offset`, and its comment says the
    remaining groups and F, S, T, H "do not reset". A `G92 Z` therefore survives even an `M30`, so
    this trigger does not need a missing `M30`.
  - **Own REPRO** (the P1-1 store harness). After `G92Z5` streamed and the job settled,
    `isWorkZZeroEvidenceCurrent` was still `true`.
  - **Code.** On origin/main, every site that sets `workZZeroEvidence: null` is in the Console,
    Frame WCS selection, origin, probe, Home, reset or disconnect code. None is on the stream or
    post-job path. `finishedJobStateReset` holds no Z field.
  - **Twin.** The Console classifies `G92 Z`, `G10 … Z`, `G43.1`, `G49`, `M6` and `T` as
    `coordinates-z` or `tool` (`console-state-effect.ts:20-48`) and voids the evidence
    (`laser-console-actions.ts:340-347`).
  - **Severity, P2 kept.** The dangerous direction, a deeper cut from `G43.1`, needs idioms that
    are rare in GRBL job files. The common `G92 X0 Y0 Z0` "zero here" idiom usually zeroes at the
    stock top, or after a CNC Frame's retract it makes the cut visibly airborne.
  - The Marlin `wcoCache` step is READ only (PLAUSIBLE).
  - Note (READ): an external program's `M0` manual bit change (E3-P2-1's path) leaves the old bit's
    evidence current for the next project in the same way. `M0` is not a tool effect, and the
    selected bit in KerfDesk does not change.
- **Fix direction:** classify the external program once, before Start, with
  `commonConsoleStateEffect` per line. When it holds coordinate, tool or WCS effects, apply the
  matching Console patch when the run ends: void Z evidence, null `wcoCache`/`activeWcs`, and on
  Marlin forget the host-recorded shift. Also say in the review that G92, G43.1 and T/M6 persist
  after the program.

### P2-2 — FluidNC parameters and expressions run, but the Inspector drops their lines as "Unreadable lines … skipped": the Frame outline misses the motion (110 mm in the repro), and an expression with `*` is refused as a checksum

- **Where:** `src/core/gcode/word-scan.ts:111-131` (`scanCompleteGcodeWords` returns null, so the
  line is junk); `src/core/gcode-view/finding-checks.ts:51` ("held no recognizable G-code words
  and were skipped"); `src/core/external-program/normalize-external-program.ts:268-270` (any `*`
  means checksum); `external-program-review.ts:191-199` (only `skippedMotions` get the "not in the
  Frame outline" warning).
- **Anchor:**
  - **Contract:** ADR-630 Amendment 2 item 4: "A move the Inspector still cannot read is named as
    not in the Frame outline." Refusals must be factual (ADR-630 "Refusals").
  - **Ground truth:** FluidNC v4.0.3 `GCode.cpp:314-327` (`#` assignment, `O`-word flow control) and
    `Parameters.cpp:583-584` (`read_number` evaluates `[expr]`; `#n` reads a parameter).
- **Scenario:**
  1. A FluidNC owner runs a parametric macro file:
     `#1=120` / `G0 X0 Y0` / `G1 X#1 Y10 F600` / `G1 X10 Y10`.
  2. The Frame traces X 0..10, Y 0..10. FluidNC drives to X120.
  3. In a `G91` program, `G0 X[5+5]` / `G0 X10`, the Frame traces 0..10 while FluidNC moves 0..20.
     Every relative move after the expression line is misplaced.
  4. The review says only "Unreadable lines: N line(s) … were skipped". That reads as if the
     controller skips them too.
  5. The same file with `X[5*2]` is refused: "carries a checksum (*) … GRBL rejects the line".
- **Evidence:** REPRO (`zz-e4-chain` batches 2 and 3), FluidNC dialect:
  - `fluidnc param absolute`: envelope `{0,0,10,10}`, warnings
    `["Unreadable lines: 2 line(s) held no recognizable G-code words and were skipped."]`;
  - `fluidnc expression relative no star`: envelope maxX 10, the same warning;
  - `fluidnc expression relative`: refused, "Line 3 (G0X[5*2]) carries a checksum (*)".
  - **Novelty:** 26-P3-5 is about a space inside a number (GRBL). 26-K1 / #1368 is about plane
    arcs. Neither covers parameters or expressions.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE); P2 kept. What would refute it: FluidNC not
  evaluating `#` or `[…]`, or KerfDesk not sending those lines. Neither holds.
  - **Firmware, FluidNC tag `v4.0.3`, fetched independently.**
    - `collapseGCode` (`GCode.cpp` L157-199) strips spaces and upcases. It keeps `#`, `[`, `]` and
      `*`.
    - `#` starts an assignment (L314-322, `assign_param`).
    - Every word value goes through `read_number` (L335). That function evaluates `#n` and
      `[expr]` (`Parameters.cpp` L569-588), and `Expression.cpp` L416 implements `*`.
    - `Channel.cpp`, `Protocol.cpp` and `GCode.cpp` have no checksum handling.
  - **Own REPRO**, using the Run dialog chain as `RunGcodeFileDialog.tsx:70-105` wires it:
    - `#1=120` and `G1X#1Y10F600` are in the sent bytes. The envelope is `{0,0,10,10}`, and the
      only warning is "Unreadable lines: 2 line(s) … were skipped".
    - `G91 / G0X[5+5] / G0X10` sends the expression line. The envelope's maxX is 10, while
      FluidNC reaches X20.
    - `G0X[5*2]` is refused as "a checksum (*) … GRBL rejects the line".

    The controller runs these lines, but the Frame and the bounds checks leave them out. That
    breaks ADR-630 Amd 2 item 4.
  - **Code on origin/main.** The chain differs from HEAD only in the stock-GRBL paths that #1384
    added (`grblReviewText`, `stockGrbl`), which do not apply to FluidNC. `word-scan.ts`,
    `finding-checks.ts` and `normalize-external-program.ts` are unchanged.
  - **Severity, P2 kept.** Parametric FluidNC files are uncommon, and the review does show a
    warning, but that warning names neither the controller running the line nor the Frame.
- **Fix direction:** For FluidNC (and grblHAL, whose expressions are a build option), treat a junk
  line that holds `#`, `[`, or an `O` word as unplaced `origin` motion with the explicit "not in
  the Frame outline … the head still makes it" warning. If no envelope is left, refuse (no finite
  envelope). Apply the `*` checksum refusal only outside `[...]`, or only for `N…*nn` framing.

### P2-3 — The review tells the operator an `M1` makes the controller hold until cycle start; stock GRBL and FluidNC ignore `M1`, so a planned stop (to move a clamp or check a bit) never happens

- **Where:** `src/core/external-program/external-program-review.ts:117-122`
  (`c.m.has(0) || c.m.has(1)`, one warning for both).
- **Anchor:**
  - **Ground truth:** gnea/grbl `gcode.c:251` "case 1: break; // Optional stop not supported.
    Ignore."; FluidNC main `GCode.cpp:813-816` and v4.0.3 `:634-636` "M1 - Optional Stop not
    supported"; grblHAL `gcode.c:1825-1827` stops unless optional stop is disabled.
  - **Contract:** ADR-630 "Review and Start": the Run dialog is the one review for the file, and
    its warnings must say what the controller does.
- **Scenario:**
  1. A file posted for LinuxCNC or Mach3 has `M1` before a step where the operator moves a hold-down
     clamp.
  2. On stock GRBL or FluidNC the review says "The program stops with M0 or M1. The controller
     holds there until the machine's own cycle start is pressed".
  3. The operator relies on that stop. The machine runs straight through `M1` into the clamp.
- **Evidence:** REPRO (`zz-e4-chain`, `M1 only grbl` and `M1 only fluidnc`). The program is
  `G21 / G0 X0 Y0 / G1 X10 F100 / M1 / G1 X20 / M5`, and both dialects give exactly that warning.
  **SOURCE:** as quoted above.
  - **Novelty:** E3-P2-1 is about `M0` at KerfDesk's own tile bit changes. No audit covers `M1`.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE); P2 kept. What would refute it: a stock GRBL or
  FluidNC build that holds at `M1`, or a review that tells dialects apart. Neither exists.
  - **Firmware, fetched independently.**
    - gnea/grbl master `gcode.c` L251: `case 1: break; // Optional stop not supported. Ignore.`.
      `gcode.h` L94 says "Not supported, but valid and ignored".
    - Stock GRBL has no compile option for it in `config.h`. `M1` is ignored unconditionally, not
      "ignored unless enabled".
    - FluidNC `v4.0.3` `GCode.cpp` L633-635 only sets the modal-group bit ("M1 - Optional Stop
      not supported").
    - grblHAL master `gcode.c` L1825-1827 stops unless optional stop is disabled by a signal or a
      flag.
  - **Own REPRO.** `G21 / G0 X0 Y0 / G1 X10 F100 / M1 / G1 X20 / M5` gets the same "stops with M0
    or M1 … holds there until … cycle start" warning on `grbl-v1.1`, `fluidnc` and `grblhal`.
    `external-program-review.ts:121-125` is unchanged on origin/main.
  - **Severity, P2 kept.** The review promises a physical stop that never happens. Reach is limited
    to files posted with `M1`.
- **Fix direction:** Split the warning by connected dialect. On stock GRBL and FluidNC, say "`M1`
  (optional stop) is ignored; the program does not stop there". On grblHAL keep the hold text, and
  name the optional-stop switch.

### P2-4 — On Smoothieware, lowercase lines and `M28`/`M1000` pass the normaliser and run as shell or SD-card commands (reboot, file truncation), reported only as "Unreadable lines … skipped"; the `$` lines the same shell receives are refused

- **Where:** `src/core/external-program/normalize-external-program.ts:257-274`. `lineRefusalOf`
  refuses only `$`, `[`, Marlin `N`, `*` and GRBL block conflicts, and `canonicalLine` keeps
  case. `finding-checks.ts:51` produces the only warning.
- **Anchor:**
  - **Twin:** ADR-630 Amendment 1 refuses `$` lines as controller commands that "belong in the
    Console". On Smoothieware the same `SimpleShell` handles `$` and lowercase lines
    (`SimpleShell.cpp:210-213`), and `M1000` hands its text to the shell
    (`GcodeDispatch.cpp` case 1000). The Marlin Console blocks `M500`/`M502` (C6-P3-2), but the
    external path streams them.
  - **Ground truth:** Smoothieware edge `GcodeDispatch.cpp`:
    - "ignore all lowercase as they are simpleshell commands";
    - case 28: `upload_filename = "/sd/" + single_command.substr(4)`, then
      `fopen(…, "w")`, and every later line is written to it until `M29`;
    - case 500 saves `config-override`; case 502 deletes it.
  - `SimpleShell.cpp:683-686`: `reset` reboots in 5 s. `dfu` and `break` take no arguments.
- **Scenario:**
  1. A file downloaded from a sharing site holds `M28 Xconfig`. It is normalised to `M28Xconfig`,
     which Smoothie opens as `/sd/config`.
  2. The operator Frames and Starts it. The review lists one warning: "Unreadable lines: 1
     line(s) held no recognizable G-code words and were skipped."
  3. Smoothie truncates its config file and writes the rest of the job into it, acknowledging each
     line with `ok`. KerfDesk reports a finished job, and nothing moved. The board's
     configuration is gone at the next boot.
  4. With a line `reset` (or `M1000reset`), the board reboots mid-job. With lowercase G-code
     (`g1x10y10`), the Frame traces a move that Smoothie answers with
     "error:Unsupported command", which stops the job.
  5. On Marlin, `M92 X40` then `M500` persists a wrong steps/mm. The review shows the generic
     "unsupported … cannot be placed" lines.
- **Evidence:** REPRO (`zz-e4-chain`), Smoothieware dialect:
  - `smoothie M28` sends `"M28Xconfig"`, warnings `["Unreadable lines: 1 line(s) held no recognizable G-code words and were skipped."]`;
  - `smoothie lowercase reset` and `smoothie M1000reset` give the same single warning;
  - `smoothie lowercase gcode` gives envelope 10×10 and no warnings;
  - `marlin M500` gives the generic Marlin warnings.
  - **SOURCE:** as quoted.
  - **Novelty:** C6-P3-3 covers the Smoothieware *Console* (`M500`, `M1000 <shell>` unconfirmed),
    not external programs. No open PR touches the normaliser.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE); P2 kept (L5). What would refute it: KerfDesk
  refusing or upcasing these lines on Smoothieware, or Smoothie not acting on them. Neither holds.
  - **Firmware, Smoothieware edge, fetched independently.**
    - `GcodeDispatch.cpp` L79-81 hands lowercase lines to the shell.
    - `M28` (L228-245) opens `"/sd/" + single_command.substr(4)` with `fopen(…, "w")` and replies
      `ok`. While the upload is open, every later G/M/T/S/N line is written to the file and
      acknowledged with `ok`, until `M29` (L428-457). KerfDesk's settle marker and status
      polling would therefore report a finished job.
    - `M1000` (L303-324) passes the rest of the line to `SimpleShell::parse_command` and prints
      `ok`.
    - `SimpleShell.cpp` matches commands by prefix (`strncasecmp`, L192-199). `reset` reboots in
      5 s (L683-686). A bare lowercase shell line prints no `ok` (L263-295), so the stream also
      waits on it.
  - **Own REPRO.**
    - `M28 Xconfig` is sent as `M28Xconfig`, and `substr(4)` is `config`. The only warning is
      "Unreadable lines: 1 line(s) … skipped".
    - `reset` and `M1000 reset` get the same single warning.
    - Lowercase `g21 / g0 x0 y0 / g1 x10 y10 …` gives a 10×10 envelope and **no** warning.
    - `$H` in the same kind of file is refused.
  - **Twin.** `smoothieware/console-command.ts:89-99` refuses lowercase G-code and shell lines that
    get no `ok`, in the Console.
  - **Severity, P2 kept.** Losing the board's configuration needs a crafted or unusual file, which
    is METHOD §3 P2 ("unusual conditions"). Lowercase G-code fails visibly with
    `error:Unsupported command`.
  - **Fix, for a maintainer.** On Smoothieware, refuse with the `$` refusal's wording any line whose
    first character is lowercase, and `M28`/`M29`/`M32`/`M1000`/`M500`–`M503`. No exploit was
    written.
- **Fix direction:** For Smoothieware, refuse lines whose first character is lowercase. Also
  refuse `M28`/`M29`/`M30`/`M32`/`M1000`/`M500`–`M504`, as the `$` policy refusal does, and say
  why. For Marlin, refuse or name `M500`/`M502`/`M92`… as persistent settings writes, as the
  Marlin Console already does.

### P3-1 — The block check misses `G49` with an axis command, which stock GRBL and FluidNC reject whole (`error:24`), so the outline includes a move that never runs and the job stops there

- **Where:** `src/core/external-program/controller-block-check.ts:72-74` (`takesAxisWords` omits
  49). Unchanged on origin/main, where #1384's `grbl-block-rejection.ts` returns null for any G49.
- **Anchor:**
  - **Contract:** ADR-630 Amendment 1 item 11 (`error:24` lines are refused).
  - **Ground truth:** gnea/grbl `gcode.c:209-215`, `case 43: case 49:` "if (axis_command) {
    FAIL(STATUS_GCODE_AXIS_COMMAND_CONFLICT)" and `axis_command = AXIS_COMMAND_TOOL_LENGTH_OFFSET`.
    FluidNC `GCode.cpp:720-729` is the same. grblHAL `gcode.c:1670-1684` conflicts only for
    `G43.1`.
- **Scenario:** A Mach3-style line `G0 G49 X40 Y40` or `G49 G0 Z5`. The Frame traces it. GRBL
  answers `error:24`, and KerfDesk resets mid-job (ADR-215).
- **Evidence:** REPRO (`zz-e4-chain`, `G49 G0`): not refused, envelope to 40/40, and only "does not
  interpret G49 … or answer with an error". **SOURCE** as quoted.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE); P3 kept.
  - In gnea/grbl `gcode.c`, `case 43: case 49:` fails if `axis_command` is already set, and then
    sets it (L209-215). `case 0..3, 38` fails the same way (L163-167). `G49G0X40Y40` is therefore
    `error:24` in either word order.
  - REPRO on `grbl-v1.1` and `fluidnc`: the line is not refused, the envelope is 40×40, and the
    only warning is "does not interpret G49".
  - On origin/main, `grbl-block-rejection.ts` returns null for G49 explicitly.
- **Fix direction:** Add 49 to `takesAxisWords` for stock GRBL and FluidNC (and to 43 where the
  dialect supports G43).

### P3-2 — Program Health says a feed move with no `F` is rejected by "most controllers", but GRBL keeps `F` across programs and runs it at the previous job's feed; the `S` warning beside it says the opposite, correctly

- **Where:** `src/core/gcode-view/finding-checks.ts:172-190` (detail at `:187`), passed into the
  review by `external-program-review.ts:154-156`.
- **Anchor:**
  - **Twin:** `external-program-review.ts:107-110` ("starts at the S value the controller already
    holds, which may be left from an earlier program").
  - **Ground truth:** gnea/grbl `gcode.c:421` "Push last state feed rate", `:913`, and the comment at
    `:1095` ("the modal words [F,S,T,H] do not reset"). error:22 is raised only when F is 0,
    which means no F since reset (`:664`).
- **Scenario:** A hand-written external engrave sets `S` but never `F`. It runs after a KerfDesk
  fill whose last F was 6000 mm/min, so it engraves at 6000 instead of failing. The review said
  it would be rejected.
- **Evidence:** REPRO (`zz-e4-chain`, `grbl no F ever`):
  `"Cutting moves with no feed rate: 2 cutting move(s) run with no F word ever set. Most controllers reject a feed move without a feed rate."`.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE); P3 kept.
  - gnea/grbl `gcode.c` L421 pushes the last state's feed rate. `error:22` comes only when F is 0
    (L664).
  - The REPRO gives the same "Most controllers reject" text.
- **Fix direction:** For GRBL-family dialects, say the moves run at the feed the controller still
  holds from an earlier program, or are rejected only right after a reset.

### P3-3 — A Marlin program that declares `G20` is reviewed as "Units: not declared; the G21 sent first sets millimetres", with a zero-extent warning and "one move" not read

- **Where:** `src/core/external-program/marlin-program-reader.ts:36` (`G20` is not in
  `NO_PARAMETERS`, so it falls to `unsupportedLine` `:195-199`); `external-program-review.ts:306-311`;
  `RunGcodeFileSummary.tsx:14`.
- **Anchor:** **Twin:** the reader's own warning ("following coordinates cannot be placed")
  against the Units line and the point-envelope warning. **Contract:** ADR-630 "the units the
  program declares".
- **Scenario:** `G20 / G0 X1 Y1 / G1 X2 Y2 F10` on Marlin. Units are shown as not declared, the
  Frame visits a point, and the review says "could not read one move" while two moves are unplaced.
- **Evidence:** REPRO (`zz-e4-chain`, `marlin G20`): `"units":"undeclared"`, envelope `{0,0,0,0}`,
  the three warnings quoted in the table.
- **Refuter:** **CONFIRMED** (REPRO); P3 kept. The output was identical: `units: "undeclared"`, a
  zero envelope, and "could not read one move" while two moves are unplaced.
- **Fix direction:** Record `G20` as a declared unit even when the reader cannot place it. Let the
  "unplaced" count include every move after an `origin` unplace.

### P3-4 — On Smoothieware the GRBL block check refuses lines Smoothie runs (`G90G91G1X10` "error:21")

- **Where:** `src/core/external-program/normalize-external-program.ts:271`. Only Marlin is
  excluded from `controllerBlockRejection`.
- **Anchor:** **Contract:** ADR-630 refusals are factual ("one the controller rejects whole").
  **Ground truth:** Smoothieware `GcodeDispatch.cpp` splits a line at each `G`/`M`
  (`find_first_of("GM", 2)`) and dispatches each part, with no modal-group check.
- **Scenario:** A Smoothieware file with `G90 G91 G1 X10` is refused with a GRBL error code. The
  Inspector would read it as Smoothie runs it (G91 last). The reach is low.
- **Evidence:** REPRO (`zz-e4-chain`, `smoothie G90G91`).
- **Refuter:** **CONFIRMED** (REPRO + SOURCE); P3 kept.
  - Smoothieware edge `GcodeDispatch.cpp` L143-153 splits a line at each `G`/`M` after position 2
    and dispatches each part. It has no modal-group check.
  - The REPRO refuses the line with "(error:21)".
  - The refusal fails safe, so the reach stays low.
- **Fix direction:** Skip the GRBL block check for Smoothieware, or replace it with a
  Smoothie-specific split reading.

## KNOWN (re-observed, not re-raised)

- **26-P3-1:** review warnings and Marlin reader warnings count lines of the sent program;
  refusals count file lines.
- **C6-P3-4:** Marlin truncates past 95 characters; there is no Marlin line check.
- **26-K-9 / 18-P3-2:** the G28/G30 intermediate point is left out of the outline.
- **26-K-4 / PV-4 class:** other lines GRBL rejects (error:22, error:31, error:33) are not
  refused. With P-2 (protocol audit 2026-10-20), any `error:N` resets mid-job. D-6 (design audit
  2026-10-20) proposes a `$C` check run.
- **26-P3-5:** a space inside a number makes the Inspector's own view junk. The Run path sends
  canonical bytes, so it is not reached there.
- **D4-P2-1 / D5-P2-2 (#1390), C6-P2-1 (#1380), 26-K1 (#1368):** fixed on origin/main; skipped.
- **Protocol P-1 (ADR-644):** EEPROM-writing lines stream alone (`streamer.ts:217`); verified.
- **E3-P2-1:** `M0` in KerfDesk's own tile files run through Run G-code file.
- **C3 note / ADR-373:** a laser left on at program end is warned only.
- **C6-P3-2 / C6-P3-3:** the Marlin and Smoothieware Consoles let some persistent writes through
  (P2-4 is the external-program twin).
- **05-P3-1:** the recovery capsule is not retired; fixed on main by `startUntrackedRun`.

## Refuted

Candidates dropped before raising:

- *G20, G91, G93, G18 or M3 left by an external program poison the next KerfDesk job.* No.
  Every KerfDesk preamble pins `G21 G90 G54 G94` (G17 with arcs) and `M3/M4 S0`
  (`grbl-strategy.ts:96`, `cnc-grbl-transitions.ts:52-60`). Only the WCS (through the Frame,
  P1-1) and the G92/TLO/tool state (P2-1) survive.
- *The stall watchdog resets the controller during a long `M0`.* No. Hold and Door pause the
  watch (`laser-stream-stall.ts:87-89`); Marlin's busy keepalive restarts it.
- *A line too long for Smoothieware's 256-byte USB buffer slips through.* Not reachable at the
  default 127/128-byte RX window, which refuses it first. Only a hand-raised `rxBufferBytes`
  above about 190 would expose `USBSerial.cpp`'s flush.
- *"KerfDesk's Resume does not release" an `M0`.* Mostly true. Resume requires a KerfDesk Pause
  (`laser-job-pause-resume.ts:176-202`), and Pause then Resume would release it. That is a
  wording nuance, not raised.
- *Smoothieware `M30` deletes an SD file.* `GcodeDispatch.cpp` runs `M30` as `M2` only in grbl
  mode and is a no-op otherwise. `Player.cpp` has no `M30` handler. Not raised.

## Verified clean

- **Canonical line = GRBL's collected line.** Comments (`(…)`, `;`, unclosed `(`, nested parens
  leaving `c)`), whitespace and `/` are handled exactly as `protocol.c` does. A realtime byte
  inside a comment is removed with the comment. Lowercase is sent as written, and GRBL upcases it.
  `%` lines are dropped. Lone CR, CRLF and LF split lines the way the source pane does.
- **Refusals:** NUL; `?`, `!`, `~`, Ctrl-X, grblHAL Ctrl-C/T/Y, BS and DEL; bytes above 0x7F
  outside comments; `$` and bracket commands, also behind `/` or spaces; Marlin `N`/`*`;
  `error:21/24/25` blocks (except P3-1).
- **Line length:** an 89-significant-character canonical line is blocked before Frame with the
  stock GRBL 79 message. The count is made after normalisation, so comments and spaces in the file
  never count. grblHAL 256 and FluidNC's 127-byte payload are applied, and Start re-checks
  (`laser-job-actions.ts:247`). The RX-window check covers Smoothieware.
- **Units:** G20, G20+G91 from a non-zero head, mixed G20/G21 and G20 arcs. The envelope is exact
  in mm and the Frame and bed checks are in mm (repro table). Inch status reports are converted
  for the start position (`reportedWorkPositionMm`).
- **Baseline:** GRBL-family `G17G21G90G94G0`; Smoothieware adds `M221 S100`; Marlin `G21`/`G90`.
  The review skips the baseline lines for its S, laser-on and unit checks.
- **Program end:** lines after `M2`/`M30` are sent, run on GRBL and are drawn, with a Program
  Health notice. The streamer completes on acknowledgements, not on `[MSG:Pgm End]`. The only
  thing added after the program is the settle marker.
- **EEPROM writes** (`G10`, `G28.1`, `G30.1`) stream alone (ADR-644).
- **Fixed since the audited tree:** on `71ff820ce`, `G10 L1/L10/L11` (grblHAL tool table) got no
  warning at all, because `G10` and `L` were in `EXPLAINED_WORDS`. #1384 removed them on main, so
  they are now named as not interpreted, and stock GRBL gets "G10 L1 is unsupported".

## Not verified

- No hardware. The P1-1 displacement is derived from `gcode.c`; the GRBL simulator has no G55.
- The Marlin host-recorded shift in P2-1 is READ only.
- Smoothieware's own `M0`/`M1` behaviour. The smoothieware.org summary lists both, but the
  source was not found in the fetched files.
- Smoothieware `M2` modal resets beyond `M5`/`M9`, so lines after `M2` on Smoothie were not
  checked.
- grblHAL builds with `NGC_EXPRESSIONS_ENABLE` (off by default), which would extend P2-2 to
  grblHAL.
- FluidNC O-word loops after canonicalisation (spaces removed inside `while`/`[…]`). The simple
  `#1=` and `[expr]` cases were enough for P2-2.
- The repros ran on `71ff820ce`. `origin/main` `ccc447579` was checked by reading, not re-run.
- **Refuter:**
  - The refuter's own repros also ran on `71ff820ce`. Every file they exercise for P1-1 and P2-1 is
    byte-identical on `origin/main` `76b994dd0`, whose merge #1393 adds only audit docs.
  - For the P2-2 to P3-4 chain, origin/main differs only in the stock-GRBL review paths that #1384
    added, as noted under each finding.
  - Only FreeCAD's `grbl_post.py` was checked for whether common CAM posts end in `M2`/`M30`.
    Fusion, Vectric, Carbide Create and Easel posts were not fetched.
  - The Smoothieware `M28` outcome is read from source, not run on a board.

```json
[
  {"id":"E4-P1-1","severity":"P2","area":"ctl-external-normalize","file":"src/ui/laser/frame-controller-readiness.ts","line":73,"anchor":"Contract: PROJECT.md NN21/ADR-565 Frame is spatial truth; ADR-375 Amd 3 (C2-P2-1) active WCS follows acknowledged G54-G59; Twin: acknowledgedWcsPatch/trackConsoleWcs vs streamed external lines; Ground truth: gnea/grbl gcode.c:223-227,504-511,585-597,1101","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An external program that leaves G55-G59 active (no M2/M30 after it) is not tracked: store keeps activeWcs G54, next project Frame returns already-g54 with no $G/G54 write and traces in G55, while the project program's own G54 runs the job at the G54 origin (refuter: P1 -> P2 for reach; needs a distinct non-G54 offset and a completed program with no M2/M30 after the switch; Smoothieware non-grbl mode also after M30)"},
  {"id":"E4-P2-1","severity":"P2","area":"ctl-external-normalize","file":"src/ui/gcode-inspector/external-run.ts","line":235,"anchor":"Twin: console-state-effect coordinates-z/tool invalidation (laser-console-actions.ts:340-347) vs streamed external lines; Contract: cnc-start-advisories Zero-Z gate; Ground truth: gnea/grbl gcode.c:1092-1095,1039,596 (G92/TLO persist past M2/M30)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"External G92 Z / G10 L2-L20 Z / G43.1 / M6-T leave workZZeroEvidence current; next CNC project Start skips its Zero-Z gate and cuts at the shifted depth; Marlin host-recorded G92 shift goes stale"},
  {"id":"E4-P2-2","severity":"P2","area":"ctl-external-normalize","file":"src/core/gcode/word-scan.ts","line":111,"anchor":"Contract: ADR-630 Amd 2 item 4 (unreadable move named as not in the Frame outline), factual refusals; Ground truth: FluidNC v4.0.3 GCode.cpp:314-327, Parameters.cpp:583-584","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"FluidNC #param/[expr] lines run but are dropped as 'Unreadable lines ... skipped': Frame X0..10 while FluidNC drives to X120; relative moves after them misplaced; X[5*2] refused as a checksum"},
  {"id":"E4-P2-3","severity":"P2","area":"ctl-external-normalize","file":"src/core/external-program/external-program-review.ts","line":117,"anchor":"Ground truth: gnea/grbl gcode.c:251 (M1 ignored), FluidNC GCode.cpp M1 not supported (main :813-816, v4.0.3 :634-636), grblHAL gcode.c:1825-1827; Contract: ADR-630 review states controller behaviour","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Review says M1 holds until cycle start; stock GRBL and FluidNC ignore M1, so a planned optional stop never happens"},
  {"id":"E4-P2-4","severity":"P2","area":"ctl-external-normalize","file":"src/core/external-program/normalize-external-program.ts","line":257,"anchor":"Twin: ADR-630 Amd 1 $-command policy refusal vs Smoothieware SimpleShell lowercase/M1000 lines, Marlin Console M500/M502 block (C6-P3-2); Ground truth: Smoothieware GcodeDispatch.cpp lowercase->shell, M28 fopen w + upload, M500/M502; SimpleShell.cpp reset","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Smoothieware lowercase lines (reset/dfu), M1000 and M28 (truncates /sd/config via M28Xconfig, swallows the rest of the job) pass with only 'Unreadable lines ... skipped'; Marlin M92+M500 streamed with generic warnings"},
  {"id":"E4-P3-1","severity":"P3","area":"ctl-external-normalize","file":"src/core/external-program/controller-block-check.ts","line":72,"anchor":"Contract: ADR-630 Amd 1 item 11; Ground truth: gnea/grbl gcode.c:209-215, FluidNC GCode.cpp:720-729 (G49 is an axis command)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"G49 with G0-G3/G10/G28/G30/G92 on one line is not refused though stock GRBL and FluidNC reject it whole (error:24); outline includes the move, job stops there"},
  {"id":"E4-P3-2","severity":"P3","area":"ctl-external-normalize","file":"src/core/gcode-view/finding-checks.ts","line":187,"anchor":"Twin: external-program-review.ts:107-110 retained-S warning; Ground truth: gnea/grbl gcode.c:421,913,1095,664","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Review says F-less feed moves are rejected by most controllers; GRBL runs them at the previous job's F"},
  {"id":"E4-P3-3","severity":"P3","area":"ctl-external-normalize","file":"src/core/external-program/marlin-program-reader.ts","line":36,"anchor":"Twin: Marlin reader unplaced warning vs Units line and point-envelope warning; Contract: ADR-630 declared units","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Marlin G20 program reviewed as 'Units: not declared; G21 sets millimetres', zero XY extent, 'one move' unread though two are unplaced"},
  {"id":"E4-P3-4","severity":"P3","area":"ctl-external-normalize","file":"src/core/external-program/normalize-external-program.ts","line":271,"anchor":"Contract: ADR-630 factual refusals; Ground truth: Smoothieware GcodeDispatch.cpp splits at each G/M with no modal-group check","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"GRBL error:21/24/25 block refusals applied to Smoothieware, which runs such lines"}
]
```
