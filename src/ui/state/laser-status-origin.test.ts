import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { statusPositionPatch } from './laser-status-position';
import type { LaserState } from './laser-store';
import type { WorkCoordinateOffset } from './origin-actions';

function report(wco: WorkCoordinateOffset | null): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: -399, y: -399, z: 0 },
    wPos: null,
    wco,
    feed: 0,
    spindle: 0,
  };
}

function originHarness(source: LaserState['workOriginSource'] = 'unknown') {
  const harness = makeLineHandlerHarness();
  harness.set({ workOriginActive: true, workOriginSource: source, wcoCache: null });
  return harness;
}

describe('fresh WCO resolves unknown XY origin state', () => {
  it.each([0, 12])('clears an unknown XY origin at zero XY WCO while retaining Z=%s', (z) => {
    const { get, set } = originHarness();
    const wco = { x: 0, y: 0, z };
    set(statusPositionPatch(get(), report(wco)));
    expect(get()).toMatchObject({
      workOriginActive: false,
      workOriginSource: 'none',
      wcoCache: wco,
    });
  });

  it.each(['g92', 'g54-persistent'] as const)(
    'preserves an explicitly set zero-offset %s origin',
    (source) => {
      const { get, set } = originHarness(source);
      set(statusPositionPatch(get(), report({ x: 0, y: 0, z: 0 })));
      expect(get().workOriginActive).toBe(true);
      expect(get().workOriginSource).toBe(source);
    },
  );

  it('retains a real nonzero offset without inferring which controller offset supplied it', () => {
    const { get, set } = originHarness();
    const wco = { x: 200.398, y: 170.323, z: 12 };
    set(statusPositionPatch(get(), report(wco)));
    expect(get()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'unknown',
      wcoCache: wco,
    });
  });

  it('classifies inch reports in millimetres without converting the raw WCO cache', () => {
    const { get, set } = originHarness();
    set({ controllerSettings: { reportInches: true } });
    const wco = { x: 0.0004, y: 0, z: 0 };
    set(statusPositionPatch(get(), report(wco)));
    expect(get()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'unknown',
      wcoCache: wco,
    });
  });

  it('does not interpret an omitted WCO as zero', () => {
    const { get, set } = originHarness();
    set(statusPositionPatch(get(), report(null)));
    expect(get()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'unknown',
      wcoCache: null,
    });
  });

  it.each(['positionEvidenceSuppressed', 'reportUnitsUnconfirmed'] as const)(
    'withholds origin reconciliation while %s',
    (flag) => {
      const { get, set } = originHarness();
      set({ [flag]: true });
      set(statusPositionPatch(get(), report({ x: 0, y: 0, z: 0 })));
      expect(get()).toMatchObject({
        workOriginActive: true,
        workOriginSource: 'unknown',
        wcoCache: null,
        statusReport: { mPos: null, wPos: null, wco: null },
      });
    },
  );
});
