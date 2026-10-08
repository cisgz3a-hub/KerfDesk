// ADR-154 Amendment 3 through the real compiler: simple pockets the adaptive
// verifier refused at the default settings compile, and a pocket whose
// innermost ring would cut a slot uses a reviewed offset-pocket fallback.

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  layerCncTool,
  type CncLayerSettings,
  type ImportedSvg,
  type Scene,
  type Vec2,
} from '../scene';
import { findCncAdaptivePocketIssues } from './cnc-adaptive-issues';
import { resolveAdaptivePocketOperation } from './adaptive-pocket-operation';
import { collectLayerPolylines, compileCncJob } from './compile-cnc-job';

function polygonArtwork(points: ReadonlyArray<Vec2>): ImportedSvg {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id: 'pocket',
    source: 'pocket.svg',
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ closed: true, points: [...points] }] }],
  };
}

// An adaptive pocket layer 3 mm deep at the default settings otherwise:
// Climb, 1.5 mm per pass, the 3.175 mm end mill and 10% engagement.
function adaptiveScene(points: ReadonlyArray<Vec2>, settings: Partial<CncLayerSettings>): Scene {
  return {
    objects: [polygonArtwork(points)],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'pocket',
          pocketStrategy: 'adaptive',
          depthMm: 3,
          ...settings,
        },
      },
    ],
  };
}

function rectangle(width: number, height: number): ReadonlyArray<Vec2> {
  return [
    { x: 40, y: 40 },
    { x: 40 + width, y: 40 },
    { x: 40 + width, y: 40 + height },
    { x: 40, y: 40 + height },
  ];
}

function rightTriangle(leg: number): ReadonlyArray<Vec2> {
  return [
    { x: 40, y: 40 },
    { x: 40 + leg, y: 40 },
    { x: 40, y: 40 + leg },
  ];
}

function cncGroupCount(scene: Scene): number {
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  return job.groups.filter((group) => group.kind === 'cnc').length;
}

describe('adaptive pockets at the default settings', () => {
  // Each was refused on 2026-09-27: the squares for corner stock no pass of
  // the bit can reach, the triangles for engagement the stock grid read too
  // high and for links pushed up the right angle's bisector.
  it.each<[string, ReadonlyArray<Vec2>, Partial<CncLayerSettings>]>([
    ['a 12 mm square', rectangle(12, 12), {}],
    ['a 20 mm square with the 6.35 mm end mill', rectangle(20, 20), { toolId: 'em-6350' }],
    [
      'a 20 mm square with the 6.35 mm end mill at 3.175 mm engagement',
      rectangle(20, 20),
      { toolId: 'em-6350', adaptiveOptimalLoadMm: 3.175 },
    ],
    ['a right triangle with 30 mm legs', rightTriangle(30), {}],
    [
      'a right triangle with 30 mm legs at 1.5 mm engagement',
      rightTriangle(30),
      { adaptiveOptimalLoadMm: 1.5 },
    ],
    ['a right triangle with 20 mm legs', rightTriangle(20), {}],
  ])(
    'compile %s',
    (_label, points, settings) => {
      expect(cncGroupCount(adaptiveScene(points, settings))).toBe(1);
    },
    ciBudgetMs(20_000, 60_000),
  );

  it(
    'discloses offset fallback when an adaptive innermost ring would cut a slot',
    () => {
      // The innermost ring of a 10 x 40 mm pocket runs 30 mm along its middle,
      // beyond the disk the entry helix clears: a full slot, 1.5875 mm of
      // engagement against the 0.3175 mm limit.
      const scene = adaptiveScene(rectangle(10, 40), {});
      const layer = scene.layers[0];
      if (layer?.cnc === undefined) throw new Error('expected a CNC layer');
      const operation = resolveAdaptivePocketOperation(
        collectLayerPolylines(scene.objects, layer, DEFAULT_DEVICE_PROFILE),
        layer.cnc,
        layerCncTool(DEFAULT_CNC_MACHINE_CONFIG, layer.cnc),
      );
      expect(operation).toEqual({
        kind: 'error',
        reason: 'Adaptive verification simulated radial engagement above the configured limit.',
      });
      expect(cncGroupCount(scene)).toBe(1);
      expect(
        findCncAdaptivePocketIssues(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG),
      ).toEqual([
        {
          layerId: layer.id,
          reason:
            'Offset pocket fallback: Adaptive verification simulated radial engagement above the configured limit.',
        },
      ]);
    },
    ciBudgetMs(20_000, 60_000),
  );
});
