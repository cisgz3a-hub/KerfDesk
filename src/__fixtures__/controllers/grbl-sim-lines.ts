// grbl-sim-lines — how the simulated GRBL main loop answers one host line
// (grbl protocol.c protocol_main_loop, :78-110). The glue hands a line over
// only while the main loop reads (grblSimParsesLines in grbl-sim-machine.ts).

import {
  formatVec3,
  hasGWord,
  leadingGWord,
  parseMotionWords,
  resolveTarget,
  SIM_ZERO_VEC3,
  type SimVec3,
} from './grbl-sim-gcode';
import {
  emit,
  schedule,
  startDwell,
  totalWco,
  type GrblSimEffect,
  type GrblSimOptions,
  type GrblSimReaction,
  type GrblSimState,
} from './grbl-sim-state';

const STATUS_SYSTEM_GC_LOCK = 9;
const STATUS_TRAVEL_EXCEEDED = 15;
const STATUS_CRITICAL_EVENT = 79;
const PROGRAM_PAUSE_RE = /(?:^|\s)[Mm]0*0(?![\d.])/;
const DWELL_SECONDS_RE = /[Pp](\d*\.?\d+)/;

export function reduceGrblSimLine(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction {
  if (state.machine === 'Sleep') return { state, effects: [] };
  return opts.firmware === 'grblhal'
    ? reduceGrblhalLine(state, line, opts)
    : reduceStockLine(state, line, opts);
}

// protocol.c:93-105: empty line `ok`; `$` system command; G-code blocked in
// Alarm or Jog with error:9; otherwise parsed and executed.
function reduceStockLine(state: GrblSimState, line: string, opts: GrblSimOptions): GrblSimReaction {
  const reject = opts.rejectLines.find((rule) => rule.pattern.test(line));
  if (reject !== undefined) return { state, effects: [emit(`error:${reject.errorCode}`, opts)] };
  if (line === '') return { state, effects: [emit('ok', opts)] };
  if (state.homingStuck === true) return reduceStuckHomingLine(state, line, opts);
  if (line.startsWith('$')) return reduceDollarLine(state, line, opts);
  if (state.locked || state.machine === 'Jog') {
    return { state, effects: [emit(`error:${STATUS_SYSTEM_GC_LOCK}`, opts)] };
  }
  return reduceGcodeLine(state, line, opts);
}

// grblHAL protocol.c:245-286 at COMPATIBILITY_LEVEL 0: gc_state.last_error is
// sticky. A G-code line after an error is not parsed and answers that same
// error until an empty line, a `$` line or a reset clears it. In a critical
// alarm the poll loop answers `$` lines, refusing `$X` and `$H` with error:79,
// and every G-code line with error:9 (protocol.c:420-440, system.c:1175-1183).
function reduceGrblhalLine(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction {
  if (line === '') return { state: { ...state, lastError: null }, effects: [emit('ok', opts)] };
  if (state.critical && /^\$(?:X|H\w*)$/i.test(line)) {
    return lineError(state, STATUS_CRITICAL_EVENT, opts);
  }
  if (!line.startsWith('$')) {
    if (state.locked || state.machine === 'Jog') {
      return lineError(state, STATUS_SYSTEM_GC_LOCK, opts);
    }
    if (state.lastError !== null) {
      return { state, effects: [emit(`error:${state.lastError}`, opts)] };
    }
  }
  const reaction = reduceStockLine(state, line, opts);
  return { ...reaction, state: { ...reaction.state, lastError: lineErrorCode(reaction.effects) } };
}

function lineError(state: GrblSimState, code: number, opts: GrblSimOptions): GrblSimReaction {
  return { state: { ...state, lastError: code }, effects: [emit(`error:${code}`, opts)] };
}

function lineErrorCode(effects: ReadonlyArray<GrblSimEffect>): number | null {
  for (const effect of effects) {
    if (effect.kind !== 'emit') continue;
    const match = /^error:(\d+)$/.exec(effect.line);
    if (match !== null) return Number(match[1]);
  }
  return null;
}

function reduceDollarLine(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction {
  return (
    reduceDollarControl(state, line, opts) ??
    reduceDollarQuery(state, line, opts) ??
    reduceDollarWrite(state, line, opts)
  );
}

function reduceDollarControl(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction | null {
  if (line === '$H') {
    if (state.settings.get(22) !== '1') return { state, effects: [emit('error:5', opts)] };
    const next: GrblSimState = { ...state, machine: 'Home', pendingMotions: 0 };
    return { state: next, effects: [schedule({ kind: 'homing-finished' }, opts.homingMs, next)] };
  }
  if (opts.firmware === 'grbl' && line.startsWith('$H')) return refuseHomeSuffix(state, opts);
  if (line === '$X') {
    return {
      state: {
        ...state,
        locked: false,
        machine: state.machine === 'Alarm' ? 'Idle' : state.machine,
      },
      effects: [emit('[MSG:Caution: Unlocked]', opts), emit('ok', opts)],
    };
  }
  if (line === '$SLP') {
    return {
      state: { ...state, machine: 'Sleep', spindle: 0, pendingMotions: 0 },
      effects: [emit('ok', opts)],
    };
  }
  return null;
}

// Stock GRBL takes `$H` only in Idle or Alarm, checks `$22`, and enters its
// homing state before it reads a suffix. Built without
// HOMING_SINGLE_AXIS_COMMANDS (the default) it answers any suffix with error:3
// and nothing restores the state (system.c:173-194, config.h:124).
function refuseHomeSuffix(state: GrblSimState, opts: GrblSimOptions): GrblSimReaction {
  if (state.machine !== 'Idle' && state.machine !== 'Alarm') {
    return { state, effects: [emit('error:8', opts)] };
  }
  if (state.settings.get(22) !== '1') return { state, effects: [emit('error:5', opts)] };
  return {
    state: { ...state, machine: 'Home', locked: false, homingStuck: true },
    effects: [emit('error:3', opts)],
  };
}

// In the homing state a refused `$H` suffix left, no cycle runs but the main
// loop reads lines: `$$` and `$G` answer, `$X` unlocks only an Alarm and
// otherwise answers ok, and every `$` command that needs Idle or Alarm (`$H`,
// `$J=`, `$#`, `$I`, `$SLP`, setting writes) answers error:8 (system.c:130-173).
// G-code is accepted, but cycle start runs only from Idle or a completed hold
// (protocol.c:346), so nothing moves; the blocks it would queue are not modelled.
function reduceStuckHomingLine(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction {
  const query = line === '$$' || line === '$G' ? reduceDollarQuery(state, line, opts) : null;
  if (query !== null) return query;
  if (line === '$X' || !line.startsWith('$')) return { state, effects: [emit('ok', opts)] };
  return { state, effects: [emit('error:8', opts)] };
}

function reduceDollarQuery(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction | null {
  if (line === '$$') {
    const effects: GrblSimEffect[] = [...state.settings.entries()].map(([id, value]) =>
      emit(`$${id}=${value}`, opts),
    );
    effects.push(emit('ok', opts));
    return { state, effects };
  }
  if (line === '$I') {
    return {
      state,
      effects: [
        emit('[VER:1.1f.20170801:LASERFORGE-SIM]', opts),
        emit('[OPT:V,15,128]', opts),
        emit('ok', opts),
      ],
    };
  }
  if (line === '$#') {
    const wco = formatVec3(totalWco(state));
    return {
      state,
      effects: [
        emit(`[G54:${formatVec3(state.g54 ?? SIM_ZERO_VEC3)}]`, opts),
        emit(`[G92:${wco}]`, opts),
        emit('ok', opts),
      ],
    };
  }
  if (line === '$G') {
    return {
      state,
      effects: [emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', opts), emit('ok', opts)],
    };
  }
  return null;
}

function reduceDollarWrite(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction {
  const settingWrite = /^\$(\d+)=(.*)$/.exec(line);
  if (settingWrite !== null) {
    const id = Number.parseInt(settingWrite[1] ?? '', 10);
    const next = new Map(state.settings);
    next.set(id, settingWrite[2] ?? '');
    return { state: { ...state, settings: next }, effects: [emit('ok', opts)] };
  }
  if (line.startsWith('$J=')) return reduceJogLine(state, line, opts);
  if (line.startsWith('$RST')) return { state, effects: [emit('ok', opts)] };
  return { state, effects: [emit('error:3', opts)] };
}

function reduceJogLine(state: GrblSimState, line: string, opts: GrblSimOptions): GrblSimReaction {
  if (state.locked) return { state, effects: [emit('error:9', opts)] };
  if (state.machine !== 'Idle' && state.machine !== 'Jog') {
    return { state, effects: [emit('error:8', opts)] };
  }
  const words = parseMotionWords(line.slice('$J='.length));
  if (!words.hasMotion || words.feed === null) return { state, effects: [emit('error:22', opts)] };
  const isAbsolute = words.setsAbsolute ?? false;
  const target = resolveTarget(state.mpos, totalWco(state), words, isAbsolute);
  if (jogLeavesStockTravel(state, target, opts)) {
    return { state, effects: [emit(`error:${STATUS_TRAVEL_EXCEEDED}`, opts)] };
  }
  const next: GrblSimState = {
    ...state,
    machine: 'Jog',
    mpos: target,
    feed: words.feed,
    pendingMotions: state.pendingMotions + 1,
  };
  return {
    state: next,
    effects: [emit('ok', opts), schedule({ kind: 'motion-finished' }, opts.motionMs, next)],
  };
}

// With soft limits on ($20=1) stock GRBL refuses a whole `$J=` line whose
// machine target leaves [-$13x, 0] on any axis, homed or not (jog.c:35-37,
// system.c:346-349; this build reports no HOMING_FORCE_SET_ORIGIN in $I).
function jogLeavesStockTravel(state: GrblSimState, target: SimVec3, opts: GrblSimOptions): boolean {
  if (opts.firmware !== 'grbl' || state.settings.get(20) !== '1') return false;
  return (['x', 'y', 'z'] as const).some((axis, index) => {
    const travel = Number(state.settings.get(130 + index));
    return target[axis] > 0 || target[axis] < -travel;
  });
}

function reduceGcodeLine(state: GrblSimState, line: string, opts: GrblSimOptions): GrblSimReaction {
  if (hasGWord(line, 92.1)) {
    return { state: { ...state, g92: null }, effects: [emit('ok', opts)] };
  }
  if (hasGWord(line, 92)) return { state: applyG92(state, line), effects: [emit('ok', opts)] };
  if (hasGWord(line, 10)) return { state: applyG10(state, line), effects: [emit('ok', opts)] };
  if (PROGRAM_PAUSE_RE.test(line)) return beginProgramPause(state);
  if (hasGWord(line, 4)) return beginDwell(state, line);
  if (opts.probeFailure !== undefined && hasGWord(line, 38.2)) {
    return failProbe(state, opts.probeFailure, opts);
  }
  return reduceMotionOrModalLine(state, line, opts);
}

// A failed G38.2 raises its alarm without a reset, so G92 and G54 stay, and the
// line itself still answers ok (motion_control.c:273-298, gcode.c:1132). The
// travel before ALARM:5 is not modeled.
function failProbe(state: GrblSimState, code: 4 | 5, opts: GrblSimOptions): GrblSimReaction {
  return {
    state: {
      ...state,
      machine: 'Alarm',
      locked: true,
      pendingMotions: 0,
      pendingLine: null,
      resetEpoch: state.resetEpoch + 1,
    },
    effects: [emit(`ALARM:${code}`, opts), emit('ok', opts)],
  };
}

function reduceMotionOrModalLine(
  state: GrblSimState,
  line: string,
  opts: GrblSimOptions,
): GrblSimReaction {
  const g = leadingGWord(line);
  const words = parseMotionWords(line);
  const isAbsolute = words.setsAbsolute ?? state.isAbsolute;
  let next: GrblSimState = {
    ...state,
    isAbsolute,
    feed: words.feed ?? state.feed,
    spindle: spindleAfterLine(state.spindle, line, words.spindle),
  };
  const effects: GrblSimEffect[] = [emit('ok', opts)];
  const isMotionLine =
    words.hasMotion && (g === 0 || g === 1 || g === null || hasGWord(line, 0) || hasGWord(line, 1));
  if (isMotionLine) {
    const offset = hasGWord(line, 53) ? SIM_ZERO_VEC3 : totalWco(state);
    next = {
      ...next,
      mpos: resolveTarget(state.mpos, offset, words, isAbsolute),
      machine: 'Run',
      pendingMotions: state.pendingMotions + 1,
    };
    effects.push(schedule({ kind: 'motion-finished' }, opts.motionMs, next));
  }
  return { state: next, effects };
}

// M0: protocol_buffer_synchronize() first, then a feed hold from Idle (Hold:0),
// and the line returns — `ok` — only when cycle start ends the suspend
// (gcode.c:1084-1090, protocol.c:546).
function beginProgramPause(state: GrblSimState): GrblSimReaction {
  if (state.pendingMotions > 0) {
    return {
      state: { ...state, pendingLine: { kind: 'program-pause', phase: 'sync' } },
      effects: [],
    };
  }
  return {
    state: { ...state, machine: 'Hold', pendingLine: { kind: 'program-pause', phase: 'hold' } },
    effects: [],
  };
}

// G4 P<seconds>: mc_dwell() synchronizes with the planner, then delays; the
// `ok` follows both (motion_control.c:195-200).
function beginDwell(state: GrblSimState, line: string): GrblSimReaction {
  const seconds = Number.parseFloat(DWELL_SECONDS_RE.exec(line)?.[1] ?? '0');
  if (state.pendingMotions > 0) {
    return {
      state: { ...state, pendingLine: { kind: 'dwell', seconds, phase: 'sync' } },
      effects: [],
    };
  }
  return startDwell(state, seconds);
}

function spindleAfterLine(current: number, line: string, sWord: number | null): number {
  if (/(?:^|\s)[Mm]5(?:\s|$)/.test(line)) return 0;
  return sWord ?? current;
}

function applyG92(state: GrblSimState, line: string): GrblSimState {
  // G92 X<v> declares the current position to be work-coordinate <v> on that
  // axis: g92Offset = mpos - g54 - v. Axes not mentioned keep their offset.
  const words = parseMotionWords(line);
  const g54 = state.g54 ?? SIM_ZERO_VEC3;
  const prior = state.g92 ?? SIM_ZERO_VEC3;
  return {
    ...state,
    g92: {
      x: words.x === null ? prior.x : state.mpos.x - g54.x - words.x,
      y: words.y === null ? prior.y : state.mpos.y - g54.y - words.y,
      z: words.z === null ? prior.z : state.mpos.z - g54.z - words.z,
    },
  };
}

function applyG10(state: GrblSimState, line: string): GrblSimState {
  // G10 L20 P1 X<v>: set G54 so the current position reads <v> with any G92
  // still applied, G54 = MPos - G92 - v (gcode.c:550-553); G10 L2 P1 X<v>: set
  // the G54 offset to <v> directly. Only G54 is modeled, so P0 (the active
  // system) writes it too.
  const words = parseMotionWords(line);
  const isL20 = /[Ll]20/.test(line);
  const prior = state.g54 ?? SIM_ZERO_VEC3;
  const g92 = state.g92 ?? SIM_ZERO_VEC3;
  const axis = (mpos: number, g92Offset: number, prev: number, word: number | null): number => {
    if (word === null) return prev;
    return isL20 ? mpos - g92Offset - word : word;
  };
  return {
    ...state,
    g54: {
      x: axis(state.mpos.x, g92.x, prior.x, words.x),
      y: axis(state.mpos.y, g92.y, prior.y, words.y),
      z: axis(state.mpos.z, g92.z, prior.z, words.z),
    },
  };
}
