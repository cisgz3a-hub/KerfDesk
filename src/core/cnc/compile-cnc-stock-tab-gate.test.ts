// ADR-258 amendment 1: default-on holding tabs apply only where the cut can free
// the part. A floor at least one tab height thick under the cut holds the part,
// so a shallow profile in thick stock compiles without tab rises.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncMachineConfig,
  type ImportedSvg,
} from '../scene';
import type { CncPass } from '../job';
import { compileCncJob } from './compile-cnc-job';
import { cutCanFreePart, stockLimitedTabHeightMm } from './cnc-tabs';

const TAB_HEIGHT_MM = 2;

function configWithStock(thicknessMm: number): CncMachineConfig {
  return {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm },
  };
}

function square(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
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

function tabRiseCount(depthMm: number, stockThicknessMm: number): number {
  return compiledPasses(depthMm, stockThicknessMm).reduce(
    (count, pass) => count + risesIn(pass),
    0,
  );
}

function compiledPasses(
  depthMm: number,
  stockThicknessMm: number,
  tabHeightMm = TAB_HEIGHT_MM,
): ReadonlyArray<CncPass> {
  const cnc: CncLayerSettings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: 'profile-outside',
    depthMm,
    depthPerPassMm: 2,
    tabsEnabled: true,
    tabHeightMm,
    tabsPerShape: 4,
  };
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc };
  const job = compileCncJob(
    { objects: [square()], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    configWithStock(stockThicknessMm),
  );
  return job.groups.flatMap((group) => (group.kind === 'cnc' ? group.passes : []));
}

/** The highest Z the tab rises reach: the tab top the machine cuts to. */
function tabTopZ(depthMm: number, stockThicknessMm: number): number {
  const riseZs = compiledPasses(depthMm, stockThicknessMm).flatMap((pass) =>
    pass.kind === 'path3d'
      ? pass.points.filter((point, index) => index > 0 && point.z > pass.points[index - 1]!.z)
      : [],
  );
  if (riseZs.length === 0) throw new Error('Expected tab rises.');
  return Math.max(...riseZs.map((point) => point.z));
}

function risesIn(pass: CncPass): number {
  if (pass.kind !== 'path3d') return 0;
  let rises = 0;
  for (let index = 1; index < pass.points.length; index += 1) {
    const previous = pass.points[index - 1];
    const current = pass.points[index];
    if (previous !== undefined && current !== undefined && current.z > previous.z) rises += 1;
  }
  return rises;
}

describe('stock-aware holding tabs (ADR-258 amendment 1)', () => {
  it('leaves tabs off a shallow profile whose floor holds the part', () => {
    expect(tabRiseCount(4, 19)).toBe(0);
  });

  it('keeps tabs on a profile that cuts through the stock', () => {
    expect(tabRiseCount(19, 19)).toBeGreaterThan(0);
  });

  it('keeps tabs when the floor left is thinner than a tab', () => {
    expect(tabRiseCount(18, 19)).toBeGreaterThan(0);
  });

  it('keeps the depth-only rule while the stock thickness is still the shipped default', () => {
    expect(tabRiseCount(4, DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm)).toBeGreaterThan(0);
  });

  it('treats a floor exactly one tab height thick as holding the part', () => {
    expect(cutCanFreePart(17, TAB_HEIGHT_MM, 19)).toBe(false);
    expect(cutCanFreePart(17.5, TAB_HEIGHT_MM, 19)).toBe(true);
  });
});

