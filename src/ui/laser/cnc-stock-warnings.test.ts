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
import { prepareOutput } from '../../io/gcode';
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

  it('checks the resolved physical placement instead of the unplaced artwork bounds', () => {
    const project = cncProject({ widthMm: 100, heightMm: 100, originOffset: { x: 0, y: 0 } });
    const prepared = prepareOutput(project, {
      jobOrigin: {
        startFrom: 'current-position',
        anchor: 'front-left',
        currentPosition: { x: 150, y: 50 },
      },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const warnings = detectCncStockWarnings(project, prepared);
    expect(warnings).toHaveLength(1);
    // The warning reports swept volume, including the 3.175 mm tool radius.
    expect(warnings[0]).toContain('150.0–173.2');
    expect(warnings[0]).toContain('100 × 100 mm stock');
  });

  it('does not warn from a parser-collapsed tail outside the final stock footprint', () => {
    const project = cncProject({
      widthMm: 10_012,
      heightMm: 20_002,
      originOffset: { x: 0, y: 0 },
    });
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const precisionJob = {
      groups: [
        {
          kind: 'cnc' as const,
          layerId: 'L1',
          color: '#ff0000',
          cutType: 'engrave' as const,
          toolDiameterMm: 4,
          feedMmPerMin: 600,
          plungeMmPerMin: 200,
          spindleRpm: 12_000,
          spindleSpinupSec: 1,
          safeZMm: 5,
          passes: [
            {
              kind: 'contour' as const,
              zMm: -1,
              closed: false,
              polyline: [
                { x: 10_000, y: 20_000 },
                { x: 10_010, y: 20_000 },
                { x: 10_010.0004, y: 20_000 },
              ],
            },
          ],
        },
      ],
    };

    expect(detectCncStockWarnings(project, { ...prepared, job: precisionJob })).toEqual([]);
  });

  it('returns nothing for a laser project', () => {
    expect(detectCncStockWarnings(createProject())).toEqual([]);
  });
});
