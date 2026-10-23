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
import { detectCncFinishAllowanceWarnings } from './cnc-finish-allowance-warnings';

const part: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 50, minY: 50, maxX: 90, maxY: 80 },
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
            { x: 90, y: 80 },
            { x: 50, y: 80 },
          ],
        },
      ],
    },
  ],
};

// The default machine cuts with a 1/8 in (3.175 mm) end mill: radius 1.5875 mm.
function cncProject(cnc: Partial<CncLayerSettings>): Project {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000', name: 'Cut out' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      depthMm: 6.35,
      depthPerPassMm: 2,
      ...cnc,
    },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [part], layers: [layer] },
  };
}

describe('detectCncFinishAllowanceWarnings (ADR-140 Amendment 2)', () => {
  it('names an allowance of the bit radius or more and what is cut instead', () => {
    const warnings = detectCncFinishAllowanceWarnings(cncProject({ finishAllowanceMm: 2 }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Cut out: the 2 mm finish allowance');
    expect(warnings[0]).toContain('1.59 mm radius');
    expect(warnings[0]).toContain('roughs 1.59 mm proud of the wall');
    expect(warnings[0]).toContain('down 2 mm at a time');
    expect(warnings[0]).not.toContain('loose');
  });

  it('adds the loose ring once the allowance reaches a full cut width', () => {
    const [warning] = detectCncFinishAllowanceWarnings(cncProject({ finishAllowanceMm: 4 }));

    expect(warning).toContain('leaving a ring of stock loose between them');
  });

  it('stays quiet below the radius, without an allowance, and off profile cuts', () => {
    expect(detectCncFinishAllowanceWarnings(cncProject({ finishAllowanceMm: 1.5 }))).toEqual([]);
    expect(detectCncFinishAllowanceWarnings(cncProject({}))).toEqual([]);
    expect(
      detectCncFinishAllowanceWarnings(cncProject({ cutType: 'pocket', finishAllowanceMm: 4 })),
    ).toEqual([]);
  });
});
