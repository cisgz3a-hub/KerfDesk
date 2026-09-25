// grblHAL keeps a refused line's error "sticky" (COMPATIBILITY_LEVEL 0, the
// default build, whose banner is "GrblHAL ..."). After one refused line (a
// Console typo, a `$J=` past the soft limits, a `$SLP` with sleep disabled)
// every later G-code line is refused with the same stale error:N until
// something clears it. That included KerfDesk's own `G4 P0.01` settle marker,
// so the automatic release of a refused jog/Frame owner (ADR-361 decision 1)
// failed and the owner stayed wedged.
//
// Upstream grblHAL core protocol.c, protocol_main_loop() at
// d7aaee3d84b1e7010f075d395206afff038d7379:
//
//   246  if(line.flags.overflow) gc_state.last_error = Status_Overflow;
//   247  else if(*line.data == '\0') // Empty line. For syncing purposes.
//   248      gc_state.last_error = Status_OK;
//   249  else if(*line.data == '$') {// grblHAL '$' system command
//   250      if((gc_state.last_error = system_execute_line(line.data, hal.stream.write)) == ...
//   ...
//   265  #if COMPATIBILITY_LEVEL == 0
//   266  else if(gc_state.last_error == Status_OK || gc_state.last_error == Status_GcodeToolChangePending) {
//   ...
//   271      if((gc_state.last_error = gc_execute_block(line.data)) != Status_OK)
//   ...
//   286  grbl.report.status_message(gc_state.last_error);
//
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L244-L286
// COMPATIBILITY_LEVEL defaults to 0 (config.h:96-98); at level >= 1 the #else
// branch (l.267-268) always parses the block, which the control case models.
// Only an empty line, a `$` line, ASCII_CAN (Ctrl-X, or the one the 0x85
// jog-cancel inserts: protocol.c:214-217, 896-899, stream.h:372) or a soft
// reset (gc_init clears last_error: gcode.c:787, gcode.h:719) clear it.
//
// A refused line must not make KerfDesk's later G-code-only actions fail with
// its stale error: KerfDesk re-arms the parser after a refused non-stream line
// (laser-parser-rearm.ts; grblHAL answers an empty line `ok` and resets
// last_error, l.247-248), so Set origin, Manual air, the Frame's `M5` prelude,
// the Falcon's G1 jog and the automatic release's settle marker all run
// (controller audit 2026-09-25 HF-7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeSerialPort,
  type FakeSerialPort,
} from '../../__fixtures__/controllers/fake-serial-port';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

type GrblHalLineLoop = {
  readonly port: FakeSerialPort;
  /** G-code blocks gc_execute_block() actually ran. */
  readonly executed: () => ReadonlyArray<string>;
  /** G-code blocks answered with a stale last_error without being parsed. */
  readonly refused: () => ReadonlyArray<string>;
  readonly floodOn: () => boolean;
};

