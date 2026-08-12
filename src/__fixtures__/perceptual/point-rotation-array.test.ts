import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  arrayPlacements,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { placedObject } from '../../ui/state/array-actions';
import { compareMasks } from './compare';
import { writePerceptualArtifact } from './png';
import { rasterizePolylines } from './rasterize';

const CANVAS_SIZE_PX = 160;
const ROSETTE_CENTER = { x: 80, y: 80 };
const EXPECTED_ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315] as const;
const ARROW_POINTS: ReadonlyArray<Vec2> = [
  { x: 0, y: 5 },
  { x: 28, y: 5 },
  { x: 28, y: 0 },
  { x: 42, y: 10 },
  { x: 28, y: 20 },
  { x: 28, y: 15 },
  { x: 0, y: 15 },
];

describe('point-rotation array perceptual fidelity', () => {
  it('matches an independently rotated eight-arrow rosette', () => {
    const source = arrowObject();
    const actual = arrayPlacements(transformedBBox(source), {
      kind: 'point-rotation',
      count: EXPECTED_ANGLES_DEG.length,
      totalAngleDeg: 360,
    }).map((placement) => transformedArrow(placedObject(source, placement)));
    const sourceWorld = ARROW_POINTS.map((point) => applyTransform(point, source.transform));
    const expected = EXPECTED_ANGLES_DEG.map((angle) => ({
      closed: true,
      points: sourceWorld.map((point) => rotateAround(point, ROSETTE_CENTER, angle)),
    }));

    const predictedMask = rasterizePolylines(actual, CANVAS_SIZE_PX, CANVAS_SIZE_PX);
    const truthMask = rasterizePolylines(expected, CANVAS_SIZE_PX, CANVAS_SIZE_PX);
    const metrics = compareMasks(predictedMask, truthMask);
    const artifact = writePerceptualArtifact('point-rotation-rosette', predictedMask, truthMask);
    console.log(
      `[point-rotation] IoU=${metrics.iou.toFixed(4)} precision=${metrics.precision.toFixed(4)} recall=${metrics.recall.toFixed(4)}${artifact === null ? '' : ` artifact=${artifact}`}`,
    );

    expect(metrics.iou).toBe(1);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
  });
});

function arrowObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'arrow',
    source: 'point-rotation-arrow.svg',
    bounds: { minX: 0, minY: 0, maxX: 42, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x: 59, y: 70 },
    paths: [{ color: '#000000', polylines: [{ closed: true, points: ARROW_POINTS }] }],
  };
}

function transformedArrow(object: SceneObject): Polyline {
  return {
    closed: true,
    points: ARROW_POINTS.map((point) => applyTransform(point, object.transform)),
  };
}

function rotateAround(point: Vec2, pivot: Vec2, angleDeg: number): Vec2 {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}
