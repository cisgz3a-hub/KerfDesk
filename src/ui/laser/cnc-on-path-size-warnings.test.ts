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
import { detectCncOnPathSizeWarnings } from './cnc-on-path-size-warnings';

const STOCK_MM = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm;

function artwork(closed: boolean): ImportedSvg {
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
            closed,
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

function project(cnc: Partial<CncLayerSettings>, closed = true): Project {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [artwork(closed)], layers: [layer] },
  };
}

describe('detectCncOnPathSizeWarnings', () => {
  it('says a closed part cut On path through the stock comes out one bit smaller', () => {
    const warnings = detectCncOnPathSizeWarnings(
      project({ cutType: 'profile-on-path', depthMm: STOCK_MM }),
    );

    expect(warnings).toHaveLength(1);
    // The default tool is the 1/8 in (3.175 mm) end mill.
    expect(warnings[0]).toContain('3.2 mm (one bit diameter) smaller');
    expect(warnings[0]).toContain('Outside or Inside');
  });

  it('stays quiet for the shallow out-of-box layer', () => {
    expect(detectCncOnPathSizeWarnings(project({ cutType: 'profile-on-path' }))).toEqual([]);
  });

  it('stays quiet for Outside, which keeps the drawn size', () => {
    expect(
      detectCncOnPathSizeWarnings(project({ cutType: 'profile-outside', depthMm: STOCK_MM })),
    ).toEqual([]);
  });

  it('stays quiet when the layer has only open lines', () => {
    expect(
      detectCncOnPathSizeWarnings(
        project({ cutType: 'profile-on-path', depthMm: STOCK_MM }, false),
      ),
    ).toEqual([]);
  });
});
