// grbl-sim-planner — models GRBL's bounded motion-block planner and, above
// all, the `ok` the firmware withholds while that planner is full.
//
// Firmware ground truth, read from gnea/grbl v1.1 source on 2026-07-27:
//  * `grbl/planner.h`: `#define BLOCK_BUFFER_SIZE 16` (15 with USE_LINE_NUMBERS).
//  * `grbl/motion_control.c` `mc_line()` opens with a spin loop:
//      do {
//        protocol_execute_realtime();
//        if (sys.abort) { return; }
//        if ( plan_check_full_buffer() ) { protocol_auto_cycle_start(); }
//        else { break; }
//      } while (1);
//    so a motion command BLOCKS inside `gc_execute_line()` until the stepper
//    retires a block and frees a slot.
//  * `grbl/protocol.c` `protocol_main_loop()` reports with
//      report_status_message(gc_execute_line(line));
//    so the `ok` is transmitted only after `gc_execute_line()` RETURNS. The ack
//    is therefore withheld for exactly as long as the planner stays full.
//  * While blocked in that spin loop the main loop is NOT reading serial, so
//    host bytes pile up in the RX ring (`grbl-sim-rx-window.ts`). That is the
//    overrun a character-counting sender exists to prevent.
//  * grblHAL differs: the planner depth is a runtime setting (`$398`,
//    `DEFAULT_PLANNER_BUFFER_BLOCKS 100` in `grblHAL/core/config.h`).
//
// Only ONE line can ever be blocked at a time: the main loop is single
// threaded, so it is stuck inside `gc_execute_line()` for that one line and
// reads nothing else until a slot frees. Hence a single `withheldAck`, not a
// queue of them.

/** Planner depth on stock grbl 1.1 (`BLOCK_BUFFER_SIZE`). */
export const GRBL_PLANNER_BLOCKS = 16;

/** grblHAL's default planner depth (`$398` / `DEFAULT_PLANNER_BUFFER_BLOCKS`). */
export const GRBLHAL_PLANNER_BLOCKS = 100;

export type GrblSimPlanner = {
  /** Motion blocks the planner can hold at once. */
  readonly capacity: number;
  /** Blocks currently queued for the stepper. */
  readonly blocks: number;
  /**
   * The line whose `ok` the firmware is currently withholding, or null when the
   * main loop is free. Non-null means the firmware is spinning inside
   * `mc_line()` and has stopped reading serial.
   */
  readonly withheldAck: string | null;
};

export function createPlanner(capacity: number = GRBL_PLANNER_BLOCKS): GrblSimPlanner {
  return { capacity, blocks: 0, withheldAck: null };
}

export function isPlannerFull(planner: GrblSimPlanner): boolean {
  return planner.blocks >= planner.capacity;
}

/**
 * True while the main loop is stuck in `mc_line()`. The caller must stop
 * consuming the RX ring for exactly this long — that stall is what makes host
 * bytes accumulate, and what the sender's character counting has to survive.
 */
export function isPlannerBlocked(planner: GrblSimPlanner): boolean {
  return planner.withheldAck !== null;
}

/** Occupy one planner slot. Caller must have checked `isPlannerFull` first. */
export function admitBlock(planner: GrblSimPlanner): GrblSimPlanner {
  return { ...planner, blocks: Math.min(planner.capacity, planner.blocks + 1) };
}

/**
 * Park a motion line that arrived at a full planner: its state effects have
 * already been applied by the parser (grbl updates modal state and position in
 * `gc_execute_line()` before `mc_line()` blocks), but its `ok` does not go out
 * until a block retires.
 */
export function withholdAck(planner: GrblSimPlanner, line: string): GrblSimPlanner {
  return { ...planner, withheldAck: line };
}

/**
 * Retire the head block, as the stepper does when it finishes that motion. A
 * withheld line immediately takes the freed slot and its `ok` is released —
 * `mc_line()`'s spin loop breaks and `gc_execute_line()` returns.
 */
export function retireBlock(planner: GrblSimPlanner): {
  readonly planner: GrblSimPlanner;
  readonly releasedAck: string | null;
} {
  if (planner.blocks === 0) return { planner, releasedAck: null };
  const drained = planner.blocks - 1;
  if (planner.withheldAck === null) {
    return { planner: { ...planner, blocks: drained }, releasedAck: null };
  }
  return {
    planner: { ...planner, blocks: drained + 1, withheldAck: null },
    releasedAck: planner.withheldAck,
  };
}

/** Discard every queued block, as a soft reset or ALARM does. */
export function wipePlanner(planner: GrblSimPlanner): GrblSimPlanner {
  return { ...planner, blocks: 0, withheldAck: null };
}

/**
 * Motions the firmware has parsed but not yet executed. Equals `blocks` plus
 * the withheld line, which the parser has already accounted for but which has
 * not taken its planner slot yet.
 */
export function outstandingMotions(planner: GrblSimPlanner): number {
  return planner.blocks + (planner.withheldAck === null ? 0 : 1);
}
