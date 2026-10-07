import { describe, expect, it } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { rotaryArtworkExtent, rotaryWrapPreview } from './rotary-wrap-preview';

const chuck = { enabled: true, type: 'chuck' as const, objectDiameterMm: 60, mmPerRotation: 360 };

describe('mathematical rotary wrap preview', () => {
  it('uses transformed artwork extents rather than canvas offset or raw unrotated bounds', () => {
    const project = projectWithLine();
    const object = project.scene.objects[0]!;
    const extent = rotaryArtworkExtent({
      ...project.scene,
      objects: [
        { ...object, transform: { ...object.transform, rotationDeg: 90, y: 500, x: -200 } },
      ],
    });
    expect(extent?.heightMm).toBeCloseTo(10);
    expect(extent?.widthMm).toBeCloseTo(0);
    const model = rotaryWrapPreview(chuck, extent)!;
    expect(model.circumferenceMm).toBeCloseTo(Math.PI * 60);
    expect(model.machineTravelMm).toBeCloseTo(360);
    expect(model.coverage).toBeCloseTo(10 / (Math.PI * 60));
  });

  it('distinguishes chuck, driven roller and surface-calibrated roller math', () => {
    const small = rotaryWrapPreview({ ...chuck, type: 'roller', rollerDiameterMm: 20 })!;
    const large = rotaryWrapPreview({
      ...chuck,
      type: 'roller',
      rollerDiameterMm: 20,
      objectDiameterMm: 120,
    })!;
    expect(small.scale).toBe(large.scale);
    expect(large.machineTravelMm).toBeCloseTo(small.machineTravelMm * 2);
    const direct = rotaryWrapPreview({ ...chuck, type: 'roller' })!;
    expect(direct.scale).toBe(1);
    expect(direct.machineTravelMm).toBeCloseTo(Math.PI * 60);
    expect(direct.scaleSource).toContain('motion per turn is unused');
  });

  it('reports seam overlap and reverses traversal without changing coverage', () => {
    const normal = rotaryWrapPreview(chuck, { widthMm: 30, heightMm: Math.PI * 75 })!;
    const reverse = rotaryWrapPreview(
      { ...chuck, reverseAxis: true },
      { widthMm: 30, heightMm: Math.PI * 75 },
    )!;
    expect(normal.coverage).toBeCloseTo(1.25);
    expect(normal.overlapMm).toBeCloseTo(Math.PI * 15);
    expect(reverse).toMatchObject({
      coverage: normal.coverage,
      overlapMm: normal.overlapMm,
      reverse: true,
    });
    expect(rotaryWrapPreview({ ...chuck, objectDiameterMm: 0 })).toBeNull();
    expect(rotaryWrapPreview({ ...chuck, objectDiameterMm: 1e308 })).toBeNull();
  });
});
