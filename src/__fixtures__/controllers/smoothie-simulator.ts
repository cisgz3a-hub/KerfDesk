// smoothie-simulator — scripted Smoothieware V1 firmware over the fake serial
// port. GRBL-flavored realtime bytes (? ! ~ Ctrl-X), `ok` per G-code line,
// Smoothie status format `<Idle|MPos:x,y,z|WPos:x,y,z>`, `!!` markers while
// halted (`error:Alarm lock` in grbl mode), M999 halt recovery. Shell lines
// (`$...` and lowercase) answer exactly as upstream SimpleShell does, which
// means most of them print no `ok` (smoothie-sim-shell.ts). The G28 family
// follows the firmware dialect: `grblMode` defaults to false, the non-CNC
// firmware.bin default, where G28 homes and G28.2 only parks.
// Robot.cpp's seek/feed split is modelled too: F on a G0 line sets the seek
// rate every later bare G0 inherits, and M120/M121 push/pop that state.
// https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/robot/Robot.cpp
// Beam power and burns come from smoothie-laser-power-model.ts.

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import { hasGWord, parseMotionWords, SIM_ZERO_VEC3, type SimVec3 } from './grbl-sim-gcode';
import { smoothieReferenceEffect, smoothieShellReply } from './smoothie-sim-shell';
import {
  executeSmoothieLine,
  haltSmoothie,
  powerUpSmoothie,
  type SmoothieBurn,
} from './smoothie-laser-power-model';
import type { PlatformAdapter } from '../../platform/types';

export type SmoothieSimRejectRule = {
  readonly pattern: RegExp;
  readonly error: string;
};

export type CreateSmoothieSimulatorOptions = {
  readonly responseDelayMs?: number;
  readonly motionMs?: number;
  readonly homingMs?: number;
  readonly rejectLines?: ReadonlyArray<SmoothieSimRejectRule>;
  readonly emitBannerOnOpen?: boolean;
  readonly initialManualFire?: boolean;
  /** laser_module_maximum_s_value (1 by default). */
  readonly maximumS?: number;
  /** Lines the board ran before this connection, which keep the beam state they left. */
  readonly initialPowerLines?: ReadonlyArray<string>;
  /** Kernel grbl_mode. False (the default) models the stock non-CNC build. */
  readonly grblMode?: boolean;
  /** Robot default_seek_rate in mm/min (the config-sample value by default). */
  readonly defaultSeekRate?: number;
};

export type SmoothieSimState = {
  readonly pos: SimVec3;
  readonly machine: 'Idle' | 'Run' | 'Home' | 'Hold' | 'Alarm';
  readonly isHalted: boolean;
  readonly isHomed: boolean;
  readonly pendingMotions: number;
  readonly manualFire: boolean;
  readonly laserScale: number;
  readonly proportionalPower: boolean;
  readonly burnPowers: ReadonlyArray<number>;
  /** Every move made with the beam on, in the order they were planned. */
  readonly burns: ReadonlyArray<SmoothieBurn>;
  /** Lines the power model does not cover (see smoothie-laser-power-model.ts). */
  readonly modelErrors: ReadonlyArray<string>;
  /** Endstop homing cycles actually run. */
  readonly homingCycles: number;
  /** Endstops::handle_park rapids to the saved park point. */
  readonly parkMoves: number;
  /** Current Robot seek_rate (mm/min): what a bare G0 would run at. */
  readonly seekRate: number;
  /** The seek rate each G0 move ran at, in order. */
  readonly seekMoveRates: ReadonlyArray<number>;
};

export type SmoothieSimulator = {
  readonly adapter: PlatformAdapter;
  readonly port: FakeSerialPort;
  readonly state: () => SmoothieSimState;
  readonly outbound: () => ReadonlyArray<string>;
  readonly triggerHalt: () => void;
};

type RobotModalState = {
  readonly seekRate: number;
  readonly feedRate: number;
  readonly isAbsolute: boolean;
};

const DEFAULT_SEEK_RATE_MM_PER_MIN = 4000;
const DEFAULT_FEED_RATE_MM_PER_MIN = 4000;

