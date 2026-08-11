import { describe, expect, it } from 'vitest';
import { meshTargetSize } from './mesh-target-size';

describe('meshTargetSize', () => {
  it('uses an explicit target height independently of intrinsic aspect', () => {
    expect(
      meshTargetSize(
        {
          targetWidthMm: 20,
          targetHeightMm: 7,
          reliefDepthMm: 5,
          targetScaleX: 2,
          targetScaleY: 3,
        },
        0.5,
      ),
    ).toEqual({ kind: 'ok', widthMm: 40, heightMm: 21 });
  });

  it('keeps intrinsic-aspect fallback for direct mesh callers', () => {
    expect(meshTargetSize({ targetWidthMm: 20, reliefDepthMm: 5 }, 0.5)).toEqual({
      kind: 'ok',
      widthMm: 20,
      heightMm: 10,
    });
  });

  it('names an invalid explicit height separately from existing width/depth errors', () => {
    expect(
      meshTargetSize({ targetWidthMm: 20, targetHeightMm: Infinity, reliefDepthMm: 5 }, 0.5),
    ).toEqual({ kind: 'error', reason: 'Target height must be a finite positive number.' });
    expect(meshTargetSize({ targetWidthMm: 0, reliefDepthMm: 5 }, 0.5)).toEqual({
      kind: 'error',
      reason: 'Target width and relief depth must be finite positive numbers.',
    });
  });
});
