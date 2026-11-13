// ADR-258 Amendment 6 (CNC audit J1-P3-3, maintainer: "6.35 mm stock counts
// as set"). A stock thickness the operator set is set at any value; before,
// the compiler compared it with the shipped 6.35 mm, so a real 6.35 mm sheet
// read as never set: its tabs were measured from the cut floor and a 3 mm
// groove in it took 2 mm tab bumps. Measured on the emitted program.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_STOCK,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncStock,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { setStockThicknessMm } from '../scene/machine';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { compileCncJob } from './compile-cnc-job';
import { feedSegments } from './tab-bridge-measure.test-support';
import { maxOf } from '../util';

const EPS = 1e-3;

function square(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'S1',
    source: 'S1.svg',
    bounds: { minX: 50, minY: 50, maxX: 90, maxY: 90 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 90, y: 50 },
              { x: 90, y: 90 },
              { x: 50, y: 90 },
            ],
          },
        ],
      },
    ],
  };
}

function program(stock: CncStock, cnc: Partial<CncLayerSettings>): string {
  const scene: Scene = {
    objects: [square()],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside', ...cnc },
      },
    ],
  };
  const config = { ...DEFAULT_CNC_MACHINE_CONFIG, stock };
  return cncGrblStrategy.emit(
    compileCncJob(scene, DEFAULT_DEVICE_PROFILE, config),
    DEFAULT_DEVICE_PROFILE,
  );
}

/** The Z of every fed rise off the cut floor at `floorZ`: one per tab crossed. */
function tabTopsAbove(gcode: string, floorZ: number): ReadonlyArray<number> {
  return feedSegments(gcode)
    .filter(({ a, b }) => Math.abs(a.z - floorZ) < EPS && b.z > a.z + EPS)
    .map(({ b }) => b.z);
}

const UNMARKED: CncStock = DEFAULT_CNC_STOCK;
const SET_635: CncStock = { ...DEFAULT_CNC_STOCK, thicknessSet: true };

describe('a set 6.35 mm stock counts as set (ADR-258 Amendment 6, J1-P3-3)', () => {
  it('reads the set thickness from the mark, and an unmarked stock by its value as before', () => {
    expect(setStockThicknessMm(UNMARKED)).toBeUndefined();
    expect(setStockThicknessMm(SET_635)).toBe(6.35);
    // Projects saved before the mark: any other value was always set.
    expect(setStockThicknessMm({ ...DEFAULT_CNC_STOCK, thicknessMm: 12 })).toBe(12);
    expect(setStockThicknessMm({ ...DEFAULT_CNC_STOCK, thicknessMm: 12, thicknessSet: true })).toBe(
      12,
    );
  });

  it('cuts a 3 mm groove in set 6.35 mm stock with no tab bumps: its floor holds the part', () => {
    const groove = { depthMm: 3, depthPerPassMm: 1.5 };

    // Unset, tabs are measured from the cut floor: four 2 mm bumps, top at Z-1.
    const unset = tabTopsAbove(program(UNMARKED, groove), -3);
    expect(unset.length).toBeGreaterThanOrEqual(4);
    expect(maxOf(unset)).toBeCloseTo(-1, 3);

    // Set, the 3.35 mm floor under the groove is thicker than a tab (Amendment 1).
    expect(tabTopsAbove(program(SET_635, groove), -3)).toEqual([]);
  });

  it('measures the tabs of a through cut in set 6.35 mm stock from the stock bottom', () => {
    const through = { depthMm: 6.5, depthPerPassMm: 2 };

    // Unset: 2 mm above the 6.5 mm cut floor, so only 1.85 mm is in the stock.
    const unset = tabTopsAbove(program(UNMARKED, through), -6.5);
    expect(unset.length).toBeGreaterThanOrEqual(4);
    expect(maxOf(unset)).toBeCloseTo(-4.5, 3);

    // Set: 2 mm above the stock bottom at Z-6.35 (Amendment 3).
    const set = tabTopsAbove(program(SET_635, through), -6.5);
    expect(set.length).toBeGreaterThanOrEqual(4);
    expect(maxOf(set)).toBeCloseTo(-4.35, 3);
  });
});
