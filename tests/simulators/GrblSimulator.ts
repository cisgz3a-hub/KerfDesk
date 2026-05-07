/**
 * T2-47: firmware-side GRBL simulator for tests that need controller
 * behavior, not just a transport mock. This intentionally lives under
 * tests/ so production code does not depend on simulator internals.
 */

import type { SerialPortLike } from '../../src/communication/SerialPort';
import { grblCapabilities } from '../../src/controllers/ControllerCapabilities';
import type { ControllerCapabilities } from '../../src/controllers/ControllerCapabilities';
import type { ControllerFault } from '../helpers/ControllerFault';
import type {
  SimulatedControllerDevice,
  SimulatedControllerIdentity,
} from './SimulatedControllerDevice';

export type GrblSimulatorState = 'idle' | 'run' | 'hold' | 'alarm' | 'door' | 'check' | 'sleep';
export type DistanceMode = 'absolute' | 'relative';
export type UnitsMode = 'mm' | 'inch';
export type LaserMode = 'M3' | 'M4' | 'M5';
export type WorkCoordinateSystem = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GrblModalState {
  units: UnitsMode;
  distanceMode: DistanceMode;
  laserMode: LaserMode;
  spindleSpeed: number;
  feedRate: number | null;
  wcs: WorkCoordinateSystem;
  g92Offset: Vec3;
}

export interface GrblFirmwareSnapshot {
  state: GrblSimulatorState;
  alarmCode: number | null;
  position: Vec3;
  positionTrusted: boolean;
  modal: GrblModalState;
  rxBufferUsed: number;
  rxBufferHighWater: number;
  rxOverflowCount: number;
  plannerQueueLength: number;
  plannerCapacity: number;
}

interface ParsedMove {
  from: Vec3;
  to: Vec3;
  durationMs: number;
  elapsedMs: number;
}

export interface GrblSimulatorOptions {
  rxBufferSize?: number;
  plannerCapacity?: number;
  bedWidth?: number;
  bedHeight?: number;
}

const DEFAULT_RX_BUFFER_SIZE = 127;
const DEFAULT_PLANNER_CAPACITY = 35;
const DEFAULT_BED_WIDTH = 200;
const DEFAULT_BED_HEIGHT = 200;

function cloneVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function defaultModal(): GrblModalState {
  return {
    units: 'mm',
    distanceMode: 'absolute',
    laserMode: 'M5',
    spindleSpeed: 0,
    feedRate: null,
    wcs: 'G54',
    g92Offset: { x: 0, y: 0, z: 0 },
  };
}

function parseWords(line: string): Map<string, number> {
  const words = new Map<string, number>();
  const matches = line.matchAll(/([A-Z])\s*(-?\d+(?:\.\d+)?)/g);
  for (const match of matches) {
    words.set(match[1], Number(match[2]));
  }
  return words;
}

function hasToken(line: string, token: string): boolean {
  return new RegExp(`(^|\\s)${token}(\\s|$)`).test(line);
}

export class GrblSimulator implements SimulatedControllerDevice<GrblFirmwareSnapshot> {
  readonly identity: SimulatedControllerIdentity = {
    family: 'grbl',
    protocol: 'GRBL 1.1',
    displayName: 'GRBL 1.1 simulator',
  };
  readonly capabilities: ControllerCapabilities = grblCapabilities;
  readonly rxBufferSize: number;
  readonly plannerCapacity: number;
  readonly bedWidth: number;
  readonly bedHeight: number;

  private state: GrblSimulatorState = 'idle';
  private alarmCode: number | null = null;
  private position: Vec3 = { x: 0, y: 0, z: 0 };
  private positionTrusted = true;
  private modal = defaultModal();
  private rxLine = '';
  private rxBufferUsed = 0;
  private rxBufferHighWater = 0;
  private rxOverflowCount = 0;
  private readonly plannerQueue: ParsedMove[] = [];
  private readonly outgoing: string[] = [];
  private readonly injectedFaults = new Map<string, ControllerFault>();
  private nextFaultId = 1;

