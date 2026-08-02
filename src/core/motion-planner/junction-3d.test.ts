import { describe, expect, it } from 'vitest';
import { junctionVelocity, type Block } from './index';

const ACCEL_MM_PER_SEC2 = 500;
const JUNCTION_DEVIATION_MM = 0.01;

function cut(direction: Block['direction']): Block {
  return {
    kind: 'cut',
    motion: 'feed',
    distance: 1,
    targetVelocity: 10,
    direction,
  };
}

describe('junctionVelocity in XYZ', () => {
  it('treats a horizontal-to-vertical transition as a 90 degree corner', () => {
    const horizontalToVertical = junctionVelocity(
      cut({ x: 1, y: 0, z: 0 }),
      cut({ x: 0, y: 0, z: -1 }),
      ACCEL_MM_PER_SEC2,
      JUNCTION_DEVIATION_MM,
    );
    const horizontalRightAngle = junctionVelocity(
      cut({ x: 1, y: 0 }),
      cut({ x: 0, y: 1 }),
      ACCEL_MM_PER_SEC2,
      JUNCTION_DEVIATION_MM,
    );

    expect(horizontalToVertical).toBeCloseTo(horizontalRightAngle, 12);
  });

  it('keeps consecutive vertical moves straight', () => {
    expect(
      junctionVelocity(
        cut({ x: 0, y: 0, z: -1 }),
        cut({ x: 0, y: 0, z: -1 }),
        ACCEL_MM_PER_SEC2,
        JUNCTION_DEVIATION_MM,
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});