export function createSmoothieSimulator(
  options: CreateSmoothieSimulatorOptions = {},
): SmoothieSimulator {
  const delay = options.responseDelayMs ?? 1;
  const motionMs = options.motionMs ?? 10;
  const homingMs = options.homingMs ?? 5;
  const rejects = options.rejectLines ?? [];
  const grblMode = options.grblMode ?? false;
  const port = createFakeSerialPort();
  let pos: SimVec3 = SIM_ZERO_VEC3;
  let machine: SmoothieSimState['machine'] = 'Idle';
  let isAbsolute = true;
  let isHalted = false;
  let isHomed = false;
  let pendingMotions = 0;
  let pendingSettles = 0;
  const power = powerUpSmoothie(
    options.maximumS === undefined ? {} : { maximumS: options.maximumS },
  );
  for (const line of options.initialPowerLines ?? []) executeSmoothieLine(power, line);
  // An operator's `fire 10` test left the beam in manual mode.
  if (options.initialManualFire === true) executeSmoothieLine(power, 'fire 10');
  power.burns.splice(0);
  const modelErrors: string[] = [];
  let homingCycles = 0;
  let parkMoves = 0;
  let parkPosition = { x: 0, y: 0 }; // Endstops saved_position{0}
  let seekRate = options.defaultSeekRate ?? DEFAULT_SEEK_RATE_MM_PER_MIN;
  let feedRate = DEFAULT_FEED_RATE_MM_PER_MIN;
  let motionMode: 0 | 1 = 0;
  const seekMoveRates: number[] = [];
  const stateStack: RobotModalState[] = [];
  let rxBuffer = '';

  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), delay);
  };
  const fmt = (n: number): string => n.toFixed(4);
  const statusLine = (): string => {
    const label = isHalted ? 'Alarm' : machine;
    // Smoothie's grbl-mode report appends `F:<feed>,<override%>` — the
    // second component is the FEED OVERRIDE, not spindle (audit F7; per the
    // Smoothieware docs, not hardware-verified). The parser must never read
    // it as an S value.
    return `<${label}|MPos:${fmt(pos.x)},${fmt(pos.y)},${fmt(pos.z)}|WPos:${fmt(pos.x)},${fmt(pos.y)},${fmt(pos.z)}|F:4000.0,100.0>`;
  };

  const finishMotion = (): void => {
    pendingMotions = Math.max(0, pendingMotions - 1);
    if (pendingMotions === 0 && (machine === 'Run' || machine === 'Home')) machine = 'Idle';
    if (pendingMotions === 0) {
      for (let i = 0; i < pendingSettles; i += 1) emit('ok');
      pendingSettles = 0;
    }
  };

  const handleRealtime = (byte: string): void => {
    if (byte === '?') {
      emit(statusLine());
      return;
    }
    if (byte === '!') {
      if (machine === 'Run') machine = 'Hold';
      return;
    }
    if (byte === '~') {
      if (machine === 'Hold') machine = pendingMotions > 0 ? 'Run' : 'Idle';
      return;
    }
    if (byte === '\x18') {
      haltSmoothie(power); // Laser::on_halt clears manual fire and output.
      // Ctrl-X abort: flush motion; Smoothie halts if it was moving.
      if (machine === 'Run' || machine === 'Hold' || pendingMotions > 0) isHalted = true;
      pendingMotions = 0;
      machine = isHalted ? 'Alarm' : 'Idle';
      emit('Smoothie');
    }
  };

  const handleQuery = (line: string): boolean => {
    if (/^M114\b/i.test(line)) {
      emit(`ok C: X:${pos.x.toFixed(4)} Y:${pos.y.toFixed(4)} Z:${pos.z.toFixed(4)}`);
      return true;
    }
    if (/^M115\b/i.test(line)) {
      emit(
        `FIRMWARE_NAME:Smoothieware, FIRMWARE_URL:http%3A//smoothieware.org, X-GRBL_MODE:${grblMode ? 1 : 0}`,
      );
      emit('ok');
      return true;
    }
    return false;
  };

  // Homing and parking block inside on_gcode_received, so the line's `ok`
  // (GcodeDispatch, or SimpleShell for `$H`) prints only once motion ends.
  const runHomingCycle = (): void => {
    machine = 'Home';
    pendingMotions = 0;
    setTimeout(() => {
      pos = SIM_ZERO_VEC3;
      power.x = 0;
      power.y = 0;
      isHomed = true;
      homingCycles += 1;
      machine = 'Idle';
      port.emitLine('ok');
    }, homingMs);
  };
  const runParkMove = (): void => {
    // handle_park: push_state, `G53 G0 X<saved> Y<saved>` at the current
    // seek rate, wait_for_idle, pop_state. No endstop is touched.
    machine = 'Run';
    seekMoveRates.push(seekRate);
    setTimeout(() => {
      pos = { ...pos, x: parkPosition.x, y: parkPosition.y };
      power.x = parkPosition.x;
      power.y = parkPosition.y;
      parkMoves += 1;
      machine = 'Idle';
      port.emitLine('ok');
    }, motionMs);
  };
  const handleReference = (line: string): boolean => {
    const effect = smoothieReferenceEffect(line, grblMode);
    if (effect === null) return false;
    if (effect === 'home') runHomingCycle();
    else if (effect === 'park') runParkMove();
    else {
      parkPosition = { x: pos.x, y: pos.y };
      emit('ok');
    }
    return true;
  };

  const handleLaserPower = (line: string): void => {
    try {
      executeSmoothieLine(power, line);
    } catch (error) {
      modelErrors.push(error instanceof Error ? `${line}: ${error.message}` : line);
    }
  };

  // Robot::process_move: `if (motion_mode == SEEK) seek_rate = F else feed_rate = F`.
  const applyRates = (line: string, words: ReturnType<typeof parseMotionWords>): void => {
    if (hasGWord(line, 0)) motionMode = 0;
    else if (hasGWord(line, 1)) motionMode = 1;
    if (words.feed !== null) {
      if (motionMode === 0) seekRate = words.feed;
      else feedRate = words.feed;
    }
    if (words.hasMotion && motionMode === 0) seekMoveRates.push(seekRate);
  };

  const handleRobotState = (line: string): boolean => {
    if (/^M120\b/i.test(line)) {
      stateStack.push({ seekRate, feedRate, isAbsolute });
    } else if (/^M121\b/i.test(line)) {
      const saved = stateStack.pop();
      if (saved !== undefined) ({ seekRate, feedRate, isAbsolute } = saved);
    } else {
      return false;
    }
    emit('ok');
    return true;
  };

  const handleMotion = (line: string): void => {
    const words = parseMotionWords(line);
    handleLaserPower(line);
    if (words.setsAbsolute !== null) isAbsolute = words.setsAbsolute;
    applyRates(line, words);
    if (words.hasMotion) {
      pos = {
        x: words.x === null ? pos.x : isAbsolute ? words.x : pos.x + words.x,
        y: words.y === null ? pos.y : isAbsolute ? words.y : pos.y + words.y,
        z: words.z === null ? pos.z : isAbsolute ? words.z : pos.z + words.z,
      };
      machine = 'Run';
      pendingMotions += 1;
      setTimeout(finishMotion, motionMs);
    }
    emit('ok');
  };

  // SimpleShell owns `$` and lowercase lines whether or not the machine is
  // halted; `$H` clears a halt and homes. Returns false for G-code lines.
  const handleShellLine = (line: string): boolean => {
    if (line === '$H') {
      isHalted = false;
      runHomingCycle();
      return true;
    }
    const shell = smoothieShellReply(line, { halted: isHalted });
    if (shell === null) return false;
    if (shell.clearsHalt) {
      isHalted = false;
      machine = 'Idle';
    }
    for (const reply of shell.lines) emit(reply);
    return true;
  };

  // A halted kernel refuses every G-code except M999 (`!!`, or `error:Alarm
  // lock` in grbl mode), and Laser::on_console_line_received returns before
  // printing anything, so `fire off` is silently ignored in that state.
  const refuseWhileHalted = (line: string): boolean => {
    if (!isHalted || /^M999\b/i.test(line)) return false;
    if (!/^fire\b/.test(line)) emit(grblMode ? 'error:Alarm lock' : '!!');
    return true;
  };

  const handleNonMotionLine = (line: string): boolean => {
    if (/^M999\b/i.test(line)) {
      isHalted = false;
      machine = 'Idle';
      emit('ok');
      return true;
    }
    if (line === 'fire off' || line === 'fire 0') {
      handleLaserPower(line);
      emit('turning laser off and returning to auto mode'); // native completion, no ok
      return true;
    }
    if (/^M400\b/i.test(line)) {
      if (pendingMotions === 0) emit('ok');
      else pendingSettles += 1;
      return true;
    }
    return handleReference(line) || handleQuery(line) || handleRobotState(line);
  };

  const handleLine = (line: string): void => {
    if (line === '') {
      emit('ok'); // GcodeDispatch acknowledges an empty line.
      return;
    }
    if (handleShellLine(line) || refuseWhileHalted(line)) return;
    const reject = rejects.find((rule) => rule.pattern.test(line));
    if (reject !== undefined) {
      emit(`error:${reject.error}`);
      return;
    }
    if (!handleNonMotionLine(line)) handleMotion(line);
  };

  port.onOpen(() => {
    rxBuffer = '';
    isHalted = false;
    if (options.emitBannerOnOpen !== false) emit('Smoothie command shell');
  });

  port.onWrite((data) => {
    for (const ch of data) {
      if (ch === '?' || ch === '!' || ch === '~' || ch === '\x18') {
        handleRealtime(ch);
        continue;
      }
      if (ch === '\n') {
        const line = rxBuffer.trim();
        rxBuffer = '';
        handleLine(line);
        continue;
      }
      if (ch !== '\r') rxBuffer += ch;
    }
  });

  return {
    adapter: port.adapter,
    port,
    state: () => ({
      pos,
      machine,
      isHalted,
      isHomed,
      pendingMotions,
      manualFire: power.manualFire > 0,
      laserScale: power.scale,
      proportionalPower: power.proportional,
      burnPowers: power.burns.filter((burn) => burn.mode !== 'manual').map((burn) => burn.power),
      burns: [...power.burns],
      modelErrors: [...modelErrors],
      homingCycles,
      parkMoves,
      seekRate,
      seekMoveRates: [...seekMoveRates],
    }),
    outbound: () => port.outbound(),
    triggerHalt: () => {
      isHalted = true;
      machine = 'Alarm';
    },
  };
}