/** grblHAL's line loop reduced to protocol.c:244-286 for one compatibility level. */
function grblHalLineLoop(compatibilityLevel: 0 | 1 = 0): GrblHalLineLoop {
  const port = createFakeSerialPort();
  const executed: string[] = [];
  const refused: string[] = [];
  const mpos = { x: 10, y: 20, z: 0 };
  const wco = { x: 0, y: 0, z: 0 };
  let lastError = 0; // gc_state.last_error, Status_OK = 0
  let feedRate = 0; // F0 after reset
  let flood = false;
  const fmt = (v: number) => v.toFixed(3);
  const status = () =>
    `<Idle|MPos:${fmt(mpos.x)},${fmt(mpos.y)},${fmt(mpos.z)}|FS:0,0|WCO:${fmt(wco.x)},${fmt(wco.y)},${fmt(wco.z)}>`;
  // report.c:311-315
  const banner =
    compatibilityLevel === 0
      ? "GrblHAL 1.1f ['$' or '$HELP' for help]"
      : "Grbl 1.1f ['$' for help]";

  const execute = (block: string): number => {
    const upper = block.toUpperCase();
    const f = /F([\d.]+)/.exec(upper);
    const hasAxisWords = /[XYZ][-+]?[\d.]/.test(upper);
    // gcode.c:3485-3486: a G1 motion with no feed rate is error:22.
    if (/(^|\s)G1(\s|$|[A-Z])/.test(upper) && hasAxisWords && f === null && feedRate === 0) {
      return 22;
    }
    if (f !== null) feedRate = Number(f[1]);
    if (/G92(\s|$)/.test(upper) && /X0/.test(upper) && /Y0/.test(upper)) {
      wco.x = mpos.x;
      wco.y = mpos.y;
    }
    if (/(^|\s)M8(\s|$)/.test(upper)) flood = true;
    if (/(^|\s)M9(\s|$)/.test(upper)) flood = false;
    executed.push(block);
    return 0;
  };

  const systemCommand = (line: string): number => {
    // system.c:572-576: $SLP with sleep disabled ($62=0, the default,
    // config.h:841-843) is Status_InvalidStatement.
    if (line === '$SLP') return 3;
    // motion_control.c:832-835: a $J= target past the soft limits is
    // Status_TravelExceeded (jog clipping is off by default, config.h:1945-1947).
    const jogX = /^\$J=.*X(-?[\d.]+)/i.exec(line);
    if (jogX !== null && Math.abs(Number(jogX[1])) > 400) return 15;
    return 0;
  };

  const reply = (line: string): ReadonlyArray<string> => {
    if (line === '') {
      lastError = 0; // l.247-248
      return ['ok'];
    }
    if (line.startsWith('$')) {
      lastError = systemCommand(line); // l.249-250: `$` lines set last_error too
      if (lastError !== 0) return [`error:${lastError}`];
      if (line === '$$') return ['$22=0', '$32=1', '$30=1000', '$31=0', 'ok'];
      if (line === '$G') return ['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok'];
      return ['ok'];
    }
    if (compatibilityLevel === 0 && lastError !== 0) {
      refused.push(line); // l.265-266: block skipped, stale error reported (l.286)
      return [`error:${lastError}`];
    }
    lastError = execute(line); // l.271
    return [lastError === 0 ? 'ok' : `error:${lastError}`];
  };

  port.onOpen(() => setTimeout(() => port.emitLine(banner), 1));
  port.onWrite((data) => {
    if (data === '?') {
      setTimeout(() => port.emitLine(status()), 1);
      return;
    }
    if (!data.endsWith('\n')) return;
    const lines = data.slice(0, -1).split('\n');
    setTimeout(() => {
      for (const line of lines) for (const out of reply(line.trim())) port.emitLine(out);
    }, 1);
  });
  return { port, executed: () => executed, refused: () => refused, floodOn: () => flood };
}

