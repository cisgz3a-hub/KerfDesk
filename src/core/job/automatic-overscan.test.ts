// Automatic overscan (ADR-495): the run-up from rest along the scan, from the
// operation's speed and the machine's acceleration.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { selectOutputStrategy } from '../output';
import { maxOutputOverscanMm } from '../preflight/laser-off-motion-policy';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type TracedImage,
} from '../scene';
import {
  alongScanAccelMmPerSec2,
  automaticOverscanMm,
  fillScanOverscanMm,
  imageScanOverscanMm,
} from './automatic-overscan';
import { compileJob } from './compile-job';
import type { FillGroup, Job, RasterGroup } from './job';

const dev = DEFAULT_DEVICE_PROFILE; // 6000 mm/min, 500 mm/s²

const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'R1',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  pixelWidth: 2,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40 },
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
  lumaBase64: 'AP//AA==',
};

const SQUARE: TracedImage = {
  kind: 'traced-image',
  id: 'T1',
  source: 'trace.png',
  traceMode: 'filled-contours',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

function imageLayer(settings: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'threshold',
    linesPerMm: 1,
    ...settings,
  };
}

function fillLayer(settings: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }), ...settings };
}

function rasters(job: Job): RasterGroup[] {
  return job.groups.filter((group): group is RasterGroup => group.kind === 'raster');
}

function fills(job: Job): FillGroup[] {
  return job.groups.filter((group): group is FillGroup => group.kind === 'fill');
}

describe('automatic overscan (ADR-495)', () => {
  it('runs the whole v²/2a from rest plus 10%, rounded up to 0.1 mm', () => {
    const at = (feedMmPerMin: number, scanAngleDeg = 0) =>
      automaticOverscanMm({
        feedMmPerMin,
        accelMmPerSec2: 500,
        kinematics: 'cartesian',
        scanAngleDeg,
        maxMm: 25,
      });
    expect(at(1500)).toBe(0.7); // 0.625 mm × 1.1
    expect(at(3000)).toBe(2.8); // 2.5 mm × 1.1
    expect(at(6000)).toBe(11); // 10 mm × 1.1, not 11.1 from float noise
    expect(at(30000)).toBe(25); // held at the field's maximum
    expect(at(0)).toBe(0);
  });

  it('needs less runway off the axes, where both axes accelerate together', () => {
    expect(alongScanAccelMmPerSec2(500, 0, 'cartesian')).toBe(500);
    expect(alongScanAccelMmPerSec2(500, 90, 'cartesian')).toBe(500);
    expect(alongScanAccelMmPerSec2(500, 45, 'cartesian')).toBeCloseTo(500 * Math.SQRT2, 9);
    const at = (scanAngleDeg: number) =>
      automaticOverscanMm({
        feedMmPerMin: 3000,
        accelMmPerSec2: 500,
        kinematics: 'cartesian',
        scanAngleDeg,
        maxMm: 25,
      });
    expect(at(45)).toBe(2); // 2.5 / √2 × 1.1 = 1.94
    expect(at(135)).toBe(2);
    expect(at(90)).toBe(2.8);
  });

  it('uses the stored overscan unless the operation turns Automatic on', () => {
    expect(imageScanOverscanMm({ speed: 3000, imageOverscanMm: 7 }, dev, 0)).toBe(7);
    expect(
      imageScanOverscanMm({ speed: 3000, imageOverscanMm: 7, autoOverscan: true }, dev, 0),
    ).toBe(2.8);
    // Capped at the machine's maximum feed, as the scan itself is.
    expect(imageScanOverscanMm({ speed: 60000, autoOverscan: true }, dev, 0)).toBe(11);
    const fill = fillLayer({ speed: 3000, fillOverscanMm: 7, autoOverscan: true });
    expect(fillScanOverscanMm(fill, dev)).toBe(2.8);
    expect(fillScanOverscanMm({ ...fill, hatchAngleDeg: 45 }, dev)).toBe(2);
    expect(fillScanOverscanMm({ ...fill, fillStyle: 'offset' }, dev)).toBe(7);
  });

  it('compiles image runways from the speed and each scan angle', () => {
    const job = compileJob(
      {
        objects: [IMAGE],
        layers: [
          imageLayer({
            speed: 3000,
            autoOverscan: true,
            imageCrossHatch: true,
            imageScanAngleDeg: 45,
          }),
        ],
      },
      dev,
    );
    expect(rasters(job).map((group) => group.overscanMm)).toEqual([2, 2]);
    const alongX = compileJob(
      { objects: [IMAGE], layers: [imageLayer({ speed: 3000, autoOverscan: true })] },
      dev,
    );
    expect(rasters(alongX)[0]?.overscanMm).toBe(2.8);
    expect(selectOutputStrategy(dev).emit(alongX, dev)).toContain('overscan 2.800 mm');
  });

  it('compiles scanline and island fill runways, and leaves Automatic off unchanged', () => {
    for (const fillStyle of ['scanline', 'island'] as const) {
      const job = compileJob(
        { objects: [SQUARE], layers: [fillLayer({ fillStyle, speed: 3000, autoOverscan: true })] },
        dev,
      );
      expect(fills(job).map((group) => group.overscanMm)).toEqual([2.8]);
    }
    const stored = compileJob({ objects: [SQUARE], layers: [fillLayer({ speed: 3000 })] }, dev);
    const off = compileJob(
      { objects: [SQUARE], layers: [fillLayer({ speed: 3000, autoOverscan: false })] },
      dev,
    );
    expect(selectOutputStrategy(dev).emit(off, dev)).toBe(
      selectOutputStrategy(dev).emit(stored, dev),
    );
  });

  it('lets preflight excuse the automatic runway at its longest', () => {
    const scene = {
      objects: [IMAGE, SQUARE],
      layers: [
        imageLayer({ speed: 1500, autoOverscan: true, imageOverscanMm: 0 }),
        fillLayer({ speed: 6000, hatchAngleDeg: 45, autoOverscan: true, fillOverscanMm: 0 }),
      ],
    };
    // The fill's 45-degree hatch would need 7.8 mm, but a pass can run along an axis.
    expect(maxOutputOverscanMm(scene, dev)).toBe(11);
  });
});

