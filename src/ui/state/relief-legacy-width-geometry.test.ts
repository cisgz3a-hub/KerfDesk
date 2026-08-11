import { describe, expect, it } from 'vitest';
import { legacyRelief } from './relief-legacy-width-factorization-test-helpers';
import { reliefLegacyWidthFactorCandidate } from './relief-legacy-width-geometry';

describe('reliefLegacyWidthFactorCandidate', () => {
  it('uses persisted intrinsic bounds without reading the mesh', () => {
    const relief = legacyRelief({
      targetWidthMm: 2_000_000,
      boundsWidthMm: 2_000_000,
      boundsHeightMm: 1_000_000,
      scaleX: 5e-6,
      scaleY: 5e-6,
    });
    Object.defineProperty(relief.reliefSource.meshPositions, 0, {
      get: () => {
        throw new RangeError('injected mesh read failure');
      },
    });

    const candidate = reliefLegacyWidthFactorCandidate(relief, {
      localDimensionsMm: [1_000_000, 750_000, 1_000_000, 500_000],
      scaleX: 1e-5,
      scaleY: 1e-5,
      factor: 2,
    });

    expect(candidate).toMatchObject({
      targetWidthMm: 1_000_000,
      targetHeightMm: 750_000,
      bounds: { maxX: 1_000_000, maxY: 500_000 },
      transform: { scaleX: 1e-5, scaleY: 1e-5 },
    });
    expect(candidate?.reliefSource).toBe(relief.reliefSource);
  });

  it('rejects a persisted non-finite Float32 mesh marker', () => {
    const base = legacyRelief({
      targetWidthMm: 2_000_000,
      boundsWidthMm: 2_000_000,
      boundsHeightMm: 1_000_000,
      scaleX: 5e-6,
      scaleY: 5e-6,
    });
    const relief = {
      ...base,
      reliefSource: { ...base.reliefSource, intrinsicBounds: { kind: 'non-finite-float32-v1' } },
    } as const;

    expect(
      reliefLegacyWidthFactorCandidate(relief, {
        localDimensionsMm: [1_000_000, 750_000, 1_000_000, 500_000],
        scaleX: 1e-5,
        scaleY: 1e-5,
        factor: 2,
      }),
    ).toBeNull();
  });
});
