// Manual Air must follow the controller's own coolant state. Vendor auto-focus
// routines, the probe preamble (M5 M9), job/frame footers, and soft resets all
// switch coolant off behind the app's back; the rail used to keep showing ON
// (maintainer, 2026-09-19: "air assist works for a while and then stops").

import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { statusPositionPatch, withheldControllerMPos } from './laser-status-position';
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

// After Unlock without Home KerfDesk hides the reported position, yet stock
// GRBL with $20=1 still checks a jog target against its own MPos, which $X
// leaves as it was (ADR-375):
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L160-L168
// The hold clamp alone reads that MPos, beside the stored report.
describe('statusPositionPatch — the controller MPos behind hidden position evidence', () => {
  const at = { ...idleReport, mPos: { x: -50, y: -40, z: -1 } };
  const suppressed = { ...useLaserStore.getState(), positionEvidenceSuppressed: true };

  it('keeps the MPos it strips while position evidence is suppressed', () => {
    const report = statusPositionPatch(suppressed, at).statusReport;
    expect(report?.mPos).toBeNull();
    expect(withheldControllerMPos(report)).toEqual({ x: -50, y: -40, z: -1 });
  });

  it('keeps none with unconfirmed report units or a WPos-only report ($10=0)', () => {
    const unitsUnknown = { ...suppressed, reportUnitsUnconfirmed: true };
    expect(withheldControllerMPos(statusPositionPatch(unitsUnknown, at).statusReport)).toBeNull();
    const workOnly = { ...at, mPos: null, wPos: { x: -50, y: -40, z: -1 } };
    expect(
      withheldControllerMPos(statusPositionPatch(suppressed, workOnly).statusReport),
    ).toBeNull();
  });

  it('withholds nothing from a report whose position is shown', () => {
    const shown = {
      ...suppressed,
      positionEvidenceSuppressed: false,
      reportUnitsUnconfirmed: false,
    };
    const report = statusPositionPatch(shown, at).statusReport;
    expect(report?.mPos).toEqual({ x: -50, y: -40, z: -1 });
    expect(withheldControllerMPos(report)).toBeNull();
    expect(withheldControllerMPos(null)).toBeNull();
  });
});