// ADR-258 amendment 3 (CNC audit TP-1): with a set stock thickness a kept tab is
// one tab height above the stock bottom, so cutting on into the spoilboard no
// longer thins it or drops it below the stock (6 mm stock, 2 mm tabs: top -4).
describe('tabs measured from the stock bottom (ADR-258 amendment 3)', () => {
  it('keeps full-height tabs when the cut runs 0.5 mm into the spoilboard', () => {
    expect(tabTopZ(6.5, 6)).toBeCloseTo(-4, 6);
  });

  it('keeps tabs in the stock when the overcut is deeper than the tab height', () => {
    // Measured from the cut floor this top was -6.15, below the -6 stock bottom.
    expect(tabTopZ(8.15, 6)).toBeCloseTo(-4, 6);
  });

  it('measures a cut that stops just short of the stock bottom the same way', () => {
    expect(tabTopZ(5.5, 6)).toBeCloseTo(-4, 6);
  });

  it('keeps the cut-floor rule while the stock thickness is still the shipped default', () => {
    const stock = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm;
    expect(tabTopZ(stock + 0.5, stock)).toBeCloseTo(-(stock + 0.5 - TAB_HEIGHT_MM), 6);
  });
});

// ADR-258 amendment 4 (second CNC audit P2-toolpath-2): a tab at least as thick
// as the set stock reached the stock top, so passNeedsTabs dropped it and a part
// cut through thin sheet under the default 2 mm tab came free. Such a tab is now
// cut half the stock thick, standing on the stock bottom whatever the cut depth.
describe('tabs no thinner than the stock (ADR-258 amendment 4)', () => {
  it.each([
    { stockMm: 2, depthMm: 2, tabMm: 2 },
    { stockMm: 2, depthMm: 2.3, tabMm: 2 },
    { stockMm: 3, depthMm: 3.2, tabMm: 3 },
    { stockMm: 1.5, depthMm: 1.7, tabMm: 2 },
  ])(
    'keeps 4 bridges half the stock thick: $stockMm mm stock, $depthMm mm cut, $tabMm mm tabs',
    ({ stockMm, depthMm, tabMm }) => {
      const passes = compiledPasses(depthMm, stockMm, tabMm);
      const deepest = deepestPass(passes);
      // The loop still cuts through to the full depth between the bridges...
      expect(lowestZ(deepest)).toBeCloseTo(-depthMm, 9);
      // ...and rises in place onto each of the four tabs at half the stock.
      const walls = tabWallTops(deepest);
      expect(walls).toHaveLength(4);
      for (const topZ of walls) expect(topZ).toBeCloseTo(-stockMm / 2, 9);
    },
  );

  it('keeps the thinned tab the same height above the stock bottom at any depth', () => {
    for (const depthMm of [1.6, 2, 2.3, 3]) {
      expect(tabTopZ(depthMm, 2)).toBeCloseTo(-1, 9);
    }
  });

  it('leaves a floor at least as thick as the thinned tab to hold the part', () => {
    expect(tabRiseCount(1, 2)).toBe(0);
    expect(cutCanFreePart(1, TAB_HEIGHT_MM, 2)).toBe(false);
    expect(cutCanFreePart(1.1, TAB_HEIGHT_MM, 2)).toBe(true);
  });

  it('thins only a tab that would reach the stock top on a set stock', () => {
    expect(stockLimitedTabHeightMm(2, 2)).toBe(1);
    expect(stockLimitedTabHeightMm(3, 2)).toBe(1);
    expect(stockLimitedTabHeightMm(1.9, 2)).toBe(1.9);
    const shipped = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm;
    expect(stockLimitedTabHeightMm(8, shipped)).toBe(8);
  });
});

function deepestPass(passes: ReadonlyArray<CncPass>): CncPass {
  const deepest = [...passes].sort((a, b) => lowestZ(a) - lowestZ(b))[0];
  if (deepest === undefined) throw new Error('Expected compiled passes.');
  return deepest;
}

function lowestZ(pass: CncPass): number {
  return pass.kind === 'path3d' ? Math.min(...pass.points.map((point) => point.z)) : pass.zMm;
}

/** The tops of the vertical walls a pass climbs in place: one per tab. */
function tabWallTops(pass: CncPass): ReadonlyArray<number> {
  if (pass.kind !== 'path3d') return [];
  const tops: number[] = [];
  for (let index = 1; index < pass.points.length; index += 1) {
    const from = pass.points[index - 1]!;
    const to = pass.points[index]!;
    if (from.x === to.x && from.y === to.y && to.z > from.z) tops.push(to.z);
  }
  return tops;
}
