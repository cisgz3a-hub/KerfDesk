import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncStock,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { detectCncStockWarnings } from './cnc-stock-warnings';

function squareObject(color: string, size: number, at: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
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

function cncProject(stock: Partial<CncStock>): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' as const },
  };
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, ...stock },
    },
    scene: { objects: [squareObject('#ff0000', 20, 50)], layers: [layer] },
  };
}

describe('detectCncStockWarnings', () => {
  it('is silent when the job fits the stock footprint', () => {
    // Full-bed default stock (400 × 400 at the origin) swallows a 20 mm square
    // wherever the device origin transform lands it.
    expect(detectCncStockWarnings(cncProject({}))).toEqual([]);
  });

  it('warns when toolpaths leave the stock footprint', () => {
    const warnings = detectCncStockWarnings(
      cncProject({ widthMm: 30, heightMm: 30, originOffset: { x: 0, y: 0 } }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('30 × 30 mm stock');
  });

  it('returns nothing for a laser project', () => {
    expect(detectCncStockWarnings(createProject())).toEqual([]);
  });
});
