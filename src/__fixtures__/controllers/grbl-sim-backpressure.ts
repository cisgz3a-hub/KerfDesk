// grbl-sim-backpressure — feeds host bytes to the firmware reducer at the rate
// a real GRBL main loop could accept them, instead of instantly.
//
// This is the missing half of the simulator. `grbl-sim-machine.ts` answered
// every line immediately, so the one failure mode a character-counting sender
// exists to prevent — the controller going quiet because its planner filled —
// could not be reproduced, and no test in the tree exercised it.
//
// The loop modelled here, from gnea/grbl v1.1 (`protocol.c`, `motion_control.c`,
// `serial.c`; read 2026-07-27 — citations in the two sibling models):
//
//   1. Bytes land in the 128-byte RX ring from the serial ISR.
//   2. The main loop pulls one line out and runs `gc_execute_line()`.
//   3. A motion line calls `mc_line()`, which SPINS while the planner is full.
//   4. `report_status_message()` sends `ok` only once that call returns.
//   5. While spinning, the main loop reads no serial at all, so the ring keeps
//      filling from the host. Overrun silently drops bytes.
//
// Realtime bytes are deliberately NOT routed through here: grbl's ISR executes
// them without ever storing them, so `?`, `!`, `~` and soft reset keep working
// while the main loop is blocked. The caller feeds this only non-realtime bytes.

import {
  admitBlock,
  createPlanner,
  isPlannerBlocked,
  isPlannerFull,
  retireBlock,
  withholdAck,
  wipePlanner,
  type GrblSimPlanner,
} from './grbl-sim-planner';
import {
  acceptRxBytes,
  createRxWindow,
  takeRxLine,
  type GrblSimRxWindow,
} from './grbl-sim-rx-window';
import type { GrblSimEffect } from './grbl-sim-machine';

export type BackpressureConfig = {
  readonly plannerBlocks: number;
  /** Simulated time one planner block takes to retire. */
  readonly retireMs: number;
  readonly rxCapacity: number;
};

export type BackpressureDeps = {
  /**
   * Run one line through the firmware reducer, applying its state change, and
   * return the effects it produced. The feeder decides which go out now and
   * which wait for a planner slot.
   */
  readonly reduceLine: (line: string) => ReadonlyArray<GrblSimEffect>;
  readonly runEffect: (effect: GrblSimEffect) => void;
  /** Tell the reducer one queued motion has finished executing. */
  readonly retireMotion: () => void;
};

export type BackpressureFeeder = {
  /** Deliver non-realtime host bytes into the RX ring, then drain what fits. */
  readonly acceptBytes: (data: string) => void;
  /** Drop queued blocks and buffered bytes, as a soft reset or ALARM does. */
  readonly reset: () => void;
  readonly rxWindow: () => GrblSimRxWindow;
  readonly planner: () => GrblSimPlanner;
};

// A motion line is identified by the effect the reducer schedules for it, so
// this file never re-parses G-code — the reducer stays the single parser.
function isMotionSchedule(effect: GrblSimEffect): boolean {
  return effect.kind === 'schedule' && effect.event.kind === 'motion-finished';
}

export function createBackpressureFeeder(
  config: BackpressureConfig,
  deps: BackpressureDeps,
): BackpressureFeeder {
  let planner = createPlanner(config.plannerBlocks);
  let rx = createRxWindow(config.rxCapacity);
  let withheld: ReadonlyArray<GrblSimEffect> = [];
  let retireTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRetire = (): void => {
    if (retireTimer !== null || planner.blocks === 0) return;
    retireTimer = setTimeout(retire, config.retireMs);
  };

  const retire = (): void => {
    retireTimer = null;
    if (planner.blocks === 0) return;
    const result = retireBlock(planner);
    planner = result.planner;
    deps.retireMotion();
    if (result.releasedAck !== null) {
      const released = withheld;
      withheld = [];
      for (const effect of released) deps.runEffect(effect);
    }
    scheduleRetire();
    drain();
  };

  const consume = (line: string): void => {
    const effects = deps.reduceLine(line);
    if (!effects.some(isMotionSchedule)) {
      for (const effect of effects) deps.runEffect(effect);
      return;
    }
    // Retirement is driven serially here, so the reducer's own one-shot
    // motion-finished schedule is dropped in favour of this queue.
    const rest = effects.filter((effect) => !isMotionSchedule(effect));
    if (isPlannerFull(planner)) {
      planner = withholdAck(planner, line);
      withheld = rest;
      return;
    }
    planner = admitBlock(planner);
    for (const effect of rest) deps.runEffect(effect);
    scheduleRetire();
  };

  const drain = (): void => {
    while (!isPlannerBlocked(planner)) {
      const taken = takeRxLine(rx);
      if (taken.line === null) return;
      rx = taken.window;
      consume(taken.line);
    }
  };

  return {
    acceptBytes: (data) => {
      rx = acceptRxBytes(rx, data);
      drain();
    },
    reset: () => {
      if (retireTimer !== null) clearTimeout(retireTimer);
      retireTimer = null;
      planner = wipePlanner(planner);
      withheld = [];
      rx = { ...rx, pending: '' };
    },
    rxWindow: () => rx,
    planner: () => planner,
  };
}
