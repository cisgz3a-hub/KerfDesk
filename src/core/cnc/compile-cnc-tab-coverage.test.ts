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

// AUDIT A5, as preserved by ADR-258: requested tab windows that swallow a
// contour's whole perimeter must never cut below the tab top, because doing so
// frees the part with the spindle running.
//
// The mechanism changed but the property did not. The split model achieved it by
// SKIPPING the below-tab-top passes (the split returned no pieces). ADR-258's
// Z-rise model achieves it by riding the whole loop at the tab top — nothing is
// skipped, nothing is dropped, and no material below the tab top is removed.
// These tests therefore still assert the safety property, not the mechanism.
//
// ADR-258 Amendment 5: a loop too short for the tabs set now gets as many as
// still let it cut through, so only a loop too short for even ONE window rides
// the tab top, and it does so once, on the tab-top level (J1-P3-1).

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

// 10 mm square: outside-profile toolpath perimeter ≈ 52.7 mm with the default
// bit. One 50 mm tab + the 3.175 mm bit is a 53.2 mm window — full coverage.
const FULL_COVERAGE_TABS: Partial<CncLayerSettings> = {
  cutType: 'profile-outside',
  depthMm: 6,
  depthPerPassMm: 2,
  tabsEnabled: true,
  tabHeightMm: 2,
  tabWidthMm: 50,
  tabsPerShape: 6,
};

// 6 tabs × (6 mm tab + 3.175 mm bit) ≈ 55 mm of windows swallowed the same
// square before Amendment 5; five of them fit.
const TOO_MANY_TABS: Partial<CncLayerSettings> = { ...FULL_COVERAGE_TABS, tabWidthMm: 6 };

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

function compiledPasses(cnc: Partial<CncLayerSettings>, size: number) {
  const job = compileCncJob(
    { objects: [squareObject('part', '#ff0000', size)], layers: [tabbedLayer(cnc)] },
    dev,
    config,
  );
  return job.groups.flatMap((group) => (group.kind === 'cnc' ? group.passes : []));
}

function compiledPassZs(cnc: Partial<CncLayerSettings>, size: number): ReadonlyArray<number> {
  const job = compileCncJob(
    { objects: [squareObject('part', '#ff0000', size)], layers: [tabbedLayer(cnc)] },
    dev,
    config,
  );
  // Every Z any pass actually cuts at, across both pass kinds. Since ADR-258 a
  // tabbed deep pass is a path3d carrying its own per-vertex Z (cut depth plus the
  // tab-top rises), and ADR-250 leads turn full-loop contour passes into path3d
  // too — so filtering on kind === 'contour' would see nothing at all here.
  return job.groups.flatMap((group) =>
    group.kind === 'cnc'
      ? group.passes.flatMap((pass) => {
          if (pass.kind === 'contour') return [pass.zMm];
          if (pass.kind === 'path3d') return pass.points.map((point) => point.z);
          return [];
        })
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

  it('cuts a fully covered loop once at the tab top, not once per level below it', () => {
    // Levels -2 and the -4 tab top cut the loop; -6 would only lap the tab top.
    expect(compiledPasses(FULL_COVERAGE_TABS, 10)).toHaveLength(2);
  });

  it('gives a loop too short for the tabs set as many as still let it cut through', () => {
    const zs = compiledPassZs(TOO_MANY_TABS, 10);
    expect(zs).toContain(-6);
    const deepest = compiledPasses(TOO_MANY_TABS, 10).at(-1);
    if (deepest?.kind !== 'path3d') throw new Error('expected a tabbed deep pass');
    const rises = deepest.points.filter(
      (point, index) => index > 0 && point.z > (deepest.points[index - 1]?.z ?? point.z),
    );
    expect(rises).toHaveLength(5);
  });

  it('keeps cutting the deep tabbed passes when the shape is large enough', () => {
    const zs = compiledPassZs(FULL_COVERAGE_TABS, 100);

    expect(zs.some((zMm) => zMm < -4 - 1e-9)).toBe(true);
    expect(zs).toContain(-6);
  });
});
