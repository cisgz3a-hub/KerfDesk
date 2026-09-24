// marlin-simulator — scripted Marlin firmware over the fake serial port.
// Vocabulary: `start` boot banner, `ok` per accepted line, `echo:busy:` while
// long operations run, `Error:<text>` rejections, M114 position lines, M115
// firmware identity, G28 homing that acks on completion, M400 that acks when
// buffered motion drains, and M112 which halts the firmware until reconnect.
// Beam power, fan power and burns come from marlin-laser-power-model.ts.

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import { parseMotionWords, SIM_ZERO_VEC3, type SimVec3 } from './grbl-sim-gcode';
import { executeMarlinLine, powerUpMarlin, type MarlinBurn } from './marlin-laser-power-model';
import type { PlatformAdapter } from '../../platform/types';

export type MarlinSimRejectRule = {
  readonly pattern: RegExp;
  readonly error: string;
};

export type CreateMarlinSimulatorOptions = {
  readonly responseDelayMs?: number;
  readonly motionMs?: number;
  readonly homingMs?: number;
  readonly rejectLines?: ReadonlyArray<MarlinSimRejectRule>;
  readonly emitBannerOnOpen?: boolean;
  /** Lines the board ran before this connection. A board that does not reset
   * when the port opens keeps the beam state they left. */
  readonly initialPowerLines?: ReadonlyArray<string>;
};

export type MarlinSimState = {
  readonly pos: SimVec3;
  readonly isAbsolute: boolean;
  readonly pendingMotions: number;
  readonly isHalted: boolean;
  readonly isHomed: boolean;
  readonly fanPower: number;
  readonly laserMode: 'standard' | 'continuous' | 'dynamic';
  readonly inlineBurnPowers: ReadonlyArray<number>;
  /** Every move made with the beam on, in the order Marlin planned them. */
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

export function createMarlinSimulator(options: CreateMarlinSimulatorOptions = {}): MarlinSimulator {
  const delay = options.responseDelayMs ?? 1;
  const motionMs = options.motionMs ?? 10;
  const homingMs = options.homingMs ?? 5;
  const rejects = options.rejectLines ?? [];
  const port = createFakeSerialPort();
  let pos: SimVec3 = SIM_ZERO_VEC3;
  let isAbsolute = true;
  let pendingMotions = 0;
  let isHalted = false;
  let isHomed = false;
  const power = powerUpMarlin();
  for (const line of options.initialPowerLines ?? []) executeMarlinLine(power, line);
  power.burns.splice(0);
  const modelErrors: string[] = [];
  const pendingSettles: Array<() => void> = [];
  let rxBuffer = '';

  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), delay);
  };
  const positionLine = (): string =>
    `X:${pos.x.toFixed(2)} Y:${pos.y.toFixed(2)} Z:${pos.z.toFixed(2)} E:0.00 Count X:0 Y:0 Z:0`;

  const finishMotion = (): void => {
    pendingMotions = Math.max(0, pendingMotions - 1);
    if (pendingMotions === 0) pendingSettles.splice(0).forEach((complete) => complete());
  };

  const handleLaserPower = (line: string): void => {
    try {
      executeMarlinLine(power, line);
    } catch (error) {
      modelErrors.push(error instanceof Error ? `${line}: ${error.message}` : line);
    }
  };

  const handleMotion = (line: string): void => {
    const words = parseMotionWords(line);
    handleLaserPower(line);
    if (words.setsAbsolute !== null) isAbsolute = words.setsAbsolute;
    if (words.hasMotion) {
      pos = {
        x: words.x === null ? pos.x : isAbsolute ? words.x : pos.x + words.x,
        y: words.y === null ? pos.y : isAbsolute ? words.y : pos.y + words.y,
        z: words.z === null ? pos.z : isAbsolute ? words.z : pos.z + words.z,
      };
      pendingMotions += 1;
      setTimeout(finishMotion, motionMs);
    }
    emit('ok');
  };

  const handleLine = (line: string): void => {
    if (isHalted) return;
    const reject = rejects.find((rule) => rule.pattern.test(line));
    if (reject !== undefined) {
      emit(`Error:${reject.error}`);
      return;
    }
    if (line === '') {
      emit('ok');
      return;
    }
    if (/^M112\b/i.test(line)) {
      isHalted = true;
      emit('Error:Printer halted. kill() called!');
      return;
    }
    if (/^G28\b/i.test(line)) {
      pendingMotions = 0;
      setTimeout(() => {
        pos = { x: 0, y: 0, z: pos.z };
        power.x = 0;
        power.y = 0;
        isHomed = true;
        port.emitLine('ok');
      }, homingMs);
      return;
    }
    if (/^M(?:400|5)\b/i.test(line)) {
      // M5 (including M5 I) synchronizes the planner in native Marlin.
      const complete = (): void => (/^M5\b/i.test(line) ? handleMotion(line) : emit('ok'));
      if (pendingMotions === 0) complete();
      else pendingSettles.push(complete);
      return;
    }
    if (/^M114\b/i.test(line)) {
      emit(positionLine());
      emit('ok');
      return;
    }
    if (/^M115\b/i.test(line)) {
      emit(FIRMWARE_LINE);
      emit('ok');
      return;
    }
    if (/^M105\b/i.test(line)) {
      emit('ok T:22.5 /0.0 B:22.1 /0.0');
      return;
    }
    handleMotion(line);
  };

  port.onOpen(() => {
    rxBuffer = '';
    isHalted = false;
    if (options.emitBannerOnOpen !== false) emit('start');
  });

  port.onWrite((data) => {
    for (const ch of data) {
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
      isAbsolute,
      pendingMotions,
      isHalted,
      isHomed,
      fanPower: power.fan,
      laserMode: power.mode,
      inlineBurnPowers: power.burns
        .filter((burn) => burn.source === 'continuous')
        .map((burn) => burn.power),
      burns: [...power.burns],
      modelErrors: [...modelErrors],
    }),
    outbound: () => port.outbound(),
  };
}
