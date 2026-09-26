import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { maxOutputOverscanMm } from '../preflight/laser-off-motion-policy';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../scene';
import { grblStrategy } from '../output';
import { compileJob } from './compile-job';
import { DEFAULT_OVERSCAN_MM } from './compile-job-defaults';
import type { Job } from './job';
import { accelerationDistanceMm, imageOverscanMmFor } from './operation-cut-extras';

const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'R1',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  pixelWidth: 2,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
  lumaBase64: 'AP//AA==',
};

function imageLayer(settings: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'threshold',
    linesPerMm: 1,
    ...settings,
  };
}

function compile(layer: Layer): Job {
  return compileJob({ objects: [IMAGE], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
}

function overscanOf(job: Job): number | undefined {
  const group = job.groups[0];
  return group?.kind === 'raster' ? group.overscanMm : undefined;
}

describe('per-operation image overscan (ADR-415)', () => {
  it('keeps the fixed 5 mm when the operation never set one, byte for byte', () => {
    const baseline = compile(imageLayer());
    expect(overscanOf(baseline)).toBe(DEFAULT_OVERSCAN_MM);
    const explicit = compile(imageLayer({ imageOverscanMm: DEFAULT_OVERSCAN_MM }));
    expect(grblStrategy.emit(explicit, DEFAULT_DEVICE_PROFILE)).toBe(
      grblStrategy.emit(baseline, DEFAULT_DEVICE_PROFILE),
    );
  });

  it('applies the operation value, capped at 25 mm like Scan Line', () => {
    expect(overscanOf(compile(imageLayer({ imageOverscanMm: 8 })))).toBe(8);
    expect(overscanOf(compile(imageLayer({ imageOverscanMm: 0 })))).toBe(0);
    expect(overscanOf(compile(imageLayer({ imageOverscanMm: 60 })))).toBe(25);
  });

  it('honours an artwork override and lets preflight excuse the longer run-up', () => {
    const layer = imageLayer({ imageOverscanMm: 3 });
    const image: RasterImage = { ...IMAGE, operationOverride: { imageOverscanMm: 12 } };
    const job = compileJob({ objects: [image], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
    expect(overscanOf(job)).toBe(12);
    expect(maxOutputOverscanMm({ objects: [image], layers: [layer] })).toBe(12);
    expect(maxOutputOverscanMm({ objects: [IMAGE], layers: [layer] })).toBe(3);
  });

  it('resolves invalid stored values to the default', () => {
    expect(imageOverscanMmFor({ imageOverscanMm: Number.NaN })).toBe(DEFAULT_OVERSCAN_MM);
    expect(imageOverscanMmFor({ imageOverscanMm: -2 })).toBe(0);
  });

  it('works out the run-up a machine needs to reach speed', () => {
    // 6000 mm/min = 100 mm/s; at 500 mm/s² that takes 10 mm.
    expect(accelerationDistanceMm(6000, 500)).toBeCloseTo(10);
    expect(accelerationDistanceMm(6000, 0)).toBe(0);
  });
});
