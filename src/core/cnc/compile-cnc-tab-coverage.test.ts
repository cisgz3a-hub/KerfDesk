import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

// AUDIT A5: requested tab windows that swallow a contour's whole perimeter
// must SKIP the below-tab-top passes (the loop stays one full bridge), never
// fall back to cutting the unsplit loop — that freed the part with the
// spindle running.

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

// 10 mm square: outside-profile toolpath perimeter ≈ 50 mm with the default
// bit. 6 tabs × (6 mm tab + 3.175 mm bit) ≈ 55 mm of windows — full coverage.
const FULL_COVERAGE_TABS: Partial<CncLayerSettings> = {
  cutType: 'profile-outside',
  depthMm: 6,
  depthPerPassMm: 2,
  tabsEnabled: true,
  tabHeightMm: 2,
  tabWidthMm: 6,
  tabsPerShape: 6,
};

function squareObject(id: string, color: string, size: number, at = 50): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + size, y: at },
              { x: at + size, y: at + size },
              { x: at, y: at + size },
            ],
          },
        ],
      },
    ],
  };
}

function tabbedLayer(cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
}

function compiledPassZs(cnc: Partial<CncLayerSettings>, size: number): ReadonlyArray<number> {
  const job = compileCncJob(
    { objects: [squareObject('part', '#ff0000', size)], layers: [tabbedLayer(cnc)] },
    dev,
    config,
  );
  return job.groups.flatMap((group) =>
    group.kind === 'cnc'
      ? group.passes.flatMap((pass) => (pass.kind === 'contour' ? [pass.zMm] : []))
      : [],
  );
}

describe('compileCncJob full-perimeter tab coverage', () => {
  it('skips below-tab-top passes when tab windows cover the whole perimeter', () => {
    const zs = compiledPassZs(FULL_COVERAGE_TABS, 10);

    // Passes at/above the tab top (−4) still cut the full loop…
    expect(zs).toContain(-2);
    expect(zs).toContain(-4);
    // …but nothing may cut below it — the deep pass is skipped, not unsplit.
    expect(zs.every((zMm) => zMm >= -4 - 1e-9)).toBe(true);
  });

  it('keeps cutting the deep tabbed passes when the shape is large enough', () => {
    const zs = compiledPassZs(FULL_COVERAGE_TABS, 100);

    expect(zs.some((zMm) => zMm < -4 - 1e-9)).toBe(true);
    expect(zs).toContain(-6);
  });
});
