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

describe('Job Review automatic overscan (ADR-495)', () => {
  it('names Automatic instead of the stored overscan it replaces', () => {
    const image: Layer = { ...baseLayer, mode: 'image', imageOverscanMm: 9, autoOverscan: true };
    expect(laserOperationDetail(image)).toContain('automatic overscan from speed and acceleration');
    expect(laserOperationDetail(image)).not.toContain('overscan 9 mm');
    const fill: Layer = { ...baseLayer, mode: 'fill', fillOverscanMm: 40, autoOverscan: true };
    expect(laserOperationDetail(fill)).toContain('automatic overscan');
    expect(laserOperationDetail(fill)).not.toContain('stored overscan');
    expect(laserOperationDetail({ ...fill, fillStyle: 'offset' })).toContain(
      'stored overscan 40 mm',
    );
    expect(laserOperationDetail({ ...image, autoOverscan: false })).toContain('overscan 9 mm');
  });
});
