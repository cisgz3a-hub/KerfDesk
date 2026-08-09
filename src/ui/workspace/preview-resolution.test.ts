import { describe, expect, it } from 'vitest';
import { previewResolutionMessage } from './preview-resolution';

describe('previewResolutionMessage', () => {
  it('explains an adjusted display resolution and its non-CAM scope', () => {
    expect(
      previewResolutionMessage('3D result', {
        requestedMmPerCell: 0.2,
        effectiveMmPerCell: 0.4,
        reason: 'display-mesh-cell-budget',
      }),
    ).toBe(
      '3D result uses 0.4 mm cells instead of the requested 0.2 mm cells to stay within the 3D display mesh budget. Preview only; CAM and G-code are unchanged.',
    );
  });

  it('stays absent when the requested resolution is retained', () => {
    expect(
      previewResolutionMessage('2D cut shading', {
        requestedMmPerCell: 0.2,
        effectiveMmPerCell: 0.2,
        reason: null,
      }),
    ).toBeNull();
  });
});
