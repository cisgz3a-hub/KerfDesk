// grbl-sim-machine — pure GRBL v1.1 firmware model. Consumes host bytes/lines
// plus its own scheduled events, returns the next state and a list of timed
// effects (lines to emit, events to schedule). No timers, no I/O — the glue in
// grbl-simulator.ts owns the clock, which keeps this reducer unit-testable and
// deterministic.
//
// Fidelity notes (deliberate simplifications, documented so tests don't lie):
//  * Acks are immediate; real GRBL stops acking when the planner fills.
//  * Motion position is applied at command time; state stays Run/Jog until the
//    scheduled motion-finished event, then reports Idle.
//  * Boot is unlocked by default (vendor-typical); vanilla homing-init-lock
//    can be approximated with triggerAlarm + locked boots in a future knob.

import {
  addVec3,
  formatVec3,
  hasGWord,
  leadingGWord,
  parseMotionWords,
  resolveTarget,
  SIM_ZERO_VEC3,
  type SimVec3,
} from './grbl-sim-gcode';

export type GrblSimMachineLabel = 'Idle' | 'Run' | 'Jog' | 'Hold' | 'Alarm' | 'Home' | 'Sleep';

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
};

export type GrblSimEvent =
  | { readonly kind: 'rx-realtime'; readonly byte: string }
  | { readonly kind: 'rx-line'; readonly line: string }
  | { readonly kind: 'motion-finished' }
  | { readonly kind: 'homing-finished' };

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
};

export const DEFAULT_GRBL_SIM_OPTIONS: GrblSimOptions = {
  firmwareBanner: "Grbl 1.1f ['$' for help]",
  responseDelayMs: 1,
  motionMs: 10,
  homingMs: 5,
  alarmOnResetDuringMotion: true,
  rejectLines: [],
};

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
  };
}

export function reduceGrblSim(
  state: GrblSimState,
  event: GrblSimEvent,
  opts: GrblSimOptions,
): GrblSimReaction {
  switch (event.kind) {
    case 'rx-realtime':
      return reduceRealtime(state, event.byte, opts);
    case 'rx-line':
      return reduceLine(state, event.line, opts);
    case 'motion-finished': {
      const pendingMotions = Math.max(0, state.pendingMotions - 1);
      const settlesToIdle =
        pendingMotions === 0 && (state.machine === 'Run' || state.machine === 'Jog');
      return {
        state: { ...state, pendingMotions, machine: settlesToIdle ? 'Idle' : state.machine },
        effects: [],
      };
    }
    case 'homing-finished':
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
}

export function statusReportLine(state: GrblSimState): string {
  const label = state.machine === 'Hold' ? 'Hold:0' : state.machine;
  const isMoving = state.machine === 'Run' || state.machine === 'Jog' || state.machine === 'Hold';
  const feed = isMoving ? Math.round(state.feed) : 0;
  const spindle = isMoving ? Math.round(state.spindle) : 0;
  const wco = totalWco(state);
  return `<${label}|MPos:${formatVec3(state.mpos)}|FS:${feed},${spindle}|WCO:${formatVec3(wco)}>`;
}

function totalWco(state: GrblSimState): SimVec3 {
  return addVec3(state.g54 ?? SIM_ZERO_VEC3, state.g92 ?? SIM_ZERO_VEC3);
}

function emit(line: string, opts: GrblSimOptions): GrblSimEffect {
  return { kind: 'emit', line, afterMs: opts.responseDelayMs };
}

function reduceRealtime(state: GrblSimState, byte: string, opts: GrblSimOptions): GrblSimReaction {
  if (byte === '?') return { state, effects: [emit(statusReportLine(state), opts)] };
  if (byte === '!') {
    const holds = state.machine === 'Run' || state.machine === 'Jog';
    return { state: holds ? { ...state, machine: 'Hold' } : state, effects: [] };
  }
  if (byte === '~') {
    if (state.machine !== 'Hold') return { state, effects: [] };
    return {
      state: { ...state, machine: state.pendingMotions > 0 ? 'Run' : 'Idle' },
      effects: [],
    };
  }
  if (byte === '\x18') return reduceSoftReset(state, opts);
  if (byte === '\x85') {
    if (state.machine !== 'Jog') return { state, effects: [] };
    return { state: { ...state, machine: 'Idle', pendingMotions: 0 }, effects: [] };
  }
  return { state, effects: [] };
}

function reduceSoftReset(state: GrblSimState, opts: GrblSimOptions): GrblSimReaction {
  const wasMoving =
    state.machine === 'Run' ||
    state.machine === 'Jog' ||
    state.machine === 'Home' ||
    state.pendingMotions > 0;
  const alarms = wasMoving && opts.alarmOnResetDuringMotion;
  const base: GrblSimState = {
    ...state,
    pendingMotions: 0,
    spindle: 0,
    // Soft reset clears the volatile G92 offset (GRBL v1.1 behavior); the
    // persistent G54 offset survives.
    g92: null,
  };
  const effects: GrblSimEffect[] = [emit(opts.firmwareBanner, opts)];
  if (alarms) {
    effects.push(emit('ALARM:3', opts), emit("[MSG:'$H'|'$X' to unlock]", opts));
    return { state: { ...base, machine: 'Alarm', locked: true }, effects };
  }
  return { state: { ...base, machine: 'Idle', locked: false }, effects };
}

function reduceLine(state: GrblSimState, line: string, opts: GrblSimOptions): GrblSimReaction {
  if (state.machine === 'Sleep') return { state, effects: [] };
  const reject = opts.rejectLines.find((rule) => rule.pattern.test(line));
  if (reject !== undefined) return { state, effects: [emit(`error:${reject.errorCode}`, opts)] };
  if (line === '') return { state, effects: [emit('ok', opts)] };
  if (line.startsWith('$')) return reduceDollarLine(state, line, opts);
  return reduceGcodeLine(state, line, opts);
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
    return {
      state: { ...state, machine: 'Home', pendingMotions: 0 },
      effects: [{ kind: 'schedule', event: { kind: 'homing-finished' }, afterMs: opts.homingMs }],
    };
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
  return {
    state: {
      ...state,
      machine: 'Jog',
      mpos: target,
      feed: words.feed,
      pendingMotions: state.pendingMotions + 1,
    },
    effects: [
      emit('ok', opts),
      { kind: 'schedule', event: { kind: 'motion-finished' }, afterMs: opts.motionMs },
    ],
  };
}

function reduceGcodeLine(state: GrblSimState, line: string, opts: GrblSimOptions): GrblSimReaction {
  if (state.locked) return { state, effects: [emit('error:9', opts)] };
  const g = leadingGWord(line);
  if (hasGWord(line, 92.1)) {
    return { state: { ...state, g92: null }, effects: [emit('ok', opts)] };
  }
  if (hasGWord(line, 92)) return { state: applyG92(state, line), effects: [emit('ok', opts)] };
  if (hasGWord(line, 10)) return { state: applyG10(state, line), effects: [emit('ok', opts)] };
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
    effects.push({ kind: 'schedule', event: { kind: 'motion-finished' }, afterMs: opts.motionMs });
  }
  return { state: next, effects };
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
