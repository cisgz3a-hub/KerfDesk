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
    expect(warnings[0]).toContain('NOT be cut through');
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
