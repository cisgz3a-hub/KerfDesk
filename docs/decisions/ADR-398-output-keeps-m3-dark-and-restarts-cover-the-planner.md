## ADR-398 - Laser output never drains the planner with an M3 beam lit, and restarts cover the whole planner (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends the GRBL laser emitter of ADR-006/ADR-322, the Marlin output of ADR-095, recovery item 8
of ADR-362 and the resume evidence of ADR-341 Amendment 3. It changes the G-code of every
constant-power (M3) job, including the qualified Neotronics 4040 profile, so the snapshots change
with it. The Frame-first Start contract (PROJECT.md non-negotiable 21) is unchanged: nothing here
refuses a Frame or a Start.

### Context

Controller audit 2026-09-25, output-and-recovery track: OR-1 to OR-6, and MA-8 from the Marlin
track.

- **M3 output drained the planner with the beam lit (OR-1).** Under M3 the beam keeps its last
  power while the head is stopped. KerfDesk wrote lines that drain GRBL's planner directly after
  an M3 burn:
  - the between-pass `M3 S0` re-arm;
  - an air change (`M7`/`M8`/`M9`);
  - a power-mode change, including the image layer's opening `M5`;
  - a laser-off seek to where the head already was;
  - a zero-length raster row close.

  GRBL 1.1h then holds the lit, stopped head for its `$1` idle-lock dwell (25 ms by default), a
  dot at every pass seam. An air on-delay (grblHAL `$673`, FluidNC `coolant/delay_ms`) holds it
  for the whole delay: burn-through and fire risk. The Neotronics 4040 cuts in M3 by default.
- **Restarts skipped discarded moves (OR-2, OR-3).** A controller answers `ok` when a line is
  queued, not when it has moved. A stop that discards the planner (a reset) also discards
  acknowledged moves. The laser restart kept the acknowledgement frontier whenever no status report had
  shown a `Bf:` backlog, and stock GRBL 1.1h (`$10=1`), stock FluidNC and Smoothieware never
  report one. CNC pass proof used fixed reserves below the firmware maxima (grblHAL `$398` up to
  1000 blocks).
- **Marlin travel crawled (MA-8).** Stock Marlin has no rapid rate (`G0_FEEDRATE` is commented
  out, Configuration_adv.h:3721), so `G0 X.. Y.. S0` ran at the last cut feed while the estimate
  timed it as a rapid: 18.5 s estimated, about 82 s run in the audit's example.
- **Smaller defects.** xTool's own LightBurn device file sets `EnableGrblJCommand: false`, and
  the D1 Pro profiles drive `$J=` jog and Frame (OR-4). Real `.lbdev` files are JSON, which the
  importer rejected (OR-5). FluidNC's `$32`/`$30` are read-only proxies of its YAML config, and
  KerfDesk told the operator to write them (OR-6).

### Decision

1. **No planner drain with an M3 beam lit.** In a group the power word cannot change, so there
   is no between-pass re-arm. While M3 is in effect a laser-off seek to the current position is
   not written. After an M3 burn, a group's mode and air changes wait until after that group's
   first laser-off seek. When the next group starts where the last burn ended, a 1 mm laser-off
   move along its first edge and back takes the drain dark. M3 raster writes no zero-length row
   close, and an M3 image layer that ends on a burn leaves its closing `M5` for the next
   laser-off move. The job end (`M9`/`M5` after the last burn) is inherent to M3 and unchanged.
   Default M4 output changes only by losing the between-pass `M4 S0`.
2. **Restarts step back over the planner.** A planner-discarding stop with no report of its
   backlog records the controller's whole planner at the stop (`bound: 'planner-size'`). That is
   `$I` or the idle `Bf` when seen, else GRBL 15, grblHAL 100, FluidNC 15, Smoothieware 32 and
   Marlin 15 blocks. Marlin reports no planner, and the `M410` its Abort sends drops the whole
   planner (ADR-395; planner.cpp:1688-1689). A report that showed an empty planner is a frontier:
   the restart begins at the first move acknowledged after it. The restart hint says which bound
   applied. CNC pass proof uses the firmware maximum plus its
   segment buffer when the planner size is unknown (grblHAL 1010 lines, FluidNC 140, stock GRBL
   32), and the recorded planner size when it is known. A restart may re-burn moves that had
   already run; that is preferred to skipping moves that never ran.
3. **Marlin travel carries its own feed.** Every Marlin `G0` carries `F<profile max feed>`, the
   rate the estimator uses for rapids, and the first feed move after it restates the cut feed.
   GRBL-family and Smoothieware output is unchanged.
4. **xTool keeps `$J=`.** The closed firmware's `$J=` handling is not public, so the D1 Pro
   profiles keep `$J=` jog and Frame. Their evidence note, shown under Profile details, states
   xTool's `EnableGrblJCommand: false` and that a Jog or Frame error means the firmware does not
   accept `$J=`.
5. **JSON `.lbdev` import.** The first `DeviceList` entry maps width and height to the bed,
   `S_Scale` to Max S, `BaudRate`, `MirrorX`/`MirrorY` to the origin corner and `AirAssistM7` to
   the air command. Anything else is listed for review.
6. **FluidNC advice names the YAML.** On FluidNC, `$32` and `$30` findings say to change the
   spindle type or `speed_map` in the YAML config, or to choose the constant-power dialect,
   instead of writing a read-only setting.

### Consequences

- Constant-power jobs on GRBL, grblHAL and FluidNC no longer mark pass seams or dwell lit through
  an air delay. Their G-code changes; the snapshot updates are part of this decision.
- A laser restart after an Abort or stream error may repeat up to a planner's worth of moves.
- Marlin estimates and run times agree.
- Regression tests (with the lit-drain checker in `grbl-lit-drain-checker.ts`):
  `grbl-strategy-m3-lit-drain.test.ts`, `emit-gcode-m3-lit-drain.test.ts`,
  `planner-backlog-restart.test.ts`,
  `checkpoint-interruption-planner-size.test.ts`, `cnc-resume-point-planner-reserve.test.ts`,
  `cnc-pass-recovery-model.test.ts`, `marlin-travel-feed.test.ts`, `brand-laser-profiles.test.ts`,
  `lbdev-import.test.ts`, `controller-readiness.test.ts`, `recovery-deep-audit.stress.test.tsx`.
