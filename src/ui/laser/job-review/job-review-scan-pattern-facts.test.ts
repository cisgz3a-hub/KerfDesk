// ADR-492: the scan pattern shows in Job Review only when an operation sets it.

import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../../../core/scene';
import { laserOperationDetail } from './job-review-detail-facts';

const baseLayer = createLayer({ id: 'a', color: '#ff0000' });

describe('Job Review scan pattern facts (ADR-492)', () => {
  it('names the scan angle, cross-hatch and angle per pass only when set', () => {
    const image: Layer = { ...baseLayer, mode: 'image', imageBidirectional: false };
    const plain = laserOperationDetail(image);
    expect(laserOperationDetail({ ...image, imageScanAngleDeg: 180 })).toBe(plain);
    expect(laserOperationDetail({ ...image, passes: 1, passAngleStepDeg: 30 })).toBe(plain);
    expect(
      laserOperationDetail({
        ...image,
        passes: 3,
        imageScanAngleDeg: 45,
        imageCrossHatch: true,
        passAngleStepDeg: -30,
      }),
    ).toBe(`${plain} · scan at 45° · cross-hatch · angle -30° per pass`);
    const fill: Layer = { ...baseLayer, mode: 'fill', passes: 2, passAngleStepDeg: 90 };
    expect(laserOperationDetail(fill)).toContain(
      'hatch at 0° · bidirectional · angle +90° per pass',
    );
  });
});
