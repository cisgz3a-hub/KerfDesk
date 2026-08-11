import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ReliefObject,
  type Transform,
  type Vec2,
} from '../scene';
import { reliefMachineSpaceGeometry, reliefMachineSpaceTransform } from './relief-machine-space';

const finite = fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true });
const scale = fc.double({ min: -4, max: 4, noNaN: true, noDefaultInfinity: true });

describe('reliefMachineSpaceTransform', () => {
  it('factors arbitrary XY scale before the residual placement isometry', () => {
    fc.assert(
      fc.property(
        fc.record({
          pointX: finite,
          pointY: finite,
          x: finite,
          y: finite,
          scaleX: scale,
          scaleY: scale,
          rotationDeg: fc.double({
            min: -720,
            max: 720,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          mirrorX: fc.boolean(),
          mirrorY: fc.boolean(),
        }),
        ({ pointX, pointY, ...transform }) => {
          const typedTransform: Transform = transform;
          const point: Vec2 = { x: pointX, y: pointY };
          const machineSpace = reliefMachineSpaceTransform(typedTransform);
          const plannedPoint = {
            x: point.x * machineSpace.targetScaleX,
            y: point.y * machineSpace.targetScaleY,
          };
          const expected = applyTransform(point, typedTransform);
          const actual = applyTransform(plannedPoint, machineSpace.residualTransform);

          expect(machineSpace.targetScaleX).toBeGreaterThan(0);
          expect(machineSpace.targetScaleY).toBeGreaterThan(0);
          if (transform.scaleX !== 0) {
            expect(Math.abs(machineSpace.residualTransform.scaleX)).toBe(1);
          }
          if (transform.scaleY !== 0) {
            expect(Math.abs(machineSpace.residualTransform.scaleY)).toBe(1);
          }
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('preserves the legacy collapsed-axis mapping without a new compile refusal', () => {
    const transform: Transform = {
      x: 12,
      y: -7,
      scaleX: 0,
      scaleY: -2,
      rotationDeg: 31,
      mirrorX: true,
      mirrorY: false,
    };
    const machineSpace = reliefMachineSpaceTransform(transform);
    const local = { x: 8, y: 3 };
    const planned = {
      x: local.x * machineSpace.targetScaleX,
      y: local.y * machineSpace.targetScaleY,
    };

    expect(machineSpace.targetScaleX).toBe(1);
    expect(machineSpace.residualTransform.scaleX).toBe(0);
    expect(applyTransform(planned, machineSpace.residualTransform)).toEqual(
      applyTransform(local, transform),
    );
  });

  it('resolves nonuniform and negative scale into the physical CAM dimensions', () => {
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'R1',
      source: 'surface.stl',
      targetWidthMm: 100,
      reliefDepthMm: 5,
      ...testLegacyMeshGeometry({
        positions: [0, 0, 0, 10, 0, 1, 0, 5, 2],
        targetWidthMm: 100,
      }),
      color: '#a0522d',
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: -0.5, scaleY: 2 },
    };

    expect(reliefMachineSpaceGeometry(relief)).toMatchObject({
      targetScaleX: 0.5,
      targetScaleY: 2,
      widthMm: 50,
      heightMm: 100,
    });
  });
});
