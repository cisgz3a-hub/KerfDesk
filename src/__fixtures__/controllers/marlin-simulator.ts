// marlin-simulator — scripted Marlin 2.1.2.8 over the fake serial port.
// marlin-sim-queue.ts decides when the host hears back (the 4-line command
// ring, strict FIFO, the 16-block planner, synchronizing handlers, M410 and
// busy keepalives); this module answers each command. Vocabulary: `start`
// boot banner, `ok` per answered line (none for a comment-only or empty line),
// `echo:busy: processing` while a handler waits, `Error:<text>` then `ok` for a
// handler error, `echo:Unknown command: "<line>"` then `ok` for an M-code the
// build lacks, M114 and G92 position lines, M115 firmware identity, and M112,
// which halts the firmware (upstream rules cited in marlin-sim-queue.ts and
// below). Beam power, fan power and burns come from marlin-laser-power-model.ts;
// a burn is recorded when its move starts, so a quickstop drops the burns of
// the moves it discarded.

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import { parseMotionWords, SIM_ZERO_VEC3, type SimVec3 } from './grbl-sim-gcode';
import { executeMarlinLine, powerUpMarlin, type MarlinBurn } from './marlin-laser-power-model';
import {
  createMarlinSimQueue,
  MARLIN_PLANNER_MOVES,
  MARLIN_KEEPALIVE_MS,
  type MarlinSimHandler,
} from './marlin-sim-queue';
import type { PlatformAdapter } from '../../platform/types';

export type MarlinSimRejectRule = {
  readonly pattern: RegExp;
  readonly error: string;
};

/** Configuration.h / Configuration_adv.h options that decide which M-codes
 * this build dispatches (gcode.cpp L489-L505, L591-L594). All on by default:
 * a laser build with air assist and a fan. */
export type MarlinSimBuild = {
  /** LASER_FEATURE (HAS_CUTTER): M3, M4, M5. */
  readonly laser: boolean;
  /** AIR_ASSIST (or COOLANT_FLOOD / COOLANT_CONTROL): M8, M9. */
  readonly airAssist: boolean;
  /** COOLANT_MIST: M7. */
  readonly coolantMist: boolean;
  /** HAS_FAN: M106, M107. */
  readonly fan: boolean;
};

export type CreateMarlinSimulatorOptions = {
  readonly responseDelayMs?: number;
  /** How long each planned move takes to run. */
  readonly motionMs?: number;
  readonly homingMs?: number;
  /** Handler errors: `Error:<error>` and then the line's `ok`. */
  readonly rejectLines?: ReadonlyArray<MarlinSimRejectRule>;
  readonly emitBannerOnOpen?: boolean;
  /** Lines the board ran before this connection. A board that does not reset
   * when the port opens keeps the beam state they left. */
  readonly initialPowerLines?: ReadonlyArray<string>;
  readonly build?: Partial<MarlinSimBuild>;
  /** HOST_KEEPALIVE_FEATURE interval; 0 turns the busy keepalive off. */
  readonly keepaliveMs?: number;
  /** Moves the planner holds: BLOCK_BUFFER_SIZE - 1 (15 on a stock build). */
  readonly plannerBlocks?: number;
};

export type MarlinSimState = {
  /** The planned position, which M114 reports (M114.cpp: projected). */
  readonly pos: SimVec3;
  readonly isAbsolute: boolean;
  /** Planned moves not yet finished, the running one included. */
  readonly pendingMotions: number;
  readonly isHalted: boolean;
  readonly isHomed: boolean;
  readonly fanPower: number;
  readonly laserMode: 'standard' | 'continuous' | 'dynamic';
  readonly inlineBurnPowers: ReadonlyArray<number>;
  /** Every move made with the beam on, in the order Marlin ran them. */
  readonly burns: ReadonlyArray<MarlinBurn>;
  /** Lines the power model does not cover (see marlin-laser-power-model.ts). */
  readonly modelErrors: ReadonlyArray<string>;
};

export type MarlinSimulator = {
  readonly adapter: PlatformAdapter;
  readonly port: FakeSerialPort;
  readonly state: () => MarlinSimState;
  readonly outbound: () => ReadonlyArray<string>;
};

const FIRMWARE_LINE =
  'FIRMWARE_NAME:Marlin 2.1.2 (LaserForge-sim) SOURCE_CODE_URL:github.com/MarlinFirmware/Marlin';

