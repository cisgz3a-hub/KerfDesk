// grbl-sim-machine — pure GRBL v1.1 firmware model. Consumes host bytes/lines
// plus its own scheduled events, returns the next state and a list of timed
// effects (lines to emit, events to schedule). No timers, no I/O — the glue in
// grbl-simulator.ts owns the clock, which keeps this reducer unit-testable and
// deterministic. Line parsing lives in grbl-sim-lines.ts.
//
// Modelled after gnea/grbl 1.1h (bfb67f0c) where the controller audit
// (2026-09-25, ST-2) found the model more forgiving than the firmware:
//  * G-code is locked out in Jog and Alarm with error:9 (protocol.c:99-101).
//  * The main loop parses no line while it is blocked (grblSimParsesLines):
//    inside a G4 or M0 (below), in a completed feed hold or door (the suspend
//    loop, protocol.c:208, :546), while homing ($H runs to completion inside
//    system_execute_line), asleep, or in a critical alarm. Host lines wait in
//    the RX ring meanwhile.
//  * G4 waits for the planner to drain, then dwells, then answers `ok`
//    (motion_control.c:195-200). M0 waits for the drain, then holds (Hold:0)
//    and answers `ok` only after cycle start (gcode.c:1084-1090).
//  * A software safety door (0x84) with no door input reports Door:0 once
//    parked (system.c:87-93 system_check_safety_door_ajar() is false without
//    ENABLE_SAFETY_DOOR_INPUT_PIN; report.c:491-500).
//  * A soft reset in a completed feed hold or door raises no alarm, even with
//    motion still queued: the hold's completion (EXEC_CYCLE_STOP in
//    protocol_exec_rt_system) clears STEP_CONTROL_EXECUTE_HOLD, so mc_reset
//    finds no motion to kill. The reboot drops the queued blocks and the G92
//    offset but keeps the machine position.
//  * ALARM:1 and ALARM:2 (hard and soft limit) print `[MSG:Reset to continue]`
//    and loop until a soft reset, answering no status query (protocol.c:226-236).
//  * A soft reset from Alarm or Sleep comes back in Alarm with the unlock
//    message (main.c keeps the prior state; protocol.c:49-54), as grblHAL
//    (protocol.c:167-174) and FluidNC (Protocol.cpp:1158) do.
//  * The planner holds 15 usable blocks (grbl-sim-planner.ts) and the RX ring
//    128 bytes (grbl-sim-rx-window.ts); every byte above 0x7F is realtime.
// `firmware: 'grblhal'` adds grblHAL behaviour: status reports in a critical
// alarm (and while homing with `reportWhenHoming`, off by default:
// machine_limits.c:336-337, :445-447), `$X`/`$H` answered error:79 in a
// critical alarm, the sticky G-code error (protocol.c:245-286) and a CRLF pair
// read as one end of line.
//
// Remaining simplifications, documented so tests don't lie:
//  * Acks are immediate unless `createGrblSimulator({ plannerBlocks })` opts in
//    to the bounded planner (grbl-sim-backpressure.ts, ADR-265).
//  * A feed hold or door completes at once (no Hold:1 / Door:2 deceleration,
//    no Door:3 restore delays), `!` in Jog holds instead of cancelling the jog,
//    `!` from Idle is ignored, and M3-M9 do not wait for the planner to drain.
//  * A reset during homing raises ALARM:3 rather than ALARM:6.
//  * `$$`, `$I`, `$#` and `$G` are answered immediately in every state.
//  * Motion position is applied at command time; state stays Run/Jog until the
//    scheduled motion-finished event, then reports Idle.
//  * Boot is unlocked by default (vendor-typical).

import { formatVec3, SIM_ZERO_VEC3 } from './grbl-sim-gcode';
import { reduceGrblSimLine } from './grbl-sim-lines';
import {
  emit,
  startDwell,
  totalWco,
  type GrblSimEffect,
  type GrblSimEvent,
  type GrblSimMachineLabel,
  type GrblSimOptions,
  type GrblSimReaction,
  type GrblSimState,
  type GrblSimTimedEvent,
} from './grbl-sim-state';

export type {
  GrblSimEffect,
  GrblSimEvent,
  GrblSimFirmware,
  GrblSimMachineLabel,
  GrblSimOptions,
  GrblSimPendingLine,
  GrblSimReaction,
  GrblSimRejectRule,
  GrblSimState,
  GrblSimTimedEvent,
} from './grbl-sim-state';

export const DEFAULT_GRBL_SIM_OPTIONS: GrblSimOptions = {
  firmwareBanner: "Grbl 1.1f ['$' for help]",
  responseDelayMs: 1,
  motionMs: 10,
  homingMs: 5,
  alarmOnResetDuringMotion: true,
  rejectLines: [],
  firmware: 'grbl',
};

