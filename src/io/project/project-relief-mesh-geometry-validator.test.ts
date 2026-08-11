import { describe, expect, it } from 'vitest';
import { validateProjectReliefMeshGeometry } from './project-relief-mesh-geometry-validator';

const OBJECT_PATH = 'scene.objects[0]';
const POSITIONS = [0.1, 0.2, 0.3, 2.0000001, 0, 1, 0, 1.5000001, 0] as const;
const INTRINSIC_BOUNDS = {
  kind: 'finite-float32-v1',
  minX: Math.fround(0),
  minY: Math.fround(0),
  minZ: Math.fround(0),
  maxX: Math.fround(2.0000001),
  maxY: Math.fround(1.5000001),
  maxZ: Math.fround(1),
} as const;

describe('validateProjectReliefMeshGeometry', () => {
  it('accepts exact persisted Float32 bounds and reads each coordinate once', () => {
    const reads = new Array<number>(POSITIONS.length).fill(0);
    const positions = Array.from(POSITIONS);
    POSITIONS.forEach((value, index) => {
      Object.defineProperty(positions, index, {
        get: () => {
          reads[index] = (reads[index] ?? 0) + 1;
          return value;
        },
      });
    });

    expect(validate(positions, INTRINSIC_BOUNDS)).toBeNull();
    expect(reads).toEqual(new Array<number>(POSITIONS.length).fill(1));
  });

  it('rejects persisted bounds that do not match the Float32 source', () => {
    expect(validate(Array.from(POSITIONS), { ...INTRINSIC_BOUNDS, maxX: 3 })).toBe(
      'invalid `scene.objects[0].reliefSource.intrinsicBounds`: must match Float32 mesh positions',
    );
  });

  it('accepts the same exact bounds independent of JSON property order', () => {
    const { maxZ, ...remainingBounds } = INTRINSIC_BOUNDS;
    const reordered = { maxZ, ...remainingBounds };
    expect(validate(Array.from(POSITIONS), reordered)).toBeNull();
  });

  it('accepts the explicit non-finite marker when a finite JSON value overflows Float32', () => {
    const positions = [0, 0, 0, 2, 0, Number.MAX_VALUE, 0, 1.5, 0];
    expect(validate(positions, { kind: 'non-finite-float32-v1' })).toBeNull();
  });

  it('still rejects non-finite persisted source numbers and missing target geometry', () => {
    expect(validate([0, 0, 0, 2, 0, Number.NaN, 0, 1.5, 0], INTRINSIC_BOUNDS)).toContain(
      'non-finite number',
    );
    expect(
      validateProjectReliefMeshGeometry(
        {},
        source(Array.from(POSITIONS), INTRINSIC_BOUNDS),
        OBJECT_PATH,
      ),
    ).toContain('targetHeightMm');
  });
});

function validate(
  positions: ReadonlyArray<number>,
  intrinsicBounds: Record<string, unknown>,
): string | null {
  return validateProjectReliefMeshGeometry(
    { targetHeightMm: 75, widthAspect: 'preserve' },
    source(positions, intrinsicBounds),
    OBJECT_PATH,
  );
}

function source(
  positions: ReadonlyArray<number>,
  intrinsicBounds: Record<string, unknown>,
): Record<string, unknown> {
  return { kind: 'legacy-mesh', meshPositions: positions, emptyCells: 'floor', intrinsicBounds };
}
