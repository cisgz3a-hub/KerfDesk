import { afterEach, describe, expect, it } from 'vitest';
import { createMask } from './rasterize';
import { writePerceptualArtifact } from './png';

const ORIGINAL_ARTIFACT_FLAG = process.env.PERCEPTUAL_ARTIFACTS;

afterEach(() => {
  if (ORIGINAL_ARTIFACT_FLAG === undefined) {
    delete process.env.PERCEPTUAL_ARTIFACTS;
  } else {
    process.env.PERCEPTUAL_ARTIFACTS = ORIGINAL_ARTIFACT_FLAG;
  }
});

describe('writePerceptualArtifact', () => {
  it('stays a no-op for disabled artifact dumps even if masks mismatch', () => {
    delete process.env.PERCEPTUAL_ARTIFACTS;

    expect(writePerceptualArtifact('mismatch-disabled', createMask(2, 2), createMask(3, 2))).toBe(
      null,
    );
  });

  it('rejects mismatched mask dimensions before writing a misleading comparison', () => {
    process.env.PERCEPTUAL_ARTIFACTS = '1';

    expect(() =>
      writePerceptualArtifact('mismatch-enabled', createMask(2, 2), createMask(3, 2)),
    ).toThrow(/mask size mismatch: 2x2 vs 3x2/);
  });
});
