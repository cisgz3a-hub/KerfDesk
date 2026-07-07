// smoothie-simulator — scripted Smoothieware firmware over the fake serial
// port. GRBL-flavored realtime bytes (? ! ~ Ctrl-X), `ok` per line, Smoothie
// status format `<Idle|MPos:x,y,z|WPos:x,y,z>`, `!!` markers while halted,
// M999 halt recovery, G28.2 homing that acks on completion.

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import { parseMotionWords, SIM_ZERO_VEC3, type SimVec3 } from './grbl-sim-gcode';
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
};

export type SmoothieSimState = {
  readonly pos: SimVec3;
  readonly machine: 'Idle' | 'Run' | 'Home' | 'Hold' | 'Alarm';
  readonly isHalted: boolean;
  readonly isHomed: boolean;
  readonly pendingMotions: number;
};

export type SmoothieSimulator = {
  readonly adapter: PlatformAdapter;
  readonly port: FakeSerialPort;
  readonly state: () => SmoothieSimState;
  readonly outbound: () => ReadonlyArray<string>;
  readonly triggerHalt: () => void;
};

export function createSmoothieSimulator(
  options: CreateSmoothieSimulatorOptions = {},
): SmoothieSimulator {
  const delay = options.responseDelayMs ?? 1;
  const motionMs = options.motionMs ?? 10;
  const homingMs = options.homingMs ?? 5;
  const rejects = options.rejectLines ?? [];
  const port = createFakeSerialPort();
  let pos: SimVec3 = SIM_ZERO_VEC3;
  let machine: SmoothieSimState['machine'] = 'Idle';
  let isAbsolute = true;
  let isHalted = false;
  let isHomed = false;
  let pendingMotions = 0;
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
      emit('FIRMWARE_NAME:Smoothieware, FIRMWARE_URL:http%3A//smoothieware.org');
      emit('ok');
      return true;
    }
    if (/^version\b/i.test(line)) {
      emit('Build version: edge-abc123, Build date: 2024, MCU: LPC1769');
      emit('ok');
      return true;
    }
    return false;
  };

  const handleMotion = (line: string): void => {
    const words = parseMotionWords(line);
    if (words.setsAbsolute !== null) isAbsolute = words.setsAbsolute;
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

  const handleLine = (line: string): void => {
    if (isHalted && !/^M999\b/i.test(line)) {
      emit('!!');
      return;
    }
    const reject = rejects.find((rule) => rule.pattern.test(line));
    if (reject !== undefined) {
      emit(`error:${reject.error}`);
      return;
    }
    if (/^M999\b/i.test(line)) {
      isHalted = false;
      machine = 'Idle';
      emit('ok');
      return;
    }
    if (/^G28\.2\b/i.test(line)) {
      machine = 'Home';
      pendingMotions = 0;
      setTimeout(() => {
        pos = SIM_ZERO_VEC3;
        isHomed = true;
        machine = 'Idle';
        port.emitLine('ok');
      }, homingMs);
      return;
    }
    if (handleQuery(line)) return;
    handleMotion(line);
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
    state: () => ({ pos, machine, isHalted, isHomed, pendingMotions }),
    outbound: () => port.outbound(),
    triggerHalt: () => {
      isHalted = true;
      machine = 'Alarm';
    },
  };
}
