// Firmware state and motion model for the Smoothieware simulator
// (smoothie-simulator.ts). Every rule follows Smoothieware edge 38e2cc08:
// - Kernel::call_event(ON_HALT, nullptr) latches `halted`; Conveyor::on_halt
//   flushes the queue (a waiting M400 then prints its ok) and Laser::on_halt
//   turns the beam off (Kernel.cpp L359-L381, Conveyor.cpp L89-L97,
//   Robot.cpp L920-L922). Robot has no halt handler: the seek/feed rates, the
//   M120 stack and the G92 offset survive every halt (Robot.cpp L131-L133).
// - Robot keeps a G92 offset: WPos = MPos + g92, `G92 X<a>` makes the current
//   WPos read a, G92.1/G92.2/bare G92 clear it, and motion targets are work
//   coordinates (Robot.cpp L448-L456, L624-L662). MPos never jumps.
// - F on a G0 line sets the seek rate every later bare G0 inherits
//   (Robot.cpp L1144-L1149); M120/M121 push and pop that state, and M121 on
//   an empty stack does nothing (Robot.cpp L331-L352, L777-L783).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp

import type { FakeSerialPort } from './fake-serial-port';
import {
  hasGWord,
  parseMotionWords,
  resolveTarget,
  SIM_ZERO_VEC3,
  type SimVec3,
} from './grbl-sim-gcode';
import {
  executeSmoothieLine,
  haltSmoothie,
  type SmoothieLaserModel,
} from './smoothie-laser-power-model';

/** Laser module build: 'edge' (the pinned edge), 'pre-2021' (before 971eb8cf:
 *  no M221 P, `Laser power scale at` report) or 'absent' (not loaded). */
export type SmoothieLaserModuleBuild = 'edge' | 'pre-2021' | 'absent';

export type SmoothieSimConfig = {
  readonly delay: number;
  readonly motionMs: number;
  readonly homingMs: number;
  readonly grblMode: boolean;
  readonly laserModule: SmoothieLaserModuleBuild;
  readonly endstops: boolean;
};

type RobotModalState = {
  readonly seekRate: number;
  readonly feedRate: number;
  readonly isAbsolute: boolean;
};

export type SmoothieSimMachine = {
  readonly cfg: SmoothieSimConfig;
  readonly port: FakeSerialPort;
  readonly power: SmoothieLaserModel;
  /** Machine position (MPos). */
  pos: SimVec3;
  /** Robot g92_offset: WPos = MPos + g92. */
  g92: SimVec3;
  machine: 'Idle' | 'Run' | 'Home' | 'Hold' | 'Alarm';
  isAbsolute: boolean;
  isHalted: boolean;
  isHomed: boolean;
  pendingMotions: number;
  pendingSettles: number;
  /** Bumped by every halt, so a flushed move's timer cannot finish a later one. */
  motionEpoch: number;
  homingCycles: number;
  parkMoves: number;
  parkPosition: { readonly x: number; readonly y: number };
  seekRate: number;
  feedRate: number;
  motionMode: 0 | 1;
  /** Programmed rate of the move executing now (the first `F:` while running). */
  currentRate: number;
  readonly seekMoveRates: number[];
  readonly stateStack: RobotModalState[];
  readonly modelErrors: string[];
};

export function createSmoothieMachine(
  cfg: SmoothieSimConfig,
  port: FakeSerialPort,
  power: SmoothieLaserModel,
  defaultSeekRate: number,
  defaultFeedRate: number,
): SmoothieSimMachine {
  return {
    cfg,
    port,
    power,
    pos: SIM_ZERO_VEC3,
    g92: SIM_ZERO_VEC3,
    machine: 'Idle',
    isAbsolute: true,
    isHalted: false,
    isHomed: false,
    pendingMotions: 0,
    pendingSettles: 0,
    motionEpoch: 0,
    homingCycles: 0,
    parkMoves: 0,
    parkPosition: { x: 0, y: 0 },
    seekRate: defaultSeekRate,
    feedRate: defaultFeedRate,
    motionMode: 0,
    currentRate: 0,
    seekMoveRates: [],
    stateStack: [],
    modelErrors: [],
  };
}

export function emitLater(m: SmoothieSimMachine, line: string): void {
  setTimeout(() => m.port.emitLine(line), m.cfg.delay);
}

export function workPosition(m: SmoothieSimMachine): SimVec3 {
  return { x: m.pos.x + m.g92.x, y: m.pos.y + m.g92.y, z: m.pos.z + m.g92.z };
}

/** ON_HALT: print `messages`, stop the beam, flush queued motion. */
export function haltMachine(m: SmoothieSimMachine, messages: ReadonlyArray<string>): void {
  haltSmoothie(m.power);
  m.isHalted = true;
  m.machine = 'Alarm';
  m.motionEpoch += 1;
  m.pendingMotions = 0;
  for (const message of messages) emitLater(m, message);
  flushSettles(m);
}

/** M999, `$X` while halted, and `$H` clear the halt (ON_HALT with an argument). */
export function clearHalt(m: SmoothieSimMachine): void {
  m.isHalted = false;
  m.machine = 'Idle';
}

function flushSettles(m: SmoothieSimMachine): void {
  for (let i = 0; i < m.pendingSettles; i += 1) emitLater(m, 'ok');
  m.pendingSettles = 0;
}

function finishMotion(m: SmoothieSimMachine, epoch: number): void {
  if (epoch !== m.motionEpoch) return;
  m.pendingMotions = Math.max(0, m.pendingMotions - 1);
  if (m.pendingMotions > 0) return;
  if (m.machine === 'Run' || m.machine === 'Home') m.machine = 'Idle';
  flushSettles(m);
}

