import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { isWeldEndpointContinuous } from './is-weld-endpoint-continuous';

const TANGENT_SAMPLE_PX = 3;
const CHAIN_LENGTH_PX = 10;
const WELD_GAP_PX = 4;
const PROPERTY_RUNS = 50;
const PROPERTY_SEED = 20_260_728;

function horizontal(y: number, startX = 0): Vec2[] {
  return [
    { x: startX, y },
    { x: startX + CHAIN_LENGTH_PX, y },
  ];
}

function transformPoints(
  points: ReadonlyArray<Vec2>,
  angleRad: number,
  offsetX: number,
  offsetY: number,
): Vec2[] {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return points.map((point) => ({
    x: point.x * cosine - point.y * sine + offsetX,
    y: point.x * sine + point.y * cosine + offsetY,
  }));
}

describe('isWeldEndpointContinuous', () => {
  it('accepts aligned continuations in either stored orientation', () => {
    const left = horizontal(0);
    const right = horizontal(0, CHAIN_LENGTH_PX + WELD_GAP_PX);
    const reversedRight = [...right].reverse();

    expect(
      isWeldEndpointContinuous({
        aPoints: left,
        aEnd: 'end',
        bPoints: right,
        bEnd: 'start',
        tangentSamplePx: TANGENT_SAMPLE_PX,
      }),
    ).toBe(true);
    expect(
      isWeldEndpointContinuous({
        aPoints: left,
        aEnd: 'end',
        bPoints: reversedRight,
        bEnd: 'end',
        tangentSamplePx: TANGENT_SAMPLE_PX,
      }),
    ).toBe(true);
  });

  it('rejects nearby parallel endpoints that do not continue across the gap', () => {
    expect(
      isWeldEndpointContinuous({
        aPoints: horizontal(0),
        aEnd: 'start',
        bPoints: horizontal(WELD_GAP_PX),
        bEnd: 'start',
        tangentSamplePx: TANGENT_SAMPLE_PX,
      }),
    ).toBe(false);
  });

  it('accepts a coincident through-line but rejects a coincident corner', () => {
    const left = horizontal(0);
    const sharedX = CHAIN_LENGTH_PX;
    const through = horizontal(0, sharedX);
    const corner = [
      { x: sharedX, y: 0 },
      { x: sharedX, y: CHAIN_LENGTH_PX },
    ];

    expect(
      isWeldEndpointContinuous({
        aPoints: left,
        aEnd: 'end',
        bPoints: through,
        bEnd: 'start',
        tangentSamplePx: TANGENT_SAMPLE_PX,
      }),
    ).toBe(true);
    expect(
      isWeldEndpointContinuous({
        aPoints: left,
        aEnd: 'end',
        bPoints: corner,
        bEnd: 'start',
        tangentSamplePx: TANGENT_SAMPLE_PX,
      }),
    ).toBe(false);
  });

  it('rejects degenerate endpoints without a measurable tangent', () => {
    const duplicateOnly = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];

    expect(
      isWeldEndpointContinuous({
        aPoints: duplicateOnly,
        aEnd: 'end',
        bPoints: horizontal(0),
        bEnd: 'start',
        tangentSamplePx: TANGENT_SAMPLE_PX,
      }),
    ).toBe(false);
  });

  it('preserves its verdict when roles swap or both chains undergo a rigid transform (property)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.integer({ min: -1_000, max: 1_000 }),
        (isContinuation, angleRad, offsetX, offsetY) => {
          const aPoints = horizontal(0);
          const bPoints = isContinuation
            ? horizontal(0, CHAIN_LENGTH_PX + WELD_GAP_PX)
            : horizontal(WELD_GAP_PX);
          const aEnd = isContinuation ? 'end' : 'start';
          const bEnd = 'start';
          const transformedA = transformPoints(aPoints, angleRad, offsetX, offsetY);
          const transformedB = transformPoints(bPoints, angleRad, offsetX, offsetY);
          const forward = isWeldEndpointContinuous({
            aPoints: transformedA,
            aEnd,
            bPoints: transformedB,
            bEnd,
            tangentSamplePx: TANGENT_SAMPLE_PX,
          });
          const swapped = isWeldEndpointContinuous({
            aPoints: transformedB,
            aEnd: bEnd,
            bPoints: transformedA,
            bEnd: aEnd,
            tangentSamplePx: TANGENT_SAMPLE_PX,
          });

          expect(forward).toBe(isContinuation);
          expect(swapped).toBe(forward);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });
});
