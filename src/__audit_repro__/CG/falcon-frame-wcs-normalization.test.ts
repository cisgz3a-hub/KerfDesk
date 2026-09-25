// Audit CG-2 repro (Falcon A1 Pro contract): the Frame's G54 "normalization"
// makes KerfDesk forget a G92 origin that is still set on the controller.
//
// The Falcon contract has settingsQuery null, so connect qualifies as
// 'not-required' and never runs the `$G` read that seeds activeWcs
// (laser-controller-handshake.ts qualifyConnectedController returns before
// requestTerminalOwnedActiveWcsReadback). Every first Frame of a session then
// finds activeWcs === null and runs selectPrimaryWcsForFrame(), which sends G54
// and applies the Console 'coordinates-all' effect: workOriginActive=false,
// workOriginSource='none', wcoCache=null.
//
// On the controller nothing changed: G54 was already active and G92 is independent
// of the G54-G59 selection. grblHAL flags a WCO refresh only when the selected WCS
// changes (`command_words.G12 &= g5x id changed`, grblHAL/core gcode.c L2990 and
// L4483-L4486) and otherwise reports WCO in one idle report out of ten
// (REPORT_WCO_REFRESH_IDLE_COUNT 10, config.h L256; report.c L1466-L1480). Stock
// GRBL 1.1h behaves the same (gcode.c L996-L1000, report.c L602-L611).
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L2990
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L996-L1000
//
// So the post-G54 report that Frame waits for normally carries no WCO, and:
//  - Current Position placement computes the head's work position as MPos (the
//    forgotten G92 is treated as zero) and places the job displaced by the G92 offset;
//  - User Origin placement is refused with "Click 'Set origin here' first".
// Correct behaviour: after the normalization the placement is exactly what it was
// before (the controller's work origin did not change).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort, type FakeSerialPort } from '../../__fixtures__/controllers';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { resolveLiveFramePlacement } from '../../ui/laser/camera-frame-placement';
import { normalizeFrameWorkCoordinateSystem } from '../../ui/laser/frame-controller-readiness';

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

    // Fails today: currentPosition becomes { x: 100, y: 50 } (MPos) because the
    // store dropped wcoCache/workOriginActive and the fresh report had no WCO.
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
