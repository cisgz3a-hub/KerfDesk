import { afterEach, expect, it, vi } from 'vitest';
import * as scene from '../scene';
import { createRectangle } from '../shapes/primitives/create-rectangle';
import { materializeVectorObject } from './vector-path-tools';
import { materializedTabAnchors } from './materialized-tab-anchors';
import { cncTabAnchorPosition, projectPointToPolyline } from '../cnc/cnc-tab-anchors';

afterEach(() => vi.restoreAllMocks());
it('resolves canonical curves once for CNC and laser anchors on the same path', () => {
  const shape = createRectangle({
    id: 'tabs',
    color: '#000000',
    spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 2 },
    transform: { ...scene.IDENTITY_TRANSFORM, scaleX: 3, scaleY: 1.5 },
  });
  const anchors = Array.from({ length: 30 }, (_, i) => ({
    pathIndex: 0,
    polylineIndex: 0,
    layerColor: '#000000',
    pathT: i / 30,
  }));
  const object = { ...shape, cncTabAnchors: anchors, laserTabAnchors: anchors };
  const converted = materializeVectorObject(object, object.id);
  const flatten = vi.spyOn(scene, 'flattenColoredPathCurves');
  const result = materializedTabAnchors(object, converted.paths);
  expect(flatten).toHaveBeenCalledTimes(1);
  for (const key of ['cncTabAnchors', 'laserTabAnchors'] as const)
    for (const [index, anchor] of result[key]!.entries()) {
      const before = cncTabAnchorPosition(object, anchors[index]!)!;
      const after = cncTabAnchorPosition({ ...converted, ...result }, anchor)!;
      const expected = projectPointToPolyline(
        { ...converted.paths[0]!.polylines[0]!, closed: true },
        before,
      )!;
      expect(anchor.pathT).toBeCloseTo(expected.pathT, 12);
      expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(
        scene.DEFAULT_MACHINE_CURVE_TOLERANCE_MM * 3,
      );
    }
});
