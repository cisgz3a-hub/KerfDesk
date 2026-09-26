// Marlin's origin as KerfDesk models it (host-recorded-origin.ts; controller
// audit 2026-09-25 MA-2, CG-1, CG-11 and CG-2's stock-Marlin case). M114 prints
// the logical position, with the G92 shift applied (Marlin 2.1.2.8
// motion.cpp:192-212), and no offset field, so KerfDesk records the shift it
// writes. Before this, User Origin, Current Position and Absolute were refused
// after Set origin for want of a work offset Marlin never reports; Reset origin
// sent G92.1, which a stock build (no CNC_COORDINATE_SYSTEMS, G92.cpp:62-70)
// acknowledges while keeping the shift, and recorded the origin as cleared; and
// the Frame's G54 was answered "Unknown command" and made KerfDesk forget the
// origin.
//
// The fake below is a stock Marlin 2.1.2.8 (HAS_POSITION_SHIFT, no
// CNC_COORDINATE_SYSTEMS, no G-code subcodes): native position, workspace shift,
// logical M114, the position echo after G92 (G92.cpp:131), and homing clearing
// the shift (motion.cpp:2346-2349).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort, type FakeSerialPort } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { resolveJobPlacement } from '../job-placement';
import { normalizeFrameWorkCoordinateSystem } from '../laser/frame-controller-readiness';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

type Xy = { x: number; y: number };

function createStockMarlin(native: Xy): {
  readonly port: FakeSerialPort;
  readonly shift: () => Xy;
} {
  const port = createFakeSerialPort();
  let shift: Xy = { x: 0, y: 0 };
  let pos: Xy = { ...native };
  let absolute = true;
  let rx = '';
  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), 1);
  };
  const report = (): void => {
    const l = { x: pos.x + shift.x, y: pos.y + shift.y };
    emit(`X:${l.x.toFixed(2)} Y:${l.y.toFixed(2)} Z:0.00 E:0.00 Count X:0 Y:0 Z:0`);
  };
  const word = (line: string, axis: 'X' | 'Y'): number | null => {
    const m = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`).exec(line);
    return m === null ? null : Number(m[1]);
  };
  const setShift = (line: string): void => {
    // No subcodes: `G92.1` parses as G92 with no axis words -> no change.
    for (const axis of ['X', 'Y'] as const) {
      const value = word(line.replace(/^G92(\.\d+)?/, ''), axis);
      if (value === null) continue;
      const key = axis === 'X' ? 'x' : 'y';
      shift = { ...shift, [key]: value - pos[key] };
    }
    report(); // G92.cpp L131 report_current_position()
  };
  const move = (line: string): void => {
    if (/^G90\b/.test(line)) absolute = true;
    if (/^G91\b/.test(line)) absolute = false;
    if (!/^G[01]\b/.test(line)) return;
    const x = word(line, 'X');
    const y = word(line, 'Y');
    const target = (value: number | null, at: number, offset: number): number =>
      value === null ? at : absolute ? value - offset : at + value;
    pos = { x: target(x, pos.x, shift.x), y: target(y, pos.y, shift.y) };
  };
  const handlers: ReadonlyArray<readonly [RegExp, (line: string) => void]> = [
    [/^M114\b/, () => report()],
    // set_axis_is_at_home: position_shift[axis] = 0.
    [/^G28\b/, () => ((pos = { x: 0, y: 0 }), (shift = { x: 0, y: 0 }))],
    [/^G92\b/, setShift],
    [/^G5[4-9]\b/, (line) => emit(`echo:Unknown command: "${line}"`)],
  ];
  const handleLine = (raw: string): void => {
    const line = raw.split(';', 1)[0]?.trim() ?? '';
    if (line === '') return; // queue.cpp: an empty line is never queued, no ok
    const handler = handlers.find(([pattern]) => pattern.test(line))?.[1] ?? move;
    handler(line);
    emit('ok');
  };
  port.onOpen(() => emit('start'));
  port.onWrite((data) => {
    for (const ch of data) {
      if (ch === '\n') {
        const line = rx;
        rx = '';
        handleLine(line);
        continue;
      }
      if (ch !== '\r') rx += ch;
    }
  });
  return { port, shift: () => shift };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    activeWcs: null,
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  const tracked = pending.finally(() => {
    done = true;
  });
  for (let t = 0; t < 1_000 && !done; t += 1) await pump(10);
  return tracked;
}

/** A stock Marlin whose head sits at native X100 Y50, with the origin set there. */
async function originSetAtNative100x50() {
  const board = createStockMarlin({ x: 100, y: 50 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(board.port.adapter, { controllerKind: 'marlin' });
  await pump(1_500);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  expect(useLaserStore.getState().wcoCache).toEqual({ x: 0, y: 0, z: 0 });
  await settle(useLaserStore.getState().setOriginHere());
  await pump(1_500);
  expect(board.shift()).toEqual({ x: -100, y: -50 });
  return board;
}

function placement(startFrom: 'absolute' | 'user-origin' | 'current-position') {
  return resolveJobPlacement({ startFrom, anchor: 'front-left' }, useLaserStore.getState());
}

describe('Marlin origin, recorded by KerfDesk', () => {
  it('records the shift Set origin writes, so every placement resolves', async () => {
    await originSetAtNative100x50();
    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 100, y: 50, z: 0 },
    });
    expect(placement('user-origin')).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: 100, y: 50 },
    });
    expect(placement('current-position')).toMatchObject({
      ok: true,
      jobOrigin: { currentPosition: { x: 0, y: 0 } },
    });
    expect(placement('absolute')).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: 100, y: 50 },
    });
  });

  it('resets the origin with a G92 that restores machine coordinates, not G92.1', async () => {
    const board = await originSetAtNative100x50();
    await settle(useLaserStore.getState().resetOrigin());
    await pump(1_500);

    expect(board.port.outbound()).toContain('G92 X100.000 Y50.000\n');
    expect(board.port.outbound()).not.toContain('G92.1\n');
    expect(board.shift()).toEqual({ x: 0, y: 0 });
    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: false,
      workOriginSource: 'none',
      wcoCache: { x: 0, y: 0, z: 0 },
    });
    expect(placement('absolute')).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: 0, y: 0 },
    });
  });

  it('sends no G54 for a Frame and keeps the origin', async () => {
    const board = await originSetAtNative100x50();
    const before = placement('absolute');

    const normalization = await settle(normalizeFrameWorkCoordinateSystem());

    expect(normalization).toEqual({ ok: true });
    expect(board.port.outbound()).not.toContain('G54\n');
    expect(useLaserStore.getState().workOriginSource).toBe('g92');
    expect(placement('absolute')).toEqual(before);
  });

  it('forgets the shift when the machine homes, as Marlin does', async () => {
    const board = await originSetAtNative100x50();
    await settle(useLaserStore.getState().home());
    await pump(1_500);

    expect(board.shift()).toEqual({ x: 0, y: 0 });
    expect(useLaserStore.getState()).toMatchObject({
      homingState: 'confirmed',
      workOriginActive: false,
      workOriginSource: 'none',
      wcoCache: { x: 0, y: 0, z: 0 },
    });
  });
});
