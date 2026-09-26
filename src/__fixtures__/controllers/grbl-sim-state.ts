// grbl-sim-state — the GRBL simulator's state, events and effects, shared by
// the machine reducer (grbl-sim-machine.ts) and the line parser
// (grbl-sim-lines.ts). See grbl-sim-machine.ts for what is modelled.

import { addVec3, SIM_ZERO_VEC3, type SimVec3 } from './grbl-sim-gcode';

export type GrblSimMachineLabel =
  | 'Idle'
  | 'Run'
  | 'Jog'
  | 'Hold'
  | 'Door'
  | 'Alarm'
  | 'Home'
  | 'Sleep';

export type GrblSimFirmware = 'grbl' | 'grblhal';

/** A line the main loop is still inside: its `ok` is owed and no later line is
 * parsed. `sync` waits for the planner to drain (protocol_buffer_synchronize). */
export type GrblSimPendingLine =
  | { readonly kind: 'dwell'; readonly seconds: number; readonly phase: 'sync' | 'delay' }
  | { readonly kind: 'program-pause'; readonly phase: 'sync' | 'hold' };

export type GrblSimState = {
  readonly machine: GrblSimMachineLabel;
  readonly locked: boolean;
  readonly mpos: SimVec3;
  readonly g92: SimVec3 | null;
  readonly g54: SimVec3 | null;
  readonly isAbsolute: boolean;
  readonly feed: number;
  readonly spindle: number;
  readonly pendingMotions: number;
  readonly isHomed: boolean;
  readonly settings: ReadonlyMap<number, string>;
  readonly pendingLine: GrblSimPendingLine | null;
  /** ALARM:1/2: stock GRBL loops until a soft reset. */
  readonly critical: boolean;
  /** grblHAL `gc_state.last_error`: the error code the previous line left, or null. */
  readonly lastError: number | null;
  /** Bumped by every reset and alarm; timed events from before it are void. */
  readonly resetEpoch: number;
};

export type GrblSimTimedEvent =
  | { readonly kind: 'motion-finished'; readonly epoch?: number }
  | { readonly kind: 'homing-finished'; readonly epoch?: number }
  | { readonly kind: 'dwell-finished'; readonly epoch?: number };

export type GrblSimEvent =
  | { readonly kind: 'rx-realtime'; readonly byte: string }
  | { readonly kind: 'rx-line'; readonly line: string }
  | { readonly kind: 'alarm'; readonly code: number }
  | GrblSimTimedEvent;

export type GrblSimEffect =
  | { readonly kind: 'emit'; readonly line: string; readonly afterMs: number }
  | { readonly kind: 'schedule'; readonly event: GrblSimEvent; readonly afterMs: number };

export type GrblSimReaction = {
  readonly state: GrblSimState;
  readonly effects: ReadonlyArray<GrblSimEffect>;
};

export type GrblSimRejectRule = {
  readonly pattern: RegExp;
  readonly errorCode: number;
};

export type GrblSimOptions = {
  readonly firmwareBanner: string;
  readonly responseDelayMs: number;
  readonly motionMs: number;
  readonly homingMs: number;
  readonly alarmOnResetDuringMotion: boolean;
  readonly rejectLines: ReadonlyArray<GrblSimRejectRule>;
  /** Stock GRBL 1.1h, or grblHAL's differences on top of it (grbl-sim-machine.ts). */
  readonly firmware: GrblSimFirmware;
  /** grblHAL only: "report when homing", bit 12 of `$10`, off by default
   *  (config.h:751-753). With it on grblHAL answers `?` while it homes. */
  readonly reportWhenHoming?: boolean;
};

export function emit(line: string, opts: GrblSimOptions): GrblSimEffect {
  return { kind: 'emit', line, afterMs: opts.responseDelayMs };
}

/** A timed event stamped with the current reset epoch. */
export function schedule(
  event: GrblSimTimedEvent,
  afterMs: number,
  state: GrblSimState,
): GrblSimEffect {
  return { kind: 'schedule', event: { ...event, epoch: state.resetEpoch }, afterMs };
}

export function totalWco(state: GrblSimState): SimVec3 {
  return addVec3(state.g54 ?? SIM_ZERO_VEC3, state.g92 ?? SIM_ZERO_VEC3);
}

/** G4 after the planner drained: dwell, then answer (motion_control.c:195-200). */
export function startDwell(state: GrblSimState, seconds: number): GrblSimReaction {
  const next: GrblSimState = { ...state, pendingLine: { kind: 'dwell', seconds, phase: 'delay' } };
  return { state: next, effects: [schedule({ kind: 'dwell-finished' }, seconds * 1_000, next)] };
}
