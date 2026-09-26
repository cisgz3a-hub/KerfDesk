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
import { cutCanFreePart } from './cnc-tabs';

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

function compiledPasses(depthMm: number, stockThicknessMm: number): ReadonlyArray<CncPass> {
  const cnc: CncLayerSettings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: 'profile-outside',
    depthMm,
    depthPerPassMm: 2,
    tabsEnabled: true,
    tabHeightMm: TAB_HEIGHT_MM,
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
