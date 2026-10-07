import { expect } from 'vitest';
import {
  executeGrblLine,
  powerUpGrbl,
} from '../../__fixtures__/controllers/grbl-laser-power-model';
import type { MotionPoint } from '../../core/job/motion-manifest';
import { makeConnection, type FakeConnection } from './laser-store-motion-operation.test-support';
import { useLaserStore } from './laser-store';

export type MarkSample = {
  readonly point: MotionPoint;
  readonly power: number;
  readonly startedAt: number;
  endedAt?: number;
};
export type MarkPort = {
  readonly connection: FakeConnection;
  readonly writes: string[];
  readonly marks: MarkSample[];
  readonly travelDurations: number[];
  head: MotionPoint;
  wco: MotionPoint;
  queryState: 'Idle' | 'Run' | null;
  synchronousStatus: boolean;
  simulateTravel: boolean;
  feedOverridePercent: number;
  holdPulseAcks: boolean;
  failPulseWrite: boolean;
  driftReturnZ: number;
  refusal: RegExp | null;
  beforeWrite: ((data: string) => Promise<void> | void) | null;
  afterQueryWrite: (() => Promise<void> | void) | null;
  readonly pulsePending: () => boolean;
  readonly finishPulse: () => void;
  readonly emitStatus: () => void;
};

/** A fake serial port with independent distance/feed timing and GRBL modal
 * power. G1 ACKs at parse, G4 ACKs only after motion drains. No real hardware. */
export class MarkWire {
  readonly port: MarkPort;
  ready = false;
  private model = powerUpGrbl(true);
  private pulseFinish: (() => void) | null = null;
  private motionDueAt = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    const connection = makeConnection((data) => this.write(data));
    this.port = {
      connection,
      writes: [],
      marks: [],
      travelDurations: [],
      head: { x: 31, y: 42, z: 0 },
      wco: { x: 0, y: 0, z: 0 },
      queryState: 'Idle',
      synchronousStatus: false,
      simulateTravel: false,
      feedOverridePercent: 100,
      holdPulseAcks: false,
      failPulseWrite: false,
      driftReturnZ: 0,
      refusal: null,
      beforeWrite: null,
      afterQueryWrite: null,
      pulsePending: () => this.pulseFinish !== null,
      finishPulse: () => this.pulseFinish?.(),
      emitStatus: () => this.emitStatus(),
    };
  }

  private later(callback: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, ms);
    this.timers.add(timer);
  }

  private emitStatus(forcedState?: 'Run'): void {
    if (this.port.queryState === null) return;
    const p = this.port.head;
    const state = forcedState ?? (this.motionDueAt > Date.now() ? 'Run' : this.port.queryState);
    const offset = this.port.wco;
    this.port.connection.emitLine(
      `<${state}|MPos:${(p.x + offset.x).toFixed(3)},${(p.y + offset.y).toFixed(3)},${(p.z + offset.z).toFixed(3)}|WCO:${offset.x},${offset.y},${offset.z}|FS:0,${this.model.beam}|Ov:100,100,100>`,
    );
  }

  private async write(data: string): Promise<void> {
    this.port.writes.push(data);
    if (!this.ready) return;
    await this.port.beforeWrite?.(data);
    if (data === '\x18') {
      this.reset();
      return;
    }
    if (data === '?') {
      await this.query();
      return;
    }
    if (this.applyOverrideBytes(data)) return;
    if (data === '$G\n') {
      this.port.connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      this.port.connection.emitLine('ok');
      return;
    }
    if (this.port.refusal?.test(data) === true) {
      this.port.refusal = null;
      this.port.connection.emitLine('error:20');
      return;
    }
    if (data.includes('\nG4 P1\nM5\n')) {
      this.beginPulse(data);
      if (this.port.failPulseWrite) throw new Error('Partially delivered pulse write failed.');
      return;
    }
    for (const line of data.trim().split('\n')) this.line(line);
  }

  private async query(): Promise<void> {
    if (this.port.synchronousStatus) this.emitStatus();
    else this.later(() => this.emitStatus(), 0);
    await this.port.afterQueryWrite?.();
  }

  private applyOverrideBytes(data: string): boolean {
    if (!/^[\x90\x95\x99]+$/.test(data)) return false;
    if (data.includes('\x90')) this.port.feedOverridePercent = 100;
    return true;
  }

  private line(line: string): void {
    if (line === '') return;
    executeGrblLine(this.model, line);
    if (line.includes(' G1 X')) this.move(line);
    const drainMs = line.startsWith('G4 ') ? Math.max(0, this.motionDueAt - Date.now()) : 0;
    if (drainMs > 0) this.later(() => this.port.connection.emitLine('ok'), drainMs + 10);
    else this.port.connection.emitLine('ok');
  }

  private move(line: string): void {
    expect(this.model.beam).toBe(0);
    const target = {
      x: Number(/X([-+\d.]+)/.exec(line)?.[1]),
      y: Number(/Y([-+\d.]+)/.exec(line)?.[1]),
      z: this.port.head.z,
    };
    const feed = Number(/F([-+\d.]+)/.exec(line)?.[1]);
    const duration =
      (Math.hypot(target.x - this.port.head.x, target.y - this.port.head.y) * 60_000) /
      ((feed * this.port.feedOverridePercent) / 100);
    this.port.travelDurations.push(duration);
    const operation = useLaserStore.getState().controllerOperation;
    const returning = operation?.kind === 'job-start-mark' && operation.phase === 'return';
    const finish = (): void => {
      this.port.head = { ...target, z: target.z + (returning ? this.port.driftReturnZ : 0) };
      this.motionDueAt = 0;
    };
    if (this.port.simulateTravel && duration > 0) {
      this.motionDueAt = Date.now() + duration;
      this.later(finish, duration);
    } else finish();
    this.emitStatus('Run');
  }

  private beginPulse(data: string): void {
    const [on, dwell, off] = data.trim().split('\n');
    executeGrblLine(this.model, on ?? '');
    expect(this.model.errors).toEqual([]);
    expect(this.model.beam).toBeGreaterThan(0);
    const mark: MarkSample = {
      point: { ...this.port.head },
      power: this.model.beam,
      startedAt: Date.now(),
    };
    this.port.marks.push(mark);
    this.port.connection.emitLine('ok');
    this.pulseFinish = () => {
      executeGrblLine(this.model, dwell ?? '');
      this.port.connection.emitLine('ok');
      executeGrblLine(this.model, off ?? '');
      expect(this.model.beam).toBe(0);
      mark.endedAt = Date.now();
      this.port.connection.emitLine('ok');
      this.pulseFinish = null;
    };
    if (!this.port.holdPulseAcks) this.later(() => this.pulseFinish?.(), 1000);
  }

  private reset(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.model = powerUpGrbl(true);
    this.pulseFinish = null;
    this.motionDueAt = 0;
    this.later(() => {
      this.port.connection.emitLine('Grbl 1.1h');
      this.emitStatus();
    }, 0);
  }
}
