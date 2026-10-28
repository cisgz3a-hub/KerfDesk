// Job Review advisories for an image turned off its scan rows (quality audit
// Q2): the upsample advisory counts burn cells along the image's own axes
// (Q2-P2-1), and a turned Pass-Through image says it cannot keep its pixels
// one for one, with the ways to keep them (Q2-P1-1, ADR-492 Amendment 1).

import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { detectJobIntentWarnings } from './job-intent-warnings';

const COLOR = '#ff0000';
const UPSAMPLE = 'the engrave will be softer';
const TURNED = 'cannot follow the burn rows';

// 64 x 64 px stored at `pixelsPerMm` (6.4 mm at 10 px/mm), a 50 % checker.
function photo(pixelsPerMm: number, rotationDeg: number, width = 64, height = 64): RasterImage {
  const luma = Uint8Array.from({ length: width * height }, (_, k) =>
    (Math.floor(k / width) + (k % width)) % 2 === 0 ? 0 : 255,
  );
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: Buffer.from(luma).toString('base64'),
    pixelWidth: width,
    pixelHeight: height,
    bounds: { minX: 0, minY: 0, maxX: width / pixelsPerMm, maxY: height / pixelsPerMm },
    transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40, rotationDeg },
    color: COLOR,
    dither: 'jarvis',
    linesPerMm: 10,
  };
}

function project(obj: RasterImage, layer: Partial<Layer> = {}): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      objects: [obj],
      layers: [
        {
          ...createLayer({ id: 'L1', color: COLOR, name: 'Photo' }),
          mode: 'image',
          ditherAlgorithm: 'jarvis',
          linesPerMm: 10,
          ...layer,
        },
      ],
    },
  };
}

const matching = (warnings: ReadonlyArray<string>, text: string): string[] =>
  warnings.filter((warning) => warning.includes(text));

describe('the upsample advisory measures the image along its own axes (Q2-P2-1)', () => {
  it.each([
    ['10 px/mm turned 5 degrees', 10, 5],
    ['10 px/mm turned 37 degrees', 10, 37],
    ['10 px/mm turned 45 degrees', 10, 45],
    ['13 px/mm turned 37 degrees (a downscale)', 13, 37],
    ['14 px/mm turned 45 degrees (a downscale)', 14, 45],
    ['10 px/mm turned 90 degrees', 10, 90],
  ])('stays silent for %s at 10 lines/mm', (_, pixelsPerMm, rotationDeg) => {
    const warnings = detectJobIntentWarnings(project(photo(pixelsPerMm, rotationDeg)));
    expect(matching(warnings, UPSAMPLE)).toEqual([]);
  });

  it('stays silent for a wide image turned a quarter, which used to swap its axes', () => {
    const wide = photo(10, 90, 100, 50);
    expect(matching(detectJobIntentWarnings(project(wide)), UPSAMPLE)).toEqual([]);
  });

  it.each([0, 37])(
    'still warns about a real upsample (8 px/mm, turned %i degrees) with the true grid',
    (rotationDeg) => {
      const warnings = matching(detectJobIntentWarnings(project(photo(8, rotationDeg))), UPSAMPLE);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('stores 64 × 64 px but the burn grid wants 80 × 80 px');
    },
  );
});

describe('a turned Pass-Through image says it cannot keep its pixels (Q2-P1-1)', () => {
  it('names the turn, the pixel size kept and the scan angle that lines it up', () => {
    const warnings = matching(
      detectJobIntentWarnings(project(photo(10, 37), { passThrough: true })),
      TURNED,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Image "photo.png" on "Photo" uses original pixels');
    expect(warnings[0]).toContain('turned 37° and scans at 0°');
    expect(warnings[0]).toContain('keeps its 0.1 mm pixel size');
    // Front-left flips one axis, so a 37 degree turn on the canvas lines up
    // with a scan at -37, which is 143 degrees.
    expect(warnings[0]).toContain('set the scan angle to 143°');
    expect(warnings[0]).toContain('turn Use original pixels off');
  });

  it('warns about an upright image scanned at an angle', () => {
    const warnings = matching(
      detectJobIntentWarnings(project(photo(10, 0), { passThrough: true, imageScanAngleDeg: 37 })),
      TURNED,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('turned 0° and scans at 37°');
    expect(warnings[0]).toContain('set the scan angle to 0°');
  });

  it('warns once per image even when several passes are turned', () => {
    const layer = { passThrough: true, passes: 3, passAngleStepDeg: 20 };
    const warnings = detectJobIntentWarnings(project(photo(10, 37), layer));
    expect(matching(warnings, TURNED)).toHaveLength(1);
  });

  it.each([
    ['upright', 0, 0],
    ['a quarter turn', 90, 0],
    ['a half turn', 180, 0],
    ['turned with the scan', -37, 37],
    ['a quarter turn from the scan', 53, 37],
  ])('stays silent for %s', (_, rotationDeg, imageScanAngleDeg) => {
    const warnings = detectJobIntentWarnings(
      project(photo(10, rotationDeg), { passThrough: true, imageScanAngleDeg }),
    );
    expect(matching(warnings, TURNED)).toEqual([]);
  });

  it('stays silent when Pass-through is off', () => {
    expect(matching(detectJobIntentWarnings(project(photo(10, 37))), TURNED)).toEqual([]);
  });

  it('offers no scan angle on a rotary, which scans along X', () => {
    const base = project(photo(10, 37), { passThrough: true });
    const rotary: Project = {
      ...base,
      device: {
        ...base.device,
        rotary: { enabled: true, type: 'roller', mmPerRotation: 100, objectDiameterMm: 40 },
      },
    };
    const warnings = matching(detectJobIntentWarnings(rotary), TURNED);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('scan angle');
    expect(warnings[0]).toContain('turn the image to a multiple of 90°');
  });
});
