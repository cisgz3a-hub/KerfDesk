// The Frame's G54 normalization on the Falcon A1 Pro contract keeps a G92 origin
// that is still set on the controller (controller audit 2026-09-25 CG-2).
//
// The Falcon contract has no settings read, so connect used to skip the `$G`
// read that seeds activeWcs, and every first Frame of a session sent G54 blind
// with the Console 'coordinates-all' effect: workOriginActive=false,
// workOriginSource='none', wcoCache=null. On the controller nothing changed: G54
// was already active and G92 is independent of the G54-G59 selection. grblHAL
// flags a WCO refresh only when the selected WCS changes (gcode.c L2990 and
// L4483-L4486) and otherwise reports WCO in one idle report out of ten
// (REPORT_WCO_REFRESH_IDLE_COUNT 10, config.h L256). Stock GRBL 1.1h behaves the
// same (gcode.c L996-L1000, report.c L602-L611).
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L2990
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L996-L1000
//
// So the post-G54 report carried no WCO: Current Position placed the job
// displaced by the G92 offset, and User Origin was refused. Now an unknown WCS is
// read first, and a selection keeps the origin record (frame-wcs-selection.ts),
// so the placement after the normalization is what it was before. This fake
// answers `$G` with a bare `ok`, so the WCS stays unknown and G54 is still sent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort, type FakeSerialPort } from '../../__fixtures__/controllers';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { resolveLiveFramePlacement } from './camera-frame-placement';
import { normalizeFrameWorkCoordinateSystem } from './frame-controller-readiness';

type Vec = { x: number; y: number; z: number };

/** Minimal grblHAL-shaped firmware: `ok` per line, G92 flags a WCO refresh,
 *  a no-op G54 does not, WCO otherwise in one idle report out of ten. */
function createStockWcoFirmware(mpos: Vec): { port: FakeSerialPort; outbound: () => string[] } {
  const port = createFakeSerialPort();
  let g92: Vec = { x: 0, y: 0, z: 0 };
  let wcoCounter = 0;
  let forceWco = false;
  let rx = '';
  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), 1);
  };
  const fmt = (v: Vec): string => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const status = (): string => {
    let wco = '';
    if (forceWco || wcoCounter === 0) {
      wco = `|WCO:${fmt(g92)}`;
      wcoCounter = 9;
      forceWco = false;
    } else {
      wcoCounter -= 1;
    }
    return `<Idle|MPos:${fmt(mpos)}|FS:0,0${wco}>`;
  };
  const handleLine = (line: string): void => {
    if (/G92(?!\.)/.test(line) && /X0/.test(line)) {
      g92 = { x: mpos.x, y: mpos.y, z: g92.z };
      forceWco = true;
    }
    emit('ok');
  };
  port.onOpen(() => emit("GrblHAL 1.1f ['$' or '$HELP' for help]"));
  port.onWrite((data) => {
    for (const ch of data) {
      if (ch === '?') {
        emit(status());
        continue;
      }
      if (ch === '\n') {
        const line = rx.trim();
        rx = '';
        if (line !== '') handleLine(line);
        continue;
      }
      if (ch !== '\r') rx += ch;
    }
  });
  return { port, outbound: () => [...port.outbound()] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  // GRBL-family Disconnect waits for a reboot banner on real timers.
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
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
  for (let t = 0; t < 500 && !done; t += 1) await pump(10);
  return tracked;
}

describe('CG-2 (Falcon): Frame WCS normalization keeps a live G92 origin', () => {
  it('Current Position and User Origin placement are unchanged by the G54 normalization', async () => {
    const fw = createStockWcoFirmware({ x: 100, y: 50, z: 0 });
    useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    await useLaserStore.getState().connect(fw.port.adapter, {
      controllerKind: 'grblhal',
      controllerCommandSet: 'creality-falcon-a1-pro',
    });
    await pump(1_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    expect(useLaserStore.getState().activeWcs).toBeNull();

    await settle(useLaserStore.getState().setOriginHere());
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().wcoCache).toMatchObject({ x: 100, y: 50 });

    // A few idle polls pass before the operator presses Frame; the report that
    // G92 forced to carry WCO is one of them.
    await pump(2_500);
    expect(useLaserStore.getState().wcoCache).toMatchObject({ x: 100, y: 50 });

    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    const before = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    expect(before).toMatchObject({
      ok: true,
      jobOrigin: { currentPosition: { x: 0, y: 0 } },
    });

    await settle(normalizeFrameWorkCoordinateSystem());
    expect(fw.outbound()).toContain('G54\n');

    // The origin record and its offset survive the selection, though the fresh
    // report after G54 carries no WCO.
    const after = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    expect(after, JSON.stringify(after)).toMatchObject({
      ok: true,
      jobOrigin: { currentPosition: { x: 0, y: 0 } },
    });

    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
    const userOrigin = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    expect(userOrigin.ok, JSON.stringify(userOrigin)).toBe(true);
  });
});
