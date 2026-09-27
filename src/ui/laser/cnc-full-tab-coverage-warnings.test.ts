import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncLayerSettings,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { detectCncFullTabCoverageWarnings } from './cnc-full-tab-coverage-warnings';

// 10 mm square: outside-profile toolpath perimeter ≈ 50 mm with the default
// 3.175 mm bit. 6 tabs × (6 mm + bit) ≈ 55 mm of windows — full coverage.
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

function cncProject(cnc: Partial<CncLayerSettings>, size: number): Project {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [squareObject('part', '#ff0000', size)], layers: [layer] },
  };
}

describe('detectCncFullTabCoverageWarnings', () => {
  it('warns when the tab windows cover the whole perimeter (part never cut through)', () => {
    const warnings = detectCncFullTabCoverageWarnings(cncProject(FULL_COVERAGE_TABS, 10));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Layer L1');
    expect(warnings[0]).toContain('(tab width + bit diameter × 6 tabs)');
    expect(warnings[0]).toContain('NOT be cut through');
  });

  it('names the cut width a narrowing bit adds to each window', () => {
    // 3 mm down the 60 degree V-bit cuts 3.464 mm wide, so each window is the
    // tab width plus that (ADR-368 Amendment 3); 6 of them still cover the
    // 10 mm square's 51 mm toolpath.
    const cnc = {
      ...FULL_COVERAGE_TABS,
      toolId: 'vb-60',
      depthMm: 3,
      depthPerPassMm: 1.5,
      tabHeightMm: 1,
    };
    const warnings = detectCncFullTabCoverageWarnings(cncProject(cnc, 10));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("(tab width + the bit's 3.5 mm cut width × 6 tabs)");
  });

  it('is silent when the shape is large enough to keep burnable arcs between tabs', () => {
    expect(detectCncFullTabCoverageWarnings(cncProject(FULL_COVERAGE_TABS, 100))).toEqual([]);
  });

  it('is silent when tabs are disabled', () => {
    const cnc = { ...FULL_COVERAGE_TABS, tabsEnabled: false };

    expect(detectCncFullTabCoverageWarnings(cncProject(cnc, 10))).toEqual([]);
  });

  it('is silent for a non-profile cut type (a pocket has no part to free)', () => {
    const cnc = { ...FULL_COVERAGE_TABS, cutType: 'pocket' as const };

    expect(detectCncFullTabCoverageWarnings(cncProject(cnc, 10))).toEqual([]);
  });

  it('returns nothing for a laser project', () => {
    expect(detectCncFullTabCoverageWarnings(createProject())).toEqual([]);
  });
});
