// grbl-sim-jog-cancel-flush — opt-in model of grblHAL's jog-cancel input flush
// (controller audit M-6).
//
// grblHAL handles 0x85 in its receive interrupt in every state: it drops the
// partial line and flushes the input buffer, inserting CAN, so every line it
// has received but not parsed yet is discarded and never answered. The main
// loop then reads the CAN, clears the held error and raises motion cancel only
// in STATE_JOG. Sources:
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L896-L899,
// protocol.c#L212-L219 and stream.h#L287-L291. Stock GRBL ignores 0x85 outside
// Jog and flushes nothing
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L159-L162).
//
// The default simulator parses a line the moment its newline arrives, which
// leaves nothing unparsed to flush. This feeder's main loop reads the ring a
// moment after bytes arrive, like one that is busy for a while, and 0x85
// discards what it has not read yet. Opt in with
// `createGrblSimulator({ jogCancelFlushesInput: true })`.

import {
  acceptRxBytes,
  createRxWindow,
  takeRxLine,
  type GrblSimLineEnding,
} from './grbl-sim-rx-window';
import type { GrblSimEffect, GrblSimState } from './grbl-sim-state';

/** Delay before the simulated main loop reads bytes that just arrived. */
export const GRBL_SIM_LINE_PARSE_DELAY_MS = 1;

export type DelayedParseDeps = {
  readonly reduceLine: (line: string) => ReadonlyArray<GrblSimEffect>;
  readonly runEffect: (effect: GrblSimEffect) => void;
  readonly parsesLines: () => boolean;
  readonly lineEnding: GrblSimLineEnding;
};

export type DelayedParseFeeder = {
  readonly acceptBytes: (data: string) => void;
  readonly drain: () => void;
  /** Discard the partial line and every received line not parsed yet. */
  readonly reset: () => void;
  readonly wipePlanner: () => void;
};

export function createDelayedParseFeeder(deps: DelayedParseDeps): DelayedParseFeeder {
  let rx = createRxWindow(Number.POSITIVE_INFINITY);
  let nextPass: ReturnType<typeof setTimeout> | null = null;
  const read = (): void => {
    while (deps.parsesLines()) {
      const taken = takeRxLine(rx, deps.lineEnding);
      rx = taken.window;
      if (taken.line === null) return;
      for (const effect of deps.reduceLine(taken.line)) deps.runEffect(effect);
    }
  };
  return {
    acceptBytes: (data) => {
      if (data === '') return;
      rx = acceptRxBytes(rx, data);
      nextPass ??= setTimeout(() => {
        nextPass = null;
        read();
      }, GRBL_SIM_LINE_PARSE_DELAY_MS);
    },
    // An event that frees the main loop lets it read at once, unless bytes
    // that just arrived still wait for the pass that follows them.
    drain: () => {
      if (nextPass === null) read();
    },
    reset: () => {
      rx = createRxWindow(Number.POSITIVE_INFINITY);
    },
    wipePlanner: () => undefined,
  };
}

/** grblHAL's 0x85, in any state: the input is flushed, and the CAN left in its
 * place clears the held error once the main loop reads it. */
export function flushInputOnJogCancel(
  state: GrblSimState,
  feeder: Pick<DelayedParseFeeder, 'reset'>,
): GrblSimState {
  feeder.reset();
  return state.lastError === null ? state : { ...state, lastError: null };
}
