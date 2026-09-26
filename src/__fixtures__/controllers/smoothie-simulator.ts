// smoothie-simulator — scripted Smoothieware V1 firmware (edge 38e2cc08) over
// the fake serial port. Realtime `?` and Ctrl-X, `ok` per G-code line, the
// Smoothie status format (smoothie-sim-replies.ts), `!!` markers while halted
// (`error:Alarm lock` in grbl mode) and M999 halt recovery. Shell lines (`$...`
// and lowercase) answer exactly as upstream SimpleShell does, which means most
// of them print no `ok` (smoothie-sim-shell.ts). The G28 family follows the
// firmware dialect: `grblMode` defaults to false, the non-CNC firmware.bin
// default, where G28 homes and G28.2 only parks. Robot's seek/feed split,
// M120/M121 and the G92 offset follow Robot.cpp (smoothie-sim-machine.ts).
// Controller audit SM-4 made the halt paths, the Laser and Endstops modules and
// the attach greeting match the firmware:
// - Ctrl-X always halts, prints `HALTED, M999 or $X to exit HALT state`
//   (`ALARM: Abort during cycle` in grbl mode), never a banner, and flushes the
//   receive buffer (USBSerial.cpp L302-L314).
// - Halted, GcodeDispatch still runs M2, M5, M9, M30, M105, M114, M115, M119,
//   M80, M81, M911, M503, M106 and M107 (GcodeDispatch.cpp L34, L158-L180).
// - Hard limit and kill button print their `ALARM:` line and halt
//   (Endstops.cpp L420-L430, KillButton.cpp L53-L64).
// - USB attach prints `Smoothie` then `ok` (USBSerial.cpp L328-L333).
// Beam power and burns come from smoothie-laser-power-model.ts.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L302-L333

import { createFakeSerialPort, type FakeSerialPort } from './fake-serial-port';
import type { SimVec3 } from './grbl-sim-gcode';
import { smoothieReferenceEffect, smoothieShellReply } from './smoothie-sim-shell';
import {
  applyG92,
  applyRobotStateStack,
  clearHalt,
  createSmoothieMachine,
  emitLater,
  haltMachine,
  runHomingCycle,
  runLaserPower,
  runMotionLine,
  runParkMove,
  settleQueue,
  workPosition,
  type SmoothieLaserModuleBuild,
  type SmoothieSimConfig,
  type SmoothieSimMachine,
} from './smoothie-sim-machine';
import {
  smoothieFireReply,
  smoothieFirmwareReply,
  smoothieHomedReport,
  smoothieLaserReport,
  smoothieStatusLine,
} from './smoothie-sim-replies';
import {
  executeSmoothieLine,
  powerUpSmoothie,
  type SmoothieBurn,
  type SmoothieLaserModel,
} from './smoothie-laser-power-model';
import type { PlatformAdapter } from '../../platform/types';

export type { SmoothieLaserModuleBuild } from './smoothie-sim-machine';

export type SmoothieSimRejectRule = {
  readonly pattern: RegExp;
  readonly error: string;
};

export type CreateSmoothieSimulatorOptions = {
  readonly responseDelayMs?: number;
  readonly motionMs?: number;
  readonly homingMs?: number;
  readonly rejectLines?: ReadonlyArray<SmoothieSimRejectRule>;
  /** USB attach greeting `Smoothie` + `ok` (true by default). */
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
  /** 'edge' by default; 'pre-2021' has no M221 P; 'absent' has no Laser module. */
  readonly laserModule?: SmoothieLaserModuleBuild;
  /** Endstops module with X/Y homing pins (true by default). False: the module
   *  deleted itself, so `$H` prints `ok` and nothing homes. */
  readonly endstops?: boolean;
};

export type SmoothieSimState = {
  /** Machine position (MPos). */
  readonly pos: SimVec3;
  /** Work position (WPos = MPos + G92 offset). */
  readonly workPos: SimVec3;
  readonly g92Offset: SimVec3;
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
  /** Robot states pushed by M120 and not yet popped. */
  readonly stateStackDepth: number;
  /** Switch outputs bound to M7/M8 (M9 turns both off). */
  readonly coolant: { readonly mist: boolean; readonly flood: boolean };
};

export type SmoothieSimulator = {
  readonly adapter: PlatformAdapter;
  readonly port: FakeSerialPort;
  readonly state: () => SmoothieSimState;
  readonly outbound: () => ReadonlyArray<string>;
  /** Halt without printing anything (a halt whose message was already sent). */
  readonly triggerHalt: () => void;
  /** Endstops::on_idle: `ALARM: Hard limit <dir><axis>`, then halt. */
  readonly hardLimit: (limit?: string) => void;
  /** KillButton::on_idle: `ALARM: Kill button pressed …`, then halt. */
  readonly pressKillButton: () => void;
};