const UNLOCK_MESSAGE = "[MSG:'$H'|'$X' to unlock]";
const LINE_BLOCKING_STATES: ReadonlySet<GrblSimMachineLabel> = new Set([
  'Hold',
  'Door',
  'Home',
  'Sleep',
]);

export function initialGrblSimState(settings: ReadonlyMap<number, string>): GrblSimState {
  return {
    machine: 'Idle',
    locked: false,
    mpos: SIM_ZERO_VEC3,
    g92: null,
    g54: null,
    isAbsolute: true,
    feed: 0,
    spindle: 0,
    pendingMotions: 0,
    isHomed: false,
    settings,
    pendingLine: null,
    critical: false,
    lastError: null,
    resetEpoch: 0,
  };
}

export function reduceGrblSim(
  state: GrblSimState,
  event: GrblSimEvent,
  opts: GrblSimOptions,
): GrblSimReaction {
  if (event.kind === 'rx-realtime') return reduceRealtime(state, event.byte, opts);
  if (event.kind === 'rx-line') return reduceGrblSimLine(state, event.line, opts);
  if (event.kind === 'alarm') return reduceAlarm(state, event.code, opts);
  if (event.epoch !== undefined && event.epoch !== state.resetEpoch) return { state, effects: [] };
  return reduceTimedEvent(state, event, opts);
}

/** Whether the main loop reads the next host line now (see header). */
export function grblSimParsesLines(state: GrblSimState, opts: GrblSimOptions): boolean {
  if (state.pendingLine !== null) return false;
  if (state.critical) return opts.firmware === 'grblhal';
  return !LINE_BLOCKING_STATES.has(state.machine);
}

export function statusReportLine(state: GrblSimState): string {
  const label =
    state.machine === 'Hold' ? 'Hold:0' : state.machine === 'Door' ? 'Door:0' : state.machine;
  const isMoving = state.machine === 'Run' || state.machine === 'Jog' || state.machine === 'Hold';
  const feed = isMoving ? Math.round(state.feed) : 0;
  const spindle = isMoving ? Math.round(state.spindle) : 0;
  const wco = totalWco(state);
  const stoppedAccessories = state.machine === 'Door' ? '|Ov:100,100,100' : '';
  return `<${label}|MPos:${formatVec3(state.mpos)}|FS:${feed},${spindle}|WCO:${formatVec3(wco)}${stoppedAccessories}>`;
}

function reduceTimedEvent(
  state: GrblSimState,
  event: GrblSimTimedEvent,
  opts: GrblSimOptions,
): GrblSimReaction {
  if (event.kind === 'motion-finished') return reduceMotionFinished(state);
  if (event.kind === 'homing-finished') return reduceHomingFinished(state, opts);
  const pending = state.pendingLine;
  if (pending?.kind !== 'dwell' || pending.phase !== 'delay') return { state, effects: [] };
  return { state: { ...state, pendingLine: null }, effects: [emit('ok', opts)] };
}

function reduceMotionFinished(state: GrblSimState): GrblSimReaction {
  const pendingMotions = Math.max(0, state.pendingMotions - 1);
  const settlesToIdle =
    pendingMotions === 0 && (state.machine === 'Run' || state.machine === 'Jog');
  const next: GrblSimState = {
    ...state,
    pendingMotions,
    machine: settlesToIdle ? 'Idle' : state.machine,
  };
  return pendingMotions === 0 ? continueSyncedLine(next) : { state: next, effects: [] };
}

// The planner drained under a line that waited for it: G4 starts its dwell and
// M0 enters its feed hold (Hold:0) until cycle start.
function continueSyncedLine(state: GrblSimState): GrblSimReaction {
  const pending = state.pendingLine;
  if (pending?.phase !== 'sync') return { state, effects: [] };
  if (pending.kind === 'dwell') return startDwell(state, pending.seconds);
  return {
    state: { ...state, machine: 'Hold', pendingLine: { kind: 'program-pause', phase: 'hold' } },
    effects: [],
  };
}

function reduceHomingFinished(state: GrblSimState, opts: GrblSimOptions): GrblSimReaction {
  if (state.machine !== 'Home') return { state, effects: [] };
  return {
    state: {
      ...state,
      machine: 'Idle',
      locked: false,
      isHomed: true,
      mpos: SIM_ZERO_VEC3,
      pendingMotions: 0,
    },
    effects: [emit('ok', opts)],
  };
}

function reduceAlarm(state: GrblSimState, code: number, opts: GrblSimOptions): GrblSimReaction {
  const critical = code === 1 || code === 2;
  return {
    state: {
      ...state,
      machine: 'Alarm',
      locked: true,
      critical,
      pendingMotions: 0,
      pendingLine: null,
      resetEpoch: state.resetEpoch + 1,
    },
    effects: [
      emit(`ALARM:${code}`, opts),
      ...(critical ? [emit('[MSG:Reset to continue]', opts)] : []),
    ],
  };
}