const DEFAULT_BUILD: MarlinSimBuild = {
  laser: true,
  airAssist: true,
  coolantMist: true,
  fan: true,
};

const BUILD_OPTION_OF: Readonly<Record<string, keyof MarlinSimBuild>> = {
  M3: 'laser',
  M4: 'laser',
  M5: 'laser',
  M7: 'coolantMist',
  M8: 'airAssist',
  M9: 'airAssist',
  M106: 'fan',
  M107: 'fan',
};

/** The command a line runs: its first G or M word. Stock builds compile no
 * sub-codes, so `G92.1` runs as G92 (inc/Conditionals_post.h L3178-L3180). */
function commandCode(line: string): string {
  const match = /^([GM])0*(\d+)/i.exec(line);
  return match === null ? '' : `${(match[1] ?? '').toUpperCase()}${match[2] ?? ''}`;
}

export function createMarlinSimulator(options: CreateMarlinSimulatorOptions = {}): MarlinSimulator {
  const delay = options.responseDelayMs ?? 1;
  const homingMs = options.homingMs ?? 5;
  const rejects = options.rejectLines ?? [];
  const build: MarlinSimBuild = { ...DEFAULT_BUILD, ...options.build };
  const port = createFakeSerialPort();
  const power = powerUpMarlin();
  for (const line of options.initialPowerLines ?? []) executeMarlinLine(power, line);
  power.burns.splice(0);
  const burns: MarlinBurn[] = [];
  const modelErrors: string[] = [];
  const machine = {
    pos: SIM_ZERO_VEC3,
    runTo: SIM_ZERO_VEC3,
    isAbsolute: true,
    isHalted: false,
    isHomed: false,
    waitUntil: null as number | null,
  };

  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), delay);
  };
  const answer = (...lines: ReadonlyArray<string>): true => {
    for (const line of [...lines, 'ok']) emit(line);
    return true;
  };
  const positionLine = (): string => {
    const { x, y, z } = machine.pos;
    return `X:${x.toFixed(2)} Y:${y.toFixed(2)} Z:${z.toFixed(2)} E:0.00 Count X:0 Y:0 Z:0`;
  };
  // The power model runs when a line is parsed; the burns it records belong to
  // the move and are kept only once that move starts.
  const applyPower = (line: string): MarlinBurn[] => {
    const before = power.burns.length;
    try {
      executeMarlinLine(power, line);
    } catch (error) {
      modelErrors.push(error instanceof Error ? `${line}: ${error.message}` : line);
    }
    return power.burns.splice(before);
  };

  const queue = createMarlinSimQueue({
    motionMs: options.motionMs ?? 10,
    keepaliveMs: options.keepaliveMs ?? MARLIN_KEEPALIVE_MS,
    plannerBlocks: options.plannerBlocks ?? MARLIN_PLANNER_MOVES,
    emit,
    run: (line, firstRun) => runLine(line, firstRun),
    onRead: (line) => readLine(line),
  });

  // A dwell or homing cycle: wait for the planner, then `ms` more.
  const waitThen = (ms: number, done: () => void): boolean => {
    if (!queue.drained()) return false;
    if (machine.waitUntil === null) {
      machine.waitUntil = Date.now() + ms;
      queue.retryAfter(ms);
    }
    if (Date.now() < machine.waitUntil) return false;
    machine.waitUntil = null;
    done();
    return answer();
  };

  const move: MarlinSimHandler = (line) => {
    if (queue.discarding()) return answer(); // quick_stop(): moves refused for 1 s
    if (queue.plannerFull()) return false;
    const words = parseMotionWords(line);
    const moveBurns = applyPower(line);
    const { pos, isAbsolute } = machine;
    const to = {
      x: words.x === null ? pos.x : isAbsolute ? words.x : pos.x + words.x,
      y: words.y === null ? pos.y : isAbsolute ? words.y : pos.y + words.y,
      z: words.z === null ? pos.z : isAbsolute ? words.z : pos.z + words.z,
    };
    if (to.x !== pos.x || to.y !== pos.y || to.z !== pos.z) {
      queue.plan({ onStart: () => burns.push(...moveBurns), onFinish: () => (machine.runTo = to) });
    }
    machine.pos = to;
    return answer();
  };
  const synchronized: MarlinSimHandler = (line) => {
    if (!queue.drained()) return false;
    applyPower(line);
    return answer();
  };
  const accept: MarlinSimHandler = (line) => {
    applyPower(line);
    return answer();
  };
  // G92 shifts the workspace so the reported position becomes the given one;
  // nothing moves, and it reports the position (G92.cpp L95-L98, L131).
  const setPosition: MarlinSimHandler = (line) => {
    const words = parseMotionWords(line);
    const { pos } = machine;
    machine.pos = { x: words.x ?? pos.x, y: words.y ?? pos.y, z: words.z ?? pos.z };
    power.x = machine.pos.x;
    power.y = machine.pos.y;
    return answer(positionLine());
  };
  const home: MarlinSimHandler = () =>
    waitThen(homingMs, () => {
      machine.pos = { x: 0, y: 0, z: machine.pos.z };
      machine.runTo = machine.pos;
      power.x = 0;
      power.y = 0;
      machine.isHomed = true;
    });
  const dwell: MarlinSimHandler = (line) => {
    const words = /P\s*(\d*\.?\d+)/i.exec(line)?.[1];
    return waitThen(Number(words ?? 0), () => undefined);
  };
  // The queued M410 runs quickstop_stepper() once more, then waits out the
  // one-second window (motion.cpp L382-L387).
  const quickStopWait: MarlinSimHandler = (_line, firstRun) => {
    if (firstRun) quickStop();
    return queue.drained() ? answer() : false;
  };

  const distanceMode =
    (absolute: boolean): MarlinSimHandler =>
    (line, firstRun) => {
      machine.isAbsolute = absolute;
      return accept(line, firstRun);
    };
  const handlers: Readonly<Record<string, MarlinSimHandler>> = {
    G0: move,
    G1: move,
    G2: move,
    G3: move,
    G4: dwell,
    G28: home,
    G90: distanceMode(true),
    G91: distanceMode(false),
    G92: setPosition,
    M3: synchronized,
    M4: synchronized,
    M5: synchronized,
    M7: synchronized,
    M8: synchronized,
    M9: synchronized,
    M400: () => queue.drained() && answer(),
    M410: quickStopWait,
    M114: () => answer(positionLine()),
    M115: () => answer(FIRMWARE_LINE),
    M105: () => {
      emit('ok T:22.5 /0.0 B:22.1 /0.0');
      return true;
    },
  };

  function runLine(line: string, firstRun: boolean): boolean {
    const code = commandCode(line);
    if (firstRun) {
      const reject = rejects.find((rule) => rule.pattern.test(line));
      if (reject !== undefined) return answer(`Error:${reject.error}`);
      const option = BUILD_OPTION_OF[code];
      if (option !== undefined && !build[option]) return answer(`echo:Unknown command: "${line}"`);
    }
    return (handlers[code] ?? accept)(line, firstRun);
  }

  function quickStop(): void {
    queue.quickStop();
    machine.pos = machine.runTo;
    power.x = machine.pos.x;
    power.y = machine.pos.y;
  }

  // M410 and M112 act when Marlin reads the line (queue.cpp L538-L545).
  function readLine(line: string): boolean {
    if (/^M112\b/i.test(line)) {
      machine.isHalted = true;
      queue.halt();
      emit('echo:M112 Shutdown');
      emit('Error:Printer halted. kill() called!');
      return false;
    }
    if (/^M410\b/i.test(line)) quickStop();
    return true;
  }

  port.onOpen(() => {
    queue.reset();
    machine.isHalted = false;
    if (options.emitBannerOnOpen !== false) emit('start');
  });
  port.onWrite((data) => queue.receive(data));

  return {
    adapter: port.adapter,
    port,
    state: () => ({
      pos: machine.pos,
      isAbsolute: machine.isAbsolute,
      pendingMotions: queue.pendingMotions(),
      isHalted: machine.isHalted,
      isHomed: machine.isHomed,
      fanPower: power.fan,
      laserMode: power.mode,
      inlineBurnPowers: burns
        .filter((burn) => burn.source === 'continuous')
        .map((burn) => burn.power),
      burns: [...burns],
      modelErrors: [...modelErrors],
    }),
    outbound: () => port.outbound(),
  };
}