  constructor(options: GrblSimulatorOptions = {}) {
    this.rxBufferSize = options.rxBufferSize ?? DEFAULT_RX_BUFFER_SIZE;
    this.plannerCapacity = options.plannerCapacity ?? DEFAULT_PLANNER_CAPACITY;
    this.bedWidth = options.bedWidth ?? DEFAULT_BED_WIDTH;
    this.bedHeight = options.bedHeight ?? DEFAULT_BED_HEIGHT;
  }

  receiveText(text: string): void {
    this.receiveBytes(new TextEncoder().encode(text));
  }

  receiveBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      if (byte === 0x18 || byte === 0x21 || byte === 0x3f || byte === 0x7e) {
        this.receiveRealtimeByte(byte);
        continue;
      }
      const char = String.fromCharCode(byte);
      this.rxBufferUsed += 1;
      this.rxBufferHighWater = Math.max(this.rxBufferHighWater, this.rxBufferUsed);
      if (this.rxBufferUsed > this.rxBufferSize) {
        this.rxOverflowCount += 1;
        this.rxLine = '';
        this.rxBufferUsed = 0;
        this.outgoing.push('error:24');
        continue;
      }
      if (char === '\n' || char === '\r') {
        const line = this.rxLine.trim();
        this.rxLine = '';
        this.rxBufferUsed = 0;
        if (line.length > 0 || char === '\n') {
          this.handleLine(line);
        }
      } else {
        this.rxLine += char;
      }
    }
  }

  receiveRealtimeByte(byte: number): void {
    if (byte === 0x3f) {
      this.outgoing.push(this.statusReport());
      return;
    }
    if (byte === 0x21) {
      if (this.state === 'run' || this.state === 'idle') {
        this.state = 'hold';
      }
      return;
    }
    if (byte === 0x7e) {
      if (this.state === 'hold') {
        this.state = this.plannerQueue.length > 0 ? 'run' : 'idle';
      }
      return;
    }
    if (byte === 0x18) {
      this.softReset();
    }
  }

  tick(elapsedMs: number): void {
    if (this.state !== 'run') return;
    let remaining = Math.max(0, elapsedMs);
    while (remaining > 0 && this.plannerQueue.length > 0 && this.state === 'run') {
      const move = this.plannerQueue[0];
      const step = Math.min(remaining, move.durationMs - move.elapsedMs);
      move.elapsedMs += step;
      remaining -= step;
      const ratio = move.durationMs <= 0 ? 1 : Math.min(1, move.elapsedMs / move.durationMs);
      this.position = {
        x: move.from.x + (move.to.x - move.from.x) * ratio,
        y: move.from.y + (move.to.y - move.from.y) * ratio,
        z: move.from.z + (move.to.z - move.from.z) * ratio,
      };
      if (move.elapsedMs >= move.durationMs) {
        this.position = cloneVec(move.to);
        this.plannerQueue.shift();
      }
    }
    if (this.plannerQueue.length === 0 && this.state === 'run') {
      this.state = 'idle';
    }
  }

  readOutgoingLines(): string[] {
    return this.outgoing.splice(0);
  }

  readOutgoingBytes(): Uint8Array[] {
    const encoder = new TextEncoder();
    return this.readOutgoingLines().map(line => encoder.encode(`${line}\n`));
  }

  snapshot(): GrblFirmwareSnapshot {
    return {
      state: this.state,
      alarmCode: this.alarmCode,
      position: cloneVec(this.position),
      positionTrusted: this.positionTrusted,
      modal: {
        ...this.modal,
        g92Offset: cloneVec(this.modal.g92Offset),
      },
      rxBufferUsed: this.rxBufferUsed,
      rxBufferHighWater: this.rxBufferHighWater,
      rxOverflowCount: this.rxOverflowCount,
      plannerQueueLength: this.plannerQueue.length,
      plannerCapacity: this.plannerCapacity,
    };
  }

  resetToFactory(): void {
    this.state = 'idle';
    this.alarmCode = null;
    this.position = { x: 0, y: 0, z: 0 };
    this.positionTrusted = true;
    this.modal = defaultModal();
    this.rxLine = '';
    this.rxBufferUsed = 0;
    this.rxBufferHighWater = 0;
    this.rxOverflowCount = 0;
    this.plannerQueue.length = 0;
    this.outgoing.length = 0;
  }

  reset(): void {
    this.resetToFactory();
  }

  injectFault(fault: ControllerFault): string {
    const id = `fault_${this.nextFaultId++}`;
    this.injectedFaults.set(id, fault);
    return id;
  }

  private handleLine(line: string): void {
    if (line === '') {
      this.outgoing.push('ok');
      return;
    }
    if (line.startsWith(';')) return;

    const upper = line.toUpperCase();
    if (upper === '$$') {
      this.outgoing.push(
        '$10=0',
        '$22=0',
        '$23=0',
        '$32=0',
        '$30=1000.000',
        '$110=10000.000',
        '$111=10000.000',
        '$120=10.000',
        '$121=10.000',
        `$130=${this.bedWidth.toFixed(3)}`,
        `$131=${this.bedHeight.toFixed(3)}`,
        'ok',
      );
      return;
    }
    if (upper === '$#') {
      this.outgoing.push(
        '[G54:0.000,0.000,0.000]',
        '[G55:0.000,0.000,0.000]',
        'ok',
      );
      return;
    }
    if (upper === '$X') {
      if (this.state === 'alarm') {
        this.state = 'idle';
        this.alarmCode = null;
      }
      this.outgoing.push('ok');
      return;
    }
    if (upper === '$H') {
      if (this.state === 'alarm') {
        this.outgoing.push('error:9');
        return;
      }
      this.position = { x: 0, y: 0, z: 0 };
      this.positionTrusted = true;
      this.outgoing.push('ok');
      return;
    }
    if (this.state === 'alarm' && this.isMotionCommand(upper)) {
      this.outgoing.push('error:9');
      return;
    }
    if (upper.startsWith('$')) {
      this.outgoing.push('ok');
      return;
    }

    this.applyModal(upper);
    if (this.isMotionCommand(upper)) {
      this.queueMove(upper);
      return;
    }
    if (/^(G|M|F|S)/.test(upper)) {
      this.outgoing.push('ok');
      return;
    }
    this.outgoing.push('error:20');
  }

  private applyModal(upper: string): void {
    if (hasToken(upper, 'G20')) this.modal.units = 'inch';
    if (hasToken(upper, 'G21')) this.modal.units = 'mm';
    if (hasToken(upper, 'G90')) this.modal.distanceMode = 'absolute';
    if (hasToken(upper, 'G91')) this.modal.distanceMode = 'relative';
    for (const wcs of ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'] as WorkCoordinateSystem[]) {
      if (hasToken(upper, wcs)) this.modal.wcs = wcs;
    }
    if (hasToken(upper, 'M3')) this.modal.laserMode = 'M3';
    if (hasToken(upper, 'M4')) this.modal.laserMode = 'M4';
    if (hasToken(upper, 'M5')) {
      this.modal.laserMode = 'M5';
      this.modal.spindleSpeed = 0;
    }
    const words = parseWords(upper);
    if (words.has('S')) this.modal.spindleSpeed = words.get('S') ?? 0;
    if (words.has('F')) this.modal.feedRate = words.get('F') ?? null;
    if (hasToken(upper, 'G92')) {
      this.modal.g92Offset = {
        x: words.get('X') ?? this.modal.g92Offset.x,
        y: words.get('Y') ?? this.modal.g92Offset.y,
        z: words.get('Z') ?? this.modal.g92Offset.z,
      };
    }
  }

  private isMotionCommand(upper: string): boolean {
    return /\bG0\b|\bG00\b|\bG1\b|\bG01\b|\$J=/.test(upper);
  }

  private queueMove(upper: string): void {
    if (this.modal.feedRate == null && /\bG1\b|\bG01\b/.test(upper)) {
      this.outgoing.push('error:22');
      return;
    }
    if (this.plannerQueue.length >= this.plannerCapacity) {
      this.outgoing.push('error:24');
      return;
    }

    const words = parseWords(upper.replace(/^\$J=/, ''));
    const from = this.plannerQueue.length > 0
      ? cloneVec(this.plannerQueue[this.plannerQueue.length - 1].to)
      : cloneVec(this.position);
    const distanceMode: DistanceMode =
      hasToken(upper, 'G91') ? 'relative'
      : hasToken(upper, 'G90') ? 'absolute'
      : this.modal.distanceMode;
    const to = cloneVec(from);
    if (distanceMode === 'relative') {
      if (words.has('X')) to.x += words.get('X') ?? 0;
      if (words.has('Y')) to.y += words.get('Y') ?? 0;
      if (words.has('Z')) to.z += words.get('Z') ?? 0;
    } else {
      if (words.has('X')) to.x = words.get('X') ?? to.x;
      if (words.has('Y')) to.y = words.get('Y') ?? to.y;
      if (words.has('Z')) to.z = words.get('Z') ?? to.z;
    }
    to.x = Math.max(0, Math.min(this.bedWidth, to.x));
    to.y = Math.max(0, Math.min(this.bedHeight, to.y));

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const feed = Math.max(1, words.get('F') ?? this.modal.feedRate ?? 3000);
    const durationMs = Math.max(1, (distance / feed) * 60000);
    this.plannerQueue.push({ from, to, durationMs, elapsedMs: 0 });
    this.state = 'run';
    this.outgoing.push('ok');
  }

  private softReset(): void {
    this.plannerQueue.length = 0;
    this.state = 'alarm';
    this.alarmCode = 0;
    this.positionTrusted = false;
    this.modal = defaultModal();
  }

  private statusReport(): string {
    const label = {
      idle: 'Idle',
      run: 'Run',
      hold: 'Hold:0',
      alarm: 'Alarm',
      door: 'Door',
      check: 'Check',
      sleep: 'Sleep',
    }[this.state];
    return `<${label}|MPos:${this.position.x.toFixed(3)},${this.position.y.toFixed(3)},${this.position.z.toFixed(3)}|FS:${this.modal.feedRate ?? 0},${this.modal.spindleSpeed}>`;
  }
}

