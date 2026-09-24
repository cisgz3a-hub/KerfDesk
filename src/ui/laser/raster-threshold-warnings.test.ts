import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
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

function art(pixelsPerMm: number): RasterImage {
  const width = 20 * pixelsPerMm;
  const height = 10 * pixelsPerMm;
  return {
    kind: 'raster-image',
    id: 'art',
    source: 'feather.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: Buffer.from(new Uint8Array(width * height).fill(0)).toString('base64'),
    pixelWidth: width,
    pixelHeight: height,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    color: COLOR,
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function project(layer: Partial<Layer>, pixelsPerMm: number): Project {
  return {
    ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    scene: {
      ...EMPTY_SCENE,
      objects: [art(pixelsPerMm)],
      layers: [
        {
          ...createLayer({ id: 'L1', color: COLOR, mode: 'image' }),
          name: 'Engrave',
          ditherAlgorithm: 'threshold',
          ...layer,
        },
      ],
    },
  };
}

function thresholdWarnings(p: Project): ReadonlyArray<string> {
  return detectJobIntentWarnings(p).filter((warning) => warning.includes('uses Threshold'));
}

describe('raster threshold warnings', () => {
  it('warns when Threshold samples a source at least twice as dense as the burn grid', () => {
    expect(thresholdWarnings(project({ linesPerMm: 10 }, 40))).toEqual([
      `Image "feather.png" on "Engrave" uses Threshold at 10 lines/mm on a source stored at 40 px/mm. Each burn cell keeps one source pixel, so lines and dots narrower than 0.1 mm are dropped or widened to a full cell, depending on where each cell's sample falls, although the canvas shows them all. A dithered mode such as Floyd-Steinberg keeps them as proportional texture.`,
    ]);
  });

  it('stays quiet for dithered modes, near-1:1 sources and Pass-Through', () => {
    expect(thresholdWarnings(project({ ditherAlgorithm: 'floyd-steinberg' }, 40))).toEqual([]);
    expect(thresholdWarnings(project({ linesPerMm: 10 }, 15))).toEqual([]);
    expect(thresholdWarnings(project({ passThrough: true }, 40))).toEqual([]);
  });
});