async function connectGeneric(compatibilityLevel: 0 | 1 = 0): Promise<GrblHalLineLoop> {
  const fake = grblHalLineLoop(compatibilityLevel);
  await useLaserStore.getState().connect(fake.port.adapter, {
    controllerKind: 'grblhal',
    baudRate: 115200,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(useLaserStore.getState().activeControllerKind).toBe('grblhal');
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return fake;
}

async function connectFalcon(): Promise<GrblHalLineLoop> {
  useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
  const fake = grblHalLineLoop(0);
  await useLaserStore
    .getState()
    .connect(fake.port.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
  await vi.advanceTimersByTimeAsync(2000);
  expect(useLaserStore.getState().activeControllerCommandSet).toBe('creality-falcon-a1-pro');
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return fake;
}

/** The operator's Console typo: G1 with no feed rate, refused with error:22. */
async function consoleTypo(fake: GrblHalLineLoop): Promise<void> {
  await useLaserStore.getState().sendConsoleCommand('G1 X10');
  await vi.advanceTimersByTimeAsync(500);
  expect(fake.executed()).not.toContain('G1 X10');
  expect(useLaserStore.getState().lastError).toBe(22);
}

/** A step jog past the soft limits, refused with error:15 before any motion. */
async function jogPastSoftLimit(fake: GrblHalLineLoop): Promise<void> {
  await settle(useLaserStore.getState().jog({ dx: 1000, feed: 3000 }), 500);
  expect(fake.port.outbound().some((l) => l.startsWith('$J=') && l.includes('X1000'))).toBe(true);
  expect(useLaserStore.getState().lastError).toBe(15);
}

async function settle<T>(promise: Promise<T>, ms = 4000): Promise<string> {
  let outcome = 'pending';
  promise.then(
    () => (outcome = 'resolved'),
    (error: unknown) => (outcome = error instanceof Error ? error.message : String(error)),
  );
  await vi.advanceTimersByTimeAsync(ms);
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe('HF-7 grblHAL sticky last_error', () => {
  it('control: Set origin runs when no error is pending', async () => {
    const fake = await connectGeneric();
    expect(await settle(useLaserStore.getState().setOriginHere())).toBe('resolved');
    expect(fake.refused()).toEqual([]);
  });

  it('control (COMPATIBILITY_LEVEL 1, no sticky error): a jog refused past the soft limits is released', async () => {
    const fake = await connectGeneric(1);
    await jogPastSoftLimit(fake);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('a jog refused past the soft limits is released automatically (ADR-361 decision 1)', async () => {
    const fake = await connectGeneric();
    await jogPastSoftLimit(fake);
    await vi.advanceTimersByTimeAsync(10_000);
    expect({
      motionOperation: useLaserStore.getState().motionOperation,
      refused: fake.refused(),
    }).toEqual({ motionOperation: null, refused: [] });
  });

  it('Set origin is not refused with the stale error of an earlier Console line', async () => {
    const fake = await connectGeneric();
    await consoleTypo(fake);
    expect(await settle(useLaserStore.getState().setOriginHere())).toBe('resolved');
    expect(fake.refused()).toEqual([]);
  });

  it('Zero Z is not refused with the stale error of an earlier Console line', async () => {
    const fake = await connectGeneric();
    await consoleTypo(fake);
    expect(await settle(useLaserStore.getState().zeroZHere())).toBe('resolved');
    expect(fake.refused()).toEqual([]);
  });

  it('Manual air off runs M9 after an earlier Console error', async () => {
    useStore
      .getState()
      .updateDeviceProfile({ ...useStore.getState().project.device, airAssistCommand: 'M8' });
    const fake = await connectGeneric();
    await settle(useLaserStore.getState().setAirAssistEnabled(true), 1000);
    expect(fake.floodOn()).toBe(true);
    await consoleTypo(fake);
    await settle(useLaserStore.getState().setAirAssistEnabled(false), 1000);
    expect({
      refused: fake.refused(),
      flood: fake.floodOn(),
      railShowsOn: useLaserStore.getState().airAssistOn,
    }).toEqual({ refused: [], flood: false, railShowsOn: false });
  });

  it('Manual air on runs M8 after an earlier Console error', async () => {
    useStore
      .getState()
      .updateDeviceProfile({ ...useStore.getState().project.device, airAssistCommand: 'M8' });
    const fake = await connectGeneric();
    await consoleTypo(fake);
    await settle(useLaserStore.getState().setAirAssistEnabled(true), 1000);
    expect(fake.port.outbound()).toContain('M8\n');
    expect({ refused: fake.refused(), flood: fake.floodOn() }).toEqual({
      refused: [],
      flood: true,
    });
  });

  it("Frame's M5 prelude is not refused after an earlier Console error", async () => {
    const fake = await connectGeneric();
    await consoleTypo(fake);
    await settle(useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 3000));
    expect({
      refused: fake.refused(),
      motionOperation: useLaserStore.getState().motionOperation,
    }).toEqual({ refused: [], motionOperation: null });
  });

  it('Falcon contract: the G1 jog runs after an earlier Console error', async () => {
    const fake = await connectFalcon();
    await consoleTypo(fake);
    await settle(useLaserStore.getState().jog({ dx: 1, feed: 600 }), 2000);
    expect(fake.executed()).toContain('G1 X1.000 F600 S0');
  });

  it('Falcon contract: a refused Release motors ($SLP -> error:3) does not refuse the next G1 jog', async () => {
    const fake = await connectFalcon();
    expect(await settle(useLaserStore.getState().releaseMotors(), 2000)).toMatch(/\$62/);
    await settle(useLaserStore.getState().jog({ dx: 1, feed: 600 }), 2000);
    expect(fake.executed()).toContain('G1 X1.000 F600 S0');
  });
});
