import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../../../core/scene';
import { laserOperationDetail } from './job-review-detail-facts';

function layer(mode: Layer['mode'], settings: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: 'L', color: '#808080', mode }), ...settings };
}

describe('Job Review 3D Sliced and Fill Ramp lines (ADR-699)', () => {
  it('names the slice count of a 3D Sliced image', () => {
    const detail = laserOperationDetail(
      layer('image', { ditherAlgorithm: '3d-sliced', passes: 6 }),
    );
    expect(detail).toContain('3D Sliced: 6 passes, one slice each, darker burned deeper');
    expect(detail).not.toContain('dither');
  });

  it('says each slice is scanned twice with Cross-hatch', () => {
    const detail = laserOperationDetail(
      layer('image', { ditherAlgorithm: '3d-sliced', passes: 3, imageCrossHatch: true }),
    );
    expect(detail).toContain('3 passes, one slice each, each scanned twice (cross-hatch)');
  });

  it('keeps the dither wording for other modes and for Pass-Through', () => {
    expect(laserOperationDetail(layer('image', { ditherAlgorithm: 'jarvis' }))).toContain(
      'Jarvis dither',
    );
    expect(
      laserOperationDetail(layer('image', { ditherAlgorithm: '3d-sliced', passThrough: true })),
    ).toContain('3D Sliced dither');
  });

  it('names a fill ramp, its floor and its outer edge', () => {
    const detail = laserOperationDetail(layer('fill', { fillRampLengthMm: 1.5, minPower: 12 }));
    expect(detail).toContain('ramp 1.5 mm from min power 12%');
    expect(detail).toContain('outer edge square');
    expect(
      laserOperationDetail(layer('fill', { fillRampLengthMm: 1.5, fillRampOuterEdge: true })),
    ).toContain('outer edge ramped');
  });

  it('says nothing about a ramp that is off or on Follow Shape', () => {
    expect(laserOperationDetail(layer('fill'))).not.toContain('ramp');
    expect(
      laserOperationDetail(layer('fill', { fillRampLengthMm: 2, fillStyle: 'offset' })),
    ).not.toContain('ramp');
  });
});