export interface SimulatedGrblSerialPortOptions {
  autoTickMs?: number;
}

export class SimulatedGrblSerialPort implements SerialPortLike {
  private _isOpen = false;
  private dataCallback: ((line: string) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  readonly received: string[] = [];
  readonly sent: string[] = [];
  readonly realtimeBytes: number[] = [];

  constructor(
    readonly simulator: GrblSimulator,
    private readonly options: SimulatedGrblSerialPortOptions = {},
  ) {}

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    this._isOpen = true;
    this.emitLine("Grbl 1.1h ['$' for help]");
  }

  write(data: string): void {
    if (!this._isOpen) throw new Error('Port is not open');
    const line = data.replace(/[\r\n]+$/, '');
    this.received.push(line);
    this.simulator.receiveText(data);
    this.autoTick();
    this.flushOutgoing();
  }

  writeByte(byte: number): void {
    if (!this._isOpen) throw new Error('Port is not open');
    this.realtimeBytes.push(byte);
    this.simulator.receiveRealtimeByte(byte);
    this.autoTick();
    this.flushOutgoing();
  }

  async writeCritical(data: string): Promise<void> {
    this.write(data);
  }

  async writeByteCritical(byte: number): Promise<void> {
    this.writeByte(byte);
  }

  onData(callback: (line: string) => void): void {
    this.dataCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  async close(): Promise<void> {
    this._isOpen = false;
    this.closeCallback?.();
  }

  simulateError(message: string): void {
    this.errorCallback?.(new Error(message));
  }

  private autoTick(): void {
    if (this.options.autoTickMs != null) {
      this.simulator.tick(this.options.autoTickMs);
    }
  }

  private flushOutgoing(): void {
    for (const line of this.simulator.readOutgoingLines()) {
      this.emitLine(line);
    }
  }

  private emitLine(line: string): void {
    this.sent.push(line);
    Promise.resolve().then(() => {
      this.dataCallback?.(line);
    });
  }
}
