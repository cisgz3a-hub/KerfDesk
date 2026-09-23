// Manual Air must follow the controller's own coolant state. Vendor auto-focus
// routines, the probe preamble (M5 M9), job/frame footers, and soft resets all
// switch coolant off behind the app's back; the rail used to keep showing ON
// (maintainer, 2026-09-19: "air assist works for a while and then stops").

import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { statusPositionPatch } from './laser-status-position';
import { useLaserStore } from './laser-store';

const idleReport: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const allOff = { spindleCw: false, spindleCcw: false, flood: false, mist: false };

function stateWithManualAir(airAssistOn: boolean) {
  return { ...useLaserStore.getState(), airAssistOn, positionEvidenceSuppressed: false };
}

describe('statusPositionPatch — manual air follows the controller', () => {
  it('turns the rail OFF when an explicit A: report shows coolant off', () => {
    const patch = statusPositionPatch(stateWithManualAir(true), {
      ...idleReport,
      accessories: allOff,
      accessoryReportPresent: true,
    });
    expect(patch.airAssistOn).toBe(false);
  });

  it('turns the rail OFF on an Ov: frame without A:, which GRBL sends when nothing is energized', () => {
    const patch = statusPositionPatch(stateWithManualAir(true), {
      ...idleReport,
      ov: { feed: 100, rapid: 100, spindle: 100 },
      accessories: allOff,
      accessoryReportPresent: false,
    });
    expect(patch.airAssistOn).toBe(false);
  });

  it('turns the rail ON when the controller reports flood or mist coolant active', () => {
    const flood = statusPositionPatch(stateWithManualAir(false), {
      ...idleReport,
      accessories: { ...allOff, flood: true },
      accessoryReportPresent: true,
    });
    const mist = statusPositionPatch(stateWithManualAir(false), {
      ...idleReport,
      accessories: { ...allOff, mist: true },
      accessoryReportPresent: true,
    });
    expect(flood.airAssistOn).toBe(true);
    expect(mist.airAssistOn).toBe(true);
  });

  it('leaves the rail alone on frames that prove nothing about coolant', () => {
    const silent = statusPositionPatch(stateWithManualAir(true), idleReport);
    expect('airAssistOn' in silent).toBe(false);
    // A secondary-spindle marker alone yields an all-off accessory object
    // without an explicit A: or Ov: field; that is not proof the pump is off.
    const spindleOnly = statusPositionPatch(stateWithManualAir(true), {
      ...idleReport,
      accessories: { ...allOff, secondarySpindlePresent: true },
      accessoryReportPresent: false,
    });
    expect('airAssistOn' in spindleOnly).toBe(false);
  });
});

// Consumers select these caches by reference; an equal-but-fresh object from
// every Ov:/A:/WCO frame re-rendered them on polls that changed nothing.
describe('statusPositionPatch — cache identity', () => {
  const ov = { feed: 100, rapid: 100, spindle: 100 };
  const wco = { x: 5, y: 6, z: 0 };

  function stateWithCaches() {
    return {
      ...useLaserStore.getState(),
      positionEvidenceSuppressed: false,
      reportUnitsUnconfirmed: false,
      ovCache: { ...ov },
      accessoryCache: { ...allOff },
      wcoCache: { ...wco },
    };
  }

  it('keeps each cache when the frame repeats its values', () => {
    const state = stateWithCaches();
    const patch = statusPositionPatch(state, {
      ...idleReport,
      ov: { ...ov },
      accessories: { ...allOff },
      accessoryReportPresent: true,
      wco: { ...wco },
    });
    expect(patch.ovCache).toBe(state.ovCache);
    expect(patch.accessoryCache).toBe(state.accessoryCache);
    expect(patch.wcoCache).toBe(state.wcoCache);
  });

  it('replaces a cache when any of its values changes', () => {
    const state = stateWithCaches();
    const patch = statusPositionPatch(state, {
      ...idleReport,
      ov: { ...ov, feed: 110 },
      accessories: { ...allOff, flood: true },
      accessoryReportPresent: true,
      wco: { ...wco, x: 7 },
    });
    expect(patch.ovCache).toEqual({ ...ov, feed: 110 });
    expect(patch.accessoryCache).toEqual({ ...allOff, flood: true });
    expect(patch.wcoCache).toEqual({ ...wco, x: 7 });
  });

  it('replaces the accessory cache when a latched flag appears', () => {
    const state = stateWithCaches();
    const patch = statusPositionPatch(state, {
      ...idleReport,
      accessories: { ...allOff, toolChangePending: true },
      accessoryReportPresent: true,
    });
    expect(patch.accessoryCache).not.toBe(state.accessoryCache);
    expect(patch.accessoryCache?.toolChangePending).toBe(true);
  });
});