const DEFAULT_RATE_MM_PER_MIN = 4000;
const HALT_ALLOWED_M_CODES: ReadonlySet<number> = new Set([
  2, 5, 9, 30, 105, 114, 115, 119, 80, 81, 911, 503, 106, 107,
]);

export function createSmoothieSimulator(
  options: CreateSmoothieSimulatorOptions = {},
): SmoothieSimulator {
  const cfg = simulatorConfig(options);
  const port = createFakeSerialPort();
  const m = createSmoothieMachine(
    cfg,
    port,
    initialPower(options, cfg),
    options.defaultSeekRate ?? DEFAULT_RATE_MM_PER_MIN,
    DEFAULT_RATE_MM_PER_MIN,
  );
  const rejects = options.rejectLines ?? [];
  let rxBuffer = '';

  const handleLine = (line: string): void => {
    if (line === '') {
      emitLater(m, 'ok'); // GcodeDispatch acknowledges an empty line.
      return;
    }
    if (handleShellLine(m, line) || refuseWhileHalted(m, line)) return;
    const reject = rejects.find((rule) => rule.pattern.test(line));
    if (reject !== undefined) {
      emitLater(m, `error:${reject.error}`);
      return;
    }
    if (!handleNonMotionLine(m, line)) runMotionLine(m, line);
  };

  port.onOpen(() => {
    // A USB re-attach does not reset the board: a halt survives it.
    rxBuffer = '';
    if (options.emitBannerOnOpen === false) return;
    emitLater(m, 'Smoothie');
    emitLater(m, 'ok');
  });

  port.onWrite((data) => {
    for (const ch of data) {
      if (ch === '\x18') {
        // USBSerial flushes its receive buffer after the halt, so the rest of
        // this write and any partial line are dropped.
        haltMachine(m, [
          cfg.grblMode ? 'ALARM: Abort during cycle' : 'HALTED, M999 or $X to exit HALT state',
        ]);
        rxBuffer = '';
        return;
      }
      if (handleRealtime(m, ch)) continue;
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
    state: () => simulatorState(m),
    outbound: () => port.outbound(),
    triggerHalt: () => haltMachine(m, []),
    hardLimit: (limit = '+X') =>
      haltMachine(m, [
        `ALARM: Hard limit ${limit}`,
        '// NOTICE limits are disabled until all have been cleared',
      ]),
    pressKillButton: () =>
      haltMachine(m, ['ALARM: Kill button pressed - reset, $X or M999 to clear HALT']),
  };
}

function simulatorConfig(options: CreateSmoothieSimulatorOptions): SmoothieSimConfig {
  return {
    delay: options.responseDelayMs ?? 1,
    motionMs: options.motionMs ?? 10,
    homingMs: options.homingMs ?? 5,
    grblMode: options.grblMode ?? false,
    laserModule: options.laserModule ?? 'edge',
    endstops: options.endstops ?? true,
  };
}

function initialPower(
  options: CreateSmoothieSimulatorOptions,
  cfg: SmoothieSimConfig,
): SmoothieLaserModel {
  const power = powerUpSmoothie({
    ...(options.maximumS === undefined ? {} : { maximumS: options.maximumS }),
    constantPowerMode: cfg.laserModule === 'edge',
    laserModule: cfg.laserModule !== 'absent',
  });
  for (const line of options.initialPowerLines ?? []) executeSmoothieLine(power, line);
  // An operator's `fire 10` test left the beam in manual mode.
  if (options.initialManualFire === true) executeSmoothieLine(power, 'fire 10');
  power.burns.splice(0);
  return power;
}

function simulatorState(m: SmoothieSimMachine): SmoothieSimState {
  return {
    pos: m.pos,
    workPos: workPosition(m),
    g92Offset: m.g92,
    machine: m.machine,
    isHalted: m.isHalted,
    isHomed: m.isHomed,
    pendingMotions: m.pendingMotions,
    manualFire: m.power.manualFire > 0,
    laserScale: m.power.scale,
    proportionalPower: m.power.proportional,
    burnPowers: m.power.burns.filter((burn) => burn.mode !== 'manual').map((burn) => burn.power),
    burns: [...m.power.burns],
    modelErrors: [...m.modelErrors],
    homingCycles: m.homingCycles,
    parkMoves: m.parkMoves,
    seekRate: m.seekRate,
    seekMoveRates: [...m.seekMoveRates],
    stateStackDepth: m.stateStack.length,
    coolant: { mist: m.power.mist, flood: m.power.flood },
  };
}

// `?` is serviced at any time (USBSerial.cpp L215-L218). `!`/`~` model the
// optional feed hold; KerfDesk's driver never sends them.
function handleRealtime(m: SmoothieSimMachine, ch: string): boolean {
  if (ch === '?') emitLater(m, smoothieStatusLine(m));
  else if (ch === '!') {
    if (m.machine === 'Run') m.machine = 'Hold';
  } else if (ch === '~') {
    if (m.machine === 'Hold') m.machine = m.pendingMotions > 0 ? 'Run' : 'Idle';
  } else return false;
  return true;
}

// SimpleShell owns `$` and lowercase lines whether or not the machine is
// halted; `$H` clears a halt and homes; the Laser module owns `fire`.
function handleShellLine(m: SmoothieSimMachine, line: string): boolean {
  if (line === '$H') {
    clearHalt(m);
    runHomingCycle(m);
    return true;
  }
  if (/^fire\b/.test(line)) {
    // Nothing answers `fire` without the Laser module, and the module
    // ignores every command while halted (Laser.cpp L126).
    if (m.cfg.laserModule === 'absent' || m.isHalted) return true;
    runLaserPower(m, line);
    emitLater(m, smoothieFireReply(line, m.power.manualFire > 0));
    return true;
  }
  const shell = smoothieShellReply(line, { halted: m.isHalted });
  if (shell === null) return false;
  if (shell.clearsHalt) clearHalt(m);
  for (const reply of shell.lines) emitLater(m, reply);
  return true;
}

// A halted kernel runs M999 and the allowed M-codes; everything else draws
// `!!` (`error:Alarm lock` in grbl mode).
function refuseWhileHalted(m: SmoothieSimMachine, line: string): boolean {
  if (!m.isHalted) return false;
  const code = /^M(\d+)/i.exec(line);
  if (code !== null && Number(code[1]) === 999) {
    clearHalt(m);
    emitLater(m, 'WARNING: After HALT you should HOME as position is currently unknown');
    emitLater(m, 'ok');
    return true;
  }
  if (code !== null && HALT_ALLOWED_M_CODES.has(Number(code[1]))) return false;
  emitLater(m, m.cfg.grblMode ? 'error:Alarm lock' : '!!');
  return true;
}

function handleNonMotionLine(m: SmoothieSimMachine, line: string): boolean {
  if (/^M999\b/i.test(line)) {
    emitLater(m, 'ok');
    return true;
  }
  if (/^M400\b/i.test(line)) {
    settleQueue(m);
    return true;
  }
  return (
    handleReference(m, line) ||
    handleQuery(m, line) ||
    applyRobotStateStack(m, line) ||
    applyG92(m, line)
  );
}

// Homing and parking block inside on_gcode_received, so the line's `ok`
// (GcodeDispatch, or SimpleShell for `$H`) prints only once motion ends.
function handleReference(m: SmoothieSimMachine, line: string): boolean {
  const effect = smoothieReferenceEffect(line, m.cfg.grblMode);
  if (effect === null) return false;
  // Only Endstops handles G28 (Endstops.cpp L1046); without it GcodeDispatch
  // just prints `ok`.
  if (!m.cfg.endstops) emitLater(m, 'ok');
  else if (effect === 'home') runHomingCycle(m);
  else if (effect === 'park') runParkMove(m);
  else if (effect === 'report') for (const reply of smoothieHomedReport(m)) emitLater(m, reply);
  else {
    m.parkPosition = { x: m.pos.x, y: m.pos.y };
    emitLater(m, 'ok');
  }
  return true;
}

function handleQuery(m: SmoothieSimMachine, line: string): boolean {
  if (/^M114\b/i.test(line)) {
    // Robot::print_position subcode 0 prints the WCS position after `ok`.
    const work = workPosition(m);
    emitLater(m, `ok C: X:${work.x.toFixed(4)} Y:${work.y.toFixed(4)} Z:${work.z.toFixed(4)}`);
    return true;
  }
  if (/^M115\b/i.test(line)) {
    for (const reply of smoothieFirmwareReply(m.cfg.grblMode)) emitLater(m, reply);
    return true;
  }
  if (/^M221\s*$/i.test(line)) {
    const report = smoothieLaserReport(m);
    if (report !== null) emitLater(m, report);
    emitLater(m, 'ok');
    return true;
  }
  return false;
}