/** M400: `ok` once the queue is empty (Conveyor::wait_for_idle). */
export function settleQueue(m: SmoothieSimMachine): void {
  if (m.pendingMotions === 0) emitLater(m, 'ok');
  else m.pendingSettles += 1;
}

/** Robot::on_gcode_received for G92 and its subcodes; returns false otherwise. */
export function applyG92(m: SmoothieSimMachine, line: string): boolean {
  const match = /^G92(?:\.(\d+))?(?![\d.])/i.exec(line);
  if (match === null) return false;
  const words = parseMotionWords(line.slice(match[0].length));
  const subcode = Number(match[1] ?? '0');
  if (subcode === 1 || subcode === 2 || !words.hasMotion) {
    m.g92 = SIM_ZERO_VEC3;
  } else if (subcode === 0) {
    const current = workPosition(m);
    m.g92 = {
      x: words.x === null ? m.g92.x : m.g92.x + words.x - current.x,
      y: words.y === null ? m.g92.y : m.g92.y + words.y - current.y,
      z: words.z === null ? m.g92.z : m.g92.z + words.z - current.z,
    };
  }
  // The power oracle tracks the head in the job's (work) coordinates.
  const work = workPosition(m);
  m.power.x = work.x;
  m.power.y = work.y;
  emitLater(m, 'ok');
  return true;
}

/** M120/M121 (push/pop Robot state); returns false for any other line. */
export function applyRobotStateStack(m: SmoothieSimMachine, line: string): boolean {
  if (/^M120\b/i.test(line)) {
    m.stateStack.push({ seekRate: m.seekRate, feedRate: m.feedRate, isAbsolute: m.isAbsolute });
  } else if (/^M121\b/i.test(line)) {
    const saved = m.stateStack.pop();
    if (saved !== undefined)
      ({ seekRate: m.seekRate, feedRate: m.feedRate, isAbsolute: m.isAbsolute } = saved);
  } else {
    return false;
  }
  emitLater(m, 'ok');
  return true;
}

/** A G-code line that may move: laser power, rates, target, queue, `ok`. */
export function runMotionLine(m: SmoothieSimMachine, line: string): void {
  const words = parseMotionWords(line);
  runLaserPower(m, line);
  if (words.setsAbsolute !== null) m.isAbsolute = words.setsAbsolute;
  if (hasGWord(line, 0)) m.motionMode = 0;
  else if (hasGWord(line, 1)) m.motionMode = 1;
  if (words.feed !== null) {
    if (m.motionMode === 0) m.seekRate = words.feed;
    else m.feedRate = words.feed;
  }
  if (words.hasMotion) {
    if (m.motionMode === 0) m.seekMoveRates.push(m.seekRate);
    const wcsToMcs = { x: -m.g92.x, y: -m.g92.y, z: -m.g92.z };
    m.pos = resolveTarget(m.pos, wcsToMcs, words, m.isAbsolute);
    m.currentRate = m.motionMode === 0 ? m.seekRate : m.feedRate;
    queueMotion(m, m.cfg.motionMs);
  }
  emitLater(m, 'ok');
}

function queueMotion(m: SmoothieSimMachine, durationMs: number): void {
  m.machine = 'Run';
  m.pendingMotions += 1;
  const epoch = m.motionEpoch;
  setTimeout(() => finishMotion(m, epoch), durationMs);
}

export function runLaserPower(m: SmoothieSimMachine, line: string): void {
  try {
    executeSmoothieLine(m.power, line);
  } catch (error) {
    m.modelErrors.push(error instanceof Error ? `${line}: ${error.message}` : line);
  }
}

/** Endstops::process_home_command: blocks until the cycle ends, then the
 *  caller's `ok` prints. Without the Endstops module nothing homes; a halt
 *  during the cycle fails it (Endstops.cpp L895-L902). */
export function runHomingCycle(m: SmoothieSimMachine): void {
  if (!m.cfg.endstops) {
    emitLater(m, 'ok');
    return;
  }
  m.machine = 'Home';
  m.pendingMotions = 0;
  const epoch = m.motionEpoch;
  setTimeout(() => {
    if (epoch !== m.motionEpoch) {
      m.port.emitLine(
        m.cfg.grblMode
          ? 'ALARM: Homing fail'
          : 'ERROR: Homing cycle failed - check the max_travel settings',
      );
      m.port.emitLine('ok');
      return;
    }
    m.pos = SIM_ZERO_VEC3;
    const work = workPosition(m);
    m.power.x = work.x;
    m.power.y = work.y;
    m.isHomed = true;
    m.homingCycles += 1;
    m.machine = 'Idle';
    m.port.emitLine('ok');
  }, m.cfg.homingMs);
}

/** Endstops::handle_park: push_state, `G53 G0` to the saved park point at the
 *  current seek rate, wait_for_idle, pop_state. No endstop is touched. */
export function runParkMove(m: SmoothieSimMachine): void {
  m.machine = 'Run';
  m.seekMoveRates.push(m.seekRate);
  const epoch = m.motionEpoch;
  setTimeout(() => {
    // A halt flushed the move; wait_for_idle returns and the `ok` prints.
    if (epoch !== m.motionEpoch) {
      m.port.emitLine('ok');
      return;
    }
    m.pos = { ...m.pos, x: m.parkPosition.x, y: m.parkPosition.y };
    const work = workPosition(m);
    m.power.x = work.x;
    m.power.y = work.y;
    m.parkMoves += 1;
    m.machine = 'Idle';
    m.port.emitLine('ok');
  }, m.cfg.motionMs);
}
