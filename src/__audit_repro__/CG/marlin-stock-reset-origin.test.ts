// Audit CG-11 repro: on a stock Marlin build "Reset origin" (G92.1) is a silent
// no-op answered `ok`, and KerfDesk records the origin as cleared.
//
// The Marlin driver sends `G92.1` for Reset origin (marlin/driver.ts
// clearOrigin; laser-origin-actions.ts resetOrigin -> clearedOriginPatch) and
// its own comment says the prerequisite is "a documented build requirement, not
// detected firmware evidence". Upstream Marlin 2.1.2.8:
//  - CNC_COORDINATE_SYSTEMS is off by default (Configuration_adv.h L3600
//    `//#define CNC_COORDINATE_SYSTEMS`; bugfix-2.1.x L4068 likewise);
//  - G92.1 exists only with it: G92.cpp L61-L71 `default: return; // Ignore
//    unknown G92.x` and `#if ENABLED(CNC_COORDINATE_SYSTEMS) && !IS_SCARA case 1:`;
//    without any subcode feature the parser does not even read `.1`
//    (Conditionals_post.h L3177-L3180, parser.cpp L215-L221), so G92.1 is a bare
//    G92 with no axis words;
//  - either way position_shift is untouched and the line is acknowledged `ok`
//    (gcode.cpp process_parsed_command `queue.ok_to_send()`).
// Plain G92 X0 Y0 works on the same stock build (G92.cpp L88-L99 position_shift
// += d), so Set origin succeeds and M114 then reports logical coordinates
// (motion.cpp L192-L212). After the ignored reset KerfDesk believes there is no
// origin: Absolute placement resolves with no offset, and every Absolute Frame and
// job is run through the retained shift, displaced by the old origin.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G92.cpp#L55-L99
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/Configuration_adv.h#L3600
//
// Correct behaviour: KerfDesk does not record the origin as cleared unless the
// controller proves it (or it clears the origin with a command every Marlin build
// executes), so its placement matches what the controller will do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort, type FakeSerialPort } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { resolveLiveFramePlacement } from '../../ui/laser/camera-frame-placement';
import { normalizeFrameWorkCoordinateSystem } from '../../ui/laser/frame-controller-readiness';

type Xy = { x: number; y: number };

/** Stock Marlin 2.1.2.8 (HAS_POSITION_SHIFT, no CNC_COORDINATE_SYSTEMS, no
 *  G-code subcodes): native position, workspace shift, logical M114. */
