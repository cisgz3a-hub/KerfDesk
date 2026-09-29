## ADR-525 - Time estimates model the controller's planner buffer (2026-09-29)

**Status:** Accepted; software verification only. | **Date:** 2026-09-29

Addresses finding G-1 of the 2026-09-29 lane G audit (G-code time estimates). It takes up what
ADR-432 left out ("modelling the finite planner ring in the estimate"). Emitted G-code, streaming,
recovery and the Frame-first Start policy (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237)
are unchanged: this decision changes estimates and countdowns only.

### Context

The job estimate, the live countdown and the G-code Inspector plan motion with one planner
(`core/motion-planner`, ADR-255). It planned each synchronized span with unlimited lookahead: a
block's entry speed was limited by its junction, the two blocks' feeds and the stop at the end of
the span, as if the controller could see every later move.

A streaming controller sees only what is in its planner buffer:

- GRBL 1.1 keeps `BLOCK_BUFFER_SIZE` 16 blocks (planner.h; config.h documents the override) and
  leaves one slot free to tell a full ring from an empty one (`plan_check_full_buffer`), so it holds
  15 blocks, the executing block included. The executing block keeps its slot until the stepper has
  prepared its last segment.
- `planner_recalculate` (planner.c) plans the newest block in the ring to an exit speed of zero:
  "The last (or newest appended) block is planned from a complete stop". The machine must be able to
  stop by the end of whatever it holds.
- The other families' usable sizes are already recorded for restart (controller audit OR-3):
  grblHAL 100, FluidNC 15, Smoothieware 32, Marlin 15. Ruida runs an uploaded job, not a stream.

So while block i executes, GRBL 1.1 holds blocks i to i + 14, and the speed leaving block i must be
able to fall to zero within the 14 blocks after it. On long moves this never binds. On short moves
it sets the speed: 14 raster pixels of 0.1 mm are 1.4 mm, and at 500 mm/s² the head cannot cross a
pixel boundary faster than sqrt(2 x 500 x 1.4) = 37.4 mm/s, whatever the feed. The audit timed a
0.1 mm grayscale raster at 6,000 mm/min with the Neotronics 4040 profile: Job Review estimated
37.1 s, and an independent model of a 15-block GRBL planner (written from planner.c) gave 66.1 s,
1.78 times as long.

### Decision

1. **One table of planner sizes.** `DEFAULT_PLANNER_BLOCKS` and its firmware sources move from
   `core/recovery/planner-backlog-restart.ts` to `core/motion-planner/controller-planner-blocks.ts`.
   Recovery re-exports it, so restart and the estimate read the same sizes.
2. **The planner models the ring.** `planVelocities` takes an optional `plannerBlocks`: the blocks
   the controller holds, counting the one executing. With a size N, each block's entry speed is
   first capped so it can fall to zero within the block itself and the next N - 2 blocks, N - 1
   blocks in all: a block's entry is the exit of the block before it, which is still executing and
   still holds one of the N slots. The junction caps and the usual backward and forward passes then
   run unchanged. The result equals a block-by-block model of the ring, in which each executing
   block's exit comes from a reverse pass over the blocks behind it with the newest ending at rest.
   The cap uses prefix sums of block lengths, so planning stays linear. Without a size, or with one
   that is not a whole number of at least 1, the plan is exactly what it was.
3. **Timing options carry the size.** `ProgramTimingOptions.plannerBlocks` reaches
   `buildProgramTime`, which plans each span with it; a span starts with an empty planner, as it
   does after a drain. `deviceProgramTimingOptions` fills it from the controller kind: the one it is
   given (the live countdown passes the connected controller), otherwise the profile's. A profile
   that names no controller is timed as GRBL 1.1, as its baud rate and arc chords already are. Ruida
   gets no size. Job Review, the pre-job estimate, the live countdown and the second-pass estimates
   all take their options from `deviceProgramTimingOptions`. The Inspector times opened and compiled
   programs for the current device (ADR-425), so `deviceInspectionTiming` carries the same size
   (`devicePlannerBlocks`) and `analyzeGcodeModel` passes it to `buildProgramTime`. Timing with bare
   limits and no device keeps unlimited lookahead.

### Consequences

- Estimates for GRBL-family machines on short-move programs rise to what the machine does. The
  audit's raster above now estimates 66.1 s against the independent model's 66.1 s (unidirectional:
  244.4 s against 244.4 s). On the default profile with 500 to 2,000 mm/s², the audit's six rasters
  now come 1.5 to 4.2% above the 15-block model; the excess is the estimator's existing full stop
  between G0 and G1 moves. Unlimited lookahead gives up to 44% less than that model; two of the six
  (3,000 mm/min, or 0.2 mm pixels) were never limited by the ring and barely change.
- Long moves are unchanged: the cap binds only where N - 1 blocks are shorter than the distance
  needed to stop from the feed. grblHAL's 100 blocks barely bind even on 0.1 mm pixels
  (99.5 mm/s at 500 mm/s²). No existing estimate test expectation changed.
- The model assumes the stream keeps the ring full. A serial link too slow to do so leaves fewer
  blocks and a slower machine; transport time is modelled separately and not combined with this.
- The family default is used, not a session's reported size (`Bf` at idle or `$I`). A firmware
  built with another size is timed with its family's default.
- GRBL's segment buffer and its re-planning of the executing block are not modelled. They change
  when the executing block's exit is decided, not the limit on it.
- Arcs count as the blocks the timing cuts them into: `mc_arc` chords for GRBL-family lasers
  (ADR-432), display chords elsewhere, which may differ from the controller's own count.

### Rejected alternatives

- **Simulating the ring block by block in the estimator.** Same result at N times the cost; it is
  kept as the test oracle (`plan-velocities.test.ts`) rather than the implementation.
- **A window of N blocks after the executing one.** It would credit the executing block's slot to
  lookahead that the ring does not have.
- **The session's reported planner size.** Only known while connected, and it would make the
  pre-job estimate depend on connection state. It can refine the live countdown later.
- **A calibration factor instead of the model.** A per-device scale cannot be right for both long
  vector moves and fine rasters.

### Tests

`plan-velocities.test.ts` (the ring model for sizes 1 to 100, the raster speed cap, a ring that holds
the whole span, sizes that are not whole numbers) and `program-planner-window.test.ts` (a raster row
with and without a 15-block planner, each controller family's size, a GRBL device's timeline).
