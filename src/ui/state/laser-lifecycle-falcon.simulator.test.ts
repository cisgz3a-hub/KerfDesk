// Host command/lifecycle evidence only. The GRBL motion model is not a Falcon
// firmware emulator; the vendor Home commands are acknowledged explicitly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

async function connectIdle() {
  const sim = createGrblSimulator({ motionMs: 100 });
  await useLaserStore
    .getState()
    .connect(sim.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
  await vi.advanceTimersByTimeAsync(1100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

// The rows of a published A1 Pro `$$` that KerfDesk reads (barebaric/rayforge
// PR #461); the contract reads them at connect (ADR-322 Amendment 3).
const A1_PRO_SETTINGS = [
  '$10=511',
  '$13=0',
  '$22=43',
  '$23=3',
  '$30=1000.000',
  '$31=0.000',
  '$32=1',
];

async function connectVendorHomePort() {
  const port = createFakeSerialPort();
  port.onOpen(() => setTimeout(() => port.emitLine('Grbl 1.1f'), 1));
  port.onWrite((line) => {
    if (line === '?') setTimeout(() => port.emitLine('<Idle|MPos:0,0,0|FS:0,0>'), 1);
    if (line === '$$\n') {
      setTimeout(() => {
        for (const setting of A1_PRO_SETTINGS) port.emitLine(setting);
        port.emitLine('ok');
      }, 1);
    }
    // Connect and a completed Home read the active WCS (audit CG-2, GP-1).
    if (line === '$G\n') {
      setTimeout(() => {
        port.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        port.emitLine('ok');
      }, 1);
    }
  });
  await useLaserStore
    .getState()
    .connect(port.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
  await vi.advanceTimersByTimeAsync(1100);
  return port;
}

function commandLines(port: Awaited<ReturnType<typeof connectVendorHomePort>>): string[] {
  return port
    .outbound()
    .filter((line) => line.endsWith('\n') && line !== '$G\n' && line !== '$$\n');
}

describe('Falcon profile host command lifecycle', () => {
  // Rolling audit v6 K3-P3-1 (ADR-322 Amendment 3): `$$` is a report on
  // grblHAL, so the contract reads it at connect; it still never homes by itself.
  it('connects reading $$ without automatic Home and re-reads on request', async () => {
    const sim = await connectIdle();
    // ADR-354: a GRBL-family profile asks for worker-hosted streaming by default.
    expect(sim.port.openRequests()).toEqual([{ baudRate: 115200, hostedStreaming: true }]);
    expect(sim.outbound()).toContain('$$\n');
    expect(sim.outbound().some((line) => line.startsWith('$H'))).toBe(false);
    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualified',
      settings: 'verified',
    });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().capabilities.jogCancel).toBe(false);
    expect(useLaserStore.getState().capabilities.settings).toBe('grbl-dollar-read');
    const reads = sim.outbound().filter((line) => line === '$$\n').length;
    const read = useLaserStore.getState().readMachineSettings();
    await vi.advanceTimersByTimeAsync(500);
    await read;
    expect(sim.outbound().filter((line) => line === '$$\n').length).toBe(reads + 1);
  });

  it('settles a relative tool-off G1 jog without emitting $J', async () => {
    const sim = await connectIdle();
    await useLaserStore.getState().jog({ dx: 3, feed: 600 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sim.outbound()).toContain('M5\nG21 G91\nG1 X3.000 F600 S0\nG90\n');
    expect(sim.outbound().some((line) => line.includes('$J='))).toBe(false);
    expect(sim.state().mpos.x).toBe(3);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('completes a tool-off G1 Frame using the existing acknowledgement and Idle settlement', async () => {
    const sim = await connectIdle();
    await useLaserStore.getState().frame({ minX: 1, minY: 2, maxX: 11, maxY: 12 }, 500);
    await vi.advanceTimersByTimeAsync(6000);
    const lines = sim.outbound();
    expect(lines).toContain('M5\n');
    expect(lines).toContain('G1 X11.000 Y12.000 F500 S0\n');
    expect(lines.some((line) => line.includes('$J='))).toBe(false);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toBeNull();
  });

  it('acknowledges X and Y Home independently before settling and accepting fresh Idle', async () => {
    const port = await connectVendorHomePort();
    const home = useLaserStore.getState().home();
    await vi.advanceTimersByTimeAsync(1);
    expect(commandLines(port)).toEqual(['$HX\n']);
    port.emitLine('ok');
    await vi.advanceTimersByTimeAsync(1);
    expect(commandLines(port)).toEqual(['$HX\n', '$HY\n']);
    expect(useLaserStore.getState().homingState).toBe('homing');
    port.emitLine('ok');
    await vi.advanceTimersByTimeAsync(1);
    expect(port.outbound().at(-1)).toBe('G4 P0.01\n');
    port.emitLine('ok');
    await vi.advanceTimersByTimeAsync(1);
    expect(useLaserStore.getState().homingState).toBe('homing');
    port.emitLine('<Idle|MPos:0,0,0|FS:0,0>');
    await vi.advanceTimersByTimeAsync(5);
    await home;
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('stops a failed Home sequence before sending another axis or claiming home proof', async () => {
    const port = await connectVendorHomePort();
    const home = useLaserStore.getState().home();
    const failure = expect(home).rejects.toThrow(/error:3/);
    await vi.advanceTimersByTimeAsync(1);
    port.emitLine('error:3');
    await failure;
    expect(commandLines(port)).toEqual(['$HX\n']);
    expect(useLaserStore.getState().homingProof).toBeNull();
    expect(useLaserStore.getState().homingState).toBe('unknown');
  });
});
