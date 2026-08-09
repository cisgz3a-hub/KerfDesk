import { describe, expect, it } from 'vitest';
import {
  relief3dDisplayResolution,
  relief3dDisplayResolutionNotice,
} from './relief3d-display-resolution';

describe('relief3dDisplayResolution', () => {
  it('retains the nominal display target through the 64 mm boundary', () => {
    const resolution = relief3dDisplayResolution(64, 32);

    expect(resolution).toEqual({
      requestedMmPerCell: 0.25,
      effectiveMmPerCell: 0.25,
      reason: null,
    });
    expect(relief3dDisplayResolutionNotice(resolution)).toBeUndefined();
  });

  it('discloses the effective cells and keeps CAM outside the display policy', () => {
    const resolution = relief3dDisplayResolution(100, 50);

    expect(resolution).toEqual({
      requestedMmPerCell: 0.25,
      effectiveMmPerCell: 0.390625,
      reason: 'display-mesh-cell-budget',
    });
    expect(relief3dDisplayResolutionNotice(resolution)).toBe(
      'Relief 3D preview uses 0.390625 mm display cells (0.25 mm nominal target) to stay within the 256-cell display mesh budget. Preview only; CAM and G-code are unchanged.',
    );
  });

  it('keeps very large finite display cells factual', () => {
    const resolution = relief3dDisplayResolution(Number.MAX_VALUE, 1);

    expect(Number.isFinite(resolution.effectiveMmPerCell)).toBe(true);
    expect(relief3dDisplayResolutionNotice(resolution)).toContain(
      resolution.effectiveMmPerCell.toString(),
    );
    expect(relief3dDisplayResolutionNotice(resolution)).not.toContain('Infinity');
  });
});
