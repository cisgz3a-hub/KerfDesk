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

function reduceGcodeLine(state: GrblSimState, line: string, opts: GrblSimOptions): GrblSimReaction {
  if (hasGWord(line, 92.1)) {
    return { state: { ...state, g92: null }, effects: [emit('ok', opts)] };
  }
  if (hasGWord(line, 92)) return { state: applyG92(state, line), effects: [emit('ok', opts)] };
  if (hasGWord(line, 10)) return { state: applyG10(state, line), effects: [emit('ok', opts)] };
  if (PROGRAM_PAUSE_RE.test(line)) return beginProgramPause(state);
  if (hasGWord(line, 4)) return beginDwell(state, line);
  return reduceMotionOrModalLine(state, line, opts);
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
  const isMotionLine = words.hasMotion && (g === 0 || g === 1 || g === null);
  if (isMotionLine) {
    next = {
      ...next,
      mpos: resolveTarget(state.mpos, totalWco(state), words, isAbsolute),
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
  // G10 L20 P1 X<v>: set G54 so the current position reads <v>; G10 L2 P1
  // X<v>: set the G54 offset to <v> directly. Only P1 (G54) is modeled.
  const words = parseMotionWords(line);
  const isL20 = /[Ll]20/.test(line);
  const prior = state.g54 ?? SIM_ZERO_VEC3;
  const axis = (mpos: number, prev: number, word: number | null): number => {
    if (word === null) return prev;
    return isL20 ? mpos - word : word;
  };
  return {
    ...state,
    g54: {
      x: axis(state.mpos.x, prior.x, words.x),
      y: axis(state.mpos.y, prior.y, words.y),
      z: axis(state.mpos.z, prior.z, words.z),
    },
  };
}