// Rolling audit v6 K3-P2-2 (ADR-675): grblHAL's CoreXY limits each motor, so a
// scan at θ gets a / (|cos θ| + |sin θ|), not the Cartesian a / max(|cos θ|, |sin θ|).
describe('automatic overscan on a CoreXY machine (ADR-675)', () => {
  const coreXy = { ...dev, kinematics: 'corexy' as const };
  const at = (kinematics: 'cartesian' | 'corexy', scanAngleDeg: number) =>
    automaticOverscanMm({
      feedMmPerMin: 10000,
      accelMmPerSec2: 1000,
      kinematics,
      scanAngleDeg,
      maxMm: 25,
    });

  it('gives a diagonal scan half the Cartesian acceleration', () => {
    expect(alongScanAccelMmPerSec2(1000, 0, 'corexy')).toBe(1000);
    expect(alongScanAccelMmPerSec2(1000, 90, 'corexy')).toBeCloseTo(1000, 9);
    expect(alongScanAccelMmPerSec2(1000, 45, 'corexy')).toBeCloseTo(1000 / Math.SQRT2, 9);
    expect(alongScanAccelMmPerSec2(1000, 30, 'corexy')).toBeCloseTo(732.05, 2);
  });

  it('runs the K3 runways at $120=1000 and 10000 mm/min', () => {
    // Along an axis both layouts agree: 13.9 mm x 1.1.
    expect(at('corexy', 0)).toBe(15.3);
    expect(at('cartesian', 0)).toBe(15.3);
    // 30 degrees: 19.0 mm needed on CoreXY; the Cartesian model gave 13.3.
    expect(at('corexy', 30)).toBe(20.9);
    expect(at('cartesian', 30)).toBe(13.3);
    // 45 degrees: 19.6 mm needed on CoreXY; the Cartesian model gave 10.9.
    expect(at('corexy', 45)).toBe(21.7);
    expect(at('cartesian', 45)).toBe(10.9);
  });

  it('compiles a CoreXY image at 45 degrees with the longer runway', () => {
    const layer = imageLayer({ speed: 3000, autoOverscan: true, imageScanAngleDeg: 45 });
    const job = compileJob({ objects: [IMAGE], layers: [layer] }, coreXy);
    // 2.5 mm x √2 x 1.1 = 3.89 mm, where Cartesian runs 2 mm.
    expect(rasters(job).map((group) => group.overscanMm)).toEqual([3.9]);
    const fill = fillLayer({ speed: 3000, autoOverscan: true, hatchAngleDeg: 45 });
    expect(fillScanOverscanMm(fill, coreXy)).toBe(3.9);
  });

  it('lets preflight excuse the diagonal runway, the longest on CoreXY', () => {
    const scene = {
      objects: [IMAGE, SQUARE],
      layers: [
        imageLayer({ speed: 1500, autoOverscan: true, imageOverscanMm: 0 }),
        fillLayer({ speed: 6000, autoOverscan: true, fillOverscanMm: 0 }),
      ],
    };
    // 6000 mm/min at 500 / √2 mm/s²: 14.1 mm x 1.1.
    expect(maxOutputOverscanMm(scene, coreXy)).toBe(15.6);
    expect(maxOutputOverscanMm(scene, dev)).toBe(11);
  });
});