function reduceRealtime(state: GrblSimState, byte: string, opts: GrblSimOptions): GrblSimReaction {
  switch (byte) {
    case '?':
      return {
        state,
        effects: reportsStatus(state, opts) ? [emit(statusReportLine(state), opts)] : [],
      };
    case '!': {
      const holds = state.machine === 'Run' || state.machine === 'Jog';
      return { state: holds ? { ...state, machine: 'Hold' } : state, effects: [] };
    }
    case '\x84':
      return reduceSafetyDoor(state);
    case '~':
      return reduceCycleStart(state, opts);
    case '\x18':
      return reduceSoftReset(state, opts);
    case '\x85':
      return state.machine === 'Jog'
        ? { state: { ...state, machine: 'Idle', pendingMotions: 0 }, effects: [] }
        : { state, effects: [] };
    default:
      // Overrides and unassigned bytes above 0x7F: taken off the stream, not modelled.
      return { state, effects: [] };
  }
}

// Stock GRBL answers no status query while homing (limits.c:320 "No time to run
// protocol_execute_realtime() in this loop") or in the critical-alarm loop.
// grblHAL answers in a critical alarm, and while homing only with "report when
// homing" on (machine_limits.c:336-337, :445-447).
function reportsStatus(state: GrblSimState, opts: GrblSimOptions): boolean {
  const grblHal = opts.firmware === 'grblhal';
  if (state.machine === 'Home') return grblHal && opts.reportWhenHoming === true;
  return grblHal || !state.critical;
}

function reduceSafetyDoor(state: GrblSimState): GrblSimReaction {
  const stops = ['Idle', 'Run', 'Jog', 'Hold'].includes(state.machine);
  return {
    state: stops ? { ...state, machine: 'Door', spindle: 0 } : state,
    effects: [],
  };
}

function reduceCycleStart(state: GrblSimState, opts: GrblSimOptions): GrblSimReaction {
  if (state.machine !== 'Hold' && state.machine !== 'Door') return { state, effects: [] };
  const pending = state.pendingLine;
  if (pending?.kind === 'program-pause' && pending.phase === 'hold') {
    // M0 synced before it held, so nothing is queued: the resume ends the
    // suspend and gc_execute_line returns, which is when M0's `ok` goes out.
    return { state: { ...state, machine: 'Idle', pendingLine: null }, effects: [emit('ok', opts)] };
  }
  return {
    state: { ...state, machine: state.pendingMotions > 0 ? 'Run' : 'Idle' },
    effects: [],
  };
}

function reduceSoftReset(state: GrblSimState, opts: GrblSimOptions): GrblSimReaction {
  // Holds complete at once here (see header), so Hold and Door are settled.
  const heldSettled = state.machine === 'Hold' || state.machine === 'Door';
  const wasMoving =
    state.machine === 'Run' ||
    state.machine === 'Jog' ||
    state.machine === 'Home' ||
    (state.pendingMotions > 0 && !heldSettled);
  const base: GrblSimState = {
    ...state,
    pendingMotions: 0,
    spindle: 0,
    // Stock GRBL's soft reset clears G92 (gcode.c gc_init memsets the parser
    // state); grblHAL at COMPATIBILITY_LEVEL <= 1 keeps it (gcode.c:787 clears
    // only up to g92_offset). The persistent G54 offset survives either way.
    g92: opts.firmware === 'grblhal' ? state.g92 : null,
    pendingLine: null,
    critical: false,
    lastError: null,
    resetEpoch: state.resetEpoch + 1,
  };
  if (wasMoving && opts.alarmOnResetDuringMotion) {
    // Firmware order: protocol_exec_rt_system reports the abort alarm, then
    // returns on EXEC_RESET; the reboot prints the banner and, because the
    // state is Alarm, protocol_main_loop adds the unlock message. Emitting the
    // banner first hid a store bug where the banner erased ALARM:3.
    const effects: GrblSimEffect[] = [
      emit('ALARM:3', opts),
      emit(opts.firmwareBanner, opts),
      emit(UNLOCK_MESSAGE, opts),
    ];
    return { state: { ...base, machine: 'Alarm', locked: true }, effects };
  }
  if (state.machine === 'Alarm' || state.machine === 'Sleep') {
    return {
      state: { ...base, machine: 'Alarm', locked: true },
      effects: [emit(opts.firmwareBanner, opts), emit(UNLOCK_MESSAGE, opts)],
    };
  }
  return {
    state: { ...base, machine: 'Idle', locked: false },
    effects: [emit(opts.firmwareBanner, opts)],
  };
}