function createStockMarlin(native: Xy): {
  readonly port: FakeSerialPort;
  readonly shift: () => Xy;
  readonly native: () => Xy;
} {
  const port = createFakeSerialPort();
  let shift: Xy = { x: 0, y: 0 };
  let pos: Xy = { ...native };
  let absolute = true;
  let rx = '';
  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), 1);
  };
  const logical = (): Xy => ({ x: pos.x + shift.x, y: pos.y + shift.y });
  const report = (): void => {
    const l = logical();
    emit(`X:${l.x.toFixed(2)} Y:${l.y.toFixed(2)} Z:0.00 E:0.00 Count X:0 Y:0 Z:0`);
  };
  const word = (line: string, axis: 'X' | 'Y'): number | null => {
    const m = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`).exec(line);
    return m === null ? null : Number(m[1]);
  };
  const handleLine = (raw: string): void => {
    const line = raw.split(';', 1)[0]?.trim() ?? '';
    if (line === '') return; // queue.cpp: an empty line is never queued, no ok
    if (/^M114\b/.test(line)) {
      report();
      emit('ok');
      return;
    }
    if (/^G92\b/.test(line)) {
      // No subcodes: `G92.1` parses as G92 with no axis words -> no change.
      for (const axis of ['X', 'Y'] as const) {
        const value = word(line.replace(/^G92(\.\d+)?/, ''), axis);
        if (value === null) continue;
        const key = axis === 'X' ? 'x' : 'y';
        shift = { ...shift, [key]: value - pos[key] };
      }
      report(); // G92.cpp L131 report_current_position()
      emit('ok');
      return;
    }
    if (/^G5[4-9]\b/.test(line)) {
      // G54-G59 exist only with CNC_COORDINATE_SYSTEMS (gcode.cpp); a stock
      // build answers GCodeParser::unknown_command_warning() and then ok.
      emit(`echo:Unknown command: "${line}"`);
      emit('ok');
      return;
    }
    if (/^G90\b/.test(line)) absolute = true;
    if (/^G91\b/.test(line)) absolute = false;
    if (/^G[01]\b/.test(line)) {
      const x = word(line, 'X');
      const y = word(line, 'Y');
      pos = {
        x: x === null ? pos.x : absolute ? x - shift.x : pos.x + x,
        y: y === null ? pos.y : absolute ? y - shift.y : pos.y + y,
      };
    }
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
  return { port, shift: () => shift, native: () => pos };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
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

describe('CG-11: Reset origin on a stock Marlin build', () => {
  it('does not record the origin as cleared while the controller keeps its G92 shift', async () => {
    const board = createStockMarlin({ x: 100, y: 50 });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(board.port.adapter, { controllerKind: 'marlin' });
    await pump(1_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await settle(useLaserStore.getState().setOriginHere());
    await pump(1_500);
    expect(board.shift()).toEqual({ x: -100, y: -50 });
    expect(useLaserStore.getState().workOriginActive).toBe(true);

    await settle(useLaserStore.getState().resetOrigin());
    await pump(1_500);
    expect(board.port.outbound()).toContain('G92.1\n');
    // The stock build ignored G92.1: the shift is still there.
    expect(board.shift()).toEqual({ x: -100, y: -50 });

    useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
    const placement = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    const laser = useLaserStore.getState();
    // Fails today: workOriginActive false / source 'none', and Absolute resolves
    // {ok:true} with no offset, so a bed corner (10,10) is driven to native
    // (110,60) by the retained shift.
    expect(
      laser.workOriginActive,
      JSON.stringify({
        workOriginActive: laser.workOriginActive,
        workOriginSource: laser.workOriginSource,
        placement,
        controllerShift: board.shift(),
      }),
    ).toBe(true);
  });
});

// Audit CG-2 on the same stock build: the Frame's G54 "normalization" runs first
// (use-frame-action.ts prepareFrameContext, before placement is resolved). Stock
// Marlin answers `echo:Unknown command: "G54"` then `ok`, which KerfDesk treats
// as success and applies the 'coordinates-all' effect: the origin is forgotten
// while the controller keeps its G92 shift. The Absolute refusal the operator
// would otherwise get (custom origin, no WCO) turns into an Absolute Frame with
// no offset, which the retained shift displaces by the origin offset.
describe('CG-2 on stock Marlin: Frame normalization and a live G92 origin', () => {
  it('does not turn a set origin into an unshifted Absolute placement', async () => {
    const board = createStockMarlin({ x: 100, y: 50 });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(board.port.adapter, { controllerKind: 'marlin' });
    await pump(1_500);
    await settle(useLaserStore.getState().setOriginHere());
    await pump(1_500);
    expect(board.shift()).toEqual({ x: -100, y: -50 });
    useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
    const before = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    expect(before.ok).toBe(false); // custom origin, no WCO: refused (CG-1)

    const normalization = await settle(normalizeFrameWorkCoordinateSystem());
    expect(board.port.outbound()).toContain('G54\n');
    const after = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    // Fails today: normalization {ok:true}, the store forgot the origin, and the
    // Absolute placement resolves {ok:true} with no offset while the controller
    // still shifts every coordinate by (-100,-50).
    expect(
      after.ok && useLaserStore.getState().workOriginActive === false,
      JSON.stringify({ normalization, after, controllerShift: board.shift() }),
    ).toBe(false);
  });
});
