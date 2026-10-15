import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialWarpDeformHandles } from '../../core/geometry/warp-deform-map';
import * as vectorTools from '../../core/geometry/vector-path-tools';
import { MAX_FLATTENED_CURVE_SEGMENTS } from '../../core/scene/curve-path';
import { createProject } from '../../core/scene/project';
import {
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Polyline,
} from '../../core/scene/scene-object';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { planWarpDeform } from './warp-deform-plan';

afterEach(() => vi.restoreAllMocks());

describe('Warp/Deform conversion work budget', () => {
  it('reuses prepared world polylines without reading canonical curves while retaining stroke metadata', () => {
    const shape = createRectangle({
      id: 'prepared',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 3, scaleY: 3 },
    });
    const source = {
      ...shape,
      operationIds: ['cut'],
      paths: [
        {
          color: '#000000',
          strokeWidthMm: 2,
          fillRule: 'evenodd' as const,
          polylines: [],
          get curves(): ReadonlyArray<CurveSubpath> {
            throw new Error('Prepared geometry was flattened a second time');
          },
        },
      ],
    };
    const prepared: ReadonlyArray<Polyline> = [
      {
        closed: false,
        points: [
          { x: 5, y: 2 },
          { x: 35, y: 2 },
        ],
      },
    ];
    const converted = vectorTools.materializeVectorObject(source, source.id, [prepared]);
    expect(converted.paths[0]?.polylines).toBe(prepared);
    expect(converted.paths[0]?.strokeWidthMm).toBe(6);
    expect(converted.paths[0]?.fillRule).toBe('evenodd');
    expect(converted.operationIds).toEqual(['cut']);
    expect(converted.transform).toBe(IDENTITY_TRANSFORM);
    expect(converted.bounds).toEqual({ minX: 5, minY: 2, maxX: 35, maxY: 2 });
  });

  it('rejects oversized canonical geometry before unbounded conversion materializes it', () => {
    const shape = createRectangle({
      id: 'oversized',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    });
    const oversized = {
      ...shape,
      paths: [
        {
          color: '#000000',
          polylines: [],
          curves: [
            {
              start: { x: 0, y: 0 },
              closed: false,
              segments: Array.from({ length: MAX_FLATTENED_CURVE_SEGMENTS + 1 }, (_, i) => ({
                kind: 'line' as const,
                to: { x: i + 1, y: 0 },
              })),
            },
          ],
        },
      ],
    };
    const scene = { ...createProject().scene, objects: [oversized] };
    // Conversion deliberately has no machine segment cap. A rejected bend
    // must never enter that allocator, even for artwork that needs conversion.
    const materialize = vi.spyOn(vectorTools, 'materializeVectorObject').mockImplementation(() => {
      throw new Error('Unbounded conversion ran before the bend was validated');
    });
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const plan = planWarpDeform(scene, {
      grid: 'warp',
      box,
      objectIds: [shape.id],
      handles: initialWarpDeformHandles('warp', box).map((p) => ({ x: p.x + 5, y: p.y })),
    });
    expect(plan.failure).toContain('nothing changed');
    expect(plan.objects).toBe(scene.objects);
    expect(plan.warped).toBe(0);
    expect(materialize).not.toHaveBeenCalled();
  });
});
