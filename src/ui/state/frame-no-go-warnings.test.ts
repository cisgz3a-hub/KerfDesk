// Audit v3 D5-P2-3, ADR-232 Amendment 1: a Frame's own approach, perimeter
// and return are compared with enabled no-go zones on the bed.

import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, type NoGoZone } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { frameNoGoZoneWarnings } from './frame-no-go-warnings';
import { useLaserStore } from './laser-store';
import type { LaserState } from './laser-store';
import { stockNativeEvidence } from './native-bed-frame.test-support';

const BOUNDS = { minX: 40, minY: 40, maxX: 100, maxY: 100 };

function zone(partial: Partial<NoGoZone>): NoGoZone {
  return { id: 'z', name: 'Clamp', enabled: true, x: 0, y: 0, width: 2, height: 2, ...partial };
}

function project(zones: ReadonlyArray<NoGoZone>, cnc = false): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    noGoZones: [...zones],
  });
  return cnc ? { ...base, machine: DEFAULT_CNC_MACHINE_CONFIG } : base;
}

function state(
  target: Project,
  mPos: { readonly x: number; readonly y: number },
  wco = { x: 0, y: 0, z: 0 },
  verified = true,
): LaserState {
  const statusReport: StatusReport = {
    state: 'Idle',
    subState: null,
    mPos: { ...mPos, z: 0 },
    wPos: null,
    wco,
    feed: 0,
    spindle: 0,
  };
  return {
    ...useLaserStore.getState(),
    ...stockNativeEvidence(target.device, true),
    ...(verified ? {} : { homingState: 'unknown' as const }),
    statusReport,
    wcoCache: wco,
  };
}

describe('frameNoGoZoneWarnings', () => {
  it('names the outline when only the traced perimeter crosses a zone', () => {
    const target = project([zone({ x: 69, y: 39 })]);

    expect(
      frameNoGoZoneWarnings(state(target, { x: 31, y: 42 }), target, BOUNDS, undefined),
    ).toEqual([
      expect.stringMatching(/^The Frame's outline crosses the configured no-go zone "Clamp"\./),
    ]);
  });

  it('names the approach from the head and the return leg', () => {
    // The head approaches (40,40) from (0,0) and the return goes back there.
    const target = project([zone({ name: 'Corner block', x: 19, y: 19 })]);

    const warnings = frameNoGoZoneWarnings(state(target, { x: 0, y: 0 }), target, BOUNDS, {
      x: 0,
      y: 0,
    });

    expect(warnings).toEqual([
      expect.stringMatching(
        /^The Frame's approach and return cross the configured no-go zone "Corner block"\./,
      ),
    ]);
  });

  it('places the work-coordinate route on the bed through the controller offset', () => {
    // Work (40..100) with WCO 100 runs at machine X 140..200, clear of a zone
    // at X 69 in bed coordinates, but through one at X 169.
    const missed = project([zone({ x: 69, y: 39 })]);
    const crossed = project([zone({ x: 169, y: 39 })]);
    const wco = { x: 100, y: 0, z: 0 };

    expect(
      frameNoGoZoneWarnings(state(missed, { x: 131, y: 42 }, wco), missed, BOUNDS, undefined),
    ).toEqual([]);
    expect(
      frameNoGoZoneWarnings(state(crossed, { x: 131, y: 42 }, wco), crossed, BOUNDS, undefined),
    ).toHaveLength(1);
  });

  it('follows the Frame start point and skips disabled zones', () => {
    const target = project([zone({ x: 69, y: 39 }), zone({ x: 69, y: 99, enabled: false })]);
    const bounds = { ...BOUNDS, startPoint: { edge: 2 as const, fraction: 0.5 } };

    // The start splits the top edge; the bottom edge is still traced.
    expect(
      frameNoGoZoneWarnings(state(target, { x: 70, y: 110 }), target, bounds, undefined),
    ).toEqual([expect.stringContaining('"Clamp"')]);
  });

  it('adds the active bit radius on a CNC Frame', () => {
    // 1 mm below the bottom edge: clear of the centreline, inside the 3.175 mm bit.
    const zones = [zone({ x: 69, y: 37, height: 2 })];
    const laser = project(zones);
    const router = project(zones, true);

    expect(frameNoGoZoneWarnings(state(laser, { x: 31, y: 42 }), laser, BOUNDS, undefined)).toEqual(
      [],
    );
    expect(
      frameNoGoZoneWarnings(state(router, { x: 31, y: 42 }), router, BOUNDS, undefined),
    ).toEqual([expect.stringContaining('(cutter radius 1.587 mm included)')]);
  });

  it('compares nothing without a verified native-to-bed frame', () => {
    const target = project([zone({ x: 69, y: 39 })]);

    expect(
      frameNoGoZoneWarnings(
        state(target, { x: 31, y: 42 }, undefined, false),
        target,
        BOUNDS,
        undefined,
      ),
    ).toEqual([]);
  });
});
