import * as three from 'three';
import { describe, expect, it } from 'vitest';
import { measuredPoint } from '../gcode-inspector/use-measure';
import { closestVisibleOnMove } from './pick-point';
import type { PickPointer } from './scene-pick';
import type { ViewCamera } from './scene-setup';

const BEAM = new Float32Array([0, 0, 0, 100, 0, 0]);

function camera(perspective: boolean): ViewCamera {
  const view = perspective
    ? new three.PerspectiveCamera(40, 4 / 3, 0.1, 1000)
    : new three.OrthographicCamera(-60, 60, 45, -45, -1000, 1000);
  view.position.set(50, 0, 130);
  view.up.set(0, 1, 0);
  view.lookAt(50, 0, 0);
  view.updateProjectionMatrix();
  view.updateMatrixWorld();
  return view;
}

function pointer(view: ViewCamera, x: number, y = 0, z = 0): PickPointer {
  const projected = new three.Vector3(x, y, z).project(view);
  return {
    xPx: (projected.x + 1) * 400,
    yPx: (1 - projected.y) * 300,
    widthPx: 800,
    heightPx: 600,
  };
}

for (const perspective of [false, true])
  describe(perspective ? 'perspective' : 'orthographic', () => {
    it('does not snap or measure to an endpoint hidden by the section', () => {
      const view = camera(perspective);
      const clip = [new three.Plane(new three.Vector3(-1, 0, 0), 99)];
      const pick = closestVisibleOnMove(three, view, pointer(view, 98.8), BEAM, 0, clip)!;
      expect(pick.point.x).toBeCloseTo(98.8, 8);
      expect(pick.fraction).toBeCloseTo(0.988, 8);
      expect(pick.vertex).toBeNull();
      expect(measuredPoint(pick).x).toBeCloseTo(98.8, 8);
    });

    it('retains snapping when clipping is cleared or the endpoint lies on its boundary', () => {
      const view = camera(perspective);
      for (const clip of [null, [], [new three.Plane(new three.Vector3(-1, 0, 0), 100)]]) {
        const pick = closestVisibleOnMove(three, view, pointer(view, 98.8), BEAM, 0, clip)!;
        expect(pick.vertex).toEqual({ x: 100, y: 0, z: 0 });
        expect(measuredPoint(pick)).toEqual({ x: 100, y: 0, z: 0 });
      }
    });

    it('does not snap to a hidden start on the other side of the section', () => {
      const view = camera(perspective);
      const pick = closestVisibleOnMove(three, view, pointer(view, 1.2), BEAM, 0, [
        new three.Plane(new three.Vector3(1, 0, 0), -1),
      ])!;
      expect(pick.vertex).toBeNull();
      expect(pick.point.x).toBeCloseTo(1.2, 8);
      expect(pick.fraction).toBeCloseTo(0.012, 8);
    });

    it('clamps a pointer within the pick reach to the retained interval', () => {
      const view = camera(perspective);
      const pick = closestVisibleOnMove(three, view, pointer(view, 99.3), BEAM, 0, [
        new three.Plane(new three.Vector3(-1, 0, 0), 99),
      ])!;
      expect(pick.point.x).toBeCloseTo(99, 8);
      expect(pick.fraction).toBeCloseTo(0.99, 8);
      expect(pick.vertex).toBeNull();
    });

    it('drops a wholly clipped move and contradictory retained half-spaces', () => {
      const view = camera(perspective);
      const cuts = [
        [new three.Plane(new three.Vector3(-1, 0, 0), -1)],
        [
          new three.Plane(new three.Vector3(1, 0, 0), -60),
          new three.Plane(new three.Vector3(-1, 0, 0), 40),
        ],
      ];
      for (const clip of cuts)
        expect(closestVisibleOnMove(three, view, pointer(view, 50), BEAM, 0, clip)).toBeNull();
    });

    it('applies the same retained-point and boundary-snap rules to Z ranges', () => {
      const view = camera(perspective);
      const ramp = new Float32Array([0, 0, 0, 100, 0, 10]);
      const hidden = closestVisibleOnMove(three, view, pointer(view, 98.8, 0, 9.88), ramp, 0, [
        new three.Plane(new three.Vector3(0, 0, -1), 9.9),
      ])!;
      expect(hidden.point.x).toBeCloseTo(98.8, 7);
      expect(hidden.point.z).toBeCloseTo(9.88, 7);
      expect(hidden.vertex).toBeNull();
      const visible = closestVisibleOnMove(three, view, pointer(view, 98.8, 0, 9.88), ramp, 0, [
        new three.Plane(new three.Vector3(0, 0, -1), 10),
      ])!;
      expect(visible.vertex).toEqual({ x: 100, y: 0, z: 10 });
    });

    it('never invents a snap to a section intersection on the middle of a move', () => {
      const view = camera(perspective);
      const pick = closestVisibleOnMove(three, view, pointer(view, 50), BEAM, 0, [
        new three.Plane(new three.Vector3(1, 0, 0), -50),
        new three.Plane(new three.Vector3(-1, 0, 0), 50),
      ])!;
      expect(pick.point).toEqual({ x: 50, y: 0, z: 0 });
      expect(pick.fraction).toBe(0.5);
      expect(pick.vertex).toBeNull();
    });
  });

it('ignores an endpoint just outside the viewport even when within the snap distance', () => {
  const view = camera(false);
  const end = 110.6;
  const positions = new Float32Array([0, 0, 0, end, 0, 0]);
  const pick = closestVisibleOnMove(three, view, pointer(view, 109.7), positions, 0, null)!;
  expect(pick.vertex).toBeNull();
  expect(pick.point.x).toBeCloseTo(109.7, 7);
});

it('keeps a zero-length point on a boundary and excludes it outside the section', () => {
  const view = camera(false);
  const positions = new Float32Array([50, 0, 0, 50, 0, 0]);
  const pick = closestVisibleOnMove(three, view, pointer(view, 50), positions, 0, [
    new three.Plane(new three.Vector3(-1, 0, 0), 50),
  ])!;
  expect(pick.vertex).toEqual({ x: 50, y: 0, z: 0 });
  expect(pick.fraction).toBe(1);
  expect(
    closestVisibleOnMove(three, view, pointer(view, 50), positions, 0, [
      new three.Plane(new three.Vector3(-1, 0, 0), 49),
    ]),
  ).toBeNull();
});
