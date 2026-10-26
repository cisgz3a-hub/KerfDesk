import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type Origin } from '../devices/device-profile';
import { sceneAxisSigns, toMachineCoords, toSceneCoords } from '../devices/origin-transform';
import { anchorPointForOrigin } from '../job/job-origin';
import {
  correctOutlineGeometry,
  outlineBoardShape,
  outlineGeometryFromCaptures,
  outlineMachineCorner,
  outlineMachinePoints,
  type BoardOutlineDraft,
  type Vec2,
} from '.';

const POINTS: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 90, y: 0 },
  { x: 90, y: 30 },
  { x: 35, y: 30 },
  { x: 35, y: 80 },
  { x: 0, y: 80 },
];
const DRAFT: BoardOutlineDraft = {
  localPointsMm: POINTS,
  anchorIndices: [0, 1, 2, 4, 5],
  captureOrder: [5, 1],
};
const ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];
const ROTATION = Math.PI / 6;
const TRANSLATION = { x: 130, y: 70 };

function toView(point: Vec2, scale = 1): Vec2 {
  const cosine = Math.cos(ROTATION) * scale;
  const sine = Math.sin(ROTATION) * scale;
  return {
    x: point.x * cosine - point.y * sine + TRANSLATION.x,
    y: point.x * sine + point.y * cosine + TRANSLATION.y,
  };
}

describe('outline board registration frames', () => {
  it.each(ORIGINS)('stays unmirrored and binds front-left for %s', (origin) => {
    const device = { ...DEFAULT_DEVICE_PROFILE, origin };
    const signs = sceneAxisSigns(origin);
    const machineFor = (point: Vec2): Vec2 => {
      const view = toView(point);
      return { x: signs.x * view.x, y: signs.y * view.y };
    };
    const result = outlineGeometryFromCaptures(
      DRAFT,
      [machineFor(POINTS[5]!), machineFor(POINTS[1]!)],
      signs,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const machinePoints = outlineMachinePoints(result.geometry);
    expect(machinePoints).not.toBeNull();
    POINTS.forEach((point, index) => {
      expect(machinePoints?.[index]?.x).toBeCloseTo(machineFor(point).x, 6);
      expect(machinePoints?.[index]?.y).toBeCloseTo(machineFor(point).y, 6);
    });

    const shape = outlineBoardShape(result.geometry);
    const backLeft = outlineMachineCorner(result.geometry, 'back-left');
    const frontLeft = outlineMachineCorner(result.geometry, 'front-left');
    expect(shape).not.toBeNull();
    expect(backLeft).not.toBeNull();
    expect(frontLeft).not.toBeNull();
    if (shape === null || backLeft === null || frontLeft === null) return;
    const sceneTopLeft = toSceneCoords(backLeft, device);
    const scenePoints = shape.pointsMm.map((point) => ({
      x: point.x + sceneTopLeft.x,
      y: point.y + sceneTopLeft.y,
    }));
    const mapped = scenePoints.map((point) => toMachineCoords(point, device));
    const xs = mapped.map((point) => point.x);
    const ys = mapped.map((point) => point.y);
    const anchor = anchorPointForOrigin(
      {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      },
      'front-left',
      origin,
    );
    expect(anchor.x).toBeCloseTo(frontLeft.x, 6);
    expect(anchor.y).toBeCloseTo(frontLeft.y, 6);
    const asymmetric = mapped[3]!;
    const expected = machineFor(POINTS[3]!);
    expect(asymmetric.x).toBeCloseTo(expected.x, 6);
    expect(asymmetric.y).toBeCloseTo(expected.y, 6);
  });

  it('accepts a two percent scale difference and refuses ten percent', () => {
    const signs = sceneAxisSigns('front-left');
    const captures = (scale: number) =>
      DRAFT.captureOrder.map((index) => {
        const view = toView(POINTS[index]!, scale);
        return { x: signs.x * view.x, y: signs.y * view.y };
      }) as [Vec2, Vec2];
    const accepted = outlineGeometryFromCaptures(DRAFT, captures(1.02), signs);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.scale).toBeCloseTo(1.02, 9);
    const refused = outlineGeometryFromCaptures(DRAFT, captures(1.1), signs);
    expect(refused).toEqual({
      ok: false,
      reason:
        'The head positions are 132.5 mm apart, but the outline puts those anchors 120.4 mm apart. ' +
        'Check that the head was on the highlighted anchors, or correct the board size.',
    });
  });

  it('refits a third anchor and reports noisy residuals', () => {
    const signs = sceneAxisSigns('rear-right');
    const machineFor = (point: Vec2): Vec2 => {
      const view = toView(point);
      return { x: signs.x * view.x, y: signs.y * view.y };
    };
    const result = outlineGeometryFromCaptures(
      DRAFT,
      [machineFor(POINTS[5]!), machineFor(POINTS[1]!)],
      signs,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const corrected = correctOutlineGeometry(result.geometry, 2, {
      x: machineFor(POINTS[2]!).x + 1,
      y: machineFor(POINTS[2]!).y - 0.5,
    });
    expect(corrected).not.toBeNull();
    expect(corrected?.geometry.measured).toHaveLength(3);
    expect(corrected?.predictionErrorMm).toBeGreaterThan(0);
    expect(corrected?.maxResidualMm).toBeGreaterThan(0);
  });
});
